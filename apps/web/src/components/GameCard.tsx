import { memo } from "react";
import { GAME_BANNER_SRC } from "../assets/game-banners.js";
import { navigate } from "../app/routes.js";

const CARDS = {
  MINES: {
    href: "#/games/mines",
    src: GAME_BANNER_SRC.mines,
    variant: "mines",
    label: "MINES",
  },
  DICE: {
    href: "#/games/dice",
    src: GAME_BANNER_SRC.dice,
    variant: "dice",
    label: "DICE",
  },
  ROLLS: {
    href: "#/games/rolls",
    src: GAME_BANNER_SRC.rolls,
    variant: "rolls",
    label: "ROLLS",
  },
} as const;

export const GameCard = memo(function GameCard({
  title,
  href,
  wide = false,
  className,
}: {
  title: string;
  href: string;
  wide?: boolean;
  className?: string;
}) {
  const card = CARDS[title as keyof typeof CARDS];
  const variant = card?.variant ?? "generic";
  const src = card?.src;
  const label = card?.label ?? title;
  const base = wide
    ? `game-card game-card--wide game-card--${variant}`
    : `game-card game-card--${variant}`;

  return (
    <button
      type="button"
      className={className ? `${base} ${className}` : base}
      aria-label={label}
      onClick={() => navigate(href)}
    >
      {src ? (
        <img
          className="game-card__media"
          src={src}
          alt=""
          decoding="async"
          draggable={false}
        />
      ) : null}
      <span className="game-card__wash" aria-hidden="true" />
    </button>
  );
});
