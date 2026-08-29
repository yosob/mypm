import { createModels } from "@earendil-works/pi-ai";
import { localDate } from "./paths";
import { zaiCodingCnProvider } from "@earendil-works/pi-ai/providers/zai-coding-cn";
import dotenv from "dotenv";
import path from "node:path";
import { ROOT } from "./paths";
import type { ExtractedUpdate } from "./db";
import { listProjects } from "./db";

dotenv.config({ path: path.join(ROOT, ".env") });

process.env.TZ = "Asia/Shanghai";

export const MODEL_ID = process.env.PM_MODEL || "glm-4.7";

export const models = createModels();
models.setProvider(zaiCodingCnProvider());
export const model = models.getModel("zai-coding-cn", MODEL_ID) as any;
/** Agent 构造所需的 streamFn（绑定模型目录，自动解析 api/key） */
export const streamFn = (models as any).streamSimple.bind(models);

// ---------- 提取器（propose_updates 内部的单次 LLM 调用） ----------

const EXTRACT_PROMPT = `你是项目管理助手。从下面的会议纪要中提取信息，输出严格的 JSON（不要 markdown 代码块，不要多余文字）。

今天日期：{today}
现有项目列表（纪要中的项目尽量归入现有项目，确实没有才 is_new=true）：
{projects}

输出格式：
{{
  "items": [
    {{"project": "项目名", "is_new": false, "title": "待办/任务标题",
      "due_date": "YYYY-MM-DD 或 null", "is_milestone": false, "description": "补充说明"}}
  ],
  "resources": [
    {{"project": "项目名", "type": "wechat_group或link", "value": "群名或链接", "label": "简短说明"}}
  ],
  "summaries": [
    {{"project": "项目名", "summary": "本次会议该项目整体进展摘要(1-3句)"}}
  ]
}}

规则：
- 每个可执行待办一条 item
- 关键时间节点（评审、交付、截止）is_milestone=true
- 相对日期（下周三等）以今天为基准换算成 YYYY-MM-DD；只给月日的按未来最近日期补全年份
- 微信群名、文档链接放入 resources，不混入任务 description
- 没有对应内容就给空数组

会议纪要：
{content}`;

function stripJson(text: string): string {
	const t = text.trim();
	if (t.startsWith("```")) return t.split("\n", 1)[1] === undefined ? t : t.slice(t.indexOf("\n") + 1, t.lastIndexOf("```")).trim();
	return t;
}

/** 单次非流式用途的文本补全：await 流的最终 AssistantMessage，取文本块 */
export async function completeText(systemPrompt: string, userContent: string): Promise<string> {
	const stream = (models as any).streamSimple(model, {
		systemPrompt,
		messages: [{ role: "user", content: [{ type: "text", text: userContent }], timestamp: Date.now() }],
	});
	const msg = await stream.result();
	const text = (msg.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
	if (!text && msg.stopReason === "error") throw new Error(msg.errorMessage || "LLM 调用失败");
	return text;
}

/** 纪要 → 结构化拟更新。失败自动重试一次。 */
export async function extractUpdates(content: string): Promise<ExtractedUpdate> {
	const names = listProjects().map((p) => `- ${p.name}`).join("\n") || "（暂无项目）";
	const prompt = EXTRACT_PROMPT.replace("{today}", localDate())
		.replace("{projects}", names)
		.replace("{content}", content);

	let lastErr: unknown;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const raw = await completeText("你是严谨的信息提取器。", prompt);
			return JSON.parse(stripJson(raw)) as ExtractedUpdate;
		} catch (e) {
			lastErr = e;
		}
	}
	throw new Error(`纪要提取失败: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}
