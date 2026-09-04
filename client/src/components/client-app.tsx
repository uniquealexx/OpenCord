"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { DEFAULT_ATTACHMENT_LIMIT_BYTES, DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE, DEFAULT_SCREEN_SHARE_MAX_RESOLUTION, MEBIBYTE, SCREEN_SHARE_FRAME_RATES, SCREEN_SHARE_RESOLUTIONS, SLOWMODE_SECONDS_OPTIONS, type Attachment, type
BanDurationMinutes, type MemberRole, type MessageSearchFilters, type MessageSearchResult, type NameFont, type Permission, type
PublicMemberStatus, type ScreenShareFrameRate, type ScreenShareResolution, type ServerEvent, type ServerSettings, type
UserStatus, type VoiceCapability, type VoicePresence } from "@opencord/shared";
import { AlertTriangle, Bell, Camera, ChevronDown, Clock, Download, Hash, Headphones, HelpCircle, Image as ImageIcon, LoaderCircle, LogIn, LogOut, Maximize2, Menu, MessageCircle, MessageCircleOff, Mic, MicOff, Minimize2, MonitorUp, MoreHorizontal, Paperclip, Pencil, PhoneOff, Plus, Reply, Search, Send, ServerCog, Settings, ShieldBan, ShieldCheck, Smile, Square, Timer, Trash2, UserMinus, Users, Volume2, VolumeX, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { DeploymentDialog } from "@/components/deployment-dialog";
import { EmojiPicker } from "@/components/emoji-picker";
import { ReactionPalette } from "@/components/reaction-palette";
import { VoicePlayer, formatVoiceSeconds, isVoiceMessage } from "@/components/voice-player";
import { Onboarding } from "@/components/onboarding";
import { ProfileDialog } from "@/components/profile-dialog";
import { ProfilePreview } from "@/components/profile-preview";
import { ServerDialog } from "@/components/server-dialog";
import { ServerAvatarDialog } from "@/components/server-avatar-dialog";
import { ServerBannerDialog } from "@/components/server-banner-dialog";
import { ServerPreviewDialog } from "@/components/server-preview-dialog";
import { ServerSettingsPage } from "@/components/server-settings-page";
import { ServerSearchPanel } from "@/components/server-search-panel";
import { ScreenShareDialog, ScreenShareSurface, screenShareResolutionLabel } from "@/components/screen-share-dialog";
import { SettingsDialog } from "@/components/settings-dialog";
import { MobileSettingsScreen } from "@/mobile/screens/settings-screen";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useMobileLayout } from "@/hooks/use-mobile-layout";
import { useServerConnection, type ConnectionStatus } from "@/hooks/use-server-connection";
import { useVoiceSession, type ScreenShareSettings, type ScreenShareStream, type VoiceAuthorization, type VoiceSessionStatus } from "@/hooks/use-voice-session";
import { useVoiceRecorder, voiceFileName, type VoiceRecorderError } from "@/hooks/use-voice-recorder";
import { setActiveLanguage, currentDictionary, useI18n, type Dictionary } from "@/lib/i18n";
import { nicknameStyle } from "@/lib/name-font";
import { commandQueryAtCursor, containsEveryoneMention, EVERYONE_MENTION, EVERYONE_TOKEN, everyoneCandidate, expandMentionsForEditing, matchMentionCandidates, mentionQueryAtCursor, parseSlashCommand, resolveDraftMentions, splitMessageContent, type MentionCandidate } from "@/lib/mentions";
import { buildToastForMessage, getChannelNotificationSettings } from "@/lib/channel-notifications";
import { NotificationToasts, type NotificationToast } from "@/components/notification-toasts";
import { installPlatformBridge, isMobilePlatform } from "@/platform";
import { registerBackHandler, setExitHintHandler } from "@/platform/native-shell";
import { cn, createId, initials } from "@/lib/utils";
import { sameServerAddress } from "@/lib/server-address";
import { playVoiceSound, primeVoiceSounds } from "@/lib/voice-sounds";
import { createDefaultState, DEFAULT_COLOR_THEME, DEFAULT_DARK_SHADE, DEFAULT_THEME_MODE, type ChannelNotificationSettings, type ClientPreferences, type LocalProfile, type MockChannel, type MockMember, type MockMessage, type MockServer, type PersistedClientState } from "@/shared/state";
import { resolveAppearance, useSystemDark } from "@/lib/appearance";
import type { SavedDeploymentConfiguration } from "@/shared/deployment";

// В Capacitor-оболочке (Android) подставляет мобильный мост window.openCord до первого рендера.
// В Electron мост уже установлен preload-скриптом, в браузере/тестах вызов ничего не делает.
installPlatformBridge();

type Modal = "create" | "update" | "connect" | "profile" | "settings" | "leave" | "server-avatar" | "server-banner" | "channel" | "channel-edit" | "channel-delete" | "channel-slowmode" | "screen-share" | null;
type CurrentAccess = {
  id: string;
  role: MemberRole;
  permissions: Permission[];
};
const VOICE_PARTICIPANT_LIMIT_MAX = 25;
const userStatusLabels: Record<UserStatus, keyof Dictionary["statuses"]> = {
  online: "online",
  idle: "idle",
  dnd: "dnd",
  invisible: "invisible",
};

export function visibleProfileStatus(status: UserStatus | undefined): PublicMemberStatus {
  return status === "invisible" ? "offline" : (status ?? "online");
}

/** Эффективный мут чата с учётом срока: бессрочный или ещё не истёкший. */
export function isChatMutedNow(member: Pick<MockMember, "chatMuted" | "chatMutedUntil"> | undefined): boolean {
  if (member?.chatMuted !== true) return false;
  if (!member.chatMutedUntil) return true;
  return new Date(member.chatMutedUntil).getTime() > Date.now();
}

/**
 * Остаток мута для отсчёта в поле ввода: `5:00`, а от часа — `1:02:03`.
 * Округление вверх, чтобы последняя секунда показывалась как `0:01`, а не `0:00`.
 */
