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
27. 测试数据：样例纪要内嵌于 app/scripts/e2e.ts；v2 验收用例 = DETAILS.md #11 的 8 条
28. 旧进程处置：v2 全部验收通过后，关闭 Vikunja（exe）与 dsh（node）进程；v1 遗留（mypm.py/Vikunja/docker-compose/data）已于 2026-08-29 清理，prompt 参照 app/src/ai.ts

## 决议 #29（2026-08-30）：配置体系改单一 config.json（pi 风格），.env 退役

- 调研结论：主流 agent 项目（pi/nanobot/dsh）均以单一配置文件为入口，不用 .env
- 采用 pi 精华：密钥字段值支持 `$VAR`/`${VAR}` 环境变量引用（`$$` 转义；未定义→空+警告）
- config.json gitignore + config.example.json 模板提交；缺字段用内置默认；dotenv 依赖移除
- 附带收益：cron 时刻/提醒窗口/会话参数全部可配；ESM import 早于 env 加载的时序坑根除

## 决议 #30（2026-08-30）：LLM 多 provider 化

- config.json llm 节：provider+model 指定当前用哪家；custom[] 声明任意数量自定义端点
  （api: openai-completions | anthropic-messages，各自 apiKey 支持 $ENV 引用）
- 实现：ai.ts registerCustom() 用 pi 的 createProvider 注册；内置 zai 始终可用；
  getModel 失败时列出可用模型清单后退出
- 旧 glm{apiKey,model} 节自动迁移为 llm 节（向后兼容）
- 切换模型 = 改 config.json 两行 + 重启，不动代码

## 决议 #31（2026-08-30）：provider 完全统一，取消智谱内置特例

- 用户反馈"内置 zai-coding-cn + custom[]"的心智模型抽象；改为所有厂家一律在
  llm.providers[] 平等声明（智谱=普通一项，baseUrl/api/key/models 全显式）
- ai.ts 移除 zaiCodingCnProvider 引用；registerCustom 是唯一注册路径
- 旧配置兼容：llm{apiKey} / glm 节 → 自动合成 zhipu provider 项
- README llm 节同步重写（顶层选厂家，providers[] 抄段即增厂家）

## 决议 #32（2026-08-30）：Agent 定时器工具（set_timer / list_timers / cancel_timer）

- timers 表：run_at(一次性) 与 cron(周期) 二选一；状态 active/fired/cancelled
- 调度：周期任务动态注册 node-cron（内存 Map，重启时恢复 active）；一次性由每分钟
  tick 扫描，run_at<=now 即触发（服务宕机错过的时刻会在重启后首个 tick 补发一次）
- 触发动作：机器人私聊卡片（复用 notifyCard，与每日任务提醒同通道）
- 相对时间（明天下午3点）由 AI 换算为绝对 run_at（prompt 规则 12）
- 测试：单元 5 用例（过去触发/未来不触发/cron注册/取消/列表）+ AI e2e 四轮全过

## 决议 #33（2026-08-30）：工具数量策略——维持 14 个，设定优化触发阈值

调研基准：pi coding-agent 核心 8-12 个 LLM 工具、Claude Code ~11 个、业界警戒线 40
（Cursor 实验值）；弱模型 5+ 即可能降选择准确率，但那是多 MCP 杂混场景；
RAG-MCP（按查询动态注入工具）适用于几十上百个工具的规模。

当前定性：14 个为同域原子 CRUD（读 4 / 写 10），description 精确互斥，
历次 e2e 工具选择零失误；唯一成本为每轮 ~1200 token schema 开销，可忽略。

**触发再优化的信号（任一出现）**：① 观察到 AI 调错工具 ② 工具数将超 20
③ 更换更小参数量的模型。优化路径按序：合并同类（如 create+update→save_task）
→ 动态工具检索（RAG-MCP 式）→ 按域拆分 agent。

## 决议 #34（2026-08-30）：Lark 回复渲染——模型原生 MD + 确定性转换为卡片

- 根因：Lark text 消息不渲染任何 markdown（##/**/- 全是字面字符）
- 方案（用户提出，优于约束模型输出）：**模型保持原生标准 markdown 输出**
  （认知一致性/生成质量最优，prompt 零改动），发送侧 mdToLark 确定性转换后
  以 interactive 卡片（lark_md div，无 header）回复；卡片失败自动降级 text
- lark_md 能力边界（官方文档）：支持 **粗体**/斜体/删除线/链接/@/表情/代码块(7.6+)；
  不支持 # 标题、列表符号、表格 → 转换规则：H1/H2→**【】**，H3+→粗体，
  -/*/+→•（缩进保留），有序列表保留，图片→链接，引用→▎，---→长横线，
  表格行→" ｜ "文本化，行内 code 去壳；代码块内不转换；空行折叠
- 规则表 17 用例单测锁行为（scripts/test-card.ts，npm test 外单独跑）
- 超长回复按行边界 ~1900 字符分多卡

## 决议 #35（2026-08-30）：AI 感知看板地址 + 监听 0.0.0.0（家庭局域网直访）

- 启动探测局域网 IPv4（192.168/10/172 段，过滤回环，含虚拟网卡全部列出）
  连同 config.app.port 注入 system prompt——静态信息用 prompt 而非工具（免一轮调用）
- web 监听 127.0.0.1 → 0.0.0.0：手机/家庭网段设备可直访看板；Windows 首次启动
  需在防火墙弹窗允许；公网访问仍需自行穿透+鉴权（边界不变，README 已注明）
- e2e：问"手机怎么看板"→ 列出局域网地址并提示穿透条件 ✓

## 决议 #36（2026-08-30）：看板地址改为每轮动态 system prompt（修正 #35 的静态注入）

- #35 缺陷：IP 在进程启动时缓存注入 prompt，网络变化/换机后回答旧值（用户迁移
  server1 时暴露：AI 报的还是旧 Windows 机器的网卡）
- 修正：lanIPv4s() 每次调用实时探测；askAgent 每轮 prompt 前刷新
  state.systemPrompt（日期也随之跨天更新）——os.networkInterfaces() 成本微秒级
- 否决"加 get_dashboard_url 工具"方案：动态信息若可廉价预知，prompt 每轮刷新
  优于工具（免一轮调用、工具数维持 14 不增）；真正"调用时才产生"的信息才值得做工具

## 决议 #37（2026-08-31）：提醒机制改为每日重复 + 三档分级（阈值可配）

- 旧机制（进窗口提醒一次+逾期日一次）信息量不足；改为：窗口内（remindDays，默认7）
  每天提醒直到完成；≤remindHighlightDays（默认3，新增配置）为重点档❗，逾期为红色档
- 卡片三段式：🔴逾期 / 🟠N天内重点 / ⚪窗口内普通；模板色 red/orange/blue
- reminders 表重构（task_id,date 按天去重，替代旧 task_id,kind 一次性去重），
  旧表自动重建（去重态数据可弃）；同日多次 runCheck 只发一张卡
