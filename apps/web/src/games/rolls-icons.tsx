import { IconCoin } from "../assets/icons.js";

type IconProps = { className?: string; size?: number };

const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function RollsMarkIcon({ className, size = 16 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="13" r="7" {...stroke} />
      <circle cx="12" cy="13" r="2.15" {...stroke} />
      <path d="M12 6.2V3.6M10.6 4.4h2.8" {...stroke} />
    </svg>
  );
}

export function RollsCoinIcon({ className, size = 15 }: IconProps) {
  if (className) {
    return <IconCoin className={className} size={size} />;
  }
  return <IconCoin size={size} />;
}

export function RollsShieldIcon({ className, size = 14 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.6 19 6.4v5.6c0 4.1-2.9 6.9-7 8.4-4.1-1.5-7-4.3-7-8.4V6.4L12 3.6Z" {...stroke} />
      <path d="M9.2 12.1 11.1 14l3.7-4.1" {...stroke} />
    </svg>
  );
}

export function RollsUsersIcon({ className, size = 14 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="9" r="2.7" {...stroke} />
      <circle cx="16" cy="10" r="2.15" {...stroke} />
      <path d="M4.6 18.2a4.4 4.4 0 0 1 8.8 0M13.2 18.2a3.8 3.8 0 0 1 6.2-3.1" {...stroke} />
    </svg>
  );
}

export function RollsBackIcon({ className, size = 16 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.6 5.4 8.2 12l6.4 6.6" {...stroke} />
    </svg>
  );
}

export function RollsClockIcon({ className, size = 11 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.1" {...stroke} />
      <path d="M12 8.2V12l2.6 1.8" {...stroke} />
    </svg>
  );
}

export function RollsStarIcon({ className, size = 11 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 4.4 13.9 9l5.1.4-3.9 3.2 1.2 5-4.3-2.6-4.3 2.6 1.2-5L5 9.4 10.1 9 12 4.4Z"
        {...stroke}
      />
    </svg>
  );
}

export function RollsPointerIcon() {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" fill="none" aria-hidden="true">
      <path
        d="M9 10.6 1.8 2.2h14.4L9 10.6Z"
        fill="#f6f2ff"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
