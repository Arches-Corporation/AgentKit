'use strict';

const hardStop = require('./guardrails/hard-stop.cjs');
const specFirst = require('./guardrails/spec-first.cjs');
const privacyBlock = require('./guardrails/privacy-block.cjs');
const secretOutput = require('./guardrails/secret-output.cjs');
const scoutBlock = require('./guardrails/scout-block.cjs');
const forcePushGuard = require('./guardrails/force-push-guard.cjs');
const dbGuard = require('./guardrails/db-guard.cjs');
const rulesReminder = require('./guardrails/rules-reminder.cjs');

const GUARDRAILS = [hardStop, specFirst, privacyBlock, secretOutput, scoutBlock, forcePushGuard, dbGuard, rulesReminder];

const byName = new Map(GUARDRAILS.map((g) => [g.name, g]));

function get(name) {
  return byName.get(name) || null;
}

function list() {
  return GUARDRAILS.slice();
}

module.exports = { get, list };
