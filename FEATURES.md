# mypm — PM 功能调研与功能清单文档

> 回答三个问题：① 别的 PM 软件都有什么功能；② 我们要做哪些功能、需要记录哪些数据；③ 每个功能怎么实现、参考什么项目。配合 `IMPLEMENTATION.md`（技术实现细节）阅读。

---

## 一、主流 PM 软件功能盘点

| 软件 | 定位 | 核心功能 | 对我们的参考价值 |
|---|---|---|---|
| **Vikunja**（开源） | 自托管个人/团队 To-do | 多项目、列表/看板/甘特/日历四视图、任务订阅(子任务)、标签、提醒、重复任务、REST API | 数据模型和甘特视图设计的直接参考（已装在本机，字段设计就是仿它） |
| **GanttProject**（开源桌面） | 个人项目排期 | 任务分解(WBS)、依赖关系(FS/SS/FF/SF)、里程碑、资源负载、甘特图导出 | 甘特图该有的元素：任务条、里程碑菱形、依赖箭头、今日线 |
| **Asana / ClickUp** | 团队 PM | 时间线视图、任务依赖、里程碑、重复任务、多视图、自定义字段 | 功能项对照的"全集"标准；重复任务、优先级、子任务来自这里 |
| **Linear** | 开发团队 issue | 状态流(待办/进行中/完成)、周期(Cycle)、路线图 | 状态流字段（status: todo/doing/done）与"今日该干嘛"视图 |
| **Notion / 飞书项目** | 文档+PM 混合 | 数据库视图、关联文档、时间线 | 资料（文档链接/群名）挂在项目下做"项目资料库"的形态 |
| **Todoist / TickTick** | 个人 GTD | 优先级(P1-P4)、重复任务、自然语言日期、标签过滤 | 自然语言日期解析（"下周三"→日期）值得给 agent 做 |
| **Paymo** | 个人/自由职业 | 时间追踪、甘特图 | 时间记录字段（可选后期） |

**共识性功能全集**（各软件都有）：项目/任务两级结构、截止日、优先级、状态、标签、子任务、依赖关系、里程碑、甘特图/时间线、日历、重复任务、提醒通知、附件/链接、活动历史、搜索过滤。

## 二、我们的功能清单（按优先级）

### P0 — 核心闭环（第一期必做）

| 功能 | 说明 | 数据字段 |
|---|---|---|
| 项目管理 | 建项目、归档、项目描述 | name, description, status, created_at |
| 任务管理 | 建任务、改期、完成、删除 | title, description, due_date, is_milestone, done, priority, created_at |
| 里程碑 | 特殊任务类型，甘特图上画菱形 | tasks.is_milestone |
| **AI 纪要提取** | 丢会议纪要 → 提取任务/里程碑/日期/群名链接 → 确认入库 | pending_updates 表 |
| 项目资料库 | 每项目挂微信群名、文档链接等 | resources(type,value,label) |
| 项目历史时间线 | 每次会议的摘要按时间排列 | history(date,summary) |
| **每日提醒** | 9:00 扫 7 天内到期+逾期 → 飞书卡片 | reminders 表 |
| 甘特图看板 | Web 页：任务条+里程碑+今日线 | — |
| Lark 对话入口 | 私聊机器人完成上述一切 | — |

### P1 — 第二期增强

| 功能 | 说明 | 参考软件 |
|---|---|---|
| 任务状态流 | todo/doing/done 三态，"今日该干嘛"按 doing 优先 | Linear |
| 优先级 | P0-P3，提醒排序用 | Todoist |
| 重复任务 | 周报、例会（RRULE 简化版：每周N/每月N日） | Vikunja/Todoist |
| 自然语言日期 | agent 对话里"下周三"自动解析 | Todoist |
| 子任务 | task 的 parent_id | Vikunja |
| 日历视图 | 月视图看排期 | Vikunja |
| 任务依赖 | depends_on，甘特图画箭头 | GanttProject |
| 手动触发"问 agent" | "本周进展汇总"生成周报卡片推飞书 | — |

