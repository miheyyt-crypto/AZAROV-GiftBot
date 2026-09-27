import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { navigate, parseHash } from "../app/routes.js";
import type { AppRoute } from "../app/routes.js";
import { CloseButton } from "../components/CloseButton.js";
import { ADMIN_NAV } from "./nav.js";

const AdminActiveRouteContext = createContext<AppRoute["name"] | null>(null);

export function AdminActiveRouteProvider({
  routeName,
  children,
}: {
  routeName: AppRoute["name"];
  children: ReactNode;
}) {
  return (
    <AdminActiveRouteContext.Provider value={routeName}>
      {children}
    </AdminActiveRouteContext.Provider>
  );
}

export function AdminShell({
  children,
}: {
  children: ReactNode;
}) {
  const fromCtx = useContext(AdminActiveRouteContext);
  const current =
    fromCtx ??
    (typeof window === "undefined"
      ? "admin-giveaways"
      : parseHash(window.location.hash || "#/").name);
  return (
    <div className="admin-frame">
      <div className="admin-shell">
        <aside className="admin-sidebar" aria-label="Админ-навигация">
          <div className="admin-brand">
            <div>
              <p className="admin-brand__name">AZAROV</p>
              <p className="admin-brand__sub">ADMIN</p>
            </div>
            <a className="admin-brand__app" href="#/">
              Mini App
            </a>
          </div>
          <nav className="admin-nav">
            {ADMIN_NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                data-testid={`admin-nav-${item.route}`}
                aria-current={current === item.route ? "page" : undefined}
                className={
                  current === item.route
                    ? "admin-nav__link is-active"
                    : "admin-nav__link"
                }
                onClick={(event) => {
                  event.preventDefault();
                  navigate(item.href);
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="admin-sidebar__foot">
            <p className="admin-identity">super_admin</p>
            <a
              className="admin-nav__link"
              href="#/"
              onClick={(event) => {
                event.preventDefault();
                navigate("#/");
              }}
            >
              Mini App
            </a>
          </div>
        </aside>
        <div className="admin-main">{children}</div>
      </div>
    </div>
  );
}

export function AdminPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="admin-page-header">
      <CloseButton
        onClick={() => navigate("#/")}
        ariaLabel="Закрыть"
        href="#/"
      />
      <div className="admin-page-header__copy">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action ? <div className="admin-page-header__action">{action}</div> : null}
    </header>
  );
}

export function AdminLayout({
  isSuperAdmin,
  title,
  description,
  error,
  action,
  children,
}: {
  isSuperAdmin: boolean;
  title: string;
  description: string;
  error?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  if (!isSuperAdmin) {
    return (
      <AdminShell>
        <AdminPageHeader title={title} description={description} />
        <p className="admin-state">Нет доступа</p>
      </AdminShell>
    );
  }
  return (
    <AdminShell>
      <AdminPageHeader
        title={title}
        description={description}
        {...(action ? { action } : {})}
      />
      {error ? <p className="admin-alert">{error}</p> : null}
      {children}
    </AdminShell>
  );
}
