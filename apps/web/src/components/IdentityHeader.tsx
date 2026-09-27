import { Avatar } from "./Avatar.js";
import { BalanceBadge } from "./BalanceBadge.js";
import type { ProfileSummary } from "../profile/types.js";

function displayName(summary: ProfileSummary): string {
  const joined = [summary.user.telegramFirstName, summary.user.telegramLastName]
    .filter(Boolean)
    .join(" ");
  return summary.user.displayName || joined || "Игрок";
}

export function IdentityHeader({
  summary,
  balanceAzc,
}: {
  summary: ProfileSummary;
  balanceAzc: string;
}) {
  const name = displayName(summary);
  const username = summary.user.telegramUsername
    ? `@${summary.user.telegramUsername.replace(/^@/, "")}`
    : null;

  return (
    <header className="identity-header">
      <Avatar name={name} src={summary.user.avatarUrl} />
      <div className="identity-header__copy">
        <p className="identity-header__name">{name}</p>
        {username ? <p className="identity-header__user">{username}</p> : null}
      </div>
      <BalanceBadge amountAzcString={balanceAzc} />
    </header>
  );
}
