import * as db from "../src/db";

// 修复早前 bash-curl(GBK) 写入的乱码任务资料
const bad = db.listTaskResources().filter((r) => r.value.includes("�") || r.label.includes("�"));
for (const r of bad) {
	db.updateTaskResource(r.id, { value: "大海对接群", label: "会议对接" });
	console.log("fixed task_resource", r.id);
}
console.log("剩余乱码:", db.listTaskResources().filter((r) => r.value.includes("�")).length);
process.exit(0);
