"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MemberRole, Permission, ServerEvent } from "@opencord/shared";
import { Bell, ChevronDown, Hash, HelpCircle, LogIn, LogOut, MessageCircle, MoreHorizontal, Pencil, Plus, Search, Send, Settings, ShieldCheck, Smile, Trash2, UserCog, Users, Volume2 } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { DeploymentDialog } from "@/components/deployment-dialog";
import { Onboarding } from "@/components/onboarding";
import { ProfileDialog } from "@/components/profile-dialog";
import { ServerDialog } from "@/components/server-dialog";
import { SettingsDialog } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useServerConnection, type ConnectionStatus } from "@/hooks/use-server-connection";
import { ru } from "@/lib/i18n/ru";
import { cn, createId, initials } from "@/lib/utils";
import { sameServerAddress } from "@/lib/server-address";
import { createDefaultState, type LocalProfile, type MockChannel, type MockMember, type MockMessage, type MockServer, type PersistedClientState } from "@/shared/state";

type Modal = "create" | "connect" | "profile" | "settings" | "leave" | "channel" | "channel-edit" | "channel-delete" | null;
type CurrentAccess = { id: string; role: MemberRole; permissions: Permission[] };

export function ClientApp(): React.ReactElement {
  const [state, setState] = useState<PersistedClientState | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [managedChannel, setManagedChannel] = useState<MockChannel | null>(null);
  const [accessByServer, setAccessByServer] = useState<Record<string, CurrentAccess>>({});
  const messageEndRef = useRef<HTMLDivElement>(null);
  const connectionServer = state?.servers.find((server) => server.id === state.activeServerId);
  const connection = useServerConnection(connectionServer, state?.profile, {
    onSnapshot: (snapshot) => {
      if (!snapshot.channels.some((channel) => channel.id === state?.activeChannelId)) setDraft("");
      if (connectionServer) setAccessByServer((current) => ({ ...current, [connectionServer.id]: snapshot.currentUser }));
      commit((current) => applyServerSnapshot(current, snapshot));
    },
    onHistory: (channelId, messages) => commit((current) => ({ ...current, messages: [...current.messages.filter((message) => message.channelId !== channelId), ...messages.map(toLocalMessage)] })),
    onMessage: (message) => commit((current) => current.messages.some((item) => item.id === message.id) ? current : { ...current, messages: [...current.messages, toLocalMessage(message)] }),
    onMember: (member) => commit((current) => ({ ...current, servers: current.servers.map((server) => server.id !== current.activeServerId ? server : { ...server, members: [...server.members.filter((item) => item.id !== member.id), { id: member.id, displayName: member.displayName, role: roleLabel(member.role), serverRole: member.role, status: member.status, avatarColor: colorFromId(member.id) }] }) })),
    onServerDeleted: () => {
      if (!connectionServer) return;
      const deletedAddress = connectionServer.address;
      commit((current) => removeServers(current, (server) => server.id === connectionServer.id || sameServerAddress(server.address, deletedAddress)));
      setModal(null); setDraft(""); setNotice(ru.server.deleted);
    },
    onError: setNotice,
  });

  useEffect(() => {
    const bridge = window.openCord?.storage;
    const loading = bridge ? withTimeout(bridge.load(), 3_000) : Promise.resolve(createDefaultState());
    void loading.then(setState).catch((error: unknown) => {
      console.error("Failed to load Electron client state", error);
      setState(createDefaultState());
      setNotice("Локальное хранилище не ответило — загружено начальное состояние");
    });
  }, []);

  useEffect(() => { messageEndRef.current?.scrollIntoView?.({ block: "end" }); }, [state?.messages, state?.activeChannelId]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 2800); return () => window.clearTimeout(timer); }, [notice]);

  function commit(update: (current: PersistedClientState) => PersistedClientState): void {
    setState((current) => {
      if (!current) return current;
      const next = update(current);
      void window.openCord?.storage.save(next).catch(() => setNotice("Не удалось сохранить локальные данные"));
      return next;
    });
  }

  if (!state) return <div className="grid flex-1 place-items-center bg-[#090b12] text-sm text-slate-500">Загрузка OpenCord…</div>;

  if (!state.onboardingComplete || !state.profile) {
    return <Onboarding onComplete={(profile) => commit((current) => ({ ...current, profile, onboardingComplete: true }))} />;
  }

  const profile = state.profile;
  const activeServer = state.servers.find((server) => server.id === state.activeServerId);
  const currentAccess = activeServer ? accessByServer[activeServer.id] : undefined;
  const activeChannel = activeServer?.channels.find((channel) => channel.id === state.activeChannelId) ?? activeServer?.channels.find((channel) => channel.kind === "text");
  const messages = activeChannel ? state.messages.filter((message) => message.channelId === activeChannel.id) : [];

  function selectServer(server: MockServer): void {
    const channel = server.channels.find((item) => item.kind === "text");
    commit((current) => ({ ...current, activeServerId: server.id, activeChannelId: channel?.id ?? null }));
  }

  function openHome(): void {
    commit((current) => ({ ...current, activeServerId: null, activeChannelId: null }));
    setDraft("");
  }

  function addServer(server: MockServer): boolean {
    if (!state) return false;
    const duplicate = server.address ? state.servers.find((existing) => sameServerAddress(existing.address, server.address)) : undefined;
    if (duplicate) {
      selectServer(duplicate);
      setNotice(ru.server.duplicateAddress);
      return false;
    }
    commit((current) => ({ ...current, servers: [...current.servers, server], activeServerId: server.id, activeChannelId: server.channels[0]?.id ?? null }));
    setNotice(server.address ? "Сервер добавлен, подключаемся…" : "Локальный макет сервера добавлен");
    return true;
  }

  function addDeployedServer(serverUrl: string, serverName: string): void {
    commit((current) => upsertDeployedServer(current, serverUrl, serverName));
    setNotice("Сервер развёрнут и заменил прежнюю запись с этим адресом");
  }

  function leaveServer(serverId: string): void {
    if (!state) return;
    const leavingServer = state.servers.find((server) => server.id === serverId);
    if (!leavingServer) return;
    commit((current) => removeServers(current, (server) => server.id === serverId));
    setModal(null);
    setDraft("");
    setNotice(ru.server.left);
  }

  function deleteServerForEveryone(): void {
    if (!connection.deleteServer()) { setNotice("Сервер сейчас недоступен для удаления"); return; }
    setNotice(ru.server.deleteRequested);
  }

  function sendMessage(event: React.FormEvent): void {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !activeChannel) return;
    if (activeServer?.address) {
      if (!connection.sendMessage(activeChannel.id, content)) { setNotice("Сервер ещё не готов принимать сообщения"); return; }
      setDraft("");
      return;
    }
    const message: MockMessage = { id: createId("message"), channelId: activeChannel.id, authorId: profile.id, authorName: profile.displayName, authorColor: "#7c5cff", content, createdAt: new Date().toISOString() };
    commit((current) => ({ ...current, messages: [...current.messages, message] }));
    setDraft("");
  }

  function createServerChannel(name: string, kind: "text" | "voice", description: string): void {
    if (!connection.createChannel(name, kind, description)) { setNotice("Сервер ещё не готов создать канал"); return; }
    setModal(null);
    setNotice("Запрос на создание канала отправлен");
  }

  function editServerChannel(channel: MockChannel, name: string, description: string): void {
    if (!connection.updateChannel(channel.id, name, description)) { setNotice(ru.channel.updateUnavailable); return; }
    setModal(null); setManagedChannel(null); setNotice(ru.channel.updateRequested);
  }

  function deleteServerChannel(channel: MockChannel): void {
    if (!connection.deleteChannel(channel.id)) { setNotice(ru.channel.deleteUnavailable); return; }
    setModal(null); setManagedChannel(null); setNotice(ru.channel.deleteRequested);
  }

  function openChannelModal(channel: MockChannel, action: "channel-edit" | "channel-delete"): void {
    setManagedChannel(channel);
    setModal(action);
  }

  function setServerMemberRole(userId: string, role: "administrator" | "member"): void {
    if (!connection.setMemberRole(userId, role)) { setNotice("Сервер ещё не готов изменить роль"); return; }
    setNotice(role === "administrator" ? "Пользователю назначается роль администратора" : "Роль администратора снимается");
  }

  async function reset(): Promise<void> {
    const resetState = window.openCord ? await window.openCord.storage.reset() : createDefaultState();
    setState(resetState); setConfirmReset(false); setModal(null);
  }

  return (
    <main className="relative flex min-h-0 flex-1 overflow-hidden bg-[#0c0f17] text-slate-200">
      <ServerRail servers={state.servers} activeId={activeServer?.id} onHome={openHome} onSelect={selectServer} onCreate={() => setModal("create")} onConnect={() => setModal("connect")} />
      {activeServer ? <>
        <ChannelSidebar server={activeServer} activeChannelId={activeChannel?.id} profile={state.profile} canManageChannels={currentAccess?.permissions.includes("MANAGE_CHANNELS") === true} onCreateChannel={() => setModal("channel")} onEditChannel={(channel) => openChannelModal(channel, "channel-edit")} onDeleteChannel={(channel) => openChannelModal(channel, "channel-delete")} onSelectChannel={(channelId) => commit((current) => ({ ...current, activeChannelId: channelId }))} onServerMenu={() => setModal("leave")} onProfile={() => setModal("profile")} onSettings={() => setModal("settings")} onVoiceNotice={() => setNotice(ru.channel.voiceUnavailable)} />
        {activeChannel ? <section className="flex min-w-0 flex-1 flex-col bg-[#111520]">
          <ChatHeader channelName={activeChannel?.name ?? "канал"} description={activeChannel?.description ?? ""} connectionStatus={activeServer.address ? connection.status : "demo"} memberList={state.preferences.showMemberList} onToggleMembers={() => commit((current) => ({ ...current, preferences: { ...current.preferences, showMemberList: !current.preferences.showMemberList } }))} />
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className={cn("scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-5", state.preferences.compactMode && "py-3")}>
                <ChannelIntro name={activeChannel?.name ?? "канал"} description={activeChannel?.description ?? ""} networked={Boolean(activeServer.address)} />
                {messages.length ? messages.map((message, index) => <Message key={message.id} message={message} compact={state.preferences.compactMode} grouped={index > 0 && messages[index - 1]?.authorId === message.authorId} ownAvatar={message.authorId === state.profile?.id ? state.profile?.avatar : null} />) : <p className="py-8 text-center text-sm text-slate-600">{ru.chat.empty}</p>}
                <div ref={messageEndRef} />
              </div>
              <Composer draft={draft} channelName={activeChannel?.name ?? "канал"} disabled={Boolean(activeServer.address && connection.status !== "connected")} onDraft={setDraft} onSubmit={sendMessage} />
            </div>
            {state.preferences.showMemberList && <MemberList server={activeServer} profile={state.profile} access={currentAccess} onSetRole={setServerMemberRole} />}
          </div>
        </section> : <NoTextChannelView server={activeServer} profile={state.profile} access={currentAccess} connectionStatus={activeServer.address ? connection.status : "demo"} showMembers={state.preferences.showMemberList} onCreate={() => setModal("channel")} onToggleMembers={() => commit((current) => ({ ...current, preferences: { ...current.preferences, showMemberList: !current.preferences.showMemberList } }))} onSetRole={setServerMemberRole} />}
      </> : <HomeScreen serverCount={state.servers.length} onCreate={() => setModal("create")} onConnect={() => setModal("connect")} />}
      {notice && <div role="status" className="absolute bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-xl border border-white/10 bg-[#191e2b] px-4 py-2.5 text-xs font-medium text-slate-200 shadow-2xl">{notice}</div>}
      <DeploymentDialog open={modal === "create"} onOpenChange={(open) => setModal(open ? "create" : null)} onDeployed={addDeployedServer} />
      <ServerDialog open={modal === "connect"} onOpenChange={(open) => setModal(open ? "connect" : null)} onAdd={addServer} />
      <ProfileDialog key={modal === "profile" ? "profile-open" : "profile-closed"} profile={state.profile} open={modal === "profile"} onOpenChange={(open) => setModal(open ? "profile" : null)} onSave={(profile) => commit((current) => ({ ...current, profile, messages: current.messages.map((message) => message.authorId === profile.id ? { ...message, authorName: profile.displayName } : message) }))} />
      <SettingsDialog preferences={state.preferences} open={modal === "settings"} confirmReset={confirmReset} onOpenChange={(open) => { setModal(open ? "settings" : null); if (!open) setConfirmReset(false); }} onPreferences={(preferences) => commit((current) => ({ ...current, preferences }))} onRequestReset={() => setConfirmReset(true)} onCancelReset={() => setConfirmReset(false)} onReset={() => void reset()} />
      {activeServer && <LeaveServerDialog server={activeServer} canDeleteForAll={currentAccess?.permissions.includes("DELETE_SERVER") === true} open={modal === "leave"} onOpenChange={(open) => setModal(open ? "leave" : null)} onConfirm={() => leaveServer(activeServer.id)} onDeleteForAll={deleteServerForEveryone} />}
      <ChannelDialog open={modal === "channel"} onOpenChange={(open) => setModal(open ? "channel" : null)} onCreate={createServerChannel} />
      {managedChannel && <EditChannelDialog key={managedChannel.id} channel={managedChannel} open={modal === "channel-edit"} onOpenChange={(open) => { setModal(open ? "channel-edit" : null); if (!open) setManagedChannel(null); }} onSave={(name, description) => editServerChannel(managedChannel, name, description)} />}
      {managedChannel && <DeleteChannelDialog channel={managedChannel} open={modal === "channel-delete"} onOpenChange={(open) => { setModal(open ? "channel-delete" : null); if (!open) setManagedChannel(null); }} onConfirm={() => deleteServerChannel(managedChannel)} />}
    </main>
  );
}

