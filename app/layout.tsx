import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import PWARegister from "./pwa-register";

export const metadata: Metadata = {
  applicationName: "Navi",
  title: {
    default: "Navi",
    template: "%s · Navi"
  },
  description: "Navi is an iOS-first AI assistant powered by free-tier cloud models.",
  manifest: "/manifest.json",
  formatDetection: {
    telephone: false,
    address: false,
    email: false
  },
  appleWebApp: {
    capable: true,
    title: "Navi",
    statusBarStyle: "black-translucent"
  },
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
  colorScheme: "dark",
  themeColor: "#0d0d0d"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="bg-navi-background text-white antialiased">
        <PWARegister />
        {children}
      </body>
    </html>
  );
}
