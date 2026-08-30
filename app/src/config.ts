import fs from "node:fs";
import path from "node:path";
import { ROOT, log } from "./paths";

/**
 * 单一配置文件加载器（pi 风格）。
 * - 项目根 config.json 管全部配置（密钥+行为参数），gitignore
 * - 密钥字段值支持 "$ENV_VAR" / "${ENV_VAR}" 环境变量引用（部署时全 env 化）
 * - 缺字段用内置默认值；config.json 不存在则报错退出
 */

/** 自定义模型端点（OpenAI 兼容 / Anthropic 兼容） */
export type CustomProvider = {
	id: string;
	name?: string;
	baseUrl: string;
	api: "openai-completions" | "anthropic-messages";
	apiKey: string;
	models: { id: string; name?: string; contextWindow?: number; maxTokens?: number }[];
};

export type AppConfig = {
	llm: {
		provider: string; // providers[] 中某一家的 id
		model: string;
		providers: CustomProvider[]; // 所有模型厂家都在这里声明（智谱也是普通一家）
	};
	lark: { appId: string; appSecret: string; domain: "lark" | "feishu" };
	notify: { webhook: string };
	app: { port: number; remindDays: number; remindHighlightDays: number; remindCron: string; sessionMax: number; sessionKeep: number };
};

const DEFAULTS: AppConfig = {
	llm: {
		provider: "zhipu",
		model: "glm-4.7",
		providers: [
			{
				id: "zhipu",
				name: "智谱 GLM",
				baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
				api: "openai-completions",
				apiKey: "",
				models: [{ id: "glm-4.7", name: "GLM 4.7", contextWindow: 128000, maxTokens: 32000 }],
			},
		],
	},
	lark: { appId: "", appSecret: "", domain: "lark" },
	notify: { webhook: "" },
	app: { port: 8787, remindDays: 7, remindHighlightDays: 3, remindCron: "0 9 * * *", sessionMax: 200, sessionKeep: 50 },
};

/** $VAR / ${VAR} 环境变量引用解析；$$ 转义字面量；未定义变量→空串并警告 */
export function resolveEnvRef(value: string, where: string): string {
	if (typeof value !== "string" || !value.includes("$")) return value;
	const out = value.replace(/\$\$|\$\{(\w+)\}|\$(\w+)/g, (m, braced, plain) => {
		if (m === "$$") return "$";
		const name = braced || plain;
		const v = process.env[name];
		if (v === undefined) {
			log(`config 警告: ${where} 引用的环境变量 ${name} 未定义`);
			return "";
		}
		return v;
	});
	return out;
}

function deepResolve(node: any, where: string): any {
	if (typeof node === "string") return resolveEnvRef(node, where);
	if (node && typeof node === "object" && !Array.isArray(node)) {
		const out: any = {};
		for (const k of Object.keys(node)) out[k] = deepResolve(node[k], `${where}.${k}`);
		return out;
	}
	return node;
}

function deepMerge(base: any, over: any): any {
	const out = { ...base };
	for (const k of Object.keys(over ?? {})) {
		if (over[k] && typeof over[k] === "object" && !Array.isArray(over[k]) && typeof base[k] === "object") {
			out[k] = deepMerge(base[k], over[k]);
		} else if (over[k] !== undefined) {
			out[k] = over[k];
		}
	}
	return out;
}

const FILE = path.join(ROOT, "config.json");
if (!fs.existsSync(FILE)) {
	console.error(`[config] 找不到 ${FILE}\n[config] 请复制 config.example.json 为 config.json 并填写（密钥可写明文，或 "$环境变量名" 引用）`);
	process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
const resolved = deepResolve(raw, "config");
// 向后兼容：旧 glm{apiKey,model} 节 / llm{provider:"zai-coding-cn",apiKey} → 统一 providers 形态
if (resolved.glm && !resolved.llm) {
	resolved.llm = { provider: "zhipu", model: resolved.glm.model, apiKey: resolved.glm.apiKey };
}
if (resolved.llm?.apiKey) {
	const zs = (DEFAULTS.llm.providers[0] as any);
	resolved.llm.providers = [{ ...zs, apiKey: resolved.llm.apiKey }, ...(resolved.llm.custom ?? [])];
	delete resolved.llm.apiKey;
	delete resolved.llm.custom;
}
export const config: AppConfig = deepMerge(DEFAULTS, resolved);

/** 关键密钥自检（缺失不阻断，由使用方给出明确错误） */
if (!config.llm.providers?.length) log("config 警告: llm.providers 为空（AI 将不可用）");
if (!config.lark.appId || !config.lark.appSecret) log("config 警告: lark 凭证为空（Lark 桥将不启动）");
