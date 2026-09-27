export function friendlyReferralCaseError(code?: string): string {
  switch (code) {
    case "REFERRAL_CASE_NOT_AVAILABLE":
      return "Нет доступных реферальных кейсов";
    case "REFERRAL_CASE_OPEN_FAILED":
      return "Не удалось открыть кейс";
    default:
      return "Не удалось открыть кейс. Попробуйте ещё раз";
  }
}

export function referralCaseResultCopy(rewardType: "azc" | "cash_rub"): string {
  if (rewardType === "azc") {
    return "Начислено на баланс";
  }
  return "Приз добавлен в инвентарь";
}
