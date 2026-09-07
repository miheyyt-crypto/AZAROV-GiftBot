/** Server-authoritative achievement catalog (rewards/targets never from client). */
export const ACHIEVEMENTS = [
  {
    id: 'stream-hours',
    title: '100 часов просмотра',
    reward: 5000,
    target: 100,
    icon: 'clock',
  },
  {
    id: 'chat-messages',
    title: '1 000 сообщений',
    reward: 3000,
    target: 1000,
    icon: 'message',
  },
  {
    id: 'friends',
    title: '10 друзей',
    reward: 4000,
    target: 10,
    icon: 'users',
  },
  {
    id: 'coins-earned',
    title: '100 000 монет заработано',
    reward: 5000,
    target: 100_000,
    icon: 'coins',
  },
]

const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((item) => [item.id, item]))

export function findAchievement(achievementId) {
  return ACHIEVEMENT_BY_ID.get(String(achievementId || '').trim()) || null
}

export function achievementClaimEventId(userId, achievementId) {
  return `achievement:claim:${userId}:${achievementId}`
}
