# scout-block

**Event:** PreToolUse · matcher `Read|Bash` · fail-open

## What it blocks

Reads (or shell commands targeting paths) inside vendored/generated directories: `node_modules`, `dist`, `build`, `.next`, `coverage`, `vendor` — or whatever a repo-root `.ckignore` file lists (one dir per line, `#` comments).

## Why

One `node_modules` read can flood the context window with thousands of lines of vendored code, crowding out the actual task. The block message redirects the agent to search source instead.

## Approval flow

Genuinely need one vendored file (debugging a dependency):

```
Read file_path: "APPROVED:node_modules/pkg/index.js"
```

Per-call, transcript-visible.

## Config

```json
"scout-block": {
  "enabled": true,
  "ignoreFile": ".ckignore",
  "fallbackDirs": ["node_modules", "dist", "build", ".next", "coverage", "vendor"]
}
```

| Option | Default | Meaning |
|---|---|---|
| `ignoreFile` | `.ckignore` | repo-root file listing blocked dirs; when present it **replaces** `fallbackDirs` |
| `fallbackDirs` | see above | used only when `ignoreFile` doesn't exist |

## Behavior notes

- Fail-open: an internal error allows (availability over strictness for a context-hygiene rule).
- Paths outside the repo root are not judged.
