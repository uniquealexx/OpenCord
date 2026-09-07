"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Ban, BookOpen, Camera, ChevronDown, ChevronUp, Clock3, GripVertical, History, Image as ImageIcon, ShieldCheck, SlidersHorizontal, Sparkles, UserCog, UserMinus, UserRoundCheck, Users, X } from "lucide-react";
import { BAN_DURATION_MINUTES, DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE, DEFAULT_SCREEN_SHARE_MAX_RESOLUTION, DEFAULT_SERVER_HELP_PAGE, DEFAULT_WELCOME_MESSAGE, MEBIBYTE, SCREEN_SHARE_FRAME_RATES, SCREEN_SHARE_RESOLUTIONS, WELCOME_MESSAGE_MAX_LENGTH, renderWelcomeMessage, type AuditAction, type AuditEntry, type BanDurationMinutes, type BannedMember, type CustomRole, type MemberRole, type Permission, type ScreenShareFrameRate, type ScreenShareResolution, type ServerSettings } from "@opencord/shared";
import { Avatar } from "@/components/avatar";
import { ColorSwatchPicker } from "@/components/accent-color-picker";
import { ProfilePreview } from "@/components/profile-preview";
import { ServerHelpEditor } from "@/components/server-help/server-help-editor";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { nicknameStyle } from "@/lib/name-font";
import { cn } from "@/lib/utils";
import type { LocalProfile, MockMember, MockServer } from "@/shared/state";

type SettingsPage = "visual" | "limits" | "welcome" | "users" | "roles" | "audit" | "help";
type UsersPage = "overview" | "kick" | "ban" | "unban";
type Access = { id: string; role: MemberRole; permissions: Permission[] };

const UPLOAD_SLIDER_MAX = 2_025;

export const CUSTOM_ROLE_PERMISSIONS: Permission[] = ["MANAGE_SERVER", "MANAGE_CHANNELS", "MANAGE_MESSAGES", "MANAGE_ROLES", "KICK_MEMBERS", "DELETE_SERVER", "VOICE_CONNECT", "VOICE_SPEAK", "VOICE_MODERATE"];

