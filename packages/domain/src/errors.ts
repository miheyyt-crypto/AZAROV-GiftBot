export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export class InsufficientFundsError extends DomainError {
  constructor() {
    super("INSUFFICIENT_FUNDS", "wallet debit would make balance negative");
  }
}

export class WalletFrozenError extends DomainError {
  constructor() {
    super("WALLET_FROZEN", "wallet is frozen");
  }
}

export class WalletNotFoundError extends DomainError {
  constructor() {
    super("WALLET_NOT_FOUND", "wallet does not exist");
  }
}

export class InvalidAmountError extends DomainError {
  constructor(message: string) {
    super("INVALID_AMOUNT", message);
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(machine: string, from: string, to: string) {
    super(
      "INVALID_TRANSITION",
      `${machine} cannot move from ${from} to ${to}`,
    );
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, code = "CONFLICT") {
    super(code, message);
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string, code = "NOT_FOUND") {
    super(code, message);
  }
}

export class PromoInvalidCodeError extends DomainError {
  constructor() {
    super("PROMO_INVALID_CODE", "promo code is invalid");
  }
}

export class PromoNotFoundError extends NotFoundError {
  constructor() {
    super("promo code not found", "PROMO_NOT_FOUND");
  }
}

export class PromoInactiveError extends ConflictError {
  constructor() {
    super("promo code is inactive", "PROMO_INACTIVE");
  }
}

export class PromoLimitReachedError extends ConflictError {
  constructor() {
    super("promo activation limit reached", "PROMO_LIMIT_REACHED");
  }
}

export class PromoAlreadyRedeemedError extends ConflictError {
  constructor() {
    super("promo code already redeemed", "PROMO_ALREADY_REDEEMED");
  }
}

export class PromoCodeExistsError extends ConflictError {
  constructor() {
    super("promo code already exists", "PROMO_CODE_EXISTS");
  }
}

export class GramBalanceNotFoundError extends NotFoundError {
  constructor() {
    super("gram balance does not exist", "GRAM_BALANCE_NOT_FOUND");
  }
}

export class GramWithdrawalNotFoundError extends NotFoundError {
  constructor() {
    super("gram withdrawal not found", "GRAM_WITHDRAWAL_NOT_FOUND");
  }
}

export class GramWithdrawalMinimumError extends DomainError {
  constructor() {
    super(
      "GRAM_WITHDRAWAL_MINIMUM_NOT_REACHED",
      "available Gram is below the withdrawal minimum",
    );
  }
}

export class GramWithdrawalAlreadyActiveError extends ConflictError {
  constructor() {
    super(
      "an active gram withdrawal already exists",
      "GRAM_WITHDRAWAL_ALREADY_ACTIVE",
    );
  }
}

export class GramInvalidTelegramUsernameError extends DomainError {
  constructor() {
    super(
      "GRAM_INVALID_TELEGRAM_USERNAME",
      "telegram username is invalid",
    );
  }
}

export class GramRejectionReasonRequiredError extends DomainError {
  constructor() {
    super("BAD_REQUEST", "rejection reason is required");
  }
}

export class ShopProductNotFoundError extends NotFoundError {
  constructor() {
    super("shop product not found", "SHOP_PRODUCT_NOT_FOUND");
  }
}

export class ShopProductUnavailableError extends ConflictError {
  constructor() {
    super("shop product is unavailable", "SHOP_PRODUCT_UNAVAILABLE");
  }
}

export class ShopInsufficientBalanceError extends ConflictError {
  constructor() {
    super("insufficient AZC balance", "SHOP_INSUFFICIENT_BALANCE");
  }
}

export class ShopInvalidWelvuraIdError extends DomainError {
  constructor() {
    super("SHOP_INVALID_WELVURA_ID", "welvura id is invalid");
  }
}

export class ShopInvalidTelegramUsernameError extends DomainError {
  constructor() {
    super("SHOP_INVALID_TELEGRAM_USERNAME", "telegram username is invalid");
  }
}

export class ShopInvalidKickUsernameError extends DomainError {
  constructor() {
    super("SHOP_INVALID_KICK_USERNAME", "kick username is invalid");
  }
}

export class ShopInvalidDonationNicknameError extends DomainError {
  constructor() {
    super("SHOP_INVALID_DONATION_NICKNAME", "donation nickname is invalid");
  }
}

export class ShopInvalidDonationTextError extends DomainError {
  constructor() {
    super("SHOP_INVALID_DONATION_TEXT", "donation text is invalid");
  }
}

export class ShopInvalidMediaUrlError extends DomainError {
  constructor() {
    super("SHOP_INVALID_MEDIA_URL", "only YouTube or SoundCloud URLs are allowed");
  }
}

export class ShopInvalidSlotNameError extends DomainError {
  constructor() {
    super("SHOP_INVALID_SLOT_NAME", "slot name is invalid");
  }
}

export class ShopRejectionReasonRequiredError extends DomainError {
  constructor() {
    super("BAD_REQUEST", "rejection reason is required");
  }
}

export class ShopOrderNotFoundError extends NotFoundError {
  constructor() {
    super("shop order not found", "SHOP_ORDER_NOT_FOUND");
  }
}

export class CashItemNotFoundError extends NotFoundError {
  constructor() {
    super("cash inventory item not found", "CASH_ITEM_NOT_FOUND");
  }
}

export class CashItemNotOwnedError extends ConflictError {
  constructor() {
    super("cash inventory item is not owned by user", "CASH_ITEM_NOT_OWNED");
  }
}

export class CashItemNotAvailableError extends ConflictError {
  constructor() {
    super("cash inventory item is not available", "CASH_ITEM_NOT_AVAILABLE");
  }
}

export class CashItemInvalidTypeError extends DomainError {
  constructor() {
    super("CASH_ITEM_INVALID_TYPE", "inventory item is not a cash_rub prize");
  }
}

export class CashWithdrawalAlreadyActiveError extends ConflictError {
  constructor() {
    super(
      "an active cash withdrawal already exists for this item",
      "CASH_WITHDRAWAL_ALREADY_ACTIVE",
    );
  }
}

export class CashWithdrawalInvalidWelvuraIdError extends DomainError {
  constructor() {
    super("CASH_WITHDRAWAL_INVALID_WELVURA_ID", "welvura id is invalid");
  }
}

export class CashWithdrawalNotFoundError extends NotFoundError {
  constructor() {
    super("cash withdrawal not found", "CASH_WITHDRAWAL_NOT_FOUND");
  }
}

export class CashRejectionReasonRequiredError extends DomainError {
  constructor() {
    super("BAD_REQUEST", "rejection reason is required");
  }
}

export class FreeCaseCooldownActiveError extends ConflictError {
  readonly nextAvailableAt: string;

