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
    border: 'border-[#ff8a3d]/40',
    glow: 'shadow-[0_8px_24px_rgb(0_0_0/22%)]',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_42%,rgb(255_138_61/18%)_0%,rgb(255_138_61/5%)_42%,transparent_70%)]',
    button: 'bg-[#ff7a2f]',
  },
  donate: {
    border: 'border-[#ff4d78]/40',
    glow: 'shadow-[0_8px_24px_rgb(0_0_0/22%)]',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_42%,rgb(255_77_120/18%)_0%,rgb(255_77_120/5%)_42%,transparent_70%)]',
    button: 'bg-[#e83a5f]',
  },
  subscription: {
    border: 'border-[#b56bff]/40',
    glow: 'shadow-[0_8px_24px_rgb(0_0_0/22%)]',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_42%,rgb(181_107_255/20%)_0%,rgb(181_107_255/6%)_42%,transparent_70%)]',
    button: 'bg-[#9b4dff]',
  },
  other: {
    border: 'border-[#b56bff]/40',
    glow: 'shadow-[0_8px_24px_rgb(0_0_0/22%)]',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_42%,rgb(181_107_255/20%)_0%,rgb(181_107_255/6%)_42%,transparent_70%)]',
    button: 'bg-[#9b4dff]',
  },
}

export const caseCardTheme: Record<string, ShopCardTheme> = {
  poor: {
    border: 'border-emerald-400/40',
    glow: 'shadow-[0_8px_24px_rgb(0_0_0/22%)]',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_42%,rgb(52_211_153/16%)_0%,rgb(52_211_153/4%)_42%,transparent_70%)]',
    button: 'bg-emerald-500',
    accentText: 'text-emerald-400',
  },
  medium: {
    border: 'border-sky-400/40',
    glow: 'shadow-[0_8px_24px_rgb(0_0_0/22%)]',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_42%,rgb(56_189_248/16%)_0%,rgb(56_189_248/4%)_42%,transparent_70%)]',
    button: 'bg-sky-500',
    accentText: 'text-sky-400',
  },
  rich: {
    border: 'border-fuchsia-400/40',
    glow: 'shadow-[0_8px_24px_rgb(0_0_0/22%)]',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_42%,rgb(232_121_249/16%)_0%,rgb(232_121_249/4%)_42%,transparent_70%)]',
    button: 'bg-fuchsia-500',
    accentText: 'text-fuchsia-400',
  },
  referral: {
    border: 'border-[#b56bff]/45',
    glow: 'shadow-[0_8px_24px_rgb(0_0_0/22%)]',
    radial:
      'bg-[radial-gradient(ellipse_at_50%_42%,rgb(181_107_255/18%)_0%,rgb(181_107_255/5%)_42%,transparent_70%)]',
    button: 'bg-[#9b4dff]',
    accentText: 'text-[#d2a8ff]',
  },
}

export function getCaseCardTheme(caseId: string): ShopCardTheme {
  return caseCardTheme[caseId] ?? caseCardTheme.referral
}
