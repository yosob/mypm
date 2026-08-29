import { Type } from "@earendil-works/pi-ai";
import { localDate } from "./paths";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import * as db from "./db";
import { extractUpdates } from "./ai";

function ok(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

function fmtTask(t: db.Task): string {
	const flags = [t.is_milestone ? "◆里程碑" : "", t.done ? "✅已完成" : ""].filter(Boolean).join(" ");
	const overdue = !t.done && t.due_date && t.due_date < localDate() ? "【逾期】" : "";
	return `[id=${t.id}] ${t.project_name} ｜ ${t.title}${t.due_date ? ` ｜ 截止 ${t.due_date}` : ""}${flags ? ` ｜ ${flags}` : ""} ${overdue}`.trim();
}

function fmtProject(p: db.Project, withTasks = true): string {
	const lines = [`「${p.name}」 ${p.description ? `- ${p.description}` : ""}`];
	if (withTasks) {
		const tasks = db.listTasks({ projectId: p.id, includeDone: true });
		if (tasks.length) lines.push(...tasks.map((t) => `  ${fmtTask(t)}`));
		else lines.push("  （无任务）");
	}
	return lines.join("\n");
}

export const pmTools: AgentTool<any, any>[] = [
	{
		name: "list_projects",
		label: "列出项目",
		description: "列出所有进行中的项目及其任务。用户想总览、了解有哪些项目时调用。",
		parameters: Type.Object({}),
		async execute() {
			const ps = db.listProjects();
			return ok(ps.length ? ps.map((p) => fmtProject(p)).join("\n\n") : "（暂无项目）");
		},
	},
	{
		name: "list_tasks",
		label: "查询任务",
		description:
			"列出任务，可按项目过滤、只看N天内到期（含逾期）。用户问'今天/这周该干嘛'、'XX项目进展'、'有什么逾期的'时调用。返回含任务id，后续操作需用id。",
		parameters: Type.Object({
			project: Type.Optional(Type.String({ description: "项目名（支持模糊匹配）" })),
			due_within_days: Type.Optional(Type.Number({ description: "只看N天内到期（含逾期），默认不限" })),
			include_done: Type.Optional(Type.Boolean({ description: "是否含已完成，默认否" })),
		}),
		async execute(_id, params: any) {
			const filter: db.TaskFilter = { includeDone: params.include_done };
			if (params.project) {
				const proj = db.findProject(params.project);
				if (!proj) throw new Error(`找不到项目「${params.project}」`);
				filter.projectId = proj.id;
			}
			if (params.due_within_days !== undefined) filter.dueWithinDays = params.due_within_days;
			const ts = db.listTasks(filter);
			return ok(ts.length ? ts.map(fmtTask).join("\n") : "（无符合条件的任务）");
		},
	},
	{
		name: "get_project_detail",
		label: "项目详情",
		description: "查看单个项目的完整信息：任务、资料（微信群/链接）、会议历史时间线。",
		parameters: Type.Object({ project: Type.String({ description: "项目名（支持模糊匹配）" }) }),
		async execute(_id, params: any) {
			const proj = db.findProject(params.project);
			if (!proj) throw new Error(`找不到项目「${params.project}」`);
			const parts = [fmtProject(proj)];
			const rs = db.listResources(proj.id);
			if (rs.length)
				parts.push(
					"资料：\n" +
						rs
							.map((r) => `  - ${r.type === "wechat_group" ? "微信群" : r.type === "link" ? "链接" : r.type}：${r.label ? r.label + " " : ""}${r.value}`)
							.join("\n"),
				);
			const hs = db.listHistory(proj.id);
			if (hs.length) parts.push("历史：\n" + hs.map((h) => `  - ${h.date} ${h.summary}`).join("\n"));
			return ok(parts.join("\n"));
		},
	},
	{
		name: "propose_updates",
		label: "提取纪要为拟更新",
		description:
			"收到会议纪要/周报/聊天记录等材料时调用。输入材料原文，返回结构化的拟更新清单（含待确认编号）。清单须原样转述给用户，等用户明确确认后才能调 apply_updates。",
		parameters: Type.Object({
			content: Type.String({ description: "纪要/材料原文" }),
		}),
		executionMode: "sequential",
		async execute(_id, params: any) {
			const payload = await extractUpdates(params.content);
			const updateId = db.savePending(payload);
			const lines: string[] = [`拟更新清单（更新编号 #${updateId}）：`];
			payload.items.forEach((it, i) => {
				lines.push(
					`  ${i + 1}. ${it.is_new ? "【新项目】" : ""}${it.project} ｜ ${it.is_milestone ? "◆" : ""}${it.title}${it.due_date ? ` ｜ 截止 ${it.due_date}` : ""}${it.description ? ` ｜ ${it.description}` : ""}`,
				);
			});
			for (const r of payload.resources)
				lines.push(`  资源：${r.project} ｜ ${r.type === "wechat_group" ? "微信群" : "链接"} ｜ ${r.label ? r.label + " " : ""}${r.value}`);
			for (const s of payload.summaries) lines.push(`  摘要：${s.project} ｜ ${s.summary}`);
			if (payload.items.length + payload.resources.length + payload.summaries.length === 0) lines.push("  （未提取到内容）");
			lines.push("回复「确认」生效；如需调整请说明。");
			return ok(lines.join("\n"));
		},
	},
	{
		name: "apply_updates",
		label: "确认应用更新",
		description: "用户对拟更新清单明确表示同意（确认/可以/没问题）后调用，写入数据库。参数为清单里给出的更新编号。",
		parameters: Type.Object({ update_id: Type.Number({ description: "拟更新清单的编号" }) }),
		executionMode: "sequential",
		async execute(_id, params: any) {
			const r = db.applyPending(params.update_id);
			if (!r.ok) throw new Error(r.text);
			return ok(`已入库：\n${r.text}`);
		},
	},
	{
		name: "discard_updates",
		label: "丢弃拟更新",
		description: "用户拒绝拟更新清单或要求重新调整时调用，丢弃该拟更新。",
		parameters: Type.Object({ update_id: Type.Number({ description: "拟更新清单的编号" }) }),
		executionMode: "sequential",
		async execute(_id, params: any) {
			if (!db.discardPending(params.update_id)) throw new Error(`更新 #${params.update_id} 不存在或已处理`);
			return ok(`已丢弃更新 #${params.update_id}`);
		},
	},
	{
		name: "create_task",
		label: "新建任务",
		description: "用户直接口述添加单个任务/待办时调用（无需确认流程）。日期用 YYYY-MM-DD。",
		parameters: Type.Object({
			project: Type.String({ description: "项目名（支持模糊匹配，不存在会新建）" }),
			title: Type.String({ description: "任务标题" }),
			due_date: Type.Optional(Type.String({ description: "截止日 YYYY-MM-DD" })),
			description: Type.Optional(Type.String({ description: "补充说明" })),
			is_milestone: Type.Optional(Type.Boolean({ description: "是否里程碑，默认否" })),
		}),
		executionMode: "sequential",
		async execute(_id, params: any) {
			let proj = db.findProject(params.project);
			if (!proj) proj = db.createProject(params.project);
			const t = db.createTask({
				project_id: proj.id,
				title: params.title,
				due_date: params.due_date ?? null,
				description: params.description,
				is_milestone: params.is_milestone,
			});
			return ok(`已添加：${proj.name} ｜ ${t.title}${t.due_date ? ` ｜ 截止 ${t.due_date}` : ""} [id=${t.id}]`);
		},
	},
	{
		name: "update_task",
		label: "修改任务",
		description: "改截止日/标记完成/改名时调用。需要任务id（可先用 list_tasks 查）。done 传 true 表示完成。",
		parameters: Type.Object({
			task_id: Type.Number({ description: "任务id" }),
			due_date: Type.Optional(Type.String({ description: "新截止日 YYYY-MM-DD" })),
			done: Type.Optional(Type.Boolean({ description: "是否完成" })),
			title: Type.Optional(Type.String({ description: "新标题" })),
		}),
		executionMode: "sequential",
		async execute(_id, params: any) {
			const t = db.updateTask(params.task_id, {
				due_date: params.due_date === undefined ? undefined : (params.due_date as string | null),
				done: params.done,
				title: params.title,
			});
			if (!t) throw new Error(`任务 ${params.task_id} 不存在`);
			return ok(`已更新：${fmtTask(t)}`);
		},
	},
	{
		name: "add_resource",
		label: "添加资料",
		description: "登记项目资料：微信群名、文档链接等。type 取 wechat_group 或 link。",
		parameters: Type.Object({
			project: Type.String({ description: "项目名（支持模糊匹配）" }),
			type: Type.String({ description: "wechat_group 或 link" }),
			value: Type.String({ description: "群名或链接地址" }),
			label: Type.Optional(Type.String({ description: "简短说明" })),
		}),
		executionMode: "sequential",
		async execute(_id, params: any) {
			const proj = db.findProject(params.project);
			if (!proj) throw new Error(`找不到项目「${params.project}」`);
			db.addResource(proj.id, params.type, params.value, params.label ?? "");
			return ok(
				`已登记到「${proj.name}」：${params.type === "wechat_group" ? "微信群" : "链接"} ${params.label ? params.label + " " : ""}${params.value}`,
			);
		},
	},
];
