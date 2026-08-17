/* PATH: tests/fetch-redirects.test.ts
   Runs under the existing harness: `npm test` (tests/run.mjs). */

/**
 * The SSRF guard, checked past the first hop.
 *
 * `assertFetchableUrl` validates the URL it is handed and nothing after it.
 * With `redirect: "follow"`, everything after it was decided by whoever
 * answered: a public host returning 302 toward `169.254.169.254` is the
 * textbook way past a hostname check, and on a multi-hop crawl the later
 * addresses are ones no person ever chose.
 *
 * `connector-tools.ts` already refused redirects outright and its comment
 * explains why. The two fetchers disagreed and this was the permissive half —
 * the one a model points at arbitrary URLs.
 *
 * Refusing redirects here is not available: real pages redirect constantly for
 * http-to-https, trailing slashes and CDN edges, so a fetcher that rejects a
 * 301 cannot read the open web. Every hop is re-validated instead, and these
 * are the cases that distinguishes.
 */

const { readUrl } = require("../lib/ai/web-tools") as typeof import("../lib/ai/web-tools");

let pass = 0, fail = 0;
const check = (n: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : `\n   got:  ${JSON.stringify(a)}\n   want: ${JSON.stringify(e)}`}`);
};

const realFetch = globalThis.fetch;
/** Serves a scripted map of url → response, so no test touches the network. */
function stubFetch(routes: Record<string, () => Response>) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const make = routes[url];
    if (!make) throw new Error(`unexpected fetch: ${url}`);
    return make();
  }) as typeof fetch;
}
const redirectTo = (location: string) => () => new Response(null, { status: 302, headers: { location } });
const html = (body: string) => () => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

async function main() {
  /* ---- A redirect into private space is refused ------------------------- */

  /* The whole reason this exists. The user's URL is a perfectly ordinary
     public address; the hop it points at is cloud instance metadata. */
  stubFetch({
    "https://ok.example/start": redirectTo("https://169.254.169.254/latest/meta-data/"),
    "https://169.254.169.254/latest/meta-data/": html("<p>credentials</p>")
  });
  const metadata = await readUrl("https://ok.example/start");
  check("a redirect toward link-local metadata is blocked", metadata.ok, false);
  check("and never reaches the private host",
    !metadata.ok && metadata.guidance.includes("redirected"), true);
  check("reported as a redirect, not as a bad link the user typed",
    !metadata.ok && metadata.reason, "blocked");

  stubFetch({
    "https://ok.example/lan": redirectTo("https://192.168.1.1/admin"),
    "https://192.168.1.1/admin": html("<p>router</p>")
  });
  check("a redirect onto the local network is blocked", (await readUrl("https://ok.example/lan")).ok, false);

  /* Downgrade to http is refused for the same reason it is on the first hop. */
  stubFetch({
    "https://ok.example/downgrade": redirectTo("http://ok.example/plain"),
    "http://ok.example/plain": html("<p>plain</p>")
  });
  check("a redirect that downgrades to http is blocked", (await readUrl("https://ok.example/downgrade")).ok, false);

  /* ---- Ordinary redirects still work ------------------------------------ */

  /* The constraint that rules out simply refusing 3xx: this is what the open
     web does on nearly every request. */
  stubFetch({
    "https://ok.example/old": redirectTo("https://ok.example/new"),
    "https://ok.example/new": html("<h1>Arrived</h1><p>Body text.</p>")
  });
  const moved = await readUrl("https://ok.example/old");
  check("a normal redirect is followed", moved.ok, true);
  check("and the destination's content is what comes back",
    moved.ok && moved.text.includes("Body text."), true);

  /* Relative links belong to the host that served the body, not the one that
     was asked. Resolving against the original points every link at the wrong
     site — silently, and only on redirected pages. */
  stubFetch({
    "https://asked.example/go": redirectTo("https://served.example/page.html"),
    "https://served.example/page.html": html(`<p><a href="/next">next</a></p>`)
  });
  const rebased = await readUrl("https://asked.example/go");
  check("relative links resolve against the host that actually served the page",
    rebased.ok && /\(https:\/\/served\.example\/next\)/.test(rebased.text), true);

  /* ---- The chain is bounded --------------------------------------------- */

  stubFetch({
    "https://loop.example/1": redirectTo("https://loop.example/2"),
    "https://loop.example/2": redirectTo("https://loop.example/3"),
    "https://loop.example/3": redirectTo("https://loop.example/4"),
    "https://loop.example/4": redirectTo("https://loop.example/5"),
    "https://loop.example/5": redirectTo("https://loop.example/6"),
    "https://loop.example/6": redirectTo("https://loop.example/7"),
    "https://loop.example/7": html("<p>never</p>")
  });
  const looped = await readUrl("https://loop.example/1");
  check("an endless redirect chain is refused rather than followed", looped.ok, false);
  check("and says so plainly", !looped.ok && /redirected more than/.test(looped.guidance), true);

  /* A 3xx with no Location is the server's final answer, not a hop. */
  stubFetch({ "https://ok.example/nowhere": () => new Response(null, { status: 302 }) });
  check("a redirect with no destination is treated as the response",
    (await readUrl("https://ok.example/nowhere")).ok, false);

  globalThis.fetch = realFetch;
  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}

main().catch((error) => { globalThis.fetch = realFetch; console.error(error); process.exit(1); });

export {};
