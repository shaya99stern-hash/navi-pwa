import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";

import {
  getClerkPublishableKey,
  hasClerkUserAllowlist,
  isClerkConfigured,
  isClerkUserAllowed
} from "@/lib/auth/config";
import "./globals.css";
import "./shell.css";
import { PwaPlatformBanner } from "./components/pwa-platform-banner";
import { ViewportMetrics } from "./components/viewport-metrics";
import PWARegister from "./pwa-register";
import WebVitals from "./web-vitals";

const siteUrl = "https://navisonnet.vercel.app";

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
    icon: [{ url: "/pwa-icon-192-v4.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/apple-touch-icon-v4.png", type: "image/png", sizes: "192x192" }]
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
    { media: "(prefers-color-scheme: dark)", color: "#191614" },
    { media: "(prefers-color-scheme: light)", color: "#F4EEE6" }
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
  const userId = clerkConfigured ? (await auth()).userId : null;
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
      afterSignOutUrl="/"
    >
      {children}
    </ClerkProvider>
  ) : children;

  return (
    <html lang="en-US" data-theme="dark" className="dark" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" sizes="192x192" href="/apple-touch-icon-v4.png" />
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <script dangerouslySetInnerHTML={{ __html: storageBootScript }} />
      </head>
      <body>
        <PWARegister />
        <PwaPlatformBanner />
        <ViewportMetrics />
        <WebVitals />
        {app}
      </body>
    </html>
  );
}
