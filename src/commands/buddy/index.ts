import type { Command } from '../../commands.js'

const buddy = {
  type: 'local-jsx',
  name: 'buddy',
  description: 'Manage buddy pets (draw, select, and set Soul personality)',
  load: () => import('./buddy.js'),
} satisfies Command

export default buddy

