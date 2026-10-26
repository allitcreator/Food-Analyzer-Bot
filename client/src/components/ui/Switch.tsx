import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";
import { hapticSelection } from "@/lib/telegram";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, onCheckedChange, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-7 w-[46px] shrink-0 cursor-pointer items-center rounded-full p-[3px] transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-border disabled:opacity-50",
      className,
    )}
    onCheckedChange={(v) => {
      hapticSelection();
      onCheckedChange?.(v);
    }}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.2)] transition-transform data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0" />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
