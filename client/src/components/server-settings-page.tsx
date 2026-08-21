"use client";

import { useState } from "react";
import Image from "next/image";
import { Ban, Camera, Clock3, Image as ImageIcon, ShieldCheck, UserCog, UserMinus, UserRoundCheck, Users, X } from "lucide-react";
import { BAN_DURATION_MINUTES, type BanDurationMinutes, type BannedMember, type MemberRole, type Permission, type ServerSettings } from "@opencord/shared";
import { Avatar } from "@/components/avatar";
import { ProfilePreview } from "@/components/profile-preview";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { LocalProfile, MockMember, MockServer } from "@/shared/state";

type SettingsPage = "visual" | "users";
type UsersPage = "overview" | "kick" | "ban" | "unban";
type Access = { id: string; role: MemberRole; permissions: Permission[] };

export function ServerSettingsPage({ server, profile, access, onClose, onAvatar, onBanner, onSaveSettings, onSetRole, onKick, onBan, onUnban }: { server: MockServer; profile: LocalProfile; access: Access; onClose: () => void; onAvatar: () => void; onBanner: () => void; onSaveSettings: (settings: ServerSettings) => boolean; onSetRole: (userId: string, role: "administrator" | "member") => void; onKick: (userId: string) => void; onBan: (userId: string, durationMinutes: BanDurationMinutes) => void; onUnban: (userId: string) => void }): React.ReactElement {
  const { t } = useI18n();
  const [page, setPage] = useState<SettingsPage>("visual");
  const [usersPage, setUsersPage] = useState<UsersPage>("overview");
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description ?? "");
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
      screenShareMaxResolution: server.screenShareMaxResolution ?? 1080,
      screenShareMaxFrameRate: server.screenShareMaxFrameRate ?? 60,
    });
  }

  return (
    <section className="absolute inset-y-0 left-[76px] z-20 flex min-w-0 flex-1 overflow-hidden bg-[#212327] max-sm:flex-col" style={{ right: 0 }}>
      <aside className="w-64 shrink-0 border-r border-white/[.055] bg-[#191b1e] px-3 py-4 max-sm:w-full max-sm:border-b max-sm:border-r-0">
        <div className="mb-5 flex items-center gap-3 px-2">
          <Avatar name={server.name} image={server.avatar} color={server.accent} size="sm" />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-white">{server.name}</p><p className="text-[10px] text-slate-500">{t.serverSettings.title}</p></div>
          <button type="button" aria-label={t.serverSettings.close} onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-200"><X className="size-4" /></button>
        </div>
        <nav className="space-y-1 max-sm:grid max-sm:grid-cols-2 max-sm:gap-1 max-sm:space-y-0">
          <NavigationButton active={page === "visual"} icon={<Camera className="size-4" />} onClick={() => setPage("visual")}>{t.serverSettings.visual}</NavigationButton>
          <NavigationButton active={page === "users"} icon={<Users className="size-4" />} onClick={() => setPage("users")}>{t.serverSettings.users}</NavigationButton>
        </nav>
        {page === "users" && <nav className="mt-4 space-y-1 border-t border-white/[.06] pt-4 max-sm:grid max-sm:grid-cols-2 max-sm:gap-1 max-sm:space-y-0">
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
            <div className="overflow-hidden rounded-3xl border border-white/[.08] bg-[#26282c]">
              <div className="relative h-48 bg-primary/15">{server.banner && <Image src={server.banner} alt="" fill unoptimized sizes="768px" className="object-cover" />}</div>
              <div className="relative px-6 pb-6 pt-14">
                <div className="absolute -top-11 left-6"><Avatar name={server.name} image={server.avatar} color={server.accent} size="xl" className="ring-4 ring-[#26282c]" /></div>
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
        ) : (
          <UserSettings server={server} profile={profile} access={access} page={usersPage} canManageRoles={canManageRoles} canModerate={canModerate} onSetRole={onSetRole} onKick={onKick} onBan={onBan} onUnban={onUnban} />
        )}
      </div>
    </section>
  );
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
          return <MemberManagementRow key={member.id} member={member} profile={profile} isCurrentUser={false} action={action} confirmText={t.serverSettings.confirmKick(member.displayName)} disabled={disabled} destructive={destructive} onAction={run} />;
        })}
      </div>
    )}
  </div>;
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
  return <section className="min-w-0 overflow-hidden rounded-2xl border border-white/[.07] bg-[#26282c]">
    <header className="flex items-center justify-between border-b border-white/[.06] px-4 py-3"><h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">{title}</h2><span className="rounded-full bg-white/[.06] px-2 py-0.5 text-[10px] font-semibold text-slate-400">{members.length}</span></header>
    <div className="space-y-2 p-3">
      {members.length === 0 && <p className="px-2 py-8 text-center text-xs text-slate-500">{empty}</p>}
      {members.map((member) => <div key={member.id} className="rounded-xl border border-white/[.055] bg-black/10 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <ProfilePreview profile={{ displayName: member.displayName, username: member.username, discriminator: member.discriminator, fingerprint: member.fingerprint, avatar: member.avatar, banner: member.banner, bio: member.bio, role: member.role, status: member.status, customStatus: member.customStatus, customStatusColor: member.customStatusColor, isCurrentUser: member.id === profile.id }}>
            <Avatar name={member.displayName} image={member.avatar ?? (member.id === profile.id ? profile.avatar : null)} color={member.avatarColor} size="md" status={member.status} statusColor={member.customStatus ? member.customStatusColor : undefined} />
          </ProfilePreview>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-200">{member.displayName}</p><p className="truncate text-[10px] text-slate-500">{member.role}</p></div>
        </div>
        {action && onAction && <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => onAction(member)}><UserCog className="size-3.5" />{action}</Button>}
      </div>)}
    </div>
    <footer className="border-t border-white/[.05] px-4 py-2 text-[10px] text-slate-600">{t.serverSettings.usersInColumn(members.length)}</footer>
  </section>;
}

