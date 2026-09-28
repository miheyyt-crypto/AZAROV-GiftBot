import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { clearGetDedupForTests } from "../get-dedup.js";
import { ProfileView } from "./ProfileView.js";
import {
  applyProfileRefreshOutcome,
  PROFILE_LIVE_REFRESH_MS,
  scheduleProfileLiveRefresh,
} from "./profile-live.js";
import {
  loadSharedProfile,
  readCachedProfile,
  resetProfileStoreForTests,
  seedProfileFromBootstrap,
} from "./profile-store.js";
import { EMPTY_PROFILE_SUMMARY, type ProfileSummary } from "./types.js";
import type { BootstrapPayload } from "../types.js";

const bootstrap: BootstrapPayload = {
  user: { publicId: "u1", displayName: "Cached" },
  wallet: { balanceMinor: "1500", currencyCode: "INTERNAL" },
  session: { expiresAt: "2099-01-01T00:00:00.000Z" },
  flags: { kickLinked: false, isSuperAdmin: false },
  counters: { referralsAttributed: 0 },
  referralCode: "abc",
  configVersion: "0",
};

const originalFetch = globalThis.fetch;

function profileDto(overrides: {
  level?: number;
  messages?: string;
}): ProfileSummary {
  return {
    ...EMPTY_PROFILE_SUMMARY,
    user: {
      ...EMPTY_PROFILE_SUMMARY.user,
      displayName: "Fresh",
    },
    level: {
      ...EMPTY_PROFILE_SUMMARY.level,
      current: overrides.level ?? 3,
      totalXp: "400",
      currentLevelXp: "200",
      nextLevelXp: "500",
      xpNeededForNext: "300",
      progressRatio: 0.4,
    },
    activity: {
      kickChatMessages: overrides.messages ?? "57",
    },
  };
}

