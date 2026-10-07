import { pgEnum } from "drizzle-orm/pg-core";

export const userStatus = pgEnum("user_status", [
  "active",
  "blocked",
  "deleted",
]);

export const walletStatus = pgEnum("wallet_status", ["active", "frozen"]);

export const walletTransactionType = pgEnum("wallet_transaction_type", [
  "deposit",
  "reward",
  "referral_reward",
  "purchase",
  "bet",
  "prize",
  "refund",
  "admin_adjustment",
  "reversal",
  "promo_code_reward",
  "shop_purchase",
  "shop_refund",
  "free_case_reward",
  "paid_case_purchase",
  "paid_case_reward",
  "referral_inviter_reward",
  "referral_referred_reward",
  "referral_manual_credit",
  "referral_case_reward",
  "task_reward",
  "welvura_deposit_reward",
  "level_reward",
  "stream_streak_reward",
  "mines_bet",
  "mines_win",
  "dice_bet",
  "dice_win",
  "rolls_bet",
  "rolls_win",
  "giveaway_reward",
  "achievement_reward",
  "referral_contest_reward",
  "stream_donation",
]);

export const promoCodeStatus = pgEnum("promo_code_status", [
  "active",
  "inactive",
]);

export const gramWithdrawalStatus = pgEnum("gram_withdrawal_status", [
  "pending",
  "processing",
  "fulfilled",
  "rejected",
]);

export const cashItemWithdrawalStatus = pgEnum("cash_item_withdrawal_status", [
  "pending",
  "processing",
  "fulfilled",
  "rejected",
]);

export const actorType = pgEnum("actor_type", [
  "system",
  "user",
  "admin",
  "worker",
]);

export const referralStatus = pgEnum("referral_status", [
  "attributed",
  "pending_activation",
  "activated",
  "rejected",
  "reversed",
]);

export const referralEventType = pgEnum("referral_event_type", [
  "attributed",
  "activated",
  "reward_granted",
  "rejected",
  "reversed",
]);

export const catalogStatus = pgEnum("catalog_status", [
  "draft",
  "active",
  "disabled",
]);

export const taskCompletionStatus = pgEnum("task_completion_status", [
  "started",
  "completed",
  "rejected",
  "rewarded",
]);

export const stockMode = pgEnum("stock_mode", ["unlimited", "tracked"]);

export const purchaseStatus = pgEnum("purchase_status", [
  "created",
  "paid",
  "delivered",
  "failed",
  "refunded",
]);

export const openingStatus = pgEnum("opening_status", [
  "created",
  "settled",
  "failed",
  "voided",
]);

export const gameSettlementMode = pgEnum("game_settlement_mode", [
  "instant",
  "async",
]);

export const gameRoundStatus = pgEnum("game_round_status", [
  "created",
  "bet_placed",
  "pending",
  "settled",
  "voided",
  "failed",
]);

export const giveawayStatus = pgEnum("giveaway_status", [
  "draft",
  "open",
  "closed",
  "settled",
  "cancelled",
]);

export const giveawayEntryStatus = pgEnum("giveaway_entry_status", [
  "active",
  "rejected",
]);

export const inboundProvider = pgEnum("inbound_provider", ["telegram", "kick"]);

export const inboundProcessingStatus = pgEnum("inbound_processing_status", [
  "queued",
  "processed",
  "failed",
  "dead",
]);

export const jobOwner = pgEnum("job_owner", ["bot", "worker"]);

export const jobStatus = pgEnum("job_status", [
  "pending",
  "processing",
  "completed",
  "failed",
  "dead",
]);

export const notificationChannel = pgEnum("notification_channel", [
  "telegram",
  "inbox",
]);

export const notificationStatus = pgEnum("notification_status", [
  "pending",
  "sent",
  "failed",
]);

export const kickAccountStatus = pgEnum("kick_account_status", [
  "active",
  "needs_reauth",
  "revoked",
]);

export const rngPurpose = pgEnum("rng_purpose", ["game", "case", "giveaway"]);

export const welvuraLinkStatus = pgEnum("welvura_link_status", [
  "pending",
  "approved",
  "rejected",
]);

export const inventoryItemType = pgEnum("inventory_item_type", [
  "cash_rub",
  "streak_freeze",
  "external_prize",
]);

export const inventoryItemStatus = pgEnum("inventory_item_status", [
  "available",
  "reserved",
  "consumed",
]);

export const telegramBroadcastStatus = pgEnum("telegram_broadcast_status", [
  "queued",
  "sending",
  "completed",
  "completed_with_errors",
  "failed",
]);

export const telegramBroadcastRecipientStatus = pgEnum(
  "telegram_broadcast_recipient_status",
  ["pending", "sent", "failed"],
);

export const referralContestStatus = pgEnum("referral_contest_status", [
  "scheduled",
  "active",
  "finalized",
]);

export const streamDonationStatus = pgEnum("stream_donation_status", [
  "queued",
  "playing",
  "finished",
]);

export const streamDonationTtsStatus = pgEnum("stream_donation_tts_status", [
  "pending",
  "ready",
  "failed",
  "skipped",
]);

