# mypm — 开工前决议清单（DECISIONS）

> 目的：消灭所有"写代码时才想起来没定"的模糊点。每条都已定论，实现时不再询问。分【修正的文档矛盾】和【新增决议】两部分。

## 一、修正的文档矛盾

| # | 矛盾 | 决议 |
|---|---|---|
| 1 | IMPLEMENTATION 写 db 在 `app/data/mypm.db`，DETAILS 写放 `~/.mypm/` | **用户最终决定：所有文件一律放本目录内，禁止读写目录外任何位置。** db 在 `app/data/mypm.db`；备份 `VACUUM INTO` 到 `mypm/backups/`（同目录）；日志 `mypm/logs/`。网盘同步损坏风险对策改为：WAL 模式 + 每日备份保留最近 14 份 + 启动时 `PRAGMA integrity_check` 失败自动从最近备份恢复 |
| 2 | IMPLEMENTATION 3.1 自写 GLM provider vs DETAILS 发现的内置 `zaiCodingCnProvider()` | **先试内置**（env `ZAI_CODING_CN_API_KEY`=GLM key）；若装包后模型目录无 glm-4.7 或调用异常，立即切自写 provider（签名已源码核对）。两套代码都备好，10 分钟内可切换 |
| 3 | AI-NATIVE 的 propose_updates 参数有 `project_hint?` | 删除。项目归属由提取器结合现有项目列表自行判断（prompt 已含现有项目清单） |
| 4 | .env 位置 | 项目根 `mypm/.env`（与 mypm.py 共用现状），app 启动时 `dotenv` 从根目录加载 |
| 5 | FEATURES P0 表里 tasks 含 priority/status 字段但 P0 不实现 | P0 建表**就带上** priority(P3 默认)/status(todo 默认) 列，但工具与看板不暴露；P1 只加逻辑不改表 |

## 二、新增决议（此前完全没定的点）

### 数据与工具语义

6. **项目名匹配**：工具参数 `project` 用 `LIKE '%name%'` 模糊匹配；propose_updates 的提取 prompt 里注入现有项目精确名单，LLM 优先归到现有项目，确实全新才 `is_new:true`
7. **日期基准**：agent system prompt **动态注入今天日期**（"今天是 2026-08-29 周六"），所有相对日期（下周三）由 LLM 换算成 YYYY-MM-DD 后传参；提取器 prompt 同样注入今天
8. **due_date 无年份**（"9月15日"）：按"未来最近的该日期"解析
9. **apply_updates 幂等**：pending→applied 状态机；对已 applied 的 id 再调用返回错误"已应用过"；同一会话允许存在多个 pending（各自 update_id 区分）
10. **update_task 不支持改项目归属**（P1 再加 move_task）
11. **并发写**：better-sqlite3 同步 API + WAL，看板 toggle 与 agent 写库天然安全，无需锁
12. **删除操作**：P0 不做 delete 工具（防误删）；done=false 可复活任务；删除走看板或直接 SQL

### 提醒策略（此前没定义清楚）

13. **提醒节奏**：每个任务最多 2 次——①首次进入 7 天窗口时 1 次；②逾期当天 1 次（若当时已完成则跳过）。全部记录于 reminders(task_id, kind, date)，主键 (task_id, kind)
14. cron 每天 9:00 跑；`npm run check` 同一逻辑手动触发
15. 提醒卡片按项目分组，逾期段在前

### Lark 行为

16. 收到非文本（图片/文件）首期回复固定话术："暂只支持文本，请粘贴纪要文字（图片支持开发中）"
17. agent 提取期间（可能 1-3 分钟）先回一条"收到，正在提取…"，完成再发清单（lark.ts 在 tool_execution_start 且工具名=propose_updates 时触发）
18. 群聊与私聊都启用；群聊 @机器人 触发，会话独立
19. agent 单会话处理超时上限 5 分钟，超时 abort 并回复"处理超时，请稍后重试或换种说法"

### 看板

20. 甘特图默认时间范围：最早任务 start 前 7 天 ～ 最晚 due_date 后 14 天；view mode 默认 Week，可切 Day/Week/Month/Year（frappe-gantt 新版 API：`gantt.change_view_mode("Week")`，Quarter/Half Day 已移除）
21. **里程碑渲染（已核对 frappe-gantt master API 后定的方案）**：新版未内置 milestone 类型与 custom_class 文档化支持 → 里程碑=单日任务（start=end=due_date），任务名前加 "◆"，弹层(popup)显示"里程碑"；若 CSS 定制需求强烈再换 dhtmlxGantt（GPL）
22. 看板 P0 无鉴权，仅监听 127.0.0.1（内网穿透时改 0.0.0.0 并加 Bearer token，届时再说）
22b. 看板页面结构（定稿）：顶部汇总卡（项目数/7天内到期/逾期数）→ 项目过滤下拉（全部/单项目）→ 甘特图区（frappe-gantt，CDN master 版）→ 任务清单表（勾选完成、逾期红标、里程碑◆）→ 右侧资料面板（选中项目的群名/链接，可点击）。单页 `index.html` + 原生 fetch，无构建

### 施工级核对补充（2026-08-29，全部源码/官方类型验证完毕）

23b. **pi 事件**：回复文本从 `message_end` 事件取（message.role=assistant，拼接其中 type=text 的 content block）；"本轮全部结束"=`agent_end`（携带最终 messages）；工具状态用 `tool_execution_start/end`（含 toolName、isError）。`agent.prompt(str)` 直接收字符串
23c. **pi-ai 单次调用（提取器用）**：`streamSimple(model, {systemPrompt, messages}, {apiKey?})` 返回事件流，收 `done` 事件取 `message.content` 文本；`error` 事件带 errorMessage。Context={systemPrompt?, messages, tools?}
23d. **Lark SDK（@larksuiteoapi/node-sdk 类型定义已核）**：`new WSClient({appId, appSecret, domain: Domain.Lark})` → `.start({eventDispatcher})`；`EventDispatcher` 实例 `.register({"im.message.receive_v1": handler})`；事件 payload 精确结构：`data.message.{message_id, chat_id, chat_type('p2p'|'group'), message_type, content(JSON字符串), mentions[]}`、`data.sender.sender_id.open_id`；回复用 `client.im.message.reply({path:{message_id}, data:{content: JSON.stringify({text}), msg_type:'text'}})`；群聊 mentions 里含机器人 open_id 判断是否被 @

### 会话

23. 会话截断保留 system + 最近 40 条；`agent_sessions` 表持久化，重启恢复
24. 多设备/多窗口同一 chat_id → 同一会话（天然，因为 key 是 chat_id）

### 工程杂项

25. Node 进程 `TZ=Asia/Shanghai`；日志同时写 console 与 `logs/mypm.log`（append，按周手动清理即可）
26. `npm run chat` 终端模式：stdin 逐行 → agent.prompt()，与 Lark 共用同一 agent.ts 组装函数
27. 测试数据：沿用 `sample-meeting.md`；v2 验收用例 = DETAILS.md #11 的 8 条
28. 旧进程处置：v2 全部验收通过后，关闭 Vikunja（exe）与 dsh（node）进程；mypm.py 保留在仓库根作 prompt 参照，不再维护
