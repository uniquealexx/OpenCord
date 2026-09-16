"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { UserStatus } from "@opencord/shared";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const STATUS_ORDER: readonly UserStatus[] = ["online", "idle", "dnd", "invisible"];

const STATUS_DOT_CLASS: Record<UserStatus, string> = {
  online: "bg-emerald-400",
  idle: "bg-amber-400",
  dnd: "bg-red-400",
  invisible: "bg-slate-500",
};

export function StatusMenu({ value, onChange, mobile = false }: { value: UserStatus; onChange: (status: UserStatus) => void; mobile?: boolean }): React.ReactElement {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function toggle(): void {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const width = mobile ? 208 : 176;
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        bottom: Math.max(8, window.innerHeight - rect.top + 6),
      });
    } else {
      setPosition(null);
    }
    setOpen(true);
  }

  function choose(status: UserStatus): void {
    onChange(status);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const closeOnResize = (): void => setOpen(false);
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const active = menu.querySelector<HTMLElement>('[aria-checked="true"]');
    const first = menu.querySelector<HTMLElement>('[role="menuitemradio"]');
    (active ?? first)?.focus();
  }, [open ]);

  function onMenuKeyDown(event: React.KeyboardEvent): void {
    const items = menuRef.current ? Array.from(menuRef.current.querySelectorAll<HTMLElement>('[role="menuitemradio"]')) : [];
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(current + 1 + items.length) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(current - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  return (
    <div ref={rootRef} className="min-w-0" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t.profile.status}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        className="group/status flex min-w-0 items-center gap-1 text-[11px] font-normal leading-[14px] text-slate-400 transition-colors hover:text-slate-300"
      >
        <span className="truncate">{t.statuses[value]}</span>
        <ChevronDown className={cn("size-3 shrink-0 text-slate-500 opacity-0 transition group-hover/status:opacity-100 group-focus-within/status:opacity-100", open && "rotate-180 text-violet-300 opacity-100")} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t.profile.status}
          onKeyDown={onMenuKeyDown}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          className={cn("glass fixed z-[80] rounded-xl p-1.5 shadow-[0_18px_55px_rgba(0,0,0,.5)]", mobile ? "w-52" : "w-44")}
          style={position ? { left: position.left, bottom: position.bottom } : undefined}
        >
          {STATUS_ORDER.map((status) => (
            <button
              key={status}
              type="button"
              role="menuitemradio"
              aria-checked={status === value}
              onClick={() => choose(status)}
              className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition", status === value ? "bg-violet-400/14 text-violet-100" : "text-slate-300 hover:bg-white/[.06] hover:text-white")}
            >
              <span className={cn("size-2.5 shrink-0 rounded-full", STATUS_DOT_CLASS[status])} />
              <span className="min-w-0 flex-1 truncate">{t.statuses[status]}</span>
              {status === value && <Check className="size-3.5 shrink-0 text-violet-300" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
