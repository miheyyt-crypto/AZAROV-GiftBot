/** Inline SVG icons for Mini App chrome — no remote deps. */

import { COIN_ICON_SRC } from "./coin-icon.js";
import { GRAM_ICON_SRC } from "./gram-icon.js";

type IconProps = { className?: string; size?: number };

export function IconGram({ className, size = 18 }: IconProps) {
  return (
    <img
      className={className ? `gram-icon ${className}` : "gram-icon"}
      src={GRAM_ICON_SRC}
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  );
}

export function IconHome({ className, size = 22 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconTasks({ className, size = 22 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="4" width="14" height="16" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 9h8M8 13h6M8 17h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function IconShopBag({ className, size = 26 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6.5 8.5h11l-.9 10.2a1.6 1.6 0 0 1-1.6 1.4H9a1.6 1.6 0 0 1-1.6-1.4L6.5 8.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M9 8.5V7.2a3 3 0 0 1 6 0v1.3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconFriends({ className, size = 22 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="16.2" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M4.2 19a4.8 4.8 0 0 1 9.6 0M13.2 19a4.2 4.2 0 0 1 6.6-3.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconProfile({ className, size = 22 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5 19.5c1.4-3.4 3.8-5 7-5s5.6 1.6 7 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function IconFlame({ className, size = 22 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3c1.2 2.2-.2 3.6.8 5.2C14.2 10 16 9.2 16 12.4A4.2 4.2 0 0 1 12 16.5 4.2 4.2 0 0 1 8 12.4c0-2.6 1.4-3.6 2.4-5.1.7-1 0-2.4 1.6-4.3Z"
        fill="#f59e0b"
        stroke="#fbbf24"
        strokeWidth="0.8"
      />
      <path
        d="M12 9.2c.6 1.1 0 1.8.5 2.7.4.7 1.2.4 1.2 1.8A2 2 0 0 1 12 15.8 2 2 0 0 1 10 13.7c0-1.2.6-1.6 1-2.4.3-.5 0-1.2 1-2.1Z"
        fill="#fde68a"
      />
    </svg>
  );
}

export function IconCoin({ className, size = 16 }: IconProps) {
  return (
    <img
      className={className ? `coin-icon ${className}` : "coin-icon"}
      src={COIN_ICON_SRC}
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  );
}

export function IconRoll({ className, size = 22 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="13" r="7.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 6.2 13.2 3.6H10.8L12 6.2Z" fill="currentColor" />
      <circle cx="12" cy="13" r="2.1" fill="currentColor" />
      <path d="M12 5.8V8.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconCaseCube({ className, size = 18 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M12 21V12M4 7.5 12 12l8-4.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

export function IconLock({ className, size = 18 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 10V8a4 4 0 0 1 8 0v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function IconInfo({ className, size = 16 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 11v6M12 7.5h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconCart({ className, size = 42 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M10 14h4l3.2 16.5A3 3 0 0 0 20.1 33h14.6a3 3 0 0 0 2.9-2.2L41 18H16"
        stroke="#c4b5fd"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="21" cy="38" r="2.2" fill="#c4b5fd" />
      <circle cx="34" cy="38" r="2.2" fill="#c4b5fd" />
    </svg>
  );
}

export function IconGift({ className, size = 36 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="8" y="20" width="32" height="20" rx="4" fill="#22c55e" />
      <rect x="8" y="14" width="32" height="8" rx="3" fill="#4ade80" />
      <rect x="22" y="14" width="4" height="26" fill="#166534" />
      <path d="M24 14c-3-5-8-6-10-3 2 1 4 3 10 3Z" fill="#86efac" />
      <path d="M24 14c3-5 8-6 10-3-2 1-4 3-10 3Z" fill="#86efac" />
    </svg>
  );
}

export function IconChevron({ className, size = 18 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6.5 15.5 12 9 17.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconLink({ className, size = 18 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9.2 14.8 14.8 9.2M8.4 11.2l-1.3 1.3a3.4 3.4 0 0 0 4.8 4.8l1.3-1.3M15.6 12.8l1.3-1.3a3.4 3.4 0 1 0-4.8-4.8l-1.3 1.3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconCopy({ className, size = 18 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="8.2" y="8.2" width="11" height="11" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6.4 15.2H5.8A2.2 2.2 0 0 1 3.6 13V5.8A2.2 2.2 0 0 1 5.8 3.6H13a2.2 2.2 0 0 1 2.2 2.2v.6" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function IconTelegram({ className, size = 18 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20.6 4.4 3.7 11c-.8.3-.8 1.4 0 1.7l4.2 1.4 1.6 5.1c.2.7 1.1.9 1.6.3l2.4-2.6 4.3 3.2c.6.4 1.4.1 1.6-.6L21.5 5.3c.2-.8-.6-1.4-1.4-1Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function IconBolt({ className, size = 18 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M13.2 3 6.5 13.2h5.1L10.8 21 17.5 10.8h-5.1L13.2 3Z" fill="currentColor" />
    </svg>
  );
}

export function IconInvite({ className, size = 18 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10" cy="8.5" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.4 18.5a5.6 5.6 0 0 1 11.2 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M17.5 7.2v5.2M15 9.8h5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function IconGiftOutline({ className, size = 18 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.5" y="11" width="15" height="8.5" rx="1.8" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.5 11h15V9.2A1.7 1.7 0 0 0 17.8 7.5H6.2A1.7 1.7 0 0 0 4.5 9.2V11Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 7.5v12" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 7.5c-1.8-2.6-4.4-2.8-5.2-1.4.9.4 2.3 1.4 5.2 1.4Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 7.5c1.8-2.6 4.4-2.8 5.2-1.4-.9.4-2.3 1.4-5.2 1.4Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
