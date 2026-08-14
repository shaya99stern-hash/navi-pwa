/* PATH: lib/ai/navi-soul/local-processor.ts  — NEW FILE, copy verbatim.
   Replaces src/navisoul-intrinsics/local-processor.js, which must be deleted. */

/**
 * The work Navi Soul can finish without a model.
 *
 * The version this replaces evaluated arithmetic with
 * `Function('"use strict";return (' + query + ')')()` — which is `eval` by
 * another name. Anything a user typed into the composer ran as code with the
 * page's privileges, so "1+1" and `fetch(document.cookie)` took the same path.
 * The regex in front of it was the only guard, and a guard in front of an
 * evaluator is a guard you have to be right about every time.
 *
 * So arithmetic is parsed rather than executed: a tokeniser, a shunting-yard
 * pass, and a stack machine over numbers. Nothing here can call anything.
 */

export type LocalResult =
  | { handledLocally: true; response: string; kind: "compute" | "command" }
  | { handledLocally: false };

const NOT_HANDLED: LocalResult = { handledLocally: false };

/** Only these characters may appear in something treated as arithmetic. */
const ARITHMETIC = /^[\d\s+\-*/%^().]+$/;

type Token = { type: "number"; value: number } | { type: "op"; value: string } | { type: "paren"; value: "(" | ")" };

const PRECEDENCE: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3, "u-": 4 };
const RIGHT_ASSOCIATIVE = new Set(["^", "u-"]);

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let at = 0;
  while (at < input.length) {
    const char = input[at];
    if (/\s/.test(char)) { at += 1; continue; }
    if (/[\d.]/.test(char)) {
      let end = at;
      while (end < input.length && /[\d.]/.test(input[end])) end += 1;
      const slice = input.slice(at, end);
      /* "1.2.3" is not a number, and a tokeniser that shrugs at it produces a
         confident wrong answer rather than a miss. */
      if ((slice.match(/\./g) ?? []).length > 1) return null;
      const value = Number(slice);
      if (!Number.isFinite(value)) return null;
      tokens.push({ type: "number", value });
      at = end;
      continue;
    }
    if (char === "(" || char === ")") { tokens.push({ type: "paren", value: char }); at += 1; continue; }
    if ("+-*/%^".includes(char)) {
      const previous = tokens[tokens.length - 1];
      const unary = char === "-" && (!previous || previous.type === "op" || (previous.type === "paren" && previous.value === "("));
      tokens.push({ type: "op", value: unary ? "u-" : char });
      at += 1;
      continue;
    }
    return null;
  }
  return tokens.length ? tokens : null;
}

function toPostfix(tokens: Token[]): Token[] | null {
  const output: Token[] = [];
  const stack: Token[] = [];
  for (const token of tokens) {
    if (token.type === "number") { output.push(token); continue; }
    if (token.type === "op") {
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.type !== "op") break;
        const higher = PRECEDENCE[top.value] > PRECEDENCE[token.value];
        const equal = PRECEDENCE[top.value] === PRECEDENCE[token.value] && !RIGHT_ASSOCIATIVE.has(token.value);
        if (!higher && !equal) break;
        output.push(stack.pop() as Token);
      }
      stack.push(token);
      continue;
    }
    if (token.value === "(") { stack.push(token); continue; }
    let matched = false;
    while (stack.length) {
      const top = stack.pop() as Token;
      if (top.type === "paren" && top.value === "(") { matched = true; break; }
      output.push(top);
    }
    if (!matched) return null;
  }
  while (stack.length) {
    const top = stack.pop() as Token;
    if (top.type === "paren") return null;
    output.push(top);
  }
  return output;
}

