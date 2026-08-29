import path from "node:path";
import dotenv from "dotenv";
import { ROOT } from "./paths";
import { runCheck } from "./check";
import { db } from "./db";

process.env.TZ = "Asia/Shanghai";
dotenv.config({ path: path.join(ROOT, ".env") });
await runCheck();
db.close();
process.exit(0);
