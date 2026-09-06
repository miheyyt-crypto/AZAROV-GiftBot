import iconInviteFriends from '@/assets/tasks/icon-invite-friends.svg'
import iconKickConnect from '@/assets/tasks/icon-kick-connect.svg'
import iconKickFollow from '@/assets/tasks/icon-kick-follow.svg'
import iconKickNickname from '@/assets/tasks/icon-kick-nickname.svg'
import iconTelegramSubscribe from '@/assets/tasks/icon-telegram-subscribe.svg'
import { REFERRAL_ACTIVATION_REWARD } from '@/lib/constants'
import type { Task } from '@/types'

export const tasks: Task[] = [
  {
    id: 'kick-nickname',
    title: 'Добавь приписку к нику на KICK',
    description: 'Добавь специальную приписку к своему нику на Kick.',
    category: 'kick',
    reward: 400,
    type: 'kick_nickname',
    status: 'available',
    icon: iconKickNickname,
  },
  {
    id: 'kick-connect',
    title: 'Привяжи Kick',
    description: 'Привяжи свой аккаунт Kick к AZAROV - GiftBot.',
    category: 'kick',
    reward: 400,
    type: 'kick_connect',
    status: 'available',
    icon: iconKickConnect,
  },
  {
    id: 'kick-follow',
    title: 'Зафолловься на канал Kick',
    description: 'Подпишись на канал на Kick.',
    category: 'kick',
    reward: 500,
    type: 'kick_follow',
    status: 'available',
    icon: iconKickFollow,
  },
  {
    id: 'telegram-subscribe',
    title: 'Подпишись на канал @azarov222',
    description: 'Подпишись на Telegram-канал @azarov222.',
    category: 'telegram',
    reward: 500,
    type: 'telegram_subscribe',
    status: 'available',
    icon: iconTelegramSubscribe,
  },
  {
    id: 'referral-invite',
    title: 'Пригласи 3 друзей',
    description:
      `Друг считается после первой успешной регистрации по твоей ссылке. За это вы оба получаете по ${REFERRAL_ACTIVATION_REWARD} монет — один раз.`,
    category: 'telegram',
    reward: 2000,
    type: 'referral',
    status: 'in_progress',
    icon: iconInviteFriends,
    progress: {
      current: 0,
      required: 3,
      label: 'Прогресс',
    },
  },
]

export function getTasks(): Task[] {
  return tasks.map((task) => ({ ...task, progress: task.progress ? { ...task.progress } : undefined }))
}
