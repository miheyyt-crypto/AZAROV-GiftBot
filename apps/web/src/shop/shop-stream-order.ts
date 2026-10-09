import type { ShopOrderStatus } from "./shop-messages.js";

export type StreamGifPlaybackStatus =
  | "pending_moderation"
  | "queued"
  | "playing"
  | "shown"
  | "rejected";

export type StreamOrderBinding = {
  orderId: string;
  submissionId: string;
};

export type StreamGifModerationSnapshot = {
  id: string;
  orderId: string | null;
  donationId: string | null;
  status: StreamGifPlaybackStatus;
  playbackReady?: boolean;
  displayName?: string | null;
  contentType?: string | null;
};

export function streamOrderBinding(item: {
  id: string;
  productCode: string;
  submittedPayload: Record<string, string>;
}): StreamOrderBinding | null {
  if (item.productCode !== "gif-stream") {
    return null;
  }
  const submissionId = item.submittedPayload.gifUploadId?.trim();
  if (!submissionId) {
    return null;
  }
  return { orderId: item.id, submissionId };
}

export function canApproveStreamOrder(input: {
  orderStatus: ShopOrderStatus;
  binding: StreamOrderBinding | null;
  submission?: StreamGifModerationSnapshot | null;
}): boolean {
  if (!input.binding || input.orderStatus === "rejected") {
    return false;
  }
  const submission = input.submission;
  if (!submission) {
    return true;
  }
  if (submission.id !== input.binding.submissionId) {
    return false;
  }
  if (submission.donationId) {
    return false;
  }
  if (submission.status !== "pending_moderation") {
    return false;
  }
  if (submission.playbackReady === false) {
    return false;
  }
  return true;
}

export function streamGifPlaybackLabel(
  status: StreamGifPlaybackStatus | undefined,
): string | undefined {
  switch (status) {
    case "pending_moderation":
      return "На модерации";
    case "queued":
      return "В очереди";
    case "playing":
      return "Показывается";
    case "shown":
      return "Уже показано";
    case "rejected":
      return "Отклонено";
    default:
      return undefined;
  }
}

export function streamGifApproveSuccessNote(input: {
  enqueued: boolean;
  replayed: boolean;
  status: StreamGifPlaybackStatus;
  orderId: string | null;
}): string {
  const suffix = input.orderId ? ` · заказ ${input.orderId.slice(0, 8)}` : "";
  if (input.enqueued) {
    return `В очереди${suffix}`;
  }
  if (input.status === "playing") {
    return `Показывается${suffix}`;
  }
  if (input.status === "shown") {
    return `Уже показано${suffix}`;
  }
  return `В очереди${suffix}`;
}
