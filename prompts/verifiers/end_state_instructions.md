Write an **end-state verifier** rubric that judges the **final natural-language answer** (and implied outcome) against the **ideal final response** and the **user task**.

Your end-state verifier should:

- State what facts, issue keys, statuses, or summaries the final answer **must** include or be consistent with.
- Mention **correctness relative to the JIRA DB** when the task is data-grounded.
- Allow minor wording differences but flag **contradictions** (wrong key, wrong status, invented data).
- Be usable as a checklist for human review or automated string/heuristic checks.

Keep it concise and operational.
