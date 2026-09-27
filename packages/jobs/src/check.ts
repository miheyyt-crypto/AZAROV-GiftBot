import { reconcileSweepIdempotencyKey } from "./reconcile-sweep.js";
import { JOB_TYPES, ownerForInbound, ownerForJobType } from "./types.js";

process.stdout.write(
  `${JSON.stringify({
    level: "info",
    msg: "jobs module ok",
    telegramOwner: ownerForInbound("telegram"),
    kickOwner: ownerForInbound("kick"),
    telegramJob: JOB_TYPES.telegramProcessInbound,
    telegramSendOwner: ownerForJobType(JOB_TYPES.telegramSendMessage),
    telegramSendPhotoOwner: ownerForJobType(JOB_TYPES.telegramSendPhoto),
    telegramAnswerCallbackOwner: ownerForJobType(JOB_TYPES.telegramAnswerCallback),
    telegramEditMessageOwner: ownerForJobType(JOB_TYPES.telegramEditMessage),
    walletApplyOwner: ownerForJobType(JOB_TYPES.walletApply),
    walletReconcileOwner: ownerForJobType(JOB_TYPES.walletReconcile),
    kickRefreshOwner: ownerForJobType(JOB_TYPES.kickRefreshToken),
    kickFinalizeOwner: ownerForJobType(JOB_TYPES.kickFinalizeStream),
    gameSettleOwner: ownerForJobType(JOB_TYPES.gameSettleAsync),
    contestFinalizeOwner: ownerForJobType(JOB_TYPES.referralContestFinalize),
    reconcileSweepKey: reconcileSweepIdempotencyKey(new Date(0)),
  })}\n`,
);
