export type MockDrop = {
  id: string;
  username: string;
  source: string;
  amountAzc: number;
  chancePercent: number;
  timeAgo: string;
};

export const MOCK_RECENT_DROPS: MockDrop[] = [
  {
    id: "d1",
    username: "Bushman",
    source: "Выиграл в Roll",
    amountAzc: 200,
    chancePercent: 50,
    timeAgo: "13 ч назад",
  },
  {
    id: "d2",
    username: "kira",
    source: "Кейс Нищий",
    amountAzc: 1200,
    chancePercent: 8,
    timeAgo: "2 ч назад",
  },
  {
    id: "d3",
    username: "neon",
    source: "Выиграл в Dice",
    amountAzc: 80,
    chancePercent: 40,
    timeAgo: "27 мин назад",
  },
  {
    id: "d4",
    username: "oak",
    source: "Выиграл в Mines",
    amountAzc: 450,
    chancePercent: 12,
    timeAgo: "1 ч назад",
  },
];

export type MockGiveaway = {
  id: string;
  title: string;
  status: "active" | "completed";
  prize: string;
  ends: string;
};

export const MOCK_GIVEAWAYS: MockGiveaway[] = [
  {
    id: "g1",
    title: "Telegram Premium",
    status: "active",
    prize: "1 месяц",
    ends: "через 2 дня",
  },
  {
    id: "g2",
    title: "Кейс Средний",
    status: "active",
    prize: "1 открытие",
    ends: "через 6 часов",
  },
  {
    id: "g3",
    title: "AZC pack",
    status: "completed",
    prize: "2 000 AZC",
    ends: "вчера",
  },
];

export const MOCK_FREE_CASE_ITEMS = [
  "Streak Freeze",
  "200 AZC",
  "Welvura 200 ₽",
  "Dice ticket",
];

export const MOCK_STREAK = {
  streams: 4,
  nextBonus: 500,
  current: 4,
  target: 5,
  hint: "Напиши 10 сообщений в чат, чтобы стрик засчитался",
};
