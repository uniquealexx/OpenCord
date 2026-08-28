"use client";

import { useEffect, useRef, useState } from "react";
import { File, FileText, Film, Hash, ImageIcon, LoaderCircle, Paperclip, Play, RotateCcw, Search, User, X } from "lucide-react";
import { MENTION_TOKEN_PATTERN, type Attachment, type MessageContentType, type MessageSearchFilters, type MessageSearchResult } from "@opencord/shared";
import { Avatar } from "@/components/avatar";
import { Combobox } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import type { MockChannel, MockMember, MockMessage } from "@/shared/state";
import { useI18n } from "@/lib/i18n";
import { expandMentionsForEditing, type MentionCandidate } from "@/lib/mentions";

const contentTypeOptions: { id: MessageContentType; icon: typeof FileText }[] = [
  { id: "text", icon: FileText },
  { id: "image", icon: ImageIcon },
  { id: "video", icon: Film },
  { id: "file", icon: File },
];

const attachmentTypes: MessageContentType[] = ["image", "video", "file"];
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/ogg"]);

export function ServerSearchPanel({ open, serverName, channels, members, result, loading, onClose, onReset, onSearch, onOpenMessage, previewAvailable, onPreview }: { open: boolean; serverName: string; channels: MockChannel[]; members: MockMember[]; result: MessageSearchResult | null; loading: boolean; onClose: () => void; onReset: () => void; onSearch: (filters: MessageSearchFilters) => void; onOpenMessage: (message: MockMessage) => void; previewAvailable: boolean; onPreview: (attachment: Attachment) => Promise<string> }): React.ReactElement | null {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [authorId, setAuthorId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [contentTypes, setContentTypes] = useState<MessageContentType[]>([]);
  const rootRef = useRef<HTMLElement | null>(null);
  // Закрытие поиска кликом вне панели (внутри панели клики не считаются внешними).
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [onClose, open]);
  // Сброс «сессии» поиска при закрытии: условный render-phase update (документированный паттерн
  // React для сброса состояния по пропу) — при следующем открытии панель начинается с чистых фильтров.
  if (!open) {
    if (query !== "" || authorId !== "" || channelId !== "" || contentTypes.length > 0) {
      setQuery("");
      setAuthorId("");
      setChannelId("");
      setContentTypes([]);
    }
    return null;
  }

  const contentTypeLabels: Record<MessageContentType, string> = { text: t.search.text, image: t.search.images, video: t.search.video, file: t.search.files };
  const canSearch = Boolean(query.trim() || authorId || channelId || contentTypes.length);
  const hasSession = canSearch || Boolean(result) || loading;
  function submit(offset = 0): void {
    if (!canSearch || loading) return;
    onSearch({ query: query.trim(), authorId: authorId || null, channelId: channelId || null, contentTypes, offset, limit: 25 });
  }
  /** Сброс «сессии» поиска: фильтры панели и результаты в родителе, панель остаётся открытой. */
  function resetFilters(): void {
    setQuery("");
    setAuthorId("");
    setChannelId("");
    setContentTypes([]);
    onReset();
  }
  function toggleType(type: MessageContentType): void {
    setContentTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  }
  function toggleAttachments(): void {
    setContentTypes((current) => attachmentTypes.every((type) => current.includes(type))
      ? current.filter((type) => !attachmentTypes.includes(type))
      : [...new Set([...current, ...attachmentTypes])]);
  }

  return <aside ref={rootRef} aria-label={t.search.aria} className="glass absolute inset-y-0 right-0 z-50 flex w-[420px] max-w-[calc(100%-16px)] flex-col border-l border-white/10 shadow-[-24px_0_70px_rgba(0,0,0,.4)] max-sm:left-0 max-sm:w-auto max-sm:max-w-none">
    <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="border-b border-white/[.07] p-4">
      <div className="mb-3 flex items-center gap-2"><Search className="size-4 text-violet-300" /><div className="min-w-0 flex-1"><h2 className="text-sm font-bold text-white">{t.search.title}</h2><p className="truncate text-[10px] text-slate-500">{serverName}</p></div><button type="button" aria-label={t.search.reset} title={t.search.reset} disabled={!hasSession} onClick={resetFilters} className="rounded-lg p-2 text-slate-500 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"><RotateCcw className="size-4" /></button><button type="button" aria-label={t.search.close} onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-white"><X className="size-4" /></button></div>
      <div className="flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[.04] px-3 focus-within:border-violet-400/50"><Search className="size-4 shrink-0 text-slate-500" /><input autoFocus aria-label={t.search.input} value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200} placeholder={t.search.inputPlaceholder} className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-500" /></div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Combobox label={t.search.author} value={authorId} placeholder={t.search.anyAuthor} icon={User} options={members.map((member) => ({ value: member.id, label: member.username }))} onChange={setAuthorId} />
        <Combobox label={t.search.channel} value={channelId} placeholder={t.search.allChannels} icon={Hash} options={channels.filter((channel) => channel.kind === "text").map((channel) => ({ value: channel.id, label: `#${channel.name}` }))} onChange={setChannelId} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5"><button type="button" aria-pressed={attachmentTypes.every((type) => contentTypes.includes(type))} onClick={toggleAttachments} className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition", attachmentTypes.every((type) => contentTypes.includes(type)) ? "border-cyan-400/35 bg-cyan-400/12 text-cyan-100" : "border-white/[.07] bg-white/[.025] text-slate-500 hover:text-slate-300")}><Paperclip className="size-3" />{t.search.attachments}</button>{contentTypeOptions.map((option) => { const Icon = option.icon; const active = contentTypes.includes(option.id); return <button key={option.id} type="button" aria-pressed={active} onClick={() => toggleType(option.id)} className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition", active ? "border-violet-400/35 bg-violet-400/15 text-violet-200" : "border-white/[.07] bg-white/[.025] text-slate-500 hover:text-slate-300")}><Icon className="size-3" />{contentTypeLabels[option.id]}</button>; })}</div>
      <button type="submit" disabled={!canSearch || loading} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-xs font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,.4)] transition-colors hover:bg-violet-400 disabled:opacity-35">{loading ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}{t.search.submit}</button>
    </form>

    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
      {loading && !result ? <div className="grid h-44 place-items-center text-xs text-slate-500"><span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" />{t.search.searching}</span></div> : null}
      {!loading && !result ? <div className="grid h-44 place-items-center px-8 text-center text-xs leading-5 text-slate-500">{t.search.hint}</div> : null}
      {result && <><div className="mb-2 flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600"><span>{t.search.results}</span><span>{result.total}</span></div><div className="space-y-2">{result.messages.map((message) => {
        const channel = channels.find((item) => item.id === message.channelId);
        const member = members.find((item) => item.id === message.authorId);
        return <button key={message.id} type="button" onClick={() => onOpenMessage(toLocalSearchMessage(message))} className="group w-full rounded-xl border border-white/[.065] bg-[#26282c] p-3 text-left hover:border-violet-400/25 hover:bg-[#2b2d32]">
          <div className="flex items-center gap-2"><Avatar name={message.authorName} image={message.authorAvatar} color={member?.avatarColor} size="sm" /><span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-200">{message.authorName}</span>{message.kind && message.kind !== "chat" && <span className="shrink-0 rounded-md bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300/85">{message.kind === "apm" ? t.chat.apmLabel : t.chat.pmLabel}</span>}<span className="text-[10px] text-slate-600">#{channel?.name ?? t.search.removedChannel}</span></div>
          {message.content && <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5 text-slate-400 group-hover:text-slate-300">{readableContent(message.content, members, t.chat.unknownUser)}</p>}
          {message.attachments.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{message.attachments.map((attachment) => <SearchAttachment key={attachment.id} attachment={attachment} previewAvailable={previewAvailable} onPreview={onPreview} />)}</div>}
          <time className="mt-2 block whitespace-nowrap text-[9px] text-slate-600">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(message.createdAt))}</time>
        </button>;
      })}</div>{result.messages.length === 0 && <div className="grid h-40 place-items-center text-xs text-slate-500">{t.search.nothingFound}</div>}{result.hasMore && <button type="button" disabled={loading} onClick={() => submit(result.offset + result.messages.length)} className="mt-3 w-full rounded-xl border border-white/[.07] py-2.5 text-xs font-semibold text-slate-400 hover:bg-white/[.04] hover:text-white disabled:opacity-40">{loading ? t.search.loadingMore : t.search.showMore}</button>}</>}
    </div>
  </aside>;
}

