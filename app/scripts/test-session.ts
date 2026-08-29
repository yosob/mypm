import { compactIfNeeded } from "../src/agent";
import { saveSession, loadSession } from "../src/db";

// 造 220 条消息：含 user/assistant/toolCall/toolResult 交错（考验安全截断点）
function fake(n: number) {
	const arr: any[] = [];
	for (let i = 0; i < n; i++) {
		const k = i % 4;
		if (k === 0) arr.push({ role: "user", content: [{ type: "text", text: `用户消息${i}：把任务${i}推迟到 9月${(i % 28) + 1}日` }], timestamp: i });
		if (k === 1) arr.push({ role: "assistant", content: [{ type: "toolCall", id: `c${i}`, name: "update_task", arguments: { task_id: i } }], timestamp: i });
		if (k === 2) arr.push({ role: "toolResult", toolCallId: `c${i - 1}`, content: [{ type: "text", text: `已更新任务${i - 1}` }], timestamp: i });
		if (k === 3) arr.push({ role: "assistant", content: [{ type: "text", text: `好的，任务${i - 3}已改期。` }], timestamp: i });
	}
	return arr;
}

const msgs = fake(220);
console.log("构造:", msgs.length, "条");

// 触发压缩（真实调用 glm 做摘要）
const data = await compactIfNeeded("test-compact", msgs, "旧摘要：项目A的排期曾整体顺延。");
console.log("压缩后: summary长度 =", data.summary.length, "| 保留消息 =", data.messages.length);
console.log("保留区第一条 role =", data.messages[0].role, "(应为 user)");
console.log("摘要含关键信息:", data.summary.includes("推迟") || data.summary.includes("9月"), "| 含旧摘要合并:", data.summary.includes("顺延") || data.summary.includes("项目A"));
console.log("摘要前200字:\n", data.summary.slice(0, 200));

// 存取回路 + 旧格式兼容
saveSession("test-compact", data);
const back = loadSession("test-compact")!;
console.log("存取回路:", back.messages.length === data.messages.length && back.summary === data.summary);
saveSession("test-legacy", [{ role: "user", content: [{ type: "text", text: "旧格式" }], timestamp: 1 }] as any);
console.log("旧格式兼容:", loadSession("test-legacy")!.messages.length === 1);

// 未超限不压缩
const small = await compactIfNeeded("test-small", fake(80), "");
console.log("未超限原样保存:", small.messages.length === 80 && small.summary === "");

// 清理测试数据
import { db } from "../src/db";
db.prepare("DELETE FROM agent_sessions WHERE chat_key LIKE 'test-%'").run();
console.log("清理完成");
process.exit(0);
