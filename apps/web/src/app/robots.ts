import type { MetadataRoute } from "next";

import { PUBLIC_ORIGIN } from "@/features/landing/content";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/workspace",
        "/platform",
        "/account",
        "/invitations",
        "/waiting",
      ],
    },
    sitemap: `${PUBLIC_ORIGIN}/sitemap.xml`,
  };
}
