import { useState } from "react";
import type { DevLocalRole } from "../dev-role.js";

function switchDevRole(role: DevLocalRole): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("fixture");
  url.searchParams.set("dev", role);
  window.location.href = url.toString();
}

/** Compact DEV chip — expands on click so it never covers page titles. */
export function DevBadge({ role }: { role: DevLocalRole }) {
  const [open, setOpen] = useState(false);
  const label = role === "admin" ? "DEV · ADMIN" : "DEV";

  return (
    <div
      className={open ? "dev-badge is-open" : "dev-badge"}
      data-testid="dev-badge"
    >
      <button
        type="button"
        className="dev-badge__chip"
        aria-expanded={open}
        aria-label="Local DEV controls"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open ? (
        <span className="dev-badge__switch" role="group" aria-label="Dev identity">
          <span className="dev-badge__label sr-only">
            {role === "admin" ? "LOCAL DEV · ADMIN" : "LOCAL DEV"}
          </span>
          <button
            type="button"
            className={role === "user" ? "is-active" : undefined}
            onClick={() => switchDevRole("user")}
          >
            User
          </button>
          <button
            type="button"
            className={role === "admin" ? "is-active" : undefined}
            onClick={() => switchDevRole("admin")}
          >
            Admin
          </button>
        </span>
      ) : (
        <span className="sr-only">
          {role === "admin" ? "LOCAL DEV · ADMIN" : "LOCAL DEV"}
        </span>
      )}
    </div>
  );
}
