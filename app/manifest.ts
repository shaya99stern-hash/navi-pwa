import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  const value = {
    id: "/",
    name: "Navi — Private AI Workspace",
    short_name: "Navi",
    description: "A private, local-first AI workspace for conversations, files, images, interactive tools, and long-running projects.",
    start_url: "/new?source=pwa",
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
      { src: "/pwa-icon-192-v4.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon-maskable", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ],
    shortcuts: [
      {
        name: "New chat",
        short_name: "New chat",
        description: "Start a new conversation with Navi",
        url: "/new",
        icons: [{ src: "/pwa-icon-192-v4.png", sizes: "192x192", type: "image/png" }]
      },
      {
        name: "Voice mode",
        short_name: "Voice",
        description: "Start a voice conversation with Navi",
        url: "/voice",
        icons: [{ src: "/pwa-icon-192-v4.png", sizes: "192x192", type: "image/png" }]
      },
      {
        name: "Projects",
        short_name: "Projects",
        description: "Open your Navi projects",
        url: "/projects",
        icons: [{ src: "/pwa-icon-192-v4.png", sizes: "192x192", type: "image/png" }]
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
