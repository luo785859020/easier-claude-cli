const { spawnSync } = require('child_process')
const { existsSync } = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)

function getBuiltArtifact() {
  const preferred = [
    path.join(root, 'cli-dev.exe'),
    path.join(root, 'cli-dev'),
    path.join(root, 'dist', 'cli.exe'),
    path.join(root, 'dist', 'cli'),
    path.join(root, 'cli.exe'),
    path.join(root, 'cli'),
  ]

  return preferred.find((file) => existsSync(file)) || null
}

function runBuild() {
  const launcher = path.join(__dirname, 'run-bun.cjs')
  const result = spawnSync(
    process.execPath,
    [launcher, 'run', './scripts/build.ts', '--dev', '--feature-set=dev-full'],
    {
      stdio: 'inherit',
      cwd: root,
      env: process.env,
    },
  )

  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

let binary = getBuiltArtifact()
if (!binary) {
  runBuild()
  binary = getBuiltArtifact()
}

if (!binary) {
  console.error('No local Claude binary was produced.')
  process.exit(1)
}

const result = spawnSync(binary, args, {
  stdio: 'inherit',
  cwd: root,
  env: process.env,
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
