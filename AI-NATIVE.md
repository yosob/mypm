# mypm — AI Native 实现细节（AI-NATIVE）

> 回答核心问题：**AI 到底怎么"长"在这个程序里**。消息如何流到 AI、AI 如何决定调什么工具、工具结果如何回到 AI、确认流程怎么在对话里完成、上下文怎么管理。三份前置文档：FEATURES（做什么）、IMPLEMENTATION（模块结构）、DETAILS（环境细节）。

> **2026-08-29 更新**：工具集从 9 个扩到 **11 个**，看板新增属性（排期/优先级/项目状态与截止日/任务级资料/自定义字段）已全部双向接入 AI（第四节工具总表、第七节落地清单）。原则：**看板能做的 AI 都能做，AI 做的看板都能看**；唯一非对称是删除——仅看板可删，AI 永不删（防误删）。

## 一、AI 在系统中的两个使用位置（关键设计）

```
                    ┌─────────────────────────────────┐
  Lark 消息 ──────▶ │  ① Agent 循环（pi Agent + glm-4.7）│ ◀──── 终端 chat（调试）
                    │     "大脑"：理解意图、选工具、组织回复 │
                    └───────────┬─────────────────────┘
                                │ 调用工具（结构化 JSON 参数）
                    ┌───────────▼─────────────────────┐
                    │  ② propose_updates 工具内部       │
                    │     "专用提取器"：再调一次 glm-4.7  │
                    │     固定 prompt → 严格 JSON       │
                    └───────────┬─────────────────────┘
                                │ 纯函数
                    ┌───────────▼──────────┐
                    │  db.ts（SQLite）      │  ← AI 永远不直接碰
                    └──────────────────────┘
```

**为什么两次调 LLM、各司其职**：

| | ① Agent 循环 | ② 提取器 |
|---|---|---|
| 角色 | 理解你说了什么、决定做什么 | 把非结构化纪要变成结构化数据 |
| prompt | 系统提示（角色+规则），动态对话 | 固定模板（mypm.py 已验证），temperature 0.1 |
| 输出形态 | 自由文本 + 工具调用 | 严格 JSON（剥 ```json 壳） |
| 失败影响 | 自己重试/换说法 | 报错给 agent，agent 告诉你 |
| 上下文 | 持续多轮（有会话记忆） | 一次性，不占会话上下文 |

这就是"AI native"的含义：**不是给传统 PM 加个聊天入口，而是 AI 是唯一的操作面**——所有增删改查都经 AI 的工具调用发生，Web 看板只是数据的只读投影（外加勾选）。

## 二、一次完整对话的生命周期（以丢纪要为例）

```
你(Lark): "今天项目周会：读出芯片版图下周三前发流片厂评估，9月15日交终稿……"
  │
  ▼ 1. lark.ts 收到 im.message.receive_v1 事件，解析出文本
  ▼ 2. 按 chat_id 哈希找/建 Agent 实例（会话隔离）
  ▼ 3. agent.prompt(text) —— pi 把 [system + 历史 + 新消息 + 9个工具定义] 发给 glm-4.7
  ▼ 4. glm-4.7 返回 tool_use: propose_updates({content: "<纪要原文>"})
  │     （AI 自己判断这是纪要 → 选中提取工具，并原样传入文本）
  ▼ 5. pi 执行该工具：
  │     a. 拼 prompt：固定模板 + db.listProjects() 注入现有项目名
  │     b. 调 glm-4.7（temperature 0.1）→ 严格 JSON
  │     c. 解析校验 → 写 pending_updates 表（status='pending'）→ 拿到 update_id
  │     d. 返回给 AI：人类可读清单文本（"拟新建项目X、任务2条：…，回复'确认'生效"）
  ▼ 6. pi 把工具结果作为 tool_result 追加，再次调 glm-4.7
  ▼ 7. glm-4.7 生成自然语言回复（转述清单+请求确认）
  ▼ 8. lark.ts 从 subscribe 事件取 assistant 文本 → im.message.reply 发回 Lark
  │
你(Lark): "确认"
  │
  ▼ 同一 Agent 实例（有上下文，记得刚才的清单）→ AI 调 apply_updates({update_id})
  ▼ 工具读 pending_updates → 事务写入 projects/tasks/resources/history
  ▼ AI 回复 "✅ 已入库：项目X 2条任务，里程碑9月15日……"
  ▼ lark.ts 发回 Lark；agent_sessions 表序列化本轮消息
