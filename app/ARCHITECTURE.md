# mypm app — 架构文档

> 本目录（app/）是 mypm v2 的全部代码。说明：技术选型、模块职责与相互关系、AI 工具清单、关键数据流。设计层面的完整决策见根目录五份文档（FEATURES / IMPLEMENTATION / AI-NATIVE / DETAILS / DECISIONS）。

## 一、技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| Agent 循环 | `@earendil-works/pi-agent-core` 0.84.3 | Agent 类：多轮工具调用、事件流、abort/steer。**不自研循环** |
| LLM 接入 | `@earendil-works/pi-ai` 0.84.3 | 内置 `zaiCodingCnProvider()`（智谱 GLM），模型 glm-4.7 |
| 对话入口 | `@larksuiteoapi/node-sdk` | WebSocket 长连接收消息 + im API 回复/私聊推送 |
| 数据 | `better-sqlite3` | 单文件 `app/data/mypm.db`，WAL，同步 API |
| Web 看板 | `hono` + `@hono/node-server` | API + 静态页；甘特图 frappe-gantt（CDN） |
| 定时 | `node-cron` | 每天 9:00 提醒 + 备份 |
| 运行 | `tsx` | 免编译直跑 TypeScript，Node ≥ 22 |

## 二、模块清单（src/）

| 文件 | 职责 | 关键导出 |
|---|---|---|
| `paths.ts` | 目录常量（一切限制在项目目录内）、日志、`localDate()` 本地日期 | `ROOT, DB_PATH, log, localDate` |
| `db.ts` | SQLite 全部读写：7 张表建表、CRUD、提取两段式（pending→apply 事务）、备份与完整性自恢复、会话/设置存取 | `db, listProjects, findProject, createTask, applyPending, backup, saveSession...` |
| `ai.ts` | GLM 模型装配（pi 内置智谱 provider）+ 纪要提取器（单次 LLM 调用，固定 prompt → 严格 JSON，失败重试一次） | `models, model, streamFn, extractUpdates` |
| `tools.ts` | **9 个 AgentTool**（AI 与数据之间唯一通道） | `pmTools` |
| `agent.ts` | 用 pi Agent 组装会话：system prompt（含今天日期）、工具、会话持久化（agent_sessions 表，截断 40 条） | `makeAgent, askAgent, systemPrompt` |
| `lark.ts` | Lark WebSocket 桥：收消息（私聊直通/群聊须@）、按 chat_id 哈希隔离会话、同会话串行、回复分段、"正在提取"提示、5 分钟超时、记住主人 open_id | `startLark` |
| `notify.ts` | 提醒卡片推送：优先应用机器人私聊（im.message.create），备用群 Webhook | `notifyCard` |
| `check.ts` | 提醒扫描：进 7 天窗口一次 + 逾期当天一次，reminders 表防重复；顺带每日备份 | `runCheck` |
| `web/server.ts` | 看板 API：`GET /api/dashboard`、`POST /api/tasks/:id/toggle`、静态页 | `startWeb` |
| `web/public/index.html` | 单页看板，三视图（dhtmlx甘特/任务列表/看板拖拽）、筛选排序搜索、任务与项目居中编辑弹窗、资料行内编辑、自定义字段（⚙管理+侧栏编辑），vendor 本地化（dhtmlx） | — |
| `index.ts` | 总入口：Web + Lark 桥 + cron 9:00 + 启动检查 | `npm run dev` |
| `chat.ts` | 终端对话模式（调试用，与 Lark 同一 agent 组装） | `npm run chat` |
| `run-check.ts` | 手动触发提醒的 CLI | `npm run check` |

`scripts/` 为开发脚本（db 冒烟、agent 调试、e2e 四步验收、重置提醒、webhook/provider 检查），不参与运行。

## 三、AI 工具清单（tools.ts，AI 操作数据的唯一方式）

| 工具 | 读/写 | 用途 |
|---|---|---|
| `list_projects` | 读 | 项目总览（状态/目标/项目截止日；任务带排期与优先级） |
| `list_tasks` | 读 | 任务查询（过滤+逾期标记，结果带 id） |
| `get_project_detail` | 读 | 项目详情：任务+资料+历史 |
| `get_task` | 读 | 单任务全量：排期/优先级/内容/任务级资料/自定义字段/父子 |
| `propose_updates` | 写 | 纪要→拟更新（内部再调一次 GLM 提取，严格 JSON，重试 1 次） |
| `apply_updates` / `discard_updates` | 写 | 确认入库（事务、幂等）/ 丢弃 |
| `create_task` | 写 | 新建（排期/优先级/里程碑/备注） |
| `update_task` | 写 | 改期/状态/完成/改名/优先级 |
| `update_project` | 写 | 项目目标/状态/项目截止日 |
| `add_resource` | 写 | 资料（项目级或任务级 task_id） |
| `set_custom_field` | 写 | 自定义字段（模糊匹配字段名，未定义则引导） |

写库工具全部 `executionMode: "sequential"`。共 **11 个工具**。**没有 delete 工具**——删除仅看板可做（防误删，决议 #12）。

## 四、两条核心数据流

**纪要入库（两段式确认）**

```
Lark 消息 → lark.ts（会话隔离/串行）→ askAgent
  → glm 调 propose_updates → 内部再调一次 GLM（提取器，temperature 0.1，严格 JSON）
  → pending_updates 落库 → 清单文本回给 AI → AI 转述给用户
用户回复"确认" → AI 调 apply_updates(update_id) → 事务写 projects/tasks/resources/history
```

**每日提醒**

```
node-cron 9:00 → runCheck → 查 due ≤ today+7 未完成任务
  → 未提醒过(window) / 逾期当天(overdue) → 生成卡片 → notifyCard
  → 机器人私聊（owner_open_id）→ 失败则 Webhook → 再失败仅日志
  → reminders 表记录防重复 → VACUUM INTO 每日备份（保留 14 份）
```

## 五、可靠性设计

- **AI 无状态**：会话可丢，任务状态全在 SQLite；拟更新存 pending_updates，AI 忘了上下文也能凭编号应用
- **数据安全**：WAL + 每日备份 + 启动 `integrity_check` 失败自动从最近备份恢复（防网盘同步损坏）
- **时区**：统一 `localDate()`（Asia/Shanghai），不用 UTC 日期
- **同会话串行**：每个 Lark chat 一个 Promise 队列，避免并发打乱上下文
- **超时**：单轮 5 分钟 abort 并告知用户
- **环境变量**：运行时读取（规避 ESM import 早于 dotenv 的坑）

## 六、运行与运维

```bash
npm run dev      # 全功能常驻（Web + Lark + cron）
npm run chat     # 终端对话（调试 agent）
npm run check    # 手动触发提醒+备份
```

- 日志：`../logs/mypm.log`（结构化）与 `../logs/mypm-run.log`（start-mypm.bat 重定向）
- 备份：`../backups/mypm-YYYYMMDD.db`
- 配置：根目录 `.env`（GLM key、Lark 凭证、Webhook、REMIND_DAYS、PORT）

## 七、依赖边界

- 只依赖 pi 的两个包（agent-core / ai）+ Lark 官方 SDK + 基础设施库，无重框架
- pi 处于 0.x，版本**锁定 0.84.3**；升级需回归 `scripts/e2e.ts` 四步验收
- 不使用 pi-coding-agent（文件/终端工具不需要），保持最小面
