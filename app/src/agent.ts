import { Agent } from "@earendil-works/pi-agent-core";
import { localDate, log } from "./paths";
import { model, streamFn, summarizeHistory } from "./ai";
import { pmTools } from "./tools";
import { loadSession, saveSession, type SessionData } from "./db";

process.env.TZ = "Asia/Shanghai";

/** 会话管理参数（.env 可调）：超过 MAX 条触发压缩，压缩到最近 KEEP 条，其余并入滚动摘要 */
const SESSION_MAX = Number(process.env.SESSION_MAX || 200);
const SESSION_KEEP = Number(process.env.SESSION_KEEP || 50);

export function systemPrompt(): string {
	const d = new Date();
	const week = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
	return `你是 yosob 的个人项目管理助手（AI PM）。今天日期：${localDate(d)} 星期${week}。你通过工具操作一个本地项目库。

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
12. 回复用简洁中文，列表优先，不寒暄。不确定用户意图时，列出可做的操作让用户选，不要自作主张写库。`;
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
	const prevSummary = data.summary;
	agent.subscribe((event: any) => {
		if (event.type === "agent_end") {
			const live = agent.state.messages.filter((m: any) => !(m.role === "user" && m.content?.[0]?.text?.startsWith?.("【背景：")));
			compactIfNeeded(chatKey, live, prevSummary)
				.then((d) => saveSession(chatKey, d))
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
		await agent.prompt(userText);
		await agent.waitForIdle();
	} finally {
		unsub();
	}
	return lastAssistantText || "（AI 没有回复文本，请重试或换个说法）";
}
