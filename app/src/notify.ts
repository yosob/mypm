import * as lark from "@larksuiteoapi/node-sdk";
import { log } from "./paths";
import { getSetting } from "./db";

let client: lark.Client | null = null;
function larkClient(): lark.Client | null {
	// 运行时读取（模块顶层的 process.env 可能早于 dotenv.config 执行）
	const appId = process.env.LARK_APP_ID || "";
	const appSecret = process.env.LARK_APP_SECRET || "";
	if (!appId || !appSecret) return null;
	if (!client) client = new lark.Client({ appId, appSecret, domain: lark.Domain.Lark });
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
 */
export async function notifyCard(title: string, mdLines: string[], template = "blue") {
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
			if (res.code === 0) return log(`机器人私聊推送成功: ${title}`);
			log(`机器人私聊推送失败: ${res.code} ${res.msg}`);
		} catch (e) {
			log(`机器人私聊推送异常: ${e instanceof Error ? e.message : e}`);
		}
	}
	// 通道2：群自定义机器人 Webhook
	const webhook = process.env.FEISHU_WEBHOOK;
	if (webhook) {
		try {
			const r = await fetch(webhook, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ msg_type: "interactive", card: buildCard(title, mdLines, template) }),
			});
			const body = await r.text();
			const j = JSON.parse(body);
			if (j.code === 0) return log(`Webhook 推送成功: ${title}`);
			log(`Webhook 推送失败: ${body.slice(0, 120)}`);
		} catch (e) {
			log(`Webhook 推送异常: ${e instanceof Error ? e.message : e}`);
		}
	}
	console.log(`[notify] 所有通道失败，仅打印：\n${title}\n${mdLines.join("\n")}`);
}
