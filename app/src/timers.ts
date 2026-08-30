import cron, { type ScheduledTask } from "node-cron";
import * as db from "./db";
import { notifyCard } from "./notify";
import { log } from "./paths";

/**
 * Agent 定时提醒调度器：
 * - 一次性（run_at）：每分钟 tick 检查到点即发，发完置 fired
 * - 周期性（cron 表达式）：动态注册 node-cron 任务，进程内存 Map 管理，
 *   重启时从库中恢复 active 的周期任务；跨错过周期不补发（next 自然对齐）
 */

const cronJobs = new Map<number, ScheduledTask>();

function fire(t: db.Timer, periodic: boolean) {
	if (periodic) {
		// 双保险：已取消/已结束的周期任务即使 cron 仍在调度也自清不触发
		const cur = db.getTimer(t.id);
		if (!cur || cur.status !== "active") {
			stopCron(t.id);
			log(`定时器 #${t.id} 已非 active，停止调度`);
			return;
		}
	}
	notifyCard(`⏰ ${t.title}`, [periodic ? "（周期提醒）" : "（一次性提醒）"]).catch(() => {});
	if (periodic) db.touchTimerRun(t.id);
	else db.markTimerFired(t.id);
	log(`定时提醒触发 #${t.id}「${t.title}」${periodic ? "cron=" + t.cron : t.run_at}`);
}

/** 启动：恢复周期任务 + 启动分钟级 tick（管一次性） */
let minuteTask: ScheduledTask | null = null;
export function startTimers() {
	for (const t of db.listTimers(true)) {
		if (t.cron) scheduleCron(t);
	}
	minuteTask = cron.schedule("* * * * *", () => tickOneshots());
	log(`定时器就绪：周期 ${cronJobs.size} 个，一次性由每分钟 tick 驱动`);
}

/** 停止全部调度（优雅退出用） */
export function stopAllTimers() {
	for (const job of cronJobs.values()) job.stop();
	cronJobs.clear();
	minuteTask?.stop();
	minuteTask = null;
}

/** 当前内存中的周期任务数（测试探针） */
export function cronCount(): number {
	return cronJobs.size;
}

export function scheduleCron(t: db.Timer) {
	if (!t.cron || !cron.validate(t.cron)) {
		log(`定时器 #${t.id} cron 表达式非法: ${t.cron}`);
		return;
	}
	stopCron(t.id);
	const job = cron.schedule(t.cron, () => fire(t, true));
	cronJobs.set(t.id, job);
}

export function stopCron(id: number) {
	cronJobs.get(id)?.stop();
	cronJobs.delete(id);
}

function nowLocal(): { minute: string; stamp: string } {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	return { stamp: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`, minute: `${p(d.getHours())}:${p(d.getMinutes())}` };
}

export function tickOneshotsForTest() {
	return tickOneshots();
}
function tickOneshots() {
	const { stamp, minute } = nowLocal();
	for (const t of db.listTimers(true)) {
		if (t.cron || !t.run_at) continue;
		if (t.run_at <= stamp) {
			// 已到点（含错过的最近时刻）：立即补发一次
			fire(t, false);
		}
	}
	void minute;
}
