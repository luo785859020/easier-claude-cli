import React, { useCallback, useEffect, useRef, useState } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { installOAuthTokens } from '../cli/handlers/auth.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { stringWidth } from '../ink/stringWidth.js';
import { setClipboard } from '../ink/termio/osc.js';
import { useTerminalNotification } from '../ink/useTerminalNotification.js';
import { Box, Link, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { listCodexCliModels, listExternalProviderModels, runExternalProviderCompletion, verifyExternalProviderLogin } from '../services/api/externalProvider.js';
import { getSSLErrorHint } from '../services/api/errorUtils.js';
import { sendNotification } from '../services/notifier.js';
import { refreshCodexToken, runCodexOAuthFlow } from '../services/oauth/codex-client.js';
import { OAuthService } from '../services/oauth/index.js';
import { getCodexOAuthTokens, getOauthAccountInfo, saveCodexOAuthTokens, validateForceLoginOrg } from '../utils/auth.js';
import { logError } from '../utils/log.js';
import { type ExternalModelProvider, getExternalProviderDefaultModel, saveOllamaProviderConfig, saveOpenAIProviderConfig } from '../utils/model/externalProvider.js';
import { getSettings_DEPRECATED } from '../utils/settings/settings.js';
import { shouldUseChineseUi } from '../utils/uiLanguage.js';
import { Select } from './CustomSelect/select.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { Spinner } from './Spinner.js';
import TextInput from './TextInput.js';
type Props = {
  onDone(): void;
  startingMessage?: string;
  mode?: 'login' | 'setup-token';
  forceLoginMethod?: 'claudeai' | 'console';
};
type OAuthStatus = {
  state: 'idle';
} // Initial state, waiting to select login method
| {
  state: 'platform_setup';
} // Show external provider/model setup info
| {
  state: 'ready_to_start';
} // Flow started, waiting for browser to open
| {
  state: 'waiting_for_login';
  url: string;
} // Browser opened, waiting for user to login
| {
  state: 'creating_api_key';
} // Got access token, creating API key
| {
  state: 'about_to_retry';
  nextState: OAuthStatus;
} | {
  state: 'success';
  token?: string;
} | {
  state: 'error';
  message: string;
  toRetry?: OAuthStatus;
};
type ExternalSetupOption = 'platform' | 'openai' | 'ollama' | 'codex' | null;
type ExternalCheckState = {
  status: 'idle' | 'checking' | 'success' | 'error';
  message?: string;
  model?: string;
  provider?: ExternalModelProvider;
};
type ExternalModelListState = {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  options: string[];
  message?: string;
};
type OpenAIInputField = 'api_key' | 'base_url' | 'model';
type OpenAISetupStage = 'credentials' | 'model_selection';
const uiText = (english: string, chinese: string): string =>
  shouldUseChineseUi() ? chinese : english;
const getPasteHereMessage = (): string =>
  uiText('Paste code here if prompted > ', '如果出现提示，请在这里粘贴验证码 > ');
const PASTE_HERE_MSG = uiText('Paste code here if prompted > ', '濡傚嚭鐜版彁绀猴紝璇峰湪姝ょ矘璐撮獙璇佺爜 > ');
const OPENAI_EDIT_CONFIG_OPTION = '__openai_edit_config__';
const ENTER_COMMAND_PROMPT_OPTION = '__enter_command_prompt__';
const SKIP_TO_COMMAND_PROMPT_OPTION = '__skip_to_command_prompt__';
function getExternalSetupHint(option: Exclude<ExternalSetupOption, 'platform' | null>): string {
  if (option === 'ollama') {
    return uiText(
      'Start Ollama and set CLAUDE_CODE_USE_OLLAMA=1. Optionally configure OLLAMA_BASE_URL / OLLAMA_MODEL.',
      '启动 Ollama，并设置 CLAUDE_CODE_USE_OLLAMA=1。也可以额外配置 OLLAMA_BASE_URL / OLLAMA_MODEL。',
    );
  }
  if (option === 'codex') {
    return uiText(
      'Use ChatGPT login (codex login). You can also use API key mode if preferred.',
      '使用 ChatGPT 账号登录（codex login）。如果你更习惯，也可以改用 API Key 模式。',
    );
  }
  return uiText(
    'Set OPENAI_API_KEY and CLAUDE_CODE_USE_OPENAI=1. Optionally configure OPENAI_MODEL / OPENAI_BASE_URL.',
    '设置 OPENAI_API_KEY 和 CLAUDE_CODE_USE_OPENAI=1。也可以额外配置 OPENAI_MODEL / OPENAI_BASE_URL。',
  );
}
function setOrUnsetEnvVar(key: 'OPENAI_API_KEY' | 'OPENAI_BASE_URL' | 'OPENAI_MODEL', value: string): string {
  const normalized = value.trim();
  if (normalized.length > 0) {
    process.env[key] = normalized;
  } else {
    delete process.env[key];
  }
  return normalized;
}
export function ConsoleOAuthFlow({
  onDone,
  startingMessage,
  mode = 'login',
  forceLoginMethod: forceLoginMethodProp
}: Props): React.ReactNode {
  const settings = getSettings_DEPRECATED() || {};
  const forceLoginMethod = forceLoginMethodProp ?? settings.forceLoginMethod;
  const orgUUID = settings.forceLoginOrgUUID;
  const forcedMethodMessage = forceLoginMethod === 'claudeai'
    ? uiText(
        'Login method pre-selected: Subscription Plan (Claude Pro/Max)',
        '已预选登录方式：订阅方案（Claude Pro/Max）',
      )
    : forceLoginMethod === 'console'
      ? uiText(
          'Login method pre-selected: API Usage Billing (Anthropic Console)',
          '已预选登录方式：API 按量计费（Anthropic Console）',
        )
      : null;
  const terminal = useTerminalNotification();
  const [oauthStatus, setOAuthStatus] = useState<OAuthStatus>(() => {
    if (mode === 'setup-token') {
      return {
        state: 'ready_to_start'
      };
    }
    if (forceLoginMethod === 'claudeai' || forceLoginMethod === 'console') {
      return {
        state: 'ready_to_start'
      };
    }
    return {
      state: 'idle'
    };
  });
  const [pastedCode, setPastedCode] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
  const [oauthService] = useState(() => new OAuthService());
  const [loginWithClaudeAi, setLoginWithClaudeAi] = useState(() => {
    // Use Claude AI auth for setup-token mode to support user:inference scope
    return mode === 'setup-token' || forceLoginMethod === 'claudeai';
  });
  const [externalSetupOption, setExternalSetupOption] = useState<ExternalSetupOption>(null);
  const [externalCheckState, setExternalCheckState] = useState<ExternalCheckState>({
    status: 'idle'
  });
  const [externalModelListState, setExternalModelListState] = useState<ExternalModelListState>({
    status: 'idle',
    options: []
  });
  const [selectedExternalModel, setSelectedExternalModel] = useState<string | null>(null);
  const [openAIApiKeyInput, setOpenAIApiKeyInput] = useState(() => process.env.OPENAI_API_KEY?.trim() || '');
  const [openAIBaseUrlInput, setOpenAIBaseUrlInput] = useState(() => process.env.OPENAI_BASE_URL?.trim() || '');
  const [openAIModelInput, setOpenAIModelInput] = useState(() => process.env.OPENAI_MODEL?.trim() || '');
  const [openAIApiKeyCursorOffset, setOpenAIApiKeyCursorOffset] = useState(0);
  const [openAIBaseUrlCursorOffset, setOpenAIBaseUrlCursorOffset] = useState(0);
  const [openAIModelCursorOffset, setOpenAIModelCursorOffset] = useState(0);
  const [openAIInputField, setOpenAIInputField] = useState<OpenAIInputField>('api_key');
  const [openAISetupStage, setOpenAISetupStage] = useState<OpenAISetupStage>('credentials');
  const [openAIConfigVersion, setOpenAIConfigVersion] = useState(0);
  // After a few seconds we suggest the user to copy/paste url if the
  // browser did not open automatically. In this flow we expect the user to
  // copy the code from the browser and paste it in the terminal
  const [showPastePrompt, setShowPastePrompt] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const terminalColumns = useTerminalSize().columns;
  const textInputColumns = terminalColumns - stringWidth(getPasteHereMessage()) - 1;
  const openAIInputColumns = Math.max(24, terminalColumns - 16);

  // Log forced login method on mount
  useEffect(() => {
    if (forceLoginMethod === 'claudeai') {
      logEvent('tengu_oauth_claudeai_forced', {});
    } else if (forceLoginMethod === 'console') {
      logEvent('tengu_oauth_console_forced', {});
    }
  }, [forceLoginMethod]);

  // Retry logic
  useEffect(() => {
    if (oauthStatus.state === 'about_to_retry') {
      const timer = setTimeout(setOAuthStatus, 1000, oauthStatus.nextState);
      return () => clearTimeout(timer);
    }
  }, [oauthStatus]);
  const handleOpenAIApiKeyChange = useCallback((value: string) => {
    setOpenAIApiKeyInput(value);
    setOrUnsetEnvVar('OPENAI_API_KEY', value);
    process.env.CLAUDE_CODE_USE_OPENAI = '1';
  }, []);
  const handleOpenAIBaseUrlChange = useCallback((value: string) => {
    setOpenAIBaseUrlInput(value);
    setOrUnsetEnvVar('OPENAI_BASE_URL', value);
  }, []);
  const handleOpenAIModelChange = useCallback((value: string) => {
    setOpenAIModelInput(value);
    setOrUnsetEnvVar('OPENAI_MODEL', value);
  }, []);
  const persistOpenAIConfig = useCallback((overrides?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  }) => {
    saveOpenAIProviderConfig({
      apiKey: overrides?.apiKey ?? openAIApiKeyInput,
      baseUrl: overrides?.baseUrl ?? openAIBaseUrlInput,
      model: overrides?.model ?? openAIModelInput
    });
  }, [openAIApiKeyInput, openAIBaseUrlInput, openAIModelInput]);
  const handleOpenAIApiKeySubmit = useCallback((value: string) => {
    handleOpenAIApiKeyChange(value);
    persistOpenAIConfig({
      apiKey: value
    });
    setOpenAIInputField('base_url');
  }, [handleOpenAIApiKeyChange, persistOpenAIConfig]);
  const handleOpenAIBaseUrlSubmit = useCallback((value: string) => {
    handleOpenAIBaseUrlChange(value);
    persistOpenAIConfig({
      baseUrl: value
    });
    setOpenAIInputField('model');
  }, [handleOpenAIBaseUrlChange, persistOpenAIConfig]);
  const handleOpenAIModelSubmit = useCallback((value: string) => {
    handleOpenAIModelChange(value);
    persistOpenAIConfig({
      model: value
    });
    setOpenAISetupStage('model_selection');
    setExternalCheckState({
      status: 'checking'
    });
    setExternalModelListState({
      status: 'loading',
      options: []
    });
    setOpenAIConfigVersion(prev => prev + 1);
  }, [handleOpenAIModelChange, persistOpenAIConfig]);
  const handleExternalSetupSelected = useCallback((option: Exclude<ExternalSetupOption, null>) => {
    setSelectedExternalModel(null);
    if (option === 'platform') {
      logEvent('tengu_oauth_platform_selected', {});
      setExternalCheckState({
        status: 'idle'
      });
      setExternalModelListState({
        status: 'idle',
        options: []
      });
    } else if (option === 'openai') {
      logEvent('tengu_oauth_openai_selected', {});
      const currentApiKey = process.env.OPENAI_API_KEY?.trim() || '';
      const currentBaseUrl = process.env.OPENAI_BASE_URL?.trim() || '';
      const currentModel = process.env.OPENAI_MODEL?.trim() || '';
      setOpenAIApiKeyInput(currentApiKey);
      setOpenAIBaseUrlInput(currentBaseUrl);
      setOpenAIModelInput(currentModel);
      setOpenAIApiKeyCursorOffset(currentApiKey.length);
      setOpenAIBaseUrlCursorOffset(currentBaseUrl.length);
      setOpenAIModelCursorOffset(currentModel.length);
      setOpenAIInputField(currentApiKey.length === 0 ? 'api_key' : currentBaseUrl.length === 0 ? 'base_url' : 'model');
      setOpenAISetupStage('credentials');
      setSelectedExternalModel(currentModel.length > 0 ? currentModel : null);
      process.env.CLAUDE_CODE_USE_OPENAI = '1';
      delete process.env.CLAUDE_CODE_USE_CODEX;
      setExternalCheckState({
        status: 'idle'
      });
      setExternalModelListState({
        status: 'idle',
        options: []
      });
    } else if (option === 'ollama') {
      logEvent('tengu_oauth_ollama_selected', {});
      delete process.env.CLAUDE_CODE_USE_CODEX;
      setExternalCheckState({
        status: 'checking'
      });
      setExternalModelListState({
        status: 'loading',
        options: []
      });
    } else {
      logEvent('tengu_oauth_codex_selected', {});
      process.env.CLAUDE_CODE_USE_CODEX = '1';
      delete process.env.CLAUDE_CODE_USE_OPENAI;
      setExternalCheckState({
        status: 'checking'
      });
      setExternalModelListState({
        status: 'loading',
        options: []
      });
    }
    setExternalSetupOption(option);
    setOAuthStatus({
      state: 'platform_setup'
    });
  }, []);
  const handleExternalModelSelected = useCallback((model: string) => {
    if (model === ENTER_COMMAND_PROMPT_OPTION) {
      if (externalCheckState.status === 'success') {
        onDone();
      }
      return;
    }
    if (model === SKIP_TO_COMMAND_PROMPT_OPTION) {
      onDone();
      return;
    }
    if (externalSetupOption === 'openai' && model === OPENAI_EDIT_CONFIG_OPTION) {
      setOpenAISetupStage('credentials');
      setOpenAIInputField('api_key');
      setExternalCheckState({
        status: 'idle'
      });
      setExternalModelListState({
        status: 'idle',
        options: []
      });
      return;
    }
    setSelectedExternalModel(model);
    if (externalSetupOption === 'ollama') {
      process.env.OLLAMA_MODEL = model;
      saveOllamaProviderConfig({
        apiKey: process.env.OLLAMA_API_KEY?.trim(),
        baseUrl: process.env.OLLAMA_BASE_URL?.trim(),
        model
      });
    } else {
      process.env.OPENAI_MODEL = model;
      persistOpenAIConfig({
        model
      });
    }
    setExternalCheckState(prev => ({
      ...prev,
      status: 'checking',
      model
    }));
  }, [externalCheckState.status, externalSetupOption, onDone, persistOpenAIConfig]);
  useEffect(() => {
    if (oauthStatus.state !== 'platform_setup' || !externalSetupOption || externalSetupOption === 'platform') {
      return;
    }
    if (externalSetupOption === 'openai' && openAISetupStage !== 'model_selection') {
      return;
    }
    let cancelled = false;
    const loadModelOptions = async () => {
      const configuredModel = externalSetupOption === 'ollama' ? process.env.OLLAMA_MODEL?.trim() : process.env.OPENAI_MODEL?.trim();
      if (externalSetupOption === 'codex') {
        const codexList = await listCodexCliModels();
        const fallbackCodexModels = ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini'];
        const baseModels = codexList.ok && codexList.models.length > 0 ? codexList.models : fallbackCodexModels;
        const options = configuredModel && !baseModels.includes(configuredModel) ? [configuredModel, ...baseModels] : baseModels;
        if (!cancelled) {
          setExternalModelListState({
            status: 'loaded',
            options,
            message: codexList.message + ' ' + uiText('Use number keys to pick a Codex model.', '使用数字键选择 Codex 模型。')
          });
          setSelectedExternalModel(configuredModel && configuredModel.length > 0 ? configuredModel : options[0]);
        }
        return;
      }
      const provider: ExternalModelProvider = externalSetupOption === 'ollama' ? 'ollama' : 'openai';
      setExternalModelListState({
        status: 'loading',
        options: []
      });
      const listResult = await listExternalProviderModels(provider);
      if (cancelled) {
        return;
      }
      if (!listResult.ok || listResult.models.length === 0) {
        const fallbackModel = configuredModel && configuredModel.length > 0 ? configuredModel : getExternalProviderDefaultModel(provider);
        setExternalModelListState({
          status: 'error',
          options: [fallbackModel],
          message: listResult.message + ' ' + uiText('Showing fallback model only.', '仅显示回退模型。')
        });
        setSelectedExternalModel(fallbackModel);
        return;
      }
      const selectedModel = configuredModel && listResult.models.includes(configuredModel) ? configuredModel : configuredModel && configuredModel.length > 0 ? configuredModel : listResult.models[0];
      const options = selectedModel && !listResult.models.includes(selectedModel) ? [selectedModel, ...listResult.models] : listResult.models;
      setExternalModelListState({
        status: 'loaded',
        options,
        message: listResult.message
      });
      setSelectedExternalModel(selectedModel);
    };
    void loadModelOptions();
    return () => {
      cancelled = true;
    };
  }, [oauthStatus.state, externalSetupOption, openAISetupStage, openAIConfigVersion]);
  useEffect(() => {
    if (oauthStatus.state !== 'platform_setup' || !externalSetupOption || externalSetupOption === 'platform') {
      return;
    }
    if (externalSetupOption === 'openai' && openAISetupStage !== 'model_selection') {
      return;
    }
    if (!selectedExternalModel && externalModelListState.status === 'loading') {
      return;
    }
    if (externalSetupOption === 'openai' && !selectedExternalModel) {
      return;
    }
    let cancelled = false;
    const provider: ExternalModelProvider = externalSetupOption === 'ollama' ? 'ollama' : 'openai';
    const model = selectedExternalModel && selectedExternalModel.trim().length > 0 ? selectedExternalModel.trim() : externalSetupOption === 'codex' ? process.env.OPENAI_MODEL?.trim() || 'gpt-5.3-codex' : getExternalProviderDefaultModel(provider);
    const setupHint = getExternalSetupHint(externalSetupOption);
    const runCheck = async () => {
      if (externalSetupOption === 'codex') {
        process.env.CLAUDE_CODE_USE_CODEX = '1';
        delete process.env.CLAUDE_CODE_USE_OPENAI;
        setExternalCheckState({
          status: 'checking',
          provider: 'openai',
          model,
          message: uiText('Checking Codex login state and selected model…', '正在检查 Codex 登录状态与所选模型…')
        });
        try {
          const existingTokens = getCodexOAuthTokens();
          if (existingTokens?.accessToken && existingTokens.expiresAt > Date.now() + 60000) {
            if (!cancelled) {
              setExternalCheckState({
                status: 'success',
                provider: 'openai',
                model,
                message: uiText('Codex is already logged in with ChatGPT.', 'Codex 已通过 ChatGPT 登录。')
              });
            }
            return;
          }
          if (existingTokens?.refreshToken) {
            try {
              const refreshed = await refreshCodexToken(existingTokens.refreshToken);
              saveCodexOAuthTokens(refreshed);
              if (!cancelled) {
                setExternalCheckState({
                  status: 'success',
                  provider: 'openai',
                  model,
                  message: uiText('Codex session refreshed successfully.', 'Codex 会话刷新成功。')
                });
              }
              return;
            } catch (refreshError) {
              logError(refreshError as Error);
            }
          }
          const codexTokens = await runCodexOAuthFlow(async (url) => {
            if (cancelled) {
              return;
            }
            setOAuthStatus({
              state: 'waiting_for_login',
              url
            });
            setTimeout(setShowPastePrompt, 3000, true);
          });
          if (cancelled) {
            return;
          }
          saveCodexOAuthTokens(codexTokens);
          setExternalCheckState({
            status: 'success',
            provider: 'openai',
            model,
            message: uiText('Codex login successful (ChatGPT).', 'Codex 登录成功（ChatGPT）。')
          });
          setOAuthStatus({
            state: 'success'
          });
          void sendNotification({
            message: 'Codex login successful',
            notificationType: 'auth_success'
          }, terminal);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logError(err as Error);
          if (!cancelled) {
            setExternalCheckState({
              status: 'error',
              provider: 'openai',
              model,
              message: uiText('Codex login failed:', 'Codex 登录失败：') + ' ' + errMsg
            });
            setOAuthStatus({
              state: 'error',
              message: errMsg,
              toRetry: {
                state: 'platform_setup'
              }
            });
          }
        }
        return;
      }
      setExternalCheckState({
        status: 'checking',
        provider,
        model
      });
      const verification = await verifyExternalProviderLogin(provider, {
        model
      }).catch(err => ({
        ok: false,
        message: err instanceof Error ? err.message : String(err)
      }));
      if (!verification.ok) {
        if (!cancelled) {
          setExternalCheckState({
            status: 'error',
            provider,
            model,
            message: `${verification.message} ${setupHint}`
          });
        }
        return;
      }
      try {
        await runExternalProviderCompletion({
          provider,
          model,
          systemPrompt: ['You are a coding assistant.'],
          messages: [{
            role: 'user',
            content: 'Reply with: ok'
          }],
          maxTokens: 16
        });
        if (!cancelled) {
          setExternalCheckState({
            status: 'success',
            provider,
            model,
            message: verification.message + ' ' + uiText('Model warm-up succeeded.', '模型预热成功。')
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (!cancelled) {
          setExternalCheckState({
            status: 'error',
            provider,
            model,
            message: uiText('Connected, but model warm-up failed:', '已连接，但模型预热失败：') + ' ' + errMsg + ' ' + setupHint
          });
        }
      }
    };
    void runCheck();
    return () => {
      cancelled = true;
    };
  }, [oauthStatus.state, externalSetupOption, openAISetupStage, selectedExternalModel, externalModelListState.status, openAIConfigVersion]);
  // Handle Enter to continue on success state
  useKeybinding('confirm:yes', () => {
    logEvent('tengu_oauth_success', {
      loginWithClaudeAi
    });
    onDone();
  }, {
    context: 'Confirmation',
    isActive: oauthStatus.state === 'success' && mode !== 'setup-token'
  });

  const resetPlatformSetupState = useCallback(() => {
    setExternalSetupOption(null);
    setSelectedExternalModel(null);
    setOpenAIInputField('api_key');
    setOpenAISetupStage('credentials');
    setExternalModelListState({
      status: 'idle',
      options: []
    });
    setExternalCheckState({
      status: 'idle'
    });
    setOAuthStatus({
      state: 'idle'
    });
  }, []);

  // Handle Esc to go back from platform setup (used by OpenAI input mode)
  useKeybinding('confirm:no', resetPlatformSetupState, {
    context: 'Confirmation',
    isActive: oauthStatus.state === 'platform_setup'
  });

  // Handle Enter to retry on error state
  useKeybinding('confirm:yes', () => {
    if (oauthStatus.state === 'error' && oauthStatus.toRetry) {
      setPastedCode('');
      setOAuthStatus({
        state: 'about_to_retry',
        nextState: oauthStatus.toRetry
      });
    }
  }, {
    context: 'Confirmation',
    isActive: oauthStatus.state === 'error' && !!oauthStatus.toRetry
  });
  useEffect(() => {
    if (pastedCode === 'c' && oauthStatus.state === 'waiting_for_login' && showPastePrompt && !urlCopied) {
      void setClipboard(oauthStatus.url).then(raw => {
        if (raw) process.stdout.write(raw);
        setUrlCopied(true);
        setTimeout(setUrlCopied, 2000, false);
      });
      setPastedCode('');
    }
  }, [pastedCode, oauthStatus, showPastePrompt, urlCopied]);
  async function handleSubmitCode(value: string, url: string) {
    try {
      // Expecting format "authorizationCode#state" from the authorization callback URL
      const [authorizationCode, state] = value.split('#');
      if (!authorizationCode || !state) {
        setOAuthStatus({
          state: 'error',
          message: 'Invalid code. Please make sure the full code was copied',
          toRetry: {
            state: 'waiting_for_login',
            url
          }
        });
        return;
      }

      // Track which path the user is taking (manual code entry)
      logEvent('tengu_oauth_manual_entry', {});
      oauthService.handleManualAuthCodeInput({
        authorizationCode,
        state
      });
    } catch (err: unknown) {
      logError(err);
      setOAuthStatus({
        state: 'error',
        message: (err as Error).message,
        toRetry: {
          state: 'waiting_for_login',
          url
        }
      });
    }
  }
  const startOAuth = useCallback(async () => {
    try {
      logEvent('tengu_oauth_flow_start', {
        loginWithClaudeAi
      });
      const result = await oauthService.startOAuthFlow(async url_0 => {
        setOAuthStatus({
          state: 'waiting_for_login',
          url: url_0
        });
        setTimeout(setShowPastePrompt, 3000, true);
      }, {
        loginWithClaudeAi,
        inferenceOnly: mode === 'setup-token',
        expiresIn: mode === 'setup-token' ? 365 * 24 * 60 * 60 : undefined,
        // 1 year for setup-token
        orgUUID
      }).catch(err_1 => {
        const isTokenExchangeError = err_1.message.includes('Token exchange failed');
        // Enterprise TLS proxies (Zscaler et al.) intercept the token
        // exchange POST and cause cryptic SSL errors. Surface an
        // actionable hint so the user isn't stuck in a login loop.
        const sslHint_0 = getSSLErrorHint(err_1);
        setOAuthStatus({
          state: 'error',
          message: sslHint_0 ?? (isTokenExchangeError ? 'Failed to exchange authorization code for access token. Please try again.' : err_1.message),
          toRetry: mode === 'setup-token' ? {
            state: 'ready_to_start'
          } : {
            state: 'idle'
          }
        });
        logEvent('tengu_oauth_token_exchange_error', {
          error: err_1.message,
          ssl_error: sslHint_0 !== null
        });
        throw err_1;
      });
      if (mode === 'setup-token') {
        // For setup-token mode, return the OAuth access token directly (it can be used as an API key)
        // Don't save to keychain - the token is displayed for manual use with CLAUDE_CODE_OAUTH_TOKEN
        setOAuthStatus({
          state: 'success',
          token: result.accessToken
        });
      } else {
        await installOAuthTokens(result);
        const orgResult = await validateForceLoginOrg();
        if (!orgResult.valid) {
          throw new Error(orgResult.message);
        }
        setOAuthStatus({
          state: 'success'
        });
        void sendNotification({
          message: uiText('Claude Code login successful', 'Claude Code 鐧诲綍鎴愬姛'),
          notificationType: 'auth_success'
        }, terminal);
      }
    } catch (err_0) {
      const errorMessage = (err_0 as Error).message;
      const sslHint = getSSLErrorHint(err_0);
      setOAuthStatus({
        state: 'error',
        message: sslHint ?? errorMessage,
        toRetry: {
          state: mode === 'setup-token' ? 'ready_to_start' : 'idle'
        }
      });
      logEvent('tengu_oauth_error', {
        error: errorMessage as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ssl_error: sslHint !== null
      });
    }
  }, [oauthService, setShowPastePrompt, loginWithClaudeAi, mode, orgUUID]);
  const pendingOAuthStartRef = useRef(false);
  useEffect(() => {
    if (oauthStatus.state === 'ready_to_start' && !pendingOAuthStartRef.current) {
      pendingOAuthStartRef.current = true;
      process.nextTick((startOAuth_0: () => Promise<void>, pendingOAuthStartRef_0: React.MutableRefObject<boolean>) => {
        void startOAuth_0();
        pendingOAuthStartRef_0.current = false;
      }, startOAuth, pendingOAuthStartRef);
    }
  }, [oauthStatus.state, startOAuth]);

  // Auto-exit for setup-token mode
  useEffect(() => {
    if (mode === 'setup-token' && oauthStatus.state === 'success') {
      // Delay to ensure static content is fully rendered before exiting
      const timer_0 = setTimeout((loginWithClaudeAi_0, onDone_0) => {
        logEvent('tengu_oauth_success', {
          loginWithClaudeAi: loginWithClaudeAi_0
        });
        // Don't clear terminal so the token remains visible
        onDone_0();
      }, 500, loginWithClaudeAi, onDone);
      return () => clearTimeout(timer_0);
    }
  }, [mode, oauthStatus, loginWithClaudeAi, onDone]);

  // Cleanup OAuth service when component unmounts
  useEffect(() => {
    return () => {
      oauthService.cleanup();
    };
  }, [oauthService]);
  return <Box flexDirection="column" gap={1}>
      {oauthStatus.state === 'waiting_for_login' && showPastePrompt && <Box flexDirection="column" key="urlToCopy" gap={1} paddingBottom={1}>
          <Box paddingX={1}>
            <Text dimColor>
              Browser didn't open? Use the URL below to sign in{' '}
            </Text>
            {urlCopied ? <Text color="success">(Copied!)</Text> : <Text dimColor>
                <KeyboardShortcutHint shortcut="c" action="copy" parens />
              </Text>}
          </Box>
          <Link url={oauthStatus.url}>
            <Text dimColor>{oauthStatus.url}</Text>
          </Link>
        </Box>}
      {mode === 'setup-token' && oauthStatus.state === 'success' && oauthStatus.token && <Box key="tokenOutput" flexDirection="column" gap={1} paddingTop={1}>
            <Text color="success">
              Long-lived authentication token created successfully!
            </Text>
            <Box flexDirection="column" gap={1}>
              <Text>Your OAuth token (valid for 1 year):</Text>
              <Text color="warning">{oauthStatus.token}</Text>
              <Text dimColor>
                Store this token securely. You won't be able to see it again.
              </Text>
              <Text dimColor>
                Use this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=&lt;token&gt;
              </Text>
            </Box>
          </Box>}
      <Box paddingLeft={1} flexDirection="column" gap={1}>
        <OAuthStatusMessage oauthStatus={oauthStatus} mode={mode} startingMessage={startingMessage} forcedMethodMessage={forcedMethodMessage} showPastePrompt={showPastePrompt} pastedCode={pastedCode} setPastedCode={setPastedCode} cursorOffset={cursorOffset} setCursorOffset={setCursorOffset} textInputColumns={textInputColumns} handleSubmitCode={handleSubmitCode} setOAuthStatus={setOAuthStatus} setLoginWithClaudeAi={setLoginWithClaudeAi} externalSetupOption={externalSetupOption} externalCheckState={externalCheckState} externalModelListState={externalModelListState} selectedExternalModel={selectedExternalModel} openAIApiKeyInput={openAIApiKeyInput} openAIBaseUrlInput={openAIBaseUrlInput} openAIModelInput={openAIModelInput} openAIApiKeyCursorOffset={openAIApiKeyCursorOffset} setOpenAIApiKeyCursorOffset={setOpenAIApiKeyCursorOffset} openAIBaseUrlCursorOffset={openAIBaseUrlCursorOffset} setOpenAIBaseUrlCursorOffset={setOpenAIBaseUrlCursorOffset} openAIModelCursorOffset={openAIModelCursorOffset} setOpenAIModelCursorOffset={setOpenAIModelCursorOffset} openAIInputField={openAIInputField} openAISetupStage={openAISetupStage} openAIInputColumns={openAIInputColumns} onOpenAIApiKeyChange={handleOpenAIApiKeyChange} onOpenAIBaseUrlChange={handleOpenAIBaseUrlChange} onOpenAIModelChange={handleOpenAIModelChange} onOpenAIApiKeySubmit={handleOpenAIApiKeySubmit} onOpenAIBaseUrlSubmit={handleOpenAIBaseUrlSubmit} onOpenAIModelSubmit={handleOpenAIModelSubmit} onExternalSetupSelected={handleExternalSetupSelected} onExternalModelSelected={handleExternalModelSelected} />
      </Box>
    </Box>;
}
type OAuthStatusMessageProps = {
  oauthStatus: OAuthStatus;
  mode: 'login' | 'setup-token';
  startingMessage: string | undefined;
  forcedMethodMessage: string | null;
  showPastePrompt: boolean;
  pastedCode: string;
  setPastedCode: (value: string) => void;
  cursorOffset: number;
  setCursorOffset: (offset: number) => void;
  textInputColumns: number;
  handleSubmitCode: (value: string, url: string) => void;
  setOAuthStatus: (status: OAuthStatus) => void;
  setLoginWithClaudeAi: (value: boolean) => void;
  externalSetupOption: ExternalSetupOption;
  externalCheckState: ExternalCheckState;
  externalModelListState: ExternalModelListState;
  selectedExternalModel: string | null;
  openAIApiKeyInput: string;
  openAIBaseUrlInput: string;
  openAIModelInput: string;
  openAIApiKeyCursorOffset: number;
  setOpenAIApiKeyCursorOffset: (offset: number) => void;
  openAIBaseUrlCursorOffset: number;
  setOpenAIBaseUrlCursorOffset: (offset: number) => void;
  openAIModelCursorOffset: number;
  setOpenAIModelCursorOffset: (offset: number) => void;
  openAIInputField: OpenAIInputField;
  openAISetupStage: OpenAISetupStage;
  openAIInputColumns: number;
  onOpenAIApiKeyChange: (value: string) => void;
  onOpenAIBaseUrlChange: (value: string) => void;
  onOpenAIModelChange: (value: string) => void;
  onOpenAIApiKeySubmit: (value: string) => void;
  onOpenAIBaseUrlSubmit: (value: string) => void;
  onOpenAIModelSubmit: (value: string) => void;
  onExternalSetupSelected: (option: Exclude<ExternalSetupOption, null>) => void;
  onExternalModelSelected: (model: string) => void;
};
function OAuthStatusMessage({
  oauthStatus,
  mode,
  startingMessage,
  forcedMethodMessage,
  showPastePrompt,
  pastedCode,
  setPastedCode,
  cursorOffset,
  setCursorOffset,
  textInputColumns,
  handleSubmitCode,
  setOAuthStatus,
  setLoginWithClaudeAi,
  externalSetupOption,
  externalCheckState,
  externalModelListState,
  selectedExternalModel,
  openAIApiKeyInput,
  openAIBaseUrlInput,
  openAIModelInput,
  openAIApiKeyCursorOffset,
  setOpenAIApiKeyCursorOffset,
  openAIBaseUrlCursorOffset,
  setOpenAIBaseUrlCursorOffset,
  openAIModelCursorOffset,
  setOpenAIModelCursorOffset,
  openAIInputField,
  openAISetupStage,
  openAIInputColumns,
  onOpenAIApiKeyChange,
  onOpenAIBaseUrlChange,
  onOpenAIModelChange,
  onOpenAIApiKeySubmit,
  onOpenAIBaseUrlSubmit,
  onOpenAIModelSubmit,
  onExternalSetupSelected,
  onExternalModelSelected
}: OAuthStatusMessageProps) {
  void setOAuthStatus;

  switch (oauthStatus.state) {
    case 'idle': {
      const title =
        startingMessage ??
        uiText(
          'Claude Code can use your Claude subscription, Anthropic Console billing, OpenAI API, local Ollama models, or Codex.',
          'Claude Code 可以使用你的 Claude 订阅、Anthropic Console 按量计费、OpenAI API、本地 Ollama 模型或 Codex。',
        );
      const options: Array<{
        label: React.ReactNode;
        value: 'claudeai' | 'console' | 'openai' | 'ollama' | 'codex' | 'platform';
      }> = [
        {
          label: (
            <Text>
              Claude account with subscription{' '}
              <Text dimColor={true}>
                {uiText('Pro, Max, Team, or Enterprise', 'Pro、Max、Team 或 Enterprise')}
              </Text>
            </Text>
          ),
          value: 'claudeai'
        },
        {
          label: (
            <Text>
              Anthropic Console account{' '}
              <Text dimColor={true}>{uiText('API usage billing', 'API 按量计费')}</Text>
            </Text>
          ),
          value: 'console'
        },
        {
          label: (
            <Text>
              OpenAI API key{' '}
              <Text dimColor={true}>{uiText('Use OPENAI_API_KEY / OPENAI_MODEL', '使用 OPENAI_API_KEY / OPENAI_MODEL')}</Text>
            </Text>
          ),
          value: 'openai'
        },
        {
          label: (
            <Text>
              Local Ollama model{' '}
              <Text dimColor={true}>{uiText('Use OLLAMA_BASE_URL / OLLAMA_MODEL', '使用 OLLAMA_BASE_URL / OLLAMA_MODEL')}</Text>
            </Text>
          ),
          value: 'ollama'
        },
        {
          label: (
            <Text>
              Codex (ChatGPT){' '}
              <Text dimColor={true}>{uiText('Sign in with your ChatGPT account', '使用你的 ChatGPT 账号登录')}</Text>
            </Text>
          ),
          value: 'codex'
        },
        {
          label: (
            <Text>
              3rd-party platform{' '}
              <Text dimColor={true}>{uiText('Amazon Bedrock, Microsoft Foundry, or Vertex AI', 'Amazon Bedrock、Microsoft Foundry 或 Vertex AI')}</Text>
            </Text>
          ),
          value: 'platform'
        }
      ];
      return <Box flexDirection="column" gap={1} marginTop={1}>
          <Text bold={true}>{title}</Text>
          <Text>{uiText('Select login method:', '请选择登录方式：')}</Text>
          <Box>
            <Select options={options} onChange={value => {
            if (value === 'platform' || value === 'openai' || value === 'ollama' || value === 'codex') {
              onExternalSetupSelected(value);
              return;
            }
            setOAuthStatus({
              state: 'ready_to_start'
            });
            if (value === 'claudeai') {
              logEvent('tengu_oauth_claudeai_selected', {});
              setLoginWithClaudeAi(true);
            } else {
              logEvent('tengu_oauth_console_selected', {});
              setLoginWithClaudeAi(false);
            }
          }} />
          </Box>
        </Box>;
    }
    case 'platform_setup': {
      const selectedProviderName = externalSetupOption === 'openai' ? 'OpenAI API' : externalSetupOption === 'ollama' ? 'Ollama' : externalSetupOption === 'codex' ? 'Codex (ChatGPT)' : null;
      return <Box flexDirection="column" gap={1} marginTop={1}>
          <Text bold={true}>
            {uiText(
              'Using external providers and local models',
              '使用第三方平台与本地模型',
            )}
          </Text>
          <Box flexDirection="column" gap={1}>
            <Text>
              {uiText(
                'You can use OpenAI API, local Ollama models, Codex, or cloud platforms like Bedrock, Foundry, and Vertex. Configure the required environment variables, then restart Claude Code.',
                '你可以使用 OpenAI API、本地 Ollama 模型、Codex，或 Bedrock、Foundry、Vertex 等云平台。先配置所需环境变量，再重新启动 Claude Code。',
              )}
            </Text>
            <Text>
              {uiText(
                'For enterprise-managed environments, ask your administrator for required credentials and endpoints.',
                '如果你的环境由企业统一管理，请向管理员获取所需的凭据和接口地址。',
              )}
            </Text>
            {selectedProviderName ? <Box flexDirection="column" marginTop={1} gap={1}>
                {externalSetupOption === 'openai' && openAISetupStage === 'credentials' ? <Box flexDirection="column" gap={1}>
                    <Text bold={true}>{uiText('Step 1/2: OpenAI credentials', '第 1/2 步：OpenAI 凭据')}</Text>
                    <Text dimColor={true}>{uiText('Set API Key, Base URL, and optionally a model name first. You will confirm the model in the next step.', '请先填写 API Key、Base URL，以及可选的模型名。下一步会再次确认模型。')}</Text>
                    <Text dimColor={true}>{uiText('Submitted values are saved to your local Claude config and auto-loaded next time.', '已提交的值会保存到本地 Claude 配置，下次启动会自动载入。')}</Text>
                    <Text dimColor={true}>{uiText('API key input is masked for safety.', '为了安全起见，API key 输入会被隐藏。')}</Text>
                    <Box>
                      <Text>{openAIInputField === 'api_key' ? '> ' : '  '}{uiText('API Key: ', 'API Key：')}</Text>
                      <TextInput value={openAIApiKeyInput} onChange={onOpenAIApiKeyChange} onSubmit={onOpenAIApiKeySubmit} cursorOffset={openAIApiKeyCursorOffset} onChangeCursorOffset={setOpenAIApiKeyCursorOffset} columns={openAIInputColumns} mask="*" focus={openAIInputField === 'api_key'} />
                    </Box>
                    <Box>
                      <Text>{openAIInputField === 'base_url' ? '> ' : '  '}{uiText('Base URL: ', 'Base URL：')}</Text>
                      <TextInput value={openAIBaseUrlInput} onChange={onOpenAIBaseUrlChange} onSubmit={onOpenAIBaseUrlSubmit} cursorOffset={openAIBaseUrlCursorOffset} onChangeCursorOffset={setOpenAIBaseUrlCursorOffset} columns={openAIInputColumns} focus={openAIInputField === 'base_url'} placeholder="https://api.openai.com/v1" />
                    </Box>
                    <Box>
                      <Text>{openAIInputField === 'model' ? '> ' : '  '}{uiText('Model: ', '模型：')}</Text>
                      <TextInput value={openAIModelInput} onChange={onOpenAIModelChange} onSubmit={onOpenAIModelSubmit} cursorOffset={openAIModelCursorOffset} onChangeCursorOffset={setOpenAIModelCursorOffset} columns={openAIInputColumns} focus={openAIInputField === 'model'} placeholder="MiniMax-M2.7" />
                    </Box>
                    <Text dimColor={true}>{uiText('Tip: leave Base URL empty to use the official endpoint. Press Enter on Model to continue.', '提示：留空 Base URL 将使用官方接口。模型这一行按 Enter 后继续。')}</Text>
                  </Box> : null}
                {(externalSetupOption !== 'openai' || openAISetupStage === 'model_selection') ? <>
                    <Text bold={true}>{externalSetupOption === 'openai' ? uiText('Step 2/2: Model selection', '第 2/2 步：模型选择') : uiText('Model selection:', '模型选择：')}</Text>
                    {externalModelListState.status === 'loading' ? <Box><Spinner /><Text>{uiText('Loading model list...', '正在加载模型列表...')}</Text></Box> : null}
                    {externalModelListState.status === 'error' ? <Text color="warning">{uiText('Model list warning: ', '模型列表警告：')}{externalModelListState.message}</Text> : null}
                    {externalModelListState.options.length > 0 ? <Box>
                        <Select key={[externalSetupOption || 'unknown', externalModelListState.options.length, selectedExternalModel || '', openAISetupStage, externalCheckState.status].join(':')} options={[...(externalCheckState.status === 'success' ? [{
                        label: <Text color="success">-&gt; Enter command prompt (use selected model)</Text>,
                        value: ENTER_COMMAND_PROMPT_OPTION
                      }] : selectedExternalModel ? [{
                        label: <Text color="warning">-&gt; Enter command prompt anyway (skip check)</Text>,
                        value: SKIP_TO_COMMAND_PROMPT_OPTION
                      }] : []), ...(externalSetupOption === 'openai' ? [{
                        label: <Text dimColor={true}>-&gt; Edit API Key / Base URL</Text>,
                        value: OPENAI_EDIT_CONFIG_OPTION
                      }] : []), ...externalModelListState.options.map(model => ({
                        label: <Text>{model}</Text>,
                        value: model
                      }))]} defaultValue={selectedExternalModel || undefined} onChange={onExternalModelSelected} />
                      </Box> : null}
                    {selectedExternalModel ? <Text dimColor={true}>{uiText('Current model: ', '当前模型：')}"{selectedExternalModel}"</Text> : null}
                    {externalModelListState.message && externalModelListState.status === 'loaded' ? <Text dimColor={true}>{externalModelListState.message}</Text> : null}
                    <Text bold={true}>{uiText('Connection check: ', '连接检查：')}{selectedProviderName}</Text>
                    {externalCheckState.status === 'checking' ? <Box><Spinner /><Text>{externalSetupOption === 'codex' ? uiText('Checking ChatGPT login status and selected model...', '正在检查 ChatGPT 登录状态与所选模型...') : uiText('Checking credentials, endpoint, and selected model warm-up...', '正在检查凭据、接口地址以及所选模型预热...')}</Text></Box> : null}
                    {externalCheckState.status === 'success' ? <Text color="success">{uiText('Connection verified.', '连接验证成功。')}{externalCheckState.model ? uiText(' Model: "', ' 模型： "') + externalCheckState.model + '"' + uiText('.', '。') : ''}</Text> : null}
                    {externalCheckState.status === 'success' ? <Text dimColor={true}>{uiText('Verification succeeded. Select "Enter command prompt" in the list to continue.', '验证通过后，请在列表里选择“进入命令界面”继续。')}</Text> : null}
                    {externalCheckState.status === 'checking' && selectedExternalModel ? <Text dimColor={true}>{uiText('If this check hangs on a compatible provider, you can select "Enter command prompt anyway (skip check)".', '如果兼容接口的检查卡住了，可以选择“仍然进入命令界面（跳过检查）”。')}</Text> : null}
                    {externalCheckState.status === 'error' ? <Text color="error">{uiText('Check failed: ', '检查失败：')}{externalCheckState.message}</Text> : null}
                    {externalCheckState.message && externalCheckState.status === 'success' ? <Text dimColor={true}>{externalCheckState.message}</Text> : null}
                  </> : null}
              </Box> : null}
            <Box flexDirection="column" marginTop={1}>
              <Text bold={true}>{uiText('Documentation:', '文档：')}</Text>
              <Text>- OpenAI API <Link url="https://platform.openai.com/api-keys">https://platform.openai.com/api-keys</Link></Text>
              <Text>- Ollama <Link url="https://ollama.com">https://ollama.com</Link></Text>
              <Text>- Codex plugin <Link url="https://github.com/openai/codex-plugin-cc">https://github.com/openai/codex-plugin-cc</Link></Text>
              <Text>- Amazon Bedrock <Link url="https://code.claude.com/docs/en/amazon-bedrock">https://code.claude.com/docs/en/amazon-bedrock</Link></Text>
              <Text>- Microsoft Foundry <Link url="https://code.claude.com/docs/en/microsoft-foundry">https://code.claude.com/docs/en/microsoft-foundry</Link></Text>
              <Text>- Vertex AI <Link url="https://code.claude.com/docs/en/google-vertex-ai">https://code.claude.com/docs/en/google-vertex-ai</Link></Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor={true}>{uiText('Press ', '按 ')}<Text bold={true}>Esc</Text>{uiText(' to go back to login options.', ' 返回登录选项。')}</Text>
            </Box>
          </Box>
        </Box>;
    }
    case 'waiting_for_login':
      return <Box flexDirection="column" gap={1}>
          {forcedMethodMessage ? <Box><Text dimColor={true}>{forcedMethodMessage}</Text></Box> : null}
          {!showPastePrompt ? <Box><Spinner /><Text>{uiText('Opening browser to sign in...', '正在打开浏览器进行登录...')}</Text></Box> : null}
          {showPastePrompt ? <Box><Text>{getPasteHereMessage()}</Text><TextInput value={pastedCode} onChange={setPastedCode} onSubmit={value => handleSubmitCode(value, oauthStatus.url)} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} columns={textInputColumns} mask="*" /></Box> : null}
        </Box>;
    case 'creating_api_key':
      return <Box flexDirection="column" gap={1}>
          <Box><Spinner /><Text>{uiText('Creating API key for Claude Code...', '正在为 Claude Code 创建 API key...')}</Text></Box>
        </Box>;
    case 'about_to_retry':
      return <Box flexDirection="column" gap={1}>
          <Text color="permission">{uiText('Retrying...', '正在重试...')}</Text>
        </Box>;
    case 'success': {
      const accountInfo = getOauthAccountInfo();
      return <Box flexDirection="column">
          {mode === 'setup-token' && oauthStatus.token ? null : <>
              {accountInfo?.emailAddress ? <Text dimColor={true}>Logged in as <Text>{accountInfo.emailAddress}</Text></Text> : null}
              <Text color="success">{uiText('Login successful. Press ', '登录成功。按 ')}<Text bold={true}>Enter</Text>{uiText(' to continue.', ' 继续。')}</Text>
            </>}
        </Box>;
    }
    case 'error':
      return <Box flexDirection="column" gap={1}>
          <Text color="error">{uiText('OAuth error: ', 'OAuth 错误：')}{oauthStatus.message}</Text>
          {oauthStatus.toRetry ? <Box marginTop={1}>
              <Text color="permission">Press <Text bold={true}>Enter</Text> to retry.</Text>
            </Box> : null}
        </Box>;
    default:
      return null;
  }
}
