Write a **trace verifier** rubric in plain English that a human or automated checker can use to judge whether a *candidate* trajectory is acceptable compared to the **ideal** trajectory provided in the user message.

Your trace verifier should:

- Reference the **expected order** of JIRA tools (or equivalent) and any tools that must or must not appear.
- Mention **project scope** and **issue keys** when the ideal trace implies them.
- Call out **required intermediate checks** (e.g. list projects before create, search before update when applicable).
- Stay concrete and testable (bullet list or short numbered checks is fine).

Do not repeat the entire ideal trace verbatim; focus on **what must be verified**.
