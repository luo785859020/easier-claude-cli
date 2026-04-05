import { spawn, spawnSync } from 'child_process'
import { rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

function hasCommand(command: string, args: string[] = ['--version']): boolean {
  const result = spawnSync(command, args, {
    stdio: 'ignore',
    timeout: 3_000,
  })
  return result.error === undefined
}

function createWindowsPlaybackCommand(path: string): {
  command: string
  args: string[]
} | null {
  const runner = hasCommand('powershell')
    ? 'powershell'
    : hasCommand('pwsh')
      ? 'pwsh'
      : null
  if (!runner) {
    return null
  }

  const escapedPath = path.replace(/'/g, "''")
  return {
    command: runner,
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$player = New-Object System.Media.SoundPlayer '${escapedPath}'; $player.Load(); $player.PlaySync()`,
    ],
  }
}

function createPosixPlaybackCommand(path: string): {
  command: string
  args: string[]
} | null {
  const candidates: Array<{ command: string; args: string[] }> = [
    { command: 'afplay', args: [path] },
    { command: 'paplay', args: [path] },
    { command: 'aplay', args: [path] },
    {
      command: 'ffplay',
      args: ['-nodisp', '-autoexit', '-loglevel', 'quiet', path],
    },
    { command: 'play', args: ['-q', path] },
    { command: 'mpv', args: ['--no-video', '--really-quiet', path] },
  ]

  for (const candidate of candidates) {
    if (hasCommand(candidate.command)) {
      return candidate
    }
  }
  return null
}

export function isAudioPlaybackAvailable(): boolean {
  if (process.platform === 'win32') {
    return createWindowsPlaybackCommand('C:\\temp\\placeholder.wav') !== null
  }

  return createPosixPlaybackCommand('/tmp/placeholder.wav') !== null
}

function spawnAndWait(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' })
    child.once('error', reject)
    child.once('close', code => {
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          `[speech] Audio playback command failed: ${command} ${args.join(' ')} (exit ${String(code)})`,
        ),
      )
    })
  })
}

export async function playWavBuffer(buffer: Buffer): Promise<void> {
  const tempPath = join(
    tmpdir(),
    `claude-code-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`,
  )
  await writeFile(tempPath, buffer)

  try {
    const playbackCommand =
      process.platform === 'win32'
        ? createWindowsPlaybackCommand(tempPath)
        : createPosixPlaybackCommand(tempPath)

    if (!playbackCommand) {
      throw new Error(
        'No supported local audio playback command is available for speech output.',
      )
    }

    await spawnAndWait(playbackCommand.command, playbackCommand.args)
  } finally {
    await rm(tempPath, { force: true }).catch(() => {})
  }
}
