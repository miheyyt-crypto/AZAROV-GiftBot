import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resetAzcBalanceStoreForTests } from "../hooks/useAzcBalance.js";
import { RollsPage } from "../pages/RollsPage.js";
import { RollsWinnerModal } from "./RollsWinnerModal.js";
import type { RollsCurrent } from "./rolls-types.js";

function bettingPreview(secondsLeft: number): RollsCurrent {
  const now = Date.now();
  return {
    serverTime: new Date(now).toISOString(),
    you: { stakeAzc: "100", chancePercent: "50.00", participantId: "p1" },
    previous: null,
    top: null,
    round: {
      roundId: "round-bet",
      status: "betting",
      version: "2",
      participantCount: 2,
      totalPotAzc: "200",
      bettingDeadline: new Date(now + secondsLeft * 1000).toISOString(),
      bettingStartedAt: new Date(now).toISOString(),
      spinStartedAt: null,
      spinDurationMs: 8000,
      serverSeedHash: "abc",
      serverSeed: null,
      nonce: "0",
      algorithm: "azarov:v1:rolls",
      aggregateClientSeed: null,
      participantSnapshotHash: null,
      winningTicket: null,
      winnerParticipantId: null,
      winnerUserId: null,
      payoutAzc: null,
      participants: [
        {
          participantId: "p1",
          publicId: "u1",
          displayName: "Ann",
          avatarKey: null,
          avatarUrl: null,
          stakeAzc: "100",
          joinedAt: new Date(now).toISOString(),
        },
        {
          participantId: "p2",
          publicId: "u2",
          displayName: "Bob",
          avatarKey: null,
          avatarUrl: null,
          stakeAzc: "100",
          joinedAt: new Date(now).toISOString(),
        },
      ],
      createdAt: new Date(now).toISOString(),
      resolvedAt: null,
    },
  };
}

