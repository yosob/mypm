# mypm — Your AI Project Manager

**English** | [简体中文](README.md)

> A self-hosted, AI-native personal project manager. Chat with it on Lark/Feishu — it turns your meeting notes into tasks, tracks milestones on a Gantt chart, and proactively reminds you of deadlines. All data stays on your machine.

## What is it?

A secretary that never forgets:

- Paste a **meeting note** in chat → it extracts todos, schedules, milestones, WeChat group names and doc links → shows you a review list → you reply "confirm" and it's filed
- Every morning at 9:00 it DMs you: *"3 tasks due this week, 1 overdue"*
- Ask anything in natural language: *"what should I do today"*, *"postpone the review to next Friday"*, *"what's the group name for project X"*
- Open the local **web dashboard** for the big picture: Gantt chart, task list, kanban

The key difference from Notion/Asana-type tools: those require *you* to fill in forms. mypm is **AI-native** — input by conversation, organizing by AI, you only confirm and decide. All data operations go through 11 controlled agent tools with a two-step confirm flow (no hallucinated writes; AI can never delete).

## Features

**Chat (Lark DM / group @, main entry)**
- Notes → structured updates: todos, date ranges, P0-P3 priorities, milestones, resources, project summaries — extracted in one pass, applied after your confirmation
- Natural-language queries & edits: today/this-week/overdue views, reschedule, status, custom fields
- Proactive reminders: daily DM digest (7-day window once + overdue-day once, no spam)

**Dashboard (local web)**
- 📈 Gantt (dhtmlx: project tree, milestones, today line, overdue colors)
- 📋 Task list (filter/search/sort) & 🗂 Kanban (drag to change status)
- Full manual editing in centered modals; project & task level resources; ⚙ custom fields

**Data & safety**
- Single-file SQLite, daily backups (14 kept, auto-recovery on corruption)
- AI writes only via tools; deletion is dashboard-only by design

## Quick start

```bash
# Prereqs: Node ≥22, a Lark custom app (bot + long-connection events), any LLM API key
cp config.example.json config.json   # fill in keys (see config section below)
cd app && npm install
npm run dev
```

Dashboard: http://127.0.0.1:8787 ｜ Lark: DM the bot "hi" (first DM registers you for reminders)

## Configuration (config.json)

Single config file at repo root (gitignored; template: `config.example.json`). Secrets can be plain or `"$ENV_VAR"` references.

- **llm** — pick any provider: declare vendors in `providers[]` (baseUrl / api protocol / apiKey / models), select via `provider` + `model`. Template ships 10 vendors: Zhipu GLM, DeepSeek, Kimi, Qwen, OpenAI, Claude, SiliconFlow, OpenRouter, Ollama (local)…
- **lark** — app credentials, `domain`: `lark` (intl) / `feishu` (CN)
- **notify** — fallback webhook
- **app** — port, remind window & cron, session-memory compaction params

## Architecture (1-minute version)

```
You(Lark) ─chat─▶ AI manager (pi agent + LLM, 11 tools)
                     │ read/write
                     ▼
                SQLite store ◀── manual edits ── Web dashboard
                     │
          daily cron ──▶ bot DM reminder card
```

Stack: TypeScript · [pi agent](https://github.com/earendil-works/pi) · Lark WebSocket · SQLite · Hono + dhtmlx (no frontend build)

## Docs (Chinese)

| Topic | Doc |
|---|---|
| Feature map & PM software comparison | docs/FEATURES.md |
| How it's built | docs/IMPLEMENTATION.md · app/ARCHITECTURE.md |
| How AI connects to data (tools/loop/confirm flow) | docs/AI-NATIVE.md |
| Deploy / machine migration (Win→Mac/Linux) | docs/DEPLOY.md |
| Lark/Feishu app setup tutorial (Chinese) | docs/LARK.md |
| Design decisions & pitfalls | docs/DECISIONS.md · docs/DETAILS.md |

## Scope & roadmap

Single-user by design (no collaboration); AI never deletes (dashboard only). Roadmap: image notes, recurring tasks, calendar view, weekly report, remote dashboard via tunnel, WeChat push.

## License

[MIT](LICENSE)
