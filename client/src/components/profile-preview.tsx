"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Fingerprint, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { useI18n } from "@/lib/i18n";
import { accentCardStyle, accentGlassBackground } from "@/lib/accent-color";
import { nicknameStyle } from "@/lib/name-font";
import { cn } from "@/lib/utils";
import type { NameFont, PublicMemberStatus } from "@opencord/shared";

type PreviewStatus = PublicMemberStatus;

export interface PreviewProfile {
  username: string;
  discriminator?: string;
  fingerprint?: string;
  avatar?: string | null;
  banner?: string | null;
  /** Акцентный цвет превью профиля (HEX без альфы) — перекрашивает стекло карточки. */
  accentColor?: string | null;
  /** Мягкое свечение ника (HEX без альфы) — подсвечивает имя на карточке. */
  nameGlow?: string | null;
  /** Шрифт ника — отрисовывается только CSS, текст не меняется. */
  nameFont?: NameFont | null;
  color?: string;
  status?: PreviewStatus;
  customStatus?: string;
  customStatusEmoji?: string;
  role?: string;
  bio?: string;
  isCurrentUser?: boolean;
}

const emojiFont = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

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
  // Тег с дискриминатором показывается только здесь и в настройках профиля.
  const tag = `@${profile.username}${profile.discriminator ? `#${profile.discriminator}` : ""}`;
  return <span className={cn("relative inline-flex", wrapperClassName)}>
    <button ref={triggerRef} type="button" aria-label={label ?? t.preview.openProfile(profile.username)} aria-expanded={open} onClick={toggle} className={cn("text-left", triggerClassName)}>{children}</button>
    {open && typeof document !== "undefined" && createPortal(
      <div ref={cardRef} role="dialog" aria-label={t.preview.profile(profile.username)} className="glass fixed z-[100] flex w-[300px] max-h-[calc(100dvh-16px)] flex-col overflow-hidden rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,.6)]" style={{ left: position.left, top: position.top, visibility: positioned ? undefined : "hidden", ...(profile.accentColor ? { backgroundColor: accentGlassBackground(profile.accentColor) } : {}), ...accentCardStyle(profile.accentColor ?? null) }}>
        {/* Шапка занимает место только при заданном изображении: без него карточка
            начинается с аватара, а с баннером — вырастает вверх под его высоту. */}
        {profile.banner && (
          <div data-testid="profile-banner" className="relative h-[96px] shrink-0 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={profile.banner} alt="" className="absolute inset-0 size-full object-cover" />
          </div>
        )}
        <div className={cn("flex shrink-0 items-end justify-between px-4", profile.banner ? "-mt-9" : "pt-5")}>
          <div data-testid="profile-avatar-frame" className="rounded-full bg-panel p-1.5"><Avatar name={profile.username} image={profile.avatar} color={profile.color} size="xl" status={status} /></div>
          {profile.isCurrentUser && <span className="mb-1 rounded-full border border-[color:var(--pv-badge-border)] bg-[color:var(--pv-badge-bg)] px-2.5 py-1 text-[10px] font-semibold text-[color:var(--pv-badge-text)]">{t.preview.thisIsYou}</span>}
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <h3 className="mt-2 truncate text-base font-bold text-[color:var(--pv-heading)]" style={nicknameStyle(profile.nameFont, profile.nameGlow)}>{profile.username}</h3>
          <p className="mt-0.5 truncate text-xs font-medium text-[color:var(--pv-muted)]">{tag}</p>
          <div className="mt-1 flex items-center gap-2 text-xs text-[color:var(--pv-muted)]"><span className={cn("size-2 rounded-full", statusColors[status])} /><span>{t.statuses[status]}</span></div>
          {profile.customStatus && <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-5 text-[color:var(--pv-soft)]">{profile.customStatusEmoji && <span className="shrink-0 text-sm leading-5" style={{ fontFamily: emojiFont }}>{profile.customStatusEmoji}</span>}<span className="min-w-0 break-words">{profile.customStatus}</span></p>}
          {profile.fingerprint && <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-[color:var(--pv-box-border)] bg-[color:var(--pv-box-bg)] px-2.5 py-1.5">
            <Fingerprint className="size-3.5 shrink-0 text-[color:var(--pv-icon)]" />
            <code title={t.preview.identityCodeHint} className="min-w-0 flex-1 truncate text-[10px] tracking-wide text-[color:var(--pv-muted)]">{profile.fingerprint}</code>
            <CopyCodeButton value={profile.fingerprint} />
          </div>}
          <div className="mt-4 rounded-xl border border-[color:var(--pv-box-border)] bg-[color:var(--pv-box-bg)] px-3 py-2.5">
            {profile.role && <div className="flex items-center gap-2 text-xs text-[color:var(--pv-soft)]"><ShieldCheck className="size-3.5 text-[color:var(--pv-icon)]" /><span>{profile.role}</span></div>}
            <p className={cn("text-xs leading-5 text-[color:var(--pv-muted)]", profile.role && "mt-2 border-t border-[color:var(--pv-box-border)] pt-2")}>{profile.bio?.trim() || t.preview.memberProfile}</p>
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
