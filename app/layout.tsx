import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./shell.css";
import PWARegister from "./pwa-register";

export const metadata: Metadata = {
  applicationName: "Navi",
  title: { default: "Navi", template: "%s · Navi" },
  description: "Navi is a premium, local-first AI companion.",
  manifest: "/manifest.webmanifest",
  formatDetection: { telephone: false, address: false, email: false },
  appleWebApp: { capable: true, title: "Navi", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icon", type: "image/png", sizes: "512x512" }],
    apple: [{ url: "/apple-icon", type: "image/png", sizes: "180x180" }]
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
    { media: "(prefers-color-scheme: dark)", color: "#0B0D12" },
    { media: "(prefers-color-scheme: light)", color: "#F5F7FB" }
  ]
};

const themeBootScript = `
try {
  const theme = localStorage.getItem('navi.theme.v3') || 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
} catch {}
`;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <PWARegister />
        {children}
      </body>
    </html>
  );
}