function ServerRail({ servers, activeId, onHome, onSelect, onCreate, onConnect }: { servers: MockServer[]; activeId?: string; onHome: () => void; onSelect: (server: MockServer) => void; onCreate: () => void; onConnect: () => void }): React.ReactElement {
  return <nav aria-label="Серверы" className="flex w-[76px] shrink-0 flex-col items-center gap-2 border-r border-white/[.055] bg-[#090c13] py-3">
    <button aria-label={ru.nav.friends} title={ru.nav.friends} onClick={onHome} className={cn("mb-1 grid size-12 place-items-center bg-gradient-to-br from-violet-500 to-cyan-400 text-lg font-black text-white shadow-[0_10px_32px_rgba(124,92,255,.25)] transition hover:rounded-[14px]", activeId ? "rounded-[18px]" : "rounded-[14px] ring-2 ring-white/70 ring-offset-2 ring-offset-[#090c13]")}>O</button><div className="h-px w-8 bg-white/8" />
    <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-1">{servers.map((server) => <button key={server.id} title={server.name} onClick={() => onSelect(server)} className={cn("group relative grid size-12 shrink-0 place-items-center rounded-[18px] bg-[#1a1f2d] text-xs font-bold text-slate-300 transition hover:rounded-[14px] hover:bg-violet-500 hover:text-white", activeId === server.id && "rounded-[14px] bg-violet-500 text-white")}><span className={cn("absolute -left-3 w-1 rounded-r-full bg-white transition-all", activeId === server.id ? "h-8" : "h-0 group-hover:h-5")} />{initials(server.name)}</button>)}</div>
    <button title={ru.server.create} onClick={onCreate} className="grid size-11 shrink-0 place-items-center rounded-[17px] bg-emerald-400/8 text-emerald-400 transition hover:rounded-[13px] hover:bg-emerald-500 hover:text-white"><Plus className="size-5" /></button>
    <button title={ru.server.connect} onClick={onConnect} className="grid size-11 shrink-0 place-items-center rounded-[17px] bg-cyan-400/8 text-cyan-300 transition hover:rounded-[13px] hover:bg-cyan-500 hover:text-white"><LogIn className="size-4" /></button>
  </nav>;
}

function HomeScreen({ serverCount, onCreate, onConnect }: { serverCount: number; onCreate: () => void; onConnect: () => void }): React.ReactElement {
  return <section className="flex min-w-0 flex-1 items-center justify-center bg-[radial-gradient(circle_at_50%_20%,rgba(124,92,255,.12),transparent_38%)] px-8">
    <div className="w-full max-w-2xl text-center">
      <div className="mx-auto mb-5 grid size-16 place-items-center rounded-3xl bg-gradient-to-br from-violet-500 to-cyan-400 text-2xl font-black text-white shadow-[0_18px_55px_rgba(124,92,255,.28)]">O</div>
      <p className="mb-2 text-xs font-bold uppercase tracking-[.18em] text-violet-300/70">{ru.appName}</p>
      <h1 className="text-3xl font-bold tracking-tight text-white">{ru.home.title}</h1>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-500">{ru.home.description(serverCount)}</p>
      <div className="mx-auto mt-8 grid max-w-lg grid-cols-2 gap-3">
        <Button onClick={onConnect} className="h-12"><LogIn className="size-4" />{ru.home.connect}</Button>
        <Button variant="secondary" onClick={onCreate} className="h-12"><Plus className="size-4" />{ru.home.create}</Button>
      </div>
    </div>
  </section>;
}

export function ChannelSidebar({ server, activeChannelId, profile, canManageChannels, onCreateChannel, onEditChannel, onDeleteChannel, onSelectChannel, onServerMenu, onProfile, onSettings, onVoiceNotice }: { server: MockServer; activeChannelId?: string; profile: LocalProfile; canManageChannels: boolean; onCreateChannel: () => void; onEditChannel: (channel: MockChannel) => void; onDeleteChannel: (channel: MockChannel) => void; onSelectChannel: (id: string) => void; onServerMenu: () => void; onProfile: () => void; onSettings: () => void; onVoiceNotice: () => void }): React.ReactElement {
  const textChannels = server.channels.filter((channel) => channel.kind === "text");
  const voiceChannels = server.channels.filter((channel) => channel.kind === "voice");
  const [contextMenu, setContextMenu] = useState<{ channel: MockChannel; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (): void => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  function openContextMenu(event: React.MouseEvent, channel: MockChannel): void {
    if (!canManageChannels) return;
    event.preventDefault();
    setContextMenu({ channel, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 200)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 112)) });
  }

  return <aside className="flex w-[262px] shrink-0 flex-col border-r border-white/[.055] bg-[#0e121b]">
    <button aria-label={`${ru.server.manage}: ${server.name}`} onClick={onServerMenu} className="flex h-14 items-center justify-between border-b border-white/[.055] px-4 text-left font-semibold text-slate-100 transition hover:bg-white/[.035]">{server.name}<ChevronDown className="size-4 text-slate-500" /></button>
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-4"><ChannelGroup title={ru.channel.text} canCreate={canManageChannels} onCreate={onCreateChannel}>{textChannels.map((channel) => <button key={channel.id} onClick={() => onSelectChannel(channel.id)} onContextMenu={(event) => openContextMenu(event, channel)} className={cn("mb-0.5 flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-500 transition hover:bg-white/[.045] hover:text-slate-200", activeChannelId === channel.id && "bg-white/[.065] text-slate-100")}><Hash className="size-4 shrink-0" /><span className="truncate">{channel.name}</span></button>)}</ChannelGroup>
    <ChannelGroup title={ru.channel.voice} canCreate={canManageChannels} onCreate={onCreateChannel}>{voiceChannels.map((channel) => <button key={channel.id} onClick={onVoiceNotice} onContextMenu={(event) => openContextMenu(event, channel)} className="mb-0.5 flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-600 transition hover:bg-white/[.035] hover:text-slate-400"><Volume2 className="size-4" />{channel.name}<span className="ml-auto rounded bg-white/5 px-1.5 py-0.5 text-[9px] uppercase">скоро</span></button>)}</ChannelGroup></div>
    <div className="flex h-14 items-center gap-2 border-t border-white/[.055] bg-[#0a0d14] px-2"><button onClick={onProfile} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-left hover:bg-white/5"><Avatar name={profile.displayName} image={profile.avatar} size="sm" status="online" /><span className="min-w-0"><span className="block truncate text-xs font-semibold text-slate-200">{profile.displayName}</span><span className="block text-[10px] text-emerald-400">{ru.common.online}</span></span></button><button title={ru.settings.title} onClick={onSettings} className="rounded-lg p-2 text-slate-500 hover:bg-white/6 hover:text-slate-200"><Settings className="size-4" /></button></div>
    {contextMenu && <div role="menu" aria-label={ru.channel.manageMenu(contextMenu.channel.name)} onPointerDown={(event) => event.stopPropagation()} className="fixed z-[80] w-48 rounded-xl border border-white/10 bg-[#171c28] p-1.5 shadow-[0_18px_55px_rgba(0,0,0,.55)]" style={{ left: contextMenu.x, top: contextMenu.y }}>
      <button role="menuitem" onClick={() => { const channel = contextMenu.channel; setContextMenu(null); onEditChannel(channel); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-300 hover:bg-white/[.06] hover:text-white"><Pencil className="size-3.5" />{ru.channel.edit}</button>
      <button role="menuitem" onClick={() => { const channel = contextMenu.channel; setContextMenu(null); onDeleteChannel(channel); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-red-300 hover:bg-red-400/10"><Trash2 className="size-3.5" />{ru.channel.delete}</button>
    </div>}
  </aside>;
}

function ChannelDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (open: boolean) => void; onCreate: (name: string, kind: "text" | "voice", description: string) => void }): React.ReactElement {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"text" | "voice">("text");
  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim(), kind, description.trim());
    setName(""); setDescription(""); setKind("text");
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{ru.channel.createTitle}</DialogTitle><DialogDescription>{ru.channel.createDescription}</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-4"><label className="grid gap-2 text-sm font-medium text-slate-300">{ru.channel.name}<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={48} required /></label><label className="grid gap-2 text-sm font-medium text-slate-300">{ru.channel.description}<Input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={120} /></label><div className="grid grid-cols-2 gap-2 rounded-xl bg-black/20 p-1"><button type="button" onClick={() => setKind("text")} className={cn("rounded-lg px-3 py-2 text-xs font-semibold", kind === "text" ? "bg-violet-500 text-white" : "text-slate-500")}># {ru.channel.textKind}</button><button type="button" onClick={() => setKind("voice")} className={cn("rounded-lg px-3 py-2 text-xs font-semibold", kind === "voice" ? "bg-violet-500 text-white" : "text-slate-500")}><Volume2 className="mr-1 inline size-3.5" />{ru.channel.voiceKind}</button></div><Button type="submit" className="w-full"><Plus className="size-4" />{ru.channel.createSubmit}</Button></form></DialogContent></Dialog>;
}

