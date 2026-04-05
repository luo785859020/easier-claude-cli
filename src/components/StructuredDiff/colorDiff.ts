// color-diff-napi is a private native module, using no-op stubs
// import {
//   ColorDiff,
//   ColorFile,
//   getSyntaxTheme as nativeGetSyntaxTheme,
//   type SyntaxTheme,
// } from 'color-diff-napi'

export type SyntaxTheme = unknown
import { isEnvDefinedFalsy } from '../../utils/envUtils.js'

export type ColorModuleUnavailableReason = 'env'

/**
 * Returns a static reason why the color-diff module is unavailable, or null if available.
 * 'env' = disabled via CLAUDE_CODE_SYNTAX_HIGHLIGHT
 *
 * The TS port of color-diff works in all build modes, so the only way to
 * disable it is via the env var.
 */
export function getColorModuleUnavailableReason(): ColorModuleUnavailableReason | null {
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_SYNTAX_HIGHLIGHT)) {
    return 'env'
  }
  return null
}

export function expectColorDiff(): null {
  return null
}

export function expectColorFile(): null {
  return null
}

export function getSyntaxTheme(_themeName: string): SyntaxTheme | null {
  return null
}
