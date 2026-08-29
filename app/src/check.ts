import * as db from "./db";
import { localDate } from "./paths";
import { backup } from "./db";
import { notifyCard } from "./notify";
import { log } from "./paths";

/**
 * 每日检查：进入提醒窗口的任务提醒一次（kind=window），
 * 逾期当天再提醒一次（kind=overdue）。已提醒过的不再重复。
 */
export async function runCheck(opts: { withBackup?: boolean } = {}) {
	const today = localDate();
	const days = Number(process.env.REMIND_DAYS || 7);
	const horizon = localDate(new Date(Date.now() + days * 86400_000));

	const tasks = db.listTasks({ dueWithinDays: days }); // 含逾期（due <= today+N）
	const windowLines: string[] = [];
	const overdueLines: string[] = [];

	for (const t of tasks) {
		if (!t.due_date) continue;
		if (t.due_date < today) {
			if (!db.alreadyReminded(t.id, "overdue") && !db.alreadyReminded(t.id, "window")) {
				// 只有从未提醒过且已直接逾期的，按逾期提醒
				overdueLines.push(`**${t.project_name}** ｜ ${t.title} ｜ 原截止 ${t.due_date} ｜ **已逾期**`);
				db.markReminded(t.id, "overdue");
			}
			continue;
		}
		if (t.due_date <= horizon && !db.alreadyReminded(t.id, "window")) {
			const left = Math.round((Date.parse(t.due_date) - Date.parse(today)) / 86400_000);
			const status = left === 0 ? "⚠️ **今天到期**" : `还剩 ${left} 天`;
			windowLines.push(`**${t.project_name}** ｜ ${t.title} ｜ 截止 ${t.due_date} ｜ ${status}`);
			db.markReminded(t.id, "window");
		}
	}

	// 逾期日当天补一次提醒（曾按 window 提醒过、现在逾期且未按 overdue 提醒过）
	const overdue2 = db.listTasks({ includeDone: false }).filter((t) => t.due_date && t.due_date < today);
	for (const t of overdue2) {
		if (!db.alreadyReminded(t.id, "overdue")) {
			overdueLines.push(`**${t.project_name}** ｜ ${t.title} ｜ 原截止 ${t.due_date} ｜ **已逾期**`);
			db.markReminded(t.id, "overdue");
		}
	}

	const lines = [...overdueLines, ...windowLines];
	if (lines.length) await notifyCard(`📋 项目提醒（${today}）`, lines, overdueLines.length ? "red" : "blue");
	else log("今日无需提醒的任务");

	if (opts.withBackup !== false) {
		try {
			backup();
			log("每日备份完成");
		} catch (e) {
			log(`备份失败: ${e instanceof Error ? e.message : e}`);
		}
	}
}
