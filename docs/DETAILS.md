# mypm — 实现细节补充清单（DETAILS）

> 补充 `FEATURES.md`（做什么）与 `IMPLEMENTATION.md`（怎么做）未覆盖的所有具体细节。三份文档合计构成完整实施依据。

## 1. 依赖版本（已验证存在，2026-08-29 npm 实查）

| 包 | 最新版 | 备注 |
|---|---|---|
| @earendil-works/pi-agent-core | 0.84.3 | **锁 0.84.x**，0.x 迭代快 |
| @earendil-works/pi-ai | 0.84.3 | 与 agent-core 同版本配套 |
| @larksuiteoapi/node-sdk | 1.73.0 | Lark 官方 |
| better-sqlite3 | 13.0.3 | Node 24 有 prebuilt |
| hono / @hono/node-server | 4.x / 1.x | |
| node-cron / dotenv / tsx / typebox | 3.x / 16.x / 4.x | |

⚠️ `@mariozechner/pi-ai@0.73.1` 是旧名残留，不要用。

## 2. 参考物状态（pi 已下载并核对，2026-08-29）

| 项 | 用途 | 状态 |
|---|---|---|
| pi 仓库 | API 核对 | ✅ `E:\BaiduSyncdisk\somethingget\work\mypm\pi-main\pi-main` |
| dsh-lark 源码 | Lark 桥参考 | ✅ `C:\Users\13321\.dsh\profiles\web\node_modules\@sugarforever\dsh-lark` |

