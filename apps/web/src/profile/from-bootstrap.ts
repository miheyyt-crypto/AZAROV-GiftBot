import type { BootstrapPayload } from "../types.js";
import { EMPTY_PROFILE_SUMMARY, type ProfileSummary } from "./types.js";

/** Identity + AZC from bootstrap so Home does not wait on GET /profile. */
export function profileSummaryFromBootstrap(
  bootstrap: BootstrapPayload,
): ProfileSummary {
  return {
    ...EMPTY_PROFILE_SUMMARY,
    user: {
      ...EMPTY_PROFILE_SUMMARY.user,
      id: bootstrap.user.publicId,
      displayName: bootstrap.user.displayName ?? null,
      avatarUrl: bootstrap.user.avatarUrl ?? null,
    },
    balances: {
      ...EMPTY_PROFILE_SUMMARY.balances,
      azc: bootstrap.wallet.balanceMinor,
    },
    integrations: {
      ...EMPTY_PROFILE_SUMMARY.integrations,
      kick: {
        ...EMPTY_PROFILE_SUMMARY.integrations.kick,
        linked: bootstrap.flags.kickLinked,
      },
    },
  };
}
