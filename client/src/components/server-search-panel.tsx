"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, File, FileText, Film, Hash, ImageIcon, LoaderCircle, Paperclip, Search, User, X } from "lucide-react";
import type { MessageContentType, MessageSearchFilters, MessageSearchResult } from "@opencord/shared";
import { Avatar } from "@/components/avatar";
import { cn } from "@/lib/utils";
import type { MockChannel, MockMember, MockMessage } from "@/shared/state";
import { useI18n } from "@/lib/i18n";

const contentTypeOptions: { id: MessageContentType; icon: typeof FileText }[] = [
  { id: "text", icon: FileText },
  { id: "image", icon: ImageIcon },
  { id: "video", icon: Film },
  { id: "file", icon: File },
];

const attachmentTypes: MessageContentType[] = ["image", "video", "file"];

export function ServerSearchPanel({ open, serverName, channels, members, result, loading, onClose, onSearch, onOpenMessage }: { open: boolean; serverName: string; channels: MockChannel[]; members: MockMember[]; result: MessageSearchResult | null; loading: boolean; onClose: () => void; onSearch: (filters: MessageSearchFilters) => void; onOpenMessage: (message: MockMessage) => void }): React.ReactElement | null {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [authorId, setAuthorId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [contentTypes, setContentTypes] = useState<MessageContentType[]>([]);
  if (!open) return null;

  const contentTypeLabels: Record<MessageContentType, string> = { text: t.search.text, image: t.search.images, video: t.search.video, file: t.search.files };
  const canSearch = Boolean(query.trim() || authorId || channelId || contentTypes.length);
  function submit(offset = 0): void {
    if (!canSearch || loading) return;
    onSearch({ query: query.trim(), authorId: authorId || null, channelId: channelId || null, contentTypes, offset, limit: 25 });
  }
  function toggleType(type: MessageContentType): void {
    setContentTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  }
  function toggleAttachments(): void {
    setContentTypes((current) => attachmentTypes.every((type) => current.includes(type))
      ? current.filter((type) => !attachmentTypes.includes(type))
      : [...new Set([...current, ...attachmentTypes])]);
  }

  return <aside aria-label={t.search.aria} className="glass absolute inset-y-0 right-0 z-50 flex w-[420px] max-w-[calc(100%-16px)] flex-col border-l border-white/10 shadow-[-24px_0_70px_rgba(0,0,0,.4)] max-sm:left-0 max-sm:w-auto max-sm:max-w-none">
    <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="border-b border-white/[.07] p-4">
      <div className="mb-3 flex items-center gap-2"><Search className="size-4 text-violet-300" /><div className="min-w-0 flex-1"><h2 className="text-sm font-bold text-white">{t.search.title}</h2><p className="truncate text-[10px] text-slate-500">{serverName}</p></div><button type="button" aria-label={t.search.close} onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-white"><X className="size-4" /></button></div>
      <div className="flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[.04] px-3 focus-within:border-violet-400/50"><Search className="size-4 text-slate-500" /><input autoFocus aria-label={t.search.input} value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200} placeholder={t.search.inputPlaceholder} className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-500" /><button type="submit" disabled={!canSearch || loading} className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-white shadow-[0_1px_3px_rgba(0,0,0,.4)] transition-colors hover:bg-violet-400 disabled:opacity-35">{t.search.submit}</button></div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <SearchCombobox label={t.search.author} value={authorId} placeholder={t.search.anyAuthor} icon={User} options={members.map((member) => ({ value: member.id, label: member.displayName }))} onChange={setAuthorId} />
        <SearchCombobox label={t.search.channel} value={channelId} placeholder={t.search.allChannels} icon={Hash} options={channels.filter((channel) => channel.kind === "text").map((channel) => ({ value: channel.id, label: `#${channel.name}` }))} onChange={setChannelId} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5"><button type="button" aria-pressed={attachmentTypes.every((type) => contentTypes.includes(type))} onClick={toggleAttachments} className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition", attachmentTypes.every((type) => contentTypes.includes(type)) ? "border-cyan-400/35 bg-cyan-400/12 text-cyan-100" : "border-white/[.07] bg-white/[.025] text-slate-500 hover:text-slate-300")}><Paperclip className="size-3" />{t.search.attachments}</button>{contentTypeOptions.map((option) => { const Icon = option.icon; const active = contentTypes.includes(option.id); return <button key={option.id} type="button" aria-pressed={active} onClick={() => toggleType(option.id)} className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition", active ? "border-violet-400/35 bg-violet-400/15 text-violet-200" : "border-white/[.07] bg-white/[.025] text-slate-500 hover:text-slate-300")}><Icon className="size-3" />{contentTypeLabels[option.id]}</button>; })}</div>
    </form>

    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
      {loading && !result ? <div className="grid h-44 place-items-center text-xs text-slate-500"><span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" />{t.search.searching}</span></div> : null}
      {!loading && !result ? <div className="grid h-44 place-items-center px-8 text-center text-xs leading-5 text-slate-500">{t.search.hint}</div> : null}
      {result && <><div className="mb-2 flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600"><span>{t.search.results}</span><span>{result.total}</span></div><div className="space-y-2">{result.messages.map((message) => {
        const channel = channels.find((item) => item.id === message.channelId);
        const member = members.find((item) => item.id === message.authorId);
        return <button key={message.id} type="button" onClick={() => onOpenMessage(toLocalSearchMessage(message))} className="group w-full rounded-xl border border-white/[.065] bg-[#26282c] p-3 text-left hover:border-violet-400/25 hover:bg-[#2b2d32]">
          <div className="flex items-center gap-2"><Avatar name={message.authorName} image={message.authorAvatar} color={member?.avatarColor} size="sm" /><span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-200">{message.authorName}</span><span className="text-[10px] text-slate-600">#{channel?.name ?? t.search.removedChannel}</span></div>
          {message.content && <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5 text-slate-400 group-hover:text-slate-300">{message.content}</p>}
          {message.attachments.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{message.attachments.map((attachment) => <span key={attachment.id} className="max-w-full truncate rounded-md bg-black/20 px-2 py-1 text-[10px] text-violet-200/70">{attachment.mimeType.startsWith("image/") ? t.search.image : attachment.mimeType.startsWith("video/") ? t.search.video : t.search.file}: {attachment.fileName}</span>)}</div>}
          <time className="mt-2 block text-[9px] text-slate-600">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(message.createdAt))}</time>
        </button>;
      })}</div>{result.messages.length === 0 && <div className="grid h-40 place-items-center text-xs text-slate-500">{t.search.nothingFound}</div>}{result.hasMore && <button type="button" disabled={loading} onClick={() => submit(result.offset + result.messages.length)} className="mt-3 w-full rounded-xl border border-white/[.07] py-2.5 text-xs font-semibold text-slate-400 hover:bg-white/[.04] hover:text-white disabled:opacity-40">{loading ? t.search.loadingMore : t.search.showMore}</button>}</>}
    </div>
  </aside>;
}

function toLocalSearchMessage(message: MessageSearchResult["messages"][number]): MockMessage {
  return { ...message, authorColor: "#4d6bfe", editedAt: message.editedAt ?? undefined };
}

function SearchCombobox({ label, value, placeholder, icon: Icon, options, onChange }: { label: string; value: string; placeholder: string; icon: typeof User; options: { value: string; label: string }[]; onChange: (value: string) => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);

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

  const choose = (nextValue: string): void => { onChange(nextValue); setOpen(false); };
  return <div ref={rootRef} className="relative min-w-0">
    <button type="button" role="combobox" aria-label={label} aria-controls={listboxId} aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((current) => !current)} className={cn("flex h-10 w-full min-w-0 items-center gap-2 rounded-xl border px-3 text-left text-xs shadow-[inset_0_1px_rgba(255,255,255,.025)] transition", open ? "border-violet-400/45 bg-[#2b2d32] ring-2 ring-violet-400/10" : "border-white/[.08] bg-[#26282c] hover:border-white/[.14] hover:bg-[#2b2d32]")}>
      <Icon className={cn("size-3.5 shrink-0", open ? "text-violet-300" : "text-slate-500")} />
      <span className={cn("min-w-0 flex-1 truncate", selected ? "text-slate-200" : "text-slate-500")}>{selected?.label ?? placeholder}</span>
      <ChevronDown className={cn("size-3.5 shrink-0 text-slate-600 transition-transform", open && "rotate-180 text-violet-300")} />
    </button>
    {open && <div id={listboxId} role="listbox" aria-label={label} className="glass absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-52 overflow-y-auto rounded-xl p-1.5 shadow-[0_18px_50px_rgba(0,0,0,.5)]">
      {[{ value: "", label: placeholder }, ...options].map((option) => <button key={option.value || "all"} type="button" role="option" aria-selected={option.value === value} onClick={() => choose(option.value)} className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition", option.value === value ? "bg-violet-400/14 text-violet-100" : "text-slate-400 hover:bg-white/[.05] hover:text-white")}><span className="min-w-0 flex-1 truncate">{option.label}</span>{option.value === value && <Check className="size-3.5 shrink-0 text-violet-300" />}</button>)}
    </div>}
  </div>;
}
