export function SegmentedTabs<T extends string>({
  value,
  options,
  onChange,
  tone = "default",
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
  tone?: "default" | "purple";
}) {
  return (
    <div className={tone === "purple" ? "seg-tabs seg-tabs--purple" : "seg-tabs"} role="tablist">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={option.id === value}
          className={option.id === value ? "seg-tabs__item is-active" : "seg-tabs__item"}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
