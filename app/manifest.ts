import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  const value = {
    id: "/",
    name: "NaviOS — Private AI Workspace",
    short_name: "NaviOS",
    description: "A private, local-first AI workspace for conversations, files, images, interactive tools, and long-running projects.",
    start_url: "/new?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#262624",
    theme_color: "#262624",
    lang: "en-US",
    dir: "ltr",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/pwa-icon-192-v5.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon-512-v5.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon-maskable-v5.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ],
    shortcuts: [
      {
        name: "New chat",
        short_name: "New chat",
        description: "Start a new conversation in NaviOS",
        url: "/new",
        icons: [{ src: "/pwa-icon-192-v5.png", sizes: "192x192", type: "image/png" }]
      },
      {
        name: "Voice mode",
        short_name: "Voice",
        description: "Start a voice conversation in NaviOS",
        url: "/voice",
        icons: [{ src: "/pwa-icon-192-v5.png", sizes: "192x192", type: "image/png" }]
      },
      {
        name: "Projects",
        short_name: "Projects",
        description: "Open your NaviOS projects",
        url: "/projects",
        icons: [{ src: "/pwa-icon-192-v5.png", sizes: "192x192", type: "image/png" }]
      }
    ],
    share_target: {
      action: "/new",
      method: "GET",
      enctype: "application/x-www-form-urlencoded",
      params: { title: "title", text: "text", url: "url" }
    },
    screenshots: [
      {
        src: "/manifest-chat",
        sizes: "1179x2556",
        type: "image/png",
        form_factor: "narrow",
        label: "NaviOS mobile conversation launch and composer"
      },
      {
        src: "/manifest-tools",
        sizes: "1600x900",
        type: "image/png",
        form_factor: "wide",
        label: "NaviOS models, files, tools, and connections"
      }
    ]
  };
  return value as MetadataRoute.Manifest;
}
