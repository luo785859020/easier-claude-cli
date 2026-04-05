const { spawnSync } = require('child_process')
const { existsSync } = require('fs')
const path = require('path')

function getPathCandidates() {
  const candidates = []

  if (process.env.BUN_EXE) {
    candidates.push(process.env.BUN_EXE)
  }

  if (process.execPath && /bun(?:\.exe)?$/i.test(path.basename(process.execPath))) {
    candidates.push(process.execPath)
  }

  const home =
    process.env.BUN_INSTALL ||
    (process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, '.bun')
      : process.env.HOME
        ? path.join(process.env.HOME, '.bun')
        : null)

  if (home) {
    candidates.push(
      path.join(home, 'bin', 'bun.exe'),
      path.join(home, 'bin', 'bun'),
    )
  }

  return [...new Set(candidates)]
}

function findBunOnPath() {
  const lookup = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(lookup, ['bun'], { encoding: 'utf8' })
  if (result.status !== 0) {
    return null
  }

  const first = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)

  return first || null
}

function resolveBun() {
  for (const candidate of getPathCandidates()) {
    if (candidate && existsSync(candidate)) {
      return candidate
    }
  }

  return findBunOnPath()
}

const bun = resolveBun()

if (!bun) {
  console.error(
    'Bun was not found. Install it first or set BUN_EXE to the Bun executable path.',
  )
  process.exit(1)
}

const env = {
  ...process.env,
  BUN_EXE: bun,
  PATH: `${path.dirname(bun)}${path.delimiter}${process.env.PATH || ''}`,
}

const result = spawnSync(bun, process.argv.slice(2), {
  stdio: 'inherit',
  env,
  cwd: process.cwd(),
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