function EditChannelDialog({ channel, open, onOpenChange, onSave }: { channel: MockChannel; open: boolean; onOpenChange: (open: boolean) => void; onSave: (name: string, description: string) => void }): React.ReactElement {
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description);
  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim(), description.trim());
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><div className="mb-3 grid size-11 place-items-center rounded-2xl bg-violet-400/10 text-violet-300"><Pencil className="size-5" /></div><DialogTitle>{ru.channel.editTitle}</DialogTitle><DialogDescription>{ru.channel.editDescription(channel.name)}</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-4"><label className="grid gap-2 text-sm font-medium text-slate-300">{ru.channel.name}<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={48} required autoFocus /></label><label className="grid gap-2 text-sm font-medium text-slate-300">{ru.channel.description}<Input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={120} /></label><Button type="submit" className="w-full"><Pencil className="size-4" />{ru.channel.save}</Button></form></DialogContent></Dialog>;
}

function DeleteChannelDialog({ channel, open, onOpenChange, onConfirm }: { channel: MockChannel; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }): React.ReactElement {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><div className="mb-3 grid size-11 place-items-center rounded-2xl bg-red-400/10 text-red-300"><Trash2 className="size-5" /></div><DialogTitle>{ru.channel.deleteTitle}</DialogTitle><DialogDescription>{ru.channel.deleteDescription(channel.name)}</DialogDescription></DialogHeader><div className="flex gap-3"><Button variant="secondary" onClick={() => onOpenChange(false)} className="flex-1">{ru.common.cancel}</Button><Button variant="danger" onClick={onConfirm} className="flex-1"><Trash2 className="size-4" />{ru.channel.deleteConfirm}</Button></div></DialogContent></Dialog>;
}

