import * as db from "../src/db";

const rows = db.db
	.prepare("SELECT id, title FROM tasks WHERE title LIKE '自动化测试任务%' OR title LIKE '调试任务%'")
	.all() as { id: number; title: string }[];
for (const r of rows) {
	db.deleteTask(r.id);
	console.log("deleted:", r.id, r.title);
}
console.log("剩余任务:", db.listTasks({ includeDone: true }).length);
process.exit(0);
