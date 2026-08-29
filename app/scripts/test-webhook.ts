import dotenv from "dotenv";
import path from "node:path";
import { ROOT } from "../src/paths";
dotenv.config({ path: path.join(ROOT, ".env") });

const r = await fetch(process.env.FEISHU_WEBHOOK!, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ msg_type: "text", content: { text: "mypm webhook 连通性测试" } }),
});
console.log(r.status, await r.text());
