import { PageHeader } from "../components/PageHeader.js";

const TITLES = {
  rolls: "ROLLS",
  mines: "MINES",
  dice: "DICE",
} as const;

export function GamePlaceholderPage({ slug }: { slug: "rolls" | "mines" | "dice" }) {
  if (slug !== "rolls") {
    return (
      <div className="stack">
        <PageHeader title={TITLES[slug]} backHref="#/" />
      </div>
    );
  }
  return (
    <div className="stack">
      <PageHeader title={TITLES[slug]} backHref="#/" />
      <section className="card">
        <p className="game-placeholder">{TITLES[slug]}</p>
        <p className="muted">Игровая механика и settlement на этом этапе не реализованы.</p>
      </section>
    </div>
  );
}

export default GamePlaceholderPage;
