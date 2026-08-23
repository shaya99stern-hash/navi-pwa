import type { Metadata, Viewport } from "next";
import { Source_Serif_4, Inter, JetBrains_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import {
  getClerkPublishableKey,
  getNaviAuthCanonicalOrigin,
  hasClerkUserAllowlist,
  isClerkConfigured,
  isClerkUserAllowed
} from "@/lib/auth/config";
import {
  CLERK_CLIENT_UAT_COOKIE_NAME,
  CLERK_SESSION_COOKIE_NAME,
  resolveClerkSession
} from "@/lib/auth/session";
import { SPLASH_SCREENS } from "@/lib/ui/splash-screens";
import "./globals.css";
import "./shell.css";
import { GlobalPwaPlatformBanner } from "./components/pwa-platform-banner";
import { ViewportMetrics } from "./components/viewport-metrics";
import PWARegister from "./pwa-register";
import WebVitals from "./web-vitals";

const displaySerif = Source_Serif_4({
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-display"
});

const sans = Inter({
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-sans"
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-mono"
});

const siteUrl = getNaviAuthCanonicalOrigin() ?? "https://navisonnet.vercel.app";

async function buildMetadata(): Promise<Metadata> {
  const theme = await readThemeCookie();
  return {
    metadataBase: new URL(siteUrl),
    applicationName: "NaviOS",
    title: {
      default: "NaviOS — Private AI Workspace",
      template: "%s · NaviOS"
    },
    description: "A private, local-first AI workspace for conversations, files, images, interactive tools, and long-running projects.",
    manifest: "/manifest.webmanifest",
    alternates: {
      canonical: "/"
    },
    keywords: ["NaviOS", "Navi Soul", "AI workspace", "AI assistant", "private AI", "PWA"],
    formatDetection: {
      telephone: false,
      address: false,
      email: false
    },
    /* iOS reads this once at launch and ignores later mutation, so it has to be rendered per request. black-translucent draws white glyphs, which vanish against the ivory light theme; default keeps them dark. */
    appleWebApp: {
      capable: true,
      title: "NaviOS",
      statusBarStyle: theme === "light" ? "default" : "black-translucent"
    },
    icons: {
      icon: [{ url: "/pwa-icon-192-v5.png", type: "image/png", sizes: "192x192" }],
      apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }]
    },
    openGraph: {
      type: "website",
      url: siteUrl,
      siteName: "NaviOS",
      title: "NaviOS — Private AI Workspace",
      description: "Conversations, files, images, tools, and multi-provider AI in one installable workspace.",
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "NaviOS private AI workspace" }]
    },
    twitter: {
      card: "summary_large_image",
      title: "NaviOS — Private AI Workspace",
      description: "Conversations, files, images, tools, and multi-provider AI in one installable workspace.",
      images: ["/opengraph-image"]
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large"
      }
    }
  };
}

export function generateMetadata(): Promise<Metadata> {
  return buildMetadata();
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  /* Chromium shrinks the layout viewport instead of overlaying the keyboard, so the fixed shell lands above it with no scripting. iOS ignores this today — visualViewport in ViewportMetrics covers iOS — but declaring it costs nothing and fixes Android outright. Deliberately no maximum-scale or user-scalable: iOS ignores both and they break pinch-zoom for low-vision users. The 16px floor in globals.css is the real zoom fix. */
  interactiveWidget: "resizes-content",
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#121214" },
    /* `--bg-page`, not `--bg-app`. The page is what sits behind the status
       bar, and declaring the app surface instead put a visible band along the
       top edge in light mode. */
    { media: "(prefers-color-scheme: light)", color: "#F0EEE6" }
  ]
};

export const THEME_COOKIE_NAME = "navi.theme";

/** The status bar style is baked in at launch, so the server needs the theme. */
async function readThemeCookie(): Promise<"dark" | "light"> {
  const value = (await cookies()).get(THEME_COOKIE_NAME)?.value;
  return value === "light" ? "light" : "dark";
}

/* The cookie is authoritative because the server rendered against it; mirror it back into localStorage so existing readers stay in sync. */

