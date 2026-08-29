import readline from "node:readline/promises";
import { makeAgent, askAgent } from "./agent";
import { log } from "./paths";

const agent = makeAgent("terminal");

log("终端 chat 模式启动（glm，输入 /exit 退出）");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
while (true) {
	let line: string;
	try {
		line = (await rl.question("你> ")).trim();
	} catch {
		break; // stdin EOF
	}
	if (!line) continue;
	if (line === "/exit" || line === "/quit") break;
	try {
		const reply = await askAgent(agent, line, (tool) => process.stdout.write(`  ⚙️ ${tool} ...\n`));
		console.log(`AI> ${reply}\n`);
	} catch (e) {
		console.error("出错:", e instanceof Error ? e.message : e);
	}
}
rl.close();
process.exit(0);
