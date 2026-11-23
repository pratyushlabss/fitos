"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useId } from "react";

import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { MACRO_LABEL, type MacroKind, MacroSwatch, PatternDefs, patternFill } from "@/components/motion/Patterns";

// Labelled horizontal bar with a pattern fill that grows from 0.
export function MacroBar({ kind, value, target, unit = "g" }: { kind: MacroKind; value: number; target: number; unit?: string }) {
  const id = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const ratio = target > 0 ? Math.min(value / target, 1) : 0;
  const over = target > 0 && value > target * 1.05;
  return (
    <div aria-label={`${MACRO_LABEL[kind]}: ${Math.round(value)} of ${target} ${unit}`}>
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="flex items-center gap-1.5 text-fg">
          <MacroSwatch kind={kind} />
          <span className={over ? "font-bold" : "font-medium"}>{MACRO_LABEL[kind]}</span>
        </span>
        <span className="text-muted">
          <AnimatedNumber value={Math.round(value)} className="text-fg" />
          <span className="num"> / {target}{unit}</span>
        </span>
      </div>
      <div className={`relative h-2.5 overflow-hidden rounded-full bg-surface-3 ${over ? "outline-dashed outline-1 outline-offset-2 outline-fg/60" : ""}`}>
        <motion.svg
          className="absolute inset-y-0 left-0 h-full"
          initial={{ width: reduced ? `${ratio * 100}%` : "0%" }}
          whileInView={{ width: `${ratio * 100}%` }}
          viewport={{ once: true }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          preserveAspectRatio="none"
        >
          <PatternDefs id={id} />
          <rect width="100%" height="100%" fill={patternFill(id, kind)} />
        </motion.svg>
      </div>
    </div>
  );
}
