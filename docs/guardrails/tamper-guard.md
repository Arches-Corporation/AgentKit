# tamper-guard

**Event:** PreToolUse · matcher `Edit|Write|Bash` · fail-closed · **always-on**

## What it blocks

- Edit/Write tool calls targeting the guardrail enforcement layer:
  `agentkit.config.json`, `.agentkit/**` (state dir, markers, local guardrails, manifest), `.claude/settings.json`, `.cursor/hooks.json`.
- Bash commands that mutate those paths (`touch`, `rm`, `mv`, `chmod`, `tee`, `sed -i`, redirects, …).
- Any agent invocation of `agentkit approve` — approval is user-only.

## Why

Without it, a blocked agent's cheapest move is to edit `agentkit.config.json` (`"enabled": false`), touch the approval marker, or unwire the hooks — the enforcement layer must not be editable by the agent it polices (pentest findings 1+2 against v2.4.1).

## Always-on

`"enabled": false` in the config is **ignored at runtime** for this guardrail — a guard protecting the config cannot be switched off by editing the config. To genuinely remove it, the user unwires the hook from `.claude/settings.json` by hand (which the agent also cannot do).

## Config

```json
"tamper-guard": { "protect": ["deploy/secrets/"] }
```

| Option | Default | Meaning |
|---|---|---|
| `protect` | `[]` | extra repo-relative paths to protect (directories end with `/`) |

## Behavior notes

- Reads are allowed — the agent may inspect the config, just not change it.
- `npx agentkit sync|init|doctor` run by the agent still work (they don't name protected paths on the command line); the CLI itself maintains those files.
- If a config change is genuinely needed, the agent should ask the user to make it.
- Residual: exotic shell (interpreters, encoded commands) can evade the Bash lexer — the guard raises friction and logs; see [threat-model.md](../threat-model.md).