export function ServerSettingsPage({ mobile = false, server, profile, access, auditEntries = [], auditHasMore = false, auditLoading = false, onLoadAudit, onClose, onAvatar, onBanner, onSaveSettings, onSetRole, onSetMemberRoles, onCreateRole, onUpdateRole, onDeleteRole, onKick, onBan, onUnban }: { mobile?: boolean; server: MockServer; profile: LocalProfile; access: Access; auditEntries?: AuditEntry[]; auditHasMore?: boolean; auditLoading?: boolean; onLoadAudit?: (before: string | null) => void; onClose: () => void; onAvatar: () => void; onBanner: () => void; onSaveSettings: (settings: ServerSettings) => boolean; onSetRole: (userId: string, role: "administrator" | "member") => void; onSetMemberRoles?: (userId: string, roleIds: string[]) => void; onCreateRole?: (name: string, color: string | null, position: number, permissions: Permission[]) => void; onUpdateRole?: (roleId: string, patch: { name?: string; color?: string | null; position?: number; permissions?: Permission[] }) => void; onDeleteRole?: (roleId: string) => void; onKick: (userId: string) => void; onBan: (userId: string, durationMinutes: BanDurationMinutes) => void; onUnban: (userId: string) => void }): React.ReactElement {
  const { t } = useI18n();
  const [page, setPage] = useState<SettingsPage>("visual");
  const [usersPage, setUsersPage] = useState<UsersPage>("overview");
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description ?? "");
  const currentMegabytes = server.maxAttachmentBytes === null ? UPLOAD_SLIDER_MAX : Math.round(server.maxAttachmentBytes / MEBIBYTE);
  const [limitStep, setLimitStep] = useState(currentMegabytes);
  const [limitInput, setLimitInput] = useState(server.maxAttachmentBytes === null ? "2001" : String(currentMegabytes));
  const [maxResolution, setMaxResolution] = useState<ScreenShareResolution>(server.screenShareMaxResolution ?? DEFAULT_SCREEN_SHARE_MAX_RESOLUTION);
  const [maxFrameRate, setMaxFrameRate] = useState<ScreenShareFrameRate>(server.screenShareMaxFrameRate ?? DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE);
  const parsedLimit = Number.parseInt(limitInput, 10);
  const validLimit = Number.isFinite(parsedLimit) && parsedLimit >= 1;
  const unlimited = validLimit && parsedLimit > 2_000;
  const canManageVisual = access.permissions.includes("MANAGE_SERVER");
  const canManageRoles = access.permissions.includes("MANAGE_ROLES");
  const canModerate = access.permissions.includes("KICK_MEMBERS");

  function saveVisual(): void {
    const nextName = name.trim();
    if (!canManageVisual || nextName.length < 2) return;
    onSaveSettings({
      name: nextName,
      description: description.trim(),
      maxAttachmentBytes: server.maxAttachmentBytes,
      screenShareMaxResolution: server.screenShareMaxResolution ?? DEFAULT_SCREEN_SHARE_MAX_RESOLUTION,
      screenShareMaxFrameRate: server.screenShareMaxFrameRate ?? DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE,
      helpPage: server.helpPage ?? DEFAULT_SERVER_HELP_PAGE,
      welcomeChannelId: server.welcomeChannelId ?? null,
      welcomeMessage: server.welcomeMessage ?? DEFAULT_WELCOME_MESSAGE,
    });
  }

  function saveLimits(): void {
    if (!canManageVisual || !validLimit) return;
    onSaveSettings({
      name: server.name,
      description: server.description ?? "",
      maxAttachmentBytes: unlimited ? null : parsedLimit * MEBIBYTE,
      screenShareMaxResolution: maxResolution,
      screenShareMaxFrameRate: maxFrameRate,
      helpPage: server.helpPage ?? DEFAULT_SERVER_HELP_PAGE,
      welcomeChannelId: server.welcomeChannelId ?? null,
      welcomeMessage: server.welcomeMessage ?? DEFAULT_WELCOME_MESSAGE,
    });
  }

  function changeLimitSlider(value: number): void {
    setLimitStep(value);
    setLimitInput(value > 2_000 ? "2001" : String(value));
  }

  function changeLimitInput(value: string): void {
    const digits = value.replace(/\D/gu, "");
    setLimitInput(digits);
    if (!digits) return;
    const numericValue = Number.parseInt(digits, 10);
    setLimitStep(numericValue > 2_000 ? UPLOAD_SLIDER_MAX : Math.max(1, numericValue));
  }

  // На телефоне настройки занимают весь экран: колонки серверов рядом нет.
  return (
    <section className={cn("absolute inset-y-0 z-40 flex min-w-0 flex-1 overflow-hidden bg-canvas max-md:flex-col", mobile ? "left-0" : "left-[76px]")} style={{ right: 0 }}>
      <aside className="w-64 shrink-0 border-r border-white/[.055] bg-rail px-3 py-4 max-md:w-full max-md:border-b max-md:border-r-0">
        <div className="mb-5 flex items-center gap-3 px-2">
          <Avatar name={server.name} image={server.avatar} color={server.accent} size="sm" />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-white">{server.name}</p><p className="text-[10px] text-slate-500">{t.serverSettings.title}</p></div>
          <button type="button" aria-label={t.serverSettings.close} onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-slate-200 max-md:size-11"><X className="size-5" /></button>
        </div>
        <nav className="space-y-1 max-md:grid max-md:grid-cols-2 max-md:gap-1 max-md:space-y-0">
          <NavigationButton active={page === "visual"} icon={<Camera className="size-4" />} onClick={() => setPage("visual")}>{t.serverSettings.visual}</NavigationButton>
          <NavigationButton active={page === "limits"} icon={<SlidersHorizontal className="size-4" />} onClick={() => setPage("limits")}>{t.serverSettings.limits}</NavigationButton>
          <NavigationButton active={page === "welcome"} icon={<Sparkles className="size-4" />} onClick={() => setPage("welcome")}>{t.serverSettings.welcome}</NavigationButton>
          <NavigationButton active={page === "users"} icon={<Users className="size-4" />} onClick={() => setPage("users")}>{t.serverSettings.users}</NavigationButton>
          <NavigationButton active={page === "roles"} icon={<ShieldCheck className="size-4" />} onClick={() => setPage("roles")}>{t.serverSettings.roles}</NavigationButton>
          {canManageVisual && <NavigationButton active={page === "audit"} icon={<History className="size-4" />} onClick={() => setPage("audit")}>{t.serverSettings.audit}</NavigationButton>}
          <NavigationButton active={page === "help"} icon={<BookOpen className="size-4" />} onClick={() => setPage("help")}>{t.serverSettings.help}</NavigationButton>
        </nav>
        {page === "users" && <nav className="mt-4 space-y-1 border-t border-white/[.06] pt-4 max-md:grid max-md:grid-cols-2 max-md:gap-1 max-md:space-y-0">
          <NavigationButton compact active={usersPage === "overview"} icon={<UserCog className="size-3.5" />} onClick={() => setUsersPage("overview")}>{t.serverSettings.admins}</NavigationButton>
          <NavigationButton compact active={usersPage === "kick"} icon={<UserMinus className="size-3.5" />} onClick={() => setUsersPage("kick")}>{t.serverSettings.kick}</NavigationButton>
          <NavigationButton compact active={usersPage === "ban"} icon={<Ban className="size-3.5" />} onClick={() => setUsersPage("ban")}>{t.serverSettings.ban}</NavigationButton>
          <NavigationButton compact active={usersPage === "unban"} icon={<UserRoundCheck className="size-3.5" />} onClick={() => setUsersPage("unban")}>{t.serverSettings.unban}</NavigationButton>
        </nav>}
      </aside>
      <div className="scrollbar-thin min-w-0 flex-1 overflow-y-auto">
        {page === "visual" ? (
          <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
            <PageHeading title={t.serverSettings.visualTitle} description={t.serverSettings.visualDescription} />
            <div className="overflow-hidden rounded-3xl border border-white/[.08] bg-panel">
              <div className="relative h-48 bg-primary/15">{server.banner && <Image src={server.banner} alt="" fill unoptimized sizes="768px" className="object-cover" />}</div>
              <div className="relative px-6 pb-6 pt-14">
                <div className="absolute -top-11 left-6"><Avatar name={server.name} image={server.avatar} color={server.accent} size="xl" className="ring-4 ring-panel" /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button type="button" onClick={onAvatar} disabled={!canManageVisual} className="flex items-center gap-3 rounded-xl border border-white/[.07] bg-black/15 p-3 text-left text-sm text-slate-200 disabled:opacity-45"><Camera className="size-4 text-violet-300" />{t.server.serverAvatar}</button>
                  <button type="button" onClick={onBanner} disabled={!canManageVisual} className="flex items-center gap-3 rounded-xl border border-white/[.07] bg-black/15 p-3 text-left text-sm text-slate-200 disabled:opacity-45"><ImageIcon className="size-4 text-cyan-300" />{t.server.serverBanner}</button>
                </div>
                <label className="mt-5 block text-xs font-semibold text-slate-300" htmlFor="full-server-name">{t.server.settingsName}</label>
                <Input id="full-server-name" className="mt-2" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={48} disabled={!canManageVisual} />
                <label className="mt-5 block text-xs font-semibold text-slate-300" htmlFor="full-server-description">{t.serverSettings.serverDescription}</label>
                <Textarea id="full-server-description" className="mt-2" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={160} disabled={!canManageVisual} placeholder={t.serverSettings.serverDescriptionPlaceholder} />
                <p className="mt-1 text-right text-[11px] text-slate-500">{description.length}/160</p>
                {canManageVisual ? <Button className="mt-4" onClick={saveVisual} disabled={name.trim().length < 2}>{t.server.saveSettings}</Button> : <p className="mt-4 text-xs text-slate-500">{t.server.onlyOwner}</p>}
              </div>
            </div>
          </div>
        ) : page === "limits" ? (
          <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
            <PageHeading title={t.serverSettings.limitsTitle} description={t.serverSettings.limitsDescription} />
            <section className="space-y-5 rounded-3xl border border-white/[.08] bg-panel p-5 sm:p-6">
              <div>
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-200">{t.server.uploadLimitTitle}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{t.server.uploadLimitHint}</p>
                  </div>
                  <label className={cn("flex h-10 min-w-28 items-center rounded-xl border px-3 transition focus-within:ring-2", unlimited ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-200 focus-within:ring-cyan-400/25" : "border-violet-400/20 bg-violet-400/10 text-violet-200 focus-within:ring-violet-400/25")}>
                    <input aria-label={t.server.uploadLimitInput} inputMode="numeric" value={limitInput} onChange={(event) => changeLimitInput(event.target.value)} disabled={!canManageVisual} className="w-16 bg-transparent text-right text-sm font-bold outline-none disabled:cursor-not-allowed" />
                    <span className="ml-2 min-w-5 text-xs font-bold">{unlimited ? "∞" : t.settings.mb}</span>
                  </label>
                </div>
                <input aria-label={t.server.uploadLimitSlider} type="range" min={1} max={UPLOAD_SLIDER_MAX} step={1} value={limitStep} onChange={(event) => changeLimitSlider(Number(event.target.value))} disabled={!canManageVisual} className="voice-limit-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15 disabled:cursor-not-allowed disabled:opacity-50" />
                <div className="mt-2 flex justify-between text-[10px] text-slate-600"><span>1 {t.settings.mb}</span><span>500</span><span>1000</span><span>1500</span><span>2000</span><span>∞</span></div>
              </div>
              <div className="border-t border-white/[.06] pt-5">
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-200">{t.server.shareQualityTitle}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{t.server.shareQualityHint}</p>
                  </div>
                  <span className="rounded-xl bg-cyan-400/10 px-3 py-2 text-sm font-bold text-cyan-200">{maxResolution === 1440 ? t.server.source : `${maxResolution}p`}</span>
                </div>
                <input aria-label={t.server.shareQualitySlider} type="range" min={0} max={SCREEN_SHARE_RESOLUTIONS.length - 1} step={1} value={SCREEN_SHARE_RESOLUTIONS.indexOf(maxResolution)} onChange={(event) => setMaxResolution(SCREEN_SHARE_RESOLUTIONS[Number(event.target.value)] ?? DEFAULT_SCREEN_SHARE_MAX_RESOLUTION)} disabled={!canManageVisual} className="voice-limit-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15 disabled:cursor-not-allowed disabled:opacity-50" />
                <div className="mt-2 flex justify-between text-[10px] text-slate-600"><span>480p</span><span>720p</span><span>1080p</span><span>{t.server.source}</span></div>
              </div>
              <div className="border-t border-white/[.06] pt-5">
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-200">{t.server.shareFpsTitle}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{t.server.shareFpsHint}</p>
                  </div>
                  <span className="rounded-xl bg-violet-400/10 px-3 py-2 text-sm font-bold text-violet-200">{maxFrameRate} FPS</span>
                </div>
                <input aria-label={t.server.shareFpsSlider} type="range" min={0} max={SCREEN_SHARE_FRAME_RATES.length - 1} step={1} value={SCREEN_SHARE_FRAME_RATES.indexOf(maxFrameRate)} onChange={(event) => setMaxFrameRate(SCREEN_SHARE_FRAME_RATES[Number(event.target.value)] ?? DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE)} disabled={!canManageVisual} className="voice-limit-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15 disabled:cursor-not-allowed disabled:opacity-50" />
                <div className="mt-2 flex justify-between text-[10px] text-slate-600"><span>15 FPS</span><span>30 FPS</span><span>60 FPS</span></div>
              </div>
              {canManageVisual ? <Button onClick={saveLimits} disabled={!validLimit}>{t.server.saveSettings}</Button> : <p className="text-xs text-slate-500">{t.server.onlyOwner}</p>}
            </section>
          </div>
        ) : page === "welcome" ? (
          <WelcomeSettings server={server} profile={profile} canManage={canManageVisual} onSaveSettings={onSaveSettings} />
        ) : page === "users" ? (
          <UserSettings server={server} profile={profile} access={access} page={usersPage} canManageRoles={canManageRoles} canModerate={canModerate} onSetRole={onSetRole} onKick={onKick} onBan={onBan} onUnban={onUnban} />
        ) : page === "roles" ? (
          <RolesSettings server={server} access={access} canManageRoles={canManageRoles} onSetMemberRoles={onSetMemberRoles} onCreateRole={onCreateRole} onUpdateRole={onUpdateRole} onDeleteRole={onDeleteRole} />
        ) : page === "audit" ? (
          <AuditSettings server={server} entries={auditEntries} hasMore={auditHasMore} loading={auditLoading} canView={canManageVisual} onLoad={onLoadAudit} />
        ) : (
          <ServerHelpEditor server={server} canManage={canManageVisual} onSaveSettings={onSaveSettings} />
        )}
      </div>
    </section>
  );
}

function AuditSettings({ server, entries, hasMore, loading, canView, onLoad }: { server: MockServer; entries: AuditEntry[]; hasMore: boolean; loading: boolean; canView: boolean; onLoad?: (before: string | null) => void }): React.ReactElement {
  const { t, locale } = useI18n();
  const requestedRef = useRef(false);
  useEffect(() => {
    if (canView && onLoad && !requestedRef.current) {
      requestedRef.current = true;
      onLoad(null);
    }
  }, [canView, onLoad]);
  if (!canView) return <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8"><PageHeading title={t.serverSettings.auditTitle} description={t.serverSettings.auditDescription} /><p className="text-xs text-slate-500">{t.server.onlyOwner}</p></div>;
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  function actorOf(actorId: string): { name: string; color: string | null } {
    const member = server.members.find((entry) => entry.id === actorId);
    if (!member) return { name: t.serverSettings.auditUnknownUser, color: null };
    return { name: member.username, color: member.roleColor ?? null };
  }
  function targetLabel(entry: AuditEntry): string {
    const targetId = entry.targetId;
    if (!targetId) {
      if (entry.action === "channel.slowmode.set") {
        const count = countFromDetail(entry.detail);
        return count === null ? t.serverSettings.auditTargetServer(server.name) : t.serverSettings.auditTargetChannels(count);
      }
      return t.serverSettings.auditTargetServer(server.name);
    }
    switch (entry.action) {
      case "member.kick":
      case "member.ban":
      case "member.unban":
      case "member.role.set":
      case "member.roles.set": {
        const member = server.members.find((candidate) => candidate.id === targetId);
        return member ? t.serverSettings.auditTargetMember(member.username) : t.serverSettings.auditTargetUnknown(targetId);
      }
      case "role.create":
      case "role.update":
      case "role.delete": {
        const role = (server.roles ?? []).find((candidate) => candidate.id === targetId);
        return role ? t.serverSettings.auditTargetRole(role.name) : t.serverSettings.auditTargetUnknown(targetId);
      }
      case "channel.create":
      case "channel.update":
      case "channel.delete":
      case "channel.overwrites.set": {
        const channel = server.channels.find((candidate) => candidate.id === targetId);
        return channel ? t.serverSettings.auditTargetChannel(channel.name) : t.serverSettings.auditTargetUnknown(targetId);
      }
      case "message.bulkDelete": {
        const channel = server.channels.find((candidate) => candidate.id === targetId);
        const count = countFromDetail(entry.detail);
        if (channel && count !== null) return `${t.serverSettings.auditTargetChannel(channel.name)} · ${t.serverSettings.auditTargetMessages(count)}`;
        if (channel) return t.serverSettings.auditTargetChannel(channel.name);
        if (count !== null) return t.serverSettings.auditTargetMessages(count);
        return t.serverSettings.auditTargetUnknown(targetId);
      }
      case "message.delete":
        return t.serverSettings.auditTargetMessage(targetId);
      default:
        return t.serverSettings.auditTargetServer(server.name);
    }
  }
  return <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
    <PageHeading title={t.serverSettings.auditTitle} description={t.serverSettings.auditDescription} />
    {entries.length === 0 && !loading && <EmptyState>{t.serverSettings.auditEmpty}</EmptyState>}
    <div className="space-y-2">
      {entries.map((entry) => {
        const actor = actorOf(entry.actorId);
        return <div key={entry.id} className="rounded-2xl border border-white/[.07] bg-panel p-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: actor.color ?? "transparent", border: actor.color ? "none" : "1px solid rgba(255,255,255,.25)" }} />
            <span className="text-sm font-semibold text-slate-200">{actor.name}</span>
            <span className="text-xs text-slate-400">{actionLabel(t.serverSettings.auditActions, entry.action)}</span>
            <span className="ml-auto text-[11px] text-slate-500">{formatter.format(new Date(entry.at))}</span>
          </div>
          <p className="mt-1.5 truncate text-xs text-slate-400">{targetLabel(entry)}</p>
          {entry.detail && <p className="mt-0.5 truncate text-[11px] text-slate-500">{entry.detail}</p>}
        </div>;
      })}
    </div>
    {loading && <p className="mt-3 text-center text-xs text-slate-500">{t.serverSettings.auditLoading}</p>}
    {hasMore && !loading && onLoad && <div className="mt-3 flex justify-center"><Button variant="secondary" size="sm" onClick={() => onLoad(entries[entries.length - 1]?.at ?? null)}>{t.serverSettings.auditLoadMore}</Button></div>}
  </div>;
}

function actionLabel(labels: Record<AuditAction, string>, action: AuditAction): string {
  return labels[action];
}

function countFromDetail(detail: string | null): number | null {
  if (!detail) return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.count === "number" && Number.isFinite(record.count)) return record.count;
      if (Array.isArray(record.channelIds)) return record.channelIds.length;
    }
  } catch { /* старые и новые текстовые форматы разбираются ниже */ }
  const match = detail.match(/(\d+)\s*(?:messages?|сообщ|条消息|channel)/iu) ?? detail.match(/deleted\s+(\d+)/iu) ?? detail.match(/count=(\d+)/iu);
  const value = match?.[1] ? Number.parseInt(match[1], 10) : NaN;
  return Number.isFinite(value) ? value : null;
}

