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
    <div className={cn("flex rounded-xl bg-muted p-1", className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => {
            hapticSelection();
            onChange(opt.value);
          }}
          className={cn(
            "flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors",
            opt.value === value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
