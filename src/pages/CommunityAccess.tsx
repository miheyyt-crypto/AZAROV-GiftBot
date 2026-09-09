import { ArrowLeft, ImagePlus, Lock, Trash2, Upload } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useUserAccount } from '@/hooks/useUserAccount'
import {
  COMMUNITY_ACCESS_MAX_BYTES,
  getCommunityAccessStatus,
  isValidTelegramUsername,
  isValidWelvuraId,
  normalizeUsernameInput,
  normalizeWelvuraIdInput,
  submitCommunityAccessRequest,
} from '@/lib/community-access'
import { getTelegramUserUnsafe } from '@/lib/telegram'
import type { CommunityAccessRequest } from '@/types/community-access'

function statusCopy(request: CommunityAccessRequest) {
  if (request.status === 'pending') {
    return {
      body: 'Администратор проверит её в ближайшее время.',
      badge: '⏳ На проверке',
    }
  }
  if (request.status === 'approved') {
    return {
      body: 'Ваша заявка подтверждена. Администрация свяжется с вами для выдачи доступа.',
      badge: '✅ Одобрена',
    }
  }
  return {
    body: request.rejectionReason
      ? `Причина: ${request.rejectionReason}`
      : 'Вы можете подать новую заявку.',
    badge: '❌ Отклонена',
  }
}

