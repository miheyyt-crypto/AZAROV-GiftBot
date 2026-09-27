import assert from "node:assert/strict";
import { test } from "node:test";
import {
  splitWelvuraInstruction,
  welvuraLockedStatus,
} from "./welvura-copy.js";

test("splitWelvuraInstruction keeps policy as meta without rewriting rules", () => {
  const instruction =
    "Пополни счёт на 100 ₽ или больше и пришли скриншот вместе со своим ID. Засчитываются только новые депозиты начиная с 11 сентября. (Депозит учитывается только после подтверждённой привязки аккаунта)";
  const split = splitWelvuraInstruction(instruction);
  assert.equal(
    split.lead,
    "Пополни счёт на 100 ₽ или больше и пришли скриншот вместе со своим ID.",
  );
  assert.match(split.meta ?? "", /Засчитываются только новые депозиты начиная с 11 сентября/);
  assert.match(split.meta ?? "", /подтверждённой привязки/);
});

test("welvuraLockedStatus uses bind vs closed labels", () => {
  assert.equal(welvuraLockedStatus(false), "После привязки");
  assert.equal(welvuraLockedStatus(true), "Закрыто");
});
