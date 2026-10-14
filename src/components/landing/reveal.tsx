"use client";

import { useEffect, useRef } from "react";

type RevealProps = {
  children: React.ReactNode;
  className?: string;
  /** Stagger, in milliseconds. */
  delay?: number;
};

/**
 * Fades its content in the first time it scrolls into view (spec Phase 7.2).
 *
 * Progressive: the server renders everything visible. On the client, the
 * observer's first report says whether the element is already on screen; only
 * if it is not is it hidden, to be revealed when it scrolls in. So nothing is
 * invisible without JavaScript, nothing on screen flickers, reduced motion
 * means no reveal at all, and nothing is measured synchronously (no forced
 * layout while the page hydrates).
 */
export function Reveal({ children, className, delay = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let first = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (first) {
          first = false;
          if (entry.isIntersecting) {
            observer.disconnect();
          } else {
            element.dataset.reveal = "hidden";
          }
          return;
        }
        if (entry.isIntersecting) {
          element.dataset.reveal = "shown";
          observer.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={delay ? ({ "--reveal-delay": `${delay}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
