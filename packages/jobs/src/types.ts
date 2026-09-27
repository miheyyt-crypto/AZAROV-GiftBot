export const JOB_TYPES = {
  telegramProcessInbound: "telegram.process_inbound_event",
  telegramSendMessage: "telegram.send_message",
  telegramSendPhoto: "telegram.send_photo",
  telegramEditMessage: "telegram.edit_message",
  telegramAnswerCallback: "telegram.answer_callback",
  kickProcessInbound: "kick.process_inbound_event",
  kickRefreshToken: "kick.refresh_token",
  kickFinalizeStream: "kick.finalize_stream_session",
  walletReconcile: "wallet.reconcile",
  walletApply: "wallet.apply",
  gameSettleAsync: "game.settle_async",
  rollsLockRound: "rolls.lock_round",
  rollsFinishSpin: "rolls.finish_spin",
  giveawayDraw: "giveaway.draw",
  referralContestFinalize: "referral_contest.finalize",
} as const;

/** Higher numbers are claimed first. Broadcast traffic stays below default bot jobs. */
export const JOB_PRIORITY = {
  default: 0,
  broadcast: -10,
} as const;

export function ownerForJobType(type: string): "bot" | "worker" {
  if (type.startsWith("telegram.")) {
    return "bot";
  }
  return "worker";
}

export type InboundProvider = "telegram" | "kick";

export function jobTypeForInbound(provider: InboundProvider): string {
  return provider === "telegram"
    ? JOB_TYPES.telegramProcessInbound
    : JOB_TYPES.kickProcessInbound;
}

export function ownerForInbound(provider: InboundProvider): "bot" | "worker" {
  return provider === "telegram" ? "bot" : "worker";
}

export function inboundIdempotencyKey(
  provider: InboundProvider,
  externalEventId: string,
): string {
  return `${provider}:${externalEventId}`;
}
