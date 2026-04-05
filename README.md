# Easier Claude CLI

一个更方便落地的 `Claude Code CLI` 分支，基于 `@anthropic-ai/claude-code v2.1.88`，在本地使用、第三方模型接入、语音交互和 Windows 启动体验上做了收口。

这个仓库面向源码使用和二次开发，不是 Anthropic 官方发行版。

## 相比原版的改动

- 更方便的第三方模型配置
  - 支持 `OpenAI-compatible API`
  - 支持 `Ollama`
  - 支持 `Codex`
  - 提供启动脚本直接填写 `API Key / Base URL / Model`
  - 支持把第三方模型配置保存到本地 Claude 配置，下次直接启动
- 增加常用厂商快捷入口
  - `start-minimax.cmd`
  - `start-volcengine.cmd`
  - `start-third-party.cmd`
- 桌面端语音交互增强
  - 支持 `OpenAI-compatible` 语音转文字
  - 支持 `OpenAI-compatible` TTS
  - 支持在 `/config` 中开启回复朗读
- 更完整的本地使用体验
  - 增加 `buddy` 桌宠功能
  - 增加界面语言切换，支持中文/英文
  - 优化 Windows 本地启动链路，减少对手工配置 Bun PATH 的依赖
- 分叉方向上的基础调整
  - 继承了 `free-code` 路线中的本地化构建、feature flag、关闭遥测/本地优先等改动

## 当前包含的能力

- 交互式 Claude Code CLI
- 第三方聊天模型接入
- 桌面端语音输入/语音播报
- `buddy` 交互功能
- 本地构建脚本和 full build

## 环境要求

- Node.js `>= 18`
- Bun `>= 1.3.x`
- Windows PowerShell

## 安装

```powershell
npm install
```

如果本机已安装 Bun，也可以使用：

```powershell
bun install
```

## 构建

开发版完整特性构建：

```powershell
npm run build:dev:full
```

正式完整特性构建：

```powershell
npm run compile:full
```

## 启动方式

### 1. 默认本地启动

```powershell
.\claude-local.cmd
```

### 2. 通用第三方模型

```powershell
.\start-third-party.cmd
```

启动时按提示填写：

- `API Key`
- `Base URL`
- `Model name`

可选保存到本地配置，下次直接复用。

### 3. MiniMax

```powershell
.\start-minimax.cmd
```

### 4. 火山方舟

```powershell
.\start-volcengine.cmd
```

默认会引导填写：

- `Volcengine API Key`
- `Volcengine chat Base URL`
- `Volcengine endpoint ID / model name`
- 可选语音配置

## 第三方模型环境变量示例

### OpenAI-compatible

```powershell
$env:CLAUDE_CODE_USE_OPENAI="1"
$env:OPENAI_API_KEY="your-key"
$env:OPENAI_BASE_URL="https://your-endpoint/v1"
$env:OPENAI_MODEL="your-model"

.\claude-local.cmd
```

### Ollama

```powershell
$env:CLAUDE_CODE_USE_OLLAMA="1"
$env:OLLAMA_BASE_URL="http://127.0.0.1:11434/v1"
$env:OLLAMA_MODEL="qwen2.5-coder:7b"

.\claude-local.cmd
```

### Codex

```powershell
$env:CLAUDE_CODE_USE_CODEX="1"
$env:OPENAI_MODEL="gpt-5.3-codex"

.\claude-local.cmd
```

## 语音功能

如果语音厂商支持 `OpenAI-compatible` 协议，可以配置：

```powershell
$env:CLAUDE_CODE_USE_OPENAI_SPEECH="1"
$env:OPENAI_SPEECH_API_KEY="your-speech-key"
$env:OPENAI_SPEECH_BASE_URL="https://your-speech-endpoint/v1"
$env:OPENAI_SPEECH_STT_MODEL="your-stt-model"
$env:OPENAI_SPEECH_TTS_MODEL="your-tts-model"
$env:OPENAI_SPEECH_TTS_VOICE="alloy"
```

进入 CLI 后：

- 输入 `/voice` 使用语音输入
- 输入 `/config` 开启 `Read replies aloud`

## 常用命令

- `/login`
- `/model`
- `/config`
- `/voice`
- `/buddy`
- `/clear`

## buddy

进入 CLI 后输入：

```text
/buddy
```

可进行：

- 抽取桌宠
- 切换桌宠
- 调整 Soul
- 查看属性

## 仓库发布说明

公开仓库只建议上传：

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
- 本地密钥、配置、缓存文件

## 许可证

本仓库保留当前项目中的 `MIT` 许可证文件。  
如果你继续公开发布或商用，请自行确认与上游项目及其依赖的许可证兼容性。
