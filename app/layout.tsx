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

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "Navi",
  title: { default: "Navi — Private AI Workspace", template: "%s · Navi" },
  description: "A private, local-first AI workspace for conversations, files, images, interactive tools, and long-running projects.",
  manifest: "/manifest.webmanifest",
  alternates: { canonical: "/" },
  keywords: ["Navi", "NaviOS", "AI workspace", "AI assistant", "private AI", "PWA"],
  formatDetection: { telephone: false, address: false, email: false },
  appleWebApp: { capable: true, title: "Navi", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/pwa-icon-192-v5.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/apple-touch-icon-v5.png", type: "image/png", sizes: "1024x1024" }]
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "Navi",
    title: "Navi — Private AI Workspace",
    description: "Conversations, files, images, tools, and multi-provider AI in one installable workspace.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Navi private AI workspace" }]
  },
  twitter: {
    card: "summary_large_image",
    title: "Navi — Private AI Workspace",
    description: "Conversations, files, images, tools, and multi-provider AI in one installable workspace.",
    images: ["/opengraph-image"]
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" }
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#262624" },
    { media: "(prefers-color-scheme: light)", color: "#FAF9F5" }
  ]
};

const themeBootScript = `
try {
  const theme = localStorage.getItem('navi.theme.v3') || 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
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
        <link rel="apple-touch-icon" sizes="1024x1024" href="/apple-touch-icon-v5.png" />
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
