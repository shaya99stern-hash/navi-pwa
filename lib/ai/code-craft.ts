/**
 * A crash course in writing code the way this codebase is written.
 *
 * The engineering brief next door teaches *conduct* — read before you write,
 * send the whole file, do not claim a commit you did not make. Conduct is not
 * competence. This teaches the craft itself: how to think about a change
 * before typing, what the type system is for, how React state and effects
 * actually behave, what Edge and Node runtimes each forbid, and the specific
 * bug shapes that have bitten this repository before.
 *
 * Written as instruction with worked examples rather than as a style guide,
 * because a model does not need to be told that consistent naming is nice — it
 * needs to be shown the wrong version, the right version, and why the wrong
 * one looks correct until it ships.
 *
 * Loaded only alongside the repository tools, on the small fraction of turns
 * that can actually change the app.
 */
export const CODE_CRAFT = `## Writing code in this codebase

This is a Next.js App Router application: React 19, TypeScript in strict mode,
Tailwind for styling, the Vercel AI SDK for model calls, and route handlers
split between the Edge and Node runtimes. What follows is how to write in it
well, not merely legally.

### Think in terms of the defect, not the request

Before typing, answer three questions. Skipping them is what produces changes
that look right and are wrong.

1. **What is the actual mechanism?** "The button does nothing" is a symptom.
   The mechanism is a handler that is never attached, a state update that is
   overwritten, an event that fires and is cancelled a moment later, a guard
   that returns early. Find the mechanism. If you cannot name it, you are
   guessing, and a guess committed is a regression shipped.
2. **Why was it written this way?** Odd-looking code is usually load-bearing.
   A ref that mirrors a prop, a check that seems redundant, a deliberately
   non-obvious ordering — each is likely a fix for something. This codebase
   comments those reasons; read the comment before you delete the line.
3. **What else touches this?** A component's props have callers. An exported
   function has importers. A stored preference has a type, a default, a
   normaliser, and a UI row. Change one and the others are now wrong.

### TypeScript: the type is the design

Types here are not decoration for the compiler. They are how the shape of the
data is stated once so it cannot drift.

**Never reach for an escape hatch.** \`any\`, \`as unknown as\`, \`!\`, and
\`@ts-ignore\` do not fix an error; they hide it until runtime. If the types
resist you, the design is telling you the shape is wrong.

    // Wrong: silences the compiler, crashes at runtime when the array is empty.
    const first = (items as any[])[0]!;

    // Right: the emptiness is part of the type, so the caller must handle it.
    const first = items[0];
    if (!first) return null;

**Model states as unions, not as loose booleans.** Independent booleans permit
combinations that cannot exist, and every one of those is a bug waiting.

    // Wrong: loading and error can both be true. What renders then?
    type State = { loading: boolean; error: string | null; data: Data | null };

    // Right: exactly one state at a time, and the compiler enforces it.
    type State =
      | { phase: "idle" }
      | { phase: "loading" }
      | { phase: "error"; message: string }
      | { phase: "ready"; data: Data };

**Narrow at the boundary.** Anything arriving from a network call, a request
body, or storage is \`unknown\` until proven otherwise. Validate it once, at the
edge, and let the rest of the code work with a real type.

    const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
    const path = typeof body?.path === "string" ? body.path.trim() : "";
    if (!path) return NextResponse.json({ error: "A path is required." }, { status: 400 });

**Prefer a discriminated result to a thrown error** when failure is ordinary
rather than exceptional. A tool that returns \`{ ok: false, error }\` composes;
one that throws forces every caller into a try/catch.

### React: state, effects, and the traps

**State is a snapshot.** A closure captures the value from the render that
created it. This is the single most common source of "it works, but with stale
data" — a callback created while listening reads the draft as it was then.

    // Wrong: 'value' is whatever it was when the listener was attached.
    onFinal: (text) => onChange(value + text);

    // Right: a ref always holds the current value.
    const valueRef = useRef(value);
    valueRef.current = value;
    onFinal: (text) => onChange(valueRef.current + text);

**Updater form when the next value depends on the last.** Two updates in one
tick with the direct form lose one of them.

    setItems((current) => [...current, added]);   // right
    setItems([...items, added]);                  // wrong under batching

**Every effect that subscribes must unsubscribe.** Listeners, intervals,
observers, media streams, AudioContexts. A missing cleanup is not a leak you
can ignore on a phone — a live MediaStream keeps the microphone indicator lit
after recording ends, which looks exactly like spying.

    useEffect(() => {
      const timer = window.setInterval(tick, 250);
      return () => window.clearInterval(timer);
    }, [dependency]);

**Effects are for synchronising with something outside React** — the DOM, a
subscription, a network resource. Anything derivable from props or state
should be computed during render instead. An effect that sets state from other
state causes a second render and a flash of the wrong value.

**Dependency arrays are a contract, not a formality.** Omitting a dependency
freezes an old value inside the effect. If a dependency changes too often,
stabilise it with \`useCallback\` or a ref — do not lie in the array.

**Keys must be stable identity, never an index.** An index key makes React
reuse the wrong DOM node when the list reorders, which shows up as input text
appearing in the wrong row.

**Guard against a resolved promise arriving after unmount**, or you set state
on a component that no longer exists.

    useEffect(() => {
      let cancelled = false;
      void load().then((result) => { if (!cancelled) setData(result); });
      return () => { cancelled = true; };
    }, []);

### Events and gestures on a phone

Pointer events fire in a sequence, and a tap is the whole sequence in a few
milliseconds. Starting an action on \`pointerdown\` and ending it on
\`pointerup\` means a tap starts and immediately ends it — this exact pattern
made the microphone button do nothing at all. If an action should persist,
toggle it on \`click\`. Reserve press-and-hold for cases where holding is the
whole point, and then handle \`pointercancel\`, because a scroll cancels the
gesture.

Touch targets are at least 44 pixels. Buttons inside a form default to
\`type="submit"\`; write \`type="button"\` unless submitting is what you want.

### Next.js: server and client, Edge and Node

**Server components are the default.** \`"use client"\` is required for
anything using state, effects, refs, browser APIs, or event handlers. Adding
it to a large component pushes everything it imports into the browser bundle,
so put the boundary as low in the tree as it will go.

**Route handlers declare a runtime, and the runtime decides what exists.**

- Edge: fast to start, but no Node built-ins — no \`Buffer\`, no \`fs\`, no
  \`node:\` imports. Use \`TextEncoder\`/\`TextDecoder\` and Web APIs. Note that
  \`atob\`/\`btoa\` mangle multi-byte characters, so an em dash survives a round
  trip only if you encode through \`TextEncoder\` first.
- Node: everything available, slower cold start, needed for SDKs that reach
  for Node internals.

Do not import a Node-only module into an Edge route to "reuse" it. The build
error reads like a missing dependency and costs an hour. Put the capability
behind its own Node route and call it over HTTP — that is why this codebase
already has one.

**\`import "server-only\`" at the top of a module makes importing it from the
browser a build error rather than a leak.** Every module holding a credential
must have it.

**Reads and writes are guarded differently.** A mutation guard also requires an
\`Origin\` header as a CSRF defence, and browsers do not send \`Origin\` on a
same-origin GET — putting a mutation guard on a read refuses every honest
call. Use the read guard for reads.

### Async: timeouts, aborts, and partial failure

Every outbound request needs a timeout. A fetch with no deadline can hold a
serverless function until the platform kills it, and the user sees a spinner
that never resolves.

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

**Run independent work in parallel**, and let one failure cost only its own
result. Three sequential awaits that do not depend on each other are three
round trips where one would do.

    const [chats, facts, skills] = await Promise.all([
      listChats(token).catch(() => []),
      listFacts(token).catch(() => []),
      listSkills(token).catch(() => [])
    ]);

**Never swallow an error silently.** Either handle it meaningfully, degrade to
something honest, or let it surface. \`catch {}\` with an empty body is how a
feature stops working and nobody finds out for a month.

### Errors the user actually reads

An error message has one job: say what to do next.

    // Useless: true, and no help at all.
    "An error occurred."

    // Useful: what failed, why, and the next action.
    "The endpoint answered but rejected the key. Check the credential."

Name the missing environment variable when one is missing. Distinguish "not
configured" from "temporarily failed" — telling someone to retry something
that can never succeed until they redeploy sends them in a circle.

### Styling

Tailwind utilities, in the existing order and idiom. Colours come from the CSS
custom properties already defined (\`text-primary\`, \`bg-elev-2\`,
\`border-[var(--border-subtle)]\`) — never a raw hex, or it will be wrong in one
of the two themes. Respect the safe-area variables on anything near a screen
edge. Assume a narrow phone: a row of controls must not overflow, and long
text needs \`truncate\` or \`min-w-0\` on the flex child.

### Comments

Comment the *why*. The code already says what it does.

    // Wrong: restates the line.
    // Set loading to true
    setLoading(true);

    // Right: explains a decision that is not visible from the code.
    /* Read through the ref rather than the prop: the callback closes over the
       value from the render that started listening, so appending through the
       prop dropped anything typed while the microphone was open. */

When fixing a bug, record the defect in the comment. The next person to read
that line will otherwise "simplify" it straight back into the bug.

### Tests

Tests here are plain scripts that print PASS/FAIL and exit non-zero — no
framework. Add cases to the file that already covers the area. Test the
behaviour that broke, name the test after the guarantee rather than the
function, and write the comment explaining what defect it prevents. A test
named "returns true" tells a future reader nothing.

### The bug shapes that have actually shipped here

- A tap handler split across \`pointerdown\` and \`pointerup\`, so a tap did
  nothing.
- A CSRF guard on a GET, refusing every same-origin read.
- A closure reading a stale prop instead of a ref.
- A fixed budget assumed for a value that grows, so a check passed and the
  real limit was still exceeded.
- Attachments replayed on every turn forever, uploading megabytes per message.
- Behaviour keyed to a classifier's guess rather than to the user's explicit
  choice, so a mode switch changed nothing.
- A payload parsed strictly when the producer is a model, so anything slightly
  off became an error instead of being repaired.
- A screen shipped with no navigation to it, so the feature did not exist.

Each looked correct in the diff. What they share is an assumption that was
never checked against the thing it assumed. Check the assumption.`;

/**
 * Gated identically to the engineering brief: both are for turns that can
 * actually change the app, and neither is worth a token on any other turn.
 */
export function needsCodeCraft(selfUpdateActive: boolean): boolean {
  return selfUpdateActive;
}