**已核对的真实 API（源码级验证）**：
- `Agent` 类：`packages/agent/src/agent.ts:173`。构造 `{initialState:{systemPrompt, model, tools, messages, thinkingLevel}, streamFn?, convertToLlm?, transformContext?, beforeToolCall?, afterToolCall?, toolExecution?}`；`subscribe(listener)`、`state` getter、`prompt/steer/followUp/abort/waitForIdle` 均在。注意 `streamFn` 可省略（有 `getDefaultStreamFn()` 默认）
- `AgentTool`：`packages/agent/src/types.ts:387`。**`label` 必填**（UI 显示名）；`execute(toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult>`；`executionMode?: "sequential"|"parallel"`；失败直接 throw
- `createProvider(input)`：`packages/ai/src/models.ts:762`；`createModels()`：models.ts:735；`Models.setProvider/getModel/getModels` 确认
- **官方已内置智谱 provider**：`zaiCodingCnProvider()`（`packages/ai/src/providers/zai-coding-cn.ts`）——baseUrl 就是 `https://open.bigmodel.cn/api/coding/paas/v4`，auth 读环境变量 `ZAI_CODING_CN_API_KEY`，openai-completions API。**方案简化：直接用它 + 该 env var 传 GLM key，无需自写 provider**；模型目录 JSON 是脚本生成的（仓库里没有 data/*.json），若 `ZAI_CODING_CN_MODELS` 无 glm-4.7，则回退到自写 createProvider（代码见 IMPLEMENTATION.md 3.1，签名已验证无误）

## 3. 现有凭证与端点（脱敏索引，实际值在 .env）

| 项 | 值 | 状态 |
|---|---|---|
| GLM OpenAI 兼容 | `https://open.bigmodel.cn/api/coding/paas/v4` + key `891b**`（完整值在 .env） | ✅ 已连通测试（glm-4.7，提取一次约 1-3 分钟） |
| GLM Anthropic 兼容 | `https://open.bigmodel.cn/api/anthropic`（备用） | 未测 |
| Lark 应用 | `cli_aa1a...` / secret `QyMj...`（完整值在 .env） | ✅ 应用已发布，权限已批（p2p_msg:readonly、group_at_msg:readonly、send_as_bot、事件 im.message.receive_v1、长连接模式） |
| 飞书 Webhook | `https://open.larksuite.com/open-apis/bot/v2/hook/cc98...` | ✅ 已推卡片成功 |
| 看板端口 | 8787 | 未占用 |

## 4. 关键代码资产移植对照

| 现有资产（mypm.py） | 移植目标 | 备注 |
|---|---|---|
| `EXTRACT_PROMPT`（约 40 行中文提取 prompt） | tools.ts propose_updates | 已端到端验证，提取准确（4/4 任务正确）；迁移时把"现有项目列表"部分改为动态注入 db 数据 |
| `llm_extract()` 的 ```json 剥壳逻辑 | tools.ts | GLM 会包 markdown 代码块，必须保留此处理 |
| `feishu_send()` 卡片 payload | notify.ts | interactive 卡片 + lark_md 格式已验证 |
| `cmd_check()` 的窗口/防重复逻辑 | cron.ts | due<=today+7 或逾期 → reminders 表 |
| 终端 y/n/e 确认交互 | ❌ 不移植 | 改为 agent 对话确认 |
| 示例纪要 | 内嵌于 app/scripts/e2e.ts（原文件已删） | 含项目/日期/群名/链接各要素 |

## 5. Lark 桥细节（从 dsh-lark 源码提炼，写 lark.ts 时照此实现）

1. **WS 启动**：`new lark.WSClient({appId, appSecret, domain: lark.Domain.Lark})` → `wsClient.start({eventDispatcher})`
2. **消息解析**：事件体 `event.message.message_type === 'text'`，内容在 `event.message.content`（JSON 字符串需二次 parse）；忽略 `event.sender.sender_id.open_id` 为机器人自己的
3. **会话 key**：`sha256(event.message.chat_id)`（不落原始 id）
4. **回复**：`client.im.message.reply({path: {message_id}, data: {content: JSON.stringify({text}), msg_type: 'text'}})`；引用回复自动关联原消息
5. **串行**：每会话一个 Promise 队列，防止并发 prompt 打乱上下文
6. **分段**：Lark 单条 text 上限约 150KB 但卡片显示 3000 字截断 → 超长时按 2000 字分段发
7. **重连**：官方 SDK 自带断线重连，仅需监听日志
8. **群聊**：requireMention=true（默认），只响应 @机器人

## 6. 会话持久化设计（原方案遗漏，重要）

Lark 重启进程后会话将清空 → 用户接着聊会丢上下文。方案：
- `agent_sessions(chat_key TEXT PRIMARY KEY, messages_json TEXT, updated_at)` 表
- Agent 每次 turn 结束后序列化 `agent.state.messages` 存回
- 重启后 makeAgent 时从表恢复
- 兼顾简单：超 50 条消息做截断（保留 system + 最近 40 条）

## 7. 时区处理

- SQLite 全部存 `YYYY-MM-DD`（本地 Asia/Shanghai 日期）， cron/逾期判断用本地日期，避免 UTC 边界错乱
- 进程启动 `process.env.TZ = 'Asia/Shanghai'`

## 8. 数据安全与备份（网盘同步风险！）

⚠️ 项目目录在百度网盘同步盘内，SQLite 被网盘在线同步可能损坏。**用户决定：所有文件一律放本目录内**，因此用软件手段防损：
1. db 固定在 `app/data/mypm.db`，开 WAL：`PRAGMA journal_mode=WAL`
2. 每日 cron 顺带备份：`VACUUM INTO '../backups/mypm-YYYYMMDD.db'`，保留最近 14 份（同在本目录）
3. 启动时 `PRAGMA integrity_check`，失败自动从最近一份备份恢复并告警

## 9. 错误处理矩阵

| 故障 | 处理 |
|---|---|
| GLM 超时/5xx | 提取重试 1 次；失败时 Lark 回复"提取失败，请稍后重试或直接告诉我要加什么任务" |
| Lark WS 断线 | SDK 自动重连；日志记录；连续失败 3 次推飞书告警（Webhook 与 WS 通道独立，可互相告警） |
| 飞书 Webhook 限流 | 1 秒 5 条以内，提醒卡片合并为 1 条/天，不会触限 |
| agent 工具抛错 | pi 自动以 isError 回传给 LLM 自行重试/改口 |
| 用户发图片纪要 | P1：GLM-4.7 支持 vision，Lark im.message resource 下载后转 base64 传入；首期只回"请发文本" |

## 10. 部署与常驻方式（Windows）

| 项 | 方案 |
|---|---|
| 启动 | `npm run dev`（开发）/ 打包 `tsx` 常驻：`npm start` |
| 开机自启 | Windows：自建 bat（cd app && npm run dev）放 shell:startup；Mac：见 DEPLOY launchd |
| 日志 | console + `>> logs/mypm.log` 重定向；按天轮转（P1 换 pino） |
| 停止旧服务 | Vikunja exe 进程、dsh node 进程关闭（v2 验证后执行） |

## 11. 验收用例清单（端到端测试脚本化）

1. 终端 chat：贴 e2e.ts 内嵌样例纪要 → 得到拟更新清单（2 项目/4 任务/2 资源/2 摘要）→ "确认" → 查库行数正确
2. 拒绝路径：提取后回复"第 2 条不要" → agent 调 discard 或部分应用 → 库内无该任务
3. 查询："今天我该干嘛" → 按项目分组、含逾期标记
4. 单条操作："把版图终稿推迟到 9 月 20" → update_task 生效
5. Lark 全流程重复 1-4
6. `npm run check` → 飞书收到卡片；再跑一次不重复
7. 看板：甘特图任务条/里程碑/今日线渲染，勾选完成 → 刷新保持
8. 重启进程 → Lark 里接着上文聊（会话恢复生效）

## 12. 已识别但未决策的事项

- 提取走 agent 自身 or 工具内独立调用？（当前定后者：稳定、prompt 固定、不吃 agent 上下文）
- 周报生成（P1"问 agent"）是否要提前？——建议验证期后再说
- 看板要不要鉴权？——内网穿透前加一个简单 Bearer token 即可，穿透时再启用
