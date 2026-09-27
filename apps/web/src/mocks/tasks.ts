export type MockTaskTab = "all" | "kick" | "tg" | "social" | "partners";

export type MockTask = {
  id: string;
  title: string;
  tab: Exclude<MockTaskTab, "all">;
  rewardLabel: string;
};

export const MOCK_TASKS: MockTask[] = [
  { id: "t1", title: "Добавь azarov7777 к нику на Kick", tab: "kick", rewardLabel: "Награда" },
  { id: "t2", title: "Привяжи Kick", tab: "kick", rewardLabel: "Награда" },
  { id: "t3", title: "Зафолловься на канал Kick", tab: "kick", rewardLabel: "Награда" },
  { id: "t4", title: "Подпишись на @azarov222", tab: "tg", rewardLabel: "Награда" },
  { id: "t5", title: "Запусти нашего бота", tab: "tg", rewardLabel: "Награда" },
  { id: "t6", title: "Пригласи 3 друга", tab: "social", rewardLabel: "Награда" },
];

export const MOCK_WELVURA_STEPS = [
  "Открой Welvura",
  "Привяжи аккаунт",
  "Подтверди ник",
  "Забери награду",
];
