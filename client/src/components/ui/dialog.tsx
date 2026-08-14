"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>): React.ReactElement {
  const { t } = useI18n();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md data-[state=closed]:animate-out data-[state=open]:animate-in" />
      <DialogPrimitive.Content className={cn("glass fixed left-1/2 top-1/2 z-50 max-h-[86vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl text-slate-100 shadow-[0_24px_70px_rgba(0,0,0,.55)] outline-none max-sm:max-h-[92dvh] max-sm:w-[calc(100%-1rem)] max-sm:max-w-none", className)} {...props}>
        <div className="scrollbar-thin m-1 max-h-[calc(86vh-0.5rem)] overflow-y-auto rounded-xl p-5 pr-6 max-sm:max-h-[calc(92dvh-0.5rem)] max-sm:p-4 max-sm:pr-4">
          {children}
        </div>
        <DialogPrimitive.Close aria-label={t.common.close} className="absolute right-4 top-4 rounded-md p-2 text-slate-500 transition hover:bg-white/10 hover:text-white"><X className="size-4" /></DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn("mb-6 space-y-2 pr-8", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>): React.ReactElement {
  return <DialogPrimitive.Title className={cn("text-xl font-bold tracking-tight", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>): React.ReactElement {
  return <DialogPrimitive.Description className={cn("text-sm leading-6 text-slate-400", className)} {...props} />;
}
