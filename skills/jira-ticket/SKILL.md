# Skill: jira-ticket

Create or update a Jira ticket to the {{orgName}} workspace standard, via the Atlassian MCP server.

Tool-agnostic: any MCP-capable tool (Claude Code, Cursor, Gemini CLI) can run this. Claude Code auto-invokes it; other tools read it as the reference and call the same MCP tools.

## Prerequisites

- Atlassian MCP connected. Declared for the workspace in `.mcp.json` (`atlassian`, Streamable HTTP, `https://mcp.atlassian.com/v1/mcp`). Auth is **interactive OAuth per user** — no token in the repo. If tools aren't visible, authenticate once (`getAccessibleAtlassianResources` / your tool's MCP auth flow).
- MCP tool names follow `mcp__atlassian__*` (e.g. `createJiraIssue`, `editJiraIssue`, `getJiraIssue`, `transitionJiraIssue`, `searchJiraIssuesUsingJql`).

## Fetch discipline (cost)

- Read a ticket with `fields: ["summary","description","status"]` — **not** full `comment` bodies. Comments can embed whole source files and blow up context.
- **Code lives in the repo — read the file, not the ticket.** The ticket is for intent (What/Why/AC), never the source of truth for code.
- Only expand comments when you specifically need discussion history.

## Ticket standard (rule owner: `{{rulebook}}` §Jira; full detail here)

**Summary:** `[<scope>] <verb> <object>` — scope `[BE]` / `[FE]` / `[BE/FE]`, single-layer only.
- Verbs: `Add`, `Fix`, `Update`, `Remove`, `Allow`, `Display`, `Refactor`.
- Examples:
  - `Fix cursor jumps to article end after deleting highlighted text`
  - `[BE] Update PDF export wording and remove purchase date`
  - `Add button to request interview when search result is empty`

**Type:**

| Situation | Type |
|---|---|
| New feature / UI change | Task |
| User-facing feature request | Story |
| Something broken | Bug |
| Improvement to existing | Enhancement |
| Part of a Task | Subtask |
| Group of related work | Epic |

**Description:** must contain **What**, **Why**, **Acceptance Criteria** (Notes optional).

**Priority:** default `Medium`; `High` only when it blocks users.

**Assignee:** always set — default to the current user when not specified.

## Steps — create

1. Resolve the cloud id: `getAccessibleAtlassianResources`.
2. Confirm project + issue-type fields if unsure: `getJiraProjectIssueTypesMetadata`.
3. Build the payload to the standard above. Description in this shape:
   ```
   ## What
   <one-paragraph scope>
   ## Why
   <business reason>
   ## Acceptance Criteria
   - [ ] <criterion 1>
   - [ ] <criterion 2>
   ```
4. `createJiraIssue` with summary / type / description / priority / assignee.
5. Return the issue key + URL.

## Steps — update

1. `getJiraIssue` (or `searchJiraIssuesUsingJql`) to find it.
2. `editJiraIssue` for field changes, or `transitionJiraIssue` for status.
3. Comments via `addCommentToJiraIssue`. Never overwrite an existing description wholesale — append or edit the relevant section.

## Guardrails

- No secrets in tickets, comments, or the MCP config.
- Match the standard exactly — a ticket missing What/Why/AC is not done.
- HARD STOP does **not** apply to Jira (it's not a git commit/push), but confirm destructive transitions (Close/Cancel) with the user first.
