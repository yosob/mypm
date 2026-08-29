import Database from "better-sqlite3";
import { localDate } from "./paths";
import fs from "node:fs";
import path from "node:path";
import { DB_PATH, BACKUP_DIR, log } from "./paths";

process.env.TZ = "Asia/Shanghai";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects(
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks(
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  parent_id INTEGER REFERENCES tasks(id),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  due_date TEXT,
  is_milestone INTEGER DEFAULT 0,
  done INTEGER DEFAULT 0,
  done_at TEXT,
  priority TEXT DEFAULT 'P3',
  status TEXT DEFAULT 'todo',
  recur_rule TEXT,
  depends_on TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS resources(
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL,           -- wechat_group | link | file | note
  value TEXT NOT NULL,
  label TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS history(
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  date TEXT NOT NULL,
  summary TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_updates(
  id INTEGER PRIMARY KEY,
  payload_json TEXT NOT NULL,
  status TEXT DEFAULT 'pending',  -- pending | applied | discarded
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reminders(
  task_id INTEGER NOT NULL,
  kind TEXT NOT NULL,             -- window | overdue
  date TEXT NOT NULL,
  PRIMARY KEY (task_id, kind)
);
CREATE TABLE IF NOT EXISTS agent_sessions(
  chat_key TEXT PRIMARY KEY,
  messages_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_resources(
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  type TEXT NOT NULL,            -- wechat_group | link | note
  value TEXT NOT NULL,
  label TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** 旧库平滑迁移：新增列（参照飞书模板：任务开始时间、项目截止时间） */
function migrate(db: Database.Database) {
	const addCol = (table: string, col: string, ddl: string) => {
		const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
		if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
	};
	addCol("tasks", "start_date", "start_date TEXT");
	addCol("projects", "end_date", "end_date TEXT");
}

export type Project = {
	id: number;
	name: string;
	description: string;
	status: string; // active | done | paused | archived
	created_at: string;
	end_date: string | null;
};
export type Task = {
	id: number;
	project_id: number;
	project_name?: string;
	parent_id: number | null;
	title: string;
	description: string;
	due_date: string | null;
	start_date: string | null;
	is_milestone: number;
	done: number;
	done_at: string | null;
	priority: string;
	status: string;
	created_at: string;
};
export type Resource = { id: number; project_id: number; type: string; value: string; label: string };
export type HistoryItem = { id: number; project_id: number; date: string; summary: string };

/** 待应用提取结果的结构（propose_updates 产生） */
export type ExtractedUpdate = {
	items: {
		project: string;
		is_new: boolean;
		title: string;
		start_date: string | null;
		due_date: string | null;
		is_milestone: boolean;
		priority: string;
		description: string;
	}[];
	resources: { project: string; type: string; value: string; label: string }[];
	summaries: { project: string; summary: string }[];
};

function today(): string {
	return localDate();
}

function openDb(): Database.Database {
	// 完整性检查，失败则从最近备份恢复（DECISIONS #1）
	let needRestore = false;
	if (fs.existsSync(DB_PATH)) {
		const probe = new Database(DB_PATH);
		const ok = probe.pragma("integrity_check", { simple: true }) === "ok";
		probe.close();
		if (!ok) {
			needRestore = true;
			fs.renameSync(DB_PATH, `${DB_PATH}.corrupt-${Date.now()}`);
		}
	}
	if (needRestore) {
		const latest = latestBackup();
		if (latest) {
			fs.copyFileSync(latest, DB_PATH);
			log(`db 损坏，已从备份恢复: ${path.basename(latest)}`);
		} else {
			log("db 损坏且无备份，重建空库");
		}
	}
	const db = new Database(DB_PATH);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");
	db.exec(SCHEMA);
	migrate(db);
	return db;
}

function latestBackup(): string | null {
	const files = fs
		.readdirSync(BACKUP_DIR)
		.filter((f) => /^mypm-\d{8}\.db$/.test(f))
		.sort();
	return files.length ? path.join(BACKUP_DIR, files[files.length - 1]) : null;
}

export function backup() {
	const dest = path.join(BACKUP_DIR, `mypm-${today().replace(/-/g, "")}.db`);
	if (!fs.existsSync(dest)) {
		db.prepare("VACUUM INTO ?").run(dest);
	}
	// 保留最近 14 份
	const files = fs.readdirSync(BACKUP_DIR).filter((f) => /^mypm-\d{8}\.db$/.test(f)).sort();
	for (const f of files.slice(0, Math.max(0, files.length - 14))) fs.unlinkSync(path.join(BACKUP_DIR, f));
}

export const db = openDb();

// ---------- projects ----------

export function listProjects(): Project[] {
	return db.prepare("SELECT * FROM projects WHERE status != 'archived' ORDER BY name").all() as Project[];
}

export function findProject(nameLike: string): Project | undefined {
	return (
		db.prepare("SELECT * FROM projects WHERE status != 'archived' AND name = ?").get(nameLike) as Project | undefined ??
		(db.prepare("SELECT * FROM projects WHERE status != 'archived' AND name LIKE ? ORDER BY LENGTH(name) LIMIT 1").get(`%${nameLike}%`) as
			| Project
			| undefined)
	);
}

export function createProject(name: string, description = "", end_date: string | null = null): Project {
	const info = db.prepare("INSERT INTO projects(name, description, end_date, created_at) VALUES(?,?,?,?)").run(name, description, end_date, today());
	return db.prepare("SELECT * FROM projects WHERE id=?").get(info.lastInsertRowid) as Project;
}

export function updateProject(id: number, patch: { name?: string; description?: string; status?: string; end_date?: string | null }): Project | undefined {
	const p = db.prepare("SELECT * FROM projects WHERE id=?").get(id) as Project | undefined;
	if (!p) return undefined;
	db.prepare("UPDATE projects SET name=?, description=?, status=?, end_date=? WHERE id=?").run(
		patch.name ?? p.name,
		patch.description ?? p.description,
		patch.status ?? p.status,
		patch.end_date !== undefined ? patch.end_date : p.end_date,
		id,
	);
	return db.prepare("SELECT * FROM projects WHERE id=?").get(id) as Project;
}

export function deleteProject(id: number): boolean {
	const del = db.transaction(() => {
		db.prepare("DELETE FROM reminders WHERE task_id IN (SELECT id FROM tasks WHERE project_id=?)").run(id);
		db.prepare("DELETE FROM tasks WHERE project_id=?").run(id);
		db.prepare("DELETE FROM resources WHERE project_id=?").run(id);
		db.prepare("DELETE FROM history WHERE project_id=?").run(id);
		const n = db.prepare("DELETE FROM projects WHERE id=?").run(id).changes;
		return n > 0;
	});
	return del();
}

export function setDescription(projectId: number, description: string) {
	db.prepare("UPDATE projects SET description=? WHERE id=?").run(description, projectId);
}

// ---------- tasks ----------

export type TaskFilter = { projectId?: number; dueWithinDays?: number; includeDone?: boolean };

export function listTasks(filter: TaskFilter = {}): Task[] {
	const conds: string[] = ["p.status != 'archived'"];
	const args: unknown[] = [];
	if (filter.projectId) {
		conds.push("t.project_id = ?");
		args.push(filter.projectId);
	}
	if (!filter.includeDone) conds.push("t.done = 0");
	if (filter.dueWithinDays !== undefined) {
		conds.push("(t.due_date IS NOT NULL AND t.due_date <= date('now', 'localtime', ?))");
		args.push(`+${filter.dueWithinDays} day`);
	}
	return db
		.prepare(
			`SELECT t.*, p.name AS project_name FROM tasks t JOIN projects p ON p.id=t.project_id
			 WHERE ${conds.join(" AND ")} ORDER BY p.name, t.due_date IS NULL, t.due_date, t.id`,
		)
		.all(...args) as Task[];
}

export function getTask(id: number): Task | undefined {
	return db
		.prepare("SELECT t.*, p.name AS project_name FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?")
		.get(id) as Task | undefined;
}

export function createTask(input: {
	project_id: number;
	title: string;
	due_date?: string | null;
	start_date?: string | null;
	description?: string;
	is_milestone?: boolean;
	priority?: string;
	parent_id?: number | null;
}): Task {
	const info = db
		.prepare(
			`INSERT INTO tasks(project_id, parent_id, title, description, due_date, start_date, is_milestone, priority, created_at)
			 VALUES(?,?,?,?,?,?,?,?,?)`,
		)
		.run(
			input.project_id,
			input.parent_id ?? null,
			input.title,
			input.description ?? "",
			input.due_date ?? null,
			input.start_date ?? null,
			input.is_milestone ? 1 : 0,
			input.priority ?? "P3",
			today(),
		);
	return getTask(info.lastInsertRowid as number)!;
}

export type UpdatePatch = {
	due_date?: string | null;
	start_date?: string | null;
	done?: boolean;
	title?: string;
	description?: string;
	status?: string;
	priority?: string;
	parent_id?: number | null;
};

export function updateTask(
	id: number,
	patch: UpdatePatch,
): Task | undefined {
	const t = getTask(id);
	if (!t) return undefined;
	const due = patch.due_date !== undefined ? patch.due_date : t.due_date;
	const startDate = patch.start_date !== undefined ? patch.start_date : t.start_date;
	const done = patch.done !== undefined ? (patch.done ? 1 : 0) : t.done;
	const title = patch.title ?? t.title;
	const desc = patch.description ?? t.description;
	let status = patch.status ?? t.status;
	if (patch.done !== undefined) status = patch.done ? "done" : status === "done" ? "todo" : status;
	const priority = patch.priority ?? t.priority;
	const parentId = patch.parent_id !== undefined ? patch.parent_id : t.parent_id;
	db.prepare(
		"UPDATE tasks SET due_date=?, start_date=?, done=?, done_at=?, title=?, description=?, status=?, priority=?, parent_id=? WHERE id=?",
	).run(due, startDate, done, done ? today() : null, title, desc, status, priority, parentId, id);
	return getTask(id);
}

export function deleteTask(id: number): boolean {
	return db.prepare("DELETE FROM tasks WHERE id=?").run(id).changes > 0;
}

// ---------- resources / history ----------

export function addResource(projectId: number, type: string, value: string, label = "") {
	db.prepare("INSERT INTO resources(project_id, type, value, label) VALUES(?,?,?,?)").run(projectId, type, value, label);
}

export function listResources(projectId?: number): Resource[] {
	if (projectId) return db.prepare("SELECT * FROM resources WHERE project_id=? ORDER BY id").all(projectId) as Resource[];
	return db.prepare("SELECT * FROM resources ORDER BY project_id, id").all() as Resource[];
}

export function addHistory(projectId: number, summary: string, date?: string) {
	db.prepare("INSERT INTO history(project_id, date, summary) VALUES(?,?,?)").run(projectId, date ?? today(), summary);
}

export function listHistory(projectId: number): HistoryItem[] {
	return db.prepare("SELECT * FROM history WHERE project_id=? ORDER BY date DESC, id DESC").all(projectId) as HistoryItem[];
}

// ---------- task resources ----------

export function addTaskResource(taskId: number, type: string, value: string, label = "") {
	db.prepare("INSERT INTO task_resources(task_id, type, value, label) VALUES(?,?,?,?)").run(taskId, type, value, label);
}

export function listTaskResources(taskId?: number): (Resource & { task_id: number })[] {
	if (taskId) return db.prepare("SELECT * FROM task_resources WHERE task_id=? ORDER BY id").all(taskId) as any;
	return db.prepare("SELECT * FROM task_resources ORDER BY task_id, id").all() as any;
}

export function deleteTaskResource(id: number): boolean {
	return db.prepare("DELETE FROM task_resources WHERE id=?").run(id).changes > 0;
}

// ---------- pending updates（提取→确认 两段式） ----------

export function savePending(payload: ExtractedUpdate): number {
	const info = db
		.prepare("INSERT INTO pending_updates(payload_json, created_at) VALUES(?,?)")
		.run(JSON.stringify(payload), new Date().toISOString());
	return Number(info.lastInsertRowid);
}

export function getPending(id: number): { id: number; payload: ExtractedUpdate; status: string } | undefined {
	const row = db.prepare("SELECT * FROM pending_updates WHERE id=?").get(id) as
		| { id: number; payload_json: string; status: string }
		| undefined;
	if (!row) return undefined;
	return { id: row.id, payload: JSON.parse(row.payload_json), status: row.status };
}

export function discardPending(id: number): boolean {
	return db.prepare("UPDATE pending_updates SET status='discarded' WHERE id=? AND status='pending'").run(id).changes > 0;
}

/** 事务应用提取结果；返回给人类看的结果文本 */
export function applyPending(id: number): { ok: boolean; text: string } {
	const pending = getPending(id);
	if (!pending) return { ok: false, text: `更新 #${id} 不存在` };
	if (pending.status !== "pending") return { ok: false, text: `更新 #${id} 已${pending.status === "applied" ? "应用过" : "被丢弃"}` };

	const p = pending.payload;
	const lines: string[] = [];
	const apply = db.transaction(() => {
		for (const it of p.items) {
			let proj = findProject(it.project);
			if (!proj) {
				proj = createProject(it.project);
				lines.push(`新建项目「${proj.name}」`);
			}
			const t = createTask({
				project_id: proj.id,
				title: it.title,
				start_date: it.start_date ?? null,
				due_date: it.due_date,
				description: it.description,
				is_milestone: it.is_milestone,
				priority: it.priority,
			});
			lines.push(
				`${proj.name} → ${it.is_milestone ? "◆" : ""}${t.title}${t.start_date ? `（${t.start_date}~${t.due_date ?? "?"}）` : t.due_date ? `（截止 ${t.due_date}）` : ""} [id=${t.id}]`,
			);
		}
		for (const r of p.resources) {
			const proj = findProject(r.project);
			if (proj) {
				addResource(proj.id, r.type, r.value, r.label);
				lines.push(`${proj.name} 资源 +1：${r.label || r.value}`);
			}
		}
		for (const s of p.summaries) {
			const proj = findProject(s.project);
			if (proj) {
				addHistory(proj.id, s.summary);
				lines.push(`${proj.name} 历史摘要已记录`);
			}
		}
		db.prepare("UPDATE pending_updates SET status='applied' WHERE id=?").run(id);
	});
	apply();
	return { ok: true, text: lines.length ? lines.join("\n") : "（空更新）" };
}

// ---------- reminders ----------

export function alreadyReminded(taskId: number, kind: "window" | "overdue"): boolean {
	return !!db.prepare("SELECT 1 FROM reminders WHERE task_id=? AND kind=?").get(taskId, kind);
}

export function markReminded(taskId: number, kind: "window" | "overdue") {
	db.prepare("INSERT OR REPLACE INTO reminders(task_id, kind, date) VALUES(?,?,?)").run(taskId, kind, today());
}

// ---------- agent sessions ----------

export function saveSession(chatKey: string, messages: unknown) {
	const trimmed = Array.isArray(messages) ? messages.slice(-40) : messages;
	db.prepare("INSERT OR REPLACE INTO agent_sessions(chat_key, messages_json, updated_at) VALUES(?,?,?)").run(
		chatKey,
		JSON.stringify(trimmed),
		new Date().toISOString(),
	);
}

export function loadSession(chatKey: string): unknown[] | null {
	const row = db.prepare("SELECT messages_json FROM agent_sessions WHERE chat_key=?").get(chatKey) as
		| { messages_json: string }
		| undefined;
	return row ? JSON.parse(row.messages_json) : null;
}

// ---------- settings kv ----------

export function getSetting(key: string): string | null {
	const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
	return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
	db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES(?,?)").run(key, value);
}
