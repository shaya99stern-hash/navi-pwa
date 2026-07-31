import type { Metadata, Viewport } from "next";
import { Source_Serif_4 } from "next/font/google";
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
import { CLERK_SESSION_COOKIE_NAME, verifyClerkSessionToken } from "@/lib/auth/session";
import { SPLASH_SCREENS } from "@/lib/ui/splash-screens";
import "./globals.css";
import "./shell.css";
import { GlobalPwaPlatformBanner } from "./components/pwa-platform-banner";
import { ViewportMetrics } from "./components/viewport-metrics";
import PWARegister from "./pwa-register";
import WebVitals from "./web-vitals";

const displaySerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-display"
});

const siteUrl = getNaviAuthCanonicalOrigin() ?? "https://navisonnet.vercel.app";

async function buildMetadata(): Promise<Metadata> {
  const theme = await readThemeCookie();
  return {
  metadataBase: new URL(siteUrl),
  applicationName: "NaviOS Hub",
  title: { default: "NaviOS Hub — Private AI Workspace", template: "%s · NaviOS Hub" },
  description: "A private, local-first AI workspace for conversations, files, images, interactive tools, and long-running projects.",
  manifest: "/manifest.webmanifest",
  alternates: { canonical: "/" },
  keywords: ["NaviOS Hub", "Navi", "NaviOS", "AI workspace", "AI assistant", "private AI", "PWA"],
  formatDetection: { telephone: false, address: false, email: false },
  /* iOS reads this once at launch and ignores later mutation, so it has to be
     rendered per request. black-translucent draws white glyphs, which vanish
     against the ivory light theme; default keeps them dark. */
  appleWebApp: {
    capable: true,
    title: "NaviOS Hub",
    statusBarStyle: theme === "light" ? "default" : "black-translucent"
  },
  icons: {
    icon: [{ url: "/pwa-icon-192-v5.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }]
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "NaviOS Hub",
    title: "NaviOS Hub — Private AI Workspace",
    description: "Conversations, files, images, tools, and multi-provider AI in one installable workspace.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "NaviOS Hub private AI workspace" }]
  },
  twitter: {
    card: "summary_large_image",
    title: "NaviOS Hub — Private AI Workspace",
    description: "Conversations, files, images, tools, and multi-provider AI in one installable workspace.",
    images: ["/opengraph-image"]
  },
  robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large" }
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
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#262624" },
    { media: "(prefers-color-scheme: light)", color: "#FAF9F5" }
  ]
};

export const THEME_COOKIE_NAME = "navi.theme";

/** The status bar style is baked in at launch, so the server needs the theme. */
async function readThemeCookie(): Promise<"dark" | "light"> {
  const value = (await cookies()).get(THEME_COOKIE_NAME)?.value;
  return value === "light" ? "light" : "dark";
}

/* The cookie is authoritative because the server rendered against it; mirror it
   back into localStorage so existing readers stay in sync. */
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
  const sessionToken = clerkConfigured
    ? (await cookies()).get(CLERK_SESSION_COOKIE_NAME)?.value
    : undefined;
  // Verify against the origin actually serving this request so custom domains
  // resolve the same user the middleware did.
  const requestHeaders = clerkConfigured ? await headers() : undefined;
  const forwardedHost = requestHeaders?.get("x-forwarded-host") ?? requestHeaders?.get("host") ?? undefined;
  const forwardedProto = requestHeaders?.get("x-forwarded-proto") ?? "https";
  const requestOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : undefined;
  const userId = clerkConfigured ? await verifyClerkSessionToken(sessionToken, requestOrigin) : null;
  const storageScope = userId ? `clerk:${userId}` : clerkConfigured ? "signed-out" : "guest";
  const mayMigrateLegacyState = !clerkConfigured
    || Boolean(userId && hasClerkUserAllowlist() && isClerkUserAllowed(userId));
  const storageBootScript = `
try {
  const scope = ${JSON.stringify(storageScope)};
  localStorage.setItem('navi.storage.scope.v1', scope);
  ${mayMigrateLegacyState
    ? "localStorage.setItem('navi.storage.legacy-owner.v1', scope);"
    : "localStorage.removeItem('navi.storage.legacy-owner.v1');"}
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
    <html lang="en-US" data-theme="dark" className={`dark ${displaySerif.variable}`} suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        {/* Without these an installed PWA boots to a blank white screen. Each
            image is the app background with the brand mark centred, so the
            handoff to the launch surface shows no colour change. */}
        {SPLASH_SCREENS.map((screen) => (
          <link key={screen.href} rel="apple-touch-startup-image" href={screen.href} media={screen.media} />
        ))}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
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
