import { buildGoogleTools } from "../lib/ai/google-tools";
import {
  GOOGLE_SCOPES_READ,
  GOOGLE_SCOPES_WRITE,
  buildGoogleAuthorizeUrl,
  decodeBase64Url,
  encodeRfc822,
  googleOAuthConfigured,
  googleScopes,
  googleWritesEnabled
} from "../lib/google/oauth";

let pass = 0, fail = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n   got:  ${JSON.stringify(actual)}\n   want: ${JSON.stringify(expected)}`}`);
};

async function main() {
  /* ---- Scopes -------------------------------------------------------- */

  check("reads cover mail", GOOGLE_SCOPES_READ.includes("gmail.readonly"), true);
  check("reads cover the calendar", GOOGLE_SCOPES_READ.includes("calendar.readonly"), true);
  /* The whole point of the read set. Requesting compose by default would put
     every user through a consent screen asking to send mail on their behalf in
     order to answer "what did she say about Thursday". */
  check("reads cannot compose", GOOGLE_SCOPES_READ.includes("gmail.compose"), false);
  check("reads cannot write the calendar", GOOGLE_SCOPES_READ.includes("calendar.events"), false);
  check("writes add compose", GOOGLE_SCOPES_WRITE.includes("gmail.compose"), true);
  check("writes add calendar events", GOOGLE_SCOPES_WRITE.includes("calendar.events"), true);
  check("writes keep reading", GOOGLE_SCOPES_WRITE.includes("gmail.readonly"), true);

  delete process.env.NAVI_GOOGLE_ALLOW_WRITES;
  check("writes are off by default", googleWritesEnabled(), false);
  check("the default scope set is the read set", googleScopes(), GOOGLE_SCOPES_READ);
  process.env.NAVI_GOOGLE_ALLOW_WRITES = "true";
  check("the switch selects the write set", googleScopes(), GOOGLE_SCOPES_WRITE);
  process.env.NAVI_GOOGLE_ALLOW_WRITES = "yes";
  check("only the exact string counts", googleWritesEnabled(), false);
  delete process.env.NAVI_GOOGLE_ALLOW_WRITES;

  /* ---- Configuration -------------------------------------------------- */

  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  check("absent credentials read as unconfigured", googleOAuthConfigured(), false);
  process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id.apps.googleusercontent.com";
  check("half a credential is still unconfigured", googleOAuthConfigured(), false);
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
  check("both halves configure it", googleOAuthConfigured(), true);
  process.env.GOOGLE_OAUTH_CLIENT_ID = "   ";
  check("whitespace is not a credential", googleOAuthConfigured(), false);
  process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id.apps.googleusercontent.com";

  /* ---- The authorize URL ---------------------------------------------- */

  const authorize = new URL(buildGoogleAuthorizeUrl("state-token", "https://navikeep.org/api/google/oauth/callback"));
  check("it points at Google", authorize.origin + authorize.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  check("the state is carried", authorize.searchParams.get("state"), "state-token");
  check("the redirect is carried", authorize.searchParams.get("redirect_uri"), "https://navikeep.org/api/google/oauth/callback");
  check("a code is requested", authorize.searchParams.get("response_type"), "code");
  /* These two are the refresh-token trap. Without `offline` the grant expires
     in an hour; without `consent` Google silently omits the refresh token on
     every authorization after the first, so the connection works once and then
     breaks for no visible reason. */
  check("offline access is requested", authorize.searchParams.get("access_type"), "offline");
  check("consent is forced", authorize.searchParams.get("prompt"), "consent");

  /* ---- Message encoding ------------------------------------------------ */

  const raw = encodeRfc822({ to: "a@b.com", subject: "Hello", body: "Line one\nLine two" });
  check("the encoding is base64url", /^[A-Za-z0-9_-]+$/.test(raw), true);
  const decoded = decodeBase64Url(raw);
  check("the recipient survives", decoded.includes("To: a@b.com"), true);
  check("the subject survives", decoded.includes("Subject: Hello"), true);
  check("the body survives", decoded.includes("Line one\nLine two"), true);
  check("headers end with a blank line", decoded.includes("\r\n\r\n"), true);

  const withCc = decodeBase64Url(encodeRfc822({ to: "a@b.com", subject: "S", body: "B", cc: "c@d.com" }));
  check("a cc appears when given", withCc.includes("Cc: c@d.com"), true);
  check("no empty cc header when omitted", decoded.includes("Cc:"), false);

  /* A non-ASCII subject threw on the way in before the body went through
     TextEncoder, because btoa rejects code points above 255. */
  const unicode = decodeBase64Url(encodeRfc822({ to: "a@b.com", subject: "Café — naïve", body: "שלום" }));
  check("a non-ASCII subject survives", unicode.includes("Café — naïve"), true);
  check("a non-Latin body survives", unicode.includes("שלום"), true);

  check("undecodable input yields nothing rather than throwing", decodeBase64Url("!!!not base64!!!"), "");

  /* ---- Which tools exist ----------------------------------------------- */

  check("no token means no tools", Object.keys(buildGoogleTools()), []);
  check("an empty token means no tools", Object.keys(buildGoogleTools(undefined, { accessToken: "  " })), []);

  delete process.env.NAVI_GOOGLE_ALLOW_WRITES;
  const readOnly = Object.keys(buildGoogleTools(undefined, { accessToken: "token" })).sort();
  check("reading mail is offered", readOnly.includes("gmail_search"), true);
  check("opening a message is offered", readOnly.includes("gmail_read"), true);
  check("the calendar is readable", readOnly.includes("calendar_list_events"), true);
  /* Deliberate: a draft is reversible and stays inside the account, so the
     useful half of composing survives with writes off. */
  check("drafting is offered without writes", readOnly.includes("gmail_draft"), true);
  check("sending is not", readOnly.includes("gmail_send"), false);
  check("calendar writes are not", readOnly.includes("calendar_create_event"), false);

  process.env.NAVI_GOOGLE_ALLOW_WRITES = "true";
  const withWrites = Object.keys(buildGoogleTools(undefined, { accessToken: "token" })).sort();
  check("sending appears with writes", withWrites.includes("gmail_send"), true);
  check("calendar writes appear", withWrites.includes("calendar_create_event"), true);
  check("reads are unaffected", withWrites.includes("gmail_search"), true);
  delete process.env.NAVI_GOOGLE_ALLOW_WRITES;

  /* Every tool the model sees needs a description it can route on, and the
     send tool has to say plainly that it cannot be undone. */
  const tools = buildGoogleTools(undefined, { accessToken: "token" });
  check(
    "every tool describes itself",
    Object.values(tools).every((tool: any) => typeof tool.description === "string" && tool.description.length > 40),
    true
  );
  check(
    "drafting says nothing is sent",
    /nothing is sent/i.test((tools.gmail_draft as any).description),
    true
  );

  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}

main().then(() => {}).catch((error) => {
  console.error(error);
  process.exit(1);
});
