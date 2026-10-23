"use client";

import { useEffect } from "react";

/* Marks [data-reveal] blocks as shown the first time they scroll into view.
   The page only hides them after this runs, so without JavaScript, or with
   reduced motion, everything is visible from the start. */
export function RevealObserver({ rootId }: { rootId: string }) {
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (
      !root ||
      !("IntersectionObserver" in window) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-shown", "");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    for (const node of root.querySelectorAll("[data-reveal]")) {
      // Blocks already on screen stay as they are.
      if (node.getBoundingClientRect().top < window.innerHeight * 0.88) {
        node.setAttribute("data-shown", "");
      } else {
        observer.observe(node);
      }
    }
    root.setAttribute("data-reveal-ready", "");
    return () => observer.disconnect();
  }, [rootId]);

  return null;
}
