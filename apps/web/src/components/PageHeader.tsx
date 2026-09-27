import type { ReactNode } from "react";
import { navigate } from "../app/routes.js";
import { CloseButton } from "./CloseButton.js";

export function PageHeader({
  title,
  backHref,
  trailing,
  icon,
  align = "center",
}: {
  title: string;
  backHref?: string;
  trailing?: ReactNode;
  icon?: ReactNode;
  align?: "center" | "start";
}) {
  return (
    <header className={align === "start" ? "page-header page-header--start" : "page-header"}>
      {backHref ? (
        <CloseButton
          onClick={() => navigate(backHref)}
          ariaLabel="Назад"
          href={backHref}
        />
      ) : (
        <span className="close-btn close-btn--ghost" />
      )}
      <h1>
        {icon ? <span className="page-header__icon">{icon}</span> : null}
        {title}
      </h1>
      <div className="page-header__trail">{trailing}</div>
    </header>
  );
}
