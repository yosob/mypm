import * as lark from "@larksuiteoapi/node-sdk";
import crypto from "node:crypto";
import { makeAgent, askAgent } from "./agent";
import { setSetting } from "./db";
import { log } from "./paths";

const APP_ID = process.env.LARK_APP_ID || "";
const APP_SECRET = process.env.LARK_APP_SECRET || "";
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

export function startLark() {
	if (!APP_ID || !APP_SECRET) {
		log("未配置 LARK_APP_ID/SECRET，跳过 Lark 桥");
		return;
	}
	const client = new lark.Client({ appId: APP_ID, appSecret: APP_SECRET, domain: lark.Domain.Lark });
	const wsClient = new lark.WSClient({ appId: APP_ID, appSecret: APP_SECRET, domain: lark.Domain.Lark, loggerLevel: lark.LoggerLevel.info });

	async function reply(messageId: string, text: string) {
		// 超长分段（卡片显示 3000 字截断，按 2000 分段）
		const parts = text.match(/[\s\S]{1,2000}/g) ?? ["（空回复）"];
		for (const part of parts) {
			try {
				await client.im.message.reply({
					path: { message_id: messageId },
					data: { content: JSON.stringify({ text: part }), msg_type: "text" },
				});
			} catch (e) {
				log(`Lark 回复失败: ${e instanceof Error ? e.message : e}`);
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
					const mentioned = (msg.mentions ?? []).some((m: any) => m.id?.open_id || m.key);
					if (!mentioned) return; // 未 @机器人，忽略
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
					try {
						const answer = await Promise.race([
							askAgent(s.agent, text),
							new Promise<string>((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS)),
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
