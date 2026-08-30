import { Agent } from "@earendil-works/pi-agent-core";
import os from "node:os";
import { localDate, log } from "./paths";
import { config } from "./config";
import { model, streamFn, summarizeHistory } from "./ai";
import { pmTools } from "./tools";
import { loadSession, saveSession, type SessionData } from "./db";

process.env.TZ = "Asia/Shanghai";

/** 会话管理参数（config.json app 节）：超过 MAX 条触发压缩，压缩到最近 KEEP 条 */
const SESSION_MAX = config.app.sessionMax;
const SESSION_KEEP = config.app.sessionKeep;

/** 本机局域网 IPv4（缓存；进程生命周期内视为不变） */
const _ips = (() => {
	const out: string[] = [];
	for (const list of Object.values(os.networkInterfaces())) {
		for (const ni of list ?? []) {
			if (ni.family === "IPv4" && !ni.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ni.address)) {
				out.push(ni.address);
			}
		}
	}
	return [...new Set(out)];
})();

/** 每次调用实时探测局域网 IPv4（网络可能变化，勿缓存） */
function lanIPv4s(): string[] {
	const out = new Set<string>();
	for (const list of Object.values(os.networkInterfaces())) {
		for (const ni of list ?? []) {
			if (ni.family === "IPv4" && !ni.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ni.address)) out.add(ni.address);
		}
	}
	return [...out];
}

export function systemPrompt(): string {
	const d = new Date();
	const week = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
	const lanUrls = _ips.map((ip) => `http://${ip}:${config.app.port}`).join("、");
	const lan = lanIPv4s().map((ip) => `http://${ip}:${config.app.port}`).join("、");
	return `你是 yosob 的个人项目管理助手（AI PM）。今天日期：${localDate(d)} 星期${week}。你通过工具操作一个本地项目库。
网页看板地址（实时探测）：本机 http://127.0.0.1:${config.app.port}${lan ? `；局域网（手机等同网设备）${lan}` : ""}。用户问怎么看板时直接告知；公网访问需自行内网穿透。
网页看板地址：本机 http://127.0.0.1:${config.app.port}${lanUrls ? `；同一局域网（如手机）${lanUrls}` : ""}。用户问怎么看板/地址是多少时直接告知（局域网地址含端口）；提醒公网访问需自行做内网穿透。

行为规则：
1. 绝不编造数据。任何项目/任务信息必须来自工具返回结果。
2. 用户发来会议纪要、周报等材料时：调 propose_updates，把返回的拟更新清单原样完整转述（含任务名、截止日、归属项目、编号），并说明"回复 确认 生效；如需调整请说明"。
3. 只有用户明确同意（确认/可以/没问题）后才调 apply_updates（用清单里的编号）。用户要求修改某条时：先 discard_updates 该编号，再按修改意见用 create_task 等工具逐条执行并汇报。
4. 用户问"今天该干嘛/这周安排/XX项目进展"：调 list_tasks，按项目分组汇报，逾期任务放最前并标注【逾期】。
5. 用户要求改期/完成/重命名：调 update_task；不知道 task_id 就先 list_tasks 查。
6. 用户提到微信群名、文档链接等资料：调 add_resource 挂到对应项目（明确说挂某任务上则传 task_id）。
7. 相对日期（下周三、月底）先按今天日期换算成 YYYY-MM-DD 再传参。
8. 用户没有指明项目时，任务放入「日程安排」项目（没有就创建），不要猜测归属某个现有项目；用户明确说了项目才归入对应项目。
9. 用户问某个任务的详细信息/任务上挂的资料：调 get_task。
10. 用户要设置任务的附加属性（负责人、合同号等自定义字段）：调 set_custom_field。
11. 项目目标/状态/截止日修改：调 update_project。
12. 回复用简洁中文，列表优先，不寒暄。不确定用户意图时，列出可做的操作让用户选，不要自作主张写库。
13. 任务拆解：用户要"给任务X加个子任务/把X拆解一下"时，用 create_task 传 parent_task_id（归属自动取父任务所在项目，最多一层，子任务不能再挂子任务）；父任务完成时未完成的子任务自动完成；解除关联用 update_task 把 parent_task_id 置 0。`;
}

