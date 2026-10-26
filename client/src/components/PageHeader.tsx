import type { ReactNode } from "react";

/** Крупный заголовок слева, подзаголовок (или действие) справа — как в макете. */
export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="safe-top flex items-baseline justify-between gap-3 px-5 pb-3 pt-4">
      <h1 className="text-[26px] font-bold tracking-[-.4px]">{title}</h1>
      {subtitle && <span className="text-[13px] text-muted-foreground">{subtitle}</span>}
      {right}
    </header>
  );
}