function LeaveServerDialog({ server, canDeleteForAll, open, onOpenChange, onConfirm, onDeleteForAll }: { server: MockServer; canDeleteForAll: boolean; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void; onDeleteForAll: () => void }): React.ReactElement {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <div className="mb-3 grid size-11 place-items-center rounded-2xl bg-red-400/10 text-red-300"><LogOut className="size-5" /></div>
        <DialogTitle>{ru.server.leaveTitle}</DialogTitle>
        <DialogDescription>{server.address ? ru.server.leaveRemoteDescription(server.name) : ru.server.leaveLocalDescription(server.name)}</DialogDescription>
      </DialogHeader>
      <div className="flex gap-3">
        <Button variant="secondary" onClick={() => onOpenChange(false)} className="flex-1">{ru.server.leaveCancel}</Button>
        <Button variant="danger" onClick={onConfirm} className="flex-1"><LogOut className="size-4" />{ru.server.leaveConfirm}</Button>
      </div>
      {canDeleteForAll && server.address && <button onClick={onDeleteForAll} className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-xs font-semibold text-red-300 hover:bg-red-400/10"><Trash2 className="size-4" />{ru.server.deleteForAll}</button>}
      {canDeleteForAll && server.address && <p className="text-xs leading-5 text-red-200/55">{ru.server.deleteForAllDescription}</p>}
    </DialogContent>
  </Dialog>;
}

function ChannelGroup({ title, canCreate, onCreate, children }: { title: string; canCreate: boolean; onCreate: () => void; children: React.ReactNode }): React.ReactElement { return <section className="mb-6"><div className="mb-1 flex items-center px-2 text-[10px] font-bold uppercase tracking-[.12em] text-slate-600">{title}{canCreate && <button aria-label={ru.channel.createTitle} onClick={onCreate} className="ml-auto rounded p-0.5 text-violet-300 hover:bg-violet-400/10 hover:text-violet-200"><Plus className="size-3.5" /></button>}</div>{children}</section>; }

function NoTextChannelView({ server, profile, access, connectionStatus, showMembers, onCreate, onToggleMembers, onSetRole }: { server: MockServer; profile: LocalProfile; access?: CurrentAccess; connectionStatus: ConnectionStatus; showMembers: boolean; onCreate: () => void; onToggleMembers: () => void; onSetRole: (userId: string, role: "administrator" | "member") => void }): React.ReactElement {
  const canManageChannels = access?.permissions.includes("MANAGE_CHANNELS") === true;
  return <section className="flex min-w-0 flex-1 flex-col bg-[#111520]">
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[.055] px-4 shadow-sm"><Hash className="size-5 text-slate-600" /><h2 className="font-semibold text-slate-300">{ru.channel.noneSelected}</h2><span className={cn("mr-auto rounded-full px-2 py-1 text-[10px] font-semibold", connectionStatus === "connected" ? "bg-emerald-400/10 text-emerald-300" : connectionStatus === "error" ? "bg-red-400/10 text-red-300" : "bg-white/5 text-slate-500")}>{connectionLabel(connectionStatus)}</span><button aria-label={ru.chat.members} onClick={onToggleMembers} className={cn("text-slate-500 hover:text-slate-200", showMembers && "text-violet-300")}><Users className="size-5" /></button></header>
    <div className="flex min-h-0 flex-1"><div className="grid min-w-0 flex-1 place-items-center px-8"><div className="max-w-md text-center"><div className="mx-auto mb-4 grid size-16 place-items-center rounded-3xl bg-white/[.055] text-slate-500"><Hash className="size-8" /></div><h1 className="text-xl font-bold text-slate-200">{ru.channel.emptyTitle}</h1><p className="mt-2 text-sm leading-6 text-slate-500">{canManageChannels ? ru.channel.emptyManageDescription : ru.channel.emptyMemberDescription}</p>{canManageChannels && <Button onClick={onCreate} className="mt-5"><Plus className="size-4" />{ru.channel.createTitle}</Button>}</div></div>{showMembers && <MemberList server={server} profile={profile} access={access} onSetRole={onSetRole} />}</div>
  </section>;
}

function ChatHeader({ channelName, description, connectionStatus, memberList, onToggleMembers }: { channelName: string; description: string; connectionStatus: ConnectionStatus; memberList: boolean; onToggleMembers: () => void }): React.ReactElement {
  return <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[.055] px-4 shadow-sm"><Hash className="size-5 text-slate-500" /><h2 className="font-semibold text-slate-100">{channelName}</h2><span className="h-5 w-px bg-white/8" /><p className="min-w-0 truncate text-xs text-slate-500">{description}</p><span className={cn("mr-auto rounded-full px-2 py-1 text-[10px] font-semibold", connectionStatus === "connected" ? "bg-emerald-400/10 text-emerald-300" : connectionStatus === "error" ? "bg-red-400/10 text-red-300" : "bg-white/5 text-slate-500")}>{connectionLabel(connectionStatus)}</span><button className="text-slate-500 hover:text-slate-200"><Bell className="size-4" /></button><button aria-label={ru.chat.members} onClick={onToggleMembers} className={cn("text-slate-500 hover:text-slate-200", memberList && "text-violet-300")}><Users className="size-5" /></button><div className="flex h-8 w-44 items-center gap-2 rounded-lg bg-black/20 px-2.5 text-xs text-slate-600"><Search className="size-3.5" />Поиск</div><HelpCircle className="size-4 text-slate-600" /></header>;
}

function connectionLabel(status: ConnectionStatus): string {
  return ({ demo: "локально", connecting: "подключение…", authenticating: "проверка ключа…", connected: "подключено", reconnecting: "переподключение…", error: "ошибка связи" })[status];
}

function ChannelIntro({ name, description, networked }: { name: string; description: string; networked: boolean }): React.ReactElement { return <div className="mb-6 mt-auto pt-8"><div className="mb-3 grid size-14 place-items-center rounded-2xl bg-white/7 text-slate-300"><Hash className="size-7" /></div><h1 className="text-2xl font-bold tracking-tight text-white">Добро пожаловать в #{name}</h1><p className="mt-1 text-sm text-slate-500">{description}</p><p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet-400/6 px-2.5 py-1.5 text-[11px] text-violet-200/60"><MessageCircle className="size-3.5" />{networked ? ru.chat.serverNotice : ru.chat.mockNotice}</p></div>; }

function Message({ message, compact, grouped, ownAvatar }: { message: MockMessage; compact: boolean; grouped: boolean; ownAvatar: string | null }): React.ReactElement {
  const time = new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt));
  return <article className={cn("group relative flex gap-3 rounded-lg px-2 py-2 transition hover:bg-white/[.025]", compact && "py-1", grouped && !compact && "pt-0")}>
    {!grouped || compact ? <Avatar name={message.authorName} image={ownAvatar} color={message.authorColor} size={compact ? "sm" : "md"} className={compact ? "mt-0.5" : "mt-1"} /> : <span className="w-9 shrink-0 text-right text-[9px] text-transparent group-hover:text-slate-600">{time}</span>}
    <div className="min-w-0 flex-1">{(!grouped || compact) && <div className="flex items-baseline gap-2"><span className="text-sm font-semibold" style={{ color: message.authorColor }}>{message.authorName}</span><time className="text-[10px] text-slate-600">{time}</time></div>}<p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{message.content}</p></div><button className="absolute right-2 top-1 hidden rounded-md border border-white/7 bg-[#191e2b] p-1 text-slate-500 group-hover:block"><MoreHorizontal className="size-3.5" /></button>
  </article>;
}

