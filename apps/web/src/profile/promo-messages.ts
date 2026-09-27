export function friendlyPromoError(code?: string): string {
  switch (code) {
    case "PROMO_NOT_FOUND":
    case "PROMO_INVALID_CODE":
      return "Промокод не найден";
    case "PROMO_ALREADY_REDEEMED":
      return "Этот промокод уже использован";
    case "PROMO_LIMIT_REACHED":
      return "Лимит активаций закончился";
    case "PROMO_INACTIVE":
      return "Промокод больше не активен";
    default:
      return "Не удалось активировать промокод";
  }
}
