#!/usr/bin/env python3
"""mypm - 个人 AI 项目管理助手

用法:
  python mypm.py ingest <文件或文本>   处理会议纪要：AI 提取 -> 确认 -> 写入 Vikunja
  python mypm.py check                扫描临近/逾期任务并推送飞书提醒
  python mypm.py today                终端打印项目总览
"""
import base64
import json
import mimetypes
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx
from dotenv import load_dotenv
import os

load_dotenv(Path(__file__).parent / ".env")

VIKUNJA_URL = os.getenv("VIKUNJA_URL", "http://localhost:3456/api/v1").rstrip("/")
VIKUNJA_TOKEN = os.getenv("VIKUNJA_TOKEN", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.deepseek.com/v1").rstrip("/")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "deepseek-chat")
FEISHU_WEBHOOK = os.getenv("FEISHU_WEBHOOK", "")
REMIND_DAYS = int(os.getenv("REMIND_DAYS", "7"))

EXTRACT_PROMPT = """你是项目管理助手。从下面的会议纪要中提取信息，输出严格的 JSON（不要 markdown 代码块，不要多余文字）。

现有项目列表（用于匹配，若纪要中的项目不在其中则 is_new=true）：
{projects}

输出格式：
{{
  "items": [
    {{
      "project": "项目名（匹配现有项目请用原名的精确 id 对应的 title；新项目给个简短名字）",
      "is_new": false,
      "action": "create_task",
      "title": "待办/任务标题",
      "due_date": "YYYY-MM-DD 或 null",
      "description": "补充说明（可包含微信群名、链接等）",
      "notes": "本条对应的会议结论摘要，会追加到项目历史"
    }}
  ],
  "project_updates": [
    {{
      "project": "项目名",
      "summary": "该项目本次会议的整体进展摘要（1-3 句）"
    }}
  ]
}}

规则：
- 每个可执行待办一条 item（action=create_task）
- 时间节点（评审、交付、截止日）作为里程碑任务，标题前加 [里程碑]
- 微信群名、文档链接等资源信息放入 description
- 没有可提取内容时输出 {{"items": [], "project_updates": []}}

会议纪要：
{content}"""


# ---------- Vikunja API ----------

def vk() -> httpx.Client:
    return httpx.Client(
        base_url=VIKUNJA_URL,
        headers={"Authorization": f"Bearer {VIKUNJA_TOKEN}"},
        timeout=30,
    )


def get_projects(client: httpx.Client) -> list[dict]:
    r = client.get("/projects")
    r.raise_for_status()
    return [p for p in r.json() if not p.get("is_archived")]


def create_project(client: httpx.Client, title: str) -> dict:
    r = client.put("/projects", json={"title": title})
    r.raise_for_status()
    return r.json()


def create_task(client: httpx.Client, project_id: int, item: dict) -> dict:
    payload = {
        "title": item["title"],
        "description": item.get("description") or "",
        "project_id": project_id,
    }
    if item.get("due_date"):
        payload["due_date"] = item["due_date"] + "T09:00:00Z"
    r = client.put(f"/projects/{project_id}/tasks", json=payload)
    r.raise_for_status()
    return r.json()


def get_tasks(client: httpx.Client, project_id: int) -> list[dict]:
    r = client.get(f"/projects/{project_id}/tasks")
    r.raise_for_status()
    return r.json()


# ---------- LLM ----------

def llm_extract(content: str, projects: list[dict]) -> dict:
    names = "\n".join(f'- {p["id"]}: {p["title"]}' for p in projects) or "（暂无项目）"
    prompt = EXTRACT_PROMPT.format(projects=names, content=content)
    r = httpx.post(
        f"{LLM_BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {LLM_API_KEY}"},
        json={
            "model": LLM_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.1,
        },
        timeout=300,
    )
    r.raise_for_status()
    text = r.json()["choices"][0]["message"]["content"].strip()
    # 剥掉可能的 ```json 包裹
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    return json.loads(text)


# ---------- 飞书 ----------

def feishu_send(title: str, lines: list[str]):
    """发送富文本卡片到飞书群。lines 为 markdown 文本行。"""
    if not FEISHU_WEBHOOK:
        print("未配置 FEISHU_WEBHOOK，仅打印：")
        print(title)
        print("\n".join(lines))
        return
    payload = {
        "msg_type": "interactive",
        "card": {
            "header": {"title": {"tag": "plain_text", "content": title}, "template": "blue"},
            "elements": [
                {"tag": "div", "text": {"tag": "lark_md", "content": "\n".join(lines) or "（无内容）"}}
            ],
        },
    }
    r = httpx.post(FEISHU_WEBHOOK, json=payload, timeout=15)
    r.raise_for_status()
    print(f"已推送飞书: {title}")


# ---------- ingest ----------

def read_input(arg: str) -> str:
    p = Path(arg)
    if p.exists():
        mime = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        if mime.startswith("image/"):
            b64 = base64.b64encode(p.read_bytes()).decode()
            # 图片走视觉输入（本地存成 markdown 引用 + 提示）
            return f"[图片文件: {p.name}]\n(data:image/{mime.split('/')[1]};base64,{b64[:100]}...)\n注意：当前模型若不支持图片，请改用文本纪要。"
        return p.read_text(encoding="utf-8", errors="replace")
    return arg


