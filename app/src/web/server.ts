import { Hono } from "hono";
import { localDate } from "../paths";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import path from "node:path";
import * as db from "../db";
import { getCustom as safeCustom } from "../db";
import { APP_DIR } from "../paths";

export function startWeb(port: number) {
	const app = new Hono();

	app.get("/api/dashboard", (c) => {
		const projects = db.listProjects();
		const today = localDate();
		const soon = localDate(new Date(Date.now() + 7 * 86400_000));
		const tasks = db.listTasks({ includeDone: true });
		const summary = {
			projects: projects.length,
			dueSoon: tasks.filter((t) => !t.done && t.due_date && t.due_date >= today && t.due_date <= soon).length,
			overdue: tasks.filter((t) => !t.done && t.due_date && t.due_date < today).length,
		};
		const taskRes = db.listTaskResources();
		return c.json({
			summary,
			fields: db.listFields(),
			projects: projects.map((p) => ({
				...p,
				tasks: tasks
					.filter((t) => t.project_id === p.id)
					.map((t) => ({ ...t, resources: taskRes.filter((r) => r.task_id === t.id), custom: safeCustom(t) })),
				resources: db.listResources(p.id),
				history: db.listHistory(p.id),
			})),
		});
	});

	app.post("/api/tasks/:id/toggle", (c) => {
		const id = Number(c.req.param("id"));
		const t = db.getTask(id);
		if (!t) return c.json({ error: "not found" }, 404);
		const updated = db.updateTask(id, { done: !t.done });
		return c.json(updated);
	});

	app.post("/api/tasks/:id/status", async (c) => {
		const id = Number(c.req.param("id"));
		const body = await c.req.json<{ status?: string }>().catch(() => ({}) as { status?: string });
		const status = body.status;
		if (!status || !["todo", "doing", "done"].includes(status)) return c.json({ error: "invalid status" }, 400);
		const t = db.getTask(id);
		if (!t) return c.json({ error: "not found" }, 404);
		const updated = db.updateTask(id, { status, done: status === "done" ? true : false });
		return c.json(updated);
	});

	// 手动新建任务
	app.post("/api/tasks", async (c) => {
		const b = await c.req.json<any>().catch(() => null);
		if (!b?.title || !b?.project_id) return c.json({ error: "title 与 project_id 必填" }, 400);
		for (const k of ["due_date", "start_date"]) if (b[k] && !/^\d{4}-\d{2}-\d{2}$/.test(b[k])) return c.json({ error: `${k} 需 YYYY-MM-DD` }, 400);
		const t = db.createTask({
			project_id: Number(b.project_id),
			title: String(b.title),
			due_date: b.due_date || null,
			start_date: b.start_date || null,
			description: b.description || "",
			is_milestone: !!b.is_milestone,
			priority: ["P0", "P1", "P2", "P3"].includes(b.priority) ? b.priority : "P3",
			parent_id: b.parent_id ? Number(b.parent_id) : null,
		});
		if (b.status && ["todo", "doing", "done"].includes(b.status)) db.updateTask(t.id, { status: b.status, done: b.status === "done" });
		return c.json(db.getTask(t.id));
	});

	// 编辑任务
	app.post("/api/tasks/:id/update", async (c) => {
		const id = Number(c.req.param("id"));
		const b = await c.req.json<any>().catch(() => null);
		if (!db.getTask(id)) return c.json({ error: "not found" }, 404);
		const patch: db.UpdatePatch = {};
		if (b.title !== undefined) patch.title = String(b.title);
		if (b.description !== undefined) patch.description = String(b.description);
		if (b.due_date !== undefined) patch.due_date = b.due_date ? String(b.due_date) : null;
		if (b.start_date !== undefined) patch.start_date = b.start_date ? String(b.start_date) : null;
		if (b.priority !== undefined && ["P0", "P1", "P2", "P3"].includes(b.priority)) patch.priority = b.priority;
		if (b.parent_id !== undefined) patch.parent_id = b.parent_id ? Number(b.parent_id) : null;
		const t = db.updateTask(id, patch);
		return c.json(t);
	});

	// 删除项目（连同任务/资料/历史）
	app.delete("/api/projects/:id", (c) => {
		const id = Number(c.req.param("id"));
		const okDeleted = db.deleteProject(id);
		return okDeleted ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
	});

	// 任务资料
	app.post("/api/tasks/:id/resources", async (c) => {
		const id = Number(c.req.param("id"));
		const b = await c.req.json<any>().catch(() => null);
		if (!db.getTask(id)) return c.json({ error: "task not found" }, 404);
		if (!b?.value || !["wechat_group", "link", "note"].includes(b.type || "")) return c.json({ error: "type(wechat_group/link/note) 与 value 必填" }, 400);
		db.addTaskResource(id, b.type, String(b.value), b.label || "");
		return c.json({ ok: true });
	});

	app.post("/api/task-resources/:rid/update", async (c) => {
		const b = await c.req.json<any>().catch(() => null);
		if (!b?.value) return c.json({ error: "value 必填" }, 400);
		db.updateTaskResource(Number(c.req.param("rid")), { type: b.type, value: String(b.value), label: b.label ?? "" });
		return c.json({ ok: true });
	});
	app.delete("/api/task-resources/:rid", (c) => {
		return c.json({ ok: db.deleteTaskResource(Number(c.req.param("rid"))) });
	});

	// 自定义字段
	app.get("/api/fields", (c) => c.json(db.listFields()));
	app.post("/api/fields", async (c) => {
		const b = await c.req.json<any>().catch(() => null);
		try {
			return c.json(db.createField(String(b?.name || ""), String(b?.type || "text"), String(b?.options || "")));
		} catch (e) {
			return c.json({ error: e instanceof Error ? e.message : "invalid" }, 400);
		}
	});
	app.delete("/api/fields/:id", (c) => c.json({ ok: db.deleteField(Number(c.req.param("id"))) }));

	// 任务自定义字段值
	app.post("/api/tasks/:id/custom", async (c) => {
		const id = Number(c.req.param("id"));
		const b = await c.req.json<Record<string, string>>().catch(() => null);
		if (!b) return c.json({ error: "invalid body" }, 400);
		try {
			db.setCustom(id, b);
			return c.json(db.getTask(id));
		} catch (e) {
			return c.json({ error: e instanceof Error ? e.message : "invalid" }, 400);
		}
	});

	// 项目资料增删
	app.post("/api/projects/:id/resources", async (c) => {
		const id = Number(c.req.param("id"));
		const b = await c.req.json<any>().catch(() => null);
		if (!b?.value || !["wechat_group", "link", "note"].includes(b.type || "")) return c.json({ error: "type 与 value 必填" }, 400);
		db.addResource(id, b.type, String(b.value), b.label || "");
		return c.json({ ok: true });
	});
	app.post("/api/resources/:rid/update", async (c) => {
		const b = await c.req.json<any>().catch(() => null);
		if (!b?.value) return c.json({ error: "value 必填" }, 400);
		db.updateResource(Number(c.req.param("rid")), { type: b.type, value: String(b.value), label: b.label ?? "" });
		return c.json({ ok: true });
	});
	app.delete("/api/resources/:rid", (c) => c.json({ ok: db.deleteResource(Number(c.req.param("rid"))) }));

	// 新建项目
	app.post("/api/projects", async (c) => {
		const b = await c.req.json<any>().catch(() => null);
		if (!b?.name) return c.json({ error: "name 必填" }, 400);
		if (db.findProject(String(b.name))) return c.json({ error: "同名项目已存在" }, 400);
		return c.json(db.createProject(String(b.name), b.description || "", b.end_date || null));
	});

	// 编辑项目（目标/状态/截止日）
	app.post("/api/projects/:id/update", async (c) => {
		const id = Number(c.req.param("id"));
		const b = await c.req.json<any>().catch(() => null);
		const patch: { name?: string; description?: string; status?: string; end_date?: string | null } = {};
		if (b.name !== undefined) patch.name = String(b.name);
		if (b.description !== undefined) patch.description = String(b.description);
		if (b.status !== undefined && ["active", "done", "paused", "archived"].includes(b.status)) patch.status = b.status;
		if (b.end_date !== undefined) patch.end_date = b.end_date ? String(b.end_date) : null;
		const p = db.updateProject(id, patch);
		if (!p) return c.json({ error: "not found" }, 404);
		return c.json(p);
	});

	// 删除任务
	app.delete("/api/tasks/:id", (c) => {
		const id = Number(c.req.param("id"));
		if (!db.getTask(id)) return c.json({ error: "not found" }, 404);
		db.deleteTask(id);
		return c.json({ ok: true });
	});

	app.use("/*", serveStatic({ root: path.join(APP_DIR, "src/web/public").replace(/\\/g, "/") }));

	serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
		console.log(`看板: http://127.0.0.1:${info.port}`);
	});
	return app;
}
