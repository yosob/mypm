# mypm v2 — AI Native 个人 PM 详细实现文档

> 目标：自建一个 AI native 的个人项目管理程序。**pi** 为 agent 内核，自建 **SQLite 数据层 + Web 甘特图看板**，**Lark 私聊**为对话入口，**飞书 Webhook** 做定时提醒。单语言 TypeScript，单常驻进程。

## 0. 参考项目清单（本机已有 / 建议下载）

| 参考项目 | 用途 | 状态 |
|---|---|---|
| **@sugarforever/dsh-lark** | Lark WebSocket 长连接、chat→session 映射、消息去重、回复关联（TS，生产级） | ✅ 已在本机 `C:\Users\13321\.dsh\profiles\web\node_modules\@sugarforever\dsh-lark`，`lib/index.js` + `client/` 可直接研读 |
| **earendil-works/pi**（原 badlogic/pi-mono） | Agent 类、AgentTool 接口、createProvider 自定义模型（GLM） | 建议下载：`git clone https://github.com/earendil-works/pi`，重点读 `packages/agent/README.md`、`packages/ai/README.md`、`packages/coding-agent/docs/custom-provider.md`、`examples/extensions/custom-provider-anthropic.ts` |
| **nanobot（HKUDS）** | 备用：Lark 接入的 Python 实现（若转 Python 方案才需要） | 可下载 `https://github.com/HKUDS/nanobot`，重点看 Lark/飞书集成模块 |
| **@larksuiteoapi/node-sdk** | Lark 官方 SDK，无需源码，npm 安装；文档 https://open.larksuite.com/document/client-docs/sdk-installation | npm 依赖 |
| **frappe-gantt** | 甘特图渲染（CDN 引入，零构建） | https://github.com/frappe/gantt |
| **mypm.py（本项目已有）** | 提取 prompt、确认流程、飞书卡片格式、防重复提醒逻辑——直接移植 | ✅ 本机 |
| **Vikunja（本项目已有）** | 数据模型参考（project/task/due_date 字段设计参考它） | ✅ 本机，v2 完成后停用 |

## 1. 技术栈与依赖

```jsonc
// app/package.json 核心依赖
{
  "@earendil-works/pi-agent-core": "^0.x",   // Agent 类（工具循环、事件流）——锁版本，0.x 迭代快
  "@earendil-works/pi-ai": "^0.x",           // createProvider / openAICompletionsApi / TypeBox
  "@larksuiteoapi/node-sdk": "^1.x",         // Lark WebSocket 长连接 + 消息收发
  "better-sqlite3": "^11.x",                 // 同步 SQLite，单文件库，适合单用户
  "hono": "^4.x",                            // 极简 Web 框架（API + 静态页）
  "@hono/node-server": "^1.x",
  "node-cron": "^3.x",                       // 定时任务
  "dotenv": "^16.x",
  "typescript": "^5.x",
  "tsx": "^4.x"                              // 免编译直接跑 TS
}
```

环境变量（.env，均已有）：

```
GLM_API_KEY=891b...（OpenAI 兼容 https://open.bigmodel.cn/api/coding/paas/v4，模型 glm-4.7）
LARK_APP_ID=cli_xxxxxxxx（见 .env）
LARK_APP_SECRET=xxxxxxxx（见 .env）
FEISHU_WEBHOOK=https://open.larksuite.com/open-apis/bot/v2/hook/xxxxx（见 .env）
REMIND_DAYS=7
PORT=8787
```

## 2. 数据层（src/db.ts）

better-sqlite3，单文件 `app/data/mypm.db`（**所有文件一律在本项目目录内，不读写目录外任何位置**；WAL 模式 + 每日 `VACUUM INTO` 备份到 `mypm/backups/` 保留 14 份 + 启动时 integrity_check，见 DECISIONS.md #1）：

