export type ModifierKey = 'shift' | 'command' | 'control' | 'option'

let prewarmed = false

/**
 * Pre-warm the native module by loading it in advance.
 * Call this early to avoid delay on first use.
 */
export function prewarmModifiers(): void {
  if (prewarmed || process.platform !== 'darwin') {
    return
  }
  prewarmed = true
  // Load module in background
  try {
    // modifiers-napi is a private native module, skip silently
  } catch {
    // Ignore errors during prewarm
  }
}

/**
 * Check if a specific modifier key is currently pressed (synchronous).
 */
export function isModifierPressed(modifier: ModifierKey): boolean {
  if (process.platform !== 'darwin') {
    return false
  }
  // modifiers-napi is a private native module, return false as fallback
  return false
}
