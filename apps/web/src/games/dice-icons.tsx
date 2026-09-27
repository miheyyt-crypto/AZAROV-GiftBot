type IconProps = { className?: string; size?: number };

const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.55,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function DiceBackIcon({ className, size = 16 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.6 5.4 8.2 12l6.4 6.6" {...stroke} />
    </svg>
  );
}

export function DiceMarkIcon({ className, size = 18 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4.6" y="4.6" width="14.8" height="14.8" rx="3.4" {...stroke} />
      <circle cx="8.7" cy="8.7" r="0.95" fill="currentColor" />
      <circle cx="15.3" cy="8.7" r="0.95" fill="currentColor" />
      <circle cx="12" cy="12" r="0.95" fill="currentColor" />
      <circle cx="8.7" cy="15.3" r="0.95" fill="currentColor" />
      <circle cx="15.3" cy="15.3" r="0.95" fill="currentColor" />
    </svg>
  );
}

export function DiceWinIcon({ className, size = 14 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.1" {...stroke} />
      <path d="M8.2 12.2 10.8 14.7 15.8 9.4" {...stroke} />
    </svg>
  );
}

export function DiceLossIcon({ className, size = 14 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.1" {...stroke} />
      <path d="M9.2 9.2 14.8 14.8M14.8 9.2 9.2 14.8" {...stroke} />
    </svg>
  );
}