function WelcomeSettings({ server, profile, canManage, onSaveSettings }: { server: MockServer; profile: LocalProfile; canManage: boolean; onSaveSettings: (settings: ServerSettings) => boolean }): React.ReactElement {
  const { t } = useI18n();
  const textChannels = server.channels.filter((channel) => channel.kind === "text");
  const [channelId, setChannelId] = useState<string | null>(server.welcomeChannelId ?? null);
  const [template, setTemplate] = useState(server.welcomeMessage ?? DEFAULT_WELCOME_MESSAGE);
  const preview = renderWelcomeMessage(template, profile.username, server.name);
  const validTemplate = template.length <= WELCOME_MESSAGE_MAX_LENGTH;
  function save(): void {
    if (!canManage || !validTemplate) return;
    onSaveSettings({
      name: server.name,
      description: server.description ?? "",
      maxAttachmentBytes: server.maxAttachmentBytes,
      screenShareMaxResolution: server.screenShareMaxResolution ?? DEFAULT_SCREEN_SHARE_MAX_RESOLUTION,
      screenShareMaxFrameRate: server.screenShareMaxFrameRate ?? DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE,
      helpPage: server.helpPage ?? DEFAULT_SERVER_HELP_PAGE,
      welcomeChannelId: channelId,
      welcomeMessage: template,
    });
  }
  return <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
    <PageHeading title={t.serverSettings.welcomeTitle} description={t.serverSettings.welcomeDescription} />
    <section className="space-y-5 rounded-3xl border border-white/[.08] bg-panel p-5 sm:p-6">
      <div>
        <p className="text-sm font-semibold text-slate-200">{t.serverSettings.welcomeChannel}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">{t.serverSettings.welcomeChannelHint}</p>
        <Combobox label={t.serverSettings.welcomeChannel} value={channelId ?? ""} placeholder={t.serverSettings.welcomeDisabled} icon={Sparkles} options={textChannels.map((channel) => ({ value: channel.id, label: `#${channel.name}` }))} disabled={!canManage} onChange={(value) => setChannelId(value ? value : null)} className="mt-3" />
      </div>
      <div className="border-t border-white/[.06] pt-5">
        <label className="block text-sm font-semibold text-slate-200" htmlFor="welcome-template">{t.serverSettings.welcomeTemplate}</label>
        <p className="mt-1 text-xs leading-5 text-slate-500">{t.serverSettings.welcomeTemplateHint}</p>
        <Textarea id="welcome-template" className="mt-3" value={template} onChange={(event) => setTemplate(event.target.value)} maxLength={WELCOME_MESSAGE_MAX_LENGTH} disabled={!canManage} placeholder={DEFAULT_WELCOME_MESSAGE} />
        <p className="mt-1 text-right text-[11px] text-slate-500">{template.length}/{WELCOME_MESSAGE_MAX_LENGTH}</p>
      </div>
      <div className="border-t border-white/[.06] pt-5">
        <p className="text-sm font-semibold text-slate-200">{t.serverSettings.welcomePreview}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">{t.serverSettings.welcomePreviewHint}</p>
        <div className="mt-3 rounded-xl border border-white/[.07] bg-black/15 p-3 text-sm text-slate-200">{preview || <span className="text-slate-600">{t.serverSettings.welcomeEmptyPreview}</span>}</div>
      </div>
      {canManage ? <Button onClick={save} disabled={!validTemplate}>{t.server.saveSettings}</Button> : <p className="text-xs text-slate-500">{t.server.onlyOwner}</p>}
    </section>
  </div>;
}