```

**关键点**：确认状态不在 AI 里，在 `pending_updates` 表里。AI 只是"念出"清单和"执行"apply_updates——就算 AI 忘了上下文，update_id 还在库里，你说"应用刚才的更新"它查表也能完成。这是把状态外置的 AI native 设计，防幻觉。

## 三、Agent 循环的机制细节（pi 内部做了什么）

```typescript
// 我们只写这些：
const agent = new Agent({
  initialState: { systemPrompt, model, tools: pmTools, messages: [] },
  streamFn: models.streamSimple.bind(models),
});
agent.prompt(text);          // 之后 pi 自动跑循环
agent.subscribe(evt => ...); // 我们只观察事件
```

pi 的循环（无需我们实现，但要理解）：

```
prompt → LLM → 返回含 tool_use?
  ├─ 否 → 循环结束，assistant 文本即回复
  └─ 是 → 逐个执行工具 execute() → 结果包成 tool_result 追加到 messages
          → 再次调 LLM（它看到结果决定继续调工具还是收尾）
          → 最多 N 轮（上下文超限自动触发压缩/报错）
```

事件序列（subscribe 可见）：`agent_start → turn_start → message_start/update(text_delta 流式)/end → tool_execution_start → tool_execution_end → turn_end → … → agent_end`

我们要写的胶水：
- `message_end` 且 role=assistant 且循环结束 → 文本发 Lark
- `tool_execution_end` → 可选发一条"⚙️ 已执行 list_tasks"轻提示
- `text_delta` → 攒着做 Lark 卡片的"生成中…"动效（P1）

## 四、工具定义实例（AI 与数据的连接点，完整代码形态）

```typescript
import { Type } from "@earendil-works/pi-ai";

export const listTasksTool: AgentTool = {
  name: "list_tasks",
  label: "查询任务",
  description: "列出任务。可按项目过滤、按截止窗口过滤。用户问'今天该干嘛/进展'时用本工具。",
  parameters: Type.Object({
    project: Type.Optional(Type.String({ description: "项目名，模糊匹配" })),
    due_within_days: Type.Optional(Type.Number({ description: "只看N天内到期的" })),
    include_done: Type.Optional(Type.Boolean({ description: "是否包含已完成，默认false" })),
  }),
  async execute(toolCallId, params) {
    const rows = db.listTasks(params);            // 纯函数查 SQLite
    const text = formatTasks(rows);               // 按项目分组、逾期标红、带 id
    return { content: [{ type: "text", text }] }; // 这个文本会成为 tool_result 给 AI
  },
};
```

**description 就是给 AI 的说明书**——AI 完全靠 name+description+参数描述来决定何时调、传什么。写好 description = 调教 AI 行为的最重要手段（比改 system prompt 更精确）。

工具结果里**带 id**（如任务 id=17），这样用户说"把17推迟到下周三"，AI 就能调 `update_task({task_id:17, due_date:"2026-09-02"})`——自然语言到精确参数的映射在工具层闭环。

### 工具总表（v2，共 11 个）

| 工具 | 读/写 | 覆盖的看板功能 |
|---|---|---|
| `list_projects` | 读 | 项目总览（含状态/目标/项目截止日；任务带排期 start~due、优先级） |
| `list_tasks` | 读 | 任务查询（项目/截止窗口过滤；id/排期/状态/优先级/逾期标记） |
| `get_project_detail` | 读 | 项目详情：任务+项目资料+历史时间线 |
| `get_task` ★ | 读 | 单任务全量：排期/状态/优先级/内容/任务级资料(群/链接)/自定义字段/父子任务 |
| `propose_updates` | 写 | 纪要→拟更新（提取排期/优先级/里程碑/资源/摘要，两段式确认） |
| `apply_updates` / `discard_updates` | 写 | 确认入库 / 丢弃（幂等） |
| `create_task` | 写 | 新建（项目/标题/开始日/截止日/优先级/里程碑/备注） |
| `update_task` | 写 | 改期(起止)/状态/完成/改名/优先级 |
| `update_project` ★ | 写 | 项目目标/状态(推进中·搁置·完成)/项目截止日 |
| `add_resource` | 写 | 资料(群/链接/备注)，默认挂项目、可传 task_id 挂任务级 |
| `set_custom_field` ★ | 写 | 自定义字段（字段名模糊匹配；未定义时列出字段引导，不擅自建） |

★ = 看板功能上线后补齐的 AI 入口。

## 五、System Prompt（现行版，12 条规则）

```
你是 yosob 的个人项目管理助手（AI PM）。今天日期：{动态注入} 星期X。你通过工具操作一个本地项目库。

