import * as db from "../src/db";

// 冒烟测试：CRUD + pending 两段式 + 备份
const proj = db.createProject("__测试项目__");
console.log("createProject:", proj.id, proj.name);

const t1 = db.createTask({ project_id: proj.id, title: "任务A", due_date: "2026-09-05" });
const t2 = db.createTask({ project_id: proj.id, title: "里程碑B", due_date: "2026-09-15", is_milestone: true });
console.log("tasks:", db.listTasks({ projectId: proj.id }).map((t) => `${t.id}:${t.title}`).join(", "));

console.log("模糊匹配 '测试':", db.findProject("测试")?.name);

db.updateTask(t1.id, { done: true });
console.log("完成后 includeDone=false 数量:", db.listTasks({ projectId: proj.id }).length, "(应为1)");

db.addResource(proj.id, "wechat_group", "XX群", "");
console.log("resources:", db.listResources(proj.id).length);

const pid = db.savePending({
	items: [{ project: "__测试项目2__", is_new: true, title: "新任务", due_date: null, is_milestone: false, description: "" }],
	resources: [],
	summaries: [{ project: "__测试项目2__", summary: "测试摘要" }],
});
console.log("applyPending:", db.applyPending(pid));
console.log("重复应用:", db.applyPending(pid).ok, "(应为false)");

db.backup();
console.log("backup ok");

// 清理测试数据
db.db.exec("DELETE FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE name LIKE '__测试%')");
db.db.exec("DELETE FROM resources WHERE project_id IN (SELECT id FROM projects WHERE name LIKE '__测试%')");
db.db.exec("DELETE FROM history WHERE project_id IN (SELECT id FROM projects WHERE name LIKE '__测试%')");
db.db.exec("DELETE FROM projects WHERE name LIKE '__测试%'");
db.db.exec("DELETE FROM pending_updates");
console.log("清理完成，剩余项目:", db.listProjects().length);
