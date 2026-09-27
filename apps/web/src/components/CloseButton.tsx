export function CloseButton({
  onClick,
  ariaLabel = "Закрыть",
  className,
  size = "page",
  href,
}: {
  onClick: () => void;
  ariaLabel?: string;
  className?: string;
  size?: "page" | "sheet";
  href?: string;
}) {
  const classes = ["close-btn", size === "sheet" ? "close-btn--sheet" : "close-btn--page"];
  if (className) {
    classes.push(className);
  }
  return (
    <button
      type="button"
      className={classes.join(" ")}
      onClick={onClick}
      aria-label={ariaLabel}
      data-testid="close-btn"
      {...(href ? { "data-close-href": href } : {})}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
