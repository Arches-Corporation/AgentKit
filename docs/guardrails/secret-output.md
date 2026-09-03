# secret-output

**Event:** UserPromptSubmit · fail-closed

## What it blocks

Submitted prompt text containing:
- a private key block (`-----BEGIN … PRIVATE KEY-----`)
- an AWS access key id (`AKIA…`)
- an inline credential (`password: …`, `token=…`, `api_key: …`)

## Why

A secret pasted into a prompt enters the conversation permanently — context, transcripts, possibly generated code and commits. Blocking at submit time is the last cheap point to stop it; the message tells the user to replace the value with a placeholder or env-var reference.

## Config

```json
"secret-output": {
  "enabled": true,
  "extraPatterns": [
    { "pattern": "INTERNAL-[0-9]{6}", "flags": "i", "label": "internal service token" }
  ]
}
```

| Option | Default | Meaning |
|---|---|---|
| `extraPatterns` | `[]` | additional `{pattern, flags?, label?}` regexes checked on top of the built-ins |

Built-ins cannot be disabled individually — disable the whole guardrail or accept them.

## Behavior notes

- Fail-closed.
- No approval bypass by design: the correct fix is always to remove the secret, never to submit it anyway.
