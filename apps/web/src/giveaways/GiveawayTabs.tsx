import { GiveawayGiftIcon, GiveawayTrophyIcon } from "./giveaway-icons.js";
import type { GiveawayTab } from "./types.js";

const TABS: { id: GiveawayTab; label: string }[] = [
  { id: "active", label: "Активные" },
  { id: "completed", label: "Завершённые" },
];

export function GiveawayTabs({
  value,
  onChange,
}: {
  value: GiveawayTab;
  onChange: (id: GiveawayTab) => void;
}) {
  return (
    <div className="giveaway-tabs" role="tablist">
      {TABS.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={option.id === value}
          className={option.id === value ? "giveaway-tabs__item is-active" : "giveaway-tabs__item"}
          onClick={() => onChange(option.id)}
        >
          {option.id === "active" ? (
            <GiveawayGiftIcon size={16} />
          ) : (
            <GiveawayTrophyIcon size={16} />
          )}
          {option.label}
        </button>
      ))}
    </div>
  );
}
