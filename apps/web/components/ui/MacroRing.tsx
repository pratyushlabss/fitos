"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useId } from "react";

import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { MACRO_LABEL, type MacroKind, MacroSwatch, PatternDefs, patternFill } from "@/components/motion/Patterns";

export function MacroRing({
  label,
  value,
  target,
  unit,
  kind,
  size = 84,
}: {
  label?: string;
  value: number;
  target: number;
  unit: string;
  kind: MacroKind;
  size?: number;
}) {
  const id = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const ratio = target > 0 ? Math.min(value / target, 1) : 0;
  const over = target > 0 && value > target * 1.05;
  const name = label ?? MACRO_LABEL[kind];
  return (
    <div className="flex flex-col items-center gap-2" aria-label={`${name}: ${Math.round(value)} of ${target} ${unit}`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <PatternDefs id={id} />
          <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgb(var(--s3))" strokeWidth={stroke} fill="none" />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={patternFill(id, kind)}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={over ? "3 3" : undefined}
            initial={{ pathLength: reduced ? ratio : 0 }}
            whileInView={{ pathLength: ratio }}
            viewport={{ once: true }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <AnimatedNumber value={Math.round(value)} className={`text-base text-fg ${over ? "font-bold" : "font-medium"}`} />
          <span className="num text-[10px] text-muted">/ {target}</span>
        </div>
      </div>
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-fg">
        <MacroSwatch kind={kind} />
        {name} <span className="text-muted">{unit}</span>
      </span>
    </div>
  );
}
