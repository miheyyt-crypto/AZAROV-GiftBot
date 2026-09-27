import { readDevRoleFromSearch } from "../dev-role.js";
import type { WelvuraState } from "./types.js";

export type WelvuraPreviewMode = "available" | "pending" | "rejected" | "approved";

export type WelvuraPreviewEnv = {
  nodeEnv: string;
  allowDevAuth: boolean;
};

const PREVIEW_MODES = new Set<WelvuraPreviewMode>([
  "available",
  "pending",
  "rejected",
  "approved",
]);

/** Presentation-only overlay. Impossible when NODE_ENV/MODE is production or ALLOW_DEV_AUTH is off. */
export function isWelvuraPreviewEnabled(env: WelvuraPreviewEnv): boolean {
  return env.nodeEnv !== "production" && env.allowDevAuth === true;
}

export function defaultWelvuraPreviewEnv(): WelvuraPreviewEnv {
  return {
    nodeEnv: process.env.NODE_ENV ?? "production",
    allowDevAuth: process.env.ALLOW_DEV_AUTH === "true",
  };
}

export function readWelvuraPreview(
  search: string,
  env: WelvuraPreviewEnv = defaultWelvuraPreviewEnv(),
): WelvuraPreviewMode | undefined {
  if (!isWelvuraPreviewEnabled(env)) {
    return undefined;
  }
  if (!readDevRoleFromSearch(search)) {
    return undefined;
  }
  const raw = new URLSearchParams(search).get("welvuraPreview");
  if (raw && PREVIEW_MODES.has(raw as WelvuraPreviewMode)) {
    return raw as WelvuraPreviewMode;
  }
  return undefined;
}

/** Overlay catalog/server rows with a visual account/stage state. Does not mutate the input. */
export function applyWelvuraPreview(
  state: WelvuraState,
  mode: WelvuraPreviewMode,
): WelvuraState {
  const stages = state.stages.map((stage, index) => {
    if (mode === "approved") {
      return {
        ...stage,
        state: index === 0 ? ("available" as const) : ("locked" as const),
        rejectionReason: null,
      };
    }
    return {
      ...stage,
      state: "locked" as const,
      rejectionReason: null,
    };
  });

  if (mode === "available") {
    return {
      ...state,
      account: {
        ...state.account,
        state: "not_submitted",
        welvuraId: null,
        rejectionReason: null,
      },
      progress: { ...state.progress, completedStages: 0 },
      stages,
    };
  }
  if (mode === "pending") {
    return {
      ...state,
      account: {
        ...state.account,
        state: "pending",
        welvuraId: state.account.welvuraId,
        rejectionReason: null,
      },
      progress: { ...state.progress, completedStages: 0 },
      stages,
    };
  }
  if (mode === "rejected") {
    return {
      ...state,
      account: {
        ...state.account,
        state: "rejected",
        welvuraId: state.account.welvuraId,
        rejectionReason: state.account.rejectionReason,
      },
      progress: { ...state.progress, completedStages: 0 },
      stages,
    };
  }
  return {
    ...state,
    account: {
      ...state.account,
      state: "approved",
      welvuraId: state.account.welvuraId,
      rejectionReason: null,
    },
    progress: { ...state.progress, completedStages: 0 },
    stages,
  };
}
