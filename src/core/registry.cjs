'use strict';

const hardStop = require('./guardrails/hard-stop.cjs');
const specFirst = require('./guardrails/spec-first.cjs');
const privacyBlock = require('./guardrails/privacy-block.cjs');
const secretOutput = require('./guardrails/secret-output.cjs');
const scoutBlock = require('./guardrails/scout-block.cjs');

const GUARDRAILS = [hardStop, specFirst, privacyBlock, secretOutput, scoutBlock];

const byName = new Map(GUARDRAILS.map((g) => [g.name, g]));

function get(name) {
  return byName.get(name) || null;
}

function list() {
  return GUARDRAILS.slice();
}

module.exports = { get, list };