export function formatMuteRemaining(milliseconds: number): string {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const pad = (value: number): string => String(value).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function shouldRequestVoiceJoin(status: "idle" | "connecting" | "connected" | "reconnecting" | "error", connectedChannelId: string | null, authorizedChannelId: string | null, targetChannelId: string): boolean {
  const alreadyJoiningOrConnected = status === "connecting" || status === "connected" || status === "reconnecting";
  return !alreadyJoiningOrConnected || (connectedChannelId !== targetChannelId && authorizedChannelId !== targetChannelId);
}

export function canDisconnectVoiceParticipant(canModerate: boolean, actorRole: MemberRole | undefined, targetRole: MemberRole | undefined, currentUserId: string, targetUserId: string): boolean {
  if (!canModerate || currentUserId === targetUserId || !actorRole || !targetRole || targetRole === "owner") return false;
  return actorRole === "owner" || (actorRole === "administrator" && targetRole === "member");
}

export function canKickServerMember(canKick: boolean, actorRole: MemberRole | undefined, targetRole: MemberRole | undefined, currentUserId: string, targetUserId: string): boolean {
  if (!canKick || currentUserId === targetUserId || !actorRole || !targetRole || targetRole === "owner") return false;
  return actorRole === "owner" || (actorRole === "administrator" && targetRole === "member");
}

export function ClientApp(): React.ReactElement {
  const { t, locale } = useI18n();
  const [state, setState] = useState<PersistedClientState | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [draft, setDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [toasts, setToasts] = useState<NotificationToast[]>([]);
  const [managedChannel, setManagedChannel] = useState<MockChannel | null>(null);
  const [accessByServer, setAccessByServer] = useState<Record<string, CurrentAccess>>({});
  const [voiceCapabilityByServer, setVoiceCapabilityByServer] = useState<Record<string, VoiceCapability>>({});
  const [voicePresenceByServer, setVoicePresenceByServer] = useState<Record<string, VoicePresence[]>>({});
  const [voiceAuthorization, setVoiceAuthorization] = useState<VoiceAuthorization | null>(null);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<MessageSearchResult | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [viewingScreenShareId, setViewingScreenShareId] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"channels" | "members" | null>(null);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [selfIdentity, setSelfIdentity] = useState<{
    publicKey: string;
    fingerprint: string;
    discriminator: string;
  } | null>(null);
  const [draggingFiles, setDraggingFiles] = useState(false);
  // Телефонная раскладка: одна колонка, навигация в выдвижных панелях.
  const mobile = useMobileLayout();
  const swipeStartRef = useRef<{ x: number; y: number; edge: "left" | "right" | "panel" } | null>(null);
  const dragDepthRef = useRef(0);
  const searchRequestRef = useRef<string | null>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const serverMuteStateRef = useRef(false);
  const voiceSoundStatusRef = useRef<VoiceSessionStatus>("idle");
  const mutedBeforeServerMuteRef = useRef(false);
  const connectionServer = state?.servers.find((server) => server.id === state.activeServerId);
  const connection = useServerConnection(
    connectionServer,
    state?.profile,
    {
      onSnapshot: (snapshot) => {
        if (!snapshot.channels.some((channel) => channel.id === state?.activeChannelId)) {
          setDraft("");
          setPendingAttachments([]);
        }
        if (connectionServer)
          setAccessByServer((current) => ({
            ...current,
            [connectionServer.id]: snapshot.currentUser,
          }));
        if (connectionServer) {
          const capability = snapshot.voice;
          const participants = snapshot.voiceParticipants;
          if (capability)
            setVoiceCapabilityByServer((current) => ({
              ...current,
              [connectionServer.id]: capability,
            }));
          if (participants)
            setVoicePresenceByServer((current) => ({
              ...current,
              [connectionServer.id]: participants,
            }));
        }
        commit((current) => applyServerSnapshot(current, snapshot));
      },
      onServerAvatarUpdated: (_serverId, avatar) => {
        if (!connectionServer) return;
        commit((current) => ({
          ...current,
          servers: current.servers.map((server) => (server.id === connectionServer.id ? { ...server, avatar } : server)),
        }));
      },
      onServerBannerUpdated: (_serverId, banner) => {
        if (!connectionServer) return;
        commit((current) => ({
          ...current,
          servers: current.servers.map((server) => (server.id === connectionServer.id ? { ...server, banner } : server)),
        }));
      },
      onHistory: (channelId, messages) =>
        commit((current) => ({
          ...current,
          messages: [...current.messages.filter((message) => message.channelId !== channelId), ...messages.map(toLocalMessage)],
        })),
      onMessage: (message) => {
        pushToastForMessage(message);
        commit((current) =>
          current.messages.some((item) => item.id === message.id)
            ? current
            : {
                ...current,
                messages: [...current.messages, toLocalMessage(message)],
              },
        );
      },
      onMessageUpdated: (message) =>
        commit((current) => ({
          ...current,
          messages: current.messages.map((item) => (item.id === message.id ? toLocalMessage(message) : item)),
        })),
      onMessageDeleted: (messageId) => {
        setReplyingToId((current) => (current === messageId ? null : current));
        commit((current) => ({
          ...current,
          messages: current.messages.filter((message) => message.id !== messageId),
        }));
      },
      onMessageReactionsUpdated: (messageId, channelId, reactions) =>
        commit((current) => ({
          ...current,
          messages: current.messages.map((message) => (message.id === messageId && message.channelId === channelId ? { ...message, reactions } : message)),
        })),
      onSearchResult: (requestId, result) => {
        if (requestId !== searchRequestRef.current) return;
        setSearchLoading(false);
        setSearchResult((current) =>
          result.offset > 0 && current
            ? {
                ...result,
                offset: 0,
                messages: [...current.messages, ...result.messages],
              }
            : result,
        );
        commit((current) => ({
          ...current,
          messages: [...current.messages.filter((message) => !result.messages.some((found) => found.id === message.id)), ...result.messages.map(toLocalMessage)],
        }));
      },
      onMember: (member) =>
        commit((current) => ({
          ...current,
          // Тег username#1234 закрепляет за идентичностью сервер, поэтому подтверждённый
          // им дискриминатор возвращается в локальный профиль.
          profile:
            current.profile && member.id === currentAccess?.id && member.discriminator !== current.profile.discriminator
              ? { ...current.profile, discriminator: member.discriminator }
              : current.profile,
          servers: current.servers.map((server) =>
            server.id !== current.activeServerId
              ? server
              : {
                  ...server,
                  members: [
                    ...server.members.filter((item) => item.id !== member.id),
                    {
                      id: member.id,
                      username: member.username,
                      discriminator: member.discriminator,
                      fingerprint: member.fingerprint,
                      bio: member.bio,
                      role: roleLabel(member.role),
                      serverRole: member.role,
                      status: member.status,
                      customStatus: member.customStatus,
                      customStatusEmoji: member.customStatusEmoji,
                      accentColor: member.accentColor,
                      nameGlow: member.nameGlow,
                      nameFont: member.nameFont,
                      avatarColor: colorFromId(member.id),
                      avatar: member.avatar,
                      banner: member.banner,
                      memberBackground: member.memberBackground ?? null,
                      chatMuted: member.chatMuted,
                      chatMutedUntil: member.chatMutedUntil,
                    },
                  ],
                },
          ),
          messages: current.messages.map((message) =>
            message.authorId === member.id
              ? {
                  ...message,
                  authorName: member.username,
                  authorAvatar: member.avatar,
                }
              : message,
          ),
        })),
      onMemberRemoved: (userId) => {
        if (connectionServer && userId === currentAccess?.id) {
          const removedServerId = connectionServer.id;
          const removedAddress = connectionServer.address;
          commit((current) => removeServers(current, (server) => server.id === removedServerId || sameServerAddress(server.address, removedAddress)));
          setModal(null);
          resetComposer();
          resetSearch();
          resetVoiceSession();
          setNotice(currentDictionary().notices.kickedFromServer);
          return;
        }
        commit((current) => ({
          ...current,
          servers: current.servers.map((server) =>
            server.id !== current.activeServerId
              ? server
              : {
                  ...server,
                  members: server.members.filter((member) => member.id !== userId),
                },
          ),
        }));
      },
      onProfileAnonymized: (userId) => {
        commit((current) => ({ ...current, messages: current.messages.map((message) => message.authorId === userId ? { ...message, authorName: "Неизвестный пользователь", authorAvatar: null } : message) }));
        setSearchResult((current) => current ? { ...current, messages: current.messages.map((message) => message.authorId === userId ? { ...message, authorName: "Неизвестный пользователь", authorAvatar: null } : message) } : null);
      },
      onServerDeleted: () => {
        if (!connectionServer) return;
        const deletedAddress = connectionServer.address;
        commit((current) => removeServers(current, (server) => server.id === connectionServer.id || sameServerAddress(server.address, deletedAddress)));
        setModal(null);
        resetComposer();
        resetSearch();
        resetVoiceSession();
        setNotice(currentDictionary().server.deleted);
      },
      onVoiceAuthorization: (authorization) =>
        setVoiceAuthorization({
          channelId: authorization.channelId,
          endpoint: authorization.endpoint,
          token: authorization.token,
          expiresAt: authorization.expiresAt,
        }),
      onVoicePresence: (participant, connected) => {
        if (!connectionServer) return;
        setVoicePresenceByServer((current) => {
          const existing = current[connectionServer.id] ?? [];
          const next = connected ? [...existing.filter((item) => item.userId !== participant.userId), participant] : existing.filter((item) => item.userId !== participant.userId || item.channelId !== participant.channelId);
          return { ...current, [connectionServer.id]: next };
        });
      },
      onVoiceDisconnected: (userId, channelId) => {
        if (connectionServer)
          setVoicePresenceByServer((current) => ({
            ...current,
            [connectionServer.id]: (current[connectionServer.id] ?? []).filter((item) => item.userId !== userId || item.channelId !== channelId),
          }));
        setViewingScreenShareId((current) => (current === userId ? null : current));
        if (userId === currentAccess?.id) {
          setVoiceAuthorization(null);
          setNotice(currentDictionary().notices.voiceDisconnected);
        }
      },
      onError: (message) => {
        setSearchLoading(false);
        setNotice(message);
      },
    },
    connectionRevision,
  );
  const voice = useVoiceSession(voiceAuthorization, state?.preferences ?? createDefaultState().preferences, setNotice, (voiceParticipantSettings) => {
    commit((current) => ({
      ...current,
      preferences: { ...current.preferences, voiceParticipantSettings },
    }));
  });
  const localVoiceMuted = voice.muted;
  const setLocalVoiceMuted = voice.setMuted;
  const updateVoiceState = connection.updateVoiceState;
  const connectedVoiceUserId = connectionServer ? accessByServer[connectionServer.id]?.id : undefined;
  const connectedVoicePresence = connectionServer && connectedVoiceUserId && voice.channelId ? (voicePresenceByServer[connectionServer.id] ?? []).find((participant) => participant.userId === connectedVoiceUserId && participant.channelId === voice.channelId) : undefined;
  const hasConnectedVoicePresence = Boolean(connectedVoicePresence);
  const serverMuted = connectedVoicePresence?.serverMuted === true;
  const effectiveMuted = voice.muted || serverMuted;
  const attachmentLatencySensitive = ["connecting", "connected", "reconnecting"].includes(voice.status);

  useEffect(() => {
    const wasServerMuted = serverMuteStateRef.current;
    if (serverMuted && !wasServerMuted) {
      mutedBeforeServerMuteRef.current = localVoiceMuted;
      if (!localVoiceMuted) void setLocalVoiceMuted(true);
    } else if (!serverMuted && wasServerMuted && !mutedBeforeServerMuteRef.current) {
      void setLocalVoiceMuted(false);
    }
    serverMuteStateRef.current = serverMuted;
  }, [localVoiceMuted, serverMuted, setLocalVoiceMuted]);

  useEffect(() => {
    void window.openCord?.attachments.setLatencySensitive(attachmentLatencySensitive);
  }, [attachmentLatencySensitive]);

  useEffect(() => {
    if (voice.status !== "connected" || !hasConnectedVoicePresence) return;
    updateVoiceState(voice.muted, voice.deafened, viewingScreenShareId);
  }, [hasConnectedVoicePresence, updateVoiceState, viewingScreenShareId, voice.deafened, voice.muted, voice.status]);

  // Звук входа и выхода вешается на статус сессии, а не на кнопки: до "connected"
  // ещё идут выдача гранта и подключение к LiveKit, а уйти из комнаты можно и не
  // нажимая «Отключиться» (разрыв связи, переключение сервера, кик).
  useEffect(() => {
    const previous = voiceSoundStatusRef.current;
    voiceSoundStatusRef.current = voice.status;
    // Пока идёт подключение, mp3 успевают декодироваться — иначе первый звук
    // отстал бы от события на время разбора файла.
    if (voice.status === "connecting") primeVoiceSounds();
    if (voice.status === "connected" && previous !== "connected" && previous !== "reconnecting") playVoiceSound("voiceJoin");
    else if (voice.status !== "connected" && voice.status !== "reconnecting" && (previous === "connected" || previous === "reconnecting")) playVoiceSound("voiceLeave");
  }, [voice.status]);

  useEffect(() => {
    const bridge = window.openCord?.storage;
    const loading = bridge ? withTimeout(bridge.load(), 3_000) : Promise.resolve(createDefaultState());
    void loading.then(setState).catch((error: unknown) => {
      console.error("Failed to load Electron client state", error);
      setState(createDefaultState());
      setNotice(t.notices.storageLoadFailed);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Дискриминатор из ключей — лишь пожелание, которое клиент отправляет при регистрации:
  // тег username#1234 закрепляет за идентичностью сервер, и его подтверждённое значение
  // приходит в снапшоте. Поэтому локальный профиль здесь не переписывается.
  useEffect(() => {
    void window.openCord?.identity
      ?.getOrCreate()
      .then(setSelfIdentity)
      .catch(() => undefined);
  }, []);

  // Мобильная оболочка: при входе запрашиваем доступ к микрофону (системный диалог
  // Android), пока пользователь его не предоставит. Без разрешения запрос повторяется
  // при следующем запуске; поток немедленно останавливается, голос это не затрагивает.
  useEffect(() => {
    if (!isMobilePlatform()) return;
    try {
      if (localStorage.getItem("opencord.mic-permission-granted")) return;
    } catch {
      /* хранилище недоступно — просто запросим */
    }
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) return;
    void media
      .getUserMedia({ audio: true })
      .then((stream) => {
        for (const track of stream.getTracks()) track.stop();
        try {
          localStorage.setItem("opencord.mic-permission-granted", "1");
        } catch {
          /* ignore */
        }
      })
      .catch(() => undefined);
  }, []);

  // Мобильная оболочка: масштаб интерфейса из настроек применяется к корню документа,
  // поэтому масштабируются и порталы (диалоги). На десктопе зум не трогаем.
  useEffect(() => {
    const scale = isMobilePlatform() ? (state?.preferences.uiScale ?? 1) : 1;
    document.documentElement.style.zoom = scale === 1 ? "" : String(scale);
    // Системные отступы и клавиатура измеряются вне масштабированного дерева;
    // `--ui-zoom` приводит их к его координатам (см. globals.css).
    document.documentElement.style.setProperty("--ui-zoom", String(scale));
  }, [state?.preferences.uiScale]);

  // Оформление живёт на <html>, чтобы его наследовали и порталы диалогов в body:
  // палитра (data-color-theme), эффективное светлое/тёмное (data-appearance) и
  // яркость тёмной (data-dark-shade). При themeMode=system следим за ОС наживую.
  const systemDark = useSystemDark();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.colorTheme = state?.preferences.colorTheme ?? DEFAULT_COLOR_THEME;
    const effective = resolveAppearance(state?.preferences.themeMode ?? DEFAULT_THEME_MODE, systemDark);
    root.dataset.appearance = effective;
    root.dataset.darkShade = state?.preferences.darkShade ?? DEFAULT_DARK_SHADE;
    root.classList.toggle("dark", effective === "dark");
    root.style.colorScheme = effective;
  }, [state?.preferences.colorTheme, state?.preferences.themeMode, state?.preferences.darkShade, systemDark]);

  useEffect(() => {
    const language = state?.preferences.language;
    if (language) setActiveLanguage(language);
  }, [state?.preferences.language]);

  // Системная кнопка «Назад» Android закрывает верхний слой интерфейса и только на
  // главном экране сворачивает приложение (нативная часть просит подтверждение).
  // Порядок соответствует визуальной вложенности: оверлей → диалог → панель → чат.
  useEffect(() =>
    registerBackHandler(() => {
      if (viewingScreenShareId) {
        setViewingScreenShareId(null);
        return true;
      }
      if (modal) {
        setModal(null);
        return true;
      }
      if (searchOpen) {
        resetSearch();
        return true;
      }
      if (serverSettingsOpen) {
        setServerSettingsOpen(false);
        return true;
      }
      if (mobilePanel) {
        setMobilePanel(null);
        return true;
      }
      // Из чата «Назад» ведёт к списку каналов, из списка каналов — на главный экран.
      if (state?.activeServerId) {
        if (mobile) setMobilePanel("channels");
        else openHome();
        return true;
      }
      return false;
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [mobile, mobilePanel, modal, searchOpen, serverSettingsOpen, state?.activeServerId, viewingScreenShareId]);

  // Второе нажатие «Назад» на главном экране закрывает приложение; первое — подсказка.
  useEffect(() => {
    setExitHintHandler(() => setNotice(t.mobile.exitHint));
    return () => setExitHintHandler(null);
  }, [t]);

  // Прокрутка в идеальный низ при открытии канала и при новых сообщениях: scrollIntoView({block:"end"})
  // останавливается на высоте нижнего отступа контейнера, а scrollTop = scrollHeight показывает
  // и нижний отступ — чат открывается ровно с самого дна. Медиа-превью (видео, изображения)
  // догружаются асинхронно и увеличивают контент уже после прокрутки: видео с preload="metadata"
  // не шлёт "load", поэтому слушаем события медиаэлементов плюс делаем короткие контрольные
  // прокрутки. Всё это — только пока пользователь у низа, чтобы чтение истории не дёргалось.
  useEffect(() => {
    const container = messageScrollRef.current;
    if (!container) return;
    const scrollToBottom = (): void => {
      container.scrollTop = container.scrollHeight;
    };
    const nearBottom = (): boolean => container.scrollHeight - container.clientHeight - container.scrollTop <= 120;
    let frame = window.requestAnimationFrame(scrollToBottom);
    const onMediaLoad: EventListener = () => {
      if (!nearBottom()) return;
      frame = window.requestAnimationFrame(scrollToBottom);
    };
    const mediaEvents = ["load", "loadeddata", "loadedmetadata", "canplay"];
    for (const type of mediaEvents) container.addEventListener(type, onMediaLoad, true);
    const settleTimers = [150, 400, 800].map((delay) =>
      window.setTimeout(() => {
        if (nearBottom()) frame = window.requestAnimationFrame(scrollToBottom);
      }, delay),
    );
    return () => {
      window.cancelAnimationFrame(frame);
      for (const type of mediaEvents) container.removeEventListener(type, onMediaLoad, true);
      for (const timer of settleTimers) window.clearTimeout(timer);
    };
  }, [state?.messages, state?.activeChannelId]);

  // Клавиатура на Android уменьшает высоту оболочки, а прокрутка ленты остаётся на
  // прежнем scrollTop — последние сообщения уезжали под поле ввода. Пока пользователь
  // читает низ ленты, держим его у низа при любом изменении высоты контейнера.
  useEffect(() => {
    const container = messageScrollRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    let atBottom = true;
    const onScroll = (): void => {
      atBottom = container.scrollHeight - container.clientHeight - container.scrollTop <= 120;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(() => {
      if (atBottom) container.scrollTop = container.scrollHeight;
    });
    observer.observe(container);
    return () => {
      container.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [state?.activeChannelId]);
  useEffect(() => {
    if (!highlightedMessageId) return;
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(`message-${highlightedMessageId}`);
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--theme-accent-rgb").trim() || "64 95 232";
      element?.animate([{ backgroundColor: `rgb(${accent} / .28)` }, { backgroundColor: `rgb(${accent} / 0)` }], { duration: 2_200, easing: "ease-out" });
    });
    const timer = window.setTimeout(() => setHighlightedMessageId(null), 2_500);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [highlightedMessageId, state?.activeChannelId]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function commit(update: (current: PersistedClientState) => PersistedClientState): void {
    setState((current) => {
      if (!current) return current;
      const next = update(current);
      void window.openCord?.storage.save(next).catch(() => setNotice(t.notices.storageSaveFailed));
      return next;
    });
  }

  function resetComposer(): void {
    setDraft("");
    setPendingAttachments([]);
    setReplyingToId(null);
  }

  function resetVoiceSession(): void {
    connection.leaveVoice();
    void voice.leave();
    setVoiceAuthorization(null);
    setViewingScreenShareId(null);
  }

  function resetSearch(): void {
    setSearchOpen(false);
    setSearchResult(null);
    setSearchLoading(false);
    searchRequestRef.current = null;
  }

  /** Сброс результатов поиска без закрытия панели — для кнопки сброса в панели поиска. */
  function resetSearchSession(): void {
    setSearchResult(null);
    setSearchLoading(false);
    searchRequestRef.current = null;
  }

  if (!state) return <div className="grid flex-1 place-items-center bg-canvas text-sm text-slate-500">{t.loadingApp}</div>;

  if (!state.onboardingComplete || !state.profile) {
    return (
      <Onboarding
        language={state.preferences.language}
        onLanguageChange={(language) =>
          commit((current) => ({
            ...current,
            preferences: { ...current.preferences, language },
          }))
        }
        onComplete={(profile) =>
          commit((current) => ({
            ...current,
            profile,
            onboardingComplete: true,
          }))
        }
      />
    );
  }

  const profile = state.profile;
  const activeServer = state.servers.find((server) => server.id === state.activeServerId);
  const currentAccess = activeServer ? accessByServer[activeServer.id] : undefined;
  const voiceCapability = activeServer ? voiceCapabilityByServer[activeServer.id] : undefined;
  const voiceParticipants = activeServer ? (voicePresenceByServer[activeServer.id] ?? []) : [];
  const updatePreset = activeServer ? (activeServer.deployment ?? deploymentPresetFromServer(activeServer)) : undefined;
  const activeChannel = activeServer?.channels.find((channel) => channel.id === state.activeChannelId) ?? activeServer?.channels.find((channel) => channel.kind === "text");
  const messages = activeChannel ? sortMessagesChronologically(state.messages.filter((message) => message.channelId === activeChannel.id)) : [];
  const replyingTo = replyingToId ? (messages.find((message) => message.id === replyingToId) ?? null) : null;
  const searchMembers =
    activeServer && !activeServer.members.some((member) => member.id === (currentAccess?.id ?? profile.id))
      ? [
          {
            id: currentAccess?.id ?? profile.id,
            username: profile.username,
            discriminator: profile.discriminator,
            fingerprint: selfIdentity?.fingerprint,
            role: t.roles.you,
            serverRole: currentAccess?.role,
            status: visibleProfileStatus(profile.status),
            avatarColor: "#4d6bfe",
            avatar: profile.avatar,
          },
          ...activeServer.members,
        ]
      : (activeServer?.members ?? []);
  const mentionCandidates: MentionCandidate[] = searchMembers.map(memberToMentionCandidate);
  const selfMember = searchMembers.find((member) => member.id === (currentAccess?.id ?? profile.id));
  const selfChatMuted = isChatMutedNow(selfMember);
  const selfChatMutedUntil = selfMember?.chatMutedUntil ?? null;
  function selectServer(server: MockServer): void {
    const channel = server.channels.find((item) => item.kind === "text");
    commit((current) => ({
      ...current,
      activeServerId: server.id,
      activeChannelId: channel?.id ?? null,
    }));
    setMobilePanel(null);
    setServerSettingsOpen(false);
    resetComposer();
    resetSearch();
    resetVoiceSession();
  }

  function openHome(): void {
    commit((current) => ({
      ...current,
      activeServerId: null,
      activeChannelId: null,
    }));
    resetComposer();
    setServerSettingsOpen(false);
    resetSearch();
    resetVoiceSession();
  }

  function selectChannel(channelId: string): void {
    commit((current) => ({ ...current, activeChannelId: channelId }));
    setMobilePanel(null);
    setServerSettingsOpen(false);
    resetComposer();
  }

  function pushToastForMessage(message: import("@opencord/shared").ChatMessage): void {
    if (!state || !connectionServer || !currentAccess) return;
    const channelName = connectionServer.channels.find((channel) => channel.id === message.channelId)?.name ?? t.chat.channelFallback;
    const excerpt = expandMentionsForEditing(message.content, connectionServer.members.map((member) => ({ id: member.id, username: member.username }))).slice(0, 120);
    const toast = buildToastForMessage({
      messageId: message.id,
      channelId: message.channelId,
      channelName,
      authorId: message.authorId,
      authorName: message.authorName,
      excerpt,
      mentionedUserIds: message.mentions.map((mention) => mention.userId),
      contentHasEveryone: containsEveryoneMention(message.content),
      selfUserId: currentAccess.id,
      activeChannelId: state.activeChannelId,
      windowFocused: typeof document === "undefined" ? true : document.hasFocus(),
      globalEnabled: state.preferences.notifications,
      settings: getChannelNotificationSettings(state.preferences, message.channelId),
    });
    if (toast) setToasts((current) => (current.some((item) => item.id === toast.id) ? current : [...current, toast]));
  }

  function openToastChannel(channelId: string): void {
    setToasts((current) => current.filter((item) => item.channelId !== channelId));
    selectChannel(channelId);
  }

  function dismissToast(id: string): void {
    setToasts((current) => current.filter((item) => item.id !== id));
  }

  function searchServer(filters: MessageSearchFilters): void {
    if (!activeServer || !state) return;
    setSearchLoading(true);
    if (!activeServer.address) {
      const result = searchLocalMessages(
        state.messages.filter((message) => activeServer.channels.some((channel) => channel.id === message.channelId)),
        filters,
        locale,
      );
      setSearchResult((current) =>
        result.offset > 0 && current
          ? {
              ...result,
              offset: 0,
              messages: [...current.messages, ...result.messages],
            }
          : result,
      );
      setSearchLoading(false);
      return;
    }
    const requestId = connection.searchMessages(filters);
    if (!requestId) {
      setSearchLoading(false);
      setNotice(t.notices.searchAfterConnection);
      return;
    }
    searchRequestRef.current = requestId;
    if (filters.offset === 0) setSearchResult(null);
  }

  function openSearchMessage(message: MockMessage): void {
    commit((current) => ({
      ...current,
      activeChannelId: message.channelId,
      messages: current.messages.some((item) => item.id === message.id) ? current.messages : [...current.messages, message],
    }));
    resetSearch();
    setHighlightedMessageId(message.id);
  }

  function joinVoiceChannel(channel: MockChannel): void {
    selectChannel(channel.id);
    if (!shouldRequestVoiceJoin(voice.status, voice.channelId, voiceAuthorization?.channelId ?? null, channel.id)) return;
    if (!activeServer?.address) {
      setNotice(t.notices.voiceOnlyOnServer);
      return;
    }
    if (voiceCapability?.status !== "available") {
      setNotice(voiceCapability?.warning ?? t.notices.voiceServerUnavailable);
      return;
    }
    if (!connection.joinVoice(channel.id)) setNotice(t.notices.voiceJoinNotReady);
  }

  function leaveVoiceChannel(): void {
    resetVoiceSession();
  }

  async function startScreenShare(settings: ScreenShareSettings): Promise<void> {
    await voice.startScreenShare(settings);
    playVoiceSound("screenShareStart");
    setViewingScreenShareId(currentAccess?.id ?? null);
    if (voice.channelId) selectChannel(voice.channelId);
    setNotice(t.notices.screenShareStarted);
  }

  async function stopScreenShare(): Promise<void> {
    await voice.stopScreenShare();
    playVoiceSound("screenShareStop");
    setNotice(t.notices.screenShareStopped);
  }

  function viewScreenShare(participantIdentity: string): void {
    // Своя же демонстрация открывается автоматически при запуске — там звучит screenShareStart.
    if (participantIdentity !== viewingScreenShareId && participantIdentity !== currentAccess?.id) playVoiceSound("screenShareViewStart");
    setViewingScreenShareId(participantIdentity);
    if (voice.channelId) selectChannel(voice.channelId);
  }

  function exitScreenShare(): void {
    if (viewingScreenShareId && viewingScreenShareId !== currentAccess?.id) playVoiceSound("screenShareViewStop");
    setViewingScreenShareId(null);
  }

  function addServer(server: MockServer): boolean {
    if (!state) return false;
    const duplicate = server.address ? state.servers.find((existing) => sameServerAddress(existing.address, server.address)) : undefined;
    if (duplicate) {
      selectServer(duplicate);
      setNotice(t.server.duplicateAddress);
      return false;
    }
    commit((current) => ({
      ...current,
      servers: [...current.servers, server],
      activeServerId: server.id,
      activeChannelId: server.channels[0]?.id ?? null,
    }));
    resetComposer();
    resetSearch();
    resetVoiceSession();
    setNotice(t.notices.serverAddedConnecting);
    return true;
  }

  function addDeployedServer(serverUrl: string, serverName: string, configuration: SavedDeploymentConfiguration): void {
    const replaced = state ? state.servers.some((server) => sameServerAddress(server.address, serverUrl)) : false;
    commit((current) => upsertDeployedServer(current, serverUrl, serverName, configuration));
    resetComposer();
    resetSearch();
    resetVoiceSession();
    setNotice(replaced ? t.notices.serverDeployedReplaced : t.server.addedNotice);
  }

  function updatedDeployedServer(serverUrl: string, serverName: string, configuration: SavedDeploymentConfiguration): void {
    if (!activeServer) return;
    commit((current) => ({
      ...current,
      servers: current.servers.map((server) =>
        server.id === activeServer.id
          ? {
              ...server,
              name: serverName,
              address: serverUrl,
              deployment: configuration,
            }
          : server,
      ),
    }));
    setAccessByServer((current) => {
      const next = { ...current };
      delete next[activeServer.id];
      return next;
    });
    setConnectionRevision((current) => current + 1);
    resetComposer();
    resetSearch();
    resetVoiceSession();
    setNotice(t.notices.serverUpdated);
  }

  function leaveServer(serverId: string): void {
    if (!state) return;
    const leavingServer = state.servers.find((server) => server.id === serverId);
    if (!leavingServer) return;
    if (leavingServer.address && !connection.leaveServer()) {
      setNotice(t.notices.leaveFirstConnect);
      return;
    }
    commit((current) => removeServers(current, (server) => server.id === serverId));
    setModal(null);
    resetComposer();
    resetSearch();
    resetVoiceSession();
    setNotice(t.server.left);
  }

  /** «Открыть настройки» из меню сервера в колонке: переключаемся на сервер и открываем полноэкранную страницу. */
  function openServerSettingsFromRail(server: MockServer): void {
    if (state?.activeServerId !== server.id) {
      selectServer(server);
      window.setTimeout(() => setServerSettingsOpen(true), 0);
      return;
    }
    setServerSettingsOpen(true);
  }

  /** «Отключиться от сервера» из меню сервера в колонке. */
  function disconnectFromRail(server: MockServer): void {
    const isActive = state?.activeServerId === server.id;
    if (!isActive) {
      selectServer(server);
      if (server.address) {
        // Удалённый сервер ещё не подключён: переключаемся на него и открываем диалог
        // выхода, чтобы сервер узнал об уходе участника через установленное соединение.
        setModal("leave");
        return;
      }
    }
    leaveServer(server.id);
  }

  function removeServerLocally(serverId: string): void {
    commit((current) => removeServers(current, (server) => server.id === serverId));
    setModal(null);
    resetComposer();
    resetSearch();
    resetVoiceSession();
    setNotice(t.server.removedLocally);
  }

  function saveProfile(profile: LocalProfile): void {
    commit((current) => ({
      ...current,
      profile,
      messages: current.messages.map((message) =>
        message.authorId === profile.id || message.authorId === currentAccess?.id
          ? {
              ...message,
              authorName: profile.username,
              authorAvatar: profile.avatar,
            }
          : message,
      ),
    }));
    if (
      activeServer?.address &&
      !connection.updateProfile({
        username: profile.username,
        discriminator: profile.discriminator,
        bio: profile.bio,
        avatar: profile.avatar,
        banner: profile.banner,
        memberBackground: profile.memberBackground ?? null,
        status: profile.status ?? "online",
        customStatus: profile.customStatus ?? "",
        customStatusEmoji: profile.customStatusEmoji ?? "",
        accentColor: profile.accentColor ?? null,
        nameGlow: profile.nameGlow ?? null,
        nameFont: profile.nameFont ?? "none",
      })
    )
      setNotice(t.notices.profileSavedLocalOnly);
  }

  function deleteServerForEveryone(): void {
    if (!connection.deleteServer()) {
      setNotice(t.notices.serverDeleteUnavailable);
      return;
    }
    setNotice(t.server.deleteRequested);
  }

  function updateServerAvatar(avatar: string | null): boolean {
    if (!connection.updateServerAvatar(avatar)) {
      setNotice(t.notices.serverAvatarUnavailable);
      return false;
    }
    setNotice(t.notices.avatarSent);
    return true;
  }

  function updateServerBanner(banner: string | null): boolean {
    if (!connection.updateServerBanner(banner)) {
      setNotice(t.notices.serverBannerUnavailable);
      return false;
    }
    setNotice(t.notices.avatarSent);
    return true;
  }

  function saveServerSettings(settings: ServerSettings): boolean {
    if (!connection.updateServerSettings(settings)) {
      setNotice(t.notices.serverSettingsUnavailable);
      return false;
    }
    setNotice(t.notices.serverSettingsSaved);
    return true;
  }

  function sendMessage(event: React.FormEvent): void {
    event.preventDefault();
    if (!activeChannel) return;
    const command = parseSlashCommand(draft, mentionCandidates);
    if (command.type === "roll") {
      const content = t.chat.rollResult(Math.floor(Math.random() * 101));
      sendPlainMessage(content);
      return;
    }
    if (command.type === "pm" || command.type === "apm") {
      if (!command.targetUserId) {
        setNotice(t.notices.pmTargetMissing);
        return;
      }
      if (!command.content) {
        setNotice(t.notices.pmMessageMissing);
        return;
      }
      if (command.targetUserId === (activeServer?.address ? currentAccess?.id : profile.id)) {
        setNotice(t.notices.pmSelf);
        return;
      }
      if (activeServer?.address) {
        if (!connection.sendPrivateMessage(command.type, activeChannel.id, command.content, command.targetUserId, replyingToId)) {
          setNotice(t.notices.messageNotReady);
          return;
        }
      } else {
        // Локальный демо-режим: сообщение сохраняется локально с пометкой личного.
        const message: MockMessage = {
          id: createId("message"),
          channelId: activeChannel.id,
          authorId: profile.id,
          authorName: profile.username,
          authorColor: "#4d6bfe",
          content: command.content,
          createdAt: new Date().toISOString(),
          kind: command.type,
          targetUserId: command.targetUserId,
          anonymous: command.type === "apm",
          replyToMessageId: replyingToId,
        };
        commit((current) => ({
          ...current,
          messages: [...current.messages, message],
        }));
      }
      setDraft("");
      setReplyingToId(null);
      return;
    }
    if (command.type === "mute" || command.type === "unmute") {
      if (!command.targetUserId) {
        setNotice(t.notices.pmTargetMissing);
        return;
      }
      if (command.targetUserId === (currentAccess?.id ?? profile.id)) {
        setNotice(t.notices.chatMuteSelf);
        return;
      }
      if (!activeServer?.address || !connection.setChatMuted(command.targetUserId, command.type === "mute", command.type === "mute" ? command.durationMinutes : null)) {
        setNotice(t.notices.chatMuteNotReady);
        return;
      }
      setNotice(command.type === "mute" ? t.notices.chatMutedForAll : t.notices.chatUnmuted);
      setDraft("");
      return;
    }
    const resolved = resolveDraftMentions(draft, mentionCandidates);
    sendPlainMessage(resolved.content, resolved.mentions);
  }

  /** Отправка обычного сообщения: на сервер или в локальный демо-чат. */
  function sendPlainMessage(content: string, mentions: string[] = []): void {
    const trimmed = content.trim();
    if ((!trimmed && pendingAttachments.length === 0) || !activeChannel) return;
    if (trimmed.length > 4000) {
      setNotice(t.notices.messageTooLong);
      return;
    }
    if (activeServer?.address) {
      if (
        !connection.sendMessage(
          activeChannel.id,
          trimmed,
          pendingAttachments.map((attachment) => attachment.id),
          mentions,
          replyingToId,
        )
      ) {
        setNotice(t.notices.messageNotReady);
        return;
      }
      setDraft("");
      setPendingAttachments([]);
      setReplyingToId(null);
      return;
    }
    const message: MockMessage = {
      id: createId("message"),
      channelId: activeChannel.id,
      authorId: profile.id,
      authorName: profile.username,
      authorColor: "#4d6bfe",
      content: trimmed,
      createdAt: new Date().toISOString(),
      mentions,
      replyToMessageId: replyingToId,
    };
    commit((current) => ({
      ...current,
      messages: [...current.messages, message],
    }));
    setDraft("");
    setReplyingToId(null);
  }

  function editMessage(message: MockMessage, content: string, attachments: Attachment[]): boolean {
    const resolved = resolveDraftMentions(content, mentionCandidates);
    if (resolved.content.length > 4000) {
      setNotice(t.notices.messageTooLong);
      return false;
    }
    if (activeServer?.address) {
      if (
        !connection.updateMessage(
          message.id,
          resolved.content,
          attachments.map((attachment) => attachment.id),
          resolved.mentions,
        )
      ) {
        setNotice(t.notices.editNotReady);
        return false;
      }
      return true;
    }
    if (message.authorId !== profile.id || (!resolved.content && attachments.length === 0)) return false;
    commit((current) => ({
      ...current,
      messages: current.messages.map((item) =>
        item.id === message.id
          ? {
              ...item,
              content: resolved.content,
              mentions: resolved.mentions,
              attachments,
              editedAt: new Date().toISOString(),
            }
          : item,
      ),
    }));
    return true;
  }

  function deleteMessage(message: MockMessage): boolean {
    if (activeServer?.address) {
      if (!connection.deleteMessage(message.id)) {
        setNotice(t.notices.deleteNotReady);
        return false;
      }
      return true;
    }
    if (message.authorId !== profile.id) return false;
    commit((current) => ({
      ...current,
      messages: current.messages.filter((item) => item.id !== message.id),
    }));
    return true;
  }

  async function selectAndUploadAttachment(): Promise<Attachment | null> {
    if (!activeServer?.address || !connection.sessionToken || uploadingAttachment) return null;
    const bridge = window.openCord?.attachments;
    if (!bridge) {
      setNotice(t.notices.attachmentBridgeUnavailable);
      return null;
    }
    setUploadingAttachment(true);
    try {
      return await bridge.selectAndUpload({
        serverAddress: activeServer.address,
        sessionToken: connection.sessionToken,
        maxAttachmentBytes: activeServer.maxAttachmentBytes,
        latencySensitive: ["connecting", "connected", "reconnecting"].includes(voice.status),
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.notices.uploadFailed);
      return null;
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function attachFile(): Promise<void> {
    if (pendingAttachments.length >= 5) return;
    const attachment = await selectAndUploadAttachment();
    if (attachment) setPendingAttachments((current) => [...current, attachment].slice(0, 5));
  }

  /** Вставка файлов через Ctrl+V и drag&drop: последовательная загрузка через мост вложений. */
  async function uploadPastedFiles(files: FileList | File[]): Promise<void> {
    const bridge = window.openCord?.attachments;
    if (!activeServer?.address || !connection.sessionToken || !bridge?.uploadFile) {
      setNotice(t.chat.attachAfterConnection);
      return;
    }
    const remaining = 5 - pendingAttachments.length;
    if (remaining <= 0) return;
    const candidates = Array.from(files)
      .filter((file) => file.size > 0)
      .slice(0, remaining);
    if (candidates.length === 0) return;
    setUploadingAttachment(true);
    try {
      for (const file of candidates) {
        const attachment = await bridge.uploadFile(
          {
            serverAddress: activeServer.address,
            sessionToken: connection.sessionToken,
            maxAttachmentBytes: activeServer.maxAttachmentBytes,
            latencySensitive: ["connecting", "connected", "reconnecting"].includes(voice.status),
          },
          file,
        );
        setPendingAttachments((current) => (current.some((item) => item.id === attachment.id) ? current : [...current, attachment].slice(0, 5)));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.notices.uploadFailed);
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function saveAttachment(attachment: Attachment): Promise<void> {
    if (!activeServer?.address || !connection.sessionToken) {
      setNotice(t.notices.downloadRequiresConnection);
      return;
    }
    try {
      await window.openCord?.attachments.download({
        serverAddress: activeServer.address,
        sessionToken: connection.sessionToken,
        attachment,
        latencySensitive: ["connecting", "connected", "reconnecting"].includes(voice.status),
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t.notices.downloadFailed);
    }
  }

  async function loadAttachmentPreview(attachment: Attachment): Promise<string> {
    if (!activeServer?.address || !connection.sessionToken) throw new Error(t.notices.previewRequiresConnection);
    const bridge = window.openCord?.attachments;
    if (!bridge) throw new Error(t.notices.attachmentBridgeUnavailable);
    return bridge.preview({
      serverAddress: activeServer.address,
      sessionToken: connection.sessionToken,
      attachment,
      latencySensitive: ["connecting", "connected", "reconnecting"].includes(voice.status),
    });
  }

  function createServerChannel(name: string, kind: "text" | "voice", description: string, participantLimit: number | null): void {
    if (!connection.createChannel(name, kind, description, participantLimit)) {
      setNotice(t.notices.channelCreateNotReady);
      return;
    }
    setModal(null);
    setNotice(t.notices.channelCreateRequested);
  }

  function editServerChannel(channel: MockChannel, name: string, description: string, participantLimit: number | null, slowmodeSeconds: number): void {
    if (!connection.updateChannel(channel.id, name, description, participantLimit, slowmodeSeconds)) {
      setNotice(t.channel.updateUnavailable);
      return;
    }
    setModal(null);
    setManagedChannel(null);
    setNotice(t.channel.updateRequested);
  }

  function applyChannelsSlowmode(channelIds: string[], slowmodeSeconds: number): void {
    if (!connection.setChannelsSlowmode(channelIds, slowmodeSeconds)) {
      setNotice(t.channel.slowmodeBulkUnavailable);
      return;
    }
    setModal(null);
    setNotice(t.channel.slowmodeBulkRequested);
  }

  function deleteServerChannel(channel: MockChannel): void {
    if (!connection.deleteChannel(channel.id)) {
      setNotice(t.channel.deleteUnavailable);
      return;
    }
    setModal(null);
    setManagedChannel(null);
    setNotice(t.channel.deleteRequested);
  }

  function openChannelModal(channel: MockChannel, action: "channel-edit" | "channel-delete"): void {
    setManagedChannel(channel);
    setModal(action);
  }

  function setServerMemberRole(userId: string, role: "administrator" | "member"): void {
    if (!connection.setMemberRole(userId, role)) {
      setNotice(t.notices.roleNotReady);
      return;
    }
    setNotice(role === "administrator" ? t.notices.adminGranting : t.notices.adminRevoking);
  }

  function kickServerMember(userId: string): void {
    if (!connection.kickMember(userId)) {
      setNotice(t.notices.kickNotReady);
      return;
    }
    setNotice(t.notices.kickRequested);
  }

  function banServerMember(userId: string, durationMinutes: BanDurationMinutes): void {
    if (!connection.banMember(userId, durationMinutes)) {
      setNotice(t.notices.banNotReady);
      return;
    }
    setNotice(t.notices.banRequested);
  }

  function unbanServerMember(userId: string): void {
    if (!connection.unbanMember(userId)) {
      setNotice(t.notices.unbanNotReady);
      return;
    }
    setNotice(t.notices.unbanRequested);
  }

  function disconnectVoiceParticipant(userId: string): void {
    if (!connection.disconnectVoiceMember(userId)) {
      setNotice(t.notices.disconnectNotReady);
      return;
    }
    setNotice(t.notices.disconnectRequested);
  }

  function setVoiceParticipantServerMuted(userId: string, muted: boolean): void {
    if (!connection.setVoiceMemberMuted(userId, muted)) {
      setNotice(t.notices.muteNotReady);
      return;
    }
    setNotice(muted ? t.notices.mutedForAll : t.notices.serverMuteRemoved);
  }

  /** Сброс ключа меняет дискриминатор: локальный профиль подтягивает новый тег. */
  function applyResetIdentity(identity: { publicKey: string; fingerprint: string; discriminator: string }): void {
    commit((current) =>
      current.profile && current.profile.discriminator !== identity.discriminator
        ? { ...current, profile: { ...current.profile, discriminator: identity.discriminator } }
        : current,
    );
  }

  async function reset(): Promise<void> {
    const resetState = window.openCord ? await window.openCord.storage.reset() : createDefaultState();
    setState(resetState);
    setConfirmReset(false);
    setModal(null);
    resetComposer();
    resetSearch();
    resetVoiceSession();
  }

  // Панель серверов и список каналов собираются один раз: на телефоне они уезжают
  // в выдвижную панель, на десктопе стоят колонками. Раньше разметка дублировалась.
  const serverRail = (
    <ServerRail
      mobile={mobile}
      servers={state.servers}
      activeId={activeServer?.id}
      onHome={openHome}
      onSelect={selectServer}
      onCreate={() => setModal("create")}
      onConnect={() => setModal("connect")}
      showCreate={!mobile}
      onManage={openServerSettingsFromRail}
      onDisconnect={disconnectFromRail}
      canManageServer={(server) => {
        const access = accessByServer[server.id];
        return access?.role === "owner" || access?.role === "administrator";
      }}
    />
  );

  const channelSidebar = activeServer ? (
    <ChannelSidebar
      mobile={mobile}
      server={activeServer}
      activeChannelId={activeChannel?.id}
      profile={state.profile}
      canManageChannels={currentAccess?.permissions.includes("MANAGE_CHANNELS") === true}
      voiceCapability={voiceCapability}
      voiceParticipants={voiceParticipants}
      voiceChannelId={voice.channelId}
      voiceStatus={voice.status}
      muted={effectiveMuted}
      serverMuted={serverMuted}
      deafened={voice.deafened}
      activeSpeakerIds={voice.activeSpeakerIds}
      screenShareParticipantIds={voice.screenShares.map((stream) => stream.participantIdentity)}
      isScreenSharing={voice.isScreenSharing}
      currentUserId={currentAccess?.id ?? profile.id}
      onCreateChannel={() => setModal("channel")}
      onEditChannel={(channel) => openChannelModal(channel, "channel-edit")}
      onDeleteChannel={(channel) => openChannelModal(channel, "channel-delete")}
      onBulkSlowmode={() => setModal("channel-slowmode")}
      onSelectChannel={selectChannel}
      onServerMenu={() => setModal("leave")}
      onProfile={() => setModal("profile")}
      onSettings={() => setModal("settings")}
      onJoinVoice={joinVoiceChannel}
      onLeaveVoice={leaveVoiceChannel}
      onMuted={(value) => {
        if (!serverMuted) void voice.setMuted(value);
      }}
      onDeafened={(value) => void voice.setDeafened(value)}
      onStartScreenShare={() => setModal("screen-share")}
      onStopScreenShare={() => void stopScreenShare()}
      onViewScreenShare={viewScreenShare}
    />
  ) : null;

  // Жесты: свайп от левого края открывает каналы, от правого — участников;
  // свайп по самой панели её закрывает. Порог по вертикали отсекает прокрутку.
  const EDGE = 28;
  const THRESHOLD = 56;
  function beginSwipe(edge: "left" | "right" | "panel", event: React.TouchEvent): void {
    const touch = event.touches[0];
    if (!touch || event.touches.length !== 1) {
      swipeStartRef.current = null;
      return;
    }
    if (edge !== "panel") {
      const fromEdge = edge === "left" ? touch.clientX <= EDGE : touch.clientX >= window.innerWidth - EDGE;
      if (!fromEdge) {
        swipeStartRef.current = null;
        return;
      }
    }
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY, edge };
  }
  function endSwipe(event: React.TouchEvent, onOpen?: (edge: "left" | "right") => void, onClose?: () => void): void {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    if (Math.abs(touch.clientY - start.y) > Math.abs(deltaX)) return;
    if (start.edge === "left" && deltaX > THRESHOLD) onOpen?.("left");
    else if (start.edge === "right" && deltaX < -THRESHOLD) onOpen?.("right");
    else if (start.edge === "panel" && Math.abs(deltaX) > THRESHOLD) onClose?.();
  }

  return (
    <main className="relative flex min-h-0 flex-1 overflow-hidden bg-canvas text-slate-200">
      {(!mobile || !activeServer) && serverRail}
      {serverSettingsOpen && activeServer && currentAccess && (
        <ServerSettingsPage
          key={activeServer.id}
          mobile={mobile}
          server={activeServer}
          profile={profile}
          access={currentAccess}
          onClose={() => setServerSettingsOpen(false)}
          onAvatar={() => setModal("server-avatar")}
          onBanner={() => setModal("server-banner")}
          onSaveSettings={saveServerSettings}
          onSetRole={setServerMemberRole}
          onKick={kickServerMember}
          onBan={banServerMember}
          onUnban={unbanServerMember}
        />
      )}
      {mobile && activeServer && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setMobilePanel(null)}
            className={cn("absolute inset-0 z-30 bg-black/60 transition-opacity duration-200", mobilePanel === null ? "pointer-events-none opacity-0" : "opacity-100")}
          />
          <div
            aria-hidden={mobilePanel !== "channels"}
            onTouchStart={(event) => beginSwipe("panel", event)}
            onTouchEnd={(event) => endSwipe(event, undefined, () => setMobilePanel(null))}
            className={cn(
              "absolute inset-y-0 left-0 z-40 flex w-[86%] max-w-[336px] shadow-[10px_0_44px_rgba(0,0,0,.5)] transition-transform duration-200 ease-out",
              mobilePanel === "channels" ? "translate-x-0" : "pointer-events-none -translate-x-full",
            )}
          >
            {serverRail}
            <div className="flex min-w-0 flex-1 [&>aside]:w-full">{channelSidebar}</div>
          </div>
          <div
            aria-hidden={mobilePanel !== "members"}
            onTouchStart={(event) => beginSwipe("panel", event)}
            onTouchEnd={(event) => endSwipe(event, undefined, () => setMobilePanel(null))}
            className={cn(
              "absolute inset-y-0 right-0 z-40 flex w-[80%] max-w-[320px] shadow-[-10px_0_44px_rgba(0,0,0,.5)] transition-transform duration-200 ease-out [&>aside]:w-full",
              mobilePanel === "members" ? "translate-x-0" : "pointer-events-none translate-x-full",
            )}
          >
            <MemberList server={activeServer} profile={state.profile} access={currentAccess} />
          </div>
        </>
      )}
      {activeServer && connection.status === "banned" ? (
        <BannedView
          server={activeServer}
          expiresAt={connection.banExpiresAt}
          onRetry={() => setConnectionRevision((current) => current + 1)}
          onRemove={() => removeServerLocally(activeServer.id)}
        />
      ) : activeServer ? (
        <>
          {!mobile && channelSidebar}
          {activeChannel?.kind === "voice" ? (
            <VoiceChannelView
              mobile={mobile}
              onOpenChannels={() => setMobilePanel("channels")}
              channel={activeChannel}
              server={activeServer}
              profile={profile}
              participants={voiceParticipants}
              currentUserId={currentAccess?.id ?? profile.id}
              currentUserRole={currentAccess?.role}
              canModerateVoice={currentAccess?.permissions.includes("VOICE_MODERATE") === true}
              connectedChannelId={voice.channelId}
              status={voice.status}
              muted={effectiveMuted}
              serverMuted={serverMuted}
              deafened={voice.deafened}
              locallyMutedParticipantIds={voice.locallyMutedParticipantIds}
              participantVolumes={voice.participantVolumes}
              activeSpeakerIds={voice.activeSpeakerIds}
              screenShares={voice.screenShares}
              viewingScreenShareId={viewingScreenShareId}
              isScreenSharing={voice.isScreenSharing}
              onMuted={(value) => {
                if (!serverMuted) void voice.setMuted(value);
              }}
              onDeafened={(value) => void voice.setDeafened(value)}
              onParticipantMuted={voice.setParticipantMuted}
              onParticipantVolume={voice.setParticipantVolume}
              onServerMuted={setVoiceParticipantServerMuted}
              onDisconnectParticipant={disconnectVoiceParticipant}
              onStartScreenShare={() => setModal("screen-share")}
              onStopScreenShare={() => void stopScreenShare()}
              onViewScreenShare={viewScreenShare}
              onExitScreenShare={() => exitScreenShare()}
              onLeaveVoice={leaveVoiceChannel}
            />
          ) : activeChannel ? (
            <section
              className="relative flex min-w-0 flex-1 flex-col bg-canvas"
              onTouchStart={mobile ? (event) => beginSwipe((event.touches[0]?.clientX ?? 0) <= EDGE ? "left" : "right", event) : undefined}
              onTouchEnd={mobile ? (event) => endSwipe(event, (edge) => setMobilePanel(edge === "right" ? "members" : "channels")) : undefined}
              onDragEnter={(event) => {
                if (event.dataTransfer.types.includes("Files")) {
                  dragDepthRef.current += 1;
                  setDraggingFiles(true);
                }
              }}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("Files")) event.preventDefault();
              }}
              onDragLeave={(event) => {
                if (!event.dataTransfer.types.includes("Files")) return;
                dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                if (dragDepthRef.current === 0) setDraggingFiles(false);
              }}
              onDrop={(event) => {
                dragDepthRef.current = 0;
                setDraggingFiles(false);
                const files = event.dataTransfer.files;
                if (files.length > 0) {
                  event.preventDefault();
                  void uploadPastedFiles(files);
                }
              }}
              onPaste={(event) => {
                const files = event.clipboardData.files;
                if (files.length > 0) {
                  event.preventDefault();
                  void uploadPastedFiles(files);
                }
              }}
            >
              <ChatHeader
                mobile={mobile}
                channelName={activeChannel?.name ?? t.chat.channelFallback}
                description={activeChannel?.description ?? ""}
                connectionStatus={activeServer.address ? connection.status : "demo"}
                memberList={mobile ? mobilePanel === "members" : state.preferences.showMemberList}
                channelsOpen={mobile && mobilePanel === "channels"}
                searchOpen={searchOpen}
                channels={activeServer.channels}
                activeChannelId={activeChannel?.id ?? null}
                preferences={state.preferences}
                onPreferences={(preferences) => commit((current) => ({ ...current, preferences }))}
                onMenu={() => setMobilePanel(mobilePanel === "channels" ? null : "channels")}
                onSearch={() => setSearchOpen(true)}
                onToggleMembers={() => {
                  if (mobile) setMobilePanel(mobilePanel === "members" ? null : "members");
                  else
                    commit((current) => ({
                      ...current,
                      preferences: {
                        ...current.preferences,
                        showMemberList: !current.preferences.showMemberList,
                      },
                    }));
                }}
              />
              <ProtocolNotice status={connection.status} />
              <div className="flex min-h-0 flex-1">
                <div className="flex min-w-0 flex-1 flex-col">
                  <div ref={messageScrollRef} className={cn("scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-5 max-md:px-2.5 max-md:py-3", state.preferences.compactMode && "py-3")}>
                    <ChannelIntro name={activeChannel?.name ?? t.chat.channelFallback} description={activeChannel?.description ?? ""} networked={Boolean(activeServer.address)} />
                    {messages.length ? messages.map((message, index) => <Message key={message.id} message={message} replyToMessage={message.replyToMessageId ? messages.find((candidate) => candidate.id === message.replyToMessageId) : undefined} member={activeServer.members.find((member) => member.id === message.authorId)} members={searchMembers} profile={state.profile} compact={state.preferences.compactMode} grouped={index > 0 && messages[index - 1]?.authorId === message.authorId} privateStackPosition={privateMessageStackPosition(messages, index)} ownAvatar={message.authorId === state.profile?.id ? state.profile?.avatar : null} currentUserId={activeServer.address ? currentAccess?.id : profile.id} canManageMessages={currentAccess?.permissions.includes("MANAGE_MESSAGES") === true} previewAvailable={Boolean(activeServer.address && connection.sessionToken)} canAttach={Boolean(activeServer.address && connection.sessionToken)} attachmentLimitLabel={formatAttachmentLimit(activeServer.maxAttachmentBytes, t)} uploading={uploadingAttachment} onAttach={selectAndUploadAttachment} onEdit={editMessage} onDelete={deleteMessage} onDownload={saveAttachment} onPreview={loadAttachmentPreview} onToggleReaction={connection.toggleReaction} onReply={(target) => setReplyingToId(target.id)} canReact={Boolean(activeServer.address && connection.status === "connected")} />) : <p className="py-8 text-center text-sm text-slate-600">{t.chat.empty}</p>}
                  </div>
                  <Composer draft={draft} channelName={activeChannel?.name ?? t.chat.channelFallback} disabled={Boolean(activeServer.address && connection.status !== "connected")} attachments={pendingAttachments} uploading={uploadingAttachment} canAttach={Boolean(activeServer.address && connection.sessionToken)} attachmentLimitLabel={formatAttachmentLimit(activeServer.maxAttachmentBytes, t)} maxAttachmentBytes={activeServer.maxAttachmentBytes ?? null} replyingTo={replyingTo} onCancelReply={() => setReplyingToId(null)} onAttach={() => void attachFile()} onVoiceFile={(file) => void uploadPastedFiles([file])} onRemoveAttachment={(id) => setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id))} onDraft={setDraft} onSubmit={sendMessage} members={mentionCandidates} chatMuted={selfChatMuted} chatMutedUntil={selfChatMutedUntil} canModerateChat={currentAccess?.permissions.includes("MANAGE_MESSAGES") === true} />
                </div>
                {!mobile && state.preferences.showMemberList && <MemberList server={activeServer} profile={state.profile} access={currentAccess} />}
              </div>
              <ServerSearchPanel open={searchOpen} serverName={activeServer.name} channels={activeServer.channels} members={searchMembers} result={searchResult} loading={searchLoading} onClose={() => resetSearch()} onReset={resetSearchSession} onSearch={searchServer} onOpenMessage={openSearchMessage} previewAvailable={Boolean(activeServer.address && connection.sessionToken)} onPreview={loadAttachmentPreview} />
              {draggingFiles && (
                <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-black/40">
                  <div className="rounded-2xl border-2 border-dashed border-violet-400/80 bg-canvas/95 px-8 py-5 text-sm font-semibold text-violet-100 shadow-2xl">{t.chat.dropFiles}</div>
                </div>
              )}
            </section>
          ) : (
            <NoTextChannelView
              mobile={mobile}
              onOpenChannels={() => setMobilePanel("channels")}
              server={activeServer}
              profile={state.profile}
              access={currentAccess}
              connectionStatus={activeServer.address ? connection.status : "demo"}
              showMembers={!mobile && state.preferences.showMemberList}
              onCreate={() => setModal("channel")}
              onToggleMembers={() => {
                if (mobile) {
                  setMobilePanel(mobilePanel === "members" ? null : "members");
                  return;
                }
                commit((current) => ({
                  ...current,
                  preferences: {
                    ...current.preferences,
                    showMemberList: !current.preferences.showMemberList,
                  },
                }));
              }}
            />
          )}
        </>
      ) : (
        <HomeScreen showCreate={!mobile} serverCount={state.servers.length} profile={state.profile} onCreate={() => setModal("create")} onConnect={() => setModal("connect")} onProfile={() => setModal("profile")} onSettings={() => setModal("settings")} />
      )}
      {notice && (
        <div role="status" className="glass absolute bottom-5 left-1/2 z-40 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl px-4 py-2.5 text-center text-xs font-medium text-slate-200 shadow-xl">
          {notice}
        </div>
      )}
      <NotificationToasts toasts={toasts} onOpen={openToastChannel} onDismiss={dismissToast} />
      <DeploymentDialog open={modal === "create"} onOpenChange={(open) => setModal(open ? "create" : null)} onDeployed={addDeployedServer} />
      {activeServer && updatePreset && <DeploymentDialog key={`update-${activeServer.id}`} open={modal === "update"} updateOnly preset={updatePreset} onOpenChange={(open) => setModal(open ? "update" : null)} onDeployed={updatedDeployedServer} />}
      <ServerDialog open={modal === "connect"} onOpenChange={(open) => setModal(open ? "connect" : null)} onAdd={addServer} />
      <ProfileDialog key={modal === "profile" ? "profile-open" : "profile-closed"} profile={state.profile} open={modal === "profile"} onOpenChange={(open) => setModal(open ? "profile" : null)} onSave={saveProfile} />
      {modal === "settings" && (mobile ? (
        // На телефоне настройки — набор полноэкранных экранов с переходами,
        // а не диалог: разделов много, и в одну прокручиваемую ленту они не ложатся.
        <MobileSettingsScreen
          preferences={state.preferences}
          confirmReset={confirmReset}
          onClose={() => {
            setModal(null);
            setConfirmReset(false);
          }}
          onPreferences={(preferences) => commit((current) => ({ ...current, preferences }))}
          onRequestReset={() => setConfirmReset(true)}
          onCancelReset={() => setConfirmReset(false)}
          onReset={() => void reset()}
          onIdentityReset={applyResetIdentity}
        />
      ) : (
        <SettingsDialog
          preferences={state.preferences}
          open
          confirmReset={confirmReset}
          onOpenChange={(open) => {
            setModal(open ? "settings" : null);
            if (!open) setConfirmReset(false);
          }}
          onPreferences={(preferences) => commit((current) => ({ ...current, preferences }))}
          onRequestReset={() => setConfirmReset(true)}
          onCancelReset={() => setConfirmReset(false)}
          onReset={() => void reset()}
          onIdentityReset={applyResetIdentity}
        />
      ))}
      {activeServer && <ServerPreviewDialog server={activeServer} canOpenSettings={currentAccess?.role === "owner" || currentAccess?.role === "administrator"} canUpdate={Boolean(updatePreset) && (Boolean(activeServer.deployment) || currentAccess?.role === "owner" || connection.status === "server-outdated")} canDeleteForAll={currentAccess?.permissions.includes("DELETE_SERVER") === true} canRemoveLocal={Boolean(activeServer.address) && connection.status !== "connected"} open={modal === "leave"} onOpenChange={(open) => setModal(open ? "leave" : null)} onSettings={() => { setModal(null); setServerSettingsOpen(true); }} onUpdate={() => setModal("update")} onLeave={() => leaveServer(activeServer.id)} onRemoveLocal={() => removeServerLocally(activeServer.id)} onDeleteForAll={deleteServerForEveryone} />}
      {activeServer && <ServerAvatarDialog key={`${activeServer.id}-${activeServer.avatar ?? "none"}`} server={activeServer} open={modal === "server-avatar"} onOpenChange={(open) => setModal(open ? "server-avatar" : null)} onSave={updateServerAvatar} />}
      {activeServer && <ServerBannerDialog key={`${activeServer.id}-${activeServer.banner ?? "none"}`} server={activeServer} open={modal === "server-banner"} onOpenChange={(open) => setModal(open ? "server-banner" : null)} onSave={updateServerBanner} />}
      <ChannelDialog open={modal === "channel"} onOpenChange={(open) => setModal(open ? "channel" : null)} onCreate={createServerChannel} />
      {managedChannel && (
        <EditChannelDialog
          key={managedChannel.id}
          channel={managedChannel}
          open={modal === "channel-edit"}
          onOpenChange={(open) => {
            setModal(open ? "channel-edit" : null);
            if (!open) setManagedChannel(null);
          }}
          onSave={(name, description, participantLimit, slowmodeSeconds) => editServerChannel(managedChannel, name, description, participantLimit, slowmodeSeconds)}
        />
      )}
      {activeServer && (
        <ChannelSlowmodeDialog
          key={modal === "channel-slowmode" ? "slowmode-open" : "slowmode-closed"}
          channels={activeServer.channels}
          open={modal === "channel-slowmode"}
          onOpenChange={(open) => setModal(open ? "channel-slowmode" : null)}
          onApply={applyChannelsSlowmode}
        />
      )}
      {managedChannel && (
        <DeleteChannelDialog
          channel={managedChannel}
          open={modal === "channel-delete"}
          onOpenChange={(open) => {
            setModal(open ? "channel-delete" : null);
            if (!open) setManagedChannel(null);
          }}
          onConfirm={() => deleteServerChannel(managedChannel)}
        />
      )}
      <ScreenShareDialog open={modal === "screen-share"} maxResolution={activeServer?.screenShareMaxResolution ?? DEFAULT_SCREEN_SHARE_MAX_RESOLUTION} maxFrameRate={activeServer?.screenShareMaxFrameRate ?? DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE} onOpenChange={(open) => setModal(open ? "screen-share" : null)} onStart={startScreenShare} />
    </main>
  );
}

function ServerRail({ mobile = false, servers, activeId, onHome, onSelect, onCreate, onConnect, showCreate = true, onManage, onDisconnect, canManageServer }: { mobile?: boolean; servers: MockServer[]; activeId?: string; onHome: () => void; onSelect: (server: MockServer) => void; onCreate: () => void; onConnect: () => void; showCreate?: boolean; onManage: (server: MockServer) => void; onDisconnect: (server: MockServer) => void; canManageServer: (server: MockServer) => boolean }): React.ReactElement {
  const { t } = useI18n();
  const [menu, setMenu] = useState<{
    server: MockServer;
    x: number;
    y: number;
  } | null>(null);
  const longPressRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
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
  }, [menu]);

  function openMenu(event: React.MouseEvent, server: MockServer): void {
    event.preventDefault();
    openMenuAt(server, event.clientX, event.clientY);
  }

  function openMenuAt(server: MockServer, clientX: number, clientY: number): void {
    setMenu({
      server,
      x: Math.max(8, Math.min(clientX, window.innerWidth - 232)),
      y: Math.max(8, Math.min(clientY, window.innerHeight - 140)),
    });
  }

  // На сенсорном экране правой кнопки нет: меню сервера открывается долгим нажатием.
  function longPressHandlers(server: MockServer): { onTouchStart: (event: React.TouchEvent) => void; onTouchEnd: () => void; onTouchMove: () => void } {
    const cancel = (): void => {
      if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    };
    return {
      onTouchStart: (event) => {
        const touch = event.touches[0];
        if (!touch) return;
        cancel();
        longPressRef.current = window.setTimeout(() => openMenuAt(server, touch.clientX, touch.clientY), 480);
      },
      onTouchEnd: cancel,
      onTouchMove: cancel,
    };
  }

  return (
    <nav aria-label={t.nav.servers} className={cn("flex shrink-0 flex-col items-center gap-2 border-r border-white/[.055] bg-rail py-3", mobile ? "w-16" : "w-[76px]")}>
      <button aria-label={t.nav.friends} title={t.nav.friends} onClick={onHome} className={cn("mb-1 grid size-12 place-items-center rounded-xl bg-primary text-lg font-bold text-white shadow-[0_1px_3px_rgba(0,0,0,.4)] transition-colors", activeId ? "hover:bg-violet-400" : "ring-2 ring-white/70 ring-offset-2 ring-offset-rail")}>
        O
      </button>
      <div className="h-px w-8 bg-white/10" />
      <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-1">
        {servers.map((server) => (
          <button key={server.id} title={server.name} onClick={() => onSelect(server)} onDoubleClick={(event) => openMenu(event, server)} onContextMenu={(event) => openMenu(event, server)} {...(mobile ? longPressHandlers(server) : {})} className={cn("group relative grid size-12 shrink-0 place-items-center rounded-xl bg-panel text-xs font-bold text-slate-300 transition-colors hover:bg-primary hover:text-white", activeId === server.id && "bg-primary text-white")}>
            <span className={cn("absolute -left-3 z-10 w-1 rounded-r-full bg-white transition-all", activeId === server.id ? "h-8" : "h-0 group-hover:h-5")} />
            {server.avatar ? <Image src={server.avatar} alt="" width={48} height={48} unoptimized className="size-12 rounded-xl object-cover" /> : initials(server.name)}
          </button>
        ))}
      </div>
      {showCreate && (
        <button title={t.server.create} onClick={onCreate} className="grid size-11 shrink-0 place-items-center rounded-[17px] bg-emerald-400/8 text-emerald-400 transition hover:rounded-[13px] hover:bg-emerald-500 hover:text-white">
          <Plus className="size-5" />
        </button>
      )}
      <button title={t.server.connect} onClick={onConnect} className="grid size-11 shrink-0 place-items-center rounded-[17px] bg-cyan-400/8 text-cyan-300 transition hover:rounded-[13px] hover:bg-cyan-500 hover:text-white">
        <LogIn className="size-4" />
      </button>
      {menu && (
        <div role="menu" aria-label={t.nav.serverMenu(menu.server.name)} onPointerDown={(event) => event.stopPropagation()} className="glass fixed z-[80] w-56 rounded-xl p-1.5 shadow-[0_18px_55px_rgba(0,0,0,.5)]" style={{ left: menu.x, top: menu.y }}>
          {canManageServer(menu.server) && (
            <button
              role="menuitem"
              onClick={() => {
                const server = menu.server;
                setMenu(null);
                onManage(server);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-300 hover:bg-white/[.06] hover:text-white"
            >
              <Settings className="size-3.5" />
              {t.nav.openServerSettings}
            </button>
          )}
          <button
            role="menuitem"
            onClick={() => {
              const server = menu.server;
              setMenu(null);
              onDisconnect(server);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-red-300 hover:bg-red-400/10"
          >
            <LogOut className="size-3.5" />
            {t.nav.disconnectServer}
          </button>
        </div>
      )}
    </nav>
  );
}

function HomeScreen({ serverCount, profile, onCreate, onConnect, onProfile, onSettings, showCreate = true }: { serverCount: number; profile: LocalProfile; onCreate: () => void; onConnect: () => void; onProfile: () => void; onSettings: () => void; showCreate?: boolean }): React.ReactElement {
  const { t } = useI18n();
  return (
    <section className="relative flex min-w-0 flex-1 items-center justify-center bg-canvas px-4 sm:px-8">
      <button type="button" aria-label={t.settings.title} title={t.settings.title} onClick={onSettings} className="absolute right-3 top-3 rounded-lg p-2 text-slate-500 transition hover:bg-white/6 hover:text-slate-200 sm:right-5 sm:top-5">
        <Settings className="size-5" />
      </button>
      <div className="w-full max-w-2xl text-center">
        <div className="mx-auto mb-5 grid size-16 place-items-center rounded-2xl bg-primary text-2xl font-bold text-white shadow-[0_1px_3px_rgba(0,0,0,.4)]">O</div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[.18em] text-violet-300/80">{t.appName}</p>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{t.home.title}</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-500">{t.home.description(serverCount)}</p>
        <div className={cn("mx-auto mt-8 grid max-w-lg gap-3", showCreate ? "grid-cols-2 max-md:grid-cols-1" : "grid-cols-1")}>
          <Button onClick={onConnect} className="h-12">
            <LogIn className="size-4" />
            {t.home.connect}
          </Button>
          {showCreate && (
            <Button variant="secondary" onClick={onCreate} className="h-12">
              <Plus className="size-4" />
              {t.home.create}
            </Button>
          )}
        </div>
        <div className="mx-auto mt-10 flex max-w-lg flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[.04] p-3 text-left max-md:mt-6">
          <Avatar name={profile.username} image={profile.avatar} size="lg" status={visibleProfileStatus(profile.status)} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-100">{profile.username}</p>
            <p className="truncate text-xs text-slate-500">{profile.bio?.trim() || t.home.profileHint}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onProfile}>
            <Pencil className="size-3.5" />
            {t.home.profile}
          </Button>
        </div>
      </div>
    </section>
  );
}

export function ChannelSidebar({ mobile = false, server, activeChannelId, profile, canManageChannels, voiceCapability, voiceParticipants = [], voiceChannelId = null, voiceStatus = "idle", muted = false, serverMuted = false, deafened = false, activeSpeakerIds = [], screenShareParticipantIds = [], isScreenSharing = false, currentUserId = "", onCreateChannel, onEditChannel, onDeleteChannel, onBulkSlowmode, onSelectChannel, onServerMenu, onProfile, onSettings, onJoinVoice, onLeaveVoice, onMuted, onDeafened, onStartScreenShare, onStopScreenShare, onViewScreenShare, onVoiceNotice }: { mobile?: boolean; server: MockServer; activeChannelId?: string; profile: LocalProfile; canManageChannels: boolean; voiceCapability?: VoiceCapability; voiceParticipants?: VoicePresence[]; voiceChannelId?: string | null; voiceStatus?: "idle" | "connecting" | "connected" | "reconnecting" | "error"; muted?: boolean; serverMuted?: boolean; deafened?: boolean; activeSpeakerIds?: string[]; screenShareParticipantIds?: string[]; isScreenSharing?: boolean; currentUserId?: string; onCreateChannel: () => void; onEditChannel: (channel: MockChannel) => void; onDeleteChannel: (channel: MockChannel) => void; onBulkSlowmode?: () => void; onSelectChannel: (id: string) => void; onServerMenu: () => void; onProfile: () => void; onSettings: () => void; onJoinVoice?: (channel: MockChannel) => void; onLeaveVoice?: () => void; onMuted?: (value: boolean) => void; onDeafened?: (value: boolean) => void; onStartScreenShare?: () => void; onStopScreenShare?: () => void; onViewScreenShare?: (participantIdentity: string) => void; onVoiceNotice?: () => void }): React.ReactElement {
  const { t } = useI18n();
  const textChannels = server.channels.filter((channel) => channel.kind === "text");
  const voiceChannels = server.channels.filter((channel) => channel.kind === "voice");
  const activeVoiceChannel = voiceChannelId ? voiceChannels.find((channel) => channel.id === voiceChannelId) : undefined;
  const [contextMenu, setContextMenu] = useState<{
    channel: MockChannel;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (): void => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
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
    setContextMenu({
      channel,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 200)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 112)),
    });
  }

  return (
    <aside className="flex w-[262px] shrink-0 flex-col border-r border-white/[.055] bg-sidebar">
      {server.banner ? (
        /* Заголовок поверх баннера-картинки: белый зафиксирован, т.к. фон — изображение. */
        <button aria-label={`${t.server.manage}: ${server.name}`} onClick={onServerMenu} className="group/banner relative h-24 shrink-0 overflow-hidden border-b border-white/[.055] text-left text-[#fff]">
          <Image src={server.banner} alt="" fill unoptimized sizes="262px" className="object-cover transition duration-200 group-hover/banner:scale-[1.02]" />
          <span className="absolute inset-0 bg-black/35 transition group-hover/banner:bg-black/45" />
          <span className="absolute inset-x-0 top-0 flex items-center gap-2 px-3 py-3">
            <Avatar name={server.name} image={server.avatar} color={server.accent} size="sm" className="size-6 ring-1 ring-white/25" />
            <span className="min-w-0 flex-1 truncate text-sm font-bold drop-shadow-md">{server.name}</span>
            <ChevronDown className="size-4 shrink-0 drop-shadow-md" />
          </span>
        </button>
      ) : (
        <button aria-label={`${t.server.manage}: ${server.name}`} onClick={onServerMenu} className="flex h-14 items-center justify-between border-b border-white/[.055] px-4 text-left font-semibold text-slate-100 transition hover:bg-white/[.035]">
          {server.name}
          <ChevronDown className="size-4 text-slate-500" />
        </button>
      )}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-4">
        <ChannelGroup title={t.channel.text} canCreate={canManageChannels} onCreate={onCreateChannel}>
          {textChannels.map((channel) => (
            <button key={channel.id} onClick={() => onSelectChannel(channel.id)} onContextMenu={(event) => openContextMenu(event, channel)} className={cn("mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-500 transition hover:bg-white/[.045] hover:text-slate-200", mobile ? "h-11" : "h-9", activeChannelId === channel.id && "bg-white/[.065] text-slate-100")}>
              <Hash className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">{channel.name}</span>
              {channel.slowmodeSeconds > 0 && (
                <Timer aria-label={t.channel.slowmodeBadge(channel.slowmodeSeconds)} className="size-3.5 shrink-0 text-slate-600" />
              )}
            </button>
          ))}
        </ChannelGroup>
        <ChannelGroup title={t.channel.voice} canCreate={canManageChannels} onCreate={onCreateChannel}>
          {voiceChannels.map((channel) => (
            <div key={channel.id} className="mb-1">
              <button
                onClick={() => {
                  if (onJoinVoice) onJoinVoice(channel);
                  else onVoiceNotice?.();
                }}
                onContextMenu={(event) => openContextMenu(event, channel)}
                className={cn("flex w-full items-center gap-2 rounded-lg px-2 text-sm font-medium transition hover:bg-white/[.035]", mobile ? "h-11" : "h-9", voiceChannelId === channel.id ? "bg-violet-400/10 text-violet-200" : "text-slate-500 hover:text-slate-300")}
              >
                <Volume2 className="size-4" />
                <span className="truncate">{channel.name}</span>
                {voiceParticipants.some((participant) => participant.channelId === channel.id) && (
                  <span className="ml-auto text-[10px] text-slate-500">
                    {voiceParticipants.filter((participant) => participant.channelId === channel.id).length}/{channel.participantLimit === 0 ? "∞" : (channel.participantLimit ?? voiceCapability?.maxParticipants ?? 25)}
                  </span>
                )}
              </button>
              <div className="space-y-0.5">
                {voiceParticipants
                  .filter((participant) => participant.channelId === channel.id)
                  .map((participant) => (
                    <VoiceParticipantRow key={participant.userId} participant={participant} member={server.members.find((item) => item.id === participant.userId)} profile={profile} currentUserId={currentUserId} speaking={activeSpeakerIds.includes(participant.userId)} sharing={screenShareParticipantIds.includes(participant.userId)} onViewScreenShare={onViewScreenShare} />
                  ))}
              </div>
            </div>
          ))}
        </ChannelGroup>
      </div>
      {activeVoiceChannel && onLeaveVoice && onMuted && onDeafened && <VoicePanel mobile={mobile} channel={activeVoiceChannel} status={voiceStatus} muted={muted} serverMuted={serverMuted} deafened={deafened} isScreenSharing={isScreenSharing} onMuted={onMuted} onDeafened={onDeafened} onStartScreenShare={onStartScreenShare} onStopScreenShare={onStopScreenShare} onLeave={onLeaveVoice} />}
      <div className="flex h-14 items-center gap-2 border-t border-white/[.06] bg-rail px-2">
        <button onClick={onProfile} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-left hover:bg-white/5">
          <Avatar name={profile.username} image={profile.avatar} size="sm" status={visibleProfileStatus(profile.status)} />
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-slate-200" style={nicknameStyle(profile.nameFont, profile.nameGlow)}>{profile.username}</span>
            {profile.customStatus
              ? <span className="block truncate text-[10px] text-slate-400">{profile.customStatusEmoji ? `${profile.customStatusEmoji} ` : ""}{profile.customStatus}</span>
              : <span className={cn("block truncate text-[10px]", profile.status === "dnd" ? "text-red-400" : profile.status === "idle" ? "text-amber-400" : profile.status === "invisible" ? "text-slate-500" : "text-emerald-400")}>{t.statuses[userStatusLabels[profile.status ?? "online"]]}</span>}
          </span>
        </button>
        <button aria-label={t.settings.title} title={t.settings.title} onClick={onSettings} className={cn("grid shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white/6 hover:text-slate-200", mobile ? "size-11" : "size-9")}>
          <Settings className={mobile ? "size-5" : "size-4"} />
        </button>
      </div>
      {contextMenu && (
        <div role="menu" aria-label={t.channel.manageMenu(contextMenu.channel.name)} onPointerDown={(event) => event.stopPropagation()} className="glass fixed z-[80] w-48 rounded-xl p-1.5 shadow-[0_18px_55px_rgba(0,0,0,.5)]" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button
            role="menuitem"
            onClick={() => {
              const channel = contextMenu.channel;
              setContextMenu(null);
              onEditChannel(channel);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-300 hover:bg-white/[.06] hover:text-white"
          >
            <Pencil className="size-3.5" />
            {t.channel.edit}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              onBulkSlowmode?.();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-300 hover:bg-white/[.06] hover:text-white"
          >
            <Timer className="size-3.5" />
            {t.channel.slowmodeBulk}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              const channel = contextMenu.channel;
              setContextMenu(null);
              onDeleteChannel(channel);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-red-300 hover:bg-red-400/10"
          >
            <Trash2 className="size-3.5" />
            {t.channel.delete}
          </button>
        </div>
      )}
    </aside>
  );
}

export function VoiceParticipantRow({ participant, member, profile, currentUserId, speaking, sharing = false, onViewScreenShare }: { participant: VoicePresence; member?: MockMember; profile: LocalProfile; currentUserId: string; speaking: boolean; sharing?: boolean; onViewScreenShare?: (participantIdentity: string) => void }): React.ReactElement {
  const { t } = useI18n();
  const isCurrentUser = participant.userId === currentUserId;
  const memberName = member?.username ?? (isCurrentUser ? profile.username : t.voice.participant);
  const avatar = member?.avatar ?? (isCurrentUser ? profile.avatar : null);
  const isSpeaking = speaking && !participant.muted && !participant.deafened;
  const glow = member?.nameGlow ?? (isCurrentUser ? profile.nameGlow : undefined);
  const font = member?.nameFont ?? (isCurrentUser ? profile.nameFont : undefined);
  return (
    <ProfilePreview
      side="right"
      wrapperClassName="ml-6 flex"
      triggerClassName="flex min-h-9 w-[224px] max-w-full items-center gap-2 rounded-lg px-1.5 py-1 text-xs text-slate-400 transition-colors hover:bg-white/[.035] hover:text-slate-200"
      profile={{
        username: member?.username ?? (isCurrentUser ? profile.username : memberName),
        discriminator: member?.discriminator ?? (isCurrentUser ? profile.discriminator : undefined),
        fingerprint: member?.fingerprint,
        avatar,
        banner: member?.banner ?? (isCurrentUser ? profile.banner : undefined),
        accentColor: member?.accentColor ?? (isCurrentUser ? profile.accentColor : undefined),
        nameGlow: glow,
        nameFont: font,
        color: member?.avatarColor,
        status: member?.status ?? (isCurrentUser ? visibleProfileStatus(profile.status) : "offline"),
        customStatus: member?.customStatus ?? (isCurrentUser ? profile.customStatus : undefined),
        customStatusEmoji: member?.customStatusEmoji ?? (isCurrentUser ? profile.customStatusEmoji : undefined),
        role: member?.role,
        bio: member?.bio ?? (isCurrentUser ? profile.bio : undefined),
        isCurrentUser,
      }}
    >
      <Avatar name={memberName} image={avatar} color={member?.avatarColor} size="sm" className={cn(isSpeaking && "ring-2 ring-emerald-400 ring-offset-2 ring-offset-sidebar shadow-[0_0_12px_rgba(52,211,153,.35)]")} />
      <span className="min-w-0 flex-1 truncate">
        <span style={nicknameStyle(font, glow)}>{memberName}</span>
        {isCurrentUser && <span>{` ${t.voice.youSuffix}`}</span>}
      </span>
      {sharing && (
        <span
          title={t.voice.viewScreen(memberName)}
          aria-label={t.voice.viewScreen(memberName)}
          onClick={(event) => {
            event.stopPropagation();
            onViewScreenShare?.(participant.userId);
          }}
          className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md bg-cyan-400/10 text-cyan-300 hover:bg-cyan-400/20"
        >
          <MonitorUp className="size-3.5" />
        </span>
      )}
      {participant.serverMuted ? (
        <span aria-label={t.voice.adminMutedOf(memberName)} title={t.voice.adminMuted} className="grid size-6 shrink-0 place-items-center text-red-300">
          <MicOff className="size-3.5" />
        </span>
      ) : participant.deafened ? (
        <span aria-label={t.voice.soundAndMicOffOf(memberName)} title={t.voice.soundAndMicOff} className="grid size-6 shrink-0 place-items-center text-red-300">
          <VolumeX className="size-3.5" />
        </span>
      ) : participant.muted ? (
        <span aria-label={t.voice.micOffOf(memberName)} title={t.voice.micOff} className="grid size-6 shrink-0 place-items-center text-red-300">
          <MicOff className="size-3.5" />
        </span>
      ) : null}
    </ProfilePreview>
  );
}

interface VoiceChannelViewProps {
  mobile?: boolean;
  channel: MockChannel;
  server: MockServer;
  profile: LocalProfile;
  participants: VoicePresence[];
  currentUserId: string;
  currentUserRole?: MemberRole;
  canModerateVoice: boolean;
  connectedChannelId: string | null;
  status: "idle" | "connecting" | "connected" | "reconnecting" | "error";
  muted: boolean;
  serverMuted: boolean;
  deafened: boolean;
  locallyMutedParticipantIds: string[];
  participantVolumes: Record<string, number>;
  activeSpeakerIds: string[];
  screenShares: ScreenShareStream[];
  viewingScreenShareId: string | null;
  isScreenSharing: boolean;
  onMuted: (value: boolean) => void;
  onDeafened: (value: boolean) => void;
  onParticipantMuted: (participantIdentity: string, value: boolean) => void;
  onParticipantVolume: (participantIdentity: string, value: number) => void;
  onServerMuted: (participantIdentity: string, value: boolean) => void;
  onDisconnectParticipant: (participantIdentity: string) => void;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
  onViewScreenShare: (participantIdentity: string) => void;
  onExitScreenShare: () => void;
  onLeaveVoice: () => void;
  onOpenChannels?: () => void;
}

export function VoiceChannelView({ mobile = false, onOpenChannels, channel, server, profile, participants, currentUserId, currentUserRole, canModerateVoice, connectedChannelId, status, muted, serverMuted, deafened, locallyMutedParticipantIds, participantVolumes, activeSpeakerIds, screenShares, viewingScreenShareId, isScreenSharing, onMuted, onDeafened, onParticipantMuted, onParticipantVolume, onServerMuted, onDisconnectParticipant, onStartScreenShare, onStopScreenShare, onViewScreenShare, onExitScreenShare, onLeaveVoice }: VoiceChannelViewProps): React.ReactElement {
  const { t } = useI18n();
  const channelParticipants = participants.filter((participant) => participant.channelId === channel.id);
  const connectedHere = connectedChannelId === channel.id;
  const availableScreenShares = connectedHere ? screenShares : [];
  const viewedStream = screenShares.find((stream) => stream.participantIdentity === viewingScreenShareId);
  const statusLabel = status === "reconnecting" ? t.voice.reconnecting : status === "connecting" ? t.voice.connecting : connectedHere && status === "connected" ? t.voice.connected : status === "error" ? t.voice.error : t.voice.idle;
  const participantProfile = (
    identity: string,
    fallbackName?: string,
  ): {
    name: string;
    avatar: string | null;
    banner?: string | null;
    accentColor?: string | null;
    nameGlow?: string | null;
    nameFont?: NameFont | null;
    color?: string;
    status: PublicMemberStatus;
    customStatus?: string;
    customStatusEmoji?: string;
    role?: string;
    bio?: string;
    username?: string;
    discriminator?: string;
    fingerprint?: string;
    isCurrentUser: boolean;
  } => {
    const member = server.members.find((item) => item.id === identity);
    const isCurrentUser = identity === currentUserId;
    return {
      name: member?.username ?? (isCurrentUser ? profile.username : (fallbackName ?? t.voice.participant)),
      username: member?.username ?? (isCurrentUser ? profile.username : undefined),
      discriminator: member?.discriminator ?? (isCurrentUser ? profile.discriminator : undefined),
      fingerprint: member?.fingerprint,
      avatar: member?.avatar ?? (isCurrentUser ? profile.avatar : null),
      banner: member?.banner ?? (isCurrentUser ? profile.banner : null),
      accentColor: member?.accentColor ?? (isCurrentUser ? profile.accentColor : undefined),
      nameGlow: member?.nameGlow ?? (isCurrentUser ? profile.nameGlow : undefined),
      nameFont: member?.nameFont ?? (isCurrentUser ? profile.nameFont : undefined),
      color: member?.avatarColor,
      status: member?.status ?? (isCurrentUser ? visibleProfileStatus(profile.status) : "offline"),
      customStatus: member?.customStatus ?? (isCurrentUser ? profile.customStatus : undefined),
      customStatusEmoji: member?.customStatusEmoji ?? (isCurrentUser ? profile.customStatusEmoji : undefined),
      role: member?.role,
      bio: member?.bio ?? (isCurrentUser ? profile.bio : undefined),
      isCurrentUser,
    };
  };
  const viewedProfile = viewingScreenShareId ? participantProfile(viewingScreenShareId, viewedStream?.participantName) : null;
  const viewedLocallyMuted = viewingScreenShareId ? locallyMutedParticipantIds.includes(viewingScreenShareId) : false;
  const viewedVolume = viewingScreenShareId ? (participantVolumes[viewingScreenShareId] ?? 1) : 1;
  const viewedScreenShareViewers = viewingScreenShareId ? channelParticipants.filter((participant) => participant.viewingScreenShareUserId === viewingScreenShareId) : [];

  return (
    <section aria-label={t.voice.channelAria(channel.name)} className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
      <header className={cn("flex shrink-0 items-center gap-2.5 border-b border-white/[.06]", mobile ? "h-14 px-1.5" : "h-12 px-4")}>
        {mobile && onOpenChannels && (
          <button type="button" aria-label={t.chat.openChannels} title={t.chat.openChannels} onClick={onOpenChannels} className="grid size-11 shrink-0 place-items-center rounded-xl text-slate-300 transition hover:bg-white/6 hover:text-slate-100">
            <Menu className="size-5" />
          </button>
        )}
        {!mobile && <Volume2 className="size-4 shrink-0 text-violet-300" />}
        <div className="min-w-0">
          <h1 className="truncate text-sm font-bold text-slate-100">{channel.name}</h1>
          <p className="truncate text-[11px] text-slate-500">{channel.description || t.voice.channelName}</p>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[10px] font-medium text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-3" />
            {channelParticipants.length}
          </span>
          <span className={cn("inline-flex items-center gap-1.5", connectedHere && status === "connected" ? "text-emerald-300" : status === "error" ? "text-red-300" : "text-amber-300")}>
            <span className="size-1.5 rounded-full bg-current" />
            {statusLabel}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
        {viewingScreenShareId ? (
          <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex shrink-0 items-center gap-2.5 rounded-xl border border-cyan-400/15 bg-cyan-400/[.035] px-3 py-2">
              <span className="relative grid size-7 place-items-center text-cyan-300">
                <MonitorUp className="size-4" />
                <span className="absolute right-0 top-0 size-1.5 rounded-full bg-red-400" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-100">{viewedStream?.local ? t.voice.yourShare : t.voice.sharingScreen(viewedProfile?.name ?? t.voice.participant)}</p>
                <p className="text-[11px] text-slate-500">{t.voice.viewingPinned}</p>
              </div>
              {viewedScreenShareViewers.length > 0 && (
                <div aria-label={t.voice.viewers(viewedScreenShareViewers.map((viewer) => participantProfile(viewer.userId).name).join(", "))} className="ml-auto flex shrink-0 items-center gap-2">
                  <div className="flex items-center">
                    {viewedScreenShareViewers.slice(0, 4).map((viewer, index) => {
                      const viewerProfile = participantProfile(viewer.userId);
                      return <Avatar key={viewer.userId} name={viewerProfile.name} image={viewerProfile.avatar} color={viewerProfile.color} size="sm" className={cn("size-6 ring-2 ring-panel", index > 0 && "-ml-1.5")} />;
                    })}
                  </div>
                  <span className="text-[10px] tabular-nums text-slate-500">{viewedScreenShareViewers.length}</span>
                </div>
              )}
              {viewingScreenShareId !== currentUserId && (
                <label className={cn("flex w-44 shrink-0 items-center gap-2 rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-[10px] text-slate-400", viewedScreenShareViewers.length === 0 && "ml-auto")}>
                  <Volume2 className="size-3.5 shrink-0" />
                  <input type="range" min="0" max="100" step="1" aria-label={t.voice.volumeLocal(viewedProfile?.name ?? t.voice.participant)} value={Math.round(viewedVolume * 100)} onChange={(event) => onParticipantVolume(viewingScreenShareId, Number(event.target.value) / 100)} className="voice-limit-slider h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-slate-700 accent-violet-400" />
                  <span className="w-8 text-right tabular-nums">{Math.round(viewedVolume * 100)}%</span>
                </label>
              )}
              {viewingScreenShareId !== currentUserId && (
                <Button variant="secondary" aria-pressed={viewedLocallyMuted} onClick={() => onParticipantMuted(viewingScreenShareId, !viewedLocallyMuted)} className={cn("shrink-0", viewedLocallyMuted && "text-red-300")}>
                  <VolumeX className="size-4" />
                  {viewedLocallyMuted ? t.voice.unmute : t.voice.muteLocally}
                </Button>
              )}
              <Button variant="secondary" onClick={onExitScreenShare} className={cn("shrink-0", viewingScreenShareId === currentUserId && "ml-auto")}>
                <X className="size-4" />
                {t.voice.exitView}
              </Button>
            </div>
            {viewedStream ? (
              <ScreenShareSurface
                stream={viewedStream}
                className="min-h-[260px] flex-1"
                fullscreenControls={
                  <div className="glass flex max-w-full items-center gap-2 rounded-2xl p-2 shadow-[0_18px_60px_rgba(0,0,0,.55)]">
                    <div className="hidden min-w-0 items-center gap-2 border-r border-white/10 px-2 sm:flex">
                      <Avatar name={viewedProfile?.name ?? t.voice.participant} image={viewedProfile?.avatar} color={viewedProfile?.color} size="sm" />
                      <span className="max-w-32 truncate text-xs font-semibold text-slate-200">{viewedStream.local ? t.voice.yourShare : (viewedProfile?.name ?? t.voice.participant)}</span>
                    </div>
                    {viewingScreenShareId !== currentUserId && (
                      <>
                        <button type="button" aria-label={viewedLocallyMuted ? t.voice.unmuteShare : t.voice.muteShare} title={viewedLocallyMuted ? t.voice.unmuteShare : t.voice.muteShare} aria-pressed={viewedLocallyMuted} onClick={() => onParticipantMuted(viewingScreenShareId, !viewedLocallyMuted)} className={cn("grid size-11 shrink-0 place-items-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70", viewedLocallyMuted ? "border-red-400/25 bg-red-400/12 text-red-300" : "border-white/10 bg-white/[.055] text-slate-300 hover:bg-white/10")}>
                          <VolumeX className="pointer-events-none size-4" />
                        </button>
                        <label className="hidden w-36 items-center gap-2 px-1 text-[10px] text-slate-400 md:flex">
                          <Volume2 className="size-3.5 shrink-0" />
                          <input type="range" min="0" max="100" step="1" aria-label={t.voice.volumeShare(viewedProfile?.name ?? t.voice.participant)} value={Math.round(viewedVolume * 100)} onChange={(event) => onParticipantVolume(viewingScreenShareId, Number(event.target.value) / 100)} className="voice-limit-slider h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-slate-700 accent-violet-400" />
                        </label>
                      </>
                    )}
                    <button type="button" aria-label={serverMuted ? t.voice.adminMuted : muted ? t.voice.enableMic : t.voice.disableMic} title={serverMuted ? t.voice.adminMuted : muted ? t.voice.enableMic : t.voice.disableMic} aria-pressed={muted} disabled={serverMuted} onClick={() => onMuted(!muted)} className={cn("grid size-11 shrink-0 place-items-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70", muted ? "border-red-400/25 bg-red-400/12 text-red-300" : "border-white/10 bg-white/[.055] text-slate-300 hover:bg-white/10", serverMuted && "cursor-not-allowed opacity-70")}>
                      {muted ? <MicOff className="pointer-events-none size-4" /> : <Mic className="pointer-events-none size-4" />}
                    </button>
                    <button type="button" aria-label={deafened ? t.voice.enableSound : t.voice.disableSound} title={deafened ? t.voice.enableSound : t.voice.disableSound} onClick={() => onDeafened(!deafened)} className={cn("grid size-10 place-items-center rounded-full border transition", deafened ? "border-red-400/25 bg-red-400/12 text-red-300" : "border-white/10 bg-white/[.055] text-slate-300 hover:bg-white/10")}>
                      <VolumeX className="size-4" />
                    </button>
                    {!mobile && (
                      <button type="button" aria-label={isScreenSharing ? t.voice.stopShare : t.voice.startShare} title={isScreenSharing ? t.voice.stopShare : t.voice.startShare} disabled={status !== "connected"} onClick={isScreenSharing ? onStopScreenShare : onStartScreenShare} className={cn("grid size-10 place-items-center rounded-full border transition disabled:opacity-35", isScreenSharing ? "border-cyan-300/30 bg-cyan-400/15 text-cyan-300" : "border-white/10 bg-white/[.055] text-slate-300 hover:bg-white/10")}>
                        <MonitorUp className="size-4" />
                      </button>
                    )}
                    <button type="button" aria-label={t.voice.exitViewFull} title={t.voice.exitViewFull} onClick={onExitScreenShare} className="grid size-10 place-items-center rounded-full border border-amber-300/20 bg-amber-300/[.08] text-amber-200 transition hover:bg-amber-300/15">
                      <X className="size-4" />
                    </button>
                    <button type="button" aria-label={t.voice.leaveVoice} title={t.voice.leaveVoice} onClick={onLeaveVoice} className="grid h-10 w-14 place-items-center rounded-full bg-red-500 text-white shadow-[0_8px_24px_rgba(239,68,68,.25)] transition hover:bg-red-400">
                      <PhoneOff className="size-4" />
                    </button>
                  </div>
                }
              />
            ) : (
              <div className="grid min-h-[260px] flex-1 place-items-center rounded-2xl border border-dashed border-white/10 bg-black/25 px-6 text-center">
                <div>
                  <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-white/[.045] text-slate-500">
                    <MonitorUp className="size-7" />
                  </span>
                  <h2 className="mt-4 text-lg font-bold text-slate-200">{t.voice.streamUnavailableTitle}</h2>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{t.voice.streamUnavailableDescription}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="scrollbar-thin h-full overflow-y-auto pr-1">
            <div className="mb-5">
              <div className="mb-2 flex items-center gap-2">
                <Users className="size-3.5 text-slate-500" />
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t.voice.participants}</h2>
                <span className="text-[10px] text-slate-600">{channelParticipants.length}</span>
              </div>
              {channelParticipants.length ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-4">
                  {channelParticipants.map((participant) => {
                    const participantData = participantProfile(participant.userId);
                    const locallyMuted = locallyMutedParticipantIds.includes(participant.userId);
                    const participantVolume = participantVolumes[participant.userId] ?? 1;
                    const speaking = activeSpeakerIds.includes(participant.userId) && !participant.muted && !participant.deafened && !locallyMuted;
                    const targetRole = server.members.find((member) => member.id === participant.userId)?.serverRole;
                    const canDisconnect = canDisconnectVoiceParticipant(canModerateVoice, currentUserRole, targetRole, currentUserId, participant.userId);
                    return (
                      <div key={participant.userId} className={cn("relative flex min-h-0 flex-col rounded-xl border bg-panel p-3 transition", speaking ? "border-emerald-400/45" : "border-white/[.065]", (locallyMuted || participant.serverMuted) && "border-red-400/20")}>
                        {participant.userId !== currentUserId && (
                          <button type="button" aria-label={`${locallyMuted ? t.voice.unmuteLocallyOf(participantData.name) : t.voice.muteLocallyOf(participantData.name)}`} aria-pressed={locallyMuted} onClick={() => onParticipantMuted(participant.userId, !locallyMuted)} className={cn("absolute left-3 top-3 z-10 grid size-11 place-items-center rounded-xl border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70", locallyMuted ? "border-red-400/25 bg-red-400/12 text-red-300" : "border-white/10 bg-black/20 text-slate-500 hover:bg-white/[.06] hover:text-slate-200")}>
                            <VolumeX className="pointer-events-none size-4" />
                          </button>
                        )}
                        {canDisconnect && (
                          <button type="button" aria-label={participant.serverMuted ? t.voice.removeServerMuteOf(participantData.name) : t.voice.muteForAllOf(participantData.name)} title={participant.serverMuted ? t.voice.removeServerMute : t.voice.muteForAll} aria-pressed={participant.serverMuted} onClick={() => onServerMuted(participant.userId, !participant.serverMuted)} className={cn("absolute right-12 top-3 z-10 grid size-8 place-items-center rounded-lg border transition", participant.serverMuted ? "border-red-400/30 bg-red-400/15 text-red-200 hover:bg-red-400/20" : "border-amber-300/20 bg-amber-300/[.07] text-amber-200 hover:bg-amber-300/15")}>
                            <MicOff className="size-4" />
                          </button>
                        )}
                        {canDisconnect && (
                          <button type="button" aria-label={t.voice.disconnectOf(participantData.name)} title={t.voice.disconnect} onClick={() => onDisconnectParticipant(participant.userId)} className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-lg border border-red-400/20 bg-red-400/[.07] text-red-300 transition hover:bg-red-400/15">
                            <UserMinus className="size-4" />
                          </button>
                        )}
                        <ProfilePreview
                          profile={{
                            username: participantData.username ?? participantData.name,
                            discriminator: participantData.discriminator,
                            fingerprint: participantData.fingerprint,
                            avatar: participantData.avatar,
                            banner: participantData.banner,
                            accentColor: participantData.accentColor,
                            nameGlow: participantData.nameGlow,
                            nameFont: participantData.nameFont,
                            color: participantData.color,
                            status: participantData.status,
                            customStatus: participantData.customStatus,
                            customStatusEmoji: participantData.customStatusEmoji,
                            role: participantData.role,
                            bio: participantData.bio,
                            isCurrentUser: participantData.isCurrentUser,
                          }}
                          wrapperClassName="w-full justify-center"
                          triggerClassName="flex max-w-full flex-col items-center rounded-lg px-2 py-1 outline-none transition hover:bg-white/[.035] focus-visible:ring-2 focus-visible:ring-violet-400/70"
                        >
                          <Avatar name={participantData.name} image={participantData.avatar} color={participantData.color} size="lg" className={cn(speaking && "ring-2 ring-emerald-400 ring-offset-2 ring-offset-panel")} />
                          <span className="mt-4 max-w-full truncate text-sm font-semibold text-slate-100">
                            <span style={nicknameStyle(participantData.nameFont, participantData.nameGlow)}>{participantData.name}</span>
                            {participant.userId === currentUserId && <span>{` ${t.voice.youSuffix}`}</span>}
                          </span>
                          <span className={cn("mt-1 text-[10px] font-medium", speaking ? "text-emerald-300" : locallyMuted || participant.serverMuted ? "text-red-300" : "text-slate-600")}>{participant.serverMuted ? t.voice.mutedByAdmin : locallyMuted ? t.voice.mutedForYou : speaking ? t.voice.speaking : participant.deafened ? t.voice.soundOff : participant.muted ? t.voice.micMuted : t.voice.inVoice}</span>
                        </ProfilePreview>
                        {participant.userId !== currentUserId && (
                          <label className="mt-2 flex w-full items-center gap-2 border-t border-white/[.055] px-1 pt-2 text-[10px] text-slate-500">
                            <Volume2 className="size-3.5 shrink-0" />
                            <input type="range" min="0" max="100" step="1" aria-label={t.voice.volumeLocal(participantData.name)} value={Math.round(participantVolume * 100)} onChange={(event) => onParticipantVolume(participant.userId, Number(event.target.value) / 100)} className="voice-limit-slider h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-slate-700 accent-violet-400" />
                            <span className="w-8 text-right tabular-nums">{Math.round(participantVolume * 100)}%</span>
                          </label>
                        )}
                        {participant.deafened ? <VolumeX className={cn("absolute right-3 size-4 text-red-300", canDisconnect ? "top-12" : "top-3")} /> : participant.muted ? <MicOff className={cn("absolute right-3 size-4 text-red-300", canDisconnect ? "top-12" : "top-3")} /> : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-white/[.06] bg-white/[.015] px-4 py-5 text-center text-xs text-slate-600">{t.voice.nobodyHere}</div>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2">
                <MonitorUp className="size-3.5 text-slate-500" />
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t.voice.screenShares}</h2>
                {availableScreenShares.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-cyan-300">
                    <span className="size-1.5 rounded-full bg-red-400" />
                    {availableScreenShares.length}
                  </span>
                )}
              </div>
              {availableScreenShares.length ? (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {availableScreenShares.map((stream) => {
                    const streamProfile = participantProfile(stream.participantIdentity, stream.participantName);
                    const viewers = channelParticipants.filter((participant) => participant.viewingScreenShareUserId === stream.participantIdentity);
                    return (
                      <button key={stream.participantIdentity} type="button" aria-label={t.voice.watchStream(streamProfile.name)} onClick={() => onViewScreenShare(stream.participantIdentity)} className="group flex items-center gap-3 rounded-xl border border-white/[.065] bg-panel p-3 text-left transition hover:border-cyan-300/35 hover:bg-raised">
                        <span className="relative grid size-10 shrink-0 place-items-center rounded-lg bg-cyan-400/[.08] text-cyan-300">
                          <MonitorUp className="size-4" />
                          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-panel bg-red-400" />
                        </span>
                        <Avatar name={streamProfile.name} image={streamProfile.avatar} color={streamProfile.color} size="sm" status={streamProfile.status} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-100">{stream.local ? t.voice.yourShare : t.voice.screenOf(streamProfile.name)}</p>
                          <p className="mt-0.5 truncate text-[10px] text-slate-500">LIVE</p>
                        </div>
                        {viewers.length > 0 && (
                          <div aria-label={t.voice.viewers(viewers.map((viewer) => participantProfile(viewer.userId).name).join(", "))} className="flex shrink-0 items-center gap-1.5">
                            <div className="flex items-center">
                              {viewers.slice(0, 4).map((viewer, index) => {
                                const viewerProfile = participantProfile(viewer.userId);
                                return <Avatar key={viewer.userId} name={viewerProfile.name} image={viewerProfile.avatar} color={viewerProfile.color} size="sm" className={cn("size-6 ring-2 ring-panel", index > 0 && "-ml-1.5")} />;
                              })}
                            </div>
                            <span className="text-[10px] tabular-nums text-slate-500">{viewers.length}</span>
                          </div>
                        )}
                        <span className="text-[10px] font-semibold text-cyan-300 opacity-70 transition group-hover:opacity-100">{t.voice.watch}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-white/[.06] bg-white/[.015] px-4 py-4">
                  <MonitorUp className="size-4 shrink-0 text-slate-600" />
                  <p className="text-xs text-slate-600">{t.voice.nobodySharing}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {connectedHere && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-t border-white/[.06] bg-sidebar/95 px-4 py-2">
          <button type="button" aria-label={serverMuted ? t.voice.adminMuted : muted ? t.voice.enableMic : t.voice.disableMic} title={serverMuted ? t.voice.adminMuted : muted ? t.voice.enableMic : t.voice.disableMic} aria-pressed={muted} disabled={serverMuted} onClick={() => onMuted(!muted)} className={cn("grid size-11 shrink-0 place-items-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70", muted ? "border-red-400/25 bg-red-400/12 text-red-300" : "border-white/10 bg-white/[.055] text-slate-300 hover:bg-white/10", serverMuted && "cursor-not-allowed opacity-70")}>
            {muted ? <MicOff className="pointer-events-none size-4" /> : <Mic className="pointer-events-none size-4" />}
          </button>
          <button type="button" aria-label={deafened ? t.voice.enableSound : t.voice.disableSound} title={deafened ? t.voice.enableSound : t.voice.disableSound} onClick={() => onDeafened(!deafened)} className={cn("grid size-10 place-items-center rounded-full border transition", deafened ? "border-red-400/25 bg-red-400/12 text-red-300" : "border-white/10 bg-white/[.055] text-slate-300 hover:bg-white/10")}>
            <VolumeX className="size-4" />
          </button>
          {!mobile && (
            <button type="button" aria-label={isScreenSharing ? t.voice.stopShare : t.voice.startShare} title={isScreenSharing ? t.voice.stopShare : t.voice.startShare} disabled={status !== "connected"} onClick={isScreenSharing ? onStopScreenShare : onStartScreenShare} className={cn("grid size-10 place-items-center rounded-full border transition disabled:opacity-35", isScreenSharing ? "border-cyan-300/30 bg-cyan-400/15 text-cyan-300" : "border-white/10 bg-white/[.055] text-slate-300 hover:bg-white/10")}>
              <MonitorUp className="size-4" />
            </button>
          )}
          <div className="mx-1 h-7 w-px bg-white/10" />
          <button type="button" aria-label={t.voice.leaveVoice} title={t.voice.leaveVoice} onClick={onLeaveVoice} className="grid h-10 w-14 place-items-center rounded-full border border-red-400/20 bg-red-400/[.09] text-red-300 transition hover:bg-red-400/15">
            <PhoneOff className="size-4" />
          </button>
        </div>
      )}
    </section>
  );
}

function VoicePanel({ mobile = false, channel, status, muted, serverMuted, deafened, isScreenSharing, onMuted, onDeafened, onStartScreenShare, onStopScreenShare, onLeave }: { mobile?: boolean; channel?: MockChannel; status: "idle" | "connecting" | "connected" | "reconnecting" | "error"; muted: boolean; serverMuted: boolean; deafened: boolean; isScreenSharing: boolean; onMuted: (value: boolean) => void; onDeafened: (value: boolean) => void; onStartScreenShare?: () => void; onStopScreenShare?: () => void; onLeave: () => void }): React.ReactElement {
  const { t } = useI18n();
  const label = status === "reconnecting" ? t.voice.reconnecting : status === "connecting" ? t.voice.connecting : status === "connected" ? t.voice.panelConnected : t.voice.panelError;
  const controlClassName = "grid h-11 w-full place-items-center rounded-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70";
  return (
    <div className="border-t border-violet-400/15 bg-violet-400/[.06] px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <Headphones className="size-3.5 text-violet-300" />
        <span className="min-w-0 flex-1 truncate font-medium text-slate-200">{channel?.name ?? t.voice.channelName}</span>
        <span className="text-[10px] text-slate-500">{label}</span>
      </div>
      <div className={cn("mt-2 grid gap-1", mobile ? "grid-cols-3" : "grid-cols-4")}>
        <button type="button" aria-label={serverMuted ? t.voice.adminMuted : muted ? t.voice.enableMic : t.voice.disableMic} aria-pressed={muted} title={serverMuted ? t.voice.adminMuted : muted ? t.voice.enableMic : t.voice.disableMic} disabled={serverMuted} onClick={() => onMuted(!muted)} className={cn(controlClassName, muted ? "bg-red-400/10 text-red-300 hover:bg-red-400/15" : "text-slate-300 hover:bg-white/10", serverMuted && "cursor-not-allowed ring-1 ring-red-400/25 opacity-70")}>
          <MicOff className={cn("pointer-events-none size-4", !muted && "hidden")} />
          {!muted && <Mic className="pointer-events-none size-4" />}
        </button>
        <button type="button" aria-label={deafened ? t.voice.enableSound : t.voice.disableSound} aria-pressed={deafened} title={deafened ? t.voice.enableSound : t.voice.disableSound} onClick={() => onDeafened(!deafened)} className={cn(controlClassName, deafened ? "bg-red-400/10 text-red-300 hover:bg-red-400/15" : "text-slate-300 hover:bg-white/10")}>
          <VolumeX className="pointer-events-none size-4" />
        </button>
        {!mobile && (
          <button type="button" aria-label={isScreenSharing ? t.voice.stopShare : t.voice.screenShare} aria-pressed={isScreenSharing} title={isScreenSharing ? t.voice.stopShare : t.voice.screenShare} disabled={status !== "connected"} onClick={isScreenSharing ? onStopScreenShare : onStartScreenShare} className={cn(controlClassName, "disabled:cursor-not-allowed disabled:opacity-35", isScreenSharing ? "bg-cyan-400/15 text-cyan-300" : "text-slate-300 hover:bg-white/10")}>
            <MonitorUp className="pointer-events-none size-4" />
          </button>
        )}
        <button type="button" aria-label={t.voice.leaveVoice} title={t.voice.leaveVoice} onClick={onLeave} className={cn(controlClassName, "text-red-300 hover:bg-red-400/10")}>
          <PhoneOff className="pointer-events-none size-4" />
        </button>
      </div>
    </div>
  );
}

export function ChannelDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (open: boolean) => void; onCreate: (name: string, kind: "text" | "voice", description: string, participantLimit: number | null) => void }): React.ReactElement {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"text" | "voice">("text");
  const [participantLimitStep, setParticipantLimitStep] = useState(VOICE_PARTICIPANT_LIMIT_MAX);
  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim(), kind, description.trim(), kind === "voice" ? (participantLimitStep > VOICE_PARTICIPANT_LIMIT_MAX ? 0 : participantLimitStep) : null);
    setName("");
    setDescription("");
    setKind("text");
    setParticipantLimitStep(VOICE_PARTICIPANT_LIMIT_MAX);
  }
  const participantLimitLabel = participantLimitStep > VOICE_PARTICIPANT_LIMIT_MAX ? "∞" : String(participantLimitStep);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.channel.createTitle}</DialogTitle>
          <DialogDescription>{t.channel.createDescription}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <label className="grid gap-2 text-sm font-medium text-slate-300">
            {t.channel.name}
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={48} required />
          </label>
          <label className="grid gap-2 text-sm font-medium text-slate-300">
            {t.channel.description}
            <Input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={120} />
          </label>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/[.04] p-1">
            <button type="button" onClick={() => setKind("text")} className={cn("rounded-lg px-3 py-2 text-xs font-semibold", kind === "text" ? "bg-violet-500 text-white" : "text-slate-500")}>
              # {t.channel.textKind}
            </button>
            <button type="button" onClick={() => setKind("voice")} className={cn("rounded-lg px-3 py-2 text-xs font-semibold", kind === "voice" ? "bg-violet-500 text-white" : "text-slate-500")}>
              <Volume2 className="mr-1 inline size-3.5" />
              {t.channel.voiceKind}
            </button>
          </div>
          {kind === "voice" && (
            <div className="rounded-xl border border-white/8 bg-black/15 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-300">{t.channel.participantLimit}</p>
                  <p className="mt-1 text-xs text-slate-500">{t.channel.participantLimitHint}</p>
                </div>
                <span className="grid min-w-11 place-items-center rounded-lg bg-violet-400/10 px-3 py-2 text-base font-bold text-violet-200">{participantLimitLabel}</span>
              </div>
              <input aria-label={t.channel.participantLimitAria} type="range" min={1} max={VOICE_PARTICIPANT_LIMIT_MAX + 1} step={1} value={participantLimitStep} onChange={(event) => setParticipantLimitStep(Number(event.target.value))} className="voice-limit-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15" />
              <div className="mt-2 flex justify-between text-[10px] text-slate-600">
                <span>{t.channel.oneSeat}</span>
                <span>25</span>
                <span>∞</span>
              </div>
            </div>
          )}
          <Button type="submit" className="w-full">
            <Plus className="size-4" />
            {t.channel.createSubmit}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Пресеты медленного режима: сегментированный выбор, общий для одиночной и массовой настройки. */
export function SlowmodePicker({ value, onChange, ariaLabel }: { value: number; onChange: (seconds: number) => void; ariaLabel: string }): React.ReactElement {
  const { t } = useI18n();
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {SLOWMODE_SECONDS_OPTIONS.map((seconds) => (
        <button
          key={seconds}
          type="button"
          role="radio"
          aria-checked={value === seconds}
          onClick={() => onChange(seconds)}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${value === seconds ? "bg-violet-500/25 text-violet-100 ring-1 ring-violet-400/50" : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"}`}
        >
          {seconds === 0 ? t.channel.slowmodeOff : t.channel.slowmodeValue(seconds)}
        </button>
      ))}
    </div>
  );
}

export function EditChannelDialog({ channel, open, onOpenChange, onSave }: { channel: MockChannel; open: boolean; onOpenChange: (open: boolean) => void; onSave: (name: string, description: string, participantLimit: number | null, slowmodeSeconds: number) => void }): React.ReactElement {
  const { t } = useI18n();
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description);
  const [participantLimitStep, setParticipantLimitStep] = useState(channel.participantLimit === 0 ? VOICE_PARTICIPANT_LIMIT_MAX + 1 : (channel.participantLimit ?? VOICE_PARTICIPANT_LIMIT_MAX));
  const [slowmodeSeconds, setSlowmodeSeconds] = useState(channel.slowmodeSeconds ?? 0);
  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (!name.trim()) return;
    const participantLimit = channel.kind === "voice" ? (participantLimitStep > VOICE_PARTICIPANT_LIMIT_MAX ? 0 : participantLimitStep) : null;
    onSave(name.trim(), description.trim(), participantLimit, channel.kind === "text" ? slowmodeSeconds : 0);
  }
  const participantLimitLabel = participantLimitStep > VOICE_PARTICIPANT_LIMIT_MAX ? "∞" : String(participantLimitStep);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-3 grid size-11 place-items-center rounded-2xl bg-violet-400/10 text-violet-300">
            <Pencil className="size-5" />
          </div>
          <DialogTitle>{t.channel.editTitle}</DialogTitle>
          <DialogDescription>{t.channel.editDescription(channel.name)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <label className="grid gap-2 text-sm font-medium text-slate-300">
            {t.channel.name}
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={48} required autoFocus />
          </label>
          <label className="grid gap-2 text-sm font-medium text-slate-300">
            {t.channel.description}
            <Input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={120} />
          </label>
          {channel.kind === "text" && (
            <div className="rounded-xl border border-white/8 bg-black/15 p-4">
              <p className="text-sm font-medium text-slate-300">{t.channel.slowmode}</p>
              <p className="mb-3 mt-1 text-xs text-slate-500">{t.channel.slowmodeHint}</p>
              <SlowmodePicker value={slowmodeSeconds} onChange={setSlowmodeSeconds} ariaLabel={t.channel.slowmode} />
            </div>
          )}
          {channel.kind === "voice" && (
            <div className="rounded-xl border border-white/8 bg-black/15 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-300">{t.channel.participantLimit}</p>
                  <p className="mt-1 text-xs text-slate-500">{t.channel.participantLimitHint}</p>
                </div>
                <span className="grid min-w-11 place-items-center rounded-lg bg-violet-400/10 px-3 py-2 text-base font-bold text-violet-200">{participantLimitLabel}</span>
              </div>
              <input aria-label={t.channel.participantLimitAria} type="range" min={1} max={VOICE_PARTICIPANT_LIMIT_MAX + 1} step={1} value={participantLimitStep} onChange={(event) => setParticipantLimitStep(Number(event.target.value))} className="voice-limit-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15" />
              <div className="mt-2 flex justify-between text-[10px] text-slate-600">
                <span>{t.channel.oneSeat}</span>
                <span>25</span>
                <span>∞</span>
              </div>
            </div>
          )}
          <Button type="submit" className="w-full">
            <Pencil className="size-4" />
            {t.channel.save}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Массовая настройка медленного режима. Голосовые каналы в список не попадают: сообщений
 * в них нет, а сервер такие идентификаторы всё равно отбросит.
 */
export function ChannelSlowmodeDialog({ channels, open, onOpenChange, onApply }: { channels: MockChannel[]; open: boolean; onOpenChange: (open: boolean) => void; onApply: (channelIds: string[], slowmodeSeconds: number) => void }): React.ReactElement {
  const { t } = useI18n();
  const textChannels = channels.filter((channel) => channel.kind === "text");
  const [selected, setSelected] = useState<string[]>([]);
  const [slowmodeSeconds, setSlowmodeSeconds] = useState(0);
  const selectedSet = new Set(selected);
  const allSelected = textChannels.length > 0 && selected.length === textChannels.length;

  function toggle(channelId: string): void {
    setSelected((current) => (current.includes(channelId) ? current.filter((id) => id !== channelId) : [...current, channelId]));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-3 grid size-11 place-items-center rounded-2xl bg-violet-400/10 text-violet-300">
            <Timer className="size-5" />
          </div>
          <DialogTitle>{t.channel.slowmodeBulkTitle}</DialogTitle>
          <DialogDescription>{t.channel.slowmodeBulkDescription}</DialogDescription>
        </DialogHeader>
        {textChannels.length === 0 ? (
          <p className="rounded-xl border border-white/8 bg-black/15 p-4 text-sm text-slate-400">{t.channel.slowmodeBulkEmpty}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500">{t.channel.slowmodeBulkSelected(selected.length)}</span>
              <Button type="button" variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => setSelected(allSelected ? [] : textChannels.map((channel) => channel.id))}>
                {allSelected ? t.channel.slowmodeBulkClear : t.channel.slowmodeBulkSelectAll}
              </Button>
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-white/8 bg-black/15 p-2">
              {textChannels.map((channel) => (
                <label key={channel.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5">
                  <input type="checkbox" checked={selectedSet.has(channel.id)} onChange={() => toggle(channel.id)} className="size-4 accent-violet-500" />
                  <Hash className="size-3.5 shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-300">{channel.name}</span>
                  {channel.slowmodeSeconds > 0 && (
                    <span className="shrink-0 rounded-md bg-violet-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200">{t.channel.slowmodeValue(channel.slowmodeSeconds)}</span>
                  )}
                </label>
              ))}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-slate-300">{t.channel.slowmode}</p>
              <SlowmodePicker value={slowmodeSeconds} onChange={setSlowmodeSeconds} ariaLabel={t.channel.slowmodeBulkTitle} />
            </div>
            <Button type="button" className="w-full" disabled={selected.length === 0} onClick={() => onApply(selected, slowmodeSeconds)}>
              <Timer className="size-4" />
              {t.channel.slowmodeBulkApply}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteChannelDialog({ channel, open, onOpenChange, onConfirm }: { channel: MockChannel; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }): React.ReactElement {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-3 grid size-11 place-items-center rounded-2xl bg-red-400/10 text-red-300">
            <Trash2 className="size-5" />
          </div>
          <DialogTitle>{t.channel.deleteTitle}</DialogTitle>
          <DialogDescription>{t.channel.deleteDescription(channel.name)}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => onOpenChange(false)} className="flex-1">
            {t.common.cancel}
          </Button>
          <Button variant="danger" onClick={onConfirm} className="flex-1">
            <Trash2 className="size-4" />
            {t.channel.deleteConfirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LeaveServerDialog({ server, canManageServer, canViewSettings, canUpdate, canDeleteForAll, canRemoveLocal, open, onOpenChange, onAvatar, onBanner, onUpdate, onSaveSettings, onConfirm, onRemoveLocal, onDeleteForAll }: { server: MockServer; canManageServer: boolean; canViewSettings: boolean; canUpdate: boolean; canDeleteForAll: boolean; canRemoveLocal: boolean; open: boolean; onOpenChange: (open: boolean) => void; onAvatar: () => void; onBanner: () => void; onUpdate: () => void; onSaveSettings: (settings: ServerSettings) => boolean; onConfirm: () => void; onRemoveLocal: () => void; onDeleteForAll: () => void }): React.ReactElement {
  const { t } = useI18n();
  const showServerSettings = Boolean(server.address) && canViewSettings;
  const sliderMax = 2025;
  const currentMegabytes = server.maxAttachmentBytes === null ? sliderMax : Math.round(server.maxAttachmentBytes / MEBIBYTE);
  const [limitStep, setLimitStep] = useState(currentMegabytes);
  const [limitInput, setLimitInput] = useState(server.maxAttachmentBytes === null ? "2001" : String(currentMegabytes));
  const currentResolution = server.screenShareMaxResolution ?? DEFAULT_SCREEN_SHARE_MAX_RESOLUTION;
  const currentFrameRate = server.screenShareMaxFrameRate ?? DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE;
  const [serverName, setServerName] = useState(server.name);
  const [maxResolution, setMaxResolution] = useState<ScreenShareResolution>(currentResolution);
  const [maxFrameRate, setMaxFrameRate] = useState<ScreenShareFrameRate>(currentFrameRate);
  const parsedLimit = Number.parseInt(limitInput, 10);
  const validLimit = Number.isFinite(parsedLimit) && parsedLimit >= 1;
  const unlimited = validLimit && parsedLimit > 2000;
  function saveSettings(): void {
    const name = serverName.trim();
    if (!validLimit || name.length < 2) return;
    if (
      onSaveSettings({
        name,
        description: server.description ?? "",
        maxAttachmentBytes: unlimited ? null : parsedLimit * MEBIBYTE,
        screenShareMaxResolution: maxResolution,
        screenShareMaxFrameRate: maxFrameRate,
      })
    )
      onOpenChange(false);
  }

  function changeSlider(value: number): void {
    setLimitStep(value);
    setLimitInput(value > 2000 ? "2001" : String(value));
  }
  function changeLimitInput(value: string): void {
    const digits = value.replace(/\D/gu, "");
    setLimitInput(digits);
    if (!digits) return;
    const numericValue = Number.parseInt(digits, 10);
    setLimitStep(numericValue > 2000 ? sliderMax : Math.max(1, numericValue));
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setServerName(server.name);
          setLimitStep(currentMegabytes);
          setLimitInput(server.maxAttachmentBytes === null ? "2001" : String(currentMegabytes));
          setMaxResolution(currentResolution);
          setMaxFrameRate(currentFrameRate);
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="overflow-hidden border-white/10 bg-panel p-0 sm:max-w-xl">
        <div className="relative -mx-5 -mt-5 mb-12">
          <div className="relative h-32 overflow-hidden border-b border-white/10 bg-primary/15">{server.banner && <Image src={server.banner} alt="" fill unoptimized sizes="576px" className="object-cover" />}</div>
          <div className="absolute -bottom-10 left-6">
            <Avatar image={server.avatar} name={server.name} color={server.accent} size="xl" className="ring-4 ring-panel shadow-md" />
          </div>
        </div>
        <div className="space-y-5 pb-1">
          <DialogHeader>
            <DialogTitle className="text-xl">{showServerSettings ? t.server.manage : t.server.leaveTitle}</DialogTitle>
            <DialogDescription>{showServerSettings ? t.server.manageDescription(server.name) : server.address ? t.server.leaveRemoteDescription(server.name) : t.server.leaveLocalDescription(server.name)}</DialogDescription>
          </DialogHeader>
          {showServerSettings && (
            <section className="space-y-5 rounded-2xl border border-white/[.07] bg-black/15 p-4">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-200" htmlFor="server-settings-name">
                  {t.server.settingsName}
                </label>
                <Input id="server-settings-name" aria-label={t.server.settingsName} value={serverName} onChange={(event) => setServerName(event.target.value)} minLength={2} maxLength={48} disabled={!canManageServer} />
                <p className="mt-1.5 text-xs text-slate-500">{t.server.settingsNameHint}</p>
              </div>

              <div className="border-t border-white/[.06] pt-5">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-200">{t.server.uploadLimitTitle}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{t.server.uploadLimitHint}</p>
                  </div>
                  <label className={cn("flex h-10 min-w-28 items-center rounded-xl border px-3 transition focus-within:ring-2", unlimited ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-200 focus-within:ring-cyan-400/25" : "border-violet-400/20 bg-violet-400/10 text-violet-200 focus-within:ring-violet-400/25")}>
                    <input aria-label={t.server.uploadLimitInput} inputMode="numeric" value={limitInput} onChange={(event) => changeLimitInput(event.target.value)} disabled={!canManageServer} className="w-16 bg-transparent text-right text-sm font-bold outline-none disabled:cursor-not-allowed" />
                    <span className="ml-2 min-w-5 text-xs font-bold">{unlimited ? "∞" : t.settings.mb}</span>
                  </label>
                </div>
                <input aria-label={t.server.uploadLimitSlider} type="range" min={1} max={sliderMax} step={1} value={limitStep} onChange={(event) => changeSlider(Number(event.target.value))} disabled={!canManageServer} className="voice-limit-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15 disabled:cursor-not-allowed disabled:opacity-50" />
                <div className="mt-2 flex justify-between text-[10px] text-slate-600">
                  <span>1 {t.settings.mb}</span>
                  <span>500</span>
                  <span>1000</span>
                  <span>1500</span>
                  <span>2000</span>
                  <span>∞</span>
                </div>
              </div>

              <div className="border-t border-white/[.06] pt-5">
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-200">{t.server.shareQualityTitle}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{t.server.shareQualityHint}</p>
                  </div>
                  <span className="rounded-xl bg-cyan-400/10 px-3 py-2 text-sm font-bold text-cyan-200">{screenShareResolutionLabel(maxResolution, t)}</span>
                </div>
                <input aria-label={t.server.shareQualitySlider} type="range" min={0} max={SCREEN_SHARE_RESOLUTIONS.length - 1} step={1} value={SCREEN_SHARE_RESOLUTIONS.indexOf(maxResolution)} onChange={(event) => setMaxResolution(SCREEN_SHARE_RESOLUTIONS[Number(event.target.value)] ?? DEFAULT_SCREEN_SHARE_MAX_RESOLUTION)} disabled={!canManageServer} className="voice-limit-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15 disabled:cursor-not-allowed disabled:opacity-50" />
                <div className="mt-2 flex justify-between text-[10px] text-slate-600">
                  <span>480p</span>
                  <span>720p</span>
                  <span>1080p</span>
                  <span>{t.server.source}</span>
                </div>
              </div>

              <div className="border-t border-white/[.06] pt-5">
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-200">{t.server.shareFpsTitle}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{t.server.shareFpsHint}</p>
                  </div>
                  <span className="rounded-xl bg-violet-400/10 px-3 py-2 text-sm font-bold text-violet-200">{maxFrameRate} FPS</span>
                </div>
                <input aria-label={t.server.shareFpsSlider} type="range" min={0} max={SCREEN_SHARE_FRAME_RATES.length - 1} step={1} value={SCREEN_SHARE_FRAME_RATES.indexOf(maxFrameRate)} onChange={(event) => setMaxFrameRate(SCREEN_SHARE_FRAME_RATES[Number(event.target.value)] ?? DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE)} disabled={!canManageServer} className="voice-limit-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15 disabled:cursor-not-allowed disabled:opacity-50" />
                <div className="mt-2 flex justify-between text-[10px] text-slate-600">
                  <span>15 FPS</span>
                  <span>30 FPS</span>
                  <span>60 FPS</span>
                </div>
              </div>

              {canManageServer ? (
                <Button type="button" onClick={saveSettings} disabled={!validLimit || serverName.trim().length < 2} className="w-full">
                  <Settings className="size-4" />
                  {t.server.saveSettings}
                </Button>
              ) : (
                <p className="text-xs text-slate-500">{t.server.onlyOwner}</p>
              )}
            </section>
          )}
          {(canManageServer || canUpdate) && server.address && (
            <section className="grid gap-2 sm:grid-cols-2">
              {canManageServer && (
                <button type="button" onClick={onAvatar} className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-white/[.025] p-4 text-left text-sm font-semibold text-slate-200 transition hover:bg-white/[.06]">
                  <span className="grid size-9 place-items-center rounded-xl bg-violet-400/10 text-violet-300">
                    <Camera className="size-4" />
                  </span>
                  {t.server.serverAvatar}
                </button>
              )}
              {canManageServer && (
                <button type="button" onClick={onBanner} className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-white/[.025] p-4 text-left text-sm font-semibold text-slate-200 transition hover:bg-white/[.06]">
                  <span className="grid size-9 place-items-center rounded-xl bg-cyan-400/10 text-cyan-300">
                    <ImageIcon className="size-4" />
                  </span>
                  {t.server.serverBanner}
                </button>
              )}
              {canUpdate && (
                <button type="button" onClick={onUpdate} className="flex items-center gap-3 rounded-2xl border border-violet-400/20 bg-violet-400/[.06] p-4 text-left text-sm font-semibold text-violet-200 transition hover:bg-violet-400/10">
                  <span className="grid size-9 place-items-center rounded-xl bg-violet-400/10">
                    <ServerCog className="size-4" />
                  </span>
                  {t.server.update}
                </button>
              )}
            </section>
          )}
          <section className="rounded-2xl border border-red-400/15 bg-red-400/[.035] p-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[.14em] text-red-300/70">{t.server.dangerZone}</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => onOpenChange(false)} className="flex-1">
                {t.server.leaveCancel}
              </Button>
              <Button variant="danger" onClick={onConfirm} className="flex-1">
                <LogOut className="size-4" />
                {t.server.leaveConfirm}
              </Button>
            </div>
            {canDeleteForAll && server.address && (
              <button onClick={onDeleteForAll} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-xs font-semibold text-red-300 hover:bg-red-400/10">
                <Trash2 className="size-4" />
                {t.server.deleteForAll}
              </button>
            )}
            {canRemoveLocal && (
              <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/5 p-3">
                <p className="text-xs leading-5 text-amber-200/75">{t.server.removeLocalHint}</p>
                <button onClick={onRemoveLocal} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[.04] px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-white/[.08]">
                  <Trash2 className="size-4" />
                  {t.server.removeLocal}
                </button>
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChannelGroup({ title, canCreate, onCreate, children }: { title: string; canCreate: boolean; onCreate: () => void; children: React.ReactNode }): React.ReactElement {
  const { t } = useI18n();
  return (
    <section className="mb-6">
      <div className="mb-1 flex items-center px-2 text-[10px] font-bold uppercase tracking-[.12em] text-slate-600">
        {title}
        {canCreate && (
          <button aria-label={t.channel.createTitle} onClick={onCreate} className="ml-auto rounded p-0.5 text-violet-300 hover:bg-violet-400/10 hover:text-violet-200">
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function NoTextChannelView({ mobile = false, server, profile, access, connectionStatus, showMembers, onCreate, onToggleMembers, onOpenChannels }: { mobile?: boolean; server: MockServer; profile: LocalProfile; access?: CurrentAccess; connectionStatus: ConnectionStatus; showMembers: boolean; onCreate: () => void; onToggleMembers: () => void; onOpenChannels?: () => void }): React.ReactElement {
  const { t } = useI18n();
  const canManageChannels = access?.permissions.includes("MANAGE_CHANNELS") === true;
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-canvas">
      <header className={cn("flex h-14 shrink-0 items-center gap-3 border-b border-white/[.055] shadow-sm", mobile ? "px-1.5" : "px-4")}>
        {mobile && onOpenChannels && (
          <button type="button" aria-label={t.chat.openChannels} title={t.chat.openChannels} onClick={onOpenChannels} className="grid size-11 shrink-0 place-items-center rounded-xl text-slate-300 transition hover:bg-white/6 hover:text-slate-100">
            <Menu className="size-5" />
          </button>
        )}
        {!mobile && <Hash className="size-5 text-slate-600" />}
        <h2 className="font-semibold text-slate-300">{t.channel.noneSelected}</h2>
        <span className={cn("mr-auto rounded-full px-2 py-1 text-[10px] font-semibold", connectionStatus === "connected" ? "bg-emerald-400/10 text-emerald-300" : connectionStatus === "error" || isProtocolIncompatible(connectionStatus) ? "bg-red-400/10 text-red-300" : "bg-white/5 text-slate-500")}>{connectionLabel(connectionStatus, t)}</span>
        <button aria-label={t.chat.members} onClick={onToggleMembers} className={cn("text-slate-500 hover:text-slate-200", showMembers && "text-violet-300")}>
          <Users className="size-5" />
        </button>
      </header>
      <ProtocolNotice status={connectionStatus} />
      <div className="flex min-h-0 flex-1">
        <div className="grid min-w-0 flex-1 place-items-center px-4 sm:px-8">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-4 grid size-16 place-items-center rounded-3xl bg-white/[.055] text-slate-500">
              <Hash className="size-8" />
            </div>
            <h1 className="text-xl font-bold text-slate-200">{t.channel.emptyTitle}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">{canManageChannels ? t.channel.emptyManageDescription : t.channel.emptyMemberDescription}</p>
            {canManageChannels && (
              <Button onClick={onCreate} className="mt-5">
                <Plus className="size-4" />
                {t.channel.createTitle}
              </Button>
            )}
          </div>
        </div>
        {showMembers && <MemberList server={server} profile={profile} access={access} />}
      </div>
    </section>
  );
}

export function ChannelNotificationPopover({ channels, activeChannelId, preferences, onPreferences }: { channels: MockChannel[]; activeChannelId: string | null; preferences: ClientPreferences; onPreferences: (preferences: ClientPreferences) => void }): React.ReactElement {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const textChannels = channels.filter((channel) => channel.kind === "text");
  const selected = textChannels.find((channel) => channel.id === selectedChannelId)
    ?? textChannels.find((channel) => channel.id === activeChannelId)
    ?? textChannels[0]
    ?? null;
  const settings = selected ? getChannelNotificationSettings(preferences, selected.id) : null;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent): void => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function updateSelected(patch: Partial<ChannelNotificationSettings>): void {
    if (!selected) return;
    const next = { ...getChannelNotificationSettings(preferences, selected.id), ...patch };
    // Дочерние чекбоксы заблокированы, пока мастер включён: при возврате
    // мастера в ON они снова фиксируются во включённом состоянии.
    if (next.enabled) {
      next.everyone = true;
      next.mentions = true;
    }
    onPreferences({ ...preferences, notificationOverrides: { ...preferences.notificationOverrides, [selected.id]: next } });
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button type="button" aria-label={t.notifications.title} aria-expanded={open} title={t.notifications.title} onClick={() => setOpen((current) => !current)} className={cn("grid size-9 shrink-0 place-items-center rounded-lg transition", open ? "bg-white/10 text-violet-200" : "text-slate-500 hover:text-slate-200")}>
        <Bell className="size-4" />
      </button>
      {open && (
        <div role="dialog" aria-label={t.notifications.title} className="glass absolute right-0 top-[calc(100%+8px)] z-30 w-72 rounded-xl p-3 shadow-[0_18px_55px_rgba(0,0,0,.5)]">
          <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[.12em] text-slate-500">{t.notifications.title}</p>
          <Combobox label={t.notifications.channelLabel} value={selected?.id ?? ""} placeholder={t.notifications.channelPlaceholder} icon={Hash} options={textChannels.map((channel) => ({ value: channel.id, label: `# ${channel.name}` }))} onChange={(value) => setSelectedChannelId(value)} clearable={false} />
          {settings && (
            <div className="mt-2 divide-y divide-white/6 rounded-xl border border-white/7 bg-white/[.025]">
              <NotificationRow title={t.notifications.enabled}><Switch aria-label={t.notifications.enabled} checked={settings.enabled} onCheckedChange={(enabled) => updateSelected({ enabled })} /></NotificationRow>
              <NotificationRow title={t.notifications.everyone}><Switch aria-label={t.notifications.everyone} checked={settings.everyone} disabled={settings.enabled} onCheckedChange={(everyone) => updateSelected({ everyone })} /></NotificationRow>
              <NotificationRow title={t.notifications.mentions}><Switch aria-label={t.notifications.mentions} checked={settings.mentions} disabled={settings.enabled} onCheckedChange={(mentions) => updateSelected({ mentions })} /></NotificationRow>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationRow({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return <div className="flex min-h-12 items-center justify-between gap-4 px-3 py-2"><p className="text-xs font-medium text-slate-200">{title}</p>{children}</div>;
}

function ChatHeader({ mobile = false, channelName, description, connectionStatus, memberList, channelsOpen = false, searchOpen, channels, activeChannelId, preferences, onPreferences, onMenu, onSearch, onToggleMembers }: { mobile?: boolean; channelName: string; description: string; connectionStatus: ConnectionStatus; memberList: boolean; channelsOpen?: boolean; searchOpen: boolean; channels: MockChannel[]; activeChannelId: string | null; preferences: ClientPreferences; onPreferences: (preferences: ClientPreferences) => void; onMenu?: () => void; onSearch: () => void; onToggleMembers: () => void }): React.ReactElement {
  const { t } = useI18n();
  const statusLabel = connectionLabel(connectionStatus, t);
  const statusTone = connectionStatus === "connected"
    ? "bg-emerald-400/10 text-emerald-300"
    : connectionStatus === "error" || isProtocolIncompatible(connectionStatus)
      ? "bg-red-400/10 text-red-300"
      : "bg-white/5 text-slate-500";
  // На телефоне шапка — единственная навигация: кнопки крупные (44px), а вместо
  // отдельной строки описания под именем канала идёт статус подключения.
  const iconButton = mobile
    ? "grid size-11 shrink-0 place-items-center rounded-xl transition"
    : "grid size-9 shrink-0 place-items-center rounded-lg transition";
  return (
    <header className={cn("flex shrink-0 items-center gap-1 border-b border-white/[.055] shadow-sm", mobile ? "h-14 px-1.5" : "h-14 gap-3 px-4")}>
      {mobile && onMenu && (
        <button type="button" aria-label={t.chat.openChannels} aria-pressed={channelsOpen} title={t.chat.openChannels} onClick={onMenu} className={cn(iconButton, channelsOpen ? "bg-white/10 text-violet-200" : "text-slate-300 hover:bg-white/6 hover:text-slate-100")}>
          <Menu className="size-5" />
        </button>
      )}
      {!mobile && <Hash className="size-5 text-slate-500" />}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className={cn("min-w-0 truncate font-semibold text-slate-100", mobile && "text-[15px] leading-5")}>
            {mobile ? `#${channelName}` : channelName}
          </h2>
          {mobile && <p className="min-w-0 truncate text-[11px] leading-4 text-slate-500">{description || statusLabel}</p>}
        </div>
        {!mobile && (
          <>
            <span className="h-5 w-px bg-white/8" />
            <p className="min-w-0 flex-1 truncate text-xs text-slate-500">{description}</p>
          </>
        )}
      </div>
      <span title={statusLabel} className={cn("inline-flex shrink-0 items-center rounded-full text-[10px] font-semibold", statusTone, mobile ? "size-2 p-0" : "px-2 py-1")}>
        {mobile ? <span aria-hidden="true" className="size-full rounded-full bg-current" /> : statusLabel}
      </span>
      {!mobile && (
        <ChannelNotificationPopover channels={channels} activeChannelId={activeChannelId} preferences={preferences} onPreferences={onPreferences} />
      )}
      <button type="button" aria-label={t.search.open} aria-pressed={searchOpen} onClick={onSearch} className={mobile
        ? cn(iconButton, searchOpen ? "bg-white/10 text-violet-200" : "text-slate-300 hover:bg-white/6 hover:text-slate-100")
        : cn("flex h-8 w-44 shrink-0 items-center gap-2 rounded-lg bg-black/20 px-2.5 text-left text-xs text-slate-600 hover:bg-black/30 hover:text-slate-300", searchOpen && "text-violet-300")}>
        <Search className={mobile ? "size-5" : "size-3.5"} />
        {!mobile && t.search.title}
      </button>
      <button type="button" aria-label={t.chat.members} aria-pressed={memberList} onClick={onToggleMembers} className={mobile
        ? cn(iconButton, memberList ? "bg-white/10 text-violet-200" : "text-slate-300 hover:bg-white/6 hover:text-slate-100")
        : cn("shrink-0 text-slate-500 hover:text-slate-200", memberList && "text-violet-300")}>
        <Users className="size-5" />
      </button>
      {!mobile && <HelpCircle className="size-4 text-slate-600" />}
    </header>
  );
}

function connectionLabel(status: ConnectionStatus, t: Dictionary): string {
  return {
    demo: t.connection.demo,
    connecting: t.connection.connecting,
    authenticating: t.connection.authenticating,
    connected: t.connection.connected,
    reconnecting: t.connection.reconnecting,
    "server-outdated": t.connection.serverOutdated,
    "client-outdated": t.connection.clientOutdated,
    banned: t.connection.banned,
    error: t.connection.error,
  }[status];
}

/** Остаток бана в крупных единицах: дни, часы либо минуты — точность до секунд тут не нужна. */
function formatBanRemaining(expiresAt: string, t: Dictionary): string {
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (remainingMs <= 60_000) return t.banned.lessThanMinute;
  const minutes = Math.round(remainingMs / 60_000);
  if (minutes < 60) return t.banned.remainingMinutes(minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t.banned.remainingHours(hours);
  return t.banned.remainingDays(Math.round(hours / 24));
}

function BannedView({ server, expiresAt, onRetry, onRemove }: { server: MockServer; expiresAt: string | null; onRetry: () => void; onRemove: () => void }): React.ReactElement {
  const { t, locale } = useI18n();
  // Пересчёт раз в минуту: срок бана отображается с точностью до минут, чаще нет смысла.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setInterval(() => setTick((current) => current + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  return (
    <section className="flex min-w-0 flex-1 flex-col items-center justify-center bg-canvas px-6 py-10 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-red-400/10 text-red-300">
        <ShieldBan className="size-8" />
      </div>
      <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">{t.banned.title}</h1>
      <p className="mt-1 text-sm font-medium text-slate-400">{server.name}</p>
      <p className="mt-4 max-w-md text-sm leading-6 text-slate-500">{t.banned.description}</p>
      <div className="mt-5 max-w-md rounded-xl border border-red-400/20 bg-red-400/[.06] px-4 py-3 text-[13px] leading-6 text-red-100/85">
        {expiresAt ? (
          <>
            <span className="block">{t.banned.expires(new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(expiresAt)))}</span>
            <span className="mt-0.5 block text-red-100/60">{t.banned.remaining(formatBanRemaining(expiresAt, t))}</span>
          </>
        ) : (
          t.banned.permanent
        )}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={onRetry} className="rounded-lg bg-white/8 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/12">
          {t.banned.retry}
        </button>
        <button type="button" onClick={onRemove} className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-400 transition hover:text-slate-200">
          {t.banned.remove}
        </button>
      </div>
    </section>
  );
}

function isProtocolIncompatible(status: ConnectionStatus): boolean {
  return status === "server-outdated" || status === "client-outdated";
}

export function ProtocolNotice({ status }: { status: ConnectionStatus }): React.ReactElement | null {
  const { t } = useI18n();
  if (!isProtocolIncompatible(status)) return null;
  const serverOutdated = status === "server-outdated";
  return (
    <div role="alert" className="mx-4 mt-3 flex shrink-0 items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[.07] px-4 py-3 text-amber-100">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />
      <span>
        <strong className="block text-xs font-semibold">{serverOutdated ? t.protocol.serverTitle : t.protocol.clientTitle}</strong>
        <span className="mt-0.5 block text-[11px] leading-5 text-amber-100/65">{serverOutdated ? t.protocol.serverDescription : t.protocol.clientDescription}</span>
      </span>
    </div>
  );
}

function ChannelIntro({ name, description, networked }: { name: string; description: string; networked: boolean }): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="mb-6 mt-auto pt-8">
      <div className="mb-3 grid size-14 place-items-center rounded-2xl bg-white/7 text-slate-300">
        <Hash className="size-7" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-white">{t.chat.welcome(name)}</h1>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      <p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet-400/6 px-2.5 py-1.5 text-[11px] text-violet-200/60">
        <MessageCircle className="size-3.5" />
        {networked ? t.chat.serverNotice : t.chat.mockNotice}
      </p>
    </div>
  );
}

const QUICK_REACTION_EMOJIS = ["❤️", "👍", "😭"] as const;

type PrivateMessageStackPosition = "single" | "first" | "middle" | "last";

export function privateMessageStackPosition(messages: MockMessage[], index: number): PrivateMessageStackPosition {
  const isPrivate = (message: MockMessage | undefined): boolean => message?.kind === "pm" || message?.kind === "apm";
  if (!isPrivate(messages[index])) return "single";
  const joinsPrevious = isPrivate(messages[index - 1]);
  const joinsNext = isPrivate(messages[index + 1]);
  if (joinsPrevious && joinsNext) return "middle";
  if (joinsPrevious) return "last";
  if (joinsNext) return "first";
  return "single";
}

export function Message({ message, replyToMessage, member, members, profile, compact, grouped, privateStackPosition = "single", ownAvatar, currentUserId, canManageMessages, previewAvailable, canAttach, attachmentLimitLabel, uploading, onAttach, onEdit, onDelete, onDownload, onPreview, onToggleReaction, onReply, canReact = false }: { message: MockMessage; replyToMessage?: MockMessage; member?: MockMember; members: MockMember[]; profile?: LocalProfile | null; compact: boolean; grouped: boolean; privateStackPosition?: PrivateMessageStackPosition; ownAvatar: string | null; currentUserId?: string; canManageMessages: boolean; previewAvailable: boolean; canAttach: boolean; attachmentLimitLabel?: string; uploading: boolean; onAttach: () => Promise<Attachment | null>; onEdit: (message: MockMessage, content: string, attachments: Attachment[]) => boolean; onDelete: (message: MockMessage) => boolean; onDownload: (attachment: Attachment) => void; onPreview: (attachment: Attachment) => Promise<string>; onToggleReaction: (messageId: string, emoji: string) => void; onReply?: (message: MockMessage) => void; canReact?: boolean }): React.ReactElement {
  const { t, locale } = useI18n();
  const effectiveAttachmentLimitLabel = attachmentLimitLabel ?? t.attachments.mb("10");
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(message.createdAt));
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  // Без мыши панель действий не может появляться по наведению: её открывает
  // долгое нажатие по сообщению (аналог правого клика на десктопе).
  const [touchActionsOpen, setTouchActionsOpen] = useState(false);
  const longPressRef = useRef<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content);
  const [editAttachments, setEditAttachments] = useState<Attachment[]>(message.attachments ?? []);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const own = currentUserId === message.authorId;
  const canDelete = own || canManageMessages;
  const hasReactions = Boolean(message.reactions?.length);
  const replyPreview = replyToMessage?.content.trim() || replyToMessage?.attachments?.[0]?.fileName || t.chat.replyAttachment;
  const previewProfile = {
    username: member?.username ?? (own ? profile?.username : undefined) ?? message.authorName,
    discriminator: member?.discriminator ?? (own ? profile?.discriminator : undefined),
    fingerprint: member?.fingerprint,
    avatar: message.authorAvatar ?? ownAvatar,
    banner: member?.banner ?? (own ? profile?.banner : undefined),
    accentColor: member?.accentColor ?? (own ? profile?.accentColor : undefined),
    nameGlow: member?.nameGlow ?? (own ? profile?.nameGlow : undefined),
    nameFont: member?.nameFont ?? (own ? profile?.nameFont : undefined),
    color: message.authorColor,
    status: member?.status ?? (own ? visibleProfileStatus(profile?.status) : ("offline" as const)),
    customStatus: member?.customStatus ?? (own ? profile?.customStatus : undefined),
    customStatusEmoji: member?.customStatusEmoji ?? (own ? profile?.customStatusEmoji : undefined),
    role: member?.role,
    bio: member?.bio ?? (own ? profile?.bio : undefined),
    isCurrentUser: own,
  };
  useEffect(() => {
    if (!touchActionsOpen) return;
    const close = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (articleRef.current?.contains(target)) return;
      setTouchActionsOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [touchActionsOpen]);

  useEffect(() => () => {
    if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
  }, []);

  const cancelLongPress = (): void => {
    if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
    longPressRef.current = null;
  };

  // Поле редактирования растёт под текст, но не выше max-h-60 — дальше скролл.
  useEffect(() => {
    const node = editTextareaRef.current;
    if (!editing || !node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [editing, editDraft]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuTriggerRef.current?.contains(target)) return;
      setMenuOpen(false);
      setDeleteConfirmOpen(false);
      menuTriggerRef.current?.blur();
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setDeleteConfirmOpen(false);
      menuTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);
  const saveEdit = (): void => {
    const content = editDraft.trim();
    const originalIds = (message.attachments ?? []).map((attachment) => attachment.id);
    const nextIds = editAttachments.map((attachment) => attachment.id);
    const attachmentsChanged = originalIds.length !== nextIds.length || originalIds.some((id, index) => id !== nextIds[index]);
    if (!content && editAttachments.length === 0) return;
    if (content === message.content && !attachmentsChanged) {
      cancelEdit();
      return;
    }
    if (onEdit(message, content, editAttachments)) setEditing(false);
  };
  const cancelEdit = (): void => {
    setEditing(false);
    setEditDraft(message.content);
    setEditAttachments(message.attachments ?? []);
    setMenuOpen(false);
  };
  const startEditing = (): void => {
    // Маркеры <@userId> раскрываются в читаемый тег @username#1234; при сохранении
    // editMessage снова резолвит их в маркеры и собирает список упоминаний.
    setEditDraft(expandMentionsForEditing(message.content, members.map(memberToMentionCandidate)));
    setEditAttachments(message.attachments ?? []);
    setEditing(true);
    setMenuOpen(false);
  };
  const attachToEdit = async (): Promise<void> => {
    if (!canAttach || uploading || editAttachments.length >= 5) return;
    const attachment = await onAttach();
    if (attachment) setEditAttachments((current) => (current.some((item) => item.id === attachment.id) ? current : [...current, attachment].slice(0, 5)));
  };
  return (
    <article
      ref={articleRef}
      id={`message-${message.id}`}
      onContextMenu={(event) => {
        if (editing || !canDelete) return;
        event.preventDefault();
        setMenuOpen(true);
      }}
      onTouchStart={() => {
        if (editing) return;
        cancelLongPress();
        longPressRef.current = window.setTimeout(() => setTouchActionsOpen(true), 450);
      }}
      onTouchMove={cancelLongPress}
      onTouchEnd={cancelLongPress}
      onTouchCancel={cancelLongPress}
      className={cn("group relative flex min-w-0 gap-3 rounded-lg px-2 py-1 transition hover:bg-white/[.025]", !grouped && !compact && "mt-2.5", message.replyToMessageId && "mt-2.5 pt-6", message.kind && message.kind !== "chat" && "bg-amber-400/[.045] hover:bg-amber-400/[.075]", privateStackPosition === "first" && "rounded-b-none pb-1", privateStackPosition === "middle" && "rounded-none py-1", privateStackPosition === "last" && "rounded-t-none pt-1")}
    >
      {message.replyToMessageId && (
        <button type="button" onClick={() => focusMessage(message.replyToMessageId!)} className="absolute left-14 right-2 top-1 flex min-w-0 items-center gap-1.5 rounded-md text-left text-[11px] leading-4 text-slate-500 transition hover:text-slate-300">
          <Reply className="size-3 shrink-0 text-violet-300/75" />
          <span className="max-w-32 shrink-0 truncate font-semibold text-violet-300/80">{replyToMessage?.authorName ?? t.chat.replyUnavailable}</span>
          {replyToMessage && <span className="truncate">{replyPreview}</span>}
        </button>
      )}
      {!grouped || compact ? (
        <ProfilePreview profile={previewProfile} wrapperClassName="shrink-0 self-start" triggerClassName="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50">
          <Avatar name={message.authorName} image={message.authorAvatar ?? ownAvatar} color={message.authorColor} size={compact ? "sm" : "md"} className="mt-0.5" />
        </ProfilePreview>
      ) : (
        <span className="w-9 shrink-0 self-start whitespace-nowrap pt-px text-right text-[10px] leading-6 tabular-nums text-transparent transition-colors group-hover:text-slate-600">{time}</span>
      )}
      <div className="min-w-0 flex-1">
        {(!grouped || compact) && (
          <div className="flex min-w-0 items-baseline gap-2 leading-5">
            <ProfilePreview profile={previewProfile} wrapperClassName="min-w-0 max-w-full" triggerClassName="block min-w-0 max-w-full truncate rounded text-sm font-semibold text-slate-200 hover:text-violet-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50">
              <span style={nicknameStyle(previewProfile.nameFont, previewProfile.nameGlow)}>{message.authorName}</span>
            </ProfilePreview>
            <time className="shrink-0 whitespace-nowrap text-[10px] leading-5 tabular-nums text-slate-600">{time}</time>
            {message.editedAt && <span className="shrink-0 text-[10px] leading-5 text-slate-600">{t.chat.edited}</span>}
          </div>
        )}
        {editing ? (
          <div className="mt-1.5 overflow-hidden rounded-xl border border-violet-400/40 bg-canvas shadow-[0_10px_28px_rgba(0,0,0,.3)] transition focus-within:border-violet-400">
            <div className="flex items-center gap-1.5 border-b border-white/[.06] px-3 py-1.5">
              <Pencil className="size-3 shrink-0 text-violet-300/80" />
              <span className="text-[10px] font-semibold uppercase tracking-[.12em] text-violet-200/80">{t.chat.editingTitle}</span>
            </div>
            <div className="px-3 pt-2.5">
              {editAttachments.length ? (
                <div className="mb-2 flex flex-wrap gap-2">
                  {editAttachments.map((attachment) => (
                    <span key={attachment.id} className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-white/8 bg-panel px-2.5 py-1.5 text-xs text-slate-300 sm:max-w-64">
                      <Paperclip className="size-3.5 shrink-0 text-violet-300" />
                      <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
                      <button type="button" aria-label={t.chat.detach(attachment.fileName)} onClick={() => setEditAttachments((current) => current.filter((item) => item.id !== attachment.id))} className="rounded p-0.5 text-slate-500 transition hover:bg-white/5 hover:text-red-300">
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <textarea
                ref={editTextareaRef}
                autoFocus
                aria-label={t.chat.editMessage}
                value={editDraft}
                maxLength={4000}
                rows={1}
                onChange={(event) => setEditDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") cancelEdit();
                  else if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    saveEdit();
                  }
                }}
                className="block max-h-60 min-h-14 w-full resize-none overflow-y-auto bg-transparent text-sm leading-6 text-slate-200 outline-none"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-white/[.06] bg-white/[.015] px-2.5 py-2">
              <button type="button" title={t.chat.attachWithLimit(effectiveAttachmentLimitLabel)} aria-label={t.chat.attachToEdit} onClick={() => void attachToEdit()} disabled={!canAttach || uploading || editAttachments.length >= 5} className="grid size-7 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-white/[.07] hover:text-violet-200 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400 max-md:size-9">
                {uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
              </button>
              {editDraft.length > 3600 && <span className="shrink-0 text-[10px] tabular-nums text-slate-500">{4000 - editDraft.length}</span>}
              <span className="ml-auto hidden text-[10px] text-slate-500 lg:inline">{t.chat.editHint}</span>
              <div className="ml-auto flex shrink-0 items-center gap-1.5 lg:ml-3">
                <button type="button" onClick={cancelEdit} className="rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-400 transition hover:bg-white/[.06] hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 max-md:py-2">
                  {t.chat.cancelEdit}
                </button>
                <button type="button" onClick={saveEdit} disabled={!editDraft.trim() && editAttachments.length === 0} className="rounded-md bg-violet-500/85 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-violet-500/85 max-md:py-2">
                  {t.chat.saveEdit}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {message.kind && message.kind !== "chat" && <p className="mb-0.5 text-[9px] font-bold uppercase tracking-[.14em] text-amber-300/85">{message.kind === "apm" ? t.chat.apmLabel : t.chat.pmLabel}</p>}
            {message.content && (
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300 select-text cursor-text">
                {splitMessageContent(message.content).map((segment, index) => {
                  if (segment.kind === "text") return <span key={index}>{segment.text}</span>;
                  // @everyone выглядит как обычное упоминание, но никуда не ведёт:
                  // это plain span без клика и без превью профиля.
                  if (segment.kind === "everyone") return <span key={index} aria-label="@everyone" className="inline-flex h-[18px] items-center rounded-[4px] bg-blue-500/18 px-1 align-middle text-[12px] leading-none text-blue-200/80">@everyone</span>;
                  return <MessageMention key={index} userId={segment.userId} mentioned={Boolean(message.mentions?.includes(segment.userId))} members={members} />;
                })}
                {grouped && !compact && message.editedAt && <span className="ml-1 text-[10px] text-slate-600">{t.chat.edited}</span>}
              </p>
            )}
            {message.attachments?.length ? (
              <div className="mt-2 flex min-w-0 max-w-full flex-wrap gap-2">
                {message.attachments.map((attachment) => (
                  <AttachmentView key={attachment.id} attachment={attachment} previewAvailable={previewAvailable} onDownload={onDownload} onPreview={onPreview} />
                ))}
              </div>
            ) : null}
            {hasReactions ? (
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
                {message.reactions?.map((reaction) => {
                  const selected = Boolean(currentUserId && reaction.userIds.includes(currentUserId));
                  const reactionNames = reaction.userIds.map((userId) => members.find((member) => member.id === userId)?.username ?? (userId === currentUserId ? (profile?.username ?? (own ? message.authorName : undefined)) : undefined) ?? t.chat.unknownUser);
                  const reactionLabel = reactionNames.join(", ");
                  return (
                    <button key={reaction.emoji} type="button" title={reactionLabel} aria-label={t.chat.reactionsAria(reaction.emoji, reaction.userIds.length, reactionLabel)} aria-pressed={selected} disabled={!canReact} onClick={() => onToggleReaction(message.id, reaction.emoji)} className={cn("inline-flex h-6 max-w-full items-center gap-1 rounded-md border px-1.5 text-xs max-md:h-8 max-md:px-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 disabled:cursor-not-allowed disabled:opacity-50", selected ? "border-violet-400/45 bg-violet-400/12 text-violet-200" : "border-white/8 bg-white/[.04] text-slate-300", canReact && (selected ? "hover:border-violet-400/60 hover:bg-violet-400/15" : "hover:border-white/15 hover:bg-white/[.07]"))}>
                      <span className="inline-grid size-4 shrink-0 place-items-center text-sm leading-none">{reaction.emoji}</span>
                      <span className={cn("min-w-2 text-center font-semibold leading-none tabular-nums", selected ? "text-violet-200" : "text-slate-400")}>{reaction.userIds.length}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </>
        )}
      </div>
      {!editing && (canReact || canDelete || onReply) && (
        <div role="toolbar" aria-label={t.chat.messageActions(message.authorName)} data-open={menuOpen || reactionPickerOpen || touchActionsOpen} className="message-action-bar absolute -top-2 right-2 z-20 flex h-9 items-center rounded-lg border border-white/[.08] bg-raised px-1 shadow-[0_6px_18px_rgba(0,0,0,.28)] transition duration-150 max-md:h-12 max-md:gap-0.5 max-md:px-1.5">
          {canReact &&
            QUICK_REACTION_EMOJIS.map((emoji) => (
              <button key={emoji} type="button" title={t.chat.reactionPick(emoji)} aria-label={t.chat.reactionPick(emoji)} onClick={() => onToggleReaction(message.id, emoji)} className="grid size-7 place-items-center rounded-md text-[17px] leading-none transition hover:bg-white/[.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 max-md:size-10 max-md:text-[20px]">
                {emoji}
              </button>
            ))}
          {canReact && <MessageReactionTrigger messageId={message.id} label={t.chat.addReaction} pickerLabel={t.chat.reactionPicker} pickLabel={t.chat.reactionPick} onToggleReaction={onToggleReaction} open={reactionPickerOpen} onOpenChange={setReactionPickerOpen} />}
          {canReact && (onReply || canDelete) && <span aria-hidden="true" className="mx-1 h-5 w-px bg-white/10" />}
          {onReply && (
            <button type="button" title={t.chat.reply} aria-label={t.chat.reply} onClick={() => onReply(message)} className="grid size-7 place-items-center rounded-md text-slate-400 transition hover:bg-white/[.075] hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 max-md:size-10">
              <Reply className="size-4" />
            </button>
          )}
          {own && (
            <button type="button" title={t.chat.edit} aria-label={t.chat.edit} onClick={startEditing} className="grid size-7 place-items-center rounded-md text-slate-400 transition hover:bg-white/[.075] hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 max-md:size-10">
              <Pencil className="size-4" />
            </button>
          )}
          {canDelete && (
            <button ref={menuTriggerRef} type="button" title={t.chat.messageActions(message.authorName)} aria-label={t.chat.messageActions(message.authorName)} aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => { setDeleteConfirmOpen(false); setMenuOpen((open) => !open); }} className="grid size-7 place-items-center rounded-md text-slate-400 transition hover:bg-white/[.075] hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 max-md:size-10">
              <MoreHorizontal className="size-4" />
            </button>
          )}
        </div>
      )}
      {!editing && menuOpen && (
        <div ref={menuRef} role="menu" className="message-action-menu glass absolute right-2 top-8 z-30 min-w-40 rounded-xl p-1.5 text-xs shadow-xl">
          {canDelete && !deleteConfirmOpen && (
            <button
              type="button"
              role="menuitem"
              onClick={() => setDeleteConfirmOpen(true)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-red-300 hover:bg-red-400/10"
            >
              <Trash2 className="size-3.5" />
              {t.chat.delete}
            </button>
          )}
          {canDelete && deleteConfirmOpen && <div role="alertdialog" aria-label={t.chat.deleteConfirm} className="w-56 p-1"><p className="px-1.5 pb-2 text-[11px] leading-4 text-slate-300">{t.chat.deleteConfirm}</p><div className="flex gap-1.5"><Button type="button" variant="secondary" size="sm" className="flex-1" onClick={() => setDeleteConfirmOpen(false)}>{t.common.cancel}</Button><Button type="button" variant="danger" size="sm" className="flex-1" onClick={() => { onDelete(message); setDeleteConfirmOpen(false); setMenuOpen(false); }}>{t.chat.delete}</Button></div></div>}
        </div>
      )}
    </article>
  );
}

export function focusMessage(messageId: string): void {
  const target = document.getElementById(`message-${messageId}`);
  if (!target) return;
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  target.classList.remove("message-jump-highlight");
  void target.offsetWidth;
  target.classList.add("message-jump-highlight");
  window.setTimeout(() => target.classList.remove("message-jump-highlight"), 1_900);
}

function MessageReactionTrigger({ messageId, label, pickerLabel, pickLabel, onToggleReaction, open, onOpenChange }: { messageId: string; label: string; pickerLabel: string; pickLabel: (emoji: string) => string; onToggleReaction: (messageId: string, emoji: string) => void; open: boolean; onOpenChange: (open: boolean) => void }): React.ReactElement {
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={buttonRef} type="button" title={label} aria-label={label} aria-expanded={open} aria-haspopup="dialog" onClick={() => onOpenChange(!open)} className="grid size-7 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-white/[.075] hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50">
        <Smile className="size-4" />
      </button>
      {open && (
        <ReactionPalette
          anchorRef={buttonRef}
          label={pickerLabel}
          pickLabel={pickLabel}
          onSelect={(emoji) => {
            onOpenChange(false);
            buttonRef.current?.focus();
            onToggleReaction(messageId, emoji);
          }}
          onClose={() => onOpenChange(false)}
        />
      )}
    </>
  );
}

function MessageMention({ userId, mentioned, members }: { userId: string; mentioned: boolean; members: MockMember[] }): React.ReactElement {
  const { t } = useI18n();
  const member = members.find((candidate) => candidate.id === userId);
  if (!mentioned || !member) return <span className="inline-flex h-[18px] items-center rounded-[4px] bg-blue-500/18 px-1 align-middle text-[12px] leading-none text-blue-200/80">@{t.chat.unknownUser}</span>;
  return (
    <ProfilePreview
      side="right"
      wrapperClassName="inline-flex align-middle"
      triggerClassName="inline-flex h-[18px] items-center rounded-[4px] bg-blue-500/18 px-1 text-[12px] font-medium leading-none text-blue-200 transition hover:bg-blue-500/28 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
      profile={{
        username: member.username,
        discriminator: member.discriminator,
        fingerprint: member.fingerprint,
        avatar: member.avatar,
        banner: member.banner,
        accentColor: member.accentColor,
        nameGlow: member.nameGlow,
        nameFont: member.nameFont,
        color: member.avatarColor,
        status: member.status,
        customStatus: member.customStatus,
        customStatusEmoji: member.customStatusEmoji,
        role: member.role,
        bio: member.bio,
      }}
      label={t.chat.mentionAria(member.username)}
    >
      <span style={nicknameStyle(member.nameFont, member.nameGlow)}>@{member.username}</span>
    </ProfilePreview>
  );
}

function memberToMentionCandidate(member: MockMember): MentionCandidate {
  return {
    id: member.id,
    username: member.username,
    discriminator: member.discriminator,
    avatar: member.avatar ?? null,
    banner: member.banner ?? null,
    color: member.avatarColor,
    status: member.status,
    customStatus: member.customStatus,
    customStatusEmoji: member.customStatusEmoji,
    role: member.role,
    bio: member.bio,
    fingerprint: member.fingerprint,
    nameGlow: member.nameGlow ?? null,
    nameFont: member.nameFont ?? "none",
  };
}

/**
 * Отсчёт оставшегося мута. Вынесен отдельным компонентом ради момента старта часов:
 * `useState` инициализируется при монтировании, то есть когда мут пришёл, а не когда
 * открылся чат — иначе первый кадр показал бы лишние секунды.
 */
function MuteCountdown({ endsAt }: { endsAt: number }): React.ReactElement {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return <>{t.chat.mutedFor(formatMuteRemaining(endsAt - now))}</>;
}

function voiceErrorText(error: VoiceRecorderError, t: Dictionary): string {
  if (error === "denied") return t.chat.micDenied;
  if (error === "unavailable") return t.chat.micUnavailable;
  if (error === "too-large") return t.chat.voiceTooLarge;
  return t.notices.uploadFailed;
}

export function Composer({ draft, channelName, disabled, attachments, uploading, canAttach, attachmentLimitLabel, maxAttachmentBytes = null, replyingTo, onCancelReply, onAttach, onVoiceFile, onRemoveAttachment, onDraft, onSubmit, members, chatMuted = false, chatMutedUntil = null, canModerateChat = false }: { draft: string; channelName: string; disabled: boolean; attachments: Attachment[]; uploading: boolean; canAttach: boolean; attachmentLimitLabel?: string; maxAttachmentBytes?: number | null; replyingTo?: MockMessage | null; onCancelReply?: () => void; onAttach: () => void; onVoiceFile?: (file: File) => void; onRemoveAttachment: (id: string) => void; onDraft: (value: string) => void; onSubmit: (event: React.FormEvent) => void; members: MentionCandidate[]; chatMuted?: boolean; chatMutedUntil?: string | null; canModerateChat?: boolean }): React.ReactElement {
  const { t } = useI18n();
  const effectiveAttachmentLimitLabel = attachmentLimitLabel ?? t.attachments.mb("10");
  const voiceMaxSeconds = isMobilePlatform() ? 120 : 300;
  const voice = useVoiceRecorder({ maxSeconds: voiceMaxSeconds, maxBytes: maxAttachmentBytes });
  const voiceBlob = voice.status === "ready" ? voice.audio?.blob ?? null : null;
  const voiceUrl = useMemo(() => (voiceBlob ? URL.createObjectURL(voiceBlob) : null), [voiceBlob]);
  useEffect(() => () => {
    if (voiceUrl) URL.revokeObjectURL(voiceUrl);
  }, [voiceUrl]);
  function sendVoiceMessage(): void {
    if (!voice.audio || composerDisabled || uploading || !canAttach || attachments.length >= 5) return;
    onVoiceFile?.(new File([voice.audio.blob], voiceFileName(voice.audio.mimeType), { type: voice.audio.mimeType }));
    voice.reset();
  }
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (replyingTo) inputRef.current?.focus();
  }, [replyingTo]);
  const [mentionQuery, setMentionQuery] = useState<{
    query: string;
    discriminator: string;
    start: number;
    end: number;
  } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionIndexRef = useRef(0);
  // После выбора из автокомплита курсор стоит сразу за вставленным тегом @name#1234 —
  // подавляем повторное открытие списка, пока пользователь не начнёт печатать дальше.
  const insertedMentionRef = useRef<string | null>(null);
  const everyone = mentionQuery ? everyoneCandidate(mentionQuery.query, mentionQuery.discriminator) : null;
  const suggestions = mentionQuery
    ? [...(everyone ? [everyone] : []), ...matchMentionCandidates(members, mentionQuery.query, mentionQuery.discriminator).filter((candidate) => candidate.username.toLowerCase() !== EVERYONE_MENTION)]
    : [];
  // Срок мута сторожим здесь: по его истечении поле разблокируется само, без нового
  // снапшота с сервера. Сам отсчёт рисует MuteCountdown — его часы стартуют в момент
  // появления мута, поэтому первый кадр не показывает устаревший остаток.
  const [now, setNow] = useState(() => Date.now());
  const muteEndsAt = chatMuted && chatMutedUntil ? new Date(chatMutedUntil).getTime() : null;
  const muted = chatMuted && (muteEndsAt === null || muteEndsAt > now);
  useEffect(() => {
    if (!muted || muteEndsAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [muted, muteEndsAt]);
  const composerDisabled = disabled || muted;
  const [commandQuery, setCommandQuery] = useState<{
    query: string;
    tokenStart: number;
    tokenEnd: number;
  } | null>(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const commandIndexRef = useRef(0);
  const commandDefinitions = [
    { name: "pm", description: t.chat.commandDescription.pm },
    { name: "apm", description: t.chat.commandDescription.apm },
    { name: "roll", description: t.chat.commandDescription.roll },
    ...(canModerateChat
      ? [
          { name: "mute", description: t.chat.commandDescription.mute },
          { name: "unmute", description: t.chat.commandDescription.unmute },
        ]
      : []),
  ];
  const commandMatches = commandQuery ? commandDefinitions.filter((command) => command.name.startsWith(commandQuery.query)) : [];
  const commandOpen = !composerDisabled && commandQuery !== null && commandMatches.length > 0;
  const [muteDurationDismissed, setMuteDurationDismissed] = useState(false);
  const muteDurationDismissedRef = useRef(false);
  const [muteDurationIndex, setMuteDurationIndex] = useState(0);
  const muteDurationIndexRef = useRef(0);
  const muteDurationPresets = [
    ...t.chat.mutePresets.map((preset) => ({
      label: preset.label,
      token: `${preset.minutes}m`,
      minutes: preset.minutes,
    })),
    {
      label: t.chat.muteForever,
      token: null as string | null,
      minutes: null as number | null,
    },
  ];
  function dismissMuteDurationPicker(): void {
    muteDurationDismissedRef.current = true;
    setMuteDurationDismissed(true);
  }
  // Попап выбора срока после «/mute @получатель»; Enter при открытом попапе отправляет
  // бессрочный мут, Tab/клик — добавляет выбранный срок.
  const muteDurationOpen = !composerDisabled && canModerateChat && !muteDurationDismissed && /^\/mute\s+@[a-z0-9_.-]{2,32}(?:#[0-9]{4})?$/iu.test(draft.trim());
  // Упоминание не пересекается с выбором срока мута.
  const mentionOpen = mentionQuery !== null && suggestions.length > 0 && !muteDurationOpen;
  const previousDraftRef = useRef(draft);

  function refreshAutocomplete(): void {
    const input = inputRef.current;
    const cursor = input?.selectionStart ?? draft.length;
    if (previousDraftRef.current !== draft) {
      previousDraftRef.current = draft;
      // Закрытый попап срока («Навсегда») снова доступен, как только черновик изменился.
      if (muteDurationDismissedRef.current) {
        muteDurationDismissedRef.current = false;
        setMuteDurationDismissed(false);
      }
    }
    if (insertedMentionRef.current !== null && draft !== insertedMentionRef.current) insertedMentionRef.current = null;
    if (insertedMentionRef.current === draft && cursor >= draft.length) {
      setMentionQuery(null);
      return;
    }
    const mention = mentionQueryAtCursor(draft, cursor);
    if (JSON.stringify(mention) !== JSON.stringify(mentionQuery)) {
      setMentionQuery(mention);
      if (mention) {
        mentionIndexRef.current = 0;
        setMentionIndex(0);
      }
    }
    const command = commandQueryAtCursor(draft, cursor);
    if (JSON.stringify(command) !== JSON.stringify(commandQuery)) {
      setCommandQuery(command);
      if (command) {
        commandIndexRef.current = 0;
        setCommandIndex(0);
      }
    }
  }
  // Зависимость только от draft: сравнение с текущими значениями query уже сбрасывает
  // индекс только при реальном изменении токена, а не при каждом отпускании клавиши.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refreshAutocomplete, [draft]);

  function applyMention(candidate: MentionCandidate): void {
    if (!mentionQuery) return;
    // Тег с дискриминатором подставляется только когда username неоднозначен на сервере.
    const ambiguous = members.filter((item) => item.username.toLowerCase() === candidate.username.toLowerCase()).length > 1;
    // @everyone вставляется буквальным текстом: в маркер он не резолвится.
    const token = candidate.id === EVERYONE_MENTION
      ? EVERYONE_TOKEN
      : `@${candidate.username}${ambiguous && candidate.discriminator ? `#${candidate.discriminator}` : ""}`;
    const next = `${draft.slice(0, mentionQuery.start)}${token}${draft.slice(mentionQuery.end)}`;
    onDraft(next);
    insertedMentionRef.current = next;
    setMentionQuery(null);
    const cursor = mentionQuery.start + token.length;
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  function applyCommand(command: { name: string; description: string }): void {
    if (!commandQuery) return;
    const next = `${draft.slice(0, commandQuery.tokenStart)}/${command.name} ${draft.slice(commandQuery.tokenEnd)}`;
    onDraft(next);
    setCommandQuery(null);
    const cursor = commandQuery.tokenStart + command.name.length + 2;
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  function applyMuteDuration(preset: { label: string; token: string | null }): void {
    if (preset.token) {
      const next = `${draft} ${preset.token}`;
      onDraft(next);
      const cursor = next.length;
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(cursor, cursor);
      });
      return;
    }
    // «Навсегда»: черновик не меняется, закрываем попап — Enter отправит бессрочный мут.
    dismissMuteDurationPicker();
    inputRef.current?.focus();
  }

  function handleAutocompleteKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (muteDurationOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        const next = (muteDurationIndexRef.current + 1) % muteDurationPresets.length;
        muteDurationIndexRef.current = next;
        setMuteDurationIndex(next);
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        const next = (muteDurationIndexRef.current - 1 + muteDurationPresets.length) % muteDurationPresets.length;
        muteDurationIndexRef.current = next;
        setMuteDurationIndex(next);
      } else if (event.key === "Tab") {
        const preset = muteDurationPresets[muteDurationIndexRef.current];
        if (preset) {
          event.preventDefault();
          applyMuteDuration(preset);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        dismissMuteDurationPicker();
      }
      // Enter не перехватываем: отправка формы = бессрочный мут.
      return;
    }
    if (mentionOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = (mentionIndexRef.current + 1) % suggestions.length;
        mentionIndexRef.current = next;
        setMentionIndex(next);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const next = (mentionIndexRef.current - 1 + suggestions.length) % suggestions.length;
        mentionIndexRef.current = next;
        setMentionIndex(next);
      } else if (event.key === "Enter" || event.key === "Tab") {
        const candidate = suggestions[mentionIndexRef.current];
        if (candidate) {
          event.preventDefault();
          applyMention(candidate);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        setMentionQuery(null);
      }
      return;
    }
    if (!commandOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = (commandIndexRef.current + 1) % commandMatches.length;
      commandIndexRef.current = next;
      setCommandIndex(next);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = (commandIndexRef.current - 1 + commandMatches.length) % commandMatches.length;
      commandIndexRef.current = next;
      setCommandIndex(next);
    } else if (event.key === "Enter" || event.key === "Tab") {
      const command = commandMatches[commandIndexRef.current];
      if (command) {
        event.preventDefault();
        applyCommand(command);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setCommandQuery(null);
    }
  }

  function insertEmoji(emoji: string): void {
    const input = inputRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? start;
    const next = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`;
    if (next.length > 4000) return;
    onDraft(next);
    const cursor = start + emoji.length;
    window.requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(cursor, cursor);
    });
  }
  return (
    <form onSubmit={onSubmit} className="relative shrink-0 px-3 pb-3 md:px-5 md:pb-5">
      {muteDurationOpen && (
        <MuteDurationSuggestions
          presets={muteDurationPresets}
          activeIndex={muteDurationIndex}
          onSelect={applyMuteDuration}
          onHover={(index) => {
            muteDurationIndexRef.current = index;
            setMuteDurationIndex(index);
          }}
        />
      )}
      {mentionOpen && (
        <MentionSuggestions
          suggestions={suggestions}
          activeIndex={mentionIndex}
          onSelect={applyMention}
          onHover={(index) => {
            mentionIndexRef.current = index;
            setMentionIndex(index);
          }}
        />
      )}
      {commandOpen && (
        <CommandSuggestions
          commands={commandMatches}
          activeIndex={commandIndex}
          onSelect={applyCommand}
          onHover={(index) => {
            commandIndexRef.current = index;
            setCommandIndex(index);
          }}
        />
      )}
      {replyingTo && (
        <div className="mb-2 flex min-w-0 items-center gap-2 rounded-xl border border-violet-400/15 bg-violet-400/[.055] px-3 py-2 text-xs">
          <Reply className="size-4 shrink-0 text-violet-300" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-violet-200">{t.chat.replyingTo(replyingTo.authorName)}</p>
            <p className="truncate text-[11px] text-slate-500">{replyingTo.content.trim() || replyingTo.attachments?.[0]?.fileName || t.chat.replyAttachment}</p>
          </div>
          <button type="button" title={t.chat.cancelReply} aria-label={t.chat.cancelReply} onClick={onCancelReply} className="grid size-7 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-white/[.06] hover:text-slate-200">
            <X className="size-4" />
          </button>
        </div>
      )}
      {attachments.length ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <span key={attachment.id} className="flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-white/8 bg-panel px-2.5 py-2 text-xs text-slate-300 sm:max-w-64">
              <Paperclip className="size-3.5 shrink-0 text-violet-300" />
              <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
              <button type="button" aria-label={t.chat.remove(attachment.fileName)} onClick={() => onRemoveAttachment(attachment.id)} className="rounded p-0.5 text-slate-500 hover:bg-white/5 hover:text-red-300">
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {muted && (
        <div role="status" aria-live="polite" className="mb-2 flex items-center gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200">
          <MessageCircleOff className="size-3.5 shrink-0" />
          <span>{muteEndsAt === null ? t.chat.mutedIndefinitely : <MuteCountdown key={chatMutedUntil} endsAt={muteEndsAt} />}</span>
        </div>
      )}
      {voice.error && (
        <p role="alert" className="mb-2 text-xs font-medium text-red-300">{voiceErrorText(voice.error, t)}</p>
      )}
      {voice.status === "ready" && voice.audio && voiceUrl && (
        <div className="mb-2 flex min-w-0 items-center gap-2.5 rounded-2xl border border-white/8 bg-panel px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-slate-200">{t.chat.voiceReady(formatVoiceSeconds(voice.audio.durationSeconds))}{voice.audio.truncated ? ` · ${t.chat.voiceTruncated(formatVoiceSeconds(voiceMaxSeconds))}` : null}</p>
            <div className="mt-1">
              <VoicePlayer key={voiceUrl} src={voiceUrl} label={t.chat.voiceReady(formatVoiceSeconds(voice.audio.durationSeconds))} durationHint={voice.audio.durationSeconds} />
            </div>
          </div>
          <button type="button" title={t.chat.sendVoiceMessage} aria-label={t.chat.sendVoiceMessage} onClick={sendVoiceMessage} disabled={composerDisabled || uploading || !canAttach || attachments.length >= 5} className="grid size-9 shrink-0 place-items-center rounded-lg text-violet-300 transition hover:bg-violet-400/10 disabled:opacity-30 max-md:size-10 max-md:bg-violet-500/15">
            <Send className="size-4 max-md:size-5" />
          </button>
          <button type="button" title={t.chat.cancelRecording} aria-label={t.chat.cancelRecording} onClick={() => voice.reset()} className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-white/[.06] hover:text-red-300 max-md:size-10">
            <Trash2 className="size-4 max-md:size-5" />
          </button>
        </div>
      )}
      <div className={cn("flex min-h-12 items-center gap-2 rounded-2xl border border-white/[.065] bg-panel px-3 shadow-[0_1px_3px_rgba(0,0,0,.3)] focus-within:border-violet-400/40 max-md:min-h-13 max-md:gap-1.5 max-md:px-2", composerDisabled && "opacity-55", muted && "pointer-events-none border-white/[.04] opacity-40 grayscale")}>
        <button type="button" title={canAttach ? t.chat.attachWithLimit(effectiveAttachmentLimitLabel) : t.chat.attachAfterConnection} aria-label={t.chat.attach} onClick={onAttach} disabled={composerDisabled || !canAttach || uploading || attachments.length >= 5} className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-500 text-panel hover:bg-slate-300 disabled:opacity-40 max-md:size-10">
          {uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
        </button>
        {voice.status === "recording" ? (
          <div className="flex h-12 min-w-0 flex-1 items-center gap-2.5" role="status" aria-live="polite" aria-label={t.chat.recordingNow}>
            <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-red-400" />
            <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-200">{formatVoiceSeconds(voice.seconds)}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{t.chat.recordingNow}</span>
            <button type="button" title={t.chat.stopRecording} aria-label={t.chat.stopRecording} onClick={() => voice.stop()} className="grid size-9 shrink-0 place-items-center rounded-lg bg-red-500/15 text-red-300 transition hover:bg-red-500/25 max-md:size-10">
              <Square className="size-4 max-md:size-5" />
            </button>
            <button type="button" title={t.chat.cancelRecording} aria-label={t.chat.cancelRecording} onClick={() => voice.reset()} className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-white/[.06] hover:text-red-300 max-md:size-10">
              <Trash2 className="size-4 max-md:size-5" />
            </button>
          </div>
        ) : (
          <input ref={inputRef} aria-label={`${t.chat.placeholder} #${channelName}`} disabled={composerDisabled} value={draft} onChange={(event) => onDraft(event.target.value)} onKeyDown={handleAutocompleteKeyDown} onKeyUp={refreshAutocomplete} onClick={refreshAutocomplete} onSelect={refreshAutocomplete} maxLength={4000} placeholder={muted ? t.chat.mutedComposer : disabled ? t.chat.waitingForConnection : `${t.chat.placeholder} #${channelName}`} className="h-12 min-w-0 flex-1 bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-600" />
        )}
        <EmojiPicker disabled={composerDisabled} onSelect={insertEmoji} />
        {voice.supported && voice.status === "idle" && (
          <button type="button" title={t.chat.recordVoice} aria-label={t.chat.recordVoice} onClick={() => void voice.start()} disabled={composerDisabled || uploading || !canAttach || attachments.length >= 5} className="grid size-9 shrink-0 place-items-center rounded-lg text-violet-300 transition hover:bg-violet-400/10 disabled:opacity-30 max-md:size-10 max-md:bg-violet-500/15">
            <Mic className="size-4 max-md:size-5" />
          </button>
        )}
        <button type="submit" disabled={composerDisabled || uploading || (!draft.trim() && attachments.length === 0)} aria-label={t.chat.send} className="grid size-9 shrink-0 place-items-center rounded-lg text-violet-300 transition hover:bg-violet-400/10 disabled:opacity-30 max-md:size-10 max-md:bg-violet-500/15">
          <Send className="size-4 max-md:size-5" />
        </button>
      </div>
    </form>
  );
}

function MuteDurationSuggestions({ presets, activeIndex, onSelect, onHover }: { presets: { label: string; token: string | null }[]; activeIndex: number; onSelect: (preset: { label: string; token: string | null }) => void; onHover: (index: number) => void }): React.ReactElement {
  const { t } = useI18n();
  return (
    <div role="listbox" aria-label={t.chat.muteDuration} className="glass absolute bottom-[calc(100%+4px)] left-3 z-30 w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl p-1.5 shadow-[0_18px_55px_rgba(0,0,0,.5)] sm:left-5">
      {presets.map((preset, index) => (
        <button key={preset.label} type="button" role="option" aria-selected={index === activeIndex} onMouseEnter={() => onHover(index)} onClick={() => onSelect(preset)} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition", index === activeIndex ? "bg-violet-400/10" : "hover:bg-white/[.04]")}>
          <Clock className="size-3.5 shrink-0 text-violet-300/70" />
          <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{preset.label}</span>
        </button>
      ))}
    </div>
  );
}

function CommandSuggestions({ commands, activeIndex, onSelect, onHover }: { commands: { name: string; description: string }[]; activeIndex: number; onSelect: (command: { name: string; description: string }) => void; onHover: (index: number) => void }): React.ReactElement {
  const { t } = useI18n();
  return (
    <div role="listbox" aria-label={t.chat.commands} className="glass absolute bottom-[calc(100%+4px)] left-3 z-30 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl p-1.5 shadow-[0_18px_55px_rgba(0,0,0,.5)] sm:left-5">
      {commands.map((command, index) => (
        <button key={command.name} type="button" role="option" aria-selected={index === activeIndex} onMouseEnter={() => onHover(index)} onClick={() => onSelect(command)} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition", index === activeIndex ? "bg-violet-400/10" : "hover:bg-white/[.04]")}>
          <code className="shrink-0 rounded-md bg-white/[.05] px-1.5 py-0.5 text-[11px] font-semibold text-violet-200">/{command.name}</code>
          <span className="min-w-0 flex-1 truncate text-[10px] text-slate-500">{command.description}</span>
        </button>
      ))}
    </div>
  );
}

function MentionSuggestions({ suggestions, activeIndex, onSelect, onHover }: { suggestions: MentionCandidate[]; activeIndex: number; onSelect: (candidate: MentionCandidate) => void; onHover: (index: number) => void }): React.ReactElement {
  const { t } = useI18n();
  return (
    <div role="listbox" aria-label={t.chat.mentionUsers} className="glass absolute bottom-[calc(100%+4px)] left-3 z-30 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl p-1.5 shadow-[0_18px_55px_rgba(0,0,0,.5)] sm:left-5">
      {suggestions.map((candidate, index) => (
        <button key={candidate.id} type="button" role="option" aria-selected={index === activeIndex} onMouseEnter={() => onHover(index)} onClick={() => onSelect(candidate)} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition", index === activeIndex ? "bg-violet-400/10" : "hover:bg-white/[.04]")}>
          <Avatar name={candidate.username} image={candidate.avatar} color={candidate.color} size="sm" status={candidate.status} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-slate-200" style={nicknameStyle(candidate.nameFont, candidate.nameGlow)}>@{candidate.username}</span>
            <span className="block truncate text-[10px] text-slate-500">{candidate.customStatus ? `${candidate.customStatusEmoji ? `${candidate.customStatusEmoji} ` : ""}${candidate.customStatus}` : (candidate.role ?? t.chat.mentionCandidate)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function AttachmentView({ attachment, previewAvailable = true, onDownload, onPreview }: { attachment: Attachment; previewAvailable?: boolean; onDownload: (attachment: Attachment) => void; onPreview: (attachment: Attachment) => Promise<string> }): React.ReactElement {
  const { t } = useI18n();
  const isImage = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(attachment.mimeType);
  const isVideo = ["video/mp4", "video/webm", "video/ogg"].includes(attachment.mimeType);
  const isAudio = ["audio/mpeg", "audio/ogg", "audio/webm", "audio/mp4", "audio/wav", "audio/x-wav"].includes(attachment.mimeType);
  const previewable = isImage || isVideo || isAudio;
  const previewKey = `${attachment.id}:${attachment.sha256}`;
  const [previewState, setPreviewState] = useState<{
    key: string;
    value: string | null;
    failed: boolean;
  }>({ key: "", value: null, failed: false });
  const currentPreviewState = previewState.key === previewKey ? previewState : { key: previewKey, value: null, failed: false };
  const preview = currentPreviewState.value;
  const previewFailed = currentPreviewState.failed;
  const [viewerOpen, setViewerOpen] = useState(false);
  const [nearViewport, setNearViewport] = useState(false);
  const [fullscreenTarget, setFullscreenTarget] = useState<"image" | "video" | null>(null);
  const previewLoader = useRef(onPreview);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const imageFullscreenRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    previewLoader.current = onPreview;
  }, [onPreview]);
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
    const element = previewContainerRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    setNearViewport(false);
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: "360px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [previewAvailable, previewKey, previewable]);
  useEffect(() => {
    if (!previewable || !previewAvailable || !nearViewport) return;
    let active = true;
    void previewLoader
      .current(attachment)
      .then((value) => {
        if (active) setPreviewState({ key: previewKey, value, failed: false });
      })
      .catch(() => {
        if (active) setPreviewState({ key: previewKey, value: null, failed: true });
      });
    return () => {
      active = false;
    };
  }, [attachment, nearViewport, previewAvailable, previewKey, previewable]);
  if (isImage && !previewFailed)
    return (
      <>
        <div ref={previewContainerRef} className="w-full max-w-[520px] overflow-hidden rounded-xl border border-white/8 bg-black/20">
          <button type="button" aria-label={t.attachments.open(attachment.fileName)} disabled={!preview} onClick={() => setViewerOpen(true)} className="relative block h-64 w-full bg-black/20 disabled:cursor-wait">
            {preview ? (
              <Image src={preview} alt={attachment.fileName} fill unoptimized sizes="520px" className="object-contain transition duration-200 hover:scale-[1.01]" />
            ) : (
              <span className="absolute inset-0 grid place-items-center">
                <LoaderCircle className="size-6 animate-spin text-violet-300" />
              </span>
            )}
          </button>
          <AttachmentFooter attachment={attachment} onDownload={onDownload} />
        </div>
        <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
          <DialogContent className="max-h-[94%] max-w-[96%] bg-rail">
            <DialogTitle className="sr-only">{attachment.fileName}</DialogTitle>
            <DialogDescription className="sr-only">{t.attachments.fullscreenView}</DialogDescription>
            <div ref={imageFullscreenRef} className="relative h-[76vh] w-full overflow-hidden rounded-2xl bg-black fullscreen:h-screen fullscreen:w-screen fullscreen:rounded-none">
              {preview && <Image src={preview} alt={attachment.fileName} fill unoptimized sizes="96vw" className="object-contain" />}
              <FullscreenButton elementRef={imageFullscreenRef} active={fullscreenTarget === "image"} fileName={attachment.fileName} />
            </div>
            <div className="mt-3 flex min-w-0 items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-200">{attachment.fileName}</span>
                <span className="text-xs text-slate-500">{formatBytes(attachment.sizeBytes, t)}</span>
              </span>
              <Button type="button" variant="secondary" onClick={() => onDownload(attachment)}>
                <Download className="size-4" />
                {t.attachments.download}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  if (isVideo && !previewFailed)
    return (
      <div ref={previewContainerRef} className="w-full max-w-[520px] overflow-hidden rounded-xl border border-white/8 bg-black/20">
        <div className="relative min-h-48 bg-black">
          {preview ? (
            <video ref={videoRef} src={preview} controls preload="metadata" playsInline aria-label={t.attachments.videoOf(attachment.fileName)} onError={() => setPreviewState({ key: previewKey, value: null, failed: true })} className="max-h-80 w-full bg-black object-contain" />
          ) : (
            <span className="absolute inset-0 grid place-items-center">
              <LoaderCircle className="size-6 animate-spin text-violet-300" />
            </span>
          )}
          {preview && <FullscreenButton elementRef={videoRef} active={fullscreenTarget === "video"} fileName={attachment.fileName} compact />}
        </div>
        <AttachmentFooter attachment={attachment} onDownload={onDownload} />
      </div>
    );
  if (isVoiceMessage(attachment) && !previewFailed)
    return (
      <div ref={previewContainerRef} className="w-full max-w-72 overflow-hidden rounded-2xl border border-white/8 bg-panel">
        <div className="px-3 pb-1.5 pt-3">
          {preview ? (
            <VoicePlayer key={preview} src={preview} label={t.attachments.audioOf(attachment.fileName)} onError={() => setPreviewState({ key: previewKey, value: null, failed: true })} />
          ) : (
            <div className="flex min-w-0 items-center gap-2.5" aria-label={t.attachments.audioOf(attachment.fileName)}>
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-violet-400/10 text-violet-300">
                <LoaderCircle className="size-4 animate-spin" />
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{formatBytes(attachment.sizeBytes, t)}</span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-white/8 px-3 py-1.5">
          <span className="min-w-0 truncate text-[10px] tabular-nums text-slate-600">{formatBytes(attachment.sizeBytes, t)}</span>
          <button type="button" onClick={() => onDownload(attachment)} title={t.attachments.download} aria-label={`${t.attachments.download}: ${attachment.fileName}`} className="grid size-7 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-white/[.06] hover:text-violet-200">
            <Download className="size-3.5" />
          </button>
        </div>
      </div>
    );
  return (
    <button type="button" onClick={() => onDownload(attachment)} className="flex min-w-0 max-w-72 items-center gap-2 rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-left transition hover:border-violet-400/30 hover:bg-violet-400/5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-400/10 text-violet-300">
        <Download className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-slate-300">{attachment.fileName}</span>
        <span className="text-[10px] text-slate-600">{formatBytes(attachment.sizeBytes, t)}</span>
      </span>
    </button>
  );
}

function FullscreenButton({ elementRef, active, fileName, compact = false }: { elementRef: React.RefObject<HTMLElement | null>; active: boolean; fileName: string; compact?: boolean }): React.ReactElement {
  const { t } = useI18n();
  const label = active ? t.attachments.exitFullscreen(fileName) : t.attachments.enterFullscreen(fileName);
  const toggle = async (): Promise<void> => {
    if (active && document.fullscreenElement) await document.exitFullscreen();
    else if (elementRef.current) await elementRef.current.requestFullscreen();
  };
  return (
    <button type="button" aria-label={label} title={label} onClick={() => void toggle()} className={cn("absolute right-3 top-3 z-10 rounded-xl border border-white/10 bg-black/60 text-white backdrop-blur transition hover:bg-black/80", compact ? "p-2" : "p-2.5")}>
      {active ? <Minimize2 className={compact ? "size-4" : "size-5"} /> : <Maximize2 className={compact ? "size-4" : "size-5"} />}
    </button>
  );
}

function AttachmentFooter({ attachment, onDownload }: { attachment: Attachment; onDownload: (attachment: Attachment) => void }): React.ReactElement {
  const { t } = useI18n();
  return (
    <button type="button" onClick={() => onDownload(attachment)} className="flex w-full items-center gap-2 border-t border-white/8 px-3 py-2 text-left hover:bg-white/[.03]">
      <Download className="size-4 shrink-0 text-violet-300" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-slate-300">{attachment.fileName}</span>
        <span className="text-[10px] text-slate-600">{formatBytes(attachment.sizeBytes, t)}</span>
      </span>
    </button>
  );
}

function formatBytes(size: number, t: Dictionary): string {
  if (size < 1024) return t.attachments.bytes(size);
  if (size < 1024 * 1024) return t.attachments.kb((size / 1024).toFixed(1));
  return t.attachments.mb((size / (1024 * 1024)).toFixed(1));
}

function MemberList({ server, profile, access }: { server: MockServer; profile: LocalProfile; access?: CurrentAccess }): React.ReactElement {
  const { t } = useI18n();
  const members: MockMember[] = useMemo(
    () =>
      server.address
        ? server.members.map((member) => (member.id === access?.id ? { ...member, role: t.roles.youWith(member.role) } : member))
        : [
            {
              id: profile.id,
              username: profile.username,
              role: t.roles.you,
              serverRole: "owner" as const,
              status: visibleProfileStatus(profile.status),
              avatarColor: "#4d6bfe",
              avatar: profile.avatar,
              memberBackground: profile.memberBackground ?? null,
            },
            ...server.members,
          ],
    [access?.id, profile, server, t],
  );
  const groups = useMemo(() => {
    const roleOrder = { owner: 0, administrator: 1, member: 2 } as const;
    const sorted = [...members].sort((left, right) => roleOrder[left.serverRole ?? "member"] - roleOrder[right.serverRole ?? "member"] || left.username.localeCompare(right.username));
    return (
      [
        { key: "owner", label: t.roles.owner },
        { key: "administrator", label: t.roles.adminsGroup },
        { key: "member", label: t.roles.membersGroup },
      ] as const
    )
      .map((group) => ({
        ...group,
        items: sorted.filter((member) => (member.serverRole ?? "member") === group.key),
      }))
      .filter((group) => group.items.length > 0);
  }, [members, t]);
  return (
    <aside className="scrollbar-thin w-[240px] shrink-0 overflow-y-auto border-l border-white/[.055] bg-sidebar px-3 py-5 max-md:w-full">
      <h3 className="mb-3 px-2 text-[10px] font-bold uppercase tracking-[.14em] text-slate-600">
        {t.chat.members} — {members.length}
      </h3>
      {groups.map((group) => (
        <section key={group.key} className="mb-3">
          <h4 className="mb-1 px-2 text-[10px] font-bold uppercase tracking-[.14em] text-slate-600">
            {group.label} — {group.items.length}
          </h4>
          <div className="space-y-1">
            {group.items.map((member) => {
              const isCurrentUser = member.id === access?.id || (!server.address && member.id === profile.id);
              const avatar = member.avatar ?? (isCurrentUser ? profile.avatar : null);
              const memberGlow = member.nameGlow ?? (isCurrentUser ? profile.nameGlow : undefined);
              const memberFont = member.nameFont ?? (isCurrentUser ? profile.nameFont : undefined);
              const rowBackground = member.memberBackground ?? (isCurrentUser ? (profile.memberBackground ?? null) : null);
              return (                <div key={member.id} className="relative flex w-full items-center overflow-hidden rounded-lg hover:bg-white/[.045]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {rowBackground && <img src={rowBackground} alt="" aria-hidden="true" data-testid="member-background" className="absolute inset-0 size-full object-cover" />}
                  {rowBackground && <div aria-hidden="true" className="absolute inset-0 bg-black/45" />}
                  <ProfilePreview
                    side="left"
                    wrapperClassName="relative min-w-0 flex-1"
                    triggerClassName={rowBackground ? "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-white/10 max-md:py-2.5" : "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 max-md:py-2.5"}
                    profile={{
                      username: member.username ?? (isCurrentUser ? profile.username : "unknown"),
                      discriminator: member.discriminator ?? (isCurrentUser ? profile.discriminator : undefined),
                      fingerprint: member.fingerprint,
                      avatar,
                      banner: member.banner ?? (isCurrentUser ? profile.banner : undefined),
                      accentColor: member.accentColor ?? (isCurrentUser ? profile.accentColor : undefined),
                      nameGlow: memberGlow,
                      nameFont: memberFont,
                      color: member.avatarColor,
                      status: member.status,
                      customStatus: member.customStatus,
                      customStatusEmoji: member.customStatusEmoji,
                      role: member.role,
                      bio: member.bio ?? (isCurrentUser ? profile.bio : undefined),
                      isCurrentUser,
                    }}
                  >
                    <Avatar name={member.username} image={avatar} color={member.avatarColor} size="sm" status={member.status} />
                    <span className={cn("min-w-0 flex-1", member.status === "offline" && "opacity-45")}>
                      <span className="flex items-center gap-1 truncate text-xs font-semibold text-slate-300" style={nicknameStyle(memberFont, memberGlow)}>
                        {member.serverRole === "owner" && <ShieldCheck className="size-3 text-amber-300" />}
                        {member.serverRole === "administrator" && <ShieldCheck className="size-3 text-violet-300" />}
                        {member.username}
                        {isChatMutedNow(member) && <MessageCircleOff aria-label={t.members.chatMuted} className="size-3 shrink-0 text-red-300" />}
                      </span>
                      {member.customStatus
                        ? <span className="block truncate text-[10px] text-slate-400">{member.customStatusEmoji ? `${member.customStatusEmoji} ` : ""}{member.customStatus}</span>
                        : <span className={cn("block truncate text-[10px]", member.serverRole === "owner" ? "text-amber-300/70" : member.serverRole === "administrator" ? "text-violet-300/70" : "text-slate-600")}>{member.role}</span>}
                    </span>
                  </ProfilePreview>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </aside>
  );
}

function formatAttachmentLimit(maxAttachmentBytes: number | null, t: Dictionary): string {
  return maxAttachmentBytes === null ? t.attachments.unlimited : t.attachments.upToMb(Math.round(maxAttachmentBytes / MEBIBYTE));
}

function colorFromId(id: string): string {
  const colors = ["#4d6bfe", "#58b0ff", "#7d95ff", "#3b98ff", "#8fa5ff", "#2b7de0"];
  let hash = 0;
  for (const character of id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length] ?? "#4d6bfe";
}

export function sortMessagesChronologically(messages: MockMessage[]): MockMessage[] {
  return [...messages].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

function searchLocalMessages(messages: MockMessage[], filters: MessageSearchFilters, locale: string): MessageSearchResult {
  const query = filters.query.toLocaleLowerCase(locale);
  const filtered = messages
    .filter((message) => {
      if (filters.authorId && message.authorId !== filters.authorId) return false;
      if (filters.channelId && message.channelId !== filters.channelId) return false;
      if (query && !message.content.toLocaleLowerCase(locale).includes(query) && !(message.attachments ?? []).some((attachment) => attachment.fileName.toLocaleLowerCase(locale).includes(query))) return false;
      if (!filters.contentTypes.length) return true;
      return filters.contentTypes.some((type) => {
        if (type === "text") return Boolean(message.content);
        if (type === "image") return (message.attachments ?? []).some((attachment) => attachment.mimeType.startsWith("image/"));
        if (type === "video") return (message.attachments ?? []).some((attachment) => attachment.mimeType.startsWith("video/"));
        return (message.attachments ?? []).some((attachment) => !attachment.mimeType.startsWith("image/") && !attachment.mimeType.startsWith("video/"));
      });
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const page = filtered.slice(filters.offset, filters.offset + filters.limit);
  return {
    messages: page.map((message) => ({
      id: message.id,
      channelId: message.channelId,
      authorId: message.authorId,
      authorName: message.authorName,
      authorAvatar: message.authorAvatar ?? null,
      content: message.content,
      createdAt: message.createdAt,
      editedAt: message.editedAt ?? null,
      attachments: message.attachments ?? [],
      mentions: (message.mentions ?? []).map((userId) => ({ userId })),
      reactions: message.reactions ?? [],
      kind: message.kind ?? "chat",
      targetUserId: message.targetUserId ?? null,
      anonymous: message.anonymous ?? false,
      replyToMessageId: message.replyToMessageId ?? null,
    })),
    total: filtered.length,
    offset: filters.offset,
    hasMore: filters.offset + page.length < filtered.length,
  };
}

type ServerSnapshot = Extract<ServerEvent, { type: "server.snapshot" }>["server"];

export function applyServerSnapshot(current: PersistedClientState, snapshot: ServerSnapshot): PersistedClientState {
  const targetId = current.activeServerId;
  if (!targetId) return current;
  const previousServer = current.servers.find((server) => server.id === targetId);
  const channels = snapshot.channels.map((channel) => ({
    ...channel,
    serverId: targetId,
  }));
  const currentChannelIds = new Set(channels.map((channel) => channel.id));
  const removedChannelIds = new Set(previousServer?.channels.filter((channel) => !currentChannelIds.has(channel.id)).map((channel) => channel.id) ?? []);
  const members = snapshot.members.map((member) => ({
    id: member.id,
    username: member.username,
    discriminator: member.discriminator,
    fingerprint: member.fingerprint,
    bio: member.bio,
    role: roleLabel(member.role),
    serverRole: member.role,
    status: member.status,
    customStatus: member.customStatus,
    customStatusEmoji: member.customStatusEmoji,
    accentColor: member.accentColor,
    nameGlow: member.nameGlow,
    nameFont: member.nameFont,
    avatarColor: colorFromId(member.id),
    avatar: member.avatar,
    banner: member.banner,
    memberBackground: member.memberBackground ?? null,
    chatMuted: member.chatMuted,
    chatMutedUntil: member.chatMutedUntil,
  }));
  const self = members.find((member) => member.id === snapshot.currentUser.id);
  return {
    ...current,
    // Дискриминатор выдаёт сервер: локальное значение — только пожелание при регистрации,
    // поэтому профиль подтягивает подтверждённый тег.
    profile: current.profile && self && self.discriminator !== current.profile.discriminator ? { ...current.profile, discriminator: self.discriminator } : current.profile,
    servers: current.servers.map((server) =>
      server.id === targetId
        ? {
            ...server,
            name: snapshot.name,
            description: snapshot.description,
            avatar: snapshot.avatar,
            banner: snapshot.banner,
            maxAttachmentBytes: snapshot.maxAttachmentBytes,
            screenShareMaxResolution: snapshot.screenShareMaxResolution,
            screenShareMaxFrameRate: snapshot.screenShareMaxFrameRate,
            channels,
            members,
            bannedMembers: snapshot.bannedMembers ?? [],
            ...(server.deployment
              ? {
                  deployment: {
                    ...server.deployment,
                    serverName: snapshot.name,
                  },
                }
              : {}),
          }
        : server,
    ),
    messages: current.messages.filter((message) => !removedChannelIds.has(message.channelId)),
    activeChannelId: channels.some((channel) => channel.id === current.activeChannelId) ? current.activeChannelId : (channels.find((channel) => channel.kind === "text")?.id ?? null),
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
    activeServerId: activeWasRemoved ? (nextServer?.id ?? null) : current.activeServerId,
    activeChannelId: activeWasRemoved ? (nextChannel?.id ?? null) : current.activeChannelId,
  };
}

export function upsertDeployedServer(current: PersistedClientState, serverUrl: string, serverName: string, deployment?: SavedDeploymentConfiguration): PersistedClientState {
  const matching = current.servers.filter((server) => sameServerAddress(server.address, serverUrl));
  if (!matching.length) {
    const id = createId("server");
    return {
      ...current,
      servers: [
        ...current.servers,
        {
          id,
          name: serverName,
          address: serverUrl,
          accent: "#4d6bfe",
          maxAttachmentBytes: DEFAULT_ATTACHMENT_LIMIT_BYTES,
          screenShareMaxResolution: DEFAULT_SCREEN_SHARE_MAX_RESOLUTION,
          screenShareMaxFrameRate: DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE,
          channels: [],
          members: [],
          ...(deployment ? { deployment } : {}),
        },
      ],
      activeServerId: id,
      activeChannelId: null,
    };
  }
  const retained = matching[0]!;
  const withoutDuplicates = removeServers(current, (server) => server.id !== retained.id && sameServerAddress(server.address, serverUrl));
  const oldChannelIds = new Set(retained.channels.map((channel) => channel.id));
  return {
    ...withoutDuplicates,
    servers: withoutDuplicates.servers.map((server) =>
      server.id === retained.id
        ? {
            ...server,
            name: serverName,
            address: serverUrl,
            channels: [],
            members: [],
            ...(deployment ? { deployment } : {}),
          }
        : server,
    ),
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
    const domain = endpoint.protocol === "https:" && hostname.includes(".") && !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname) && !hostname.includes(":") ? hostname : undefined;
    return {
      host: hostname,
      port: 22,
      username: "root",
      serverName: server.name,
      authentication: "private-key",
      ...(domain ? { domain } : {}),
    };
  } catch {
    return undefined;
  }
}

function roleLabel(role: MemberRole): string {
  // Роль записывается в локальное состояние из событий сервера — язык берём на момент события.
  return currentDictionary().roles[role];
}

function toLocalMessage(message: import("@opencord/shared").ChatMessage): MockMessage {
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.authorId,
    authorName: message.authorName,
    authorAvatar: message.authorAvatar,
    authorColor: colorFromId(message.authorId),
    content: message.content,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    attachments: message.attachments,
    mentions: message.mentions.map((mention) => mention.userId),
    reactions: message.reactions ?? [],
    kind: message.kind,
    targetUserId: message.targetUserId,
    anonymous: message.anonymous,
    replyToMessageId: message.replyToMessageId,
  };
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs} ms`)), timeoutMs);
    void operation.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error("Unknown storage error"));
      },
    );
  });
}
