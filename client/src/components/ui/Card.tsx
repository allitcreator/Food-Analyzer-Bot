import * as React from "react";
import { cn } from "@/lib/utils";

/** Карточка тёплой темы: скругление 26px, мягкая тень (в тёмной теме без тени). */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-card bg-card text-card-foreground shadow-soft", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-[18px] pt-[18px] pb-2", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-[17px] font-bold", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-[18px]", className)} {...props} />;
}

/** Заголовок секции между карточками: «Мой день», «Завтрак  540 ккал». */
export function SectionHeading({
  title,
  right,
  className,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <h3 className={cn("flex items-baseline justify-between px-1 pb-2.5 pt-1.5 text-[19px] font-bold", className)}>
      {title}
      {right && <small className="text-sm font-medium text-muted-foreground">{right}</small>}
    </h3>
  );
}

/** Подпись капсом над карточкой настроек: «ДАННЫЕ ТЕЛА». */
export function SectionCaps({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-2 pt-2.5 text-[13px] font-bold uppercase tracking-[.4px] text-muted-foreground">
      {children}
    </div>
  );
}
