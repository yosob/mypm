process.env.TZ = "Asia/Shanghai";
import { runCheck } from "./check";
import { db } from "./db";
await runCheck();
db.close();
process.exit(0);
