# mypm v2 — AI Native 个人项目管理助手

会议纪要丢给 AI → 提取待办/里程碑/资料 → 对话确认 → 入库 → 关键节点提醒。Lark 私聊是主入口，本地网页看板（甘特图）做总览。

## 架构

```
Lark 私聊 ⇄ lark.ts（WebSocket 长连接）
              ⇄ pi Agent（glm-4.7，9 个工具）
                   ⇄ db.ts（SQLite，app/data/mypm.db）
看板 http://127.0.0.1:8787（甘特图/任务/资料）
定时：每天 9:00 扫描提醒（机器人私聊卡片 + Webhook 备用）+ 每日备份
```

## 启动

```bash
# 双击项目根目录 start-mypm.bat，或：
cd app && npm run dev
```

- 看板：http://127.0.0.1:8787（📈甘特图/📋任务列表/🗂看板三视图；任务与项目居中弹窗编辑、资料增删改、⚙自定义字段）
- Lark：直接私聊机器人（首次私聊自动记住你的身份，用于提醒推送）
- 日志：`logs/mypm.log`、`logs/mypm-run.log`；备份：`backups/`（保留14份）

## 日常用法（都在 Lark 私聊里）

- **丢纪要**：粘贴会议纪要/周报 → 机器人回复拟更新清单 → 回「确认」入库；要改就说"第X条改成…"
- **查询**："今天我该干嘛" / "XX项目进展" / "有什么逾期的"
- **单条操作**："把XX任务推迟到下周三" / "XX任务完成了" / "记一下XX项目的微信群叫YY"
- **手动触发提醒**：终端 `cd app && npm run check`
- **终端调试对话**：`cd app && npm run chat`

## 配置（.env，项目根）

`ZAI_CODING_CN_API_KEY`（GLM）、`LARK_APP_ID/SECRET`（应用机器人）、`FEISHU_WEBHOOK`（备用提醒）、`REMIND_DAYS`（提醒窗口，默认7）、`PORT`（看板端口）

## 文档

- FEATURES.md — 功能清单与 PM 软件对照
- IMPLEMENTATION.md — 架构与模块设计
- AI-NATIVE.md — AI 连接细节（工具、循环、确认流）
- DETAILS.md — 环境、坑、验收用例
- DECISIONS.md — 全部实现决议

## 遗留（二期）

图片纪要（GLM vision）、优先级/状态流、重复任务、子任务、日历视图、任务依赖、内网穿透远程看板、微信推送（pushplus）

## 历史

v1（mypm.py + Vikunja）已退役并清理；v2 为 pi agent + 自建数据层。