def cmd_ingest(arg: str):
    if not VIKUNJA_TOKEN or not LLM_API_KEY:
        sys.exit("请先在 .env 中配置 VIKUNJA_TOKEN 和 LLM_API_KEY")
    content = read_input(arg)
    with vk() as client:
        projects = get_projects(client)
        print(f"正在调用 {LLM_MODEL} 提取...")
        data = llm_extract(content, projects)

        # 按项目组织确认清单
        by_project: dict[str, list[dict]] = {}
        for item in data.get("items", []):
            by_project.setdefault(item["project"], []).append(item)

        if not by_project and not data.get("project_updates"):
            print("AI 未提取到可更新内容。")
            return

        print("\n===== 拟更新清单 =====")
        idx = 0
        approved = []
        for proj, items in by_project.items():
            is_new = any(i.get("is_new") for i in items)
            tag = "【新建项目】" if is_new else ""
            print(f"\n📁 {tag}{proj}")
            for it in items:
                idx += 1
                due = f" | 截止 {it['due_date']}" if it.get("due_date") else ""
                desc = f"\n     {it['description']}" if it.get("description") else ""
                print(f"  [{idx}] {'新增任务' if not is_new else '新项目+任务'}: {it['title']}{due}{desc}")
                ans = input("     确认写入? (y=是 n=跳过 e=编辑标题回车默认y): ").strip().lower()
                if ans == "n":
                    continue
                if ans.startswith("e:"):
                    it["title"] = ans[2:].strip() or it["title"]
                approved.append((proj, is_new, it))

        if not approved:
            print("\n未确认任何条目，退出。")
            return

        print("\n正在写入 Vikunja...")
        # 项目名 -> id 缓存（含新建）
        pid = {p["title"]: p["id"] for p in projects}
        for proj, is_new, it in approved:
            if proj not in pid:
                np = create_project(client, proj)
                pid[proj] = np["id"]
                print(f"  ✅ 新建项目: {proj}")
            t = create_task(client, pid[proj], it)
            print(f"  ✅ {proj} -> {t['title']} (id={t['id']})")

        # 项目进展摘要追加到项目描述
        for pu in data.get("project_updates", []):
            proj = pu["project"]
            if proj in pid:
                r = client.get(f"/projects/{pid[proj]}")
                r.raise_for_status()
                p = r.json()
                stamp = date.today().isoformat()
                new_desc = f"{p.get('description') or ''}\n[{stamp} 会议摘要] {pu['summary']}".strip()
                client.post(f"/projects/{pid[proj]}", json={"description": new_desc})
                print(f"  📝 已追加会议摘要到项目: {proj}")

        print(f"\n完成，共写入 {len(approved)} 条任务。看板: {VIKUNJA_URL.replace('/api/v1', '')}")


# ---------- check ----------

REMINDED_FILE = Path(__file__).parent / "data" / "reminded.json"


def load_reminded() -> dict:
    if REMINDED_FILE.exists():
        return json.loads(REMINDED_FILE.read_text(encoding="utf-8"))
    return {}


def save_reminded(data: dict):
    REMINDED_FILE.parent.mkdir(exist_ok=True)
    REMINDED_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def cmd_check():
    if not VIKUNJA_TOKEN:
        sys.exit("请先在 .env 中配置 VIKUNJA_TOKEN")
    today = date.today()
    horizon = today + timedelta(days=REMIND_DAYS)
    reminded = load_reminded()
    lines, pending = [], {}

    with vk() as client:
        for p in get_projects(client):
            for t in get_tasks(client, p["id"]):
                if t.get("done") or not t.get("due_date"):
                    continue
                due = datetime.fromisoformat(t["due_date"].replace("Z", "+00:00")).date()
                key = str(t["id"])
                if due <= horizon or due < today:
                    if key in reminded:
                        continue
                    status = "**已逾期**" if due < today else ("⚠️ 今天到期" if due == today else f"还剩 {(due - today).days} 天")
                    lines.append(f"**{p['title']}** ｜ {t['title']} ｜ 截止 {due} ｜ {status}")
                    desc = (t.get("description") or "").strip()
                    if desc:
                        lines.append(f"  ↳ {desc}")
                    pending[key] = due.isoformat()

    if lines:
        feishu_send(f"📋 项目提醒（{today.isoformat()}）", lines)
        reminded.update(pending)
        save_reminded(reminded)
    else:
        print("暂无需要提醒的任务。")


# ---------- today ----------

def cmd_today():
    with vk() as client:
        for p in get_projects(client):
            print(f"\n📁 {p['title']}")
            desc = (p.get("description") or "").strip()
            if desc:
                for ln in desc.splitlines()[-3:]:
                    print(f"   {ln}")
            for t in get_tasks(client, p["id"]):
                mark = "✅" if t.get("done") else "⬜"
                due = ""
                if t.get("due_date"):
                    d = t["due_date"][:10]
                    due = f" (截止 {d})"
                print(f"   {mark} {t['title']}{due}")


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("ingest", "check", "today"):
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "ingest":
        if len(sys.argv) < 3:
            sys.exit("用法: python mypm.py ingest <文件路径 或 直接粘贴文本>")
        cmd_ingest(" ".join(sys.argv[2:]))
    elif cmd == "check":
        cmd_check()
    else:
        cmd_today()
