from __future__ import annotations

import json
from typing import Any, List, Optional

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.jira_store import JiraStore


def _dumps(x: object) -> str:
    return json.dumps(x, indent=2, default=str)


def build_jira_tools(store: JiraStore) -> list[StructuredTool]:
    class SearchIn(BaseModel):
        text: Optional[str] = Field(
            None, description="Substring match on summary/description"
        )
        project_key: Optional[str] = Field(None, description="Filter by project key")
        status: Optional[str] = Field(None, description="Exact status e.g. To Do")
        limit: int = Field(20, description="Max rows 1-50")

    def jira_search_issues(
        text: Optional[str] = None,
        project_key: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 20,
    ) -> str:
        """Search JIRA issues with optional text, project, and status filters."""
        rows = store.search_issues(text, project_key, status, limit)
        return _dumps({"matches": rows, "count": len(rows)})

    class GetIssueIn(BaseModel):
        issue_key: str = Field(..., description="Issue key e.g. RL-1")

    def jira_get_issue(issue_key: str) -> str:
        """Fetch a single issue by key including all fields."""
        row = store.get_issue(issue_key)
        if not row:
            return _dumps({"error": f"Not found: {issue_key}"})
        return _dumps(row)

    class CreateIn(BaseModel):
        project_key: str
        summary: str
        issue_type: str = "Task"
        description: Optional[str] = None
        status: str = "To Do"
        assignee: Optional[str] = None
        priority: str = "Medium"

    def jira_create_issue(
        project_key: str,
        summary: str,
        issue_type: str = "Task",
        description: Optional[str] = None,
        status: str = "To Do",
        assignee: Optional[str] = None,
        priority: str = "Medium",
    ) -> str:
        """Create an issue in a project."""
        return _dumps(
            store.create_issue(
                project_key,
                summary,
                issue_type,
                description,
                status,
                assignee,
                priority,
            )
        )

    class UpdateIn(BaseModel):
        issue_key: str
        summary: Optional[str] = None
        description: Optional[str] = None
        assignee: Optional[str] = None
        priority: Optional[str] = None

    def jira_update_issue(
        issue_key: str,
        summary: Optional[str] = None,
        description: Optional[str] = None,
        assignee: Optional[str] = None,
        priority: Optional[str] = None,
    ) -> str:
        """Update mutable fields on an issue."""
        return _dumps(
            store.update_issue(issue_key, summary, description, assignee, priority)
        )

    class DelIn(BaseModel):
        issue_key: str

    def jira_delete_issue(issue_key: str) -> str:
        """Permanently delete an issue and its comments."""
        return _dumps(store.delete_issue(issue_key))

    def jira_list_projects() -> str:
        """List all projects."""
        return _dumps({"projects": store.list_projects()})

    class GPIn(BaseModel):
        project_key: str

    def jira_get_project(project_key: str) -> str:
        """Get project metadata and open issue count."""
        row = store.get_project(project_key)
        if not row:
            return _dumps({"error": f"Unknown project: {project_key}"})
        return _dumps(row)

    class ComIn(BaseModel):
        issue_key: str
        author: str
        body: str

    def jira_add_comment(issue_key: str, author: str, body: str) -> str:
        """Add a comment to an issue."""
        return _dumps(store.add_comment(issue_key, author, body))

    class LCIn(BaseModel):
        issue_key: str

    def jira_list_comments(issue_key: str) -> str:
        """List comments for an issue."""
        return _dumps({"comments": store.list_comments(issue_key)})

    class TrIn(BaseModel):
        issue_key: str
        new_status: str = Field(
            ..., description="One of: To Do, In Progress, Done, Blocked"
        )

    def jira_transition_issue(issue_key: str, new_status: str) -> str:
        """Move an issue to a new status."""
        return _dumps(store.transition_issue(issue_key, new_status))

    return [
        StructuredTool.from_function(
            jira_search_issues,
            name="jira_search_issues",
            args_schema=SearchIn,
        ),
        StructuredTool.from_function(
            jira_get_issue,
            name="jira_get_issue",
            args_schema=GetIssueIn,
        ),
        StructuredTool.from_function(
            jira_create_issue,
            name="jira_create_issue",
            args_schema=CreateIn,
        ),
        StructuredTool.from_function(
            jira_update_issue,
            name="jira_update_issue",
            args_schema=UpdateIn,
        ),
        StructuredTool.from_function(
            jira_delete_issue,
            name="jira_delete_issue",
            args_schema=DelIn,
        ),
        StructuredTool.from_function(
            jira_list_projects,
            name="jira_list_projects",
        ),
        StructuredTool.from_function(
            jira_get_project,
            name="jira_get_project",
            args_schema=GPIn,
        ),
        StructuredTool.from_function(
            jira_add_comment,
            name="jira_add_comment",
            args_schema=ComIn,
        ),
        StructuredTool.from_function(
            jira_list_comments,
            name="jira_list_comments",
            args_schema=LCIn,
        ),
        StructuredTool.from_function(
            jira_transition_issue,
            name="jira_transition_issue",
            args_schema=TrIn,
        ),
    ]


ALL_JIRA_TOOL_NAMES = frozenset(
    t
    for t in [
        "jira_search_issues",
        "jira_get_issue",
        "jira_create_issue",
        "jira_update_issue",
        "jira_delete_issue",
        "jira_list_projects",
        "jira_get_project",
        "jira_add_comment",
        "jira_list_comments",
        "jira_transition_issue",
    ]
)


def filter_tools(
    tools: List[StructuredTool], selected: Optional[List[str]]
) -> List[StructuredTool]:
    if not selected:
        return tools
    sel = set(selected)
    return [t for t in tools if t.name in sel]
