import type { ProductCategory } from '@/types/shop'

export interface ShopCardTheme {
  border: string
  glow: string
  radial: string
  button: string
  /** Colored label/price text on dark buttons (case cards). */
  accentText?: string
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

export const caseCardTheme: Record<string, ShopCardTheme> = {
  poor: {
    border: 'border-emerald-400/70',
    glow: 'shadow-[0_0_22px_rgb(52_211_153/28%)]',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_42%,rgb(52_211_153/30%)_0%,rgb(52_211_153/8%)_42%,transparent_70%)]',
    button: 'bg-emerald-500',
    accentText: 'text-emerald-400',
  },
  medium: {
    border: 'border-sky-400/70',
    glow: 'shadow-[0_0_22px_rgb(56_189_248/28%)]',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_42%,rgb(56_189_248/30%)_0%,rgb(56_189_248/8%)_42%,transparent_70%)]',
    button: 'bg-sky-500',
    accentText: 'text-sky-400',
  },
  rich: {
    border: 'border-fuchsia-400/70',
    glow: 'shadow-[0_0_22px_rgb(232_121_249/28%)]',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_42%,rgb(232_121_249/30%)_0%,rgb(232_121_249/8%)_42%,transparent_70%)]',
    button: 'bg-fuchsia-500',
    accentText: 'text-fuchsia-400',
  },
  referral: {
    border: 'border-[#b56bff]/75',
    glow: 'shadow-[0_0_22px_rgb(181_107_255/30%)]',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_42%,rgb(181_107_255/34%)_0%,rgb(181_107_255/10%)_42%,transparent_70%)]',
    button: 'bg-[#9b4dff]',
    accentText: 'text-[#d2a8ff]',
  },
}

export function getCaseCardTheme(caseId: string): ShopCardTheme {
  return caseCardTheme[caseId] ?? caseCardTheme.referral
}
