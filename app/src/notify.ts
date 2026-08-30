import * as lark from "@larksuiteoapi/node-sdk";
import { log } from "./paths";
import { getSetting } from "./db";
import { config } from "./config";

let client: lark.Client | null = null;
function larkClient(): lark.Client | null {
	const appId = config.lark.appId;
	const appSecret = config.lark.appSecret;
	if (!appId || !appSecret) return null;
	if (!client) client = new lark.Client({ appId, appSecret, domain: config.lark.domain === "feishu" ? lark.Domain.Feishu : lark.Domain.Lark });
	return client;
}

function buildCard(title: string, mdLines: string[], template: string) {
	return {
		header: { title: { tag: "plain_text", content: title }, template },
		elements: [{ tag: "div", text: { tag: "lark_md", content: mdLines.join("\n") || "（无内容）" } }],
	};
}

/**
 * 推送提醒卡片：优先应用机器人私聊（owner_open_id，可交互），
 * 备用飞书群自定义机器人 Webhook（FEISHU_WEBHOOK）。
 * 返回是否至少一个通道发送成功（调用方据此决定是否标记"已提醒"）。
 */
export async function notifyCard(title: string, mdLines: string[], template = "blue"): Promise<boolean> {
	// 通道1：应用机器人私聊
	const c = larkClient();
	const owner = getSetting("owner_open_id");
	if (c && owner) {
		try {
			const res = await c.im.message.create({
				params: { receive_id_type: "open_id" },
				data: {
					receive_id: owner,
					msg_type: "interactive",
					content: JSON.stringify(buildCard(title, mdLines, template)),
				},
			});
			if (res.code === 0) {
				log(`机器人私聊推送成功: ${title}`);
				return true;
			}
			log(`机器人私聊推送失败: ${res.code} ${res.msg}`);
		} catch (e) {
			log(`机器人私聊推送异常: ${e instanceof Error ? e.message : e}`);
		}
	}
	// 通道2：群自定义机器人 Webhook
	const webhook = config.notify.webhook;
	if (webhook) {
		try {
			const r = await fetch(webhook, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ msg_type: "interactive", card: buildCard(title, mdLines, template) }),
			});
			const body = await r.text();
			const j = JSON.parse(body);
			if (j.code === 0) {
				log(`Webhook 推送成功: ${title}`);
				return true;
			}
			log(`Webhook 推送失败: ${body.slice(0, 120)}`);
		} catch (e) {
			log(`Webhook 推送异常: ${e instanceof Error ? e.message : e}`);
		}
	}
	console.log(`[notify] 所有通道失败，仅打印：\n${title}\n${mdLines.join("\n")}`);
	return false;
}
