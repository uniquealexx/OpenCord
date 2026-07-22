"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, ChevronDown, Hash, HelpCircle, LogIn, MessageCircle, MoreHorizontal, Plus, Search, Send, Settings, Smile, Users, Volume2 } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Onboarding } from "@/components/onboarding";
import { ProfileDialog } from "@/components/profile-dialog";
import { ServerDialog } from "@/components/server-dialog";
import { SettingsDialog } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { useServerConnection, type ConnectionStatus } from "@/hooks/use-server-connection";
import { ru } from "@/lib/i18n/ru";
import { cn, createId, initials } from "@/lib/utils";
import { createDefaultState, type LocalProfile, type MockMessage, type MockServer, type PersistedClientState } from "@/shared/state";

type Modal = "create" | "connect" | "profile" | "settings" | null;

export function ClientApp(): React.ReactElement {
  const [state, setState] = useState<PersistedClientState | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const connectionServer = state?.servers.find((server) => server.id === state.activeServerId) ?? state?.servers[0];
  const connection = useServerConnection(connectionServer, state?.profile, {
    onSnapshot: (snapshot) => commit((current) => {
      const targetId = current.activeServerId;
      if (!targetId) return current;
      const channels = snapshot.channels.map((channel) => ({ ...channel, serverId: targetId }));
      const members = snapshot.members.map((member) => ({ id: member.id, displayName: member.displayName, role: "Участник", status: member.status, avatarColor: colorFromId(member.id) }));
      return { ...current, servers: current.servers.map((server) => server.id === targetId ? { ...server, name: snapshot.name, channels, members } : server), activeChannelId: channels.some((channel) => channel.id === current.activeChannelId) ? current.activeChannelId : channels.find((channel) => channel.kind === "text")?.id ?? null };
    }),
    onHistory: (channelId, messages) => commit((current) => ({ ...current, messages: [...current.messages.filter((message) => message.channelId !== channelId), ...messages.map(toLocalMessage)] })),
    onMessage: (message) => commit((current) => current.messages.some((item) => item.id === message.id) ? current : { ...current, messages: [...current.messages, toLocalMessage(message)] }),
    onMember: (member) => commit((current) => ({ ...current, servers: current.servers.map((server) => server.id !== current.activeServerId ? server : { ...server, members: [...server.members.filter((item) => item.id !== member.id), { id: member.id, displayName: member.displayName, role: "Участник", status: member.status, avatarColor: colorFromId(member.id) }] }) })),
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
  const activeServer = state.servers.find((server) => server.id === state.activeServerId) ?? state.servers[0];
  const activeChannel = activeServer?.channels.find((channel) => channel.id === state.activeChannelId) ?? activeServer?.channels.find((channel) => channel.kind === "text");
  const messages = activeChannel ? state.messages.filter((message) => message.channelId === activeChannel.id) : [];

  function selectServer(server: MockServer): void {
    const channel = server.channels.find((item) => item.kind === "text");
    commit((current) => ({ ...current, activeServerId: server.id, activeChannelId: channel?.id ?? null }));
  }

  function addServer(server: MockServer): void {
    commit((current) => ({ ...current, servers: [...current.servers, server], activeServerId: server.id, activeChannelId: server.channels[0]?.id ?? null }));
    setNotice(server.address ? "Сервер добавлен, подключаемся…" : "Локальный макет сервера добавлен");
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

  async function reset(): Promise<void> {
    const resetState = window.openCord ? await window.openCord.storage.reset() : createDefaultState();
    setState(resetState); setConfirmReset(false); setModal(null);
  }

  return (
    <main className="relative flex min-h-0 flex-1 overflow-hidden bg-[#0c0f17] text-slate-200">
      <ServerRail servers={state.servers} activeId={activeServer?.id} onSelect={selectServer} onCreate={() => setModal("create")} onConnect={() => setModal("connect")} />
      {activeServer ? <>
        <ChannelSidebar server={activeServer} activeChannelId={activeChannel?.id} profile={state.profile} onSelectChannel={(channelId) => commit((current) => ({ ...current, activeChannelId: channelId }))} onProfile={() => setModal("profile")} onSettings={() => setModal("settings")} onVoiceNotice={() => setNotice(ru.channel.voiceUnavailable)} />
        <section className="flex min-w-0 flex-1 flex-col bg-[#111520]">
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
            {state.preferences.showMemberList && <MemberList server={activeServer} profile={state.profile} />}
          </div>
        </section>
      </> : <div className="grid flex-1 place-items-center"><Button onClick={() => setModal("create")}><Plus className="size-4" />{ru.server.create}</Button></div>}
      {notice && <div role="status" className="absolute bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-xl border border-white/10 bg-[#191e2b] px-4 py-2.5 text-xs font-medium text-slate-200 shadow-2xl">{notice}</div>}
      <ServerDialog mode="create" open={modal === "create"} onOpenChange={(open) => setModal(open ? "create" : null)} onAdd={addServer} />
      <ServerDialog mode="connect" open={modal === "connect"} onOpenChange={(open) => setModal(open ? "connect" : null)} onAdd={addServer} />
      <ProfileDialog key={modal === "profile" ? "profile-open" : "profile-closed"} profile={state.profile} open={modal === "profile"} onOpenChange={(open) => setModal(open ? "profile" : null)} onSave={(profile) => commit((current) => ({ ...current, profile, messages: current.messages.map((message) => message.authorId === profile.id ? { ...message, authorName: profile.displayName } : message) }))} />
      <SettingsDialog preferences={state.preferences} open={modal === "settings"} confirmReset={confirmReset} onOpenChange={(open) => { setModal(open ? "settings" : null); if (!open) setConfirmReset(false); }} onPreferences={(preferences) => commit((current) => ({ ...current, preferences }))} onRequestReset={() => setConfirmReset(true)} onCancelReset={() => setConfirmReset(false)} onReset={() => void reset()} />
    </main>
  );
}

function ServerRail({ servers, activeId, onSelect, onCreate, onConnect }: { servers: MockServer[]; activeId?: string; onSelect: (server: MockServer) => void; onCreate: () => void; onConnect: () => void }): React.ReactElement {
  return <nav aria-label="Серверы" className="flex w-[76px] shrink-0 flex-col items-center gap-2 border-r border-white/[.055] bg-[#090c13] py-3">
    <button title={ru.nav.friends} className="mb-1 grid size-12 place-items-center rounded-[18px] bg-gradient-to-br from-violet-500 to-cyan-400 text-lg font-black text-white shadow-[0_10px_32px_rgba(124,92,255,.25)] transition hover:rounded-[14px]">O</button><div className="h-px w-8 bg-white/8" />
    <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-1">{servers.map((server) => <button key={server.id} title={server.name} onClick={() => onSelect(server)} className={cn("group relative grid size-12 shrink-0 place-items-center rounded-[18px] bg-[#1a1f2d] text-xs font-bold text-slate-300 transition hover:rounded-[14px] hover:bg-violet-500 hover:text-white", activeId === server.id && "rounded-[14px] bg-violet-500 text-white")}><span className={cn("absolute -left-3 w-1 rounded-r-full bg-white transition-all", activeId === server.id ? "h-8" : "h-0 group-hover:h-5")} />{initials(server.name)}</button>)}</div>
    <button title={ru.server.create} onClick={onCreate} className="grid size-11 shrink-0 place-items-center rounded-[17px] bg-emerald-400/8 text-emerald-400 transition hover:rounded-[13px] hover:bg-emerald-500 hover:text-white"><Plus className="size-5" /></button>
    <button title={ru.server.connect} onClick={onConnect} className="grid size-11 shrink-0 place-items-center rounded-[17px] bg-cyan-400/8 text-cyan-300 transition hover:rounded-[13px] hover:bg-cyan-500 hover:text-white"><LogIn className="size-4" /></button>
  </nav>;
}

function ChannelSidebar({ server, activeChannelId, profile, onSelectChannel, onProfile, onSettings, onVoiceNotice }: { server: MockServer; activeChannelId?: string; profile: LocalProfile; onSelectChannel: (id: string) => void; onProfile: () => void; onSettings: () => void; onVoiceNotice: () => void }): React.ReactElement {
  const textChannels = server.channels.filter((channel) => channel.kind === "text");
  const voiceChannels = server.channels.filter((channel) => channel.kind === "voice");
  return <aside className="flex w-[262px] shrink-0 flex-col border-r border-white/[.055] bg-[#0e121b]">
    <button className="flex h-14 items-center justify-between border-b border-white/[.055] px-4 text-left font-semibold text-slate-100 transition hover:bg-white/[.035]">{server.name}<ChevronDown className="size-4 text-slate-500" /></button>
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-4"><ChannelGroup title={ru.channel.text}>{textChannels.map((channel) => <button key={channel.id} onClick={() => onSelectChannel(channel.id)} className={cn("mb-0.5 flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-500 transition hover:bg-white/[.045] hover:text-slate-200", activeChannelId === channel.id && "bg-white/[.065] text-slate-100")}><Hash className="size-4 shrink-0" /><span className="truncate">{channel.name}</span></button>)}</ChannelGroup>
    <ChannelGroup title={ru.channel.voice}>{voiceChannels.map((channel) => <button key={channel.id} onClick={onVoiceNotice} className="mb-0.5 flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-600 transition hover:bg-white/[.035] hover:text-slate-400"><Volume2 className="size-4" />{channel.name}<span className="ml-auto rounded bg-white/5 px-1.5 py-0.5 text-[9px] uppercase">скоро</span></button>)}</ChannelGroup></div>
    <div className="flex h-14 items-center gap-2 border-t border-white/[.055] bg-[#0a0d14] px-2"><button onClick={onProfile} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-left hover:bg-white/5"><Avatar name={profile.displayName} image={profile.avatar} size="sm" status="online" /><span className="min-w-0"><span className="block truncate text-xs font-semibold text-slate-200">{profile.displayName}</span><span className="block text-[10px] text-emerald-400">{ru.common.online}</span></span></button><button title={ru.settings.title} onClick={onSettings} className="rounded-lg p-2 text-slate-500 hover:bg-white/6 hover:text-slate-200"><Settings className="size-4" /></button></div>
  </aside>;
}

function ChannelGroup({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement { return <section className="mb-6"><div className="mb-1 flex items-center px-2 text-[10px] font-bold uppercase tracking-[.12em] text-slate-600">{title}<Plus className="ml-auto size-3.5" /></div>{children}</section>; }

function ChatHeader({ channelName, description, connectionStatus, memberList, onToggleMembers }: { channelName: string; description: string; connectionStatus: ConnectionStatus; memberList: boolean; onToggleMembers: () => void }): React.ReactElement {
  const labels: Record<ConnectionStatus, string> = { demo: "локально", connecting: "подключение…", authenticating: "проверка ключа…", connected: "подключено", reconnecting: "переподключение…", error: "ошибка связи" };
  return <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[.055] px-4 shadow-sm"><Hash className="size-5 text-slate-500" /><h2 className="font-semibold text-slate-100">{channelName}</h2><span className="h-5 w-px bg-white/8" /><p className="min-w-0 truncate text-xs text-slate-500">{description}</p><span className={cn("mr-auto rounded-full px-2 py-1 text-[10px] font-semibold", connectionStatus === "connected" ? "bg-emerald-400/10 text-emerald-300" : connectionStatus === "error" ? "bg-red-400/10 text-red-300" : "bg-white/5 text-slate-500")}>{labels[connectionStatus]}</span><button className="text-slate-500 hover:text-slate-200"><Bell className="size-4" /></button><button aria-label={ru.chat.members} onClick={onToggleMembers} className={cn("text-slate-500 hover:text-slate-200", memberList && "text-violet-300")}><Users className="size-5" /></button><div className="flex h-8 w-44 items-center gap-2 rounded-lg bg-black/20 px-2.5 text-xs text-slate-600"><Search className="size-3.5" />Поиск</div><HelpCircle className="size-4 text-slate-600" /></header>;
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

function MemberList({ server, profile }: { server: MockServer; profile: LocalProfile }): React.ReactElement {
  const members = useMemo(() => server.address
    ? server.members.map((member) => member.displayName === profile.displayName ? { ...member, role: "Вы" } : member)
    : [{ id: profile.id, displayName: profile.displayName, role: "Вы", status: "online" as const, avatarColor: "#7c5cff" }, ...server.members], [profile, server]);
  return <aside className="scrollbar-thin w-[230px] shrink-0 overflow-y-auto border-l border-white/[.055] bg-[#0e121b] px-3 py-5"><h3 className="mb-3 px-2 text-[10px] font-bold uppercase tracking-[.14em] text-slate-600">{ru.chat.members} — {members.length}</h3><div className="space-y-1">{members.map((member) => <button key={member.id} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-white/[.045]"><Avatar name={member.displayName} image={member.id === profile.id ? profile.avatar : null} color={member.avatarColor} size="sm" status={member.status} /><span className={cn("min-w-0", member.status === "offline" && "opacity-45")}><span className="block truncate text-xs font-semibold text-slate-300">{member.displayName}</span><span className="block truncate text-[10px] text-slate-600">{member.role}</span></span></button>)}</div></aside>;
}

function colorFromId(id: string): string {
  const colors = ["#7c5cff", "#36c5f0", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6"];
  let hash = 0;
  for (const character of id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length] ?? "#7c5cff";
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