function BannedList({ members, canModerate, onUnban }: { members: BannedMember[]; canModerate: boolean; onUnban: (userId: string) => void }): React.ReactElement {
  const { t, locale } = useI18n();
  if (members.length === 0) return <EmptyState>{t.serverSettings.noBans}</EmptyState>;
  return <div className="space-y-2">{members.map((member) => <div key={member.id} className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-[#26282c] p-3">
    <ProfilePreview profile={{ displayName: member.displayName, username: member.username ?? undefined, discriminator: member.discriminator ?? undefined, fingerprint: member.fingerprint, avatar: member.avatar, banner: member.banner, bio: member.bio, status: "offline" }}>
      <Avatar name={member.displayName} image={member.avatar} size="md" />
    </ProfilePreview>
    <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-200">{member.displayName}</p><p className="text-[10px] text-slate-500">{t.serverSettings.bannedAt(new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(member.bannedAt)))}</p><p className="text-[10px] text-slate-500">{member.expiresAt ? t.serverSettings.banExpiresAt(new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(member.expiresAt))) : t.serverSettings.permanentBan}</p></div>
    <Button variant="secondary" size="sm" disabled={!canModerate} onClick={() => onUnban(member.id)}><UserRoundCheck className="size-3.5" />{t.serverSettings.unbanAction}</Button>
  </div>)}</div>;
}

function BanManagementRow({ member, disabled, onBan }: { member: MockMember; disabled: boolean; onBan: (userId: string, durationMinutes: BanDurationMinutes) => void }): React.ReactElement {
  const { t } = useI18n();
  const [duration, setDuration] = useState<BanDurationMinutes>(1_440);
  const [confirming, setConfirming] = useState(false);
  function run(): void { onBan(member.id, duration); setConfirming(false); }
  return <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/[.07] bg-[#26282c] p-3">
    <ProfilePreview profile={{ displayName: member.displayName, username: member.username, discriminator: member.discriminator, fingerprint: member.fingerprint, avatar: member.avatar, banner: member.banner, bio: member.bio, role: member.role, status: member.status, customStatus: member.customStatus, customStatusColor: member.customStatusColor, isCurrentUser: false }}>
      <Avatar name={member.displayName} image={member.avatar} color={member.avatarColor} size="md" status={member.status} statusColor={member.customStatus ? member.customStatusColor : undefined} />
    </ProfilePreview>
    <div className="min-w-32 flex-1"><p className="truncate text-sm font-semibold text-slate-200">{member.displayName}</p><p className="truncate text-[10px] text-slate-500">{member.role}</p></div>
    <Combobox label={t.serverSettings.banDurationLabel} value={duration === null ? "permanent" : String(duration)} placeholder={t.serverSettings.banDurationLabel} icon={Clock3} options={[...BAN_DURATION_MINUTES.map((minutes) => ({ value: String(minutes), label: t.serverSettings.banDuration(minutes) })), { value: "permanent", label: t.serverSettings.permanentBan }]} disabled={disabled} clearable={false} className="w-40 shrink-0" onChange={(value) => setDuration(value === "permanent" ? null : Number(value) as BanDurationMinutes)} />
    <Button variant="danger" size="sm" disabled={disabled || confirming} onClick={() => setConfirming(true)}>{t.serverSettings.banAction}</Button>
    {confirming && <div role="alertdialog" aria-label={t.serverSettings.confirmBan(member.displayName)} className="basis-full rounded-xl border border-red-400/15 bg-red-400/[.055] p-3"><p className="text-xs leading-5 text-red-100/80">{t.serverSettings.confirmBan(member.displayName)}</p><div className="mt-3 flex justify-end gap-2"><Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>{t.common.cancel}</Button><Button variant="danger" size="sm" onClick={run}>{t.serverSettings.banAction}</Button></div></div>}
  </div>;
}

function MemberManagementRow({ member, profile, isCurrentUser, action, confirmText, disabled, destructive, onAction }: { member: MockMember; profile: LocalProfile; isCurrentUser: boolean; action: string; confirmText?: string; disabled: boolean; destructive: boolean; onAction: () => void }): React.ReactElement {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  function run(): void { onAction(); setConfirming(false); }
  return <div className="rounded-2xl border border-white/[.07] bg-[#26282c] p-3">
    <div className="flex items-center gap-3">
      <ProfilePreview profile={{ displayName: member.displayName, username: member.username, discriminator: member.discriminator, fingerprint: member.fingerprint, avatar: member.avatar, banner: member.banner, bio: member.bio, role: member.role, status: member.status, customStatus: member.customStatus, customStatusColor: member.customStatusColor, isCurrentUser }}>
        <Avatar name={member.displayName} image={member.avatar ?? (isCurrentUser ? profile.avatar : null)} color={member.avatarColor} size="md" status={member.status} statusColor={member.customStatus ? member.customStatusColor : undefined} />
      </ProfilePreview>
      <div className="min-w-0 flex-1"><p className="flex items-center gap-1 truncate text-sm font-semibold text-slate-200">{member.serverRole === "administrator" && <ShieldCheck className="size-3.5 shrink-0 text-violet-300" />}{member.displayName}</p><p className="truncate text-[10px] text-slate-500">{member.role}</p></div>
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
