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
 * Bottom-sheet style modal on radix-dialog. Wires the native Telegram
 * BackButton to close while it's open.
 */
export function Modal({ open, onOpenChange, title, children, className }: ModalProps) {
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  useBackButton(open, close);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-3xl border-t border-card-border bg-card p-5 pb-8 shadow-xl focus:outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom",
            className,
          )}
        >
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted-foreground/30" />
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">
              {title}
            </Dialog.Title>
            <Dialog.Close className="rounded-full p-1 text-muted-foreground hover:bg-secondary">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
