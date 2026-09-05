'use strict';

// RM core gates injected into context: the full ruleset once at SessionStart,
// a terse reminder on every prompt. Keeps the non-negotiable conventions present
// without relying on the model to remember them.

const FULL = [
  'Referral-Management core gates (enforced conventions):',
  '- Run `npm run check` after changes (Biome + typecheck + ESLint comment rule + build); finish with zero errors.',
  '- Respect the 4-layer boundaries: app -> actions -> usecases -> data. Components never import usecases/repositories/Supabase directly.',
  '- No inter-UseCase calls: a UseCase must not call another UseCase.',
  '- Error messages: Japanese, ending with the fullwidth period `。`. Zod-validated; Server Actions return `{ success, errors }`.',
  '- Code comments: English only (the ESLint no-non-ascii-comment rule is enforced). Domain terms may be quoted in 「…」 or backticks.',
  '- Specs live in docs/features/ — use the Light lane (docs/features/_TEMPLATE-light.md) for trivial changes, the full requirement-builder otherwise.',
  '- Do not commit/push/PR unless the user explicitly asked.',
].join('\n');

const TERSE =
  '[gates] npm run check must pass; layer boundaries (no component->usecase/repo, no usecase->usecase); ' +
  'Japanese error messages ending 。; English-only comments; no commit/push unless asked.';

function check(event) {
  return { inject: event.hookEvent === 'SessionStart' ? FULL : TERSE };
}

module.exports = {
  name: 'dev-rules-reminder',
  events: ['SessionStart', 'UserPromptSubmit'],
  matcher: null,
  failClosed: false,
  defaults: {},
  check,
};
