"use client";

import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { type ReactNode, useEffect } from "react";

import { readPrefs } from "@/lib/theme";

// Subtle 3D tilt toward the press point (perspective 800px). Device-orientation tilt only after "Enable motion".
export function TiltCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const rotateX = useSpring(rx, { stiffness: 300, damping: 24 });
  const rotateY = useSpring(ry, { stiffness: 300, damping: 24 });

  useEffect(() => {
    if (reduced) return;
    let enabled = readPrefs().motion;
    const onOrient = (event: DeviceOrientationEvent) => {
      if (!enabled) return;
      rx.set(Math.max(-4, Math.min(4, ((event.beta ?? 45) - 45) / 10)));
      ry.set(Math.max(-4, Math.min(4, (event.gamma ?? 0) / 10)));
    };
    const onPrefs = () => {
      enabled = readPrefs().motion;
      if (!enabled) {
        rx.set(0);
        ry.set(0);
      }
    };
    window.addEventListener("deviceorientation", onOrient);
    window.addEventListener("fitos-ui", onPrefs);
    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      window.removeEventListener("fitos-ui", onPrefs);
    };
  }, [reduced, rx, ry]);

  if (reduced) return <div className={className}>{children}</div>;
  return (
    <div style={{ perspective: 800 }}>
      <motion.div
        className={className}
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const px = (event.clientX - rect.left) / rect.width - 0.5;
          const py = (event.clientY - rect.top) / rect.height - 0.5;
          rx.set(-py * 8);
          ry.set(px * 8);
        }}
        onPointerUp={() => {
          rx.set(0);
          ry.set(0);
        }}
        onPointerLeave={() => {
          rx.set(0);
          ry.set(0);
        }}
        whileTap={{ scale: 0.985 }}
      >
        {children}
      </motion.div>
    </div>
  );
}
