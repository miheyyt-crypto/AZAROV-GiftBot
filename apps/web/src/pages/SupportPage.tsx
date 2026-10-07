import { useState } from "react";
import { ApiRequestError, createStreamDonation } from "../api.js";
import { PageHeader } from "../components/PageHeader.js";
import { CoinAmount } from "../components/CoinAmount.js";
import { BalanceBadge } from "../components/BalanceBadge.js";
import { clearIdempotencyKey, keyForPost } from "../idempotency.js";
import {
  applyServerBalance,
  refreshBalanceIfAmbiguous,
  useAzcBalance,
} from "../hooks/useAzcBalance.js";

const PRICE = 1000;
const MESSAGE_MAX = 200;
const ROUTE = "POST /stream-donations";

function canAfford(balanceAzc: string): boolean {
  try {
    return BigInt(balanceAzc) >= BigInt(PRICE);
  } catch {
    return false;
  }
}

function friendlyDonationError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === "INSUFFICIENT_FUNDS") {
      return "Недостаточно монет";
    }
    if (error.code === "STREAM_DONATION_INVALID_MESSAGE") {
      return "Проверьте текст сообщения";
    }
  }
  return "Не удалось отправить донат. Попробуйте ещё раз.";
}

export function SupportPage({
  token,
  skipRemote = false,
}: {
  token: string;
  skipRemote?: boolean;
}) {
  const balanceAzc = useAzcBalance(token, skipRemote);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const trimmed = message.trim();
  const affordable = canAfford(balanceAzc);
  const disabled =
    submitting || skipRemote || !affordable || trimmed.length === 0 || trimmed.length > MESSAGE_MAX;

  async function onSubmit(): Promise<void> {
    if (disabled) {
      return;
    }
    setSubmitting(true);
    setNote(undefined);
    setSuccess(false);
    const key = keyForPost(ROUTE);
    try {
      const result = await createStreamDonation(token, trimmed, key);
      applyServerBalance(result.newBalanceAzc);
      clearIdempotencyKey(ROUTE);
      setMessage("");
      setSuccess(true);
    } catch (error) {
      setNote(friendlyDonationError(error));
      await refreshBalanceIfAmbiguous(token, error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page stack stream-support">
      <PageHeader title="Поддержать стрим" backHref="#/" />
      <div className="stream-support__top">
        <BalanceBadge amountAzcString={balanceAzc} />
      </div>
      <section className="card stack stream-support__card">
        <p className="muted">Стоимость</p>
        <p className="stream-support__price">
          <CoinAmount amount={String(PRICE)} size={22} />
          <span>монет</span>
        </p>
        <p className="stream-support__row">
          <span>Баланс: {balanceAzc}</span>
          <span>Стоимость: {PRICE}</span>
        </p>
        <label className="stream-support__label" htmlFor="stream-donation-message">
          Сообщение для стрима
        </label>
        <textarea
          id="stream-donation-message"
          className="stream-support__input"
          maxLength={MESSAGE_MAX}
          rows={4}
          value={message}
          disabled={submitting}
          placeholder="Сообщение для стрима..."
          onChange={(event) => {
            setSuccess(false);
            setMessage(event.target.value);
          }}
        />
        <p className="muted stream-support__count">
          {trimmed.length}/{MESSAGE_MAX}
        </p>
        {!affordable ? <p className="error">Недостаточно монет</p> : null}
        {note ? <p className="error">{note}</p> : null}
        {success ? (
          <p className="ok">
            Донат отправлен 🎉
            <br />
            Он скоро появится на стриме.
          </p>
        ) : null}
        <button
          type="button"
          className="primary"
          disabled={disabled}
          onClick={() => {
            void onSubmit();
          }}
        >
          {submitting ? "Отправка…" : "Отправить за 1000"}
        </button>
      </section>
    </div>
  );
}

export default SupportPage;
