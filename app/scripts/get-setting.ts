import path from "node:path";
import dotenv from "dotenv";
import { ROOT } from "../src/paths";
import { getSetting, db } from "../src/db";
dotenv.config({ path: path.join(ROOT, ".env") });
console.log("owner_open_id =", getSetting("owner_open_id"));
console.log("LARK_APP_ID set:", !!process.env.LARK_APP_ID);
db.close();
process.exit(0);
