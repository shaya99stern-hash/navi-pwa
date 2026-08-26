import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const calmCss = readFileSync(new URL("../app/mobile-chat-calm.css", import.meta.url), "utf8");
const reasoning = readFileSync(new URL("../app/components/reasoning-disclosure.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

test("mobile assistant prose uses a calmer compact type scale", () => {
  assert.match(calmCss, /article\[data-role="assistant"\] \.navi-markdown[\s\S]*font-size: 0\.9375rem;[\s\S]*line-height: 1\.45rem;/);
});

test("secondary answer controls no longer crowd every phone response", () => {
  assert.match(calmCss, /button\[aria-label="Good response"\][\s\S]*button\[aria-label="Bad response"\][\s\S]*button\[aria-label="Retry response"\][\s\S]*display: none;/);
  assert.match(calmCss, /button\[aria-label="Copy response"\][\s\S]*width: 32px;[\s\S]*height: 32px;/);
});

test("engine metadata is not permanently duplicated on the phone", () => {
  assert.match(calmCss, /img\[src="\/brand-spark\.png"\][\s\S]*display: none;/);
});

test("reasoning disclosure is a compact inline affordance rather than a full-width card", () => {
  assert.match(reasoning, /navi-reasoning-disclosure my-1\.5/);
  assert.match(reasoning, /min-h-7/);
  assert.doesNotMatch(reasoning, /Thought about this/);
});

test("the calm mobile stylesheet is loaded globally", () => {
  assert.match(layout, /import "\.\/mobile-chat-calm\.css";/);
});
