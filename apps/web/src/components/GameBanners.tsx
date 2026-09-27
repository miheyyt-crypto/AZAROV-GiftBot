import { GameCard } from "./GameCard.js";

export function GameBanners({ className }: { className?: string }) {
  const root = className ? `game-banners ${className}` : "game-banners";
  return (
    <section className={root}>
      <div className="game-banners__row">
        <GameCard title="MINES" href="#/games/mines" />
        <GameCard title="DICE" href="#/games/dice" />
      </div>
      <GameCard title="ROLLS" href="#/games/rolls" wide />
    </section>
  );
}