test("rolls waiting chrome matches premium layout and hides AZC", () => {
  resetAzcBalanceStoreForTests();
  const html = renderToStaticMarkup(
    createElement(RollsPage, { token: "fixture", skipRemote: true }),
  );
  assert.match(html, />Roll</);
  assert.match(html, /ПРЕД\. ИГРА/);
  assert.match(html, /ТОП ИГРА/);
  assert.match(html, /ВСЕГО/);
  assert.match(html, /СУММА СТАВКИ/);
  assert.match(html, /Поставить/);
  assert.match(html, /0 Игроков \/ 1000/);
  assert.match(html, /Сделайте ставку, чтобы начать игру/);
  assert.match(html, /aria-label="Ожидание"/);
  assert.match(html, /½/);
  assert.match(html, /2×/);
  assert.match(html, /МАКС/);
  assert.match(html, /2 500/);
  assert.doesNotMatch(html, /AZC/i);
  assert.match(html, /\/assets\/coin-icon\.png/);
  assert.doesNotMatch(html, /setInterval\(250/);
  assert.doesNotMatch(html, /class="rolls-countdown"/);
});

test("previous and top cards use board winner identity not the viewer", () => {
  resetAzcBalanceStoreForTests();
  const preview = bettingPreview(20);
  preview.you = {
    userId: "user-a",
    stakeAzc: "100",
    chancePercent: "50.00",
    participantId: "p1",
  };
  preview.previous = {
    roundId: "prev-1",
    winnerId: "user-b",
    winnerName: "BobWin",
    winnerUsername: "bob",
    winnerAvatar: "https://example.test/bob.png",
    winnerInitials: "B",
    amount: "5000",
    chance: "80.00",
    finishedAt: "2026-01-01T00:00:00.000Z",
  };
  preview.top = {
    roundId: "top-1",
    winnerId: "user-a",
    winnerName: "AnnWin",
    winnerUsername: "ann",
    winnerAvatar: null,
    winnerInitials: "A",
    amount: "9000",
    chance: "12.50",
    finishedAt: "2026-01-01T00:00:00.000Z",
  };
  const html = renderToStaticMarkup(
    createElement(RollsPage, {
      token: "fixture",
      skipRemote: true,
      preview,
    }),
  );
  const prevBlock = html.match(
    /rolls-side-card--prev[\s\S]*?rolls-side-card--top/,
  )?.[0];
  const topBlock = html.match(/rolls-side-card--top[\s\S]*?rolls-pot-pill/)?.[0];
  assert.ok(prevBlock);
  assert.ok(topBlock);
  assert.match(prevBlock, /BobWin/);
  assert.match(prevBlock, /https:\/\/example\.test\/bob\.png/);
  assert.match(prevBlock, /ШАНС 80%/);
  assert.doesNotMatch(prevBlock, />Вы</);
  assert.match(topBlock, />Вы</);
  assert.doesNotMatch(topBlock, /AnnWin/);
});

test("rolls shows the lone bettor in the player list", () => {
  resetAzcBalanceStoreForTests();
  const preview = bettingPreview(20);
  preview.round.participantCount = 1;
  preview.round.participants = [preview.round.participants[0]!];
  preview.round.totalPotAzc = "100";
  preview.you = { stakeAzc: "100", chancePercent: "100.00", participantId: "p1" };
  preview.round.status = "waiting";
  preview.round.bettingDeadline = null;
  const html = renderToStaticMarkup(
    createElement(RollsPage, {
      token: "fixture",
      skipRemote: true,
      preview,
    }),
  );
  assert.match(html, /rolls-avatar-preload/);
  assert.match(html, /Ann/);
  assert.doesNotMatch(html, /Сделайте ставку, чтобы начать игру/);
});

test("rolls betting hub shows server countdown and hides waiting", () => {
  resetAzcBalanceStoreForTests();
  const html = renderToStaticMarkup(
    createElement(RollsPage, {
      token: "fixture",
      skipRemote: true,
      preview: bettingPreview(20),
    }),
  );
  assert.match(html, /data-rolls-hub="betting"/);
  assert.match(html, /aria-label="СТАРТ ЧЕРЕЗ 20"/);
  assert.doesNotMatch(html, /aria-label="Ожидание"/);
  assert.doesNotMatch(html, /class="rolls-countdown"/);
  assert.doesNotMatch(html, />Ожидание</);
});

test("rolls betting hub near zero still is countdown not waiting", () => {
  resetAzcBalanceStoreForTests();
  const html = renderToStaticMarkup(
    createElement(RollsPage, {
      token: "fixture",
      skipRemote: true,
      preview: bettingPreview(1),
    }),
  );
  assert.match(html, /aria-label="СТАРТ ЧЕРЕЗ 1"/);
  assert.doesNotMatch(html, /aria-label="Ожидание"/);
});

test("waiting next round shows bet panel without a remount", () => {
  resetAzcBalanceStoreForTests();
  const html = renderToStaticMarkup(
    createElement(RollsPage, {
      token: "fixture",
      skipRemote: true,
      preview: {
        serverTime: new Date().toISOString(),
        you: { userId: "user-a", stakeAzc: "0", chancePercent: "0.00", participantId: null },
        previous: {
          roundId: "ended",
          winnerId: "user-b",
          winnerName: "BobWin",
          winnerUsername: "bob",
          winnerAvatar: null,
          winnerInitials: "B",
          amount: "5000",
          chance: "80.00",
          finishedAt: "2026-01-01T00:00:00.000Z",
        },
        top: null,
        round: {
          ...bettingPreview(20).round,
          roundId: "next-wait",
          status: "waiting",
          version: "1",
          participantCount: 0,
          totalPotAzc: "0",
          bettingDeadline: null,
          bettingStartedAt: null,
          winnerParticipantId: null,
          payoutAzc: null,
          participants: [],
        },
      },
    }),
  );
  assert.match(html, /data-rolls-hub="waiting"/);
  assert.match(html, /Поставить/);
  assert.doesNotMatch(html, /Раунд завершён/);
  assert.doesNotMatch(html, /Идёт спин/);
  assert.match(html, /BobWin/);
  assert.doesNotMatch(html, />Вы</);
});

test("rolls winner modal uses live payout chance and nonce", () => {
  const html = renderToStaticMarkup(
    createElement(RollsWinnerModal, {
      round: {
        ...bettingPreview(1).round,
        roundId: "round-win",
        status: "resolved",
        nonce: "100434",
        totalPotAzc: "854",
        payoutAzc: "854",
        winnerParticipantId: "p1",
        participants: [
          {
            participantId: "p1",
            publicId: "u1",
            displayName: "alldepww",
            avatarKey: "https://example.test/a.png",
            avatarUrl: "https://example.test/a.png",
            stakeAzc: "100",
            joinedAt: new Date().toISOString(),
          },
        ],
      },
      winner: {
        participantId: "p1",
        publicId: "u1",
        displayName: "alldepww",
        avatarKey: "https://example.test/a.png",
        avatarUrl: "https://example.test/a.png",
        stakeAzc: "100",
        joinedAt: new Date().toISOString(),
      },
      onClose: () => undefined,
    }),
  );
  assert.match(html, /data-testid="rolls-win-modal"/);
  assert.match(html, /Игра #100434/);
  assert.match(html, /@alldepww/);
  assert.match(html, /11\.71%/);
  assert.match(html, /x8\.54/);
  assert.match(html, /Монеты/);
  assert.match(html, />Готово</);
  assert.doesNotMatch(html, /AZC/i);
});
