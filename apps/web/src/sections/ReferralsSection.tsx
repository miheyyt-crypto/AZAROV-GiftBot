import type { SectionPayload } from "../types.js";

export function ReferralsSection({ payload }: { payload: SectionPayload }) {
  if (payload.section !== "referrals") {
    return (
      <section className="panel">
        <h2>Referrals</h2>
        <p className="muted">This section is not available.</p>
      </section>
    );
  }
  return (
    <section className="panel">
      <h2>Referrals</h2>
      <p>
        Your code: <strong>{payload.referralCode}</strong>
      </p>
      <p className="muted">Attributed: {payload.referralsAttributed}</p>
    </section>
  );
}

export default ReferralsSection;
