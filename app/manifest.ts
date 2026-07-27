import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  const value = {
    id: "/",
    name: "Navi — Private AI Workspace",
    short_name: "Navi",
    description: "A private, local-first AI workspace for conversations, files, images, interactive tools, and long-running projects.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#100F0D",
    theme_color: "#100F0D",
    lang: "en-US",
    dir: "ltr",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/pwa-icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon-maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" }
    ],
    shortcuts: [
      {
        name: "New conversation",
        short_name: "New chat",
        description: "Start a new Navi conversation",
        url: "/?new=1",
        icons: [{ src: "/pwa-icon-192", sizes: "192x192", type: "image/png" }]
      },
      {
        name: "Open tools",
        short_name: "Tools",
        description: "Open Navi tools, files, and connections",
        url: "/?menu=tools",
        icons: [{ src: "/pwa-icon-192", sizes: "192x192", type: "image/png" }]
      }
    ],
    screenshots: [
      {
        src: "/manifest-chat",
        sizes: "1179x2556",
        type: "image/png",
        form_factor: "narrow",
        label: "Navi mobile conversation launch and composer"
      },
      {
        src: "/manifest-tools",
        sizes: "1600x900",
        type: "image/png",
        form_factor: "wide",
        label: "Navi models, files, tools, and connections"
      }
    ]
  };
  return value as MetadataRoute.Manifest;
}
