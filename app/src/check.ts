import * as db from "./db";
import { localDate } from "./paths";
import { config } from "./config";
import { backup } from "./db";
import { notifyCard } from "./notify";
import { log } from "./paths";

/** 本地时间戳 YYYY-MM-DD HH:mm（记录提醒运行遥测用） */
function localStamp(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 记录本次检查结果（settings kv，供 system prompt 注入——AI 据此回答"怎么没提醒我"） */
function recordCheck(rec: { ok: boolean; count?: number; reason?: string; note?: string }) {
	db.setSetting("last_check", JSON.stringify({ at: localStamp(), ...rec }));
}

function taskLine(t: db.Task, today: string, strong: boolean): string {
	const left = Math.round((Date.parse(t.due_date!) - Date.parse(today)) / 86400_000);
	const when = left < 0 ? `**已逾期 ${-left} 天**` : left === 0 ? "**今天到期**" : `还剩 ${left} 天`;
	return `${strong ? "❗" : "•"} **${t.project_name}** ｜ ${t.title} ｜ 截止 ${t.due_date} ｜ ${when}`;
}

/**
 * 每日提醒（remindCron 时刻触发；runCheck 可手动重复执行，同日不重发）：
 * - 逾期 / ≤ remindHighlightDays 天：重点档（❗ + 橙/红卡片）
 * - 其余 ≤ remindDays 天：普通档
 * 每个任务每天提醒一次，直到完成或移出窗口。
 * 发送成功才标记"已提醒"——通知通道失败当日不丢，下次检查自动重试。
 */
export async function runCheck(opts: { withBackup?: boolean; notify?: typeof notifyCard } = {}) {
	const notify = opts.notify ?? notifyCard;
	const today = localDate();
	const window = config.app.remindDays;
	const highlight = config.app.remindHighlightDays;

	const overdue: string[] = [];
	const soon: string[] = [];
	const week: string[] = [];
	const fresh: db.Task[] = []; // 本次待提醒的任务（发送成功后才标记）

	for (const t of db.listTasks({ dueWithinDays: window })) {
		if (!t.due_date) continue;
		if (db.alreadyRemindedToday(t.id, today)) continue; // 同日已提醒（含本次启动前发过）
		fresh.push(t);
		const left = Math.round((Date.parse(t.due_date) - Date.parse(today)) / 86400_000);
		if (left < 0) overdue.push(taskLine(t, today, true));
		else if (left <= highlight) soon.push(taskLine(t, today, true));
		else week.push(taskLine(t, today, false));
	}

	if (overdue.length || soon.length || week.length) {
		const parts: string[] = [];
		if (overdue.length) parts.push("**🔴 已逾期（请尽快处理）**\n" + overdue.join("\n"));
		if (soon.length) parts.push(`**🟠 ${highlight} 天内到期（重点）**\n` + soon.join("\n"));
		if (week.length) parts.push(`**⚪ ${window} 天内到期**\n` + week.join("\n"));
		const template = overdue.length ? "red" : soon.length ? "orange" : "blue";
		let sent = false;
		try {
			sent = await notify(`📋 每日项目提醒（${today}）`, parts, template);
		} catch (e) {
			log(`提醒发送异常: ${e instanceof Error ? e.message : e}`);
			sent = false;
		}
		if (sent) {
			for (const t of fresh) db.markRemindedToday(t.id, today);
			log(`提醒已发送并标记：逾期${overdue.length} 重点${soon.length} 普通${week.length}`);
			recordCheck({ ok: true, count: fresh.length });
		} else {
			log("提醒发送失败（所有通道不可用），本次不标记，下次检查自动重试");
			recordCheck({ ok: false, reason: "通知通道全部失败" });
		}
	} else {
		log("今日提醒卡片已发过或暂无窗口内任务");
		recordCheck({ ok: true, count: 0, note: "已提醒过或无窗口内任务" });
	}

	if (opts.withBackup !== false) {
		try {
			backup();
			log("每日备份完成");
		} catch (e) {
			log(`备份失败: ${e instanceof Error ? e.message : e}`);
		}
	}
}
