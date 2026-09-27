import { WELVURA_COOKIE_SRC } from "../assets/welvura-cookie.js";
import { navigate } from "../app/routes.js";
import { IconCoin } from "../assets/icons.js";
import { groupDigits } from "../lib/format.js";
import type { WelvuraState } from "../tasks/types.js";

export function CookieArt({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "welvura-cookie welvura-cookie--sm" : "welvura-cookie"}>
      <img className="welvura-cookie-img" src={WELVURA_COOKIE_SRC} alt="" draggable={false} />
    </span>
  );
}

export function WelvuraBanner({
  href = "#/tasks/welvura",
  state,
  onOpen,
}: {
  href?: string;
  state?: WelvuraState | null;
  onOpen?: () => void;
}) {
  const account = state?.account;
  let subtitle = "Привяжи аккаунт и выполняй";
  if (account?.state === "pending") {
    subtitle = "Заявка на проверке";
  } else if (account?.state === "rejected") {
    subtitle = account.rejectionReason
      ? `Заявка отклонена: ${account.rejectionReason}`
      : "Заявка отклонена · Отправить заново";
  } else if (account?.state === "approved" && state) {
    subtitle = `${state.progress.completedStages} из ${state.progress.totalStages} заданий выполнено`;
  }

  const firstReward = state?.stages?.find((stage) => stage.rewardAzc)?.rewardAzc;
  const rewardHint = firstReward ? groupDigits(firstReward) : null;

  return (
    <button
      type="button"
      className="welvura-banner"
      onClick={() => {
        if (onOpen) {
          onOpen();
          return;
        }
        navigate(href);
      }}
    >
      <div className="welvura-banner__copy">
        <span className="welvura-banner__title">Welvura</span>
        <span className="welvura-banner__sub">{subtitle}</span>
        <span className="welvura-banner__cta">Смотреть задания ›</span>
      </div>
      <div className="welvura-banner__art" aria-hidden="true">
        <CookieArt />
        {rewardHint ? (
          <span className="welvura-banner__badge">
            <span className="welvura-banner__badge-kicker">от</span>
            <IconCoin size={14} />
            {rewardHint}
          </span>
        ) : null}
      </div>
    </button>
  );
}
