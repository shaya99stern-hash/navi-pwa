import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const calmCss = readFileSync(new URL("../app/chat-calm.css", import.meta.url), "utf8");
const reasoning = readFileSync(new URL("../app/components/reasoning-disclosure.tsx", import.meta.url), "utf8");
const composerCss = readFileSync(new URL("../app/home-composer-reference.css", import.meta.url), "utf8");

test("mobile assistant prose is deliberately smaller than the old 16px treatment", () => {
  assert.match(calmCss, /article\[data-role="assistant"\] \.navi-markdown[\s\S]*font-size:\s*15px !important/);
});

test("mobile response actions keep only the two highest-value controls visible", () => {
  assert.match(calmCss, /button:nth-child\(n \+ 3\)[\s\S]*display:\s*none/);
});

test("provider metadata is removed from the resting mobile thread", () => {
  assert.match(calmCss, /article\[data-role="assistant"\][\s\S]*ml-2\.5[\s\S]*display:\s*none/);
});

test("finished reasoning is a quiet disclosure instead of a full-width card", () => {
  assert.match(reasoning, /navi-reasoning-disclosure/);
  assert.match(reasoning, /streaming \? "Thinking…" : "Thought"/);
  assert.doesNotMatch(reasoning, /Thought about this/);
});

test("calm chat stylesheet is loaded by the composer reference layer", () => {
  assert.match(composerCss, /^@import "\.\/chat-calm\.css";/);
});
