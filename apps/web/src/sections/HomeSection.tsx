import type { SectionPayload } from "../types.js";

export function HomeSection({ payload }: { payload: SectionPayload }) {
  return (
    <section className="panel">
      <h2>Home</h2>
      <p className="muted">
        {payload.available
          ? "This screen only shows server bootstrap data. Play uses the Play tab."
          : "This section is not available."}
      </p>
    </section>
  );
}

export default HomeSection;
