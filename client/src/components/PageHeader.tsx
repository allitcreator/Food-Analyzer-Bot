import type { ReactNode } from "react";

export function PageHeader({
  title,
  right,
}: {
  title: string;
  right?: ReactNode;
}) {
  return (
    <header className="safe-top sticky top-0 z-20 flex items-center justify-between bg-background/90 px-4 pb-3 pt-4 backdrop-blur">
      <h1 className="text-2xl font-bold">{title}</h1>
      {right}
    </header>
  );
}
