'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const test = require('node:test');

const REAPER = '/Users/michael/.local/bin/herdr-workspace-reaper';

function python(source) {
  const result = childProcess.spawnSync('/usr/bin/python3', ['-c', source], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test('reaper never selects scheduled-- workspaces as stale candidates', () => {
  const output = python(`
import datetime as dt
import importlib.machinery
import importlib.util
import json
loader = importlib.machinery.SourceFileLoader("reaper", ${JSON.stringify(REAPER)})
spec = importlib.util.spec_from_loader("reaper", loader)
reaper = importlib.util.module_from_spec(spec)
loader.exec_module(reaper)
cutoff = dt.datetime.now(dt.timezone.utc)
agent = {
  "agent": "omp",
  "agent_status": "idle",
  "agent_session": {"value": "/Users/michael/.omp/agent/sessions/test/2026-01-01T00-00-00-000Z_session.jsonl"},
}
cases = [
  {"workspace_id": "w1", "label": "scheduled--audit-a1b2", "agent_status": "idle", "focused": False, "worktree": {"checkout_path": "/Users/michael/.herdr/worktrees/repo/other", "is_linked_worktree": True}},
  {"workspace_id": "w2", "label": "other", "agent_status": "idle", "focused": False, "worktree": {"checkout_path": "/Users/michael/.herdr/worktrees/repo/scheduled--audit-a1b2", "is_linked_worktree": True}},
  {"workspace_id": "w3", "label": "other", "agent_status": "idle", "focused": False, "worktree": {"branch": "scheduled--audit-a1b2", "checkout_path": "/Users/michael/.herdr/worktrees/repo/other", "is_linked_worktree": True}},
]
results = [reaper.evaluate_workspace(case, {case["workspace_id"]: [agent]}, cutoff) for case in cases]
print(json.dumps(results))
`);
  const results = JSON.parse(output);
  assert.deepEqual(results, [
    [false, 'scheduled_worktree=true'],
    [false, 'scheduled_worktree=true'],
    [false, 'scheduled_worktree=true'],
  ]);
});
