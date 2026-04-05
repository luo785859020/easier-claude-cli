# Easier Claude CLI

A more practical `Claude Code CLI` fork focused on local use, easier third-party model setup, desktop voice interaction, and a smoother Windows workflow.

This repository is intended for source use and secondary development. It is not an official Anthropic release.

---

## English

### What This Fork Changes

Compared with the original Claude Code CLI, this fork adds or improves:

- easier third-party model setup
- OpenAI-compatible provider support
- Ollama support
- Codex support
- guided startup scripts for `API Key / Base URL / Model`
- local persistence for third-party provider settings
- desktop voice input and TTS through OpenAI-compatible speech endpoints
- a Windows-friendly local startup flow
- `buddy` desktop pet support
- UI language switching between Chinese and English
- full-build scripts with feature-set based builds

### Included Shortcuts

- `claude-local.cmd`
  - default local launcher
- `start-third-party.cmd`
  - generic OpenAI-compatible launcher
- `start-minimax.cmd`
  - MiniMax shortcut
- `start-volcengine.cmd`
  - Volcengine Ark shortcut

### Requirements

- Node.js `>= 18`
- Bun `>= 1.3.x`
- Windows PowerShell recommended

### Install

```powershell
npm install
```

If Bun is already installed:

```powershell
bun install
```

### Build

Development build with the full feature set:

```powershell
npm run build:dev:full
```

Compiled full build:

```powershell
npm run compile:full
```

### Start

Default local startup:

```powershell
.\claude-local.cmd
```

Generic third-party provider:

```powershell
.\start-third-party.cmd
```

MiniMax:

```powershell
.\start-minimax.cmd
```

Volcengine Ark:

```powershell
.\start-volcengine.cmd
```

### Third-Party Model Example

OpenAI-compatible provider:

```powershell
$env:CLAUDE_CODE_USE_OPENAI="1"
$env:OPENAI_API_KEY="your-key"
$env:OPENAI_BASE_URL="https://your-endpoint/v1"
$env:OPENAI_MODEL="your-model"

.\claude-local.cmd
```

Ollama:

```powershell
$env:CLAUDE_CODE_USE_OLLAMA="1"
$env:OLLAMA_BASE_URL="http://127.0.0.1:11434/v1"
$env:OLLAMA_MODEL="qwen2.5-coder:7b"

.\claude-local.cmd
```

Codex:

```powershell
$env:CLAUDE_CODE_USE_CODEX="1"
$env:OPENAI_MODEL="gpt-5.3-codex"

.\claude-local.cmd
```

### Voice Features

This fork can use OpenAI-compatible speech endpoints for:

- speech-to-text
- text-to-speech
- reply readout in the desktop CLI

Example speech configuration:

```powershell
$env:CLAUDE_CODE_USE_OPENAI_SPEECH="1"
$env:OPENAI_SPEECH_API_KEY="your-speech-key"
$env:OPENAI_SPEECH_BASE_URL="https://your-speech-endpoint/v1"
$env:OPENAI_SPEECH_STT_MODEL="your-stt-model"
$env:OPENAI_SPEECH_TTS_MODEL="your-tts-model"
$env:OPENAI_SPEECH_TTS_VOICE="alloy"
```

Inside the CLI:

- use `/voice` for voice input
- use `/config` and enable `Read replies aloud`

### Common Commands

- `/login`
- `/model`
- `/config`
- `/voice`
- `/buddy`
- `/clear`

### buddy

Run:

```text
/buddy
```

You can:

- draw a pet
- switch pets
- adjust soul/personality
- inspect pet attributes

### Public Repository Notes

This repository is intended to publish source only.

Do publish:

- `src/`
- `scripts/`
- startup scripts
- `package.json`
- `package-lock.json`
- `bun.lockb`
- docs and license files

Do not publish:

- `node_modules/`
- `dist/`
- `cli-dev.exe`
- `*.bun-build`
- local secrets, local config, caches

---

## 中文

### 这个分叉版改了什么