function UserSettings({ server, profile, access, page, canManageRoles, canModerate, onSetRole, onKick, onBan, onUnban }: { server: MockServer; profile: LocalProfile; access: Access; page: UsersPage; canManageRoles: boolean; canModerate: boolean; onSetRole: (userId: string, role: "administrator" | "member") => void; onKick: (userId: string) => void; onBan: (userId: string, durationMinutes: BanDurationMinutes) => void; onUnban: (userId: string) => void }): React.ReactElement {
  const { t } = useI18n();
  const titles = { overview: t.serverSettings.adminsTitle, kick: t.serverSettings.kickTitle, ban: t.serverSettings.banTitle, unban: t.serverSettings.unbanTitle };
  const descriptions = { overview: t.serverSettings.adminsDescription, kick: t.serverSettings.kickDescription, ban: t.serverSettings.banDescription, unban: t.serverSettings.unbanDescription };
  const members = server.members.filter((member) => member.id !== access.id && member.serverRole !== "owner" && (access.role === "owner" || member.serverRole === "member"));
  return <div className={cn("mx-auto w-full px-5 py-8 sm:px-8", page === "overview" ? "max-w-6xl" : "max-w-3xl")}>
    <PageHeading title={titles[page]} description={descriptions[page]} />
    {page === "overview" ? <RoleManagementBoard server={server} profile={profile} canManageRoles={canManageRoles} onSetRole={onSetRole} /> : page === "unban" ? <BannedList members={server.bannedMembers ?? []} canModerate={canModerate} onUnban={onUnban} /> : (
      <div className="space-y-2">
        {members.length === 0 && <EmptyState>{t.serverSettings.noUsers}</EmptyState>}
        {members.map((member) => {
          if (page === "ban") return <BanManagementRow key={member.id} member={member} disabled={!canModerate} onBan={onBan} />;
          const action = t.members.kick;
          const disabled = !canModerate;
          const destructive = true;
          const run = (): void => onKick(member.id);
          return <MemberManagementRow key={member.id} member={member} profile={profile} isCurrentUser={false} action={action} confirmText={t.serverSettings.confirmKick(member.username)} disabled={disabled} destructive={destructive} onAction={run} />;
        })}
      </div>
    )}
  </div>;
}

