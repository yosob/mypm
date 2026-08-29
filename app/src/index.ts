import path from "node:path";
import dotenv from "dotenv";
import { ROOT } from "./paths";

process.env.TZ = "Asia/Shanghai";
dotenv.config({ path: path.join(ROOT, ".env") });

import { startWeb } from "./web/server";
import { startLark } from "./lark";
import { runCheck } from "./check";
import { log } from "./paths";
import cron from "node-cron";

const PORT = Number(process.env.PORT || 8787);

startWeb(PORT);
startLark();

// 每天 9:00 提醒 + 备份
cron.schedule("0 9 * * *", () => {
	log("定时任务触发：check");
	runCheck().catch((e) => log(`check 失败: ${e instanceof Error ? e.message : e}`));
});

log(`mypm v2 启动完成（看板 http://127.0.0.1:${PORT}，Lark 桥 + 每日9点提醒）`);

// 启动时顺带跑一次检查（跳过备份），把窗口内任务尽快提醒到
runCheck({ withBackup: false }).catch((e) => log(`启动检查失败: ${e instanceof Error ? e.message : e}`));
