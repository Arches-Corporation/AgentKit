---
name: e2e-testing
description: Run generalized Playwright e2e tests with full-stack validation. Validates services health, runs test suite with video+trace recording, generates HTML report. Use when you need to test FE+BE integration or regression-test features.
---

# E2E Testing Orchestrator

Automated end-to-end testing for full FE→BE flow. Validates all services are running and healthy, then executes Playwright test suite with video recording and trace artifacts.

## When to use

- **Test feature changes** — verify FE changes work against live BE
- **Regression testing** — ensure shipped features don't break
- **Integration testing** — validate FE↔BE contract is working
- **Before deploy** — run smoke tests to catch integration issues early

## Prerequisites (one-time setup per project)

```bash
# 1. E2E folder structure
e2e/
  playwright.config.ts       # Playwright config (baseURLs, video, trace)
  .env.local                 # Test credentials (gitignored)
  fixtures/auth.ts           # Login helpers
  tests/*.spec.ts            # Test suites

# 2. Test credentials file (e2e/.env.local)
ARTICLE_ID=1
ADMIN_EMAIL=admin@arches-global.com
ADMIN_PASSWORD=Password1@
CLIENT_EMAIL=client1@arches-global.com
CLIENT_PASSWORD=Password1@

# 3. Services running
./stack.sh up
rails db:seed               # Load test data
```

## Usage

```bash
/e2e                              # Full flow: health check → tests → report
/e2e --check-only                 # Verify services only, skip tests
/e2e --test-filter smoke          # Run specific test(s)
/e2e --headed                     # Run with browser visible
/e2e --headed --test-filter smoke # Headed + filtered tests
/e2e --no-report                  # Skip HTML report generation
/e2e --verbose                    # Full output (default is summary)
```

## Service Health Checks

Validates all services are responding before running tests:

| Service | Endpoint | Purpose |
|---------|----------|---------|
| Backend API | `http://localhost:3001/healthcheck` | REST API + DB access |
| FE Admin | `http://localhost:3000` | Admin portal |
| FE Client | `http://localhost:3002` | Client portal |
| Database | Docker exec + dbconsole | Data persistence |

If any service is down, `e2e` fails fast with clear error message. Requires `./stack.sh up` before running.

## Test Execution

1. **Environment validation**
   - Checks `e2e/playwright.config.ts` exists
   - Checks `e2e/.env.local` exists and has credentials
   - Installs dependencies if `node_modules/` missing

2. **Test run**
   - Executes all tests in `e2e/tests/*.spec.ts`
   - Records video per test in `e2e/test-results/`
   - Captures trace (DOM + network) for debugging
   - Screenshots on failure only

3. **Report generation**
   - HTML report: `e2e/playwright-report/index.html`
   - Embedded video player in report
   - Trace viewer (click `view` in HTML report)
   - Automatically opens report in browser (macOS)

## Output Artifacts

| Artifact | Location | Use |
|----------|----------|-----|
| Video | `e2e/test-results/<test>/video.webm` | Verify visual behavior |
| Trace | `e2e/test-results/<test>/trace.zip` | Debug step-by-step execution |
| Report | `e2e/playwright-report/index.html` | CI/CD integration, team review |
| Screenshots | `e2e/test-results/<test>/` | Failure documentation |

> To attach a run's recording to a PR, use the **`attach-pr-recording`** skill (headless
> upload + PR link). Kept separate so it triggers on "attach video to PR" on its own.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | All tests passed |
| 1 | Services down (health check failed) |
| 1 | Test environment invalid (missing files) |
| N > 0 | N tests failed |

## Example: Add new test

```typescript
// e2e/tests/my-feature.spec.ts
import { test, expect } from '@playwright/test'
import { loginClient } from '../fixtures/auth'

test('my feature works', async ({ page, context }) => {
  await loginClient(page)
  
  // Navigate to feature
  await page.goto('/feature-page')
  
  // Assert behavior
  await expect(page.locator('[data-testid="feature"]')).toBeVisible()
  await expect(page.locator('[data-testid="feature"]')).toContainText('Expected text')
})
```

Then run:
```bash
/e2e --test-filter "my feature"
```

## Security & data

- **No hardcoded secrets** — credentials in `e2e/.env.local` (gitignored)
- **Test data isolation** — tests use seed credentials only
- **Video/trace retention** — stored locally in test results, never committed
- **Trace viewer** — Playwright's trace viewer runs locally, no external upload

## Troubleshooting

### Services not responding
```bash
# Check stack is up
docker compose ps
# Or restart
./stack.sh down && ./stack.sh up
```

### Missing test credentials
```bash
# Create e2e/.env.local with seed credentials from db/seeds
cat > e2e/.env.local <<EOF
ARTICLE_ID=1
ADMIN_EMAIL=admin@arches-global.com
ADMIN_PASSWORD=Password1@
CLIENT_EMAIL=client1@arches-global.com
CLIENT_PASSWORD=Password1@
EOF
```

### Playwright selectors fail
```bash
# Debug mode: run with headed browser + slow motion
/e2e --headed
# Or open trace viewer after test fails
open e2e/test-results/<test>/trace.zip
```

### Video/trace not recording
```bash
# Verify playwright.config.ts has
use: {
  video: 'on',
  trace: 'on',
}
```

## Integration with CI/CD

For GitHub Actions or other CI:

```bash
# Run and generate report
/e2e --verbose

# Report is in e2e/playwright-report/
# Upload as artifact or embed in PR
```

## See also

- `e2e/playwright.config.ts` — baseURL/project config
- `e2e/fixtures/auth.ts` — login helper implementation
