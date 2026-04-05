import type { Command } from '../../commands.js'
import { hasAnthropicApiKeyAuth } from '../../utils/auth.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getExternalModelProvider } from '../../utils/model/externalProvider.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'login',
    description: getExternalModelProvider()
      ? 'Open login and provider configuration'
      : hasAnthropicApiKeyAuth()
        ? 'Switch Anthropic accounts'
        : 'Sign in with your Anthropic account',
    isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGIN_COMMAND),
    // Always open the interactive login flow so users can switch providers,
    // edit endpoint/key/model, and retry from the same UI.
    load: () => import('./login.js'),
  }) satisfies Command
