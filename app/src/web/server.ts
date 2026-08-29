import { Hono } from "hono";
import { localDate } from "../paths";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import path from "node:path";
import * as db from "../db";
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
		return c.json({
			summary,
			projects: projects.map((p) => ({
				...p,
				tasks: tasks.filter((t) => t.project_id === p.id),
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
		if (b.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.due_date)) return c.json({ error: "due_date 需 YYYY-MM-DD" }, 400);
		const t = db.createTask({
			project_id: Number(b.project_id),
			title: String(b.title),
			due_date: b.due_date || null,
			description: b.description || "",
			is_milestone: !!b.is_milestone,
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
		const t = db.updateTask(id, patch);
		return c.json(t);
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
