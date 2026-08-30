import { createModels, createProvider, envApiKeyAuth, type Provider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { config, type CustomProvider } from "./config";
import { localDate } from "./paths";
import type { ExtractedUpdate } from "./db";
import { listProjects } from "./db";

process.env.TZ = "Asia/Shanghai";

/** 把 config.llm.custom 的自定义端点注册为 provider（密钥注入专属 env 后由 pi 的 auth 解析） */
export function registerCustom(c: CustomProvider): Provider<"openai-completions" | "anthropic-messages"> {
	const envName = `MYPM_${c.id.toUpperCase().replace(/-/g, "_")}_API_KEY`;
	process.env[envName] = c.apiKey;
	const models = c.models.map((m) => ({
		id: m.id,
		name: m.name ?? m.id,
		api: c.api,
		provider: c.id,
		baseUrl: c.baseUrl,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: m.contextWindow ?? 128000,
		maxTokens: m.maxTokens ?? 8192,
	}));
	return createProvider({
		id: c.id,
		name: c.name ?? c.id,
		baseUrl: c.baseUrl,
		auth: { apiKey: envApiKeyAuth(`${c.id} key`, [envName]) },
		models,
		api: c.api === "anthropic-messages" ? anthropicMessagesApi() : openAICompletionsApi(),
	});
}

/** 组装模型目录：config.llm.providers 声明的每一家（智谱亦不特殊） */
export const models = createModels();
for (const c of config.llm.providers ?? []) {
	try {
		models.setProvider(registerCustom(c));
	} catch (e) {
		console.error(`[ai] provider "${c.id}" 注册失败:`, e instanceof Error ? e.message : e);
	}
}

export const MODEL_ID = config.llm.model;
export const model = models.getModel(config.llm.provider, config.llm.model);
if (!model) {
	const avail = models
		.getModels()
		.map((m) => `${m.provider}/${m.id}`)
		.slice(0, 40)
		.join("\n  ");
	console.error(`[ai] 找不到模型 ${config.llm.provider}/${config.llm.model}（config.json llm 节）。可用模型（前40）：\n  ${avail}`);
	process.exit(1);
}


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
      "start_date": "YYYY-MM-DD 或 null", "due_date": "YYYY-MM-DD 或 null",
      "is_milestone": false, "priority": "P0~P3（紧急重要P0，默认P3）", "description": "补充说明"}}
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
- 任务有明确的时间区间（X日起到Y日、本周做X）时同时给 start_date 和 due_date；只有截止日则 start_date 为 null
- 纪要中明显紧急/高优先的标 P0/P1，默认 P3
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
	// 替换串必须走函数形式：内容含 $&、$'、$1 等序列时字符串形式会被解释改写
	const prompt = EXTRACT_PROMPT.replace("{today}", localDate())
		.replace("{projects}", () => names)
		.replace("{content}", () => content);

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

// ---------- 会话历史压缩 ----------

const SUMMARIZE_PROMPT = `你是项目助手的长程记忆压缩器。把【旧摘要】与【较早的对话记录】合并成一份新的摘要，供 AI 助手后续对话时参考。

要求：
- 保留所有关键信息：任务 id/名称/日期、用户的决定与偏好、项目名、微信群名/链接、未完结的话题
- 丢弃寒暄与重复
- 中文，分条列出，不超过 500 字

【旧摘要】
{prev}

【较早的对话记录】
{older}`;

/** 把旧摘要 + 更早的原始消息 合并压缩为新摘要。失败返回 prev（不丢数据）。 */
export async function summarizeHistory(prev: string, older: any[]): Promise<string> {
	const transcript = older
		.map((m: any, i: number) => {
			const role = m.role === "user" ? "用户" : m.role === "assistant" ? "助手" : "工具结果";
			const blocks = m.content ?? [];
			const text = (Array.isArray(blocks) ? blocks : [])
				.map((b: any) => (b.type === "text" ? b.text : b.type === "toolCall" ? `[调用 ${b.name}]` : ""))
				.join(" ")
				.slice(0, 400);
			return `${i + 1}. ${role}: ${text}`;
		})
		.join("\n")
		.slice(0, 24000);
	const prompt = SUMMARIZE_PROMPT.replace("{prev}", () => prev || "（无）").replace("{older}", () => transcript);
	try {
		const out = await completeText("你是对话摘要器。", prompt);
		return out.trim() || prev;
	} catch (e) {
		console.error("会话摘要压缩失败，保留旧摘要", e);
		return prev;
	}
}
