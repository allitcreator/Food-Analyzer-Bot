import { cn } from "@/lib/utils";
import { hapticSelection } from "@/lib/telegram";

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: SegmentedProps<T>) {
  return (
    <div className={cn("flex rounded-[14px] bg-fill p-[3px]", className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={opt.value === value}
          onClick={() => {
            hapticSelection();
            onChange(opt.value);
          }}
          className={cn(
            "flex-1 rounded-[11px] px-2 py-[7px] text-[13px] font-semibold transition-colors",
            opt.value === value
              ? "bg-card text-foreground shadow-[0_1px_4px_rgba(0,0,0,.08)]"
              : "text-muted-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
