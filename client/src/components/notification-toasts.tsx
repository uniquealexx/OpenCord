"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type NotificationToastKind = "message" | "mention" | "everyone";

export type NotificationToast = {
  id: string;
  channelId: string;
  channelName: string;
  authorName: string;
  kind: NotificationToastKind;
  excerpt: string;
};

const TOAST_TTL_MS = 5_000;
const MAX_VISIBLE_TOASTS = 4;

/**
 * In-app notification stack (Telegram/Steam style). Deliberately DOM-only:
 * the OS Notification API and Electron notifications are never used here.
 */
export function NotificationToasts({ toasts, onOpen, onDismiss }: { toasts: NotificationToast[]; onOpen: (channelId: string) => void; onDismiss: (id: string) => void }): React.ReactElement {
  const visible = toasts.slice(-MAX_VISIBLE_TOASTS);
  if (visible.length === 0) return <></>;
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {visible.map((toast) => <ToastCard key={toast.id} toast={toast} onOpen={onOpen} onDismiss={onDismiss} />)}
    </div>
  );
}

function ToastCard({ toast, onOpen, onDismiss }: { toast: NotificationToast; onOpen: (channelId: string) => void; onDismiss: (id: string) => void }): React.ReactElement {
  const { t } = useI18n();
  const title = toast.kind === "mention"
    ? t.notifications.toastMention(toast.authorName, toast.channelName)
    : toast.kind === "everyone"
      ? t.notifications.toastEveryone(toast.authorName, toast.channelName)
      : t.notifications.toastTitle(toast.authorName, toast.channelName);

  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), TOAST_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className="glass pointer-events-auto rounded-xl p-3 shadow-[0_18px_55px_rgba(0,0,0,.5)]">
      <div className="flex items-start gap-2">
        <button type="button" aria-label={title} onClick={() => onOpen(toast.channelId)} className={cn("min-w-0 flex-1 text-left")}>
          <p className="truncate text-xs font-semibold text-slate-100">{title}</p>
          {toast.excerpt && <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{toast.excerpt}</p>}
        </button>
        <button type="button" aria-label={t.common.close} onClick={() => onDismiss(toast.id)} className="grid size-6 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-white/10 hover:text-slate-200">
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
