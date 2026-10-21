/** Exercise the real deploy rollback flow with local shell-command doubles; no server is contacted. */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const script = readFileSync('deploy/deploy.sh', 'utf8').replace(/\r\n/g, '\n')
const flow = script.slice(script.indexOf('reload() {'), script.indexOf('# Keep the newest releases'))
const folder = mkdtempSync(join(tmpdir(), 'xtend-deploy-check-'))
const bash = process.env.BASH_BIN || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash')
try {
  mkdirSync(join(folder, 'previous'))
  writeFileSync(join(folder, 'flow.sh'), flow)
  writeFileSync(join(folder, 'check.sh'), `#!/usr/bin/env bash
set -euo pipefail
APP_DIR=.
REL=./next
BUILD_ID=new
PREVIOUS=./previous
attempt=0
log() { echo "$*"; }
ln() { echo "link $*"; }
mv() { echo "move $*"; }
sleep() { :; }
pm2() {
  if [ "$1" = startOrReload ]; then
    attempt=$((attempt + 1))
    echo "reload $attempt" >&2
    if [ "$SCENARIO" = reload-failure ] && [ "$attempt" = 1 ]; then return 1; fi
    if [ "$SCENARIO" = rollback-failure ]; then return 1; fi
  fi
  return 0
}
curl() {
  if [ "$SCENARIO" = healthy ]; then printf '{"build":"new"}'; return; fi
  if [ "$attempt" -gt 1 ]; then printf '{"build":"previous"}'; return; fi
  return 1
}
source ./flow.sh
`)
  for (const scenario of ['healthy', 'reload-failure', 'health-failure', 'rollback-failure']) {
    const result = spawnSync(bash, ['check.sh'], {
      cwd: folder, env: { ...process.env, SCENARIO: scenario }, encoding: 'utf8', timeout: 15000,
    })
    if (result.error) throw result.error
    const output = result.stdout + result.stderr
    assert.equal(result.status, scenario === 'healthy' ? 0 : 1, output)
    if (scenario === 'healthy') {
      assert.match(output, /live: new/)
      assert.doesNotMatch(output, /reload 2/)
    } else {
      assert.match(output, /reload 2/, output)
      assert.match(output, scenario === 'rollback-failure' ? /manual recovery required/ : /rolled back to previous/)
    }
    console.log(`ok: ${scenario}`)
  }
  console.log('ALL DEPLOY CHECKS PASSED')
} finally {
  // Only the dedicated directory returned by mkdtemp is removed.
  rmSync(folder, { recursive: true, force: true })
}