/** Заменяет маркеры <@userId> на читаемые @username; неизвестных — на «неизвестный пользователь». */
function readableContent(content: string, members: MockMember[], unknownLabel: string): string {
  const candidates: MentionCandidate[] = members.map((member) => ({ id: member.id, username: member.username, discriminator: member.discriminator, avatar: member.avatar ?? null, banner: member.banner ?? null, color: member.avatarColor, status: member.status, role: member.role, bio: member.bio, fingerprint: member.fingerprint }));
  return expandMentionsForEditing(content, candidates).replace(MENTION_TOKEN_PATTERN, `@${unknownLabel}`);
}

function SearchAttachment({ attachment, previewAvailable, onPreview }: { attachment: Attachment; previewAvailable: boolean; onPreview: (attachment: Attachment) => Promise<string> }): React.ReactElement {
  const { t } = useI18n();
  const isImage = IMAGE_MIME_TYPES.has(attachment.mimeType);
  const isVideo = VIDEO_MIME_TYPES.has(attachment.mimeType);
  const [preview, setPreview] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [nearViewport, setNearViewport] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const onPreviewRef = useRef(onPreview);
  useEffect(() => { onPreviewRef.current = onPreview; }, [onPreview]);

  useEffect(() => {
    if (!previewAvailable || (!isImage && !isVideo)) return;
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === "undefined") { setNearViewport(true); return; }
    setNearViewport(false);
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setNearViewport(true);
      observer.disconnect();
    }, { rootMargin: "360px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [isImage, isVideo, previewAvailable]);

  useEffect(() => {
    if (!previewAvailable || !nearViewport || preview || failed || (!isImage && !isVideo)) return;
    let active = true;
    void onPreviewRef.current(attachment)
      .then((value) => { if (active) setPreview(value); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attachment, failed, isImage, isVideo, nearViewport, preview, previewAvailable]);

  if (!isImage && !isVideo) return <span className="max-w-full truncate rounded-md bg-black/20 px-2 py-1 text-[10px] text-violet-200/70">{t.search.file}: {attachment.fileName}</span>;

  const loading = previewAvailable && !preview && !failed;
  const placeholder = !preview && (failed || !previewAvailable);
  return <div ref={containerRef} title={attachment.fileName} className="relative h-24 w-32 max-w-full shrink-0 overflow-hidden rounded-lg border border-white/[.06] bg-black/25">
    {loading && <span className="absolute inset-0 grid place-items-center text-slate-500"><LoaderCircle className="size-4 animate-spin" /></span>}
    {placeholder && <span className="absolute inset-0 grid place-items-center text-slate-500">{isVideo ? <Film className="size-5" /> : <ImageIcon className="size-5" />}</span>}
    {isImage && preview && <>
      {/* Превью — компактный data URL с сервера, а не статический ассет. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={preview} alt={attachment.fileName} className="absolute inset-0 size-full object-cover" />
    </>}
    {isVideo && preview && <>
      {/* Статичный первый кадр: видео не воспроизводится, клик ведёт к сообщению в чате. */}
      <video src={preview} muted playsInline disablePictureInPicture preload="metadata" className="pointer-events-none absolute inset-0 size-full object-cover" />
      <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/15"><span className="grid size-8 place-items-center rounded-full bg-black/65 text-white shadow-[0_2px_8px_rgba(0,0,0,.4)]"><Play className="ml-0.5 size-4" /></span></span>
    </>}
    {isVideo && <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-slate-200">{t.search.video}</span>}
  </div>;
}

function toLocalSearchMessage(message: MessageSearchResult["messages"][number]): MockMessage {
  return { ...message, authorColor: "#4d6bfe", editedAt: message.editedAt ?? undefined, mentions: message.mentions.map((mention) => mention.userId) };
}
