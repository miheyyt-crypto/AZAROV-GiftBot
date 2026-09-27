import { computeLevel } from "./level.js";
import { formatGramMinor } from "./gram.js";
import { createGramWithdrawal } from "./gram-withdrawal.js";
import { createShopOrder } from "./shop.js";
import { readProfileSummary } from "./profile-read.js";
import { redeemPromoCode } from "./promo.js";
import { parsePrizeDistribution } from "./referral-contest.js";
import { adjustWallet } from "./admin.js";
import { settleFromCatalog } from "./catalog.js";
import { payoutReferralReward } from "./economy.js";
import { applyKickInboundEvent } from "./kick.js";
import { assertTransition, referralTransitions } from "./states.js";
import { apply, reconcileAllWallets, reconcileWallet } from "./wallet.js";

assertTransition("referral", referralTransitions, "attributed", "activated");

process.stdout.write(
  `${JSON.stringify({
    level: "info",
    msg: "domain module ok",
    walletApply: typeof apply,
    reconcileWallet: typeof reconcileWallet,
    applyKickInboundEvent: typeof applyKickInboundEvent,
    settleFromCatalog: typeof settleFromCatalog,
    payoutReferralReward: typeof payoutReferralReward,
    adjustWallet: typeof adjustWallet,
    reconcileAllWallets: typeof reconcileAllWallets,
    computeLevel: typeof computeLevel,
    formatGramMinor: typeof formatGramMinor,
    createGramWithdrawal: typeof createGramWithdrawal,
    createShopOrder: typeof createShopOrder,
    readProfileSummary: typeof readProfileSummary,
    redeemPromoCode: typeof redeemPromoCode,
    parsePrizeDistribution: typeof parsePrizeDistribution,
  })}\n`,
);
