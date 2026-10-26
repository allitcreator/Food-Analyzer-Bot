import * as React from "react";
import { cn } from "@/lib/utils";

interface RingProps {
  /** 0..1 (values >1 are clamped for the arc but not the label). */
  progress: number;
  size?: number;
  stroke?: number;
  className?: string;
  colorVar?: string; // CSS var name, e.g. "--primary"
  trackVar?: string;
  children?: React.ReactNode;
}

/** SVG-кольцо прогресса с подписью по центру (необязательной). */
export function Ring({
  progress,
  size = 104,
  stroke = 12,
  className,
  colorVar = "--primary",
  trackVar = "--accent-soft",
  children,
}: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, progress));
  const offset = c * (1 - clamped);

  return (
    <div className={cn("relative inline-flex shrink-0 items-center justify-center", className)}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`hsl(var(${trackVar}))`}
          strokeWidth={stroke}
        />
        {clamped > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={`hsl(var(${colorVar}))`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        )}
      </svg>
      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {children}
        </div>
      )}
    </div>
  );
}
