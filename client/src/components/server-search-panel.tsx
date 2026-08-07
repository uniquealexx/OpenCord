"use client";

import { useState } from "react";
import { File, FileText, Film, Hash, ImageIcon, LoaderCircle, Search, User, X } from "lucide-react";
import type { MessageContentType, MessageSearchFilters, MessageSearchResult } from "@opencord/shared";
import { Avatar } from "@/components/avatar";
import { cn } from "@/lib/utils";
import type { MockChannel, MockMember, MockMessage } from "@/shared/state";

const contentTypeOptions: { id: MessageContentType; label: string; icon: typeof FileText }[] = [
  { id: "text", label: "Текст", icon: FileText },
  { id: "image", label: "Изображения", icon: ImageIcon },
  { id: "video", label: "Видео", icon: Film },
  { id: "file", label: "Файлы", icon: File },
];

export function ServerSearchPanel({ open, serverName, channels, members, result, loading, onClose, onSearch, onOpenMessage }: { open: boolean; serverName: string; channels: MockChannel[]; members: MockMember[]; result: MessageSearchResult | null; loading: boolean; onClose: () => void; onSearch: (filters: MessageSearchFilters) => void; onOpenMessage: (message: MockMessage) => void }): React.ReactElement | null {
  const [query, setQuery] = useState("");
  const [authorId, setAuthorId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [contentTypes, setContentTypes] = useState<MessageContentType[]>([]);
  if (!open) return null;

  const canSearch = Boolean(query.trim() || authorId || channelId || contentTypes.length);
  function submit(offset = 0): void {
    if (!canSearch || loading) return;
    onSearch({ query: query.trim(), authorId: authorId || null, channelId: channelId || null, contentTypes, offset, limit: 25 });
  }
  function toggleType(type: MessageContentType): void {
    setContentTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  }

  return <aside aria-label="Поиск по серверу" className="absolute inset-y-0 right-0 z-50 flex w-[420px] max-w-[calc(100%-16px)] flex-col border-l border-white/10 bg-[#0f131d] shadow-[-24px_0_70px_rgba(0,0,0,.45)]">
    <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="border-b border-white/[.07] p-4">
      <div className="mb-3 flex items-center gap-2"><Search className="size-4 text-violet-300" /><div className="min-w-0 flex-1"><h2 className="text-sm font-bold text-white">Поиск</h2><p className="truncate text-[10px] text-slate-500">{serverName}</p></div><button type="button" aria-label="Закрыть поиск" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-white"><X className="size-4" /></button></div>
      <div className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 focus-within:border-violet-400/40"><Search className="size-4 text-slate-500" /><input autoFocus aria-label="Текст поиска" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200} placeholder="Поиск по сообщениям и именам файлов" className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-600" /><button type="submit" disabled={!canSearch || loading} className="rounded-lg bg-violet-500 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-35">Найти</button></div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="flex h-9 items-center gap-2 rounded-lg border border-white/[.07] bg-white/[.025] px-2.5 text-xs text-slate-400"><User className="size-3.5 shrink-0" /><select aria-label="Автор сообщения" value={authorId} onChange={(event) => setAuthorId(event.target.value)} className="min-w-0 flex-1 bg-[#151a27] text-slate-300 outline-none"><option value="">Любой автор</option>{members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>
        <label className="flex h-9 items-center gap-2 rounded-lg border border-white/[.07] bg-white/[.025] px-2.5 text-xs text-slate-400"><Hash className="size-3.5 shrink-0" /><select aria-label="Канал" value={channelId} onChange={(event) => setChannelId(event.target.value)} className="min-w-0 flex-1 bg-[#151a27] text-slate-300 outline-none"><option value="">Все каналы</option>{channels.filter((channel) => channel.kind === "text").map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select></label>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">{contentTypeOptions.map((option) => { const Icon = option.icon; const active = contentTypes.includes(option.id); return <button key={option.id} type="button" aria-pressed={active} onClick={() => toggleType(option.id)} className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition", active ? "border-violet-400/35 bg-violet-400/15 text-violet-200" : "border-white/[.07] bg-white/[.025] text-slate-500 hover:text-slate-300")}><Icon className="size-3" />{option.label}</button>; })}</div>
    </form>

    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
      {loading && !result ? <div className="grid h-44 place-items-center text-xs text-slate-500"><span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" />Ищем на сервере…</span></div> : null}
      {!loading && !result ? <div className="grid h-44 place-items-center px-8 text-center text-xs leading-5 text-slate-500">Введите запрос или выберите фильтры. Можно искать только изображения, видео, файлы или сообщения конкретного пользователя.</div> : null}
      {result && <><div className="mb-2 flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600"><span>Результаты</span><span>{result.total}</span></div><div className="space-y-2">{result.messages.map((message) => {
        const channel = channels.find((item) => item.id === message.channelId);
        const member = members.find((item) => item.id === message.authorId);
        return <button key={message.id} type="button" onClick={() => onOpenMessage(toLocalSearchMessage(message))} className="group w-full rounded-xl border border-white/[.065] bg-[#151a27] p-3 text-left hover:border-violet-400/25 hover:bg-[#181e2c]">
          <div className="flex items-center gap-2"><Avatar name={message.authorName} image={message.authorAvatar} color={member?.avatarColor} size="sm" /><span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-200">{message.authorName}</span><span className="text-[10px] text-slate-600">#{channel?.name ?? "удалённый-канал"}</span></div>
          {message.content && <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5 text-slate-400 group-hover:text-slate-300">{message.content}</p>}
          {message.attachments.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{message.attachments.map((attachment) => <span key={attachment.id} className="max-w-full truncate rounded-md bg-black/20 px-2 py-1 text-[10px] text-violet-200/70">{attachment.mimeType.startsWith("image/") ? "Изображение" : attachment.mimeType.startsWith("video/") ? "Видео" : "Файл"}: {attachment.fileName}</span>)}</div>}
          <time className="mt-2 block text-[9px] text-slate-600">{new Intl.DateTimeFormat("ru", { dateStyle: "medium", timeStyle: "short" }).format(new Date(message.createdAt))}</time>
        </button>;
      })}</div>{result.messages.length === 0 && <div className="grid h-40 place-items-center text-xs text-slate-500">Ничего не найдено</div>}{result.hasMore && <button type="button" disabled={loading} onClick={() => submit(result.offset + result.messages.length)} className="mt-3 w-full rounded-xl border border-white/[.07] py-2.5 text-xs font-semibold text-slate-400 hover:bg-white/[.04] hover:text-white disabled:opacity-40">{loading ? "Загружаем…" : "Показать ещё"}</button>}</>}
    </div>
  </aside>;
}

function toLocalSearchMessage(message: MessageSearchResult["messages"][number]): MockMessage {
  return { ...message, authorColor: "#7c5cff", editedAt: message.editedAt ?? undefined };
}
