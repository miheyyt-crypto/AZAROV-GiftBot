import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TasksPage } from "../pages/TasksPage.js";

test("tasks page uses identity header and no card-level action buttons", () => {
  const html = renderToStaticMarkup(
    createElement(TasksPage, { token: "fixture", skipRemote: true }),
  );
  assert.match(html, /Игрок/);
  assert.doesNotMatch(html, />Задания</);
  assert.doesNotMatch(html, /DEV: Проверить/);
  assert.doesNotMatch(html, /task-card__cta/);
  assert.match(html, /Welvura/);
  assert.match(html, /welvura-banner/);
  assert.match(html, /\/assets\/welvura-cookie\.png/);
  assert.doesNotMatch(html, /AZC/);
  assert.doesNotMatch(html, /Tower|TOWER/);
  assert.doesNotMatch(html, /Закрытое сообщество/);

  const src = readFileSync(join(process.cwd(), "src/pages/TasksPage.tsx"), "utf8");
  assert.match(src, /className=\{`task-card/);
  assert.match(src, /onClick=\{\(\) => setOpenCode\(task\.code\)\}/);
  assert.match(src, /<WelvuraBanner state=\{welvura\}/);
  assert.doesNotMatch(src, /showPartners \? \([\s\S]*WelvuraBanner/);
  assert.doesNotMatch(src, /task-card__cta/);

  assert.match(html, /tasks-welvura-rule/);
  assert.match(src, /tasks-welvura-rule/);
  const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
  assert.match(css, /--motion-fast:\s*160ms/);
  assert.match(css, /--motion-sheet:\s*380ms/);
  assert.match(css, /\.tasks-welvura-rule/);
  assert.doesNotMatch(css, /mix-blend-mode:\s*lighten/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);

  const png = readFileSync(join(process.cwd(), "src/assets/welvura-cookie.png"));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png[25], 6);
});