/**
 * Matches the app's root size to iOS Dynamic Type.
 *
 * Only the -apple-system-body shorthand resolves to the size the user chose in
 * Settings, and CSS cannot clamp a font shorthand, so the value is measured and
 * bounded here. The cap is deliberate: controls, sheets and the composer have
 * fixed heights, so unbounded growth would clip text rather than reflow it.
 * Runs before paint, so there is no jump from one size to another.
 */
const dynamicTypeBootScript = `
try {
  // The auth pages are Clerk's layout, not ours, and it measures its own boxes
  // against a 16px root. Scaling underneath it clips its field labels.
  if (/^\\/(sign-in|sign-up)(\\/|$)/.test(location.pathname)) throw 0;
  var probe = document.createElement('div');
  probe.className = 'navi-type-probe';
  document.documentElement.appendChild(probe);
  var body = parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  if (body && body > 16) {
    document.documentElement.style.fontSize = Math.min(body, 20) + 'px';
  }
} catch {}
`;

const themeBootScript = `
try {
  var cookie = document.cookie.match(/(?:^|; )navi\\.theme=([^;]*)/);
  var theme = cookie ? decodeURIComponent(cookie[1]) : (localStorage.getItem('navi.theme.v3') || 'dark');
  if (theme !== 'light' && theme !== 'dark') theme = 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('navi.theme.v3', theme);
} catch {}
`;

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const clerkConfigured = isClerkConfigured();
  const cookieStore = clerkConfigured ? await cookies() : undefined;
  const sessionToken = cookieStore?.get(CLERK_SESSION_COOKIE_NAME)?.value;
  const clientUat = cookieStore?.get(CLERK_CLIENT_UAT_COOKIE_NAME)?.value;

  // Verify against the origin actually serving this request so custom domains
  // resolve the same user the middleware did.
  const requestHeaders = clerkConfigured ? await headers() : undefined;
  const forwardedHost = requestHeaders?.get("x-forwarded-host") ?? requestHeaders?.get("host") ?? undefined;
  const forwardedProto = requestHeaders?.get("x-forwarded-proto") ?? "https";
  const requestOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : undefined;

  /* Must resolve exactly the way the middleware did: a cold PWA launch carries an expired session token, and disagreeing here would put this render's chats under the signed-out storage scope and clear the caches. */
  const { userId } = clerkConfigured ? await resolveClerkSession(sessionToken, clientUat, requestOrigin) : { userId: null };
  const storageScope = userId ? `clerk:${userId}` : clerkConfigured ? "signed-out" : "guest";
  const mayMigrateLegacyState = !clerkConfigured || Boolean(userId && hasClerkUserAllowlist() && isClerkUserAllowed(userId));

  const storageBootScript = `
  try {
    const scope = ${JSON.stringify(storageScope)};
    // Signing out or switching accounts must not leave the previous account's
    // responses in a cache the next one reads from.
    if (localStorage.getItem('navi.storage.scope.v1') !== scope && 'caches' in window) {
      caches.keys().then((keys) => keys.filter((k) => k.startsWith('navi-')).forEach((k) => caches.delete(k)));
    }
    localStorage.setItem('navi.storage.scope.v1', scope);
    ${mayMigrateLegacyState ? "localStorage.setItem('navi.storage.legacy-owner.v1', scope);" : "localStorage.removeItem('navi.storage.legacy-owner.v1');"}
  } catch {}
  `;

  const app = clerkConfigured ? (
    <ClerkProvider
      publishableKey={getClerkPublishableKey()}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      signInForceRedirectUrl="/"
      signUpForceRedirectUrl="/"
      afterSignOutUrl="/sign-in"
    >
      {children}
    </ClerkProvider>
  ) : children;

  return (
    <html
      lang="en-US"
      data-theme="dark"
      className={`dark ${displaySerif.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        {/* Without these an installed PWA boots to a blank white screen. Each image is the app background with the brand mark centred, so the handoff to the launch surface shows no colour change. */}
        {SPLASH_SCREENS.map((screen) => (
          <link key={screen.href} rel="apple-touch-startup-image" href={screen.href} media={screen.media} />
        ))}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <script dangerouslySetInnerHTML={{ __html: dynamicTypeBootScript }} />
        <script dangerouslySetInnerHTML={{ __html: storageBootScript }} />
      </head>
      <body>
        <PWARegister />
        <GlobalPwaPlatformBanner />
        <ViewportMetrics />
        <WebVitals />
        {app}
      </body>
    </html>
  );
}
