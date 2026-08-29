import fs from "node:fs";
import path from "node:path";
import { makeAgent, askAgent } from "../src/agent";
import { ROOT } from "../src/paths";

const content = fs.readFileSync(path.join(ROOT, "sample-meeting.md"), "utf8");
const agent = makeAgent("e2e-test");

async function turn(label: string, text: string) {
	console.log(`\n===== ${label} =====`);
	console.log(`你> ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`);
	const t0 = Date.now();
	const reply = await askAgent(agent, text, (tool) => console.log(`  ⚙️ ${tool}`));
	console.log(`AI> ${reply}`);
	console.log(`(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

await turn("1. 丢纪要", content);
await turn("2. 确认", "确认");
await turn("3. 今日总览", "今天我该干嘛");
await turn("4. 改期", "把版图终稿的截止日推迟到2026-09-20");
process.exit(0);
