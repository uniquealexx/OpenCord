"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Fingerprint, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { PublicMemberStatus } from "@opencord/shared";

type PreviewStatus = PublicMemberStatus;

export interface PreviewProfile {
  displayName: string;
  username?: string;
  discriminator?: string;
  fingerprint?: string;
  avatar?: string | null;
  banner?: string | null;
  color?: string;
  status?: PreviewStatus;
  customStatus?: string;
  customStatusColor?: string;
  role?: string;
  bio?: string;
  isCurrentUser?: boolean;
}

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
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [positioned, setPositioned] = useState(false);
  const { t } = useI18n();

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
    if (open) {
      setOpen(false);
      setPositioned(false);
      triggerRef.current?.blur();
      return;
    }
    setPositioned(false);
    setOpen(true);
  }

  // После рендера измеряем фактический размер карточки и выбираем сторону, на которой
  // она помещается целиком: предпочтительная сторона → противоположная → прижатие к краю
  // окна. По вертикали карточка прижимается к триггеру, но не выходит за границы окна.
  useLayoutEffect(() => {
    if (!open || positioned) return;
    const card = cardRef.current;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!card || !rect) { setPositioned(true); return; }
    const gap = 10;
    const margin = 8;
    const cardWidth = card.offsetWidth;
    const cardHeight = card.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const fits = (left: number): boolean => left >= margin && left + cardWidth <= viewportWidth - margin;
    const preferredLeft = side === "right" ? rect.right + gap : rect.left - cardWidth - gap;
    const fallbackLeft = side === "right" ? rect.left - cardWidth - gap : rect.right + gap;
    const left = fits(preferredLeft) ? preferredLeft : fits(fallbackLeft) ? fallbackLeft : Math.max(margin, Math.min(rect.left, viewportWidth - cardWidth - margin));
    const top = Math.max(margin, Math.min(rect.top, viewportHeight - cardHeight - margin));
    setPosition({ left, top });
    setPositioned(true);
  }, [open, positioned, side]);

  const status = profile.status ?? "offline";
  const tag = profile.username ? `@${profile.username}${profile.discriminator ? `#${profile.discriminator}` : ""}` : null;
  return <span className={cn("relative inline-flex", wrapperClassName)}>
    <button ref={triggerRef} type="button" aria-label={label ?? t.preview.openProfile(profile.displayName)} aria-expanded={open} onClick={toggle} className={cn("text-left", triggerClassName)}>{children}</button>
    {open && typeof document !== "undefined" && createPortal(
      <div ref={cardRef} role="dialog" aria-label={t.preview.profile(profile.displayName)} className="glass fixed z-[100] flex w-[300px] max-h-[calc(100dvh-16px)] flex-col overflow-hidden rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,.6)]" style={{ left: position.left, top: position.top, visibility: positioned ? undefined : "hidden" }}>
        <div data-testid="profile-banner" className="relative h-[96px] shrink-0 overflow-hidden bg-primary/15">
          {/* Public profile banners are compact data URLs supplied by OpenCord Server. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {profile.banner && <img src={profile.banner} alt="" className="absolute inset-0 size-full object-cover" />}
        </div>
        <div className="-mt-9 flex shrink-0 items-end justify-between px-4">
          <div data-testid="profile-avatar-frame" className="rounded-full bg-panel p-1.5"><Avatar name={profile.displayName} image={profile.avatar} color={profile.color} size="xl" status={status} statusColor={profile.customStatus ? profile.customStatusColor : undefined} /></div>
          {profile.isCurrentUser && <span className="mb-1 rounded-full border border-violet-300/15 bg-violet-400/10 px-2.5 py-1 text-[10px] font-semibold text-violet-200">{t.preview.thisIsYou}</span>}
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <h3 className="mt-2 truncate text-base font-bold text-white">{profile.displayName}</h3>
          {tag && <p className="mt-0.5 truncate text-xs font-medium text-slate-400">{tag}</p>}
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400"><span className={cn("size-2 rounded-full", !profile.customStatus && statusColors[status])} style={profile.customStatus ? { backgroundColor: profile.customStatusColor } : undefined} /><span>{profile.customStatus || t.statuses[status]}</span></div>
          {profile.fingerprint && <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-white/[.06] bg-black/15 px-2.5 py-1.5">
            <Fingerprint className="size-3.5 shrink-0 text-violet-300/70" />
            <code title={t.preview.identityCodeHint} className="min-w-0 flex-1 truncate text-[10px] tracking-wide text-slate-400">{profile.fingerprint}</code>
            <CopyCodeButton value={profile.fingerprint} />
          </div>}
          <div className="mt-4 rounded-xl border border-white/[.06] bg-black/15 px-3 py-2.5">
            {profile.role && <div className="flex items-center gap-2 text-xs text-slate-300"><ShieldCheck className="size-3.5 text-violet-300" /><span>{profile.role}</span></div>}
            <p className={cn("text-xs leading-5 text-slate-400", profile.role && "mt-2 border-t border-white/[.06] pt-2")}>{profile.bio?.trim() || t.preview.memberProfile}</p>
          </div>
        </div>
      </div>,
      document.body,
    )}
  </span>;
}

function CopyCodeButton({ value }: { value: string }): React.ReactElement {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2_000);
    return () => window.clearTimeout(timer);
  }, [state]);
  async function copy(): Promise<void> {
    try {
      if (!navigator.clipboard?.writeText) throw new Error(t.preview.copyUnavailable);
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch { setState("failed"); }
  }
  return <button type="button" aria-label={state === "copied" ? t.preview.copied : t.preview.copyCode} title={state === "copied" ? t.preview.copied : t.preview.copyCode} onClick={(event) => { event.stopPropagation(); void copy(); }} className="grid size-5 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-white/10 hover:text-slate-200">{state === "copied" ? <Check className="size-3 text-emerald-300" /> : <Copy className="size-3" />}</button>;
}