相比原版 Claude Code CLI，这个仓库重点做了下面几类改动：

- 第三方模型接入更方便
- 支持 `OpenAI-compatible API`
- 支持 `Ollama`
- 支持 `Codex`
- 提供引导式启动脚本，直接填写 `API Key / Base URL / Model`
- 支持把第三方模型配置保存到本地 Claude 配置
- 桌面端支持 OpenAI-compatible 语音输入和 TTS
- Windows 本地启动流程更顺手
- 增加 `buddy` 桌宠功能
- 增加中英文界面切换
- 增加完整特性构建脚本

### 内置启动入口

- `claude-local.cmd`
  - 默认本地启动
- `start-third-party.cmd`
  - 通用第三方模型入口
- `start-minimax.cmd`
  - MiniMax 快捷入口
- `start-volcengine.cmd`
  - 火山方舟快捷入口

### 环境要求

- Node.js `>= 18`
- Bun `>= 1.3.x`
- 推荐使用 Windows PowerShell

### 安装

```powershell
npm install
```

如果已经装了 Bun，也可以：

```powershell
bun install
```

### 构建

开发版完整特性构建：

```powershell
npm run build:dev:full
```

完整编译版：

```powershell
npm run compile:full
```

### 启动

默认本地启动：

```powershell
.\claude-local.cmd
```

通用第三方模型：

```powershell
.\start-third-party.cmd
```

MiniMax：

```powershell
.\start-minimax.cmd
```

火山方舟：

```powershell
.\start-volcengine.cmd
```

### 第三方模型配置示例

OpenAI-compatible：

```powershell
$env:CLAUDE_CODE_USE_OPENAI="1"
$env:OPENAI_API_KEY="your-key"
$env:OPENAI_BASE_URL="https://your-endpoint/v1"
$env:OPENAI_MODEL="your-model"

.\claude-local.cmd
```

Ollama：

```powershell
$env:CLAUDE_CODE_USE_OLLAMA="1"
$env:OLLAMA_BASE_URL="http://127.0.0.1:11434/v1"
$env:OLLAMA_MODEL="qwen2.5-coder:7b"

.\claude-local.cmd
```

Codex：

```powershell
$env:CLAUDE_CODE_USE_CODEX="1"
$env:OPENAI_MODEL="gpt-5.3-codex"

.\claude-local.cmd
```

### 语音功能

这个版本支持通过 OpenAI-compatible 语音接口实现：

- 语音转文字
- 文字转语音
- CLI 回复朗读

配置示例：

```powershell
$env:CLAUDE_CODE_USE_OPENAI_SPEECH="1"
$env:OPENAI_SPEECH_API_KEY="your-speech-key"
$env:OPENAI_SPEECH_BASE_URL="https://your-speech-endpoint/v1"
$env:OPENAI_SPEECH_STT_MODEL="your-stt-model"
$env:OPENAI_SPEECH_TTS_MODEL="your-tts-model"
$env:OPENAI_SPEECH_TTS_VOICE="alloy"
```

进入 CLI 后：

- 输入 `/voice` 开启语音输入
- 输入 `/config` 后开启 `Read replies aloud`

### 常用命令

- `/login`
- `/model`
- `/config`
- `/voice`
- `/buddy`
- `/clear`

### buddy

进入 CLI 后输入：

```text
/buddy
```

可以进行：

- 抽取桌宠
- 切换桌宠
- 调整 Soul
- 查看属性

### 公开仓库说明

这个仓库只建议公开源码，不要上传本机安装物和构建产物。

建议保留：

- `src/`
- `scripts/`
- 启动脚本
- `package.json`
- `package-lock.json`
- `bun.lockb`
- 文档和许可证

不要上传：

- `node_modules/`
- `dist/`
- `cli-dev.exe`
- `*.bun-build`
- 本地密钥、本地配置、缓存文件

---

## License

This repository currently keeps the `MIT` license file from the project tree.

If you continue to publish, redistribute, or use this fork commercially, verify upstream license compatibility yourself.
