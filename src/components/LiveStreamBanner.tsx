import { KICK_REQUIRED_CHANNEL, KICK_REQUIRED_CHANNEL_URL } from '@/lib/constants'
import { openPartnerUrl } from '@/lib/partners'

type LiveStreamBannerProps = {
  channelSlug?: string
  channelAvatarUrl?: string | null
}

function openKickChannel(url: string): void {
  openPartnerUrl(url)
}

export function LiveStreamBanner({
  channelSlug = KICK_REQUIRED_CHANNEL,
  channelAvatarUrl = null,
}: LiveStreamBannerProps) {
  const slug = String(channelSlug || KICK_REQUIRED_CHANNEL)
    .trim()
    .replace(/^@/, '')
    .toLowerCase() || KICK_REQUIRED_CHANNEL
  const channelUrl = `https://kick.com/${slug}`
  const linkLabel = `Kick.com/${slug}`
  const initial = slug.charAt(0).toUpperCase()

  return (
    <article
      className={[
        'home-stream-card relative overflow-hidden rounded-[22px] border border-white/[0.08]',
        'bg-[linear-gradient(165deg,rgb(28_26_38/92%),rgb(14_12_22/96%))]',
        'p-4 shadow-[0_10px_32px_rgb(0_0_0/35%),inset_0_1px_0_rgb(255_255_255/5%)]',
      ].join(' ')}
    >
      <header className="flex items-center gap-3">
        <div className="relative shrink-0">
          <div className="size-[52px] overflow-hidden rounded-full border border-white/10 bg-white/5">
            {channelAvatarUrl ? (
              <img
                src={channelAvatarUrl}
                alt=""
                className="size-full object-cover"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                className="flex size-full items-center justify-center bg-gradient-to-br from-kick/40 to-kick-dark text-lg font-bold text-white"
                aria-hidden
              >
                {initial}
              </div>
            )}
          </div>
          <span
            className={[
              'home-live-badge absolute -bottom-1 left-1/2 z-[1] -translate-x-1/2',
              'inline-flex items-center gap-1 rounded-md bg-[#ff2d55] px-1.5 py-[2px]',
              'text-[9px] font-bold uppercase tracking-wide text-white',
              'shadow-[0_0_10px_rgb(255_45_85/45%)]',
            ].join(' ')}
          >
            <span className="size-1.5 rounded-full bg-white" aria-hidden />
            LIVE
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[20px] font-bold leading-tight tracking-tight text-white">
            {slug}
          </h2>
          <button
            type="button"
            onClick={() => openKickChannel(channelUrl)}
            className="mt-0.5 block max-w-full truncate text-left text-[13px] font-semibold text-kick-light"
            aria-label={`Открыть ${linkLabel}`}
          >
            {linkLabel}
          </button>
        </div>
      </header>

      <div className="mt-3.5 flex gap-2.5">
        <span className="mt-0.5 w-[3px] shrink-0 rounded-full bg-kick" aria-hidden />
        <p className="text-[13px] leading-relaxed text-white/70">
          <span className="font-semibold text-white">{slug}</span>
          {', я сейчас в эфире! Заходи на стрим, общайся в чате и выполняй задания — заработай монеты прямо сейчас'}
        </p>
      </div>

      <p className="mt-2.5 text-[13px] font-semibold text-[#f5d76e]">
        Для захода на стрим нужен VPN.
      </p>

      <button
        type="button"
        onClick={() => openKickChannel(channelUrl || KICK_REQUIRED_CHANNEL_URL)}
        className={[
          'mt-3.5 flex min-h-12 w-full items-center justify-center rounded-full',
          'bg-kick px-4 text-[15px] font-bold text-[#0b1208]',
          'shadow-[0_8px_22px_rgb(83_204_24/28%)]',
        ].join(' ')}
        aria-label="Смотреть стрим на Kick"
      >
        Смотреть стрим
      </button>
    </article>
  )
}
