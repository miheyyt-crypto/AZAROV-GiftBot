export function friendlyGramError(code?: string): string {
  switch (code) {
    case "GRAM_WITHDRAWAL_MINIMUM_NOT_REACHED":
      return "Недостаточно Gram для вывода";
    case "GRAM_WITHDRAWAL_ALREADY_ACTIVE":
      return "Заявка на вывод уже создана";
    case "GRAM_BALANCE_NOT_FOUND":
      return "Gram баланс не найден";
    case "GRAM_INVALID_TELEGRAM_USERNAME":
      return "Укажите корректный Telegram username";
    default:
      return "Не удалось создать заявку";
  }
}

export function friendlyGramStatus(
  status: "pending" | "processing" | "fulfilled" | "rejected",
): string {
  switch (status) {
    case "pending":
      return "Ожидает";
    case "processing":
      return "В обработке";
    case "fulfilled":
      return "Выполнено";
    case "rejected":
      return "Отклонено";
  }
}