### P2 — 暂不做（记录备查）

多人协作/指派、工时追踪、成本管理、审批流、甘特基线对比、关键路径计算——个人场景用不上。

## 三、数据记录完整定义（P0+P1 全量）

```sql
projects: id, name, description, status('active'|'archived'), created_at
tasks:    id, project_id, parent_id NULL,      -- 子任务(P1)
          title, description,
          due_date 'YYYY-MM-DD', done, done_at,
          is_milestone, priority 'P0'-'P3'(P1),
          status 'todo'|'doing'|'done'(P1),
          recur_rule TEXT NULL(P1),            -- 'weekly:3' 每周三
          depends_on TEXT NULL(P1),            -- 依赖的 task id 列表 "3,5"
          created_at
resources: id, project_id, type('wechat_group'|'link'|'file'|'note'), value, label
history:  id, project_id, date, summary
pending_updates: id, payload_json, status('pending'|'applied'|'discarded'), created_at
reminders: task_id, reminded_date              -- 防重复
```

**记录类型总结**：项目、任务、里程碑（任务的子类型）、资料（群/链接/文件）、历史摘要、待确认更新、已提醒标记——7 类。

## 四、甘特图专项

**要画的元素**（对照 GanttProject/Vikunja 甘特视图）：
1. 任务条：横轴时间，起=created_at（或任务指定 start_date），止=due_date；颜色按项目分
2. 里程碑：菱形符号，标注在 due_date 当天
3. 今日线：竖直红线
4. 逾期高亮：due_date < 今天且未 done 的任务条变红
5. 左侧任务列表：项目名分组、勾选完成
6. （P1）依赖箭头：depends_on 任务间连线

**实现**：`frappe-gantt`（MIT，CDN 单文件引入，零构建）原生支持任务条/里程碑/今日线/依赖箭头，够用；如果嫌丑或需要交互定制，备选 `dhtmlxGantt`（GPL 版功能更强）。

**数据流**：`GET /api/dashboard` 返回全部项目+任务 → 前端组装成 frappe-gantt 的 tasks 数组 `[{id, name, start, end, progress, custom_class, dependencies}]`。

## 五、功能 ↔ 实现 ↔ 参考项目 对照表

| 功能 | 实现模块（app/src/） | 参考项目 |
|---|---|---|
| 数据层 | db.ts (better-sqlite3) | Vikunja 字段设计（本机可查其 API /docs.json） |
| Agent 循环/工具 | agent.ts + tools.ts | **earendil-works/pi** `packages/agent/README.md`（Agent 类、AgentTool 接口） |
| GLM 模型接入 | agent.ts | pi `docs/custom-provider.md` + `examples/extensions/custom-provider-anthropic.ts` |
| AI 纪要提取 | tools.ts: propose_updates | 移植本机 mypm.py 的 EXTRACT_PROMPT（已验证） |
| 确认入库流程 | tools.ts: apply_updates | 本机 mypm.py 的确认清单交互设计，改为对话式 |
| Lark 对话入口 | lark.ts (@larksuiteoapi/node-sdk) | **本机 dsh-lark 源码**（WS 长连接/会话映射/去重/串行队列）+ nanobot（备用，Python） |
| 每日提醒 | cron.ts + notify.ts (node-cron) | 移植 mypm.py cmd_check + 飞书卡片格式 |
| 甘特图看板 | web/public/index.html | **frappe-gantt**（github.com/frappe/gantt）；元素对照 GanttProject |
| 自然语言日期(P1) | agent prompt + date 库（如 chrono-node） | Todoist 行为 |
| 重复任务(P1) | db.ts 扩展 + check 时滚动生成下一期 | Vikunja recur 逻辑 |

## 六、与已有资产的关系

- `mypm.py`：prompt/流程/飞书卡片直接移植，之后退役
- Vikunja：只做字段设计参考，v2 跑通后关进程
- dsh：关闭（lark 插件源码留作参考）
- Lark 应用凭证、GLM key、飞书 Webhook：继续使用
