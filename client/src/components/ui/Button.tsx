import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { hapticImpact } from "@/lib/telegram";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none select-none active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground",
        secondary: "bg-fill text-foreground",
        ghost: "bg-transparent text-foreground hover:bg-fill",
        destructive: "bg-destructive text-destructive-foreground",
        outline: "border border-border bg-transparent text-foreground",
      },
      size: {
        sm: "h-[38px] rounded-[14px] px-3.5 text-sm",
        md: "h-12 rounded-2xl px-4 text-[15px]",
        lg: "h-12 rounded-2xl px-5 text-base",
        icon: "h-10 w-10 rounded-full",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  haptic?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, haptic = true, onClick, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      onClick={(e) => {
        if (haptic) hapticImpact("light");
        onClick?.(e);
      }}
      {...props}
    />
  ),
);
Button.displayName = "Button";

/** Круглая иконочная кнопка 32px из макета («повторить», «···», корзина). */
export const IconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
>(({ className, active, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-fill disabled:opacity-35",
      active && "text-primary",
      className,
    )}
    {...props}
  />
));
IconButton.displayName = "IconButton";
