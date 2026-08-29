# mypm 换机部署指南（Windows → Mac / 任意新机）

> 原理：mypm 是纯本地程序（Node + SQLite），无云依赖。Lark 用 WebSocket 长连接**不需要公网 IP**，换机后在新机跑起来、旧机停掉即可无缝接管。GLM/飞书都是外部 API，无本机绑定。

## 一、迁移三要素

| 必须带走 | 位置 | 说明 |
|---|---|---|
| **代码** | git 仓库（推荐 clone/push）或整目录拷贝 | 不含 node_modules 也行，新机 `npm install` 重建 |
| **数据** | `app/data/mypm.db`（+ `backups/`） | **迁移前先停服务**（WAL 未落盘会丢尾部数据） |
| **配置** | `.env`（根目录） | gitignore 了不会随仓库走，需单独拷贝；内容全平台通用 |

可选：`logs/`（一般不要）、`ref/`、`pi-main/`（参考资料，可不带）。

## 二、Mac 部署步骤

### 1. 环境准备（一次性）

```bash
# Node ≥ 22（含 24）
brew install node@22   # 或官网 pkg 安装
node -v

# better-sqlite3 是原生模块，Mac 编译需要 Xcode 命令行工具
xcode-select --install
```

### 2. 拿代码 + 装依赖

```bash
# 方式A：git（推荐，先在旧机 push）
git clone <你的仓库地址> mypm && cd mypm

# 方式B：整目录拷贝（U盘/网盘同步），跳过 node_modules 亦可
cd mypm/app
npm install          # 重建依赖，better-sqlite3 会自动编译 Mac 原生二进制
```

### 3. 放数据与配置

```bash
# .env 拷到项目根（内容无需改动）
# 旧机的 app/data/mypm.db 拷到新机同路径（覆盖前确保新机服务未启动）
```

### 4. 启动

```bash
cd app
npm run dev          # 前台运行：Web 看板 + Lark 桥 + 每日9点提醒
```

验证：
- 看板 http://127.0.0.1:8787
- 日志出现 `Lark WebSocket 已连接`
- Lark 私聊机器人一句话测试；`npm run check` 验证提醒推送

> `start-mypm.bat` 是 Windows 专用，Mac 直接 `npm run dev`（或见下文自启动）。

## 三、旧机停用

1. 旧机停服务（关掉 mypm 窗口/进程）
2. **关键**：同一 Lark 应用凭证只应有一处长连接在跑——旧机不停，消息会被两台机器随机分流（历史事故：dsh 与 mypm 同 appId 抢消息）
3. 旧机的 `.env` 若不再用可留档删除

## 四、Mac 开机自启（可选，launchd）

`~/Library/LaunchAgents/com.mypm.app.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.mypm.app</string>
  <key>WorkingDirectory</key><string>/Users/你的用户名/路径/mypm/app</string>
  <key>ProgramArguments</key><array>
    <string>/opt/homebrew/bin/node</string>
    <string>/路径/mypm/app/node_modules/tsx/dist/cli.mjs</string>
    <string>src/index.ts</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/路径/mypm/logs/mypm-run.log</string>
  <key>StandardErrorPath</key><string>/路径/mypm/logs/mypm-run.log</string>
</dict></plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.mypm.app.plist   # 启用
launchctl unload ~/Library/LaunchAgents/com.mypm.app.plist # 停用
```

（`which node` 确认 node 真实路径填入；Intel Mac 是 `/usr/local/bin/node`）

## 五、Linux 服务器部署

与 Mac 步骤一致，差异仅：
- 原生编译：`apt install build-essential python3`（Debian/Ubuntu）
- 常驻：`nohup npm run dev >> ../logs/mypm-run.log 2>&1 &` 或 systemd unit（参照上面 launchd 改）

## 六、常见问题

| 症状 | 原因/处理 |
|---|---|
| `npm install` 卡在 better-sqlite3 编译报错 | 缺编译链：Mac 装 Xcode CLT；Linux 装 build-essential；或换 `Node LTS 22`（有预编译包可免编译） |
| 启动报 `Provider is not configured: zai-coding-cn` | `.env` 没拷/没在项目根；确认 `ZAI_CODING_CN_API_KEY` 在 |
| Lark 收不到消息 | ① 日志有无 `Lark WebSocket 已连接`；② **旧机服务是否还开着**（分流事故）；③ 换网络后公司代理拦 wss |
| 提醒/日期差一天 | 机器时区需为 Asia/Shanghai（`sudo systemsetup -settimezone Asia/Shanghai`） |
| 看板想远程访问 | 监听是 127.0.0.1；用 frp/tailscale/cloudflare tunnel 转发 8787 端口（加鉴权后再公网） |
| 数据库损坏告警 | 自动从 backups/ 恢复最近一份；平时别用网盘**实时**同步 mypm.db（本项目按百度网盘同步设计过，备份机制会兜底） |

## 七、迁移后回归清单

```bash
cd app
npm run chat          # 终端对话：问"列出所有项目"验证 AI + 数据都在
npm run check         # 手动触发提醒（机器人私聊应收到卡片）
```

> `app/scripts/` 下的开发/测试脚本（debug-web.py 等）**不随 git 分发**（已 gitignore），新机上按需自写或从旧机拷贝；上面两条命令已覆盖核心回归。
