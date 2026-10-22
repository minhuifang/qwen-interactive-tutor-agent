// Shared wire protocol for the agent loop. Both the Node-side runner and the
// browser timeline read these events; nothing here is model-authored text other
// than the `thought` / `approach` fields, which are always labelled as such.
//
// Events are newline-delimited JSON (NDJSON), one object per line, in order.

export const EVENT_TYPES = [
  'meta', 'round_start', 'thought', 'tool_call', 'tool_result',
  'round_end', 'final', 'error', 'done',
];

export const FINAL_STATUSES = [
  'examples_passed', // submitted code passed every confirmed example
  'not_passed',      // ran, but at least one example failed
  'not_run',         // never executed (sandbox unavailable / cancelled early)
  'blocked',         // tool failure we cannot recover from
  'cancelled',
  'round_limit',
  'budget_limit',
];

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const isString = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/**
 * Structural check used by the client before rendering an event. Unknown or
 * malformed lines are dropped instead of crashing the timeline.
 */
export function isValidEvent(event) {
  if (!isObject(event) || !EVENT_TYPES.includes(event.type)) return false;
  switch (event.type) {
    case 'meta':
      return isString(event.runId, 64) && isString(event.model, 120)
        && ['live', 'scripted'].includes(event.mode)
        && isInt(event.maxRounds, 1, 8) && isInt(event.caseCount, 0, 8)
        && isObject(event.problem) && isString(event.problem.title, 200);
    case 'round_start':
    case 'round_end':
      return isInt(event.round, 1, 8);
    case 'thought':
      return isInt(event.round, 1, 8) && typeof event.text === 'string' && event.text.length <= 8000;
    case 'tool_call':
      return isInt(event.round, 1, 8) && isString(event.id, 80)
        && ['run_tests', 'finish'].includes(event.tool) && isObject(event.args);
    case 'tool_result':
      return isInt(event.round, 1, 8) && isString(event.id, 80)
        && ['examples_passed', 'not_passed', 'invalid_arguments', 'unavailable', 'cancelled'].includes(event.status)
        && isInt(event.passed, 0, 8) && isInt(event.total, 0, 8);
    case 'final':
      return FINAL_STATUSES.includes(event.status) && isObject(event.solution ?? {})
        && isInt(event.rounds, 0, 8) && isString(event.reason, 400);
    case 'error':
      return isString(event.message, 400);
    case 'done':
      return true;
    default:
      return false;
  }
}

/** Parse one NDJSON line. Returns null for blank or invalid lines. */
export function parseEventLine(line) {
  if (typeof line !== 'string' || !line.trim() || line.length > 65536) return null;
  try {
    const value = JSON.parse(line);
    return isValidEvent(value) ? value : null;
  } catch {
    return null;
  }
}

/** Stable, dependency-free content hash so the loop can tell "same code" apart. */
export function hashCode(code) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
