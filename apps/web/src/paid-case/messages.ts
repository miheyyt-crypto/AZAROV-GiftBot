export function friendlyPaidCaseError(code?: string): string {
  switch (code) {
    case "CASE_INSUFFICIENT_BALANCE":
      return "Недостаточно монет для открытия кейса";
    case "CASE_NOT_FOUND":
      return "Кейс не найден";
    case "PAID_CASE_OPEN_FAILED":
      return "Не удалось открыть кейс";
    default:
      return "Не удалось открыть кейс. Попробуйте ещё раз";
  }
}

export function paidCaseResultCopy(rewardType: "azc" | "cash_rub"): string {
  if (rewardType === "azc") {
    return "Начислено на баланс";
  }
  return "Приз добавлен в инвентарь";
}
