import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/* Stamped in at build time so Settings can say which build is installed. An
   installed PWA updates silently, so without this there is no way to tell a
   stale shell from a current one short of reinstalling the app. */
const { version: appVersion } = createRequire(import.meta.url)("./package.json");
const buildRef = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7);
const builtAt = new Date().toISOString().slice(0, 10);
const developmentEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${developmentEval} https://clerk.navikeep.org https://*.clerk.accounts.dev`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://clerk.navikeep.org https://accounts.navikeep.org https://*.clerk.accounts.dev https://api.clerk.com",
  "worker-src 'self' blob:",
  "frame-src 'self' data: blob: https://clerk.navikeep.org https://accounts.navikeep.org https://*.clerk.accounts.dev https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  /* Signing in with a social provider submits a form to Clerk's Frontend API,
     which then redirects on to the provider. Both hops are cross-origin, so
     `form-action 'self'` blocked the submission outright — the button appeared
     to do nothing, with only a CSP violation in the console to show for it.
     Every origin in the sign-in chain has to be listed here. */
  "form-action 'self' https://clerk.navikeep.org https://accounts.navikeep.org https://*.clerk.accounts.dev https://accounts.google.com",
  "upgrade-insecure-requests"
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: projectRoot },
  env: {
    NEXT_PUBLIC_NAVI_VERSION: appVersion,
    NEXT_PUBLIC_NAVI_BUILD: buildRef,
    NEXT_PUBLIC_NAVI_BUILT_AT: builtAt
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" }
        ]
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Content-Type", value: "application/manifest+json; charset=utf-8" }
        ]
      },
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