/** 截断安全点：不能从 toolResult 开头（会孤儿化前一条 assistant 的工具调用） */
function safeCutIndex(msgs: any[], prefer: number): number {
	let i = Math.max(0, prefer);
	while (i < msgs.length && msgs[i]?.role !== "user") i++;
	return i;
}

/**
 * 会话压缩：messages 超过 SESSION_MAX 时，把最早的（len-KEEP）条安全切出，
 * 连同旧摘要交给 GLM 合并成新滚动摘要；保留最近 KEEP 条原始消息。
 * 未超限则原样保存（摘要沿用旧值）。
 */
export async function compactIfNeeded(chatKey: string, messages: any[], prevSummary: string): Promise<SessionData> {
	if (messages.length <= SESSION_MAX) {
		return { summary: prevSummary, messages };
	}
	const cut = safeCutIndex(messages, messages.length - SESSION_KEEP);
	if (cut <= 0) return { summary: prevSummary, messages }; // 理论上不会发生（找不到 user 边界）
	const older = messages.slice(0, cut);
	const kept = messages.slice(cut);
	const summary = await summarizeHistory(prevSummary, older);
	log(`会话压缩 chat=${chatKey.slice(0, 8)}: ${messages.length}条 → 摘要+${kept.length}条`);
	return { summary, messages: kept };
}

/** 每个会话（Lark chat / 终端）一个 Agent 实例 */
export function makeAgent(chatKey: string): Agent {
	const data = loadSession(chatKey) ?? { summary: "", messages: [] };
	// 滚动摘要注入为开头一条背景消息（LLM 据此获得长程记忆）
	const messages: any[] = [...data.messages];
	if (data.summary) {
		messages.unshift({
			role: "user",
			content: [{ type: "text", text: `【背景：本会话更早对话的自动摘要（供你参考，不要提及）】\n${data.summary}` }],
			timestamp: Date.now(),
		});
	}
	const agent = new Agent({
		initialState: {
			systemPrompt: systemPrompt(),
			model: model as any,
			tools: pmTools as any,
			messages,
		},
		streamFn,
	});
	// 每轮结束持久化（超过 SESSION_MAX 触发压缩；摘要失败不丢消息）
	// 注意：prevSummary 必须每轮从库里读最新值——闭包固化会让第二次压缩用创建时的旧摘要，
	// 覆盖掉第一次压缩已落库的新摘要（长程记忆逐轮丢失）
	agent.subscribe((event: any) => {
		if (event.type === "agent_end") {
			const live = agent.state.messages.filter((m: any) => !(m.role === "user" && m.content?.[0]?.text?.startsWith?.("【背景：")));
			const prevSummary = loadSession(chatKey)?.summary ?? "";
			compactIfNeeded(chatKey, live, prevSummary)
				.then((d) => {
					saveSession(chatKey, d);
					// 内存消息同步对齐落库状态（摘要背景 + 保留消息），防止内存无限膨胀
					(agent.state as any).messages = d.summary
						? [
								{
									role: "user",
									content: [{ type: "text", text: `【背景：本会话更早对话的自动摘要（供你参考，不要提及）】\n${d.summary}` }],
									timestamp: Date.now(),
								},
								...d.messages,
							]
						: [...d.messages];
				})
				.catch((e) => {
					log(`会话持久化失败: ${e instanceof Error ? e.message : e}`);
					saveSession(chatKey, { summary: prevSummary, messages: live.slice(-SESSION_MAX) }); // 兜底：硬截断也不至于崩
				});
		}
	});
	return agent;
}

/** 发一条用户消息并等待 agent 跑完，返回最终 assistant 文本（中间工具轮的文本不返回） */
export async function askAgent(agent: Agent, userText: string, onToolEvent?: (name: string) => void): Promise<string> {
	let lastAssistantText = "";
	const unsub = agent.subscribe((event: any) => {
		if (event.type === "message_end" && event.message?.role === "assistant") {
			const blocks = event.message.content ?? [];
			const t = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
			if (t.trim()) lastAssistantText = t;
		}
		if (onToolEvent && event.type === "tool_execution_start") onToolEvent(event.toolName);
	});
	try {
		(agent.state as any).systemPrompt = systemPrompt(); // 每轮刷新：日期与看板地址实时化
		await agent.prompt(userText);
		await agent.waitForIdle();
	} finally {
		unsub();
	}
	return lastAssistantText || "（AI 没有回复文本，请重试或换个说法）";
}
