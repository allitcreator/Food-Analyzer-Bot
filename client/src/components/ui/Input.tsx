import * as React from "react";
import { cn } from "@/lib/utils";

const fieldClass =
  "h-[46px] w-full rounded-[14px] border border-transparent bg-fill px-3.5 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring disabled:opacity-60";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldClass, className)} {...props} />
));
Input.displayName = "Input";

export function Field({
  label,
  labelClassName,
  children,
}: {
  label: string;
  /** Цвет подписи — например, БЖУ в цветах плашек. */
  labelClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className={cn("mb-[5px] ml-1 block text-xs font-semibold text-muted-foreground", labelClassName)}>
        {label}
      </span>
      {children}
    </label>
  );
}

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(fieldClass, "appearance-none", className)} {...props}>
    {children}
  </select>
));
Select.displayName = "Select";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-[104px] w-full resize-none rounded-[18px] bg-card p-3.5 text-[15px] leading-snug text-foreground shadow-soft outline-none placeholder:text-muted-foreground disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
