# Lark/飞书 接入教程（从零到机器人上线）

> 目标：10 分钟内让你的 mypm 机器人在 Lark/飞书里能聊天、能主动提醒。**全程不需要公网服务器、不需要域名**（WebSocket 长连接，本机直连）。

## 你需要准备什么

| # | 东西 | 用途 | 最终填到哪 |
|---|---|---|---|
| 1 | 一个 Lark/飞书 账号 | 创建应用、和机器人聊天 | — |
| 2 | **自建应用**的 App ID + App Secret | 机器人身份证 | `config.json → lark.appId / lark.appSecret` |
| 3 | 应用发布权限 | 个人版可直接发；企业版可能需管理员审核 | — |
| 4 | （可选）群自定义机器人 Webhook | 提醒的备用通道 | `config.json → notify.webhook` |

## 第一步：创建自建应用

1. 打开开发者后台：
   - 国际版 Lark：`https://open.larksuite.com` → 控制台
   - 国内飞书：`https://open.feishu.cn` → 开发者后台
2. **创建企业自建应用**，名称建议 `mypm`（或你喜欢的），描述随意
3. 创建后进入应用 →「凭证与基础信息」页，能看到：
   - **App ID**（形如 `cli_a1b2c3d4e5f6`）
   - **App Secret**（一长串）

记下这两个值 → 填到 `config.json`：

```json
"lark": {
  "appId": "cli_a1b2c3d4e5f6",
  "appSecret": "你的AppSecret",
  "domain": "lark"
}
```

> `domain` 填哪个？**国际版 Lark 填 `"lark"`，国内飞书填 `"feishu"`**。填错了会连不上。

## 第二步：开启机器人能力

应用后台 →「添加应用能力」→ 添加**机器人**。设置机器人名称/头像（这就是你在聊天列表里看到的样子）。

## 第三步：开通权限（3 个）

应用后台 →「权限管理」，搜索并开通：

| 权限标识 | 权限名称 | 干什么用 |
|---|---|---|
| `im:message.p2p_msg:readonly` | 获取用户发给机器人的单聊消息 | 听你私聊说话 |
| `im:message.group_at_msg:readonly` | 获取群组中 @机器人 的消息 | 听群里 @它 |
| `im:message:send_as_bot` | 以应用身份发消息 | 开口回复你 |

## 第四步：事件订阅（关键，选长连接）

应用后台 →「事件与回调」：

1. 订阅方式选择 **「使用长连接接收事件」**（不要填 Webhook URL——那需要公网）
2. 添加事件：**`im.message.receive_v1`**（接收消息）
3. 保存

> 长连接模式 = 你的电脑主动连 Lark 服务器拉消息，所以家里电脑/内网服务器都能用。

## 第五步：发布应用

1. 「版本管理与发布」→ 创建版本 → 提交发布（个人测试范围即可）
2. 企业版可能需管理员审批，等通过
3. 发布后在 Lark/飞书里搜索你的机器人名，**发起私聊，发一句"你好"**

> ⚠️ **首次私聊很重要**：mypm 靠这次私聊记住你的身份（open_id），之后的每日提醒才能主动私聊推给你。

## （可选）第六步：群 Webhook 备用通道

提醒默认走机器人私聊（第五步完成即可）。如果想加一条群机器人兜底：

1. 打开一个 Lark 群 → 设置 → 群机器人 → 添加「**自定义机器人**」
2. 复制 Webhook 地址（形如 `https://open.feishu.cn/open-apis/bot/v2/hook/xxxx-xxxx`）
3. 填到 `config.json → notify.webhook`

## 验收清单

```bash
cd app && npm run dev
```

| 检查项 | 期望 |
|---|---|
| 启动日志出现 `Lark WebSocket 已连接` | ✅ 长连接建立 |
| 私聊机器人"你好" | 秒回自我介绍 |
| 发一段会议纪要文字 | 返回拟更新清单 → 回"确认"入库 |
| 终端 `npm run check` | 机器人私聊收到提醒卡片 |

## 排错速查

| 症状 | 原因/处理 |
|---|---|
| 启动报 `未配置 LARK_APP_ID/SECRET` | config.json 的 lark 节没填对 |
| 日志无 `WebSocket 已连接` | domain 填错（lark vs feishu）；公司网络拦 wss |
| 机器人不回话 | ① 权限还在审批中 ② 事件没订阅 `im.message.receive_v1` ③ **应用没发布新版本**（改配置不发版不生效）|
| 群里 @ 不回 | 群聊默认要求 @机器人；确认 `im:message.group_at_msg:readonly` 已开 |
| 提醒收不到 | 必须先和机器人**私聊过至少一次**（注册身份）|
| 提醒走 Webhook 报 `Bot Not Enabled` | 群里的自定义机器人被移除/停用了，重新添加或清空 notify.webhook |
| 换电脑后消息时有时无 | **同一 appId 只能有一处长连接在跑**，旧机器必须停服务 |

## 安全提醒

- App Secret 等同于机器人密码，只放 `config.json`（已 gitignore）或用 `"$环境变量"` 引用，**不要**贴进文档/截图/提交
- 建议定期在开发者后台轮换 Secret（轮换后同步改 config.json 并重启）
