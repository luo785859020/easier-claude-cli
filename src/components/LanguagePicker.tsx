import figures from 'figures'
import React, { useState } from 'react'
import { Box, Text } from '../ink.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import { shouldUseChineseUi } from '../utils/uiLanguage.js'
import TextInput from './TextInput.js'

type Props = {
  initialLanguage: string | undefined
  onComplete: (language: string | undefined) => void
  onCancel: () => void
}

export function LanguagePicker({
  initialLanguage,
  onComplete,
  onCancel,
}: Props): React.ReactNode {
  const [language, setLanguage] = useState(initialLanguage)
  const [cursorOffset, setCursorOffset] = useState(
    (initialLanguage ?? '').length,
  )
  const useChineseUi = shouldUseChineseUi()

  useKeybinding('confirm:no', onCancel, { context: 'Settings' })

  function handleSubmit(): void {
    const trimmed = language?.trim()
    onComplete(trimmed || undefined)
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text>
        {useChineseUi
          ? '请输入偏好的回复与语音语言：'
          : 'Enter your preferred response and voice language:'}
      </Text>
      <Box flexDirection="row" gap={1}>
        <Text>{figures.pointer}</Text>
        <TextInput
          value={language ?? ''}
          onChange={setLanguage}
          onSubmit={handleSubmit}
          focus
          showCursor
          placeholder={`${
            useChineseUi
              ? '例如：中文、English、日本語'
              : 'e.g., Japanese, 日本語, Espanol'
          }${figures.ellipsis}`}
          columns={60}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
        />
      </Box>
      <Text dimColor>
        {useChineseUi
          ? '留空则使用默认值（英文）'
          : 'Leave empty for default (English)'}
      </Text>
    </Box>
  )
}
