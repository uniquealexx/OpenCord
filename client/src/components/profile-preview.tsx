"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { cn } from "@/lib/utils";
import type { PublicMemberStatus } from "@opencord/shared";

type PreviewStatus = PublicMemberStatus;

export interface PreviewProfile {
  displayName: string;
  avatar?: string | null;
  banner?: string | null;
  color?: string;
  status?: PreviewStatus;
  role?: string;
  bio?: string;
  isCurrentUser?: boolean;
}

const statusLabels: Record<PreviewStatus, string> = {
  online: "В сети",
  idle: "Недоступен",
  dnd: "Не беспокоить",
  offline: "Не в сети",
};

const statusColors: Record<PreviewStatus, string> = {
  online: "bg-emerald-400",
  idle: "bg-amber-300",
  dnd: "bg-red-400",
  offline: "bg-slate-500",
};

export function ProfilePreview({ profile, side = "right", wrapperClassName, triggerClassName, label, children }: { profile: PreviewProfile; side?: "left" | "right"; wrapperClassName?: string; triggerClassName?: string; label?: string; children: ReactNode }): React.ReactElement {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });

  useEffect(() => {
    if (!open) return;
    const close = (): void => {
      setOpen(false);
      triggerRef.current?.blur();
    };
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !cardRef.current?.contains(target)) close();
    };
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === "Escape") close(); };
    const closeOnLayoutChange = (): void => close();
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnLayoutChange);
    window.addEventListener("scroll", closeOnLayoutChange, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnLayoutChange);
      window.removeEventListener("scroll", closeOnLayoutChange, true);
    };
  }, [open]);

  function toggle(): void {
    if (open) { setOpen(false); triggerRef.current?.blur(); return; }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 300;
      const estimatedHeight = 250;
      const preferredLeft = side === "right" ? rect.right + 10 : rect.left - width - 10;
      const fallbackLeft = side === "right" ? rect.left - width - 10 : rect.right + 10;
      const fitsPreferred = preferredLeft >= 8 && preferredLeft + width <= window.innerWidth - 8;
      setPosition({
        left: Math.max(8, Math.min(fitsPreferred ? preferredLeft : fallbackLeft, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(rect.top, window.innerHeight - estimatedHeight - 8)),
      });
    }
    setOpen(true);
  }

  const status = profile.status ?? "offline";
  return <span className={cn("relative inline-flex", wrapperClassName)}>
    <button ref={triggerRef} type="button" aria-label={label ?? `Открыть профиль ${profile.displayName}`} aria-expanded={open} onClick={toggle} className={cn("text-left", triggerClassName)}>{children}</button>
    {open && typeof document !== "undefined" && createPortal(
      <div ref={cardRef} role="dialog" aria-label={`Профиль ${profile.displayName}`} className="fixed z-[100] w-[300px] overflow-hidden rounded-2xl border border-white/10 bg-[#151a27] shadow-[0_24px_80px_rgba(0,0,0,.72)]" style={position}>
        <div data-testid="profile-banner" className="relative h-[96px] overflow-hidden bg-[radial-gradient(circle_at_18%_0%,rgba(139,92,246,.7),transparent_52%),linear-gradient(120deg,#312e81,#164e63)]">
          {/* Public profile banners are compact data URLs supplied by OpenCord Server. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {profile.banner && <img src={profile.banner} alt="" className="absolute inset-0 size-full object-cover" />}
        </div>
        <div className="px-4 pb-4">
          <div className="-mt-9 flex items-end justify-between">
            <div data-testid="profile-avatar-frame" className="rounded-[28%] bg-[#151a27] p-1.5"><Avatar name={profile.displayName} image={profile.avatar} color={profile.color} size="xl" status={status} /></div>
            {profile.isCurrentUser && <span className="mb-1 rounded-full border border-violet-300/15 bg-violet-400/10 px-2.5 py-1 text-[10px] font-semibold text-violet-200">Это вы</span>}
          </div>
          <h3 className="mt-2 truncate text-base font-bold text-white">{profile.displayName}</h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400"><span className={cn("size-2 rounded-full", statusColors[status])} /><span>{statusLabels[status]}</span></div>
          <div className="mt-4 rounded-xl border border-white/[.06] bg-black/15 px-3 py-2.5">
            {profile.role && <div className="flex items-center gap-2 text-xs text-slate-300"><ShieldCheck className="size-3.5 text-violet-300" /><span>{profile.role}</span></div>}
            <p className={cn("text-xs leading-5 text-slate-400", profile.role && "mt-2 border-t border-white/[.06] pt-2")}>{profile.bio?.trim() || "Публичный профиль участника OpenCord"}</p>
          </div>
        </div>
      </div>,
      document.body,
    )}
  </span>;
}
