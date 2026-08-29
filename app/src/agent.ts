import { Agent } from "@earendil-works/pi-agent-core";
import { localDate } from "./paths";
import { model, streamFn } from "./ai";
import { pmTools } from "./tools";
import { loadSession, saveSession } from "./db";

process.env.TZ = "Asia/Shanghai";

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
6. 用户提到微信群名、文档链接等资料：调 add_resource 挂到对应项目。
7. 相对日期（下周三、月底）先按今天日期换算成 YYYY-MM-DD 再传参。
8. 用户没有指明项目时，任务放入「日程安排」项目（没有就创建），不要猜测归属某个现有项目；用户明确说了项目才归入对应项目。
9. 回复用简洁中文，列表优先，不寒暄。不确定用户意图时，列出可做的操作让用户选，不要自作主张写库。`;
}

/** 每个会话（Lark chat / 终端）一个 Agent 实例 */
export function makeAgent(chatKey: string): Agent {
	const messages = (loadSession(chatKey) ?? []) as any[];
	const agent = new Agent({
		initialState: {
			systemPrompt: systemPrompt(),
			model: model as any,
			tools: pmTools as any,
			messages,
		},
		streamFn,
	});
	// 每次 agent 结束后持久化会话（截断在 saveSession 内做）
	agent.subscribe((event: any) => {
		if (event.type === "agent_end") {
			try {
				saveSession(chatKey, agent.state.messages);
			} catch (e) {
				console.error("会话持久化失败", e);
			}
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
