import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/offline"]
    },
    sitemap: "https://navisonnet.vercel.app/sitemap.xml",
    host: "https://navisonnet.vercel.app"
  };
}