行为规则：
1. 绝不编造数据。任何项目/任务信息必须来自工具返回结果。
2. 用户发来会议纪要、周报等材料时：调 propose_updates，把返回的拟更新清单原样完整转述
   （含任务名、排期、归属项目、编号），并说明"回复 确认 生效；如需调整请说明"。
3. 只有用户明确同意后才调 apply_updates（用清单编号）。要求修改某条时：先 discard 该编号，
   再按修改意见用 create_task 等逐条执行并汇报。
4. 用户问"今天该干嘛/这周安排/XX项目进展"：调 list_tasks，按项目分组汇报，逾期优先标注。
5. 改期/完成/重命名/改状态：调 update_task；不知道 task_id 先 list_tasks 查。
6. 微信群、文档链接等资料：调 add_resource 挂项目（明确说挂某任务则传 task_id）。
7. 相对日期（下周三、月底）先按今天换算成 YYYY-MM-DD 再传参。
8. 未指明项目的任务放「日程安排」项目，不猜测归属。
9. 问某个任务详情/任务上挂的资料：调 get_task。
10. 设置附加属性（负责人、合同号等自定义字段）：调 set_custom_field。
11. 项目目标/状态/截止日修改：调 update_project。
12. 回复简洁中文，列表优先，不寒暄。意图不明时列选项让用户选，不自作主张写库。
```

## 六、上下文（记忆）管理细节

**一段会话的上下文构成**：
```
[system prompt（固定 ~600 token）]
[历史消息（用户/AI/工具调用+结果，逐轮累积）]
[11 个工具的 JSON schema（~1000 token/次，随每轮重发）]
[当前新消息]
```

**管理策略**（渐进）：
1. 首版：单会话 50 条消息上限，超出丢弃最旧（保留 system）
2. 观察 pi 0.84 的 `transformContext`/compaction 钩子——它有上下文压缩能力，超出直接用
3. `pending_updates`、任务库本身是**外部记忆**：AI 随时可查，不依赖会话记忆——这是设计核心，会话丢了数据不丢

**多会话隔离**：每个 Lark chat（私聊=1个，每个群=1个）独立 Agent 实例 + 独立历史。你和私聊机器人聊的内容不会串到群里。

## 七、AI native 的扩展模式（后续功能如何顺着这套骨架长出来）

| 想加的功能 | 只需要做什么 |
|---|---|
| 自然语言日期（"下周三"） | system prompt 加一条"把相对日期换算成 YYYY-MM-DD 再传参"（glm 本来就会，验证即可） |
| 周报生成 | 新工具 `weekly_report()`：查 history+tasks 组装数据返回，AI 负责写成文 |
| 主动建议 | cron.ts 扫到逾期 → 直接 `agent.followUp("有任务逾期，起草一条提醒")` → 推 Lark/飞书 |
| 图片纪要 | propose_updates 的 execute 里收 image 参数，GLM vision 输入 |
| 记住你的偏好 | system prompt 顶部注入 db 里的 preferences 表（AI 可通过 set_preference 工具写入） |

规律：**数据能力=新工具；行为调整=prompt；主动性=cron 触发 agent**。三种扩展都不动架构。

### 已按此规律落地的扩展（全部上线）

| 扩展 | 落地方式 | 状态 |
|---|---|---|
| 自然语言日期/相对日期 | prompt 规则 7（glm 原生支持） | ✅ |
| 排期（开始~截止） | create/update_task 参数 + 提取器输出 start_date | ✅ |
| 优先级 P0~P3 | 同上 + 紧急项提取规则 | ✅ |
| 项目目标/状态/截止日 | update_project 工具 | ✅ |
| 任务级资料 | add_resource 可选 task_id + get_task 读取 | ✅ |
| 自定义字段 | set_custom_field 写 + get_task 读（定义在看板⚙，AI 不擅自建） | ✅ |
| 主动提醒 | cron 9:00 → 机器人私聊卡片（纯工作流，不经 agent） | ✅ |
| 周报生成 / 图片纪要 / 偏好记忆 | 待做 | ⬜ |

## 八、为什么不用"裸 function calling 循环"自写（回应此前的讨论）

自写循环 = 手工实现：消息数组管理、工具并发/串行、流式解析、错误重试、上下文压缩、abort/steering——pi 的 Agent 类这些全有且经过 coding agent 场景锤炼。我们自写的部分只有：工具定义（业务）、lark 桥（通道）、prompt（行为）。这正是"用成熟 harness + 自有工具生态"的分工。
