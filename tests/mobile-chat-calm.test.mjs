import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const messageRow = readFileSync(new URL("../app/components/message-row.tsx", import.meta.url), "utf8");
const reasoning = readFileSync(new URL("../app/components/reasoning-disclosure.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("../app/components/composer-dock.tsx", import.meta.url), "utf8");

test("mobile assistant prose uses a calmer compact type scale", () => {
  assert.match(messageRow, /navi-markdown text-\[0\.9375rem\]\/\[1\.45rem\]/);
});

test("mobile answer controls use progressive disclosure instead of five permanent buttons", () => {
  assert.match(messageRow, /MoreHorizontal/);
  assert.match(messageRow, /actionsOpen/);
  assert.match(messageRow, /hidden md:flex/);
});

test("engine metadata is not permanently duplicated on the phone", () => {
  assert.match(messageRow, /hidden md:flex[^\n]*items-center gap-2/);
});

test("reasoning disclosure is a compact inline affordance rather than a full-width card", () => {
  assert.match(reasoning, /my-1\.5/);
  assert.match(reasoning, /min-h-7/);
  assert.doesNotMatch(reasoning, /Thought about this/);
});

test("the composer disclaimer describes AI responses, not Navi Soul itself as AI", () => {
  assert.doesNotMatch(composer, /Navi Soul is AI/);
  assert.match(composer, /AI responses can make mistakes/);
});
