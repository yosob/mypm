import { makeAgent, askAgent } from "../src/agent";

const agent = makeAgent("e2e-ai-native");

async function turn(label: string, text: string) {
	console.log(`\n===== ${label} =====`);
	const t0 = Date.now();
	const reply = await askAgent(agent, text, (tool) => console.log(`  ⚙️ ${tool}`));
	console.log(`AI> ${reply}`);
	console.log(`(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

// 断层补齐验证：读取排期/项目状态、单任务详情（含自定义字段）、写自定义字段
await turn("1. 项目总览（应含状态/项目截止/排期）", "列出所有项目");
await turn("2. 单任务详情（应含任务资料+自定义字段）", "和大海开会那个任务的详细信息");
await turn("3. 写自定义字段", "把和大海开会那个任务的负责人设为王五");
await turn("4. 回读确认", "和大海开会任务的负责人是谁");
process.exit(0);
