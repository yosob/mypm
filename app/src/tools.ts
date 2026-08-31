import { Type } from "@earendil-works/pi-ai";
import { localDate } from "./paths";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import * as db from "./db";
import { extractUpdates } from "./ai";
import { scheduleCron, stopCron } from "./timers";

function ok(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

function fmtTask(t: db.Task): string {
	const statusLabel = t.done || t.status === "done" ? "已完成" : t.status === "doing" ? "进行中" : "待办";
	const flags = [t.is_milestone ? "◆里程碑" : "", t.priority && t.priority !== "P3" ? t.priority : ""].filter(Boolean).join(" ");
	const overdue = !t.done && t.due_date && t.due_date < localDate() ? "【逾期】" : "";
	const sched = t.start_date && t.due_date ? ` ｜ ${t.start_date}~${t.due_date}` : t.due_date ? ` ｜ 截止 ${t.due_date}` : "";
	return `${t.parent_id ? "└ " : ""}[id=${t.id}] ${t.project_name} ｜ ${t.title}${sched} ｜ ${statusLabel}${flags ? ` ｜ ${flags}` : ""} ${overdue}`.trim();
}

function fmtProject(p: db.Project, withTasks = true): string {
	const stTxt: Record<string, string> = { active: "推进中", done: "已完成", paused: "已搁置" };
	const lines = [
		`「${p.name}」${stTxt[p.status] ? `（${stTxt[p.status]}）` : ""}${p.end_date ? ` ｜ 项目截止 ${p.end_date}` : ""} ${p.description ? `- ${p.description}` : ""}`,
	];
	if (withTasks) {
		const tasks = db.listTasks({ projectId: p.id, includeDone: true });
		if (tasks.length) lines.push(...tasks.map((t) => `  ${fmtTask(t)}`));
		else lines.push("  （无任务）");
	}
	return lines.join("\n");
}

export const pmTools: AgentTool<any, any>[] = [
	{
		name: "update_project",
		label: "修改项目",
		description: "修改项目信息：目标(description)、状态(status: active推进中/done已完成/paused搁置)、项目截止日(end_date)、名称。",
		parameters: Type.Object({
			project: Type.String({ description: "项目名（支持模糊匹配）" }),
			description: Type.Optional(Type.String({ description: "项目目标" })),
			status: Type.Optional(Type.String({ description: "active/done/paused" })),
			end_date: Type.Optional(Type.String({ description: "项目截止日 YYYY-MM-DD，传空串清除" })),
		}),
		executionMode: "sequential",
		async execute(_id, params: any) {
			const proj = db.findProject(params.project);
			if (!proj) throw new Error(`找不到项目「${params.project}」`);
			const p = db.updateProject(proj.id, {
				description: params.description,
				status: params.status,
				end_date: params.end_date === undefined ? undefined : params.end_date || null,
			});
			return ok(`项目已更新：「${p!.name}」 目标:${p!.description || "无"} 状态:${p!.status}${p!.end_date ? ` 截止:${p!.end_date}` : ""}`);
		},
	},
	{
		name: "list_projects",
		label: "查项目",
		description:
			"查看项目，两种用法：不传参数=总览所有进行中项目及其任务；传 project=单个项目完整详情（任务+资料（微信群/链接）+会议历史时间线）。用户想总览、了解有哪些项目、或看某项目全貌时调用。",
		parameters: Type.Object({
			project: Type.Optional(Type.String({ description: "项目名（支持模糊匹配）；传了则返回该项目完整详情（含资料与历史）" })),
		}),
		async execute(_id, params: any) {
			if (params.project) {
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
			}
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
				const sched = it.start_date ? ` ｜ ${it.start_date}~${it.due_date ?? "?"}` : it.due_date ? ` ｜ 截止 ${it.due_date}` : "";
				lines.push(
					`  ${i + 1}. ${it.is_new ? "【新项目】" : ""}${it.project} ｜ ${it.is_milestone ? "◆" : ""}${it.title}${sched}${it.priority && it.priority !== "P3" ? ` ｜ ${it.priority}` : ""}${it.description ? ` ｜ ${it.description}` : ""}`,
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
		name: "resolve_updates",
		label: "处理拟更新",
		description:
			"对拟更新清单做最终处理：用户明确同意（确认/可以/没问题）时 action=apply 写入数据库；用户拒绝清单或要求重新调整时 action=discard 丢弃。参数为清单里给出的更新编号。",
		parameters: Type.Object({
			update_id: Type.Number({ description: "拟更新清单的编号" }),
			action: Type.String({ description: "apply=确认入库；discard=丢弃" }),
		}),
		executionMode: "sequential",
		async execute(_id, params: any) {
			if (params.action === "apply") {
				const r = db.applyPending(params.update_id);
				if (!r.ok) throw new Error(r.text);
				return ok(`已入库：\n${r.text}`);
			}
			if (params.action === "discard") {
				if (!db.discardPending(params.update_id)) throw new Error(`更新 #${params.update_id} 不存在或已处理`);
				return ok(`已丢弃更新 #${params.update_id}`);
			}
			throw new Error("action 须为 apply 或 discard");
		},
	},
	{
		name: "get_task",
		label: "任务详情",
		description:
			"查单个任务的完整信息：排期/状态/优先级/内容/任务资料(微信群/链接)/自定义字段/父子任务。用户问某个任务的具体情况、任务上挂了什么资料时调用。",
		parameters: Type.Object({ task_id: Type.Number({ description: "任务id" }) }),
		async execute(_id, params: any) {
			const t = db.getTask(params.task_id);
			if (!t) throw new Error(`任务 ${params.task_id} 不存在`);
			const lines = [fmtTask(t)];
			if (t.description) lines.push(`内容：${t.description}`);
			const trs = db.listTaskResources(t.id);
			if (trs.length)
				lines.push(
					"任务资料：\n" +
						trs
							.map((r) => `  - ${r.type === "wechat_group" ? "微信群" : r.type === "link" ? "链接" : "备注"}：${r.label ? r.label + " " : ""}${r.value}`)
							.join("\n"),
				);
			const fields = db.listFields();
			const custom = db.getCustom(t);
			if (fields.length) {
				const part = fields.map((f) => `  - ${f.name}: ${custom[String(f.id)] ?? ""}`).join("\n");
				lines.push(`自定义字段：\n${part}`);
			}
			if (t.parent_id) {
				const pt = db.getTask(t.parent_id);
				if (pt) lines.push(`父任务：[id=${pt.id}] ${pt.title}`);
			}
			const subs = db.listTasks({ includeDone: true }).filter((x) => x.parent_id === t.id);
			if (subs.length)
				lines.push("子任务：\n" + subs.map((x) => `  - [id=${x.id}] ${x.title}${x.done ? " ✅" : ""}`).join("\n"));
			return ok(lines.join("\n"));
		},
	},
	{
		name: "create_task",
		label: "新建任务",
		description: "用户直接口述添加单个任务/待办时调用（无需确认流程）。日期用 YYYY-MM-DD。拆子任务时传 parent_task_id（归属自动取父任务所在项目）。",
		parameters: Type.Object({
			project: Type.String({ description: "项目名（支持模糊匹配，不存在会新建；传了 parent_task_id 时忽略，以父任务所在项目为准）" }),
			title: Type.String({ description: "任务标题" }),
			start_date: Type.Optional(Type.String({ description: "开始日 YYYY-MM-DD（有明确排期时填）" })),
			due_date: Type.Optional(Type.String({ description: "截止日 YYYY-MM-DD" })),
			description: Type.Optional(Type.String({ description: "补充说明" })),
			is_milestone: Type.Optional(Type.Boolean({ description: "是否里程碑，默认否" })),
			priority: Type.Optional(Type.String({ description: "优先级 P0最高~P3最低，默认P3" })),
			parent_task_id: Type.Optional(Type.Number({ description: "父任务id（拆子任务时传）。子任务须与父同项目、最多一层" })),
		}),
		executionMode: "sequential",
		async execute(_id, params: any) {
			let parentId: number | null = params.parent_task_id ?? null;
			if (parentId) {
				const pt = db.getTask(parentId);
				if (!pt) throw new Error(`父任务 ${parentId} 不存在`);
				const err = db.validateParent(pt.project_id, parentId); // 深度一层等校验（同项目天然满足：以父为准）
				if (err) throw new Error(err);
				const t = db.createTask({
					project_id: pt.project_id,
					title: params.title,
					start_date: params.start_date ?? null,
					due_date: params.due_date ?? null,
					description: params.description,
					is_milestone: params.is_milestone,
					priority: params.priority,
					parent_id: parentId,
				});
				return ok(
					`已添加子任务：${pt.title} └ ${t.title}${t.due_date ? ` ｜ 截止 ${t.due_date}` : ""} [id=${t.id}]（父任务完成时子任务自动完成）`,
				);
			}
			let proj = db.findProject(params.project);
			if (!proj) proj = db.createProject(params.project);
			const t = db.createTask({
				project_id: proj.id,
				title: params.title,
				start_date: params.start_date ?? null,
				due_date: params.due_date ?? null,
				description: params.description,
				is_milestone: params.is_milestone,
				priority: params.priority,
			});
			return ok(
				`已添加：${proj.name} ｜ ${t.title}${t.start_date ? ` ｜ ${t.start_date}~${t.due_date ?? "?"}` : t.due_date ? ` ｜ 截止 ${t.due_date}` : ""}${t.priority !== "P3" ? ` ｜ ${t.priority}` : ""} [id=${t.id}]`,
			);
		},
	},
	{
		name: "update_task",
		label: "修改任务",
		description:
			"修改任务的一切属性：改期/标记完成/改名/改状态/优先级/父子关联/自定义字段。需要任务id（可先用 list_tasks 查）。done 传 true 表示完成（父任务完成时未完成的子任务自动完成）；status 取 todo(待办)/doing(进行中)/done(已完成)；custom 设置自定义字段（如负责人、合同号，字段需先在看板⚙自定义字段中定义，字段名支持模糊匹配）。",
		parameters: Type.Object({
			task_id: Type.Number({ description: "任务id" }),
			start_date: Type.Optional(Type.String({ description: "新开始日 YYYY-MM-DD" })),
			due_date: Type.Optional(Type.String({ description: "新截止日 YYYY-MM-DD" })),
			done: Type.Optional(Type.Boolean({ description: "是否完成" })),
			title: Type.Optional(Type.String({ description: "新标题" })),
			status: Type.Optional(Type.String({ description: "任务状态：todo/doing/done" })),
			priority: Type.Optional(Type.String({ description: "优先级 P0~P3" })),
			parent_task_id: Type.Optional(Type.Number({ description: "设为某任务的子任务（父任务id）；传 0 解除父子关联" })),
			custom: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "自定义字段名→值（如 {\"负责人\":\"张三\"}），可一次设多个" })),
		}),
		executionMode: "sequential",
		async execute(_id, params: any) {
			const cur = db.getTask(params.task_id);
			if (!cur) throw new Error(`任务 ${params.task_id} 不存在`);
			let parentId: number | null | undefined = undefined;
			if (params.parent_task_id !== undefined) {
				parentId = params.parent_task_id ? Number(params.parent_task_id) : null;
				if (parentId) {
					const err = db.validateParent(cur.project_id, parentId, params.task_id);
					if (err) throw new Error(err);
				}
			}
			const t = db.updateTask(params.task_id, {
				start_date: params.start_date === undefined ? undefined : (params.start_date as string | null),
				due_date: params.due_date === undefined ? undefined : (params.due_date as string | null),
				done: params.done,
				title: params.title,
				status: params.status,
				priority: params.priority,
				parent_id: parentId,
			});
			if (!t) throw new Error(`任务 ${params.task_id} 不存在`);
			let extra = parentId ? `（已挂为「${db.getTask(parentId)?.title ?? parentId}」的子任务）` : parentId === null ? "（已解除父子关联）" : "";
			// 自定义字段（原 set_custom_field 并入）：字段名模糊匹配
			const customIn: Record<string, string> = params.custom ?? {};
			if (Object.keys(customIn).length) {
				const fields = db.listFields();
				const patchCustom: Record<string, string> = {};
				for (const [name, value] of Object.entries(customIn)) {
					const f = fields.find((x) => x.name === name) ?? fields.find((x) => x.name.includes(name));
					if (!f) throw new Error(`没有自定义字段「${name}」。现有字段：${fields.map((x) => x.name).join("、") || "（无）"}`);
					patchCustom[String(f.id)] = String(value);
				}
				db.setCustom(params.task_id, patchCustom);
				extra += `（自定义：${Object.entries(customIn).map(([k, v]) => `${k}=${v}`).join("、")}）`;
			}
			return ok(`已更新：${fmtTask(t)}${extra}`);
		},
	},
	{
		name: "timer",
		label: "定时提醒",
		description:
			"管理定时提醒。action=set：设置提醒——一次性传 run_at（YYYY-MM-DD HH:mm，24小时制），周期传 cron（如每天9点='0 9 * * *'，每周一8点半='30 8 * * 1'，工作日='0 9 * * 1-5'），相对时间（明天下午3点）先换算成绝对时间；action=list：查询现有提醒；action=cancel：取消提醒。用户说'到点提醒我/定时提醒/每周X提醒我/我有哪些提醒/取消提醒'时调用。",
		parameters: Type.Object({
			action: Type.String({ description: "set=设置 / list=查询 / cancel=取消" }),
			title: Type.Optional(Type.String({ description: "[set] 提醒内容（会原样出现在提醒卡片标题）" })),
			run_at: Type.Optional(Type.String({ description: "[set] 一次性触发时刻 YYYY-MM-DD HH:mm" })),
			cron: Type.Optional(Type.String({ description: "[set] 周期 cron 表达式" })),
			timer_id: Type.Optional(Type.Number({ description: "[cancel] 定时器 id" })),
		}),
		executionMode: "sequential",
		async execute(_id, params: any) {
			if (params.action === "set") {
				if (!params.title) throw new Error("set 需要 title（提醒内容）");
				const t = db.createTimer({ title: params.title, run_at: params.run_at ?? null, cron: params.cron ?? null });
				if (t.cron) scheduleCron(t);
				return ok(
					`定时器已设置 [id=${t.id}]「${t.title}」${t.cron ? `周期：${t.cron}` : `时刻：${t.run_at}`}，到点机器人会私聊提醒`,
				);
			}
			if (params.action === "list") {
				const ts = db.listTimers();
				if (!ts.length) return ok("（暂无定时提醒）");
				const stTxt: Record<string, string> = { active: "生效中", fired: "已触发", cancelled: "已取消" };
				return ok(
					ts.map((t) => `[id=${t.id}]「${t.title}」｜ ${t.cron ? `周期 ${t.cron}` : t.run_at} ｜ ${stTxt[t.status] ?? t.status}`).join("\n"),
				);
			}
			if (params.action === "cancel") {
				if (!db.cancelTimer(params.timer_id)) throw new Error(`定时器 ${params.timer_id} 不存在或已结束`);
				stopCron(params.timer_id); // 同步停掉内存中的 cron 调度（否则周期任务会继续触发到进程重启）
				return ok(`已取消定时提醒 [id=${params.timer_id}]`);
			}
			throw new Error("action 须为 set / list / cancel");
		},
	},
	{
		name: "add_resource",
		label: "添加资料",
		description:
			"登记资料：微信群名、文档链接等。type 取 wechat_group / link / note。默认挂到项目；用户明确说挂在某个任务上时传 task_id。",
		parameters: Type.Object({
			project: Type.String({ description: "项目名（支持模糊匹配）" }),
			type: Type.String({ description: "wechat_group / link / note" }),
			value: Type.String({ description: "群名或链接地址" }),
			label: Type.Optional(Type.String({ description: "简短说明" })),
			task_id: Type.Optional(Type.Number({ description: "挂到该任务而非项目（用户明确要求时才传）" })),
		}),
		executionMode: "sequential",
		async execute(_id, params: any) {
			const proj = db.findProject(params.project);
			if (!proj) throw new Error(`找不到项目「${params.project}」`);
			if (params.task_id) {
				const t = db.getTask(params.task_id);
				if (!t) throw new Error(`任务 ${params.task_id} 不存在`);
				db.addTaskResource(params.task_id, params.type, params.value, params.label ?? "");
				return ok(`已登记到「${proj.name}」任务「${t.title}」：${params.type === "wechat_group" ? "微信群" : params.type === "link" ? "链接" : "备注"} ${params.label ? params.label + " " : ""}${params.value}`);
			}
			db.addResource(proj.id, params.type, params.value, params.label ?? "");
			return ok(
				`已登记到「${proj.name}」：${params.type === "wechat_group" ? "微信群" : "链接"} ${params.label ? params.label + " " : ""}${params.value}`,
			);
		},
	},
];