  constructor(nextAvailableAt: Date) {
    super("free case cooldown is active", "FREE_CASE_COOLDOWN_ACTIVE");
    this.nextAvailableAt = nextAvailableAt.toISOString();
  }
}

export class FreeCaseOpenFailedError extends DomainError {
  constructor() {
    super("FREE_CASE_OPEN_FAILED", "free case open failed");
  }
}

export class FreeCaseNotAvailableError extends ConflictError {
  constructor() {
    super("free case is not available", "FREE_CASE_NOT_AVAILABLE");
  }
}

export class CaseInsufficientBalanceError extends ConflictError {
  constructor() {
    super("insufficient AZC for case open", "CASE_INSUFFICIENT_BALANCE");
  }
}

export class CaseNotFoundError extends NotFoundError {
  constructor() {
    super("paid case not found", "CASE_NOT_FOUND");
  }
}

export class PaidCaseOpenFailedError extends DomainError {
  constructor() {
    super("PAID_CASE_OPEN_FAILED", "paid case open failed");
  }
}

export class ReferralCaseNotAvailableError extends ConflictError {
  constructor() {
    super("no referral case entitlement available", "REFERRAL_CASE_NOT_AVAILABLE");
  }
}

export class ReferralCaseOpenFailedError extends DomainError {
  constructor() {
    super("REFERRAL_CASE_OPEN_FAILED", "referral case open failed");
  }
}

export class TaskNotFoundError extends NotFoundError {
  constructor() {
    super("task not found", "TASK_NOT_FOUND");
  }
}

export class TaskAlreadyCompletedError extends ConflictError {
  constructor() {
    super("task already completed", "TASK_ALREADY_COMPLETED");
  }
}

export class TaskRequirementNotMetError extends ConflictError {
  constructor(message = "task requirement not met") {
    super(message, "TASK_REQUIREMENT_NOT_MET");
  }
}

export class TaskVerificationUnavailableError extends ConflictError {
  constructor(message = "task verification temporarily unavailable") {
    super(message, "TASK_VERIFICATION_UNAVAILABLE");
  }
}

export class WelvuraAccountNotApprovedError extends ConflictError {
  constructor() {
    super("welvura account is not approved", "WELVURA_ACCOUNT_NOT_APPROVED");
  }
}

export class WelvuraSubmissionPendingError extends ConflictError {
  constructor() {
    super("a submission is already pending", "WELVURA_SUBMISSION_PENDING");
  }
}

export class WelvuraStageLockedError extends ConflictError {
  constructor() {
    super("welvura stage is locked", "WELVURA_STAGE_LOCKED");
  }
}

export class WelvuraStageAlreadyCompletedError extends ConflictError {
  constructor() {
    super("welvura stage already completed", "WELVURA_STAGE_ALREADY_COMPLETED");
  }
}

export class WelvuraInvalidIdError extends DomainError {
  constructor() {
    super("WELVURA_INVALID_ID", "welvura id is invalid");
  }
}

export class WelvuraInvalidFileError extends DomainError {
  constructor(message = "invalid screenshot file") {
    super("WELVURA_INVALID_FILE", message);
  }
}

export class WelvuraAlreadyModeratedError extends ConflictError {
  constructor() {
    super("submission already moderated", "WELVURA_ALREADY_MODERATED");
  }
}

export class WelvuraRejectionReasonRequiredError extends DomainError {
  constructor() {
    super("WELVURA_REJECTION_REASON_REQUIRED", "rejection reason is required");
  }
}

export class StreamDonationInvalidMessageError extends DomainError {
  constructor() {
    super("STREAM_DONATION_INVALID_MESSAGE", "donation message is invalid");
  }
}

export class StreamDonationInvalidRequestError extends DomainError {
  constructor() {
    super("STREAM_DONATION_INVALID_REQUEST", "donation request is invalid");
  }
}

export class OverlayBusyError extends ConflictError {
  constructor() {
    super("another overlay already holds the alert queue", "OVERLAY_BUSY");
  }
}

export class OverlayUnauthorizedError extends DomainError {
  constructor() {
    super("OVERLAY_UNAUTHORIZED", "overlay token is invalid");
  }
}

export class ShopInvalidGifUploadError extends DomainError {
  constructor() {
    super("SHOP_INVALID_GIF_UPLOAD", "GIF upload is invalid");
  }
}

export class StreamGifInvalidFileError extends DomainError {
  constructor(message = "GIF file is invalid") {
    super("STREAM_GIF_INVALID_FILE", message);
  }
}

export class StreamMediaTooLargeError extends DomainError {
  constructor() {
    super("STREAM_MEDIA_TOO_LARGE", "Файл больше 10 МБ");
  }
}

export class StreamMediaUnsupportedFormatError extends DomainError {
  constructor(
    message = "Формат не поддерживается. Нужны JPG, PNG, WebP, GIF, MP4, MOV или WebM",
  ) {
    super("STREAM_MEDIA_UNSUPPORTED_FORMAT", message);
  }
}

export class StreamMediaCorruptError extends DomainError {
  constructor(message = "Не удалось прочитать файл") {
    super("STREAM_MEDIA_CORRUPT", message);
  }
}

export class StreamMediaLimitError extends DomainError {
  constructor(message: string) {
    super("STREAM_MEDIA_LIMIT", message);
  }
}

export class StreamMediaCodecUnsupportedError extends DomainError {
  constructor(message: string) {
    super("STREAM_MEDIA_CODEC_UNSUPPORTED", message);
  }
}

export class StreamMediaNotReadyError extends ConflictError {
  constructor() {
    super("media is still being prepared", "STREAM_MEDIA_NOT_READY");
  }
}

export class StreamGifUploadNotFoundError extends NotFoundError {
  constructor() {
    super("GIF upload not found", "STREAM_GIF_UPLOAD_NOT_FOUND");
  }
}

export class StreamGifNotFoundError extends NotFoundError {
  constructor() {
    super("GIF submission not found", "STREAM_GIF_NOT_FOUND");
  }
}

export class StreamGifAlreadyDecidedError extends ConflictError {
  constructor() {
    super("GIF submission already decided", "STREAM_GIF_ALREADY_DECIDED");
  }
}

export class StreamGifNotPlayingError extends ConflictError {
  constructor() {
    super("no GIF is currently on screen", "STREAM_GIF_NOT_PLAYING");
  }
}
