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

	app.use("/*", serveStatic({ root: path.join(APP_DIR, "src/web/public").replace(/\\/g, "/") }));

	serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
		console.log(`看板: http://127.0.0.1:${info.port}`);
	});
	return app;
}
