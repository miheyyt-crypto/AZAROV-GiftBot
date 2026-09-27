type IconProps = { className?: string; size?: number };

const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function MinesBackIcon({ className, size = 16 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.6 5.4 8.2 12l6.4 6.6" {...stroke} />
    </svg>
  );
}

export function MinesBombIcon({ className, size = 18 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 21c4.1 0 7.2-2.85 7.2-6.9 0-3.7-2.55-6.2-7.2-10.1-4.65 3.9-7.2 6.4-7.2 10.1C4.8 18.15 7.9 21 12 21Z"
        fill="#8b5cf6"
      />
      <path d="M9.4 7.1c1.1-.85 2.1-1.15 2.6-1.15.5 0 1.5.3 2.6 1.15" fill="#34d399" />
      <path d="M12 10.4c1.45 0 2.4.75 2.4 1.55" stroke="#ddd6fe" strokeWidth="1.15" strokeLinecap="round" />
    </svg>
  );
}

export function MinesGemIcon({ className, size = 14 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 4.2 18.6 10 16.2 19.4H7.8L5.4 10 12 4.2Z"
        fill="#34d399"
        stroke="#6ee7b7"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