function Composer({ draft, channelName, disabled, onDraft, onSubmit }: { draft: string; channelName: string; disabled: boolean; onDraft: (value: string) => void; onSubmit: (event: React.FormEvent) => void }): React.ReactElement {
  return <form onSubmit={onSubmit} className="shrink-0 px-5 pb-5"><div className={cn("flex min-h-12 items-center gap-2 rounded-2xl border border-white/[.065] bg-[#1a1f2d] px-3 shadow-lg focus-within:border-violet-400/30", disabled && "opacity-55")}><button type="button" disabled={disabled} className="grid size-7 place-items-center rounded-full bg-slate-500 text-[#1a1f2d] hover:bg-slate-300"><Plus className="size-4" /></button><input aria-label={`${ru.chat.placeholder} #${channelName}`} disabled={disabled} value={draft} onChange={(event) => onDraft(event.target.value)} maxLength={4000} placeholder={disabled ? "Ожидаем подключение к серверу…" : `${ru.chat.placeholder} #${channelName}`} className="h-12 min-w-0 flex-1 bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-600" /><Smile className="size-5 text-slate-500" /><button type="submit" disabled={disabled || !draft.trim()} aria-label="Отправить" className="rounded-lg p-2 text-violet-300 transition hover:bg-violet-400/10 disabled:opacity-30"><Send className="size-4" /></button></div></form>;
}

