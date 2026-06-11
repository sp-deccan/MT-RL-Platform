# rl-platform

RL annotation UI for **multi-turn** agent trajectories over a **local JIRA-shaped SQLite database**, using **OpenAI GPT** and **LangChain** tool-calling (10 JIRA tools).

The annotator workflow runs in **real mode only** (`POST /api/agent/run` for trajectories A/B). The UI ships with **example prompts, trajectories, ideal traces, and verifiers** so you can explore the full pipeline before generating your own data.

## Quick start

### 1. Configure OpenAI

```bash
cp config.example.yaml config.yaml
export OPENAI_API_KEY="sk-..."
```

See [Configuration](#configuration) for details. Check `GET /api/config-status` for `openai_configured`.

### 2. Start the API

```bash
cd /path/to/rl-platform
python3 -m pip install -e .
PYTHONPATH=. python3 -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Start the web app

```bash
cd web
npm install
npm run dev
```

Open the URL Vite prints (usually **http://localhost:5173**). Vite proxies `/api` to port **8000**.

---

## Annotator workflow (UI)

The **Annotator** tab is organized into numbered sections. A **QC** tab provides a read-only mirror for review.

| Section | What you do |
|---------|-------------|
| **1. CSV & metadata** | Upload a CSV with a `metadata` column (JSON per row) or flat columns merged into metadata. Optional; example task data works without a file. |
| **2. Prompt, project & tools** | Pick system prompt file, **task metadata** (category, difficulty, domain, task type, tags, est. time), JIRA project, and allowed tools. Execution is always **Real (GPT + JIRA tools)**. |
| **Sticky prompt panel** | **Generate prompt** (AI, `POST /api/prompts/generate`) fills the active turn. **Turn tabs** (Turn 1, Turn 2, + Add turn) switch the user message per conversation turn. Auto-resizing textarea stays pinned while scrolling. |
| **Generate trajectories** | Runs `POST /api/agent/run` with `user_turns[]` to produce **trajectory A** and **B** for the full multi-turn conversation. |
| **RLHF comparison** | Rate instruction-following and accuracy per trajectory; set overall preference (1–7). |
| **3. Ideal trajectory** | Per **active turn**: copy from A/B, start blank, edit steps, **Run step** against the ideal DB fork, save/import JSON. **Recommended tools** for the turn are inferred from the user message. |
| **4. Verifiers** | Per turn: **Generate verifiers (AI)** or template fill from ideal; edit trace + end-state rubrics (AI snapshot vs human ideal). |
| **5. Submit** | **Submit full task** writes golden JSON under `golden.tasks_dir` and resets session DBs; the client rotates `X-RL-Session-Id`. |

### Multi-turn data model

- **User turns** — ordered prompts; the agent runs each turn in sequence within one episode.
- **Trajectories A/B** — each has `turns[]` (per-turn steps + assistant message) plus flattened `steps[]` for backward compatibility.
- **Ideal** — `ideal.turns[]` with one gold trace per conversation turn; browser save uses schema version **2**.
- **Verifiers** — `verifiers.turns[]` per turn, plus flattened `ai` / `ideal` strings in the submit payload.
- **Task metadata** — `taskMetadata` (category, difficulty, domain, task type, tags, estimated minutes) included in golden JSON.

### Example demo content

On load, the UI pre-fills a 3-turn JIRA workflow (list issues → assign/transition → comment + summarize) with example trajectories A/B, ideal traces, and verifier rubrics. Use **Generate trajectories** to replace them with live GPT runs.

---

## Technical deep dive: how the RL-style environment works

This repo is an **annotation and data-collection lab**, not a full RL training loop. The “environment” is **episodic**: each browser tab holds an **RL session id** (`X-RL-Session-Id`, stored in `sessionStorage`). The backend treats that id as the scope for **isolated world state** (SQLite). The model acts through **tools**; state changes are visible in the DB explorer and in tool outputs. Golden JSON exports bundle metadata, task settings, multi-turn prompts, trajectories, per-turn ideal traces, per-turn verifiers, optional QC review, and agent logs for downstream training or eval.

### Episode lifecycle (high level)

1. **Annotator** loads optional CSV metadata, configures project/tools/task metadata, edits multi-turn prompts (or uses **Generate prompt**), and runs **Generate trajectories** via `POST /api/agent/run`.
2. **Ideal trajectory** is edited per turn; **Run step** executes JIRA tools against the **ideal** DB fork.
3. **Verifiers** (template, or `POST /api/verifiers/generate`) produce rubric text from the active turn’s ideal.
4. **Submit full task** writes one JSON file under `golden.tasks_dir` and **resets** all three DB files for that session; the client rotates the session id so the next episode starts clean.

### Database state: three forks per session

Under `jira_db.sessions_dir` (default `data/sessions/`), each validated session id has **three** SQLite files:

| File pattern | Used by | Purpose |
|--------------|---------|---------|
| `{session}_A.sqlite3` | First model run in `POST /api/agent/run` | Mutations from trajectory **A** only |
| `{session}_B.sqlite3` | Second model run in the same request | Mutations from trajectory **B** only; **same seed** as A at the start of the request, but **no cross-talk** with A |
| `{session}_ideal.sqlite3` | `POST /api/ideal/invoke-tool` (UI “Run step”) | Human-authored ideal trace; independent of A/B |

**When state is reset**

- **Start of** `POST /api/agent/run`: the registry **deletes all three forks** (and any legacy single-file DB) for that `X-RL-Session-Id`, then re-creates stores. Every **Generate trajectories** run begins from a **fresh seeded** JIRA-shaped database for both A and B.
- **`POST /api/tasks/save-golden`**: after writing the golden JSON, the same **full session reset** runs. The web app then **rotates** the RL session id so the next tools/explorer calls do not point at deleted files.

**Headers**

- **`X-RL-Session-Id`**: required on routes that touch session DBs (agent, ideal invoke, DB API, golden save, prompt generation). Format validated in `backend/session_jira.py`.
- **`X-RL-Db-Fork`**: required for **read-only** DB routes (`A`, `B`, or `ideal`) so the explorer and QC SQL panel know **which** SQLite file to query.

**QC tab**: read-only mirrors of annotator fields; DB snapshot + `DbExplorer` use **SELECT-only** SQL (`POST /api/db/query` rejects writes). Annotator inputs cannot be changed from QC.

### “Tools” today: LangChain structured tools (not MCP)

The codebase does **not** implement the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). Tools are **`langchain_core.tools.StructuredTool`** instances built in `backend/jira_tools.py`, each closing over a **`JiraStore`** (SQLite). OpenAI’s chat model receives JSON schemas derived from Pydantic `args_schema`; the **agent loop** in `backend/agent_runner.py` executes tool calls per user turn and appends `ToolMessage`s until a final assistant text is returned for that turn.

**Exposed JIRA-shaped tools** (names must match when filtering `selected_tools`):

- `jira_search_issues`, `jira_get_issue`, `jira_create_issue`, `jira_update_issue`, `jira_delete_issue`
- `jira_list_projects`, `jira_get_project`
- `jira_add_comment`, `jira_list_comments`, `jira_transition_issue`

**Discovery**: `GET /api/tools/jira` returns `{ name, description }` for tools bound to a store (session id + optional fork header; defaults fork **A** for metadata-only use).

**Execution paths**

- **Agent (A/B)**: `run_multi_turn_tool_agent` — tools mutate **`JiraStore` for fork A or B** across ordered user turns.
- **Ideal**: `POST /api/ideal/invoke-tool` always uses the **`ideal`** fork’s store (`backend/ideal_tool_invoke.py`).

### Logs and artifacts

- **Agent**: `POST /api/agent/run` writes `json_logs/agent_run_*.json` (config: `logging.agent_runs_dir`) with both trajectories, prompts, per-turn tool steps, and cost/token metadata when available.
- **Verifiers**: `POST /api/verifiers/generate` can write `verifier_run_*.json` (same or separate dir via `verifier_runs_dir`).
- **Golden**: `POST /api/tasks/save-golden` accepts the UI payload (including `taskMetadata`, `userTurns`, per-turn `ideal` / `verifiers`, and `qc_review` when present) and writes timestamped JSON under `golden.tasks_dir`.

### How to extend or upgrade the platform

**Add or change tools**

1. Implement the operation on `JiraStore` (`backend/jira_store.py`) if it needs new tables or queries.
2. Add a `StructuredTool` in `build_jira_tools`, register the name in `ALL_JIRA_TOOL_NAMES`, and document the schema.
3. Update the web tool picker (`AVAILABLE_TOOLS` in `web/src/constants.ts`) if the UI should expose it.
4. Extend `recommendedToolsForTurn` in `web/src/lib/recommendedTools.ts` if the ideal-section hints should cover new tools.

**Swap the “world” (e.g. real JIRA, HTTP API, or MCP)**

- **Real JIRA REST**: replace `JiraStore` calls with HTTP clients; keep the same tool **names** and argument shapes if you want unchanged prompts and golden JSON.
- **MCP server**: implement a small MCP process that exposes **resources/tools** mirroring these operations; a future **client** could call MCP instead of LangChain—either by wrapping MCP tools as LangChain tools or by replacing `run_tool_agent` with an MCP-aware loop. This repo does not ship that adapter yet.
- **Additional environments**: duplicate the **session registry** pattern (multiple SQLite roots or namespaces) if you need separate “products” or schemas per task type.

**Training-oriented upgrades**

- Emit **trajectory formats** compatible with your trainer (e.g. message lists with reward hooks, or SFT JSONL).
- Add **automated verifiers** that execute against fork A/B/ideal and write scalar scores into logs.
- Wire **policy models** to `POST /api/agent/run`-style endpoints with your inference stack instead of OpenAI.

---

## Next milestones (suggested)

1. **MCP bridge (optional)** — Standalone MCP server wrapping `JiraStore` (or REST) so Cursor / other MCP clients can share the same tool contract; document tool JSON Schema alongside LangChain definitions.
2. **Real JIRA mode** — Pluggable backend: SQLite (current) vs live Atlassian project, with feature flags and redacted logs for secrets.
3. **Automated QC / verifier execution** — Run ideal trace verifiers (or LLM-as-judge) against candidate trajectories and attach scores to `json_logs` or golden JSON.
4. **Dataset export pipeline** — CLI or script to validate golden files, split train/holdout, and normalize schema for RLHF / SFT.
5. **Multi-issue benchmarks** — Batch CSV rows through headless agent runs with rate limits and aggregated cost metrics.
6. **Session introspection API** — `GET` endpoint returning fork paths, seed version, and row counts (for debugging without SQL).

---

## Configuration

### OpenAI API key (required for trajectories, prompt generation, and verifier AI)

`config.yaml` is **gitignored**—create it from the example:

```bash
cp config.example.yaml config.yaml
```

**Ways to provide the key** (use one; the backend accepts the first non-empty value it finds):

1. **Environment variable (recommended)**  
   Export before starting uvicorn (or set in your shell profile / IDE):

   ```bash
   export OPENAI_API_KEY="sk-..."
   ```

   In `config.yaml`, keep the placeholder so the file never holds a raw key:

   ```yaml
   openai:
     api_key: ${OPENAI_API_KEY}
   ```

   On load, `${OPENAI_API_KEY}` is expanded from the environment. If the variable is unset, the value is empty and API endpoints will fail until you set it.

2. **Inline in `config.yaml` (local only)**  
   You may set `openai.api_key: "sk-..."` directly. **Do not commit** this file.

**If the key is missing or invalid:**

- **`POST /api/agent/run`**, **`POST /api/prompts/generate`**, and **`POST /api/verifiers/generate`** return **503** with a message to set the key or `OPENAI_API_KEY`.
- Check **`GET /api/config-status`** for `openai_configured: true/false` and the configured model name.

**Changing the key:** Update `OPENAI_API_KEY` and/or `config.yaml`, then **restart** `uvicorn` so the process reloads config (use `--reload` in dev, or stop/start in production).

Other OpenAI-related options in `config.yaml` (see `config.example.yaml`): `model`, `temperature_a` / `temperature_b`, `max_tool_rounds`, `verifier_temperature`, optional `prompt_generation_temperature`, and optional `pricing_usd_per_1m_tokens` for verifier cost lines in logs.

### Other settings

- **`jira_db.sessions_dir`** — per-session SQLite forks (`A`, `B`, `ideal`); default `data/sessions/`.
- **`logging.agent_runs_dir`** / **`logging.verifier_runs_dir`** — JSON logs for agent runs and verifier generation.
- **`golden.tasks_dir`** — golden task exports from **Submit full task** (default `Golden_trajecoty/`).
- **`prompts.system_dir`** — agent system prompts (`prompts/system/*.md`).
- **`prompts/task/generate_system.md`** — system prompt for **Generate prompt** (`POST /api/prompts/generate`).
- **`server.host` / `server.port`** — API bind address.

---

## Python API (FastAPI + LangChain)

Requires **Python 3.10+**. Install dependencies:

```bash
cd /path/to/rl-platform
python3 -m pip install -e .
```

Run the server from the **repository root** (so `prompts/` and `config.yaml` resolve correctly):

```bash
PYTHONPATH=. python3 -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Check health: `curl http://127.0.0.1:8000/api/health`

**RL episodes (session DB):** see [Technical deep dive](#technical-deep-dive-how-the-rl-style-environment-works) for fork layout, reset rules, and headers. Session files under `data/sessions/` are gitignored.

### Key endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/agent/run` | Multi-turn A/B trajectories. Body: `user_turns[]`, `project_key`, `selected_tools`, `system_prompt_file`, optional `metadata_summary`. |
| `POST` | `/api/prompts/generate` | AI user-task prompt for the active turn context. Body: `project_key`, `selected_tools`, optional `metadata_summary`. |
| `POST` | `/api/verifiers/generate` | AI trace + end-state verifiers from ideal steps/response. |
| `POST` | `/api/ideal/invoke-tool` | Execute one tool against the **ideal** fork (annotator “Run step”). |
| `POST` | `/api/tasks/save-golden` | Persist full annotator payload; resets session DBs. |
| `POST` | `/api/session/sync-for-qc-view` | Reset/replay A/B (and ideal) forks from submitted trajectory JSON for QC. |
| `GET` | `/api/prompts/system` | List available system prompt files. |
| `GET` | `/api/tools/jira` | Tool names + descriptions for the session store. |

Each successful **`POST /api/agent/run`** writes a JSON trace under **`json_logs/`**. **`POST /api/verifiers/generate`** writes **`verifier_run_<timestamp>.json`**. **Submit full task** saves golden JSON under **`golden.tasks_dir`**.

**QC session sync:** The UI calls **`POST /api/session/sync-for-qc-view`** (with `X-RL-Session-Id`) when opening the **QC** tab and after a successful **`POST /api/agent/run`**. The server resets forks **A** and **B** and replays them from the trajectory step lists in the request. If **ideal** steps are included, the **ideal** fork is reset and replayed the same way.

**Read-only DB API** (Annotator / QC explorer; requires **`X-RL-Session-Id`** and **`X-RL-Db-Fork`:** `A`, `B`, or `ideal`):

- `GET /api/db/tables` — table names + row counts
- `GET /api/db/tables/{table}/rows?limit=&offset=` — paginated rows
- `GET /api/db/tables/{table}/columns` — column metadata
- `POST /api/db/query` — body `{ "sql": "SELECT …", "max_rows": 500 }` (SELECT / WITH … SELECT only)

---

## Web app (Vite + React)

You need **Node.js** (LTS, e.g. 20+) and npm.

### First-time setup

```bash
cd web
npm install
```

### Run the dev server (with API proxy)

With the Python API on port **8000**:

```bash
cd web
npm run dev
```

Open **http://localhost:5173** (or the URL Vite prints). The backend must be running and `OPENAI_API_KEY` configured for trajectory generation, prompt generation, and AI verifiers.

### Production build

```bash
cd web
npm run build
```

Output is written to `web/dist/`. For production you must serve the UI and API under compatible origins or set up the same `/api` proxy in your reverse proxy.

### Lint (optional)

```bash
cd web
npm run lint
```

### Frontend layout (reference)

| Path | Role |
|------|------|
| `web/src/App.tsx` | Main annotator workflow, sticky prompt panel, turn navigation |
| `web/src/components/QcWorkspace.tsx` | Read-only QC mirror |
| `web/src/lib/exampleContent.ts` | Demo multi-turn prompts, trajectories, ideal, verifiers |
| `web/src/lib/taskMetadata.ts` | Task metadata types and example defaults |
| `web/src/lib/recommendedTools.ts` | Per-turn tool suggestions in ideal section |
| `web/src/lib/idealStorage.ts` | Per-turn ideal persistence (localStorage v2) |
