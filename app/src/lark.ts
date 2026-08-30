import * as lark from "@larksuiteoapi/node-sdk";
import crypto from "node:crypto";
import { makeAgent, askAgent } from "./agent";
import { setSetting } from "./db";
import { log } from "./paths";
import { config } from "./config";

const APP_ID = config.lark.appId;
const APP_SECRET = config.lark.appSecret;
const LARK_DOMAIN = config.lark.domain === "feishu" ? lark.Domain.Feishu : lark.Domain.Lark;
const TIMEOUT_MS = 5 * 60 * 1000;

const agents = new Map<string, { agent: any; queue: Promise<unknown> }>();

function session(chatId: string) {
	const key = crypto.createHash("sha256").update(chatId).digest("hex").slice(0, 24);
	let s = agents.get(key);
	if (!s) {
		s = { agent: makeAgent(`lark:${key}`), queue: Promise.resolve() };
		agents.set(key, s);
	}
	return s;
}

/**
 * 标准 Markdown → 卡片 lark_md 的确定性转换（模型端零约束）。
 * 规则表见 docs/DECISIONS.md #34；代码块内不转换。
 */
export function mdToLark(md: string): string {
	const lines = md.split("\n");
	let inCode = false;
	const out = lines.map((line) => {
		if (/^```/.test(line.trim())) {
			inCode = !inCode;
			return line; // 围栏保留（lark_md 7.6+ 支持）
		}
		if (inCode) return line;
		// 11) 分割线
		if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return "—————————";
		// 1/2) 标题
		const h = line.match(/^(#{1,6})\s+(.*)$/);
		if (h) return h[1].length <= 2 ? `**【${inline(h[2])}】**` : `**${inline(h[2])}**`;
		// 8) 引用
		const q = line.match(/^\s*>\s?(.*)$/);
		if (q) return `▎${inline(q[1])}`;
		// 12) 表格行
		if (/^\s*\|.*\|\s*$/.test(line)) {
			const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
			if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) return ""; // 分隔行丢弃
			return cells.join(" ｜ ");
		}
		// 3) 无序列表（含嵌套缩进）
		const ul = line.match(/^(\s*)[-*+]\s+(.*)$/);
		if (ul) return `${ul[1]}• ${inline(ul[2])}`;
		return inline(line);
	});
	return out.filter((l) => l !== "").join("\n");
}
/** 行内处理：图片降级链接、行内代码去壳 */
function inline(t: string): string {
	return t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "[图片：$1]($2)").replace(/`([^`]+)`/g, "$1");
}

function cardContent(larkMd: string) {
	return JSON.stringify({ elements: [{ tag: "div", text: { tag: "lark_md", content: larkMd } }] });
}

/**
 * 群消息是否 @了本机器人：mention 的 open_id 必须命中 bot 自身。
 * bot 身份未知时退化为"有 @ 就响应"（避免 bot info 拉取失败导致群聊完全失联）。
 */
export function isBotMentioned(mentions: unknown, botOpenId: string | null): boolean {
	const list = Array.isArray(mentions) ? mentions : [];
	if (list.length === 0) return false;
	if (!botOpenId) return true;
	return list.some((m: any) => m?.id?.open_id === botOpenId);
}

export function startLark() {
	if (!APP_ID || !APP_SECRET) {
		log("未配置 LARK_APP_ID/SECRET，跳过 Lark 桥");
		return;
	}
	const client = new lark.Client({ appId: APP_ID, appSecret: APP_SECRET, domain: LARK_DOMAIN });
	const wsClient = new lark.WSClient({ appId: APP_ID, appSecret: APP_SECRET, domain: LARK_DOMAIN, loggerLevel: lark.LoggerLevel.info });

	// 拉取机器人自身 open_id（群聊 @ 判定用）；失败则退化为宽松判定
	let botOpenId: string | null = null;
	client
		.request({ method: "GET", url: "/open-apis/bot/v3/info" })
		.then((res: any) => {
			botOpenId = res?.bot?.open_id ?? res?.data?.bot?.open_id ?? null;
			log(botOpenId ? `机器人身份已确认: ${botOpenId}` : "未取到机器人 open_id（群聊@判定退化为宽松模式）");
		})
		.catch((e: unknown) => log(`bot info 拉取失败（群聊@判定退化为宽松模式）: ${e instanceof Error ? e.message : e}`));

	async function reply(messageId: string, text: string) {
		const larkMd = mdToLark(text);
		// 超长按行边界分段（每卡 ~2000 字符）
		const parts: string[] = [];
		let cur = "";
		for (const line of larkMd.split("\n")) {
			if ((cur + line).length > 1900 && cur) {
				parts.push(cur);
				cur = line;
			} else cur = cur ? cur + "\n" + line : line;
		}
		if (cur || !parts.length) parts.push(cur || "（空回复）");
		for (const part of parts) {
			try {
				await client.im.message.reply({
					path: { message_id: messageId },
					data: { content: cardContent(part), msg_type: "interactive" },
				});
			} catch (e) {
				log(`卡片回复失败，降级 text: ${e instanceof Error ? e.message : e}`);
				try {
					await client.im.message.reply({
						path: { message_id: messageId },
						data: { content: JSON.stringify({ text: part }), msg_type: "text" },
					});
				} catch (e2) {
					log(`Lark 回复失败(降级后): ${e2 instanceof Error ? e2.message : e2}`);
				}
			}
		}
	}

	const dispatcher = new lark.EventDispatcher({}).register({
		"im.message.receive_v1": async (data: any) => {
			try {
				const msg = data?.message;
				if (!msg) return;
				// 记住主人（私聊发消息者），提醒走机器人私聊
				if (msg.chat_type === "p2p" && data?.sender?.sender_id?.open_id) {
					setSetting("owner_open_id", data.sender.sender_id.open_id);
				}
				// 只处理文本
				if (msg.message_type !== "text") {
					await reply(msg.message_id, "暂只支持文本，请粘贴纪要文字（图片支持开发中）");
					return;
				}
				// 群聊必须 @机器人（mentions 包含机器人时 key 形如 @_user_1；取正文并去掉 @占位）
				let text: string = "";
				try {
					text = JSON.parse(msg.content)?.text ?? "";
				} catch {
					return;
				}
				if (msg.chat_type === "group") {
					if (!isBotMentioned(msg.mentions, botOpenId)) return; // 未 @本机器人，忽略
					text = text.replace(/@_user_\d+/g, "").trim();
					if (!text) return;
				}
				if (!text.trim()) return;

				const s = session(msg.chat_id);
				log(`Lark 消息 chat=${msg.chat_id} text=${text.slice(0, 50)}`);
				// 同会话串行
				s.queue = s.queue.then(async () => {
					// 长操作先给提示（DECISIONS #17）
					const extracting = /纪要|会议|周报|总结/.test(text);
					if (extracting) await reply(msg.message_id, "收到，正在提取…");
					let timer: NodeJS.Timeout | undefined;
					try {
						const answer = await Promise.race([
							askAgent(s.agent, text),
							new Promise<string>((_, rej) => {
								timer = setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS);
								timer.unref(); // 不阻止进程退出
							}),
						]);
						await reply(msg.message_id, answer);
					} catch (e) {
						const m = e instanceof Error ? e.message : String(e);
						if (m === "timeout") {
							s.agent.abort?.();
							await reply(msg.message_id, "处理超时，请稍后重试或换种说法");
						} else {
							log(`agent 处理失败: ${m}`);
							await reply(msg.message_id, "处理出错了，请稍后重试");
						}
					} finally {
						clearTimeout(timer); // 成功路径同样清掉超时定时器（原先每条消息泄漏一个）
					}
				});
			} catch (e) {
				log(`Lark 事件处理异常: ${e instanceof Error ? e.message : e}`);
			}
		},
	});

	wsClient
		.start({ eventDispatcher: dispatcher })
		.then(() => log("Lark WebSocket 已连接"))
		.catch((e) => log(`Lark WS 启动失败: ${e instanceof Error ? e.message : e}`));
}