```sql
CREATE TABLE projects(id INTEGER PRIMARY KEY, name TEXT UNIQUE, description TEXT,
                      status TEXT DEFAULT 'active', created_at TEXT);
CREATE TABLE tasks(id INTEGER PRIMARY KEY, project_id INT REFERENCES projects(id),
                   title TEXT, description TEXT, due_date TEXT,  -- YYYY-MM-DD
                   is_milestone INT DEFAULT 0, done INT DEFAULT 0, created_at TEXT);
CREATE TABLE resources(id INTEGER PRIMARY KEY, project_id INT,
                       type TEXT,        -- wechat_group | link | file
                       value TEXT, label TEXT);
CREATE TABLE history(id INTEGER PRIMARY KEY, project_id INT, date TEXT, summary TEXT);
CREATE TABLE pending_updates(id INTEGER PRIMARY KEY, project_name TEXT,
                             payload_json TEXT, status TEXT DEFAULT 'pending', created_at TEXT);
CREATE TABLE reminders(task_id INTEGER PRIMARY KEY, reminded_date TEXT);
```

db.ts 导出纯函数 CRUD：`createProject / listProjects / createTask / listTasks({projectId?, dueBefore?, includeDone?}) / updateTask / addResource / addHistory / getPending / savePending / applyPending / markReminded`。

## 3. Agent 内核（src/agent.ts）

### 3.1 GLM 接入（pi-ai 自定义 provider）

```typescript
import { createProvider, createModels, envApiKeyAuth } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

const glm = createProvider({
  id: "zhipu", name: "GLM",
  baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
  auth: { apiKey: envApiKeyAuth("GLM key", ["GLM_API_KEY"]) },
  api: openAICompletionsApi(),
  models: [{
    id: "glm-4.7", name: "GLM 4.7", api: "openai-completions", provider: "zhipu",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    reasoning: true, input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000, maxTokens: 32000,
  }],
});
const models = createModels(); models.setProvider(glm);
const model = models.getModel("zhipu", "glm-4.7")!;
```

### 3.2 Agent 实例（每个 Lark 会话一个）

```typescript
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";

export function makeAgent(sessionId: string): Agent {
  return new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,   // 见 3.3
      model, tools: pmTools,
      messages: [],                  // 首版会话在内存，重启即新会话
    },
    streamFn: models.streamSimple.bind(models),
  });
}
```

事件处理：`agent.subscribe` 取 `message_end` 的 assistant 文本作为回复发给 Lark；`tool_execution_end` 用于在 Lark 里显示"已执行 xxx 工具"。

### 3.3 System Prompt 要点（AI 只能经工具动数据）

```
你是我的个人项目管理助手（AI PM）。规则：
1. 所有数据操作必须调用工具，禁止编造结果。
2. 收到会议纪要/总结时：调 propose_updates 生成拟更新清单，原文列出待用户确认，
   用户明确同意后才调 apply_updates。
3. 用户问"今天该干嘛/进展如何"时：调 list_tasks/list_projects 汇总，按项目分组，逾期优先。
4. 修改截止日、标记完成等单条操作直接调对应工具并复述结果。
5. 提取时保留微信群名/链接，写入 resources。
```

## 4. 工具集（src/tools.ts，共 9 个 AgentTool）

TypeBox 定义参数 schema，execute 内调 db.ts，返回 `{content:[{type:"text",text}]}`：

| 工具 | 参数 | 实现 |
|---|---|---|
| `list_projects` | — | db.listProjects() 格式化 |
| `list_tasks` | project?, due_within_days?, include_done? | 按项目分组、逾期标记 |
| `get_project_detail` | project | 项目+任务+resources+history 时间线 |
| `propose_updates` | content(纪要文本), project_hint? | **核心**，见 4.1 |
| `apply_updates` | update_id | 事务写入 projects/tasks/resources/history |
| `discard_updates` | update_id | 状态置 discarded |
| `create_task` | project, title, due_date?, description?, is_milestone? | 单条添加 |
| `update_task` | task_id, due_date?/done?/title? | 改期/完成/改名 |
| `add_resource` | project, type, value, label? | 群名/链接入库 |

### 4.1 propose_updates（纪要提取，两段式）

