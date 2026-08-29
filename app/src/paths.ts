import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** 项目根目录（mypm/），所有文件只放在本目录内 */
export const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
export const APP_DIR = path.join(ROOT, "app");
export const DATA_DIR = path.join(APP_DIR, "data");
export const BACKUP_DIR = path.join(ROOT, "backups");
export const LOG_DIR = path.join(ROOT, "logs");
export const DB_PATH = path.join(DATA_DIR, "mypm.db");
export const LOG_FILE = path.join(LOG_DIR, "mypm.log");

for (const d of [DATA_DIR, BACKUP_DIR, LOG_DIR]) fs.mkdirSync(d, { recursive: true });

/** 轻量日志：console + 文件 append */
export function log(msg: string) {
	const line = `[${new Date().toISOString()}] ${msg}`;
	console.log(line);
	fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
}