function evaluatePostfix(postfix: Token[]): number | null {
  const stack: number[] = [];
  for (const token of postfix) {
    if (token.type === "number") { stack.push(token.value); continue; }
    if (token.type !== "op") return null;
    if (token.value === "u-") {
      const operand = stack.pop();
      if (operand === undefined) return null;
      stack.push(-operand);
      continue;
    }
    const right = stack.pop();
    const left = stack.pop();
    if (right === undefined || left === undefined) return null;
    switch (token.value) {
      case "+": stack.push(left + right); break;
      case "-": stack.push(left - right); break;
      case "*": stack.push(left * right); break;
      /* Division by zero is Infinity in JavaScript and a mistake in an answer.
         Returning null makes it a miss, and a miss goes to the model. */
      case "/": if (right === 0) return null; stack.push(left / right); break;
      case "%": if (right === 0) return null; stack.push(left % right); break;
      case "^": stack.push(left ** right); break;
      default: return null;
    }
  }
  return stack.length === 1 && Number.isFinite(stack[0]) ? stack[0] : null;
}

/** True when the whole query is arithmetic and contains an actual operation. */
export function isBasicMath(query: string): boolean {
  const text = query.trim();
  if (!text || text.length > 200) return false;
  if (!ARITHMETIC.test(text)) return false;
  /* A bare number is not a calculation, and answering "7" with "7" reads as the
     app being broken. */
  return /[+\-*/%^]/.test(text.slice(1));
}

/**
 * Present a result the way a person wrote the sum.
 *
 * Floating point makes `0.1 + 0.2` into `0.30000000000000004`, which is
 * correct and useless. Twelve significant digits is past any precision a
 * composer sum carries and short of where the representation shows through.
 */
function present(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const rounded = Number(value.toPrecision(12));
  return String(rounded);
}

export function calculate(query: string): LocalResult {
  if (!isBasicMath(query)) return NOT_HANDLED;
  const tokens = tokenize(query.trim());
  if (!tokens) return NOT_HANDLED;
  const postfix = toPostfix(tokens);
  if (!postfix) return NOT_HANDLED;
  const value = evaluatePostfix(postfix);
  if (value === null) return NOT_HANDLED;
  return { handledLocally: true, response: `${query.trim()} = ${present(value)}`, kind: "compute" };
}

export const LOCAL_COMMANDS = ["/ping", "/status", "/models", "/clear", "/help"] as const;
export type LocalCommand = (typeof LOCAL_COMMANDS)[number];

export function isSystemCommand(query: string): boolean {
  return (LOCAL_COMMANDS as readonly string[]).includes(query.trim().toLowerCase());
}

/**
 * Answer a slash command from what is true here, not from a script.
 *
 * The version this replaces answered `/models` with a fixed string naming
 * "5.6 Ultra" and "Hugging Face endpoints standing by" — a claim about routing
 * that no part of the app checked, and exactly the kind of thing the
 * constitution's first rule forbids. A command that reports state takes the
 * state as an argument or does not report it.
 */
export function executeSystemCommand(query: string, state: { routes?: string[]; version?: string; online?: boolean } = {}): LocalResult {
  switch (query.trim().toLowerCase() as LocalCommand) {
    case "/ping":
      return { handledLocally: true, kind: "command", response: state.online === false ? "Offline. Saved chats stay available on this device." : "Online." };
    case "/status":
      return {
        handledLocally: true,
        kind: "command",
        response: [
          state.version ? `Version ${state.version}.` : "",
          state.online === false ? "Offline." : "Online.",
          state.routes?.length ? `${state.routes.length} route${state.routes.length === 1 ? "" : "s"} available.` : "Route availability unknown from here."
        ].filter(Boolean).join(" ")
      };
    case "/models":
      /* No route list means no claim about routes. */
      return state.routes?.length
        ? { handledLocally: true, kind: "command", response: `Available: ${state.routes.join(", ")}.` }
        : NOT_HANDLED;
    case "/help":
      return { handledLocally: true, kind: "command", response: `Answered on device: ${LOCAL_COMMANDS.join(", ")}, and plain arithmetic.` };
    /* `/clear` is the client's to perform — it owns the conversation — so it is
       recognised as a command and deliberately not answered as text. */
    default:
      return NOT_HANDLED;
  }
}
