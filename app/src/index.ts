process.env.TZ = "Asia/Shanghai";

import { startWeb } from "./web/server";
import { config } from "./config";
import { startLark } from "./lark";
import { runCheck } from "./check";
import { startTimers, stopAllTimers } from "./timers";
import { db } from "./db";
import { log } from "./paths";
import cron from "node-cron";

const PORT = config.app.port;

startWeb(PORT);
startLark();
startTimers();

// 每天 9:00 提醒 + 备份
cron.schedule(config.app.remindCron, () => {
	log("定时任务触发：check");
	runCheck().catch((e) => log(`check 失败: ${e instanceof Error ? e.message : e}`));
});

log(`mypm v2 启动完成（看板 http://127.0.0.1:${PORT}，Lark 桥 + 定时提醒 ${config.app.remindCron}）`);

// 启动时顺带跑一次检查（跳过备份），把窗口内任务尽快提醒到
runCheck({ withBackup: false }).catch((e) => log(`启动检查失败: ${e instanceof Error ? e.message : e}`));

// 优雅退出：停调度 + 关库（better-sqlite3 不 close 在 Windows 触发 libuv 断言弹窗）
let exiting = false;
function shutdown(sig: string) {
	if (exiting) return;
	exiting = true;
	log(`收到 ${sig}，正在退出…`);
	try {
		stopAllTimers();
	} catch {
		/* 退出路径尽力而为 */
	}
	try {
		if (db.open) db.close();
	} catch {
		/* 已关闭则忽略 */
	}
	process.exit(0);
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
