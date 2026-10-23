"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Enhances server-rendered content; the page stays readable without animation. */
export function LandingMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let revert: (() => void) | undefined;
    void Promise.all([import("gsap"), import("gsap/ScrollTrigger")])
      .then(([{ gsap }, { ScrollTrigger }]) => {
        if (disposed || !root.current) return;
        gsap.registerPlugin(ScrollTrigger);
        const media = gsap.matchMedia();
        media.add("(prefers-reduced-motion: no-preference)", () => {
          const context = gsap.context(() => {
            gsap.from("[data-hero-enter]", {
              y: 24,
              opacity: 0,
              duration: 0.65,
              stagger: 0.08,
              ease: "power3.out",
              clearProps: "all",
            });
            root.current
              ?.querySelectorAll("[data-reveal]")
              .forEach((section) => {
                gsap.from(section, {
                  y: 34,
                  opacity: 0,
                  duration: 0.7,
                  ease: "power3.out",
                  scrollTrigger: {
                    trigger: section,
                    start: "top 94%",
                    once: true,
                  },
                  clearProps: "all",
                });
              });
            const story =
              root.current?.querySelector<HTMLElement>("[data-story]");
            if (!story) return;
            story.dataset.storyMotion = "true";
            const cards = story.querySelectorAll("[data-story-card]");
            gsap.set(cards, { autoAlpha: 0, y: 70, rotateX: -12, scale: 0.94 });
            gsap.set(cards[0], { autoAlpha: 1, y: 0, rotateX: 0, scale: 1 });
            const timeline = gsap.timeline({
              scrollTrigger: {
                trigger: story,
                start: "top top",
                end: "bottom bottom",
                scrub: 0.6,
              },
            });
            cards.forEach((card, index) => {
              if (index === 0) return;
              const at = index * 2 - 0.8;
              timeline
                .to(
                  cards[index - 1],
                  {
                    autoAlpha: 0,
                    y: -90,
                    rotateX: 10,
                    scale: 0.92,
                    duration: 0.35,
                  },
                  at,
                )
                .to(
                  card,
                  {
                    autoAlpha: 1,
                    y: 0,
                    rotateX: 0,
                    scale: 1,
                    duration: 0.45,
                    ease: "power2.out",
                  },
                  at + 0.35,
                );
            });
            timeline.to({}, { duration: 0.8 });
            timeline.to(
              "[data-story-progress]",
              { scaleX: 1, duration: timeline.duration(), ease: "none" },
              0,
            );
          }, root);
          return () => {
            context.revert();
            root.current
              ?.querySelector("[data-story]")
              ?.removeAttribute("data-story-motion");
          };
        });
        revert = () => media.revert();
      })
      .catch(() => {
        // Animation is optional; the server-rendered layout is the fallback.
      });
    return () => {
      disposed = true;
      revert?.();
    };
  }, []);

  return <div ref={root}>{children}</div>;
}
