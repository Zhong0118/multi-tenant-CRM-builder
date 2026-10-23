import type { MetadataRoute } from "next";

import { PUBLIC_ORIGIN } from "@/features/landing/content";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${PUBLIC_ORIGIN}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${PUBLIC_ORIGIN}/login`, changeFrequency: "yearly", priority: 0.5 },
    {
      url: `${PUBLIC_ORIGIN}/register`,
      changeFrequency: "yearly",
      priority: 0.5,
    },
  ];
}
