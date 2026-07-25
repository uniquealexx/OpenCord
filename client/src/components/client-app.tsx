"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { Attachment, MemberRole, Permission, ServerEvent } from "@opencord/shared";
import { AlertTriangle, Bell, ChevronDown, Download, Hash, HelpCircle, LoaderCircle, LogIn, LogOut, Maximize2, MessageCircle, Minimize2, MoreHorizontal, Paperclip, Pencil, Plus, Search, Send, ServerCog, Settings, ShieldCheck, Smile, Trash2, UserCog, Users, Volume2, X } from "lucide-react";
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
import type { SavedDeploymentConfiguration } from "@/shared/deployment";

type Modal = "create" | "update" | "connect" | "profile" | "settings" | "leave" | "channel" | "channel-edit" | "channel-delete" | null;
type CurrentAccess = { id: string; role: MemberRole; permissions: Permission[] };

export function ClientApp(): React.ReactElement {
  const [state, setState] = useState<PersistedClientState | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [draft, setDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [managedChannel, setManagedChannel] = useState<MockChannel | null>(null);
  const [accessByServer, setAccessByServer] = useState<Record<string, CurrentAccess>>({});
  const [connectionRevision, setConnectionRevision] = useState(0);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const connectionServer = state?.servers.find((server) => server.id === state.activeServerId);
  const connection = useServerConnection(connectionServer, state?.profile, {
    onSnapshot: (snapshot) => {
      if (!snapshot.channels.some((channel) => channel.id === state?.activeChannelId)) { setDraft(""); setPendingAttachments([]); }
      if (connectionServer) setAccessByServer((current) => ({ ...current, [connectionServer.id]: snapshot.currentUser }));
      commit((current) => applyServerSnapshot(current, snapshot));
    },
    onHistory: (channelId, messages) => commit((current) => ({ ...current, messages: [...current.messages.filter((message) => message.channelId !== channelId), ...messages.map(toLocalMessage)] })),
    onMessage: (message) => commit((current) => current.messages.some((item) => item.id === message.id) ? current : { ...current, messages: [...current.messages, toLocalMessage(message)] }),
    onMessageUpdated: (message) => commit((current) => ({ ...current, messages: current.messages.map((item) => item.id === message.id ? toLocalMessage(message) : item) })),
    onMessageDeleted: (messageId) => commit((current) => ({ ...current, messages: current.messages.filter((message) => message.id !== messageId) })),
    onMember: (member) => commit((current) => ({ ...current, servers: current.servers.map((server) => server.id !== current.activeServerId ? server : { ...server, members: [...server.members.filter((item) => item.id !== member.id), { id: member.id, displayName: member.displayName, role: roleLabel(member.role), serverRole: member.role, status: member.status, avatarColor: colorFromId(member.id) }] }) })),
    onServerDeleted: () => {
      if (!connectionServer) return;
      const deletedAddress = connectionServer.address;
      commit((current) => removeServers(current, (server) => server.id === connectionServer.id || sameServerAddress(server.address, deletedAddress)));
      setModal(null); setDraft(""); setNotice(ru.server.deleted);
    },
    onError: setNotice,
  }, connectionRevision);

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
  const updatePreset = activeServer ? activeServer.deployment ?? deploymentPresetFromServer(activeServer) : undefined;
  const activeChannel = activeServer?.channels.find((channel) => channel.id === state.activeChannelId) ?? activeServer?.channels.find((channel) => channel.kind === "text");
  const messages = activeChannel ? state.messages.filter((message) => message.channelId === activeChannel.id) : [];

  function selectServer(server: MockServer): void {
    const channel = server.channels.find((item) => item.kind === "text");
    commit((current) => ({ ...current, activeServerId: server.id, activeChannelId: channel?.id ?? null }));
    setPendingAttachments([]);
  }

  function openHome(): void {
    commit((current) => ({ ...current, activeServerId: null, activeChannelId: null }));
    setDraft("");
    setPendingAttachments([]);
  }

  function selectChannel(channelId: string): void {
    commit((current) => ({ ...current, activeChannelId: channelId }));
    setDraft("");
    setPendingAttachments([]);
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

  function addDeployedServer(serverUrl: string, serverName: string, configuration: SavedDeploymentConfiguration): void {
    commit((current) => upsertDeployedServer(current, serverUrl, serverName, configuration));
    setNotice("Сервер развёрнут и заменил прежнюю запись с этим адресом");
  }

  function updatedDeployedServer(serverUrl: string, serverName: string, configuration: SavedDeploymentConfiguration): void {
    if (!activeServer) return;
    commit((current) => ({ ...current, servers: current.servers.map((server) => server.id === activeServer.id ? { ...server, name: serverName, address: serverUrl, deployment: configuration } : server) }));
    setAccessByServer((current) => { const next = { ...current }; delete next[activeServer.id]; return next; });
    setConnectionRevision((current) => current + 1);
    setNotice("OpenCord Server обновлён, данные и локальный кэш сохранены");
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
    if ((!content && pendingAttachments.length === 0) || !activeChannel) return;
    if (activeServer?.address) {
      if (!connection.sendMessage(activeChannel.id, content, pendingAttachments.map((attachment) => attachment.id))) { setNotice("Сервер ещё не готов принимать сообщения"); return; }
      setDraft("");
      setPendingAttachments([]);
      return;
    }
    const message: MockMessage = { id: createId("message"), channelId: activeChannel.id, authorId: profile.id, authorName: profile.displayName, authorColor: "#7c5cff", content, createdAt: new Date().toISOString() };
    commit((current) => ({ ...current, messages: [...current.messages, message] }));
    setDraft("");
  }

  function editMessage(message: MockMessage, content: string): boolean {
    if (activeServer?.address) {
      if (!connection.updateMessage(message.id, content)) { setNotice("Сервер пока не готов редактировать сообщения"); return false; }
      return true;
    }
    if (message.authorId !== profile.id || (!content && !message.attachments?.length)) return false;
    commit((current) => ({ ...current, messages: current.messages.map((item) => item.id === message.id ? { ...item, content, editedAt: new Date().toISOString() } : item) }));
    return true;
  }

  function deleteMessage(message: MockMessage): boolean {
    if (activeServer?.address) {
      if (!connection.deleteMessage(message.id)) { setNotice("Сервер пока не готов удалить сообщение"); return false; }
      return true;
    }
    if (message.authorId !== profile.id) return false;
    commit((current) => ({ ...current, messages: current.messages.filter((item) => item.id !== message.id) }));
    return true;
  }

  async function attachFile(): Promise<void> {
    if (!activeServer?.address || !connection.sessionToken || pendingAttachments.length >= 5 || uploadingAttachment) return;
    const bridge = window.openCord?.attachments;
    if (!bridge) { setNotice("Файловый мост Electron недоступен"); return; }
    setUploadingAttachment(true);
    try {
      const attachment = await bridge.selectAndUpload({ serverAddress: activeServer.address, sessionToken: connection.sessionToken });
      if (attachment) setPendingAttachments((current) => [...current, attachment].slice(0, 5));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось загрузить файл");
    } finally { setUploadingAttachment(false); }
  }

  async function saveAttachment(attachment: Attachment): Promise<void> {
    if (!activeServer?.address || !connection.sessionToken) { setNotice("Для скачивания нужно подключиться к серверу"); return; }
    try {
      await window.openCord?.attachments.download({ serverAddress: activeServer.address, sessionToken: connection.sessionToken, attachment });
    } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось скачать файл"); }
  }

  async function loadAttachmentPreview(attachment: Attachment): Promise<string> {
    if (!activeServer?.address || !connection.sessionToken) throw new Error("Для просмотра нужно подключиться к серверу");
    const bridge = window.openCord?.attachments;
    if (!bridge) throw new Error("Файловый мост Electron недоступен");
    return bridge.preview({ serverAddress: activeServer.address, sessionToken: connection.sessionToken, attachment });
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
        <ChannelSidebar server={activeServer} activeChannelId={activeChannel?.id} profile={state.profile} canManageChannels={currentAccess?.permissions.includes("MANAGE_CHANNELS") === true} onCreateChannel={() => setModal("channel")} onEditChannel={(channel) => openChannelModal(channel, "channel-edit")} onDeleteChannel={(channel) => openChannelModal(channel, "channel-delete")} onSelectChannel={selectChannel} onServerMenu={() => setModal("leave")} onProfile={() => setModal("profile")} onSettings={() => setModal("settings")} onVoiceNotice={() => setNotice(ru.channel.voiceUnavailable)} />
        {activeChannel ? <section className="flex min-w-0 flex-1 flex-col bg-[#111520]">
          <ChatHeader channelName={activeChannel?.name ?? "канал"} description={activeChannel?.description ?? ""} connectionStatus={activeServer.address ? connection.status : "demo"} memberList={state.preferences.showMemberList} onToggleMembers={() => commit((current) => ({ ...current, preferences: { ...current.preferences, showMemberList: !current.preferences.showMemberList } }))} />
          <ProtocolNotice status={connection.status} />
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className={cn("scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-5", state.preferences.compactMode && "py-3")}>
                <ChannelIntro name={activeChannel?.name ?? "канал"} description={activeChannel?.description ?? ""} networked={Boolean(activeServer.address)} />
                {messages.length ? messages.map((message, index) => <Message key={message.id} message={message} compact={state.preferences.compactMode} grouped={index > 0 && messages[index - 1]?.authorId === message.authorId} ownAvatar={message.authorId === state.profile?.id ? state.profile?.avatar : null} currentUserId={activeServer.address ? currentAccess?.id : profile.id} canManageMessages={currentAccess?.permissions.includes("MANAGE_MESSAGES") === true} previewAvailable={Boolean(activeServer.address && connection.sessionToken)} onEdit={editMessage} onDelete={deleteMessage} onDownload={saveAttachment} onPreview={loadAttachmentPreview} />) : <p className="py-8 text-center text-sm text-slate-600">{ru.chat.empty}</p>}
                <div ref={messageEndRef} />
              </div>
              <Composer draft={draft} channelName={activeChannel?.name ?? "канал"} disabled={Boolean(activeServer.address && connection.status !== "connected")} attachments={pendingAttachments} uploading={uploadingAttachment} canAttach={Boolean(activeServer.address && connection.sessionToken)} onAttach={() => void attachFile()} onRemoveAttachment={(id) => setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id))} onDraft={setDraft} onSubmit={sendMessage} />
            </div>
            {state.preferences.showMemberList && <MemberList server={activeServer} profile={state.profile} access={currentAccess} onSetRole={setServerMemberRole} />}
          </div>
        </section> : <NoTextChannelView server={activeServer} profile={state.profile} access={currentAccess} connectionStatus={activeServer.address ? connection.status : "demo"} showMembers={state.preferences.showMemberList} onCreate={() => setModal("channel")} onToggleMembers={() => commit((current) => ({ ...current, preferences: { ...current.preferences, showMemberList: !current.preferences.showMemberList } }))} onSetRole={setServerMemberRole} />}
      </> : <HomeScreen serverCount={state.servers.length} onCreate={() => setModal("create")} onConnect={() => setModal("connect")} />}
      {notice && <div role="status" className="absolute bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-xl border border-white/10 bg-[#191e2b] px-4 py-2.5 text-xs font-medium text-slate-200 shadow-2xl">{notice}</div>}
      <DeploymentDialog open={modal === "create"} onOpenChange={(open) => setModal(open ? "create" : null)} onDeployed={addDeployedServer} />
      {activeServer && updatePreset && <DeploymentDialog key={`update-${activeServer.id}`} open={modal === "update"} updateOnly preset={updatePreset} onOpenChange={(open) => setModal(open ? "update" : null)} onDeployed={updatedDeployedServer} />}
      <ServerDialog open={modal === "connect"} onOpenChange={(open) => setModal(open ? "connect" : null)} onAdd={addServer} />
      <ProfileDialog key={modal === "profile" ? "profile-open" : "profile-closed"} profile={state.profile} open={modal === "profile"} onOpenChange={(open) => setModal(open ? "profile" : null)} onSave={(profile) => commit((current) => ({ ...current, profile, messages: current.messages.map((message) => message.authorId === profile.id ? { ...message, authorName: profile.displayName } : message) }))} />
      <SettingsDialog preferences={state.preferences} open={modal === "settings"} confirmReset={confirmReset} onOpenChange={(open) => { setModal(open ? "settings" : null); if (!open) setConfirmReset(false); }} onPreferences={(preferences) => commit((current) => ({ ...current, preferences }))} onRequestReset={() => setConfirmReset(true)} onCancelReset={() => setConfirmReset(false)} onReset={() => void reset()} />
      {activeServer && <LeaveServerDialog server={activeServer} canUpdate={Boolean(updatePreset) && (Boolean(activeServer.deployment) || currentAccess?.role === "owner" || connection.status === "server-outdated")} canDeleteForAll={currentAccess?.permissions.includes("DELETE_SERVER") === true} open={modal === "leave"} onOpenChange={(open) => setModal(open ? "leave" : null)} onUpdate={() => setModal("update")} onConfirm={() => leaveServer(activeServer.id)} onDeleteForAll={deleteServerForEveryone} />}
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

export function LeaveServerDialog({ server, canUpdate, canDeleteForAll, open, onOpenChange, onUpdate, onConfirm, onDeleteForAll }: { server: MockServer; canUpdate: boolean; canDeleteForAll: boolean; open: boolean; onOpenChange: (open: boolean) => void; onUpdate: () => void; onConfirm: () => void; onDeleteForAll: () => void }): React.ReactElement {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <div className="mb-3 grid size-11 place-items-center rounded-2xl bg-red-400/10 text-red-300"><LogOut className="size-5" /></div>
        <DialogTitle>{server.address ? ru.server.manage : ru.server.leaveTitle}</DialogTitle>
        <DialogDescription>{server.address ? ru.server.manageDescription(server.name) : ru.server.leaveLocalDescription(server.name)}</DialogDescription>
      </DialogHeader>
      {canUpdate && server.address && <button type="button" onClick={onUpdate} className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-400/25 bg-violet-400/8 px-4 py-3 text-xs font-semibold text-violet-200 hover:bg-violet-400/15"><ServerCog className="size-4" />{ru.server.update}</button>}
      {canUpdate && server.address && !server.deployment && <p className="text-xs leading-5 text-amber-200/60">{ru.server.updateUnavailable}</p>}
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
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[.055] px-4 shadow-sm"><Hash className="size-5 text-slate-600" /><h2 className="font-semibold text-slate-300">{ru.channel.noneSelected}</h2><span className={cn("mr-auto rounded-full px-2 py-1 text-[10px] font-semibold", connectionStatus === "connected" ? "bg-emerald-400/10 text-emerald-300" : connectionStatus === "error" || isProtocolIncompatible(connectionStatus) ? "bg-red-400/10 text-red-300" : "bg-white/5 text-slate-500")}>{connectionLabel(connectionStatus)}</span><button aria-label={ru.chat.members} onClick={onToggleMembers} className={cn("text-slate-500 hover:text-slate-200", showMembers && "text-violet-300")}><Users className="size-5" /></button></header>
    <ProtocolNotice status={connectionStatus} />
    <div className="flex min-h-0 flex-1"><div className="grid min-w-0 flex-1 place-items-center px-8"><div className="max-w-md text-center"><div className="mx-auto mb-4 grid size-16 place-items-center rounded-3xl bg-white/[.055] text-slate-500"><Hash className="size-8" /></div><h1 className="text-xl font-bold text-slate-200">{ru.channel.emptyTitle}</h1><p className="mt-2 text-sm leading-6 text-slate-500">{canManageChannels ? ru.channel.emptyManageDescription : ru.channel.emptyMemberDescription}</p>{canManageChannels && <Button onClick={onCreate} className="mt-5"><Plus className="size-4" />{ru.channel.createTitle}</Button>}</div></div>{showMembers && <MemberList server={server} profile={profile} access={access} onSetRole={onSetRole} />}</div>
  </section>;
}

function ChatHeader({ channelName, description, connectionStatus, memberList, onToggleMembers }: { channelName: string; description: string; connectionStatus: ConnectionStatus; memberList: boolean; onToggleMembers: () => void }): React.ReactElement {
  return <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[.055] px-4 shadow-sm"><Hash className="size-5 text-slate-500" /><h2 className="font-semibold text-slate-100">{channelName}</h2><span className="h-5 w-px bg-white/8" /><p className="min-w-0 truncate text-xs text-slate-500">{description}</p><span className={cn("mr-auto rounded-full px-2 py-1 text-[10px] font-semibold", connectionStatus === "connected" ? "bg-emerald-400/10 text-emerald-300" : connectionStatus === "error" || isProtocolIncompatible(connectionStatus) ? "bg-red-400/10 text-red-300" : "bg-white/5 text-slate-500")}>{connectionLabel(connectionStatus)}</span><button className="text-slate-500 hover:text-slate-200"><Bell className="size-4" /></button><button aria-label={ru.chat.members} onClick={onToggleMembers} className={cn("text-slate-500 hover:text-slate-200", memberList && "text-violet-300")}><Users className="size-5" /></button><div className="flex h-8 w-44 items-center gap-2 rounded-lg bg-black/20 px-2.5 text-xs text-slate-600"><Search className="size-3.5" />Поиск</div><HelpCircle className="size-4 text-slate-600" /></header>;
}

function connectionLabel(status: ConnectionStatus): string {
  return ({ demo: "локально", connecting: "подключение…", authenticating: "проверка ключа…", connected: "подключено", reconnecting: "переподключение…", "server-outdated": "сервер устарел", "client-outdated": "клиент устарел", error: "ошибка связи" })[status];
}

function isProtocolIncompatible(status: ConnectionStatus): boolean {
  return status === "server-outdated" || status === "client-outdated";
}

export function ProtocolNotice({ status }: { status: ConnectionStatus }): React.ReactElement | null {
  if (!isProtocolIncompatible(status)) return null;
  const serverOutdated = status === "server-outdated";
  return <div role="alert" className="mx-4 mt-3 flex shrink-0 items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[.07] px-4 py-3 text-amber-100"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" /><span><strong className="block text-xs font-semibold">{serverOutdated ? "OpenCord Server необходимо обновить" : "OpenCord Client необходимо обновить"}</strong><span className="mt-0.5 block text-[11px] leading-5 text-amber-100/65">{serverOutdated ? "Текущая версия сервера несовместима с клиентом. Повторно разверните сервер через мастер — данные будут сохранены." : "Сервер использует более новую версию протокола. Установите актуальную версию приложения."}</span></span></div>;
}

function ChannelIntro({ name, description, networked }: { name: string; description: string; networked: boolean }): React.ReactElement { return <div className="mb-6 mt-auto pt-8"><div className="mb-3 grid size-14 place-items-center rounded-2xl bg-white/7 text-slate-300"><Hash className="size-7" /></div><h1 className="text-2xl font-bold tracking-tight text-white">Добро пожаловать в #{name}</h1><p className="mt-1 text-sm text-slate-500">{description}</p><p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet-400/6 px-2.5 py-1.5 text-[11px] text-violet-200/60"><MessageCircle className="size-3.5" />{networked ? ru.chat.serverNotice : ru.chat.mockNotice}</p></div>; }

export function Message({ message, compact, grouped, ownAvatar, currentUserId, canManageMessages, previewAvailable, onEdit, onDelete, onDownload, onPreview }: { message: MockMessage; compact: boolean; grouped: boolean; ownAvatar: string | null; currentUserId?: string; canManageMessages: boolean; previewAvailable: boolean; onEdit: (message: MockMessage, content: string) => boolean; onDelete: (message: MockMessage) => boolean; onDownload: (attachment: Attachment) => void; onPreview: (attachment: Attachment) => Promise<string> }): React.ReactElement {
  const time = new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt));
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content);
  const own = currentUserId === message.authorId;
  const canDelete = own || canManageMessages;
  const saveEdit = (): void => {
    const content = editDraft.trim();
    if ((!content && !message.attachments?.length) || content === message.content) { setEditing(false); setEditDraft(message.content); return; }
    if (onEdit(message, content)) setEditing(false);
  };
  return <article onContextMenu={(event) => { if (!own && !canDelete) return; event.preventDefault(); setMenuOpen(true); }} className={cn("group relative flex gap-3 rounded-lg px-2 py-2 transition hover:bg-white/[.025]", compact && "py-1", grouped && !compact && "pt-0")}>
    {!grouped || compact ? <Avatar name={message.authorName} image={ownAvatar} color={message.authorColor} size={compact ? "sm" : "md"} className={compact ? "mt-0.5" : "mt-1"} /> : <span className="w-9 shrink-0 text-right text-[9px] text-transparent group-hover:text-slate-600">{time}</span>}
    <div className="min-w-0 flex-1">{(!grouped || compact) && <div className="flex items-baseline gap-2"><span className="text-sm font-semibold" style={{ color: message.authorColor }}>{message.authorName}</span><time className="text-[10px] text-slate-600">{time}</time>{message.editedAt && <span className="text-[10px] text-slate-600">(изменено)</span>}</div>}{editing ? <div className="mt-1"><textarea autoFocus aria-label="Редактирование сообщения" value={editDraft} maxLength={4000} onChange={(event) => setEditDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setEditing(false); setEditDraft(message.content); } else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); saveEdit(); } }} className="min-h-20 w-full resize-y rounded-xl border border-violet-400/40 bg-[#0d111a] px-3 py-2 text-sm text-slate-200 outline-none focus:border-violet-400" /><div className="mt-1 text-[10px] text-slate-500">Enter — сохранить · Shift+Enter — новая строка · Esc — отменить</div></div> : <>{message.content && <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{message.content}{grouped && !compact && message.editedAt && <span className="ml-1 text-[10px] text-slate-600">(изменено)</span>}</p>}{message.attachments?.length ? <div className="mt-2 flex max-w-2xl flex-wrap gap-2">{message.attachments.map((attachment) => <AttachmentView key={attachment.id} attachment={attachment} previewAvailable={previewAvailable} onDownload={onDownload} onPreview={onPreview} />)}</div> : null}</>}</div>
    {(own || canDelete) && <button type="button" aria-label={`Действия с сообщением ${message.authorName}`} onClick={() => setMenuOpen((open) => !open)} className="absolute right-2 top-1 hidden rounded-md border border-white/7 bg-[#191e2b] p-1 text-slate-500 hover:text-slate-200 group-hover:block focus:block"><MoreHorizontal className="size-3.5" /></button>}
    {menuOpen && <div role="menu" className="absolute right-2 top-8 z-30 min-w-40 rounded-xl border border-white/10 bg-[#171b27] p-1.5 text-xs shadow-2xl">
      {own && <button type="button" role="menuitem" onClick={() => { setEditDraft(message.content); setEditing(true); setMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-slate-300 hover:bg-white/5"><Pencil className="size-3.5" />Редактировать</button>}
      {canDelete && <button type="button" role="menuitem" onClick={() => { if (window.confirm("Удалить это сообщение?")) onDelete(message); setMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-red-300 hover:bg-red-400/10"><Trash2 className="size-3.5" />Удалить</button>}
    </div>}
  </article>;
}

export function Composer({ draft, channelName, disabled, attachments, uploading, canAttach, onAttach, onRemoveAttachment, onDraft, onSubmit }: { draft: string; channelName: string; disabled: boolean; attachments: Attachment[]; uploading: boolean; canAttach: boolean; onAttach: () => void; onRemoveAttachment: (id: string) => void; onDraft: (value: string) => void; onSubmit: (event: React.FormEvent) => void }): React.ReactElement {
  return <form onSubmit={onSubmit} className="shrink-0 px-5 pb-5">{attachments.length ? <div className="mb-2 flex flex-wrap gap-2">{attachments.map((attachment) => <span key={attachment.id} className="flex max-w-64 items-center gap-2 rounded-xl border border-white/8 bg-[#171c29] px-2.5 py-2 text-xs text-slate-300"><Paperclip className="size-3.5 shrink-0 text-violet-300" /><span className="truncate">{attachment.fileName}</span><button type="button" aria-label={`Убрать ${attachment.fileName}`} onClick={() => onRemoveAttachment(attachment.id)} className="rounded p-0.5 text-slate-500 hover:bg-white/5 hover:text-red-300"><X className="size-3.5" /></button></span>)}</div> : null}<div className={cn("flex min-h-12 items-center gap-2 rounded-2xl border border-white/[.065] bg-[#1a1f2d] px-3 shadow-lg focus-within:border-violet-400/30", disabled && "opacity-55")}><button type="button" title={canAttach ? "Прикрепить файл (до 10 МБ)" : "Вложения доступны после подключения"} aria-label="Прикрепить файл" onClick={onAttach} disabled={disabled || !canAttach || uploading || attachments.length >= 5} className="grid size-7 place-items-center rounded-full bg-slate-500 text-[#1a1f2d] hover:bg-slate-300 disabled:opacity-40">{uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Paperclip className="size-4" />}</button><input aria-label={`${ru.chat.placeholder} #${channelName}`} disabled={disabled} value={draft} onChange={(event) => onDraft(event.target.value)} maxLength={4000} placeholder={disabled ? "Ожидаем подключение к серверу…" : `${ru.chat.placeholder} #${channelName}`} className="h-12 min-w-0 flex-1 bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-600" /><Smile className="size-5 text-slate-500" /><button type="submit" disabled={disabled || uploading || (!draft.trim() && attachments.length === 0)} aria-label="Отправить" className="rounded-lg p-2 text-violet-300 transition hover:bg-violet-400/10 disabled:opacity-30"><Send className="size-4" /></button></div></form>;
}

export function AttachmentView({ attachment, previewAvailable = true, onDownload, onPreview }: { attachment: Attachment; previewAvailable?: boolean; onDownload: (attachment: Attachment) => void; onPreview: (attachment: Attachment) => Promise<string> }): React.ReactElement {
  const isImage = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(attachment.mimeType);
  const isVideo = ["video/mp4", "video/webm", "video/ogg"].includes(attachment.mimeType);
  const previewable = isImage || isVideo;
  const previewKey = `${attachment.id}:${attachment.sha256}`;
  const [previewState, setPreviewState] = useState<{ key: string; value: string | null; failed: boolean }>({ key: "", value: null, failed: false });
  const currentPreviewState = previewState.key === previewKey ? previewState : { key: previewKey, value: null, failed: false };
  const preview = currentPreviewState.value;
  const previewFailed = currentPreviewState.failed;
  const [viewerOpen, setViewerOpen] = useState(false);
  const [fullscreenTarget, setFullscreenTarget] = useState<"image" | "video" | null>(null);
  const previewLoader = useRef(onPreview);
  const imageFullscreenRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => { previewLoader.current = onPreview; }, [onPreview]);
  useEffect(() => {
    const handleFullscreenChange = (): void => {
      const element = document.fullscreenElement;
      setFullscreenTarget(element === imageFullscreenRef.current ? "image" : element === videoRef.current ? "video" : null);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);
  useEffect(() => {
    if (!previewable || !previewAvailable) return;
    let active = true;
    void previewLoader.current(attachment)
      .then((value) => { if (active) setPreviewState({ key: previewKey, value, failed: false }); })
      .catch(() => { if (active) setPreviewState({ key: previewKey, value: null, failed: true }); });
    return () => { active = false; };
  }, [attachment, previewAvailable, previewKey, previewable]);
  if (isImage && !previewFailed) return <>
    <div className="w-full max-w-[520px] overflow-hidden rounded-xl border border-white/8 bg-black/20">
      <button type="button" aria-label={`Открыть ${attachment.fileName}`} disabled={!preview} onClick={() => setViewerOpen(true)} className="relative block h-64 w-full bg-black/20 disabled:cursor-wait">{preview ? <Image src={preview} alt={attachment.fileName} fill unoptimized sizes="520px" className="object-contain transition duration-200 hover:scale-[1.01]" /> : <span className="absolute inset-0 grid place-items-center"><LoaderCircle className="size-6 animate-spin text-violet-300" /></span>}</button>
      <AttachmentFooter attachment={attachment} onDownload={onDownload} />
    </div>
    <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
      <DialogContent className="max-h-[94vh] max-w-[96vw] bg-[#080a10]">
        <DialogTitle className="sr-only">{attachment.fileName}</DialogTitle>
        <DialogDescription className="sr-only">Полноразмерный просмотр изображения</DialogDescription>
        <div ref={imageFullscreenRef} className="relative h-[76vh] w-full overflow-hidden rounded-2xl bg-black fullscreen:h-screen fullscreen:w-screen fullscreen:rounded-none">
          {preview && <Image src={preview} alt={attachment.fileName} fill unoptimized sizes="96vw" className="object-contain" />}
          <FullscreenButton elementRef={imageFullscreenRef} active={fullscreenTarget === "image"} fileName={attachment.fileName} />
        </div>
        <div className="mt-3 flex min-w-0 items-center justify-between gap-3"><span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-200">{attachment.fileName}</span><span className="text-xs text-slate-500">{formatBytes(attachment.sizeBytes)}</span></span><Button type="button" variant="secondary" onClick={() => onDownload(attachment)}><Download className="size-4" />Скачать</Button></div>
      </DialogContent>
    </Dialog>
  </>;
  if (isVideo && !previewFailed) return <div className="w-full max-w-[520px] overflow-hidden rounded-xl border border-white/8 bg-black/20">
    <div className="relative min-h-48 bg-black">{preview ? <video ref={videoRef} src={preview} controls preload="metadata" playsInline aria-label={`Видео: ${attachment.fileName}`} onError={() => setPreviewState({ key: previewKey, value: null, failed: true })} className="max-h-80 w-full bg-black object-contain" /> : <span className="absolute inset-0 grid place-items-center"><LoaderCircle className="size-6 animate-spin text-violet-300" /></span>}{preview && <FullscreenButton elementRef={videoRef} active={fullscreenTarget === "video"} fileName={attachment.fileName} compact />}</div>
    <AttachmentFooter attachment={attachment} onDownload={onDownload} />
  </div>;
  return <button type="button" onClick={() => onDownload(attachment)} className="flex min-w-0 max-w-72 items-center gap-2 rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-left transition hover:border-violet-400/30 hover:bg-violet-400/5"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-400/10 text-violet-300"><Download className="size-4" /></span><span className="min-w-0"><span className="block truncate text-xs font-medium text-slate-300">{attachment.fileName}</span><span className="text-[10px] text-slate-600">{formatBytes(attachment.sizeBytes)}</span></span></button>;
}

function FullscreenButton({ elementRef, active, fileName, compact = false }: { elementRef: React.RefObject<HTMLElement | null>; active: boolean; fileName: string; compact?: boolean }): React.ReactElement {
  const label = active ? `Выйти из полноэкранного режима: ${fileName}` : `На весь экран: ${fileName}`;
  const toggle = async (): Promise<void> => {
    if (active && document.fullscreenElement) await document.exitFullscreen();
    else if (elementRef.current) await elementRef.current.requestFullscreen();
  };
  return <button type="button" aria-label={label} title={label} onClick={() => void toggle()} className={cn("absolute right-3 top-3 z-10 rounded-xl border border-white/10 bg-black/60 text-white backdrop-blur transition hover:bg-black/80", compact ? "p-2" : "p-2.5")}>{active ? <Minimize2 className={compact ? "size-4" : "size-5"} /> : <Maximize2 className={compact ? "size-4" : "size-5"} />}</button>;
}

function AttachmentFooter({ attachment, onDownload }: { attachment: Attachment; onDownload: (attachment: Attachment) => void }): React.ReactElement {
  return <button type="button" onClick={() => onDownload(attachment)} className="flex w-full items-center gap-2 border-t border-white/8 px-3 py-2 text-left hover:bg-white/[.03]"><Download className="size-4 shrink-0 text-violet-300" /><span className="min-w-0"><span className="block truncate text-xs font-medium text-slate-300">{attachment.fileName}</span><span className="text-[10px] text-slate-600">{formatBytes(attachment.sizeBytes)}</span></span></button>;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
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

export function upsertDeployedServer(current: PersistedClientState, serverUrl: string, serverName: string, deployment?: SavedDeploymentConfiguration): PersistedClientState {
  const matching = current.servers.filter((server) => sameServerAddress(server.address, serverUrl));
  if (!matching.length) {
    const id = createId("server");
    return { ...current, servers: [...current.servers, { id, name: serverName, address: serverUrl, accent: "#7c5cff", channels: [], members: [], ...(deployment ? { deployment } : {}) }], activeServerId: id, activeChannelId: null };
  }
  const retained = matching[0]!;
  const withoutDuplicates = removeServers(current, (server) => server.id !== retained.id && sameServerAddress(server.address, serverUrl));
  const oldChannelIds = new Set(retained.channels.map((channel) => channel.id));
  return {
    ...withoutDuplicates,
    servers: withoutDuplicates.servers.map((server) => server.id === retained.id ? { ...server, name: serverName, address: serverUrl, channels: [], members: [], ...(deployment ? { deployment } : {}) } : server),
    messages: withoutDuplicates.messages.filter((message) => !oldChannelIds.has(message.channelId)),
    activeServerId: retained.id,
    activeChannelId: null,
  };
}

export function deploymentPresetFromServer(server: MockServer): Partial<SavedDeploymentConfiguration> | undefined {
  if (!server.address) return undefined;
  try {
    const endpoint = new URL(server.address);
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") return undefined;
    const hostname = endpoint.hostname;
    const domain = endpoint.protocol === "https:" && hostname.includes(".") && !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname) && !hostname.includes(":")
      ? hostname
      : undefined;
    return { host: hostname, port: 22, username: "root", serverName: server.name, authentication: "private-key", ...(domain ? { domain } : {}) };
  } catch {
    return undefined;
  }
}

function roleLabel(role: MemberRole): string {
  if (role === "owner") return "Владелец сервера";
  if (role === "administrator") return "Администратор";
  return "Участник";
}

function toLocalMessage(message: import("@opencord/shared").ChatMessage): MockMessage {
  return { id: message.id, channelId: message.channelId, authorId: message.authorId, authorName: message.authorName, authorColor: colorFromId(message.authorId), content: message.content, createdAt: message.createdAt, editedAt: message.editedAt, attachments: message.attachments };
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