export function CommunityAccess() {
  const navigate = useNavigate()
  const account = useUserAccount()
  const tgUser = getTelegramUserUnsafe()
  const fileInputId = useId()
  const fileRef = useRef<HTMLInputElement>(null)

  const telegramId = account.telegramId || tgUser?.id || 0
  const sessionUsername = tgUser?.username || account.username || ''

  const [loading, setLoading] = useState(true)
  const [request, setRequest] = useState<CommunityAccessRequest | null>(null)
  const [forceNewForm, setForceNewForm] = useState(false)
  const [welvuraId, setWelvuraId] = useState('')
  const [username, setUsername] = useState(sessionUsername)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const result = await getCommunityAccessStatus()
      if (cancelled) {
        return
      }
      if (result.success) {
        setRequest(result.request || null)
        setForceNewForm(false)
      }
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (sessionUsername) {
      setUsername((current) => current || sessionUsername)
    }
  }, [sessionUsername])

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function clearFile() {
    setFile(null)
    if (fileRef.current) {
      fileRef.current.value = ''
    }
  }

  function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] || null
    setError('')
    if (!next) {
      setFile(null)
      return
    }
    if (!next.type.startsWith('image/')) {
      setError('❌ Выберите изображение (JPG, PNG или WEBP)')
      clearFile()
      return
    }
    if (next.size > COMMUNITY_ACCESS_MAX_BYTES) {
      setError('❌ Скриншот больше 5 МБ')
      clearFile()
      return
    }
    setFile(next)
  }

  async function onSubmit() {
    setError('')
    if (!telegramId) {
      setError('❌ Войдите через Telegram, чтобы отправить заявку')
      return
    }
    if (!isValidWelvuraId(welvuraId)) {
      setError('❌ Укажите Welvura ID')
      return
    }
    if (!isValidTelegramUsername(username)) {
      setError('❌ Укажите имя пользователя Telegram')
      return
    }
    if (!file) {
      setError('❌ Добавьте скриншот подтверждения')
      return
    }

    setBusy(true)
    const result = await submitCommunityAccessRequest({
      welvuraId: normalizeWelvuraIdInput(welvuraId),
      username: normalizeUsernameInput(username),
      requestId: crypto.randomUUID(),
      screenshot: file,
    })
    setBusy(false)

    if (!result.success || !result.request) {
      setError(result.message || 'Не удалось отправить заявку.')
      return
    }

    setRequest(result.request)
    setForceNewForm(false)
    setWelvuraId('')
    clearFile()
  }

  const showForm = !loading && (!request || forceNewForm)

  return (
    <div className="ui-page">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-2 text-sm text-muted"
      >
        <ArrowLeft size={16} aria-hidden />
        Назад
      </button>

      <div className="mb-5 flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04]">
          <Lock size={20} className="text-kick" aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-white">🔒 Закрытое сообщество</h1>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">
            Это закрытый эксклюзивный Telegram-чат для участников сообщества. Чтобы получить
            доступ, отправьте заявку с необходимыми данными и подтверждением выполнения условия.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-2xl bg-white/[0.04]" />
          <div className="h-40 animate-pulse rounded-2xl bg-white/[0.04]" />
        </div>
      ) : null}

      {!loading && request && !forceNewForm ? (
        <section className="overflow-hidden rounded-[22px] border border-white/[0.08] bg-[#141218]/95 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-kick">
            🔒 Заявка на доступ
          </p>
          <p className="mt-2 text-lg font-bold text-white">{statusCopy(request).badge}</p>
          <p className="mt-2 text-sm text-text-secondary">{statusCopy(request).body}</p>
          <div className="mt-4 space-y-1.5 text-sm text-white/80">
            <p>
              Welvura ID:{' '}
              <span className="font-mono text-white">{request.welvuraId || '—'}</span>
            </p>
            <p className="break-all">
              Имя пользователя:{' '}
              {request.username ? `@${request.username}` : 'отсутствует'}
            </p>
          </div>
          {request.status === 'rejected' ? (
            <button
              type="button"
              onClick={() => {
                setForceNewForm(true)
                setError('')
                setWelvuraId('')
                clearFile()
              }}
              className="mt-4 flex w-full min-h-12 items-center justify-center rounded-[14px] bg-kick px-4 text-sm font-semibold text-white"
            >
              Подать новую заявку
            </button>
          ) : null}
        </section>
      ) : null}

      {showForm ? (
        <section className="space-y-4 overflow-hidden rounded-[22px] border border-white/[0.08] bg-[#141218]/95 p-4">
          <div>
            <label htmlFor="community-welvura-id" className="text-xs font-semibold text-muted">
              Welvura ID
            </label>
            <input
              id="community-welvura-id"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={welvuraId}
              onChange={(event) => setWelvuraId(event.target.value.replace(/[^\d]/g, ''))}
              placeholder="Введите ID от Welvura"
              className="mt-1.5 w-full rounded-[14px] border border-white/[0.08] bg-black/30 px-3 py-3 font-mono text-sm text-white placeholder:font-sans placeholder:text-muted focus:border-kick/50 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="community-username" className="text-xs font-semibold text-muted">
              Имя пользователя Telegram
            </label>
            <div className="relative mt-1.5">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                @
              </span>
              <input
                id="community-username"
                type="text"
                value={normalizeUsernameInput(username)}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="ник"
                autoComplete="off"
                className="w-full rounded-[14px] border border-white/[0.08] bg-black/30 py-3 pl-8 pr-3 text-sm text-white placeholder:text-muted focus:border-kick/50 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted">📸 Скриншот подтверждения</p>
            <p className="mt-1 text-sm text-text-secondary">
              Загрузите скриншот, подтверждающий выполнение условия для получения доступа.
            </p>

            <input
              ref={fileRef}
              id={fileInputId}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={onPickFile}
            />

            {previewUrl ? (
              <div className="mt-3 overflow-hidden rounded-[16px] border border-white/[0.08]">
                <img
                  src={previewUrl}
                  alt="Превью скриншота"
                  className="max-h-64 w-full object-contain bg-black/40"
                />
                <div className="flex gap-2 border-t border-white/[0.06] p-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex flex-1 items-center justify-center gap-2 rounded-[12px] border border-white/[0.08] px-3 py-2.5 text-sm text-white"
                  >
                    <ImagePlus size={16} aria-hidden />
                    Заменить
                  </button>
                  <button
                    type="button"
                    onClick={clearFile}
                    className="flex items-center justify-center gap-2 rounded-[12px] border border-white/[0.08] px-3 py-2.5 text-sm text-muted"
                  >
                    <Trash2 size={16} aria-hidden />
                    Удалить
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mt-3 flex w-full min-h-12 items-center justify-center gap-2 rounded-[14px] border border-dashed border-white/20 bg-white/[0.03] px-4 text-sm font-medium text-white"
              >
                <Upload size={18} aria-hidden />
                Выбрать изображение
              </button>
            )}
          </div>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="button"
            disabled={busy}
            onClick={() => void onSubmit()}
            className="flex w-full min-h-12 items-center justify-center gap-2 rounded-[14px] bg-kick px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Отправка…' : '📩 Отправить заявку'}
          </button>
        </section>
      ) : null}
    </div>
  )
}