function RolesSettings({ server, access, canManageRoles, onSetMemberRoles, onCreateRole, onUpdateRole, onDeleteRole }: { server: MockServer; access: Access; canManageRoles: boolean; onSetMemberRoles?: (userId: string, roleIds: string[]) => void; onCreateRole?: (name: string, color: string | null, position: number, permissions: Permission[]) => void; onUpdateRole?: (roleId: string, patch: { name?: string; color?: string | null; position?: number; permissions?: Permission[] }) => void; onDeleteRole?: (roleId: string) => void }): React.ReactElement {
  const { t } = useI18n();
  const roles = [...(server.roles ?? [])].sort((left, right) => right.position - left.position || left.name.localeCompare(right.name));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = roles.find((role) => role.id === selectedId) ?? null;
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState("#4d6bfe");
  const [draftNoColor, setDraftNoColor] = useState(false);
  const [draftPosition, setDraftPosition] = useState(0);
  const [draftPermissions, setDraftPermissions] = useState<Permission[]>(["VOICE_CONNECT", "VOICE_SPEAK"]);
  const assignable = server.members.filter((member) => member.id !== access.id && member.serverRole !== "owner");
  function toggleDraftPermission(permission: Permission): void {
    setDraftPermissions((current) => current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]);
  }
  function create(): void {
    const name = draftName.trim();
    if (!canManageRoles || name.length < 2 || !onCreateRole) return;
    onCreateRole(name.slice(0, 32), draftNoColor ? null : draftColor, Math.max(0, Math.min(9_999, draftPosition)), draftPermissions);
    setDraftName("");
  }
  function memberCount(roleId: string): number {
    return server.members.filter((member) => (member.roleIds ?? []).includes(roleId)).length;
  }
  return <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
    <PageHeading title={t.serverSettings.rolesTitle} description={t.serverSettings.rolesDescription} />
    {roles.length === 0 && <EmptyState>{t.serverSettings.noRoles}</EmptyState>}
    {roles.length > 0 && <div className="grid items-start gap-4 lg:grid-cols-[264px_minmax(0,1fr)]">
      <div className="space-y-1.5" aria-label={t.serverSettings.rolesTitle}>
        {roles.map((role) => {
          const active = selected?.id === role.id;
          return <button key={role.id} type="button" onClick={() => setSelectedId(role.id)} aria-pressed={active} className={cn("flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition", active ? "border-violet-400/30 bg-violet-500/10" : "border-white/[.055] bg-panel hover:border-white/[.12]")}>
            <GripVertical className="size-4 shrink-0 text-slate-600" aria-hidden />
            <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ backgroundColor: role.color ?? "transparent", border: role.color ? "none" : "1px solid rgba(255,255,255,.25)" }} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={role.color ? { color: role.color } : undefined}>{role.name}</span>
            <span className="shrink-0 rounded-full bg-white/[.06] px-2 py-0.5 text-[10px] font-semibold text-slate-400">{t.serverSettings.roleAssignedCount(memberCount(role.id))}</span>
            <code className="shrink-0 text-[10px] text-slate-600">{role.position}</code>
          </button>;
        })}
      </div>
      <div className="min-w-0">
        {selected
          ? <RoleInspector key={selected.id} role={selected} memberCount={memberCount(selected.id)} canManageRoles={canManageRoles} onUpdateRole={onUpdateRole} onDeleteRole={onDeleteRole} />
          : <div className="grid h-full min-h-40 place-items-center rounded-2xl border border-dashed border-white/10 px-5 py-10 text-center text-sm text-slate-500">{t.serverSettings.roleSelectHint}</div>}
      </div>
    </div>}
    {canManageRoles && onCreateRole && <section className="mt-4 rounded-2xl border border-white/[.07] bg-panel p-4">
      <h2 className="text-sm font-bold text-slate-200">{t.serverSettings.roleCreate}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs font-medium text-slate-300">{t.serverSettings.roleName}<Input value={draftName} onChange={(event) => setDraftName(event.target.value)} minLength={2} maxLength={32} placeholder={t.serverSettings.roleNamePlaceholder} /></label>
        <label className="grid gap-1.5 text-xs font-medium text-slate-300">{t.serverSettings.rolePosition}<Input type="number" value={draftPosition} onChange={(event) => setDraftPosition(Number(event.target.value))} min={0} max={9_999} /></label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <ColorSwatchPicker value={draftColor} onChange={(next) => { setDraftColor(next); setDraftNoColor(false); }} groupLabel={t.serverSettings.roleColor} customLabel={t.serverSettings.roleColor} />
        <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={draftNoColor} onChange={(event) => setDraftNoColor(event.target.checked)} />{t.serverSettings.roleNoColor}</label>
      </div>
      <div className="mt-3 grid gap-1 sm:grid-cols-2">
        {CUSTOM_ROLE_PERMISSIONS.map((permission) => <label key={permission} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-white/[.04]"><input type="checkbox" checked={draftPermissions.includes(permission)} onChange={() => toggleDraftPermission(permission)} /><code>{permission}</code></label>)}
      </div>
      <Button className="mt-3" onClick={create} disabled={draftName.trim().length < 2}>{t.serverSettings.roleCreate}</Button>
    </section>}
    {canManageRoles && onSetMemberRoles && assignable.length > 0 && <section className="mt-4 rounded-2xl border border-white/[.07] bg-panel p-4">
      <h2 className="text-sm font-bold text-slate-200">{t.serverSettings.roleAssign}</h2>
      <p className="mt-1 text-xs text-slate-500">{t.serverSettings.roleAssignHint}</p>
      <div className="mt-3 space-y-2">
        {assignable.map((member) => <MemberRolesRow key={member.id} memberId={member.id} memberName={member.username} memberColor={member.roleColor ?? null} roleIds={member.roleIds ?? []} roles={roles} onSetMemberRoles={onSetMemberRoles} />)}
      </div>
    </section>}
  </div>;
}

function MemberRolesRow({ memberId, memberName, memberColor, roleIds, roles, onSetMemberRoles }: { memberId: string; memberName: string; memberColor: string | null; roleIds: string[]; roles: CustomRole[]; onSetMemberRoles: (userId: string, roleIds: string[]) => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  function toggle(roleId: string): void {
    onSetMemberRoles(memberId, roleIds.includes(roleId) ? roleIds.filter((id) => id !== roleId) : [...roleIds, roleId]);
  }
  return <div className="rounded-xl border border-white/[.055] bg-black/10 p-3">
    <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2 text-left text-sm font-semibold" style={memberColor ? { color: memberColor } : undefined}>{memberName}<span className="ml-auto text-[10px] font-normal text-slate-500">{roleIds.length}</span></button>
    {open && <div className="mt-2 grid gap-1">{roles.map((role) => <label key={role.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-white/[.04]"><input type="checkbox" checked={roleIds.includes(role.id)} onChange={() => toggle(role.id)} /><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: role.color ?? "transparent", border: role.color ? "none" : "1px solid rgba(255,255,255,.25)" }} /><span className="min-w-0 flex-1 truncate">{role.name}</span><code className="text-[10px] text-slate-500">{role.position}</code></label>)}</div>}
  </div>;
}

const ROLE_PERMISSION_GROUPS: { key: "server" | "channels" | "members" | "voice"; permissions: Permission[] }[] = [
  { key: "server", permissions: ["MANAGE_SERVER", "DELETE_SERVER"] },
  { key: "channels", permissions: ["MANAGE_CHANNELS", "MANAGE_MESSAGES"] },
  { key: "members", permissions: ["MANAGE_ROLES", "KICK_MEMBERS"] },
  { key: "voice", permissions: ["VOICE_CONNECT", "VOICE_SPEAK", "VOICE_MODERATE"] },
];

function RoleInspector({ role, memberCount, canManageRoles, onUpdateRole, onDeleteRole }: { role: CustomRole; memberCount: number; canManageRoles: boolean; onUpdateRole?: (roleId: string, patch: { name?: string; color?: string | null; position?: number; permissions?: Permission[] }) => void; onDeleteRole?: (roleId: string) => void }): React.ReactElement {
  const { t } = useI18n();
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color ?? "#4d6bfe");
  const [noColor, setNoColor] = useState(role.color === null);
  const [position, setPosition] = useState(role.position);
  const [permissions, setPermissions] = useState<Permission[]>(role.permissions);
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);
  const [baseline, setBaseline] = useState(() => ({ name: role.name, color: role.color, position: role.position, permissions: role.permissions }));
  const dirty = name.trim() !== baseline.name || (noColor ? null : color) !== baseline.color || position !== baseline.position || permissions.length !== baseline.permissions.length || permissions.some((permission) => !baseline.permissions.includes(permission));
  const groupTitles = {
    server: t.serverSettings.rolePermGroupServer,
    channels: t.serverSettings.rolePermGroupChannels,
    members: t.serverSettings.rolePermGroupMembers,
    voice: t.serverSettings.rolePermGroupVoice,
  } as const;
  function togglePermission(permission: Permission): void {
    setPermissions((current) => current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]);
    setSaved(false);
  }
  function move(delta: number): void {
    setPosition((current) => Math.max(0, Math.min(9_999, current + delta)));
    setSaved(false);
  }
  function save(): void {
    const nextName = name.trim();
    if (!canManageRoles || !onUpdateRole || nextName.length < 2) return;
    const patch = { name: nextName.slice(0, 32), color: noColor ? null : color, position: Math.max(0, Math.min(9_999, position)), permissions };
    onUpdateRole(role.id, patch);
    setBaseline({ name: patch.name, color: patch.color, position: patch.position, permissions: patch.permissions });
    setSaved(true);
  }
  return <section aria-label={t.serverSettings.roleInspector} className="rounded-2xl border border-white/[.07] bg-panel p-4">
    <div className="flex items-center gap-2">
      <span aria-hidden className="size-3.5 shrink-0 rounded-full" style={{ backgroundColor: (noColor ? null : color) ?? "transparent", border: (noColor ? null : color) ? "none" : "1px solid rgba(255,255,255,.25)" }} />
      <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-slate-100">{t.serverSettings.roleInspector}</h2>
      <span className="shrink-0 rounded-full bg-white/[.06] px-2 py-0.5 text-[10px] font-semibold text-slate-400">{t.serverSettings.roleAssignedCount(memberCount)}</span>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1.5 text-xs font-medium text-slate-300">{t.serverSettings.roleName}<Input value={name} onChange={(event) => { setName(event.target.value); setSaved(false); }} minLength={2} maxLength={32} disabled={!canManageRoles} /></label>
      <div className="grid gap-1.5 text-xs font-medium text-slate-300">{t.serverSettings.rolePosition}
        <div className="flex items-center gap-1.5">
          <Button variant="secondary" size="sm" aria-label={t.serverSettings.roleMoveDown} onClick={() => move(-1)} disabled={!canManageRoles || position <= 0} className="shrink-0 px-2"><ChevronDown className="size-4" /></Button>
          <Input type="number" aria-label={t.serverSettings.rolePosition} value={position} onChange={(event) => { setPosition(Number(event.target.value)); setSaved(false); }} min={0} max={9_999} disabled={!canManageRoles} className="min-w-0 flex-1" />
          <Button variant="secondary" size="sm" aria-label={t.serverSettings.roleMoveUp} onClick={() => move(1)} disabled={!canManageRoles || position >= 9_999} className="shrink-0 px-2"><ChevronUp className="size-4" /></Button>
        </div>
      </div>
    </div>
    <div className="mt-4">
      <p className="text-xs font-medium text-slate-300">{t.serverSettings.roleColor}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {canManageRoles
          ? <ColorSwatchPicker value={color} onChange={(next) => { setColor(next); setNoColor(false); setSaved(false); }} groupLabel={t.serverSettings.roleColor} customLabel={t.serverSettings.roleColor} />
          : <span aria-hidden className="size-8 shrink-0 rounded-full" style={{ backgroundColor: role.color ?? "transparent", border: role.color ? "none" : "1px solid rgba(255,255,255,.25)" }} />}
        <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={noColor} onChange={(event) => { setNoColor(event.target.checked); setSaved(false); }} disabled={!canManageRoles} />{t.serverSettings.roleNoColor}</label>
      </div>
    </div>
    <div className="mt-4 space-y-4">
      {ROLE_PERMISSION_GROUPS.map((group) => <div key={group.key}>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{groupTitles[group.key]}</h3>
        <div className="mt-1.5 grid gap-0.5">
          {group.permissions.map((permission) => <label key={permission} className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-white/[.04]">
            <input type="checkbox" checked={permissions.includes(permission)} onChange={() => togglePermission(permission)} disabled={!canManageRoles} className="mt-0.5" />
            <span className="min-w-0"><code className="text-xs text-slate-200">{permission}</code><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{t.serverSettings.rolePermDescriptions[permission]}</span></span>
          </label>)}
        </div>
      </div>)}
    </div>
    {canManageRoles && onUpdateRole && <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-white/[.06] pt-3">
      {dirty
        ? <span className="text-[11px] font-medium text-amber-200/80">{t.serverSettings.roleUnsavedChanges}</span>
        : saved ? <span className="text-[11px] font-medium text-emerald-300/80">{t.serverSettings.roleSaved}</span> : null}
      <Button size="sm" onClick={save} disabled={!dirty || name.trim().length < 2}>{t.server.saveSettings}</Button>
    </div>}
    {canManageRoles && onDeleteRole && <div className="mt-3 rounded-xl border border-red-400/15 p-3">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-red-200/80">{t.serverSettings.roleDangerZone}</h3>
      <p className="mt-1 text-[11px] leading-4 text-red-100/60">{t.serverSettings.roleDangerHint}</p>
      {!confirming
        ? <div className="mt-2 flex justify-end"><Button variant="danger" size="sm" onClick={() => setConfirming(true)}>{t.serverSettings.roleDelete}</Button></div>
        : <div role="alertdialog" aria-label={t.serverSettings.roleDeleteConfirm(role.name)} className="mt-2 rounded-xl border border-red-400/15 bg-red-400/[.055] p-3"><p className="text-xs leading-5 text-red-100/80">{t.serverSettings.roleDeleteConfirm(role.name)}</p><div className="mt-3 flex justify-end gap-2"><Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>{t.common.cancel}</Button><Button variant="danger" size="sm" onClick={() => onDeleteRole(role.id)}>{t.serverSettings.roleDelete}</Button></div></div>}
    </div>}
  </section>;
}

function RoleManagementBoard({ server, profile, canManageRoles, onSetRole }: { server: MockServer; profile: LocalProfile; canManageRoles: boolean; onSetRole: (userId: string, role: "administrator" | "member") => void }): React.ReactElement {
  const { t } = useI18n();
  const owners = server.members.filter((member) => member.serverRole === "owner");
  const administrators = server.members.filter((member) => member.serverRole === "administrator");
  const members = server.members.filter((member) => member.serverRole === "member");
  return <div className="grid items-start gap-4 lg:grid-cols-3">
    <RoleColumn title={t.serverSettings.creatorColumn} members={owners} empty={t.serverSettings.noCreator} profile={profile} />
    <RoleColumn title={t.serverSettings.administratorsColumn} members={administrators} empty={t.serverSettings.noAdministrators} profile={profile} action={canManageRoles ? t.members.removeAdmin : undefined} onAction={canManageRoles ? (member) => onSetRole(member.id, "member") : undefined} />
    <RoleColumn title={t.serverSettings.membersColumn} members={members} empty={t.serverSettings.noMembers} profile={profile} action={canManageRoles ? t.members.makeAdmin : undefined} onAction={canManageRoles ? (member) => onSetRole(member.id, "administrator") : undefined} />
  </div>;
}

function RoleColumn({ title, members, empty, profile, action, onAction }: { title: string; members: MockMember[]; empty: string; profile: LocalProfile; action?: string; onAction?: (member: MockMember) => void }): React.ReactElement {
  const { t } = useI18n();
  return <section className="min-w-0 overflow-hidden rounded-2xl border border-white/[.07] bg-panel">
    <header className="flex items-center justify-between border-b border-white/[.06] px-4 py-3"><h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">{title}</h2><span className="rounded-full bg-white/[.06] px-2 py-0.5 text-[10px] font-semibold text-slate-400">{members.length}</span></header>
    <div className="space-y-2 p-3">
      {members.length === 0 && <p className="px-2 py-8 text-center text-xs text-slate-500">{empty}</p>}
      {members.map((member) => {
        const glow = member.nameGlow ?? (member.id === profile.id ? profile.nameGlow : undefined);
        const font = member.nameFont ?? (member.id === profile.id ? profile.nameFont : undefined);
        return <div key={member.id} className="rounded-xl border border-white/[.055] bg-black/10 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <ProfilePreview profile={{ username: member.username, discriminator: member.discriminator, fingerprint: member.fingerprint, avatar: member.avatar, banner: member.banner, accentColor: member.accentColor ?? (member.id === profile.id ? profile.accentColor : undefined), nameGlow: glow, nameFont: font, bio: member.bio, role: member.role, status: member.status, customStatus: member.customStatus, customStatusEmoji: member.customStatusEmoji, isCurrentUser: member.id === profile.id }}>
            <Avatar name={member.username} image={member.avatar ?? (member.id === profile.id ? profile.avatar : null)} color={member.avatarColor} size="md" status={member.status} />
          </ProfilePreview>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-200" style={nicknameStyle(font, glow)}>{member.username}</p><p className="truncate text-[10px] text-slate-500">{member.role}</p></div>
        </div>
        {action && onAction && <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => onAction(member)}><UserCog className="size-3.5" />{action}</Button>}
      </div>;
      })}
    </div>
    <footer className="border-t border-white/[.05] px-4 py-2 text-[10px] text-slate-600">{t.serverSettings.usersInColumn(members.length)}</footer>
  </section>;
}

function BannedList({ members, canModerate, onUnban }: { members: BannedMember[]; canModerate: boolean; onUnban: (userId: string) => void }): React.ReactElement {
  const { t, locale } = useI18n();
  if (members.length === 0) return <EmptyState>{t.serverSettings.noBans}</EmptyState>;
  return <div className="space-y-2">{members.map((member) => <div key={member.id} className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-panel p-3">
    <ProfilePreview profile={{ username: member.username ?? t.chat.unknownUser, discriminator: member.discriminator ?? undefined, fingerprint: member.fingerprint, avatar: member.avatar, banner: member.banner, bio: member.bio, status: "offline" }}>
      <Avatar name={member.username ?? t.chat.unknownUser} image={member.avatar} size="md" />
    </ProfilePreview>
    <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-200">{member.username ?? t.chat.unknownUser}</p><p className="text-[10px] text-slate-500">{t.serverSettings.bannedAt(new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(member.bannedAt)))}</p><p className="text-[10px] text-slate-500">{member.expiresAt ? t.serverSettings.banExpiresAt(new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(member.expiresAt))) : t.serverSettings.permanentBan}</p></div>
    <Button variant="secondary" size="sm" disabled={!canModerate} onClick={() => onUnban(member.id)}><UserRoundCheck className="size-3.5" />{t.serverSettings.unbanAction}</Button>
  </div>)}</div>;
}

function BanManagementRow({ member, disabled, onBan }: { member: MockMember; disabled: boolean; onBan: (userId: string, durationMinutes: BanDurationMinutes) => void }): React.ReactElement {
  const { t } = useI18n();
  const [duration, setDuration] = useState<BanDurationMinutes>(1_440);
  const [confirming, setConfirming] = useState(false);
  function run(): void { onBan(member.id, duration); setConfirming(false); }
  return <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/[.07] bg-panel p-3">
    <ProfilePreview profile={{ username: member.username, discriminator: member.discriminator, fingerprint: member.fingerprint, avatar: member.avatar, banner: member.banner, accentColor: member.accentColor, nameGlow: member.nameGlow, nameFont: member.nameFont, bio: member.bio, role: member.role, status: member.status, customStatus: member.customStatus, customStatusEmoji: member.customStatusEmoji, isCurrentUser: false }}>
      <Avatar name={member.username} image={member.avatar} color={member.avatarColor} size="md" status={member.status} />
    </ProfilePreview>
    <div className="min-w-32 flex-1"><p className="truncate text-sm font-semibold text-slate-200" style={nicknameStyle(member.nameFont, member.nameGlow)}>{member.username}</p><p className="truncate text-[10px] text-slate-500">{member.role}</p></div>
    <Combobox label={t.serverSettings.banDurationLabel} value={duration === null ? "permanent" : String(duration)} placeholder={t.serverSettings.banDurationLabel} icon={Clock3} options={[...BAN_DURATION_MINUTES.map((minutes) => ({ value: String(minutes), label: t.serverSettings.banDuration(minutes) })), { value: "permanent", label: t.serverSettings.permanentBan }]} disabled={disabled} clearable={false} className="w-40 shrink-0" onChange={(value) => setDuration(value === "permanent" ? null : Number(value) as BanDurationMinutes)} />
    <Button variant="danger" size="sm" disabled={disabled || confirming} onClick={() => setConfirming(true)}>{t.serverSettings.banAction}</Button>
    {confirming && <div role="alertdialog" aria-label={t.serverSettings.confirmBan(member.username)} className="basis-full rounded-xl border border-red-400/15 bg-red-400/[.055] p-3"><p className="text-xs leading-5 text-red-100/80">{t.serverSettings.confirmBan(member.username)}</p><div className="mt-3 flex justify-end gap-2"><Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>{t.common.cancel}</Button><Button variant="danger" size="sm" onClick={run}>{t.serverSettings.banAction}</Button></div></div>}
  </div>;
}

function MemberManagementRow({ member, profile, isCurrentUser, action, confirmText, disabled, destructive, onAction }: { member: MockMember; profile: LocalProfile; isCurrentUser: boolean; action: string; confirmText?: string; disabled: boolean; destructive: boolean; onAction: () => void }): React.ReactElement {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  function run(): void { onAction(); setConfirming(false); }
  const glow = member.nameGlow ?? (isCurrentUser ? profile.nameGlow : undefined);
  const font = member.nameFont ?? (isCurrentUser ? profile.nameFont : undefined);
  return <div className="rounded-2xl border border-white/[.07] bg-panel p-3">
    <div className="flex items-center gap-3">
      <ProfilePreview profile={{ username: member.username, discriminator: member.discriminator, fingerprint: member.fingerprint, avatar: member.avatar, banner: member.banner, accentColor: member.accentColor ?? (isCurrentUser ? profile.accentColor : undefined), nameGlow: glow, nameFont: font, bio: member.bio, role: member.role, status: member.status, customStatus: member.customStatus, customStatusEmoji: member.customStatusEmoji, isCurrentUser }}>
        <Avatar name={member.username} image={member.avatar ?? (isCurrentUser ? profile.avatar : null)} color={member.avatarColor} size="md" status={member.status} />
      </ProfilePreview>
      <div className="min-w-0 flex-1"><p className="flex items-center gap-1 truncate text-sm font-semibold text-slate-200" style={nicknameStyle(font, glow)}>{member.serverRole === "administrator" && <ShieldCheck className="size-3.5 shrink-0 text-violet-300" />}{member.username}</p><p className="truncate text-[10px] text-slate-500">{member.role}</p></div>
      <Button variant={destructive ? "danger" : "secondary"} size="sm" disabled={disabled || confirming} onClick={() => confirmText ? setConfirming(true) : run()}>{action}</Button>
    </div>
    {confirming && confirmText && <div role="alertdialog" aria-label={confirmText} className="mt-3 rounded-xl border border-red-400/15 bg-red-400/[.055] p-3"><p className="text-xs leading-5 text-red-100/80">{confirmText}</p><div className="mt-3 flex justify-end gap-2"><Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>{t.common.cancel}</Button><Button variant="danger" size="sm" onClick={run}>{action}</Button></div></div>}
  </div>;
}

function NavigationButton({ active, compact = false, icon, onClick, children }: { active: boolean; compact?: boolean; icon: React.ReactNode; onClick: () => void; children: React.ReactNode }): React.ReactElement {
  return <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-2 rounded-lg px-3 text-left font-medium transition", compact ? "py-2 text-xs" : "py-2.5 text-sm", active ? "bg-violet-500/15 text-violet-200" : "text-slate-500 hover:bg-white/[.04] hover:text-slate-200")}>{icon}{children}</button>;
}

function PageHeading({ title, description }: { title: string; description: string }): React.ReactElement {
  return <div className="mb-6"><h1 className="text-2xl font-bold text-white">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p></div>;
}

function EmptyState({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="rounded-2xl border border-dashed border-white/10 px-5 py-10 text-center text-sm text-slate-500">{children}</div>;
}
