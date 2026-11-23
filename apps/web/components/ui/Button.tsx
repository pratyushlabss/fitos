import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "outline";
  children: ReactNode;
};

export const buttonClass = {
  base: "press inline-flex min-h-[44px] items-center justify-center rounded-full px-5 text-sm font-medium transition-[transform,background-color,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-40",
  primary: "bg-max font-semibold text-bg",
  secondary: "bg-surface-3 text-fg",
  ghost: "bg-transparent text-fg/80",
  outline: "border border-line bg-transparent text-fg",
};

export function Button({ variant = "primary", children, className = "", ...props }: ButtonProps) {
  return (
    <button className={`${buttonClass.base} ${buttonClass[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
