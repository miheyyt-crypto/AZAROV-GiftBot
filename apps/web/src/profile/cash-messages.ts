export function friendlyCashError(code?: string): string {
  switch (code) {
    case "CASH_ITEM_NOT_FOUND":
      return "Приз не найден";
    case "CASH_ITEM_NOT_AVAILABLE":
      return "Приз недоступен для получения";
    case "CASH_ITEM_NOT_OWNED":
      return "Приз недоступен";
    case "CASH_ITEM_INVALID_TYPE":
      return "Этот предмет нельзя получить как ₽";
    case "CASH_WITHDRAWAL_ALREADY_ACTIVE":
      return "Заявка на получение уже создана";
    case "CASH_WITHDRAWAL_INVALID_WELVURA_ID":
      return "Некорректный Welvura ID";
    default:
      return "Не удалось создать заявку";
  }
}

export function friendlyCashStatus(
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

export function friendlyCashItemStatus(
  status: "available" | "reserved" | "consumed",
): string {
  switch (status) {
    case "available":
      return "Доступно";
    case "reserved":
      return "На выводе";
    case "consumed":
      return "Получено";
  }
}

export function friendlyCashSource(source: string): string {
  switch (source) {
    case "free_case":
      return "Бесплатный кейс";
    case "poor_case":
      return "Бедный кейс";
    case "medium_case":
      return "Средний кейс";
    case "blatnoy_case":
      return "Блатной кейс";
    case "referral_case":
      return "Реферальный кейс";
    default:
      return source || "₽ приз";
  }
}
