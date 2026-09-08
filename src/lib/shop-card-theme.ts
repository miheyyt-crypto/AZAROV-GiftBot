import type { ProductCategory } from '@/types/shop'

export interface ShopCardTheme {
  border: string
  glow: string
  radial: string
  button: string
}

export const productCardTheme: Record<ProductCategory, ShopCardTheme> = {
  money: {
    border: 'border-[#ff8a3d]/75',
    glow: 'shadow-[0_0_22px_rgb(255_138_61/28%)]',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_42%,rgb(255_138_61/32%)_0%,rgb(255_138_61/8%)_42%,transparent_70%)]',
    button: 'bg-[#ff7a2f]',
  },
  donate: {
    border: 'border-[#ff4d78]/75',
    glow: 'shadow-[0_0_22px_rgb(255_77_120/28%)]',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_42%,rgb(255_77_120/32%)_0%,rgb(255_77_120/8%)_42%,transparent_70%)]',
    button: 'bg-[#e83a5f]',
  },
  subscription: {
    border: 'border-[#b56bff]/75',
    glow: 'shadow-[0_0_22px_rgb(181_107_255/30%)]',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_42%,rgb(181_107_255/34%)_0%,rgb(181_107_255/10%)_42%,transparent_70%)]',
    button: 'bg-[#9b4dff]',
  },
  other: {
    border: 'border-[#b56bff]/75',
    glow: 'shadow-[0_0_22px_rgb(181_107_255/30%)]',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_42%,rgb(181_107_255/34%)_0%,rgb(181_107_255/10%)_42%,transparent_70%)]',
    button: 'bg-[#9b4dff]',
  },
}

/** Premium case-card palette: border / glow / badge / price share one accent. */
export interface CaseCardTheme {
  /** Space-separated RGB channels, e.g. `52 211 153` — used in CSS `rgb(… / α)`. */
  accentRgb: string
  accentText: string
  radial: string
}

export const caseCardTheme: Record<string, CaseCardTheme> = {
  poor: {
    accentRgb: '52 211 153',
    accentText: 'text-emerald-400',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_40%,rgb(52_211_153/34%)_0%,rgb(52_211_153/10%)_45%,transparent_72%)]',
  },
  medium: {
    accentRgb: '56 189 248',
    accentText: 'text-sky-400',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_40%,rgb(56_189_248/34%)_0%,rgb(56_189_248/10%)_45%,transparent_72%)]',
  },
  rich: {
    accentRgb: '244 63 94',
    accentText: 'text-rose-400',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_40%,rgb(244_63_94/34%)_0%,rgb(244_63_94/10%)_45%,transparent_72%)]',
  },
  referral: {
    accentRgb: '181 107 255',
    accentText: 'text-[#d2a8ff]',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_40%,rgb(181_107_255/36%)_0%,rgb(181_107_255/12%)_45%,transparent_72%)]',
  },
}

export function getCaseCardTheme(caseId: string): CaseCardTheme {
  return caseCardTheme[caseId] ?? caseCardTheme.referral
}
