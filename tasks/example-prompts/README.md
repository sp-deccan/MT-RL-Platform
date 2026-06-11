# Example prompts (JIRA demo DB + tools)

These prompts are written for the **seeded SQLite JIRA store** (per-browser session under `data/sessions/` after the first API call with `X-RL-Session-Id`) and the **10 LangChain tools** (`jira_*`).

| ID | Title | Default project context |
|----|--------|-------------------------|
| `list-workspace` | Orient in the workspace | RL |
| `inspect-issue-thread` | Deep read one issue + comments | RL |
| `search-by-text` | Search by keyword | RL |
| `filter-by-status` | Filter by status in a project | DEMO |
| `create-bug-demo` | Create a new issue | DEMO |
| `transition-and-comment` | Transition + add comment | RL |
| `update-fields` | Update issue metadata | RL |
| `orders-snapshot` | Cross-project read (ORD) | ORD |
| `inventory-empty-check` | Empty project check (INV) | INV |
| `multi-step-research` | Research then recommend | RL |
| `safe-delete-flow` | Create, verify, delete | DEMO |
| `blocked-escalation` | Block an issue | DEMO |

## Files

- **`prompts.json`** — Machine-readable list: `id`, `title`, `project_key`, `suggested_tools`, `prompt` (copy the `prompt` field into the web UI).

## Seeded data reference

- **Projects:** `RL`, `DEMO`, `ORD`, `INV`
- **Sample keys:** `RL-1`, `RL-2`, `DEMO-1`, `ORD-10`
- **Statuses used in prompts:** `To Do`, `In Progress`, `Done`, `Blocked`

## Tool map

| Tool | Typical use in these prompts |
|------|------------------------------|
| `jira_list_projects` | Workspace orientation |
| `jira_get_project` | Project metadata + issue count |
| `jira_search_issues` | Filter by project, text, status |
| `jira_get_issue` | Full record for one key |
| `jira_create_issue` | New bugs/tasks |
| `jira_update_issue` | Assignee, priority, summary, description |
| `jira_delete_issue` | Only in `safe-delete-flow` |
| `jira_add_comment` | Thread updates |
| `jira_list_comments` | Read comment history |
| `jira_transition_issue` | To Do / In Progress / Done / Blocked |

If you reset the database, re-run the API once to re-seed, or adjust prompts to match whatever keys exist.