function MemberList({ server, profile, access, onSetRole }: { server: MockServer; profile: LocalProfile; access?: CurrentAccess; onSetRole: (userId: string, role: "administrator" | "member") => void }): React.ReactElement {
  const members: MockMember[] = useMemo(() => server.address
    ? server.members.map((member) => member.id === access?.id ? { ...member, role: `Вы · ${member.role}` } : member)
    : [{ id: profile.id, displayName: profile.displayName, role: "Вы", status: "online" as const, avatarColor: "#7c5cff" }, ...server.members], [access?.id, profile, server]);
  return <aside className="scrollbar-thin w-[240px] shrink-0 overflow-y-auto border-l border-white/[.055] bg-[#0e121b] px-3 py-5"><h3 className="mb-3 px-2 text-[10px] font-bold uppercase tracking-[.14em] text-slate-600">{ru.chat.members} — {members.length}</h3><div className="space-y-1">{members.map((member) => <div key={member.id} className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-white/[.045]"><Avatar name={member.displayName} image={member.id === access?.id ? profile.avatar : null} color={member.avatarColor} size="sm" status={member.status} /><span className={cn("min-w-0 flex-1", member.status === "offline" && "opacity-45")}><span className="flex items-center gap-1 truncate text-xs font-semibold text-slate-300">{member.serverRole === "owner" && <ShieldCheck className="size-3 text-amber-300" />}{member.serverRole === "administrator" && <ShieldCheck className="size-3 text-violet-300" />}{member.displayName}</span><span className={cn("block truncate text-[10px]", member.serverRole === "owner" ? "text-amber-300/70" : member.serverRole === "administrator" ? "text-violet-300/70" : "text-slate-600")}>{member.role}</span></span>{access?.permissions.includes("MANAGE_ROLES") && member.id !== access.id && member.serverRole !== "owner" && <button title={member.serverRole === "administrator" ? ru.members.removeAdmin : ru.members.makeAdmin} aria-label={`${member.serverRole === "administrator" ? ru.members.removeAdmin : ru.members.makeAdmin}: ${member.displayName}`} onClick={() => onSetRole(member.id, member.serverRole === "administrator" ? "member" : "administrator")} className="rounded-lg p-1.5 text-slate-600 opacity-0 transition hover:bg-violet-400/10 hover:text-violet-300 group-hover:opacity-100 focus:opacity-100"><UserCog className="size-3.5" /></button>}</div>)}</div></aside>;
}

function colorFromId(id: string): string {
  const colors = ["#7c5cff", "#36c5f0", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6"];
  let hash = 0;
  for (const character of id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length] ?? "#7c5cff";
}

type ServerSnapshot = Extract<ServerEvent, { type: "server.snapshot" }>["server"];

export function applyServerSnapshot(current: PersistedClientState, snapshot: ServerSnapshot): PersistedClientState {
  const targetId = current.activeServerId;
  if (!targetId) return current;
  const previousServer = current.servers.find((server) => server.id === targetId);
  const channels = snapshot.channels.map((channel) => ({ ...channel, serverId: targetId }));
  const currentChannelIds = new Set(channels.map((channel) => channel.id));
  const removedChannelIds = new Set(previousServer?.channels.filter((channel) => !currentChannelIds.has(channel.id)).map((channel) => channel.id) ?? []);
  const members = snapshot.members.map((member) => ({ id: member.id, displayName: member.displayName, role: roleLabel(member.role), serverRole: member.role, status: member.status, avatarColor: colorFromId(member.id) }));
  return {
    ...current,
    servers: current.servers.map((server) => server.id === targetId ? { ...server, name: snapshot.name, channels, members } : server),
    messages: current.messages.filter((message) => !removedChannelIds.has(message.channelId)),
    activeChannelId: channels.some((channel) => channel.id === current.activeChannelId) ? current.activeChannelId : channels.find((channel) => channel.kind === "text")?.id ?? null,
  };
}

export function removeServers(current: PersistedClientState, shouldRemove: (server: MockServer) => boolean): PersistedClientState {
  const removedServers = current.servers.filter(shouldRemove);
  if (!removedServers.length) return current;
  const removedServerIds = new Set(removedServers.map((server) => server.id));
  const removedChannelIds = new Set(removedServers.flatMap((server) => server.channels.map((channel) => channel.id)));
  const remainingServers = current.servers.filter((server) => !removedServerIds.has(server.id));
  const activeWasRemoved = current.activeServerId ? removedServerIds.has(current.activeServerId) : false;
  const nextServer = activeWasRemoved ? remainingServers[0] : remainingServers.find((server) => server.id === current.activeServerId);
  const nextChannel = nextServer?.channels.find((channel) => channel.kind === "text") ?? nextServer?.channels[0];
  return {
    ...current,
    servers: remainingServers,
    messages: current.messages.filter((message) => !removedChannelIds.has(message.channelId)),
    activeServerId: activeWasRemoved ? nextServer?.id ?? null : current.activeServerId,
    activeChannelId: activeWasRemoved ? nextChannel?.id ?? null : current.activeChannelId,
  };
}

export function upsertDeployedServer(current: PersistedClientState, serverUrl: string, serverName: string): PersistedClientState {
  const matching = current.servers.filter((server) => sameServerAddress(server.address, serverUrl));
  if (!matching.length) {
    const id = createId("server");
    return { ...current, servers: [...current.servers, { id, name: serverName, address: serverUrl, accent: "#7c5cff", channels: [], members: [] }], activeServerId: id, activeChannelId: null };
  }
  const retained = matching[0]!;
  const withoutDuplicates = removeServers(current, (server) => server.id !== retained.id && sameServerAddress(server.address, serverUrl));
  const oldChannelIds = new Set(retained.channels.map((channel) => channel.id));
  return {
    ...withoutDuplicates,
    servers: withoutDuplicates.servers.map((server) => server.id === retained.id ? { ...server, name: serverName, address: serverUrl, channels: [], members: [] } : server),
    messages: withoutDuplicates.messages.filter((message) => !oldChannelIds.has(message.channelId)),
    activeServerId: retained.id,
    activeChannelId: null,
  };
}

function roleLabel(role: MemberRole): string {
  if (role === "owner") return "Владелец сервера";
  if (role === "administrator") return "Администратор";
  return "Участник";
}

function toLocalMessage(message: import("@opencord/shared").ChatMessage): MockMessage {
  return { id: message.id, channelId: message.channelId, authorId: message.authorId, authorName: message.authorName, authorColor: colorFromId(message.authorId), content: message.content, createdAt: message.createdAt };
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs} ms`)), timeoutMs);
    void operation.then(
      (value) => { window.clearTimeout(timeout); resolve(value); },
      (error: unknown) => { window.clearTimeout(timeout); reject(error instanceof Error ? error : new Error("Unknown storage error")); },
    );
  });
}
