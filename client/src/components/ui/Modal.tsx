import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackButton } from "@/lib/telegram";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Шторка снизу на radix-dialog: скруглённый верх, «ручка», заголовок и крестик.
 * Пока открыта, нативная BackButton Telegram её закрывает.
 */
export function Modal({ open, onOpenChange, title, children, className }: ModalProps) {
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  useBackButton(open, close);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(40,25,15,.45)] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[92vh] max-w-xl overflow-y-auto rounded-t-[28px] bg-background px-4 pb-[calc(30px+env(safe-area-inset-bottom))] pt-2.5 focus:outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom",
            className,
          )}
        >
          <div className="mx-auto mb-3.5 h-[5px] w-10 rounded-full bg-border" />
          <div className="mb-3.5 flex items-center justify-between">
            <Dialog.Title className="text-xl font-bold">{title}</Dialog.Title>
            <Dialog.Close
              className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-fill text-muted-foreground"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Строка действия в шторке «···»; список оборачивать в Card с divide-y. */
export function SheetAction({
  icon,
  label,
  onClick,
  destructive,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 px-[18px] py-[13px] text-left text-[15px] font-medium disabled:opacity-50",
        destructive && "text-destructive",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
