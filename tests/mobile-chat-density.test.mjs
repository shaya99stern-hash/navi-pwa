import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n   got:  ${JSON.stringify(actual)}\n   want: ${JSON.stringify(expected)}`}`);
};

const root = process.cwd();
const layout = readFileSync(join(root, "app/layout.tsx"), "utf8");
const engine = readFileSync(join(root, "app/components/engine-note.tsx"), "utf8");
const densityPath = join(root, "app/mobile-chat-density.css");
const density = existsSync(densityPath) ? readFileSync(densityPath, "utf8") : "";

check("the mobile chat density layer is imported", layout.includes('import "./mobile-chat-density.css";'), true);
check("assistant prose is deliberately smaller on phones", /article\[data-role=["']assistant["']\][\s\S]*?\.navi-markdown[\s\S]*?font-size:\s*15px/.test(density), true);
check("assistant prose keeps a comfortable compact line height", /\.navi-markdown[\s\S]*?line-height:\s*1\.45rem/.test(density), true);
check("rating controls are hidden on phones", density.includes('button[aria-label="Good response"]') && density.includes('button[aria-label="Bad response"]') && density.includes("display: none"), true);
check("engine notes expose a stable styling hook", engine.includes('data-engine-note=""'), true);
check("engine metadata is quiet on phones", density.includes('span[data-engine-note]') && density.includes(":has("), true);
check("reasoning disclosure is visually compact", density.includes("button[aria-expanded]") && density.includes("min-height: 32px"), true);
check("non-critical composer status text is hidden on phones", density.includes('.navi-composer-dock [role="status"] > span.text-tertiary'), true);
check("composer keeps 44px touch targets", density.includes("44px"), true);
check("composer height is reduced without changing empty-vs-active geometry", density.includes("min-height: 136px") && density.includes('.navi-composer[data-home]'), true);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);

export {};
