"use client";

import { animate, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

// Counts up from 0 on first view, then tweens between values.
export function AnimatedNumber({
  value,
  decimals = 0,
  format,
  className = "",
  duration = 0.9,
}: {
  value: number;
  decimals?: number;
  format?: (value: number) => string;
  className?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setShown(value);
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setShown(latest),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, inView, reduced, duration]);

  const text = format ? format(shown) : shown.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <span ref={ref} className={`num ${className}`}>
      {text}
    </span>
  );
}