工具内直接再调一次 GLM（pi-ai 的 chat 接口，非 agent 循环），prompt 移植自 `mypm.py:EXTRACT_PROMPT`（已端到端验证），temperature 0.1，输出严格 JSON：

```json
{"items":[{"project":"...","is_new":false,"title":"...","due_date":"YYYY-MM-DD|null",
           "is_milestone":false,"description":"..."}],
 "resources":[{"project":"...","type":"wechat_group|link","value":"...","label":"..."}],
 "summaries":[{"project":"...","summary":"1-3句进展摘要"}]}
```

→ 写入 pending_updates → 返回人类可读清单文本。确认由 agent 在对话层完成（用户回复"确认"→ agent 调 apply_updates），无终端交互。

## 5. Lark 桥（src/lark.ts）——参考 dsh-lark 源码

官方 SDK 长连接（无需公网）：

```typescript
import * as lark from "@larksuiteoapi/node-sdk";
const client = new lark.Client({ appId, appSecret, domain: lark.Domain.Lark });
const wsClient = new lark.WSClient({ appId, appSecret, domain: lark.Domain.Lark });
await wsClient.start({
  eventDispatcher: new lark.EventDispatcher()
    .register({ "im.message.receive_v1": onMessage }),
});
```

onMessage 逻辑（照抄 dsh-lark 的成熟做法）：

1. 过滤非 text 消息与机器人自身消息；`chat_id` 做 SHA-256 后作为会话 key（不泄原始 id）
2. 每会话一个 `Agent` 实例（Map 缓存）；同一会话串行处理（队列）
3. `agent.prompt(text)` → subscribe 收尾 → `client.im.message.reply(...)` 回复原消息
4. 回复超 3000 字截断分段；群聊需 @机器人（权限已批）

## 6. 定时提醒（src/cron.ts + notify.ts）

- node-cron：`0 9 * * *`（每天 9:00）
- 逻辑移植 `mypm.py:cmd_check`：查 `due_date <= today+REMIND_DAYS` 且未 done、未在 reminders 表中的任务 → 按项目分组生成 markdown → 飞书 Webhook interactive 卡片（格式照抄 mypm.py 已验证的 `feishu_send`）→ 写 reminders 防重复
- 手动触发入口 `npm run check`

## 7. Web 看板（src/web/）

- Hono：`GET /api/dashboard`（projects+tasks+resources 一次返回）、`POST /api/tasks/:id/toggle`、静态目录 `public/`
- `public/index.html`（单文件，无构建）：原生 fetch + **frappe-gantt**（CDN）渲染任务条（created_at→due_date，里程碑菱形）、项目卡片列 resources（群名/链接）、点击勾选完成
- 端口 8787，后续自行内网穿透

## 8. 入口与运行（src/index.ts）

```
启动 → db 初始化 → Web 看板 → Lark WS 桥 → cron → 常驻
npm run dev    # tsx src/index.ts（全功能）
npm run chat   # 终端对话模式（调试 agent，不连 Lark）
npm run check  # 手动触发提醒
```

## 9. 实施顺序与验证

| 步骤 | 内容 | 验证 |
|---|---|---|
| 1 | 脚手架 + db.ts | 建表、CRUD 测试 |
| 2 | agent.ts + tools.ts + `npm run chat` | 终端贴 sample-meeting.md → 清单 → "确认" → 落库 |
| 3 | web 看板 | 甘特图/卡片/勾选正确 |
| 4 | lark.ts | Lark 私聊走通同样流程 + "今天该干嘛" |
| 5 | cron + notify | 手动 check 推飞书、不重复 |
| 6 | 收尾：README、关闭 Vikunja/dsh 进程 | — |

## 10. 风险与对策

- pi 包 0.x 迭代快、新旧包名并存 → 锁定 `@earendil-works/pi-*` 精确版本；agent 层集中在 agent.ts，API 变更只改一处
- GLM 思考输出慢（提取 1-3 分钟）→ prompt 精简；Lark 先回"正在提取…"
- Lark 应用权限/审核 → 凭证已可用
- better-sqlite3 Windows 编译 → Node 24 有 prebuilt；不行换 Node 内置 `node:sqlite`
