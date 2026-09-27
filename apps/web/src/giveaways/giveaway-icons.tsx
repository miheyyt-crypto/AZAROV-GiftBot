type IconProps = { className?: string; size?: number };

const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function GiveawayGiftIcon({ className, size = 28 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4.4" y="11" width="15.2" height="8.6" rx="1.8" {...stroke} />
      <path d="M4.4 11h15.2V9.15A1.75 1.75 0 0 0 17.85 7.4H6.15A1.75 1.75 0 0 0 4.4 9.15V11Z" {...stroke} />
      <path d="M12 7.4v12.2" {...stroke} />
      <path d="M12 7.4c-1.85-2.55-4.45-2.7-5.25-1.25.95.38 2.4 1.25 5.25 1.25Z" {...stroke} />
      <path d="M12 7.4c1.85-2.55 4.45-2.7 5.25-1.25-.95.38-2.4 1.25-5.25 1.25Z" {...stroke} />
    </svg>
  );
}

export function GiveawayTrophyIcon({ className, size = 18 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.2 4.6h7.6v4.4a3.8 3.8 0 0 1-7.6 0V4.6Z" {...stroke} />
      <path d="M8.2 6.2H5.6A2.2 2.2 0 0 0 7.8 8.6" {...stroke} />
      <path d="M15.8 6.2h2.6A2.2 2.2 0 0 1 16.2 8.6" {...stroke} />
      <path d="M12 12.8v2.6" {...stroke} />
      <path d="M8.8 19.4h6.4M9.6 15.4h4.8v4H9.6v-4Z" {...stroke} />
    </svg>
  );
}

export function GiveawayCheckIcon({ className, size = 15 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.5 12.4 10 16.7 18.5 7.6" {...stroke} />
    </svg>
  );
}
