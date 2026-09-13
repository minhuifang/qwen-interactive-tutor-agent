// Explicit local integration test. No model calls; session tokens are never logged.
import assert from 'node:assert/strict';
const base = 'http://localhost:3001/api/local-runner/';
const headers = { Origin: 'http://localhost:3001', 'Content-Type': 'application/json', 'X-Tutor-Local': '1' };
const session = await fetch(base + 'session', { method: 'POST', headers, body: '{}' });
assert.equal(session.status, 200);
const { token } = await session.json();
const run = (job, overrides = {}) => fetch(base + 'verify', { method: 'POST', headers: { ...headers, 'X-Tutor-Runner-Token': token, ...overrides }, body: JSON.stringify(job), signal: AbortSignal.timeout(30000) });
const job = { code: 'function solve(input) { return input.reduce((a,b) => a+b, 0); }', acknowledged: true,
  cases: [{ input: [1, 2], expected: 3 }, { input: [], expected: 0 }, { input: [1, 2], expected: 999 }] };
assert.equal((await run(job, { Origin: 'https://evil.test' })).status, 403);
assert.equal((await run(job, { 'X-Tutor-Runner-Token': 'invalid' })).status, 403);
assert.equal((await run({ ...job, acknowledged: false })).status, 400);
const response = await run(job);
assert.equal(response.status, 200);
const report = await response.json();
assert.deepEqual(report.results.map(r => r.status), ['passed', 'passed', 'failed']);
assert.equal(report.status, 'not_passed');
console.log(JSON.stringify({ check: 'same-origin HTTP to Docker: correct and wrong expected values', report }));
const timeout = await run({ ...job, code: 'function solve() { while(true) {} }' });
assert.equal(timeout.status, 200);
const timeoutReport = await timeout.json();
assert.deepEqual(timeoutReport.results.map(r => r.status), ['timeout']);
console.log(JSON.stringify({ check: 'hard timeout and subsequent cases skipped', report: timeoutReport }));
