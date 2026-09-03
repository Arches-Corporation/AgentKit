'use strict';

const NAME = 'rules-reminder';

const DEFAULTS = {
  text: '',
  oncePerSession: true,
};

function check(event, ctx) {
  const opts = Object.assign({}, DEFAULTS, ctx.options);
  const text = Array.isArray(opts.text) ? opts.text.join(' ') : String(opts.text || '');
  if (!text) return null;

  if (opts.oncePerSession && event.sessionId) {
    const sid = event.sessionId.replace(/[^\w-]/g, '');
    const marker = `rules-reminder-${sid}`;
    if (ctx.markers.exists(marker)) return null;
    ctx.markers.place(marker);
  }

  return { inject: text };
}

module.exports = {
  name: NAME,
  events: ['UserPromptSubmit'],
  matcher: null,
  failClosed: false,
  defaults: DEFAULTS,
  check,
};