function mockProfileFetch(dto: ProfileSummary, onHit?: () => void): void {
  globalThis.fetch = (async () => {
    onHit?.();
    return new Response(JSON.stringify(dto), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetProfileStoreForTests();
  clearGetDedupForTests();
});

test("A: bootstrap seed renders immediately and still GET /profile", async () => {
  resetProfileStoreForTests();
  seedProfileFromBootstrap("tok", bootstrap);
  const cached = readCachedProfile("tok");
  assert.equal(cached?.user.displayName, "Cached");
  const html = renderToStaticMarkup(
    createElement(ProfileView, {
      summary: cached ?? EMPTY_PROFILE_SUMMARY,
      promo: "",
      onPromoChange: () => undefined,
      onPromoSubmit: () => undefined,
      onSupport: () => undefined,
    }),
  );
  assert.match(html, /Cached/);
  assert.doesNotMatch(html, /skeleton/i);

  let hits = 0;
  mockProfileFetch(profileDto({ level: 3, messages: "57" }), () => {
    hits += 1;
  });
  let refreshCalls = 0;
  let pending: Promise<ProfileSummary> | undefined;
  const dispose = scheduleProfileLiveRefresh({
    skipRemote: false,
    isVisible: () => true,
    onRefresh: () => {
      refreshCalls += 1;
      pending = loadSharedProfile("tok", { force: true });
    },
    addVisibilityListener: () => () => undefined,
    setIntervalFn: (() => 1) as unknown as typeof setInterval,
    clearIntervalFn: () => undefined,
  });
  assert.equal(refreshCalls, 1);
  const loaded = await pending;
  dispose();
  assert.equal(hits, 1);
  assert.equal(loaded?.level.current, 3);
  assert.equal(readCachedProfile("tok")?.level.current, 3);
});

test("B: cached level/messages are replaced after GET /profile", async () => {
  resetProfileStoreForTests();
  seedProfileFromBootstrap("tok", bootstrap);
  const stale: ProfileSummary = {
    ...(readCachedProfile("tok") ?? EMPTY_PROFILE_SUMMARY),
    level: { ...EMPTY_PROFILE_SUMMARY.level, current: 2 },
    activity: { kickChatMessages: "40" },
  };
  let state = applyProfileRefreshOutcome(
    { status: "loading" },
    { ok: true, data: stale },
  );
  assert.equal(state.status, "ready");
  if (state.status === "ready") {
    assert.equal(state.data.level.current, 2);
    assert.equal(state.data.activity.kickChatMessages, "40");
  }

  mockProfileFetch(profileDto({ level: 3, messages: "57" }));
  const fresh = await loadSharedProfile("tok", { force: true });
  state = applyProfileRefreshOutcome(state, { ok: true, data: fresh });
  assert.equal(state.status, "ready");
  if (state.status !== "ready") {
    throw new Error("expected ready");
  }
  assert.equal(state.data.level.current, 3);
  assert.equal(state.data.activity.kickChatMessages, "57");
  const html = renderToStaticMarkup(
    createElement(ProfileView, {
      summary: state.data,
      promo: "",
      onPromoChange: () => undefined,
      onPromoSubmit: () => undefined,
      onSupport: () => undefined,
    }),
  );
  assert.match(html, /Уровень 3/);
  assert.match(html, /57/);
  assert.doesNotMatch(html, />40</);
});

test("C: failed background refresh keeps displayed profile", () => {
  const shown = {
    status: "ready" as const,
    data: {
      ...EMPTY_PROFILE_SUMMARY,
      level: { ...EMPTY_PROFILE_SUMMARY.level, current: 2 },
      activity: { kickChatMessages: "40" },
    },
  };
  const next = applyProfileRefreshOutcome(shown, {
    ok: false,
    message: "request failed",
  });
  assert.equal(next.status, "ready");
  if (next.status === "ready") {
    assert.equal(next.data.level.current, 2);
    assert.equal(next.data.activity.kickChatMessages, "40");
  }
  const fatal = applyProfileRefreshOutcome(
    { status: "loading" },
    { ok: false, message: "request failed" },
  );
  assert.equal(fatal.status, "error");
});

test("D: hidden visibility does not fire polling GET /profile", () => {
  let visible = true;
  const ticks: Array<() => void> = [];
  let refreshes = 0;
  const dispose = scheduleProfileLiveRefresh({
    skipRemote: false,
    isVisible: () => visible,
    onRefresh: () => {
      refreshes += 1;
    },
    addVisibilityListener: () => () => undefined,
    setIntervalFn: ((fn: () => void) => {
      ticks.push(fn);
      return 1;
    }) as unknown as typeof setInterval,
    clearIntervalFn: () => {
      ticks.length = 0;
    },
  });
  assert.equal(refreshes, 1);
  assert.equal(PROFILE_LIVE_REFRESH_MS, 10_000);
  visible = false;
  ticks[0]?.();
  assert.equal(refreshes, 1);
  dispose();
});

test("E: returning to visible triggers an immediate refresh", () => {
  let visible = false;
  let onChange: (() => void) | undefined;
  let refreshes = 0;
  const dispose = scheduleProfileLiveRefresh({
    skipRemote: false,
    isVisible: () => visible,
    onRefresh: () => {
      refreshes += 1;
    },
    addVisibilityListener: (listener) => {
      onChange = listener;
      return () => {
        onChange = undefined;
      };
    },
    setIntervalFn: (() => 1) as unknown as typeof setInterval,
    clearIntervalFn: () => undefined,
  });
  assert.equal(refreshes, 1);
  visible = true;
  onChange?.();
  assert.equal(refreshes, 2);
  dispose();
});

test("F: unmount clears interval and visibility listener", () => {
  let visible = true;
  let onChange: (() => void) | undefined;
  const ticks: Array<() => void> = [];
  let refreshes = 0;
  let cleared = false;
  const dispose = scheduleProfileLiveRefresh({
    skipRemote: false,
    isVisible: () => visible,
    onRefresh: () => {
      refreshes += 1;
    },
    addVisibilityListener: (listener) => {
      onChange = listener;
      return () => {
        onChange = undefined;
      };
    },
    setIntervalFn: ((fn: () => void) => {
      ticks.push(fn);
      return 7;
    }) as unknown as typeof setInterval,
    clearIntervalFn: () => {
      cleared = true;
      ticks.length = 0;
    },
  });
  assert.equal(refreshes, 1);
  dispose();
  assert.equal(cleared, true);
  assert.equal(onChange, undefined);
  assert.equal(ticks.length, 0);
  assert.equal(refreshes, 1);
});

test("G: concurrent force refresh shares one GET /profile", async () => {
  resetProfileStoreForTests();
  seedProfileFromBootstrap("tok", bootstrap);
  let hits = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = (async () => {
    hits += 1;
    await gate;
    return new Response(JSON.stringify(profileDto({ level: 3, messages: "57" })), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const first = loadSharedProfile("tok", { force: true });
  const second = loadSharedProfile("tok", { force: true });
  await Promise.resolve();
  assert.equal(hits, 1);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.level.current, 3);
  assert.equal(b.activity.kickChatMessages, "57");
  assert.equal(hits, 1);
});
