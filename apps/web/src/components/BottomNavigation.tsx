import { memo } from "react";
import { TABS, navigate } from "../app/routes.js";
import type { TabId } from "../app/routes.js";
import { SHOP_GIFT_ICON_SRC } from "../assets/nav-shop-gift.js";

function NavIconHome() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.2 11.1 12 4.4l7.8 6.7V20a1.1 1.1 0 0 1-1.1 1.1h-4.7v-5.6H9.9v5.6H5.3A1.1 1.1 0 0 1 4.2 20V11.1Z"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NavIconTasks() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="3.6" width="14" height="16.8" rx="2.4" stroke="currentColor" strokeWidth="1.85" />
      <path d="M8.2 9.1h7.6M8.2 12.6h7.6M8.2 16.1h5.1" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" />
    </svg>
  );
}

function NavIconShop() {
  return (
    <img
      className="bottom-nav__shop-icon"
      src={SHOP_GIFT_ICON_SRC}
      width={34}
      height={34}
      alt=""
      draggable={false}
    />
  );
}

function NavIconFriends() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8.1" r="2.85" stroke="currentColor" strokeWidth="1.85" />
      <circle cx="16.2" cy="9.1" r="2.25" stroke="currentColor" strokeWidth="1.85" />
      <path
        d="M4.15 19.2c.5-3.15 2.7-4.85 4.95-4.85 2.25 0 4.4 1.7 4.95 4.85"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
      <path
        d="M13.7 19.2c.4-2.2 1.75-3.45 3.4-3.45 1.7 0 2.95 1.3 3.35 3.45"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
    </svg>
  );
}

function NavIconProfile() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.15" stroke="currentColor" strokeWidth="1.85" />
      <circle cx="12" cy="9.2" r="2.55" stroke="currentColor" strokeWidth="1.85" />
      <path
        d="M6.7 18.15c1.15-2.35 3-3.55 5.3-3.55s4.15 1.2 5.3 3.55"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
    </svg>
  );
}

function NavIcon({ name }: { name: TabId }) {
  if (name === "home") return <NavIconHome />;
  if (name === "tasks") return <NavIconTasks />;
  if (name === "shop") return <NavIconShop />;
  if (name === "friends") return <NavIconFriends />;
  return <NavIconProfile />;
}

export const BottomNavigation = memo(function BottomNavigation({
  active,
}: {
  active: TabId;
}) {
  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      <div className="bottom-nav__capsule">
        {TABS.map((tab) => {
          const isShop = tab.id === "shop";
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              className={[
                "bottom-nav__item",
                isActive ? "is-active" : "",
                isShop ? "bottom-nav__item--shop" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={isActive ? "page" : undefined}
              data-tab={tab.id}
              onClick={() => navigate(tab.href)}
            >
              {isShop ? (
                <span className="bottom-nav__shop-btn">
                  <NavIcon name={tab.id} />
                </span>
              ) : (
                <span className="bottom-nav__icon">
                  <NavIcon name={tab.id} />
                </span>
              )}
              <span className="bottom-nav__label">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
});
