import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  const value = {
    id: "/",
    name: "Navi",
    short_name: "Navi",
    description: "A premium, local-first AI companion.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#0B0D12",
    theme_color: "#0B0D12",
    lang: "en-US",
    dir: "ltr",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" }
    ],
    shortcuts: [
      {
        name: "New chat",
        short_name: "New chat",
        description: "Start a new Navi conversation",
        url: "/?new=1",
        icons: [{ src: "/apple-icon", sizes: "180x180", type: "image/png" }]
      }
    ],
    screenshots: []
  };
  return value as MetadataRoute.Manifest;
}
