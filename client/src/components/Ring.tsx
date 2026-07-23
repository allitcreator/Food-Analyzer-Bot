import * as React from "react";
import { cn } from "@/lib/utils";

interface RingProps {
  /** 0..1 (values >1 are clamped for the arc but not the label). */
  progress: number;
  size?: number;
  stroke?: number;
  className?: string;
  colorVar?: string; // CSS var name, e.g. "--chart-1"
  children?: React.ReactNode;
  track?: boolean;
}

/** SVG progress ring with an optional centered label. */
export function Ring({
  progress,
  size = 200,
  stroke = 16,
  className,
  colorVar = "--primary",
  children,
  track = true,
}: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, progress));
  const offset = c * (1 - clamped);

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <svg width={size} height={size} className="-rotate-90">
        {track && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth={stroke}
          />
        )}
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
      </svg>
      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {children}
        </div>
      )}
    </div>
  );
}

interface MacroRingProps {
  label: string;
  value: number;
  goal: number | null;
  colorVar: string;
  unit?: string;
}

/** Small labelled macro ring (protein / fat / carbs). */
export function MacroRing({ label, value, goal, colorVar, unit = "г" }: MacroRingProps) {
  const progress = goal && goal > 0 ? value / goal : 0;
  return (
    <div className="flex flex-col items-center gap-1">
      <Ring progress={progress} size={78} stroke={8} colorVar={colorVar}>
        <span className="text-base font-semibold leading-none">{value}</span>
        {goal ? (
          <span className="text-[10px] text-muted-foreground">/{goal}{unit}</span>
        ) : (
          <span className="text-[10px] text-muted-foreground">{unit}</span>
        )}
      </Ring>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
