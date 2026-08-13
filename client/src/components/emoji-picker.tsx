"use client";

import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";
import { cn } from "@/lib/utils";

const emojiFont = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const recentStorageKey = "opencord.recent-emojis";

const emojiCategories = [
  { id: "faces", label: "Смайлы", icon: "😀", emojis: ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥸", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️", "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤗", "🤔", "🫣", "🤭", "🫢", "🫡", "🤫", "🫠", "🤥", "😶", "😐", "😑", "😬", "🙄", "😯", "😦", "😧", "😮", "😲", "🥱", "😴", "🤤", "😪", "😵", "🤐", "🥴", "🤢", "🤮", "🤧", "😷", "🤒", "🤕"] },
  { id: "gestures", label: "Жесты", icon: "👋", emojis: ["👋", "🤚", "🖐️", "✋", "🖖", "🫱", "🫲", "🫳", "🫴", "👌", "🤌", "🤏", "✌️", "🤞", "🫰", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "🫵", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "🫶", "👐", "🤲", "🤝", "🙏", "✍️", "💅", "🤳", "💪", "🦾", "🫂", "👀", "👁️", "🧠", "🫀", "🫁"] },
  { id: "people", label: "Люди", icon: "🧑", emojis: ["👶", "🧒", "👦", "👧", "🧑", "👱", "👨", "🧔", "👩", "🧓", "👴", "👵", "🙍", "🙎", "🙅", "🙆", "💁", "🙋", "🧏", "🙇", "🤦", "🤷", "👮", "👷", "💂", "🕵️", "👩‍⚕️", "👨‍🎓", "👩‍🏫", "👨‍⚖️", "👩‍🌾", "👨‍🍳", "👩‍🔧", "👨‍💻", "👩‍🎨", "👨‍🚀", "👩‍🚒", "🧙", "🧚", "🧛", "🧜", "🧝", "🧞", "🧟", "💆", "💇", "🚶", "🧍", "🧎", "🏃", "💃", "🕺"] },
  { id: "animals", label: "Животные", icon: "🐻", emojis: ["🐵", "🐒", "🦍", "🦧", "🐶", "🐕", "🦮", "🐩", "🐺", "🦊", "🦝", "🐱", "🐈", "🦁", "🐯", "🐅", "🐆", "🐴", "🫎", "🫏", "🐎", "🦄", "🦓", "🦌", "🦬", "🐮", "🐂", "🐃", "🐄", "🐷", "🐖", "🐗", "🐽", "🐏", "🐑", "🐐", "🐪", "🐫", "🦙", "🦒", "🐘", "🦣", "🦏", "🦛", "🐭", "🐹", "🐰", "🐿️", "🦫", "🦔", "🦇", "🐻", "🐨", "🐼", "🦥", "🦦", "🦨", "🦘", "🦡", "🐾", "🐔", "🐧", "🦆", "🦅", "🦉", "🦜", "🐸", "🐊", "🐢", "🦎", "🐍", "🐲", "🐳", "🐬", "🦭", "🐟", "🐙", "🦋"] },
  { id: "food", label: "Еда", icon: "🍕", emojis: ["🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🥑", "🍆", "🥔", "🥕", "🌽", "🌶️", "🫑", "🥒", "🥬", "🥦", "🧄", "🧅", "🍄", "🥜", "🌰", "🍞", "🥐", "🥖", "🫓", "🥨", "🥯", "🥞", "🧇", "🧀", "🍖", "🍗", "🥩", "🥓", "🍔", "🍟", "🍕", "🌭", "🥪", "🌮", "🌯", "🫔", "🥙", "🧆", "🥚", "🍳", "🥘", "🍲", "🫕", "🥣", "🥗", "🍿", "🍣", "🍤", "🍙", "🍚", "🍜", "🍦", "🍩", "🍪", "🎂", "🍫", "🍬", "☕", "🧋", "🍺", "🍷"] },
  { id: "activities", label: "Занятия", icon: "⚽", emojis: ["⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🥏", "🎱", "🪀", "🏓", "🏸", "🏒", "🏑", "🥍", "🏏", "🪃", "🥅", "⛳", "🪁", "🏹", "🎣", "🤿", "🥊", "🥋", "🎽", "🛹", "🛼", "🛷", "⛸️", "🥌", "🎿", "🏂", "🪂", "🏋️", "🤸", "⛹️", "🤺", "🤾", "🏌️", "🏇", "🧘", "🏄", "🏊", "🚴", "🏆", "🥇", "🎮", "🕹️", "🎲", "♟️", "🎯", "🎳", "🎨", "🎭", "🎤", "🎧", "🎸", "🎹", "🥁"] },
  { id: "travel", label: "Путешествия", icon: "🚀", emojis: ["🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒", "🚐", "🛻", "🚚", "🚛", "🚜", "🛵", "🏍️", "🚲", "🛴", "🚨", "🚔", "🚍", "🚘", "🚖", "🚡", "🚠", "🚟", "🚃", "🚋", "🚞", "🚝", "🚄", "🚅", "🚈", "🚂", "✈️", "🛫", "🛬", "🛩️", "💺", "🚁", "🚀", "🛸", "🚢", "⛵", "🚤", "🛥️", "🗺️", "🗿", "🗽", "🗼", "🏰", "🏯", "🏟️", "🎡", "🎢", "🎠", "⛲", "⛺", "🌋", "🏖️", "🏝️", "🏜️", "🏕️", "🌍", "🌎", "🌏", "🌙", "⭐", "🌈", "🔥"] },
  { id: "symbols", label: "Символы", icon: "❤️", emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❤️‍🔥", "❤️‍🩹", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "❣️", "💋", "💯", "💢", "💥", "💫", "💦", "💨", "🕳️", "💣", "💬", "👁️‍🗨️", "🗨️", "🗯️", "💭", "💤", "✅", "❌", "❓", "❗", "‼️", "⁉️", "⭕", "🚫", "🔞", "♻️", "⚠️", "🔱", "⚜️", "🔆", "✨", "🎉", "🎊", "🎈", "🎁", "🔔", "📌", "📍", "💡", "🔒", "🔑", "🛡️", "⚡", "☀️", "☁️", "❄️"] },
] as const;

type CategoryId = "recent" | (typeof emojiCategories)[number]["id"];

export function EmojiPicker({ disabled = false, onSelect }: { disabled?: boolean; onSelect: (emoji: string) => void }): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<CategoryId>("faces");
  const [recent, setRecent] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = JSON.parse(window.localStorage.getItem(recentStorageKey) ?? "[]");
      return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string").slice(0, 24) : [];
    } catch { /* Ignore invalid local history. */ }
    return [];
  });

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent): void => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); window.removeEventListener("keydown", closeOnEscape); };
  }, [open]);

  const activeCategory = emojiCategories.find((item) => item.id === category);
  const emojis = category === "recent" ? recent : activeCategory?.emojis ?? [];
  const label = category === "recent" ? "Недавние" : activeCategory?.label ?? "Смайлы";

  function choose(emoji: string): void {
    onSelect(emoji);
    const next = [emoji, ...recent.filter((item) => item !== emoji)].slice(0, 24);
    setRecent(next);
    try { window.localStorage.setItem(recentStorageKey, JSON.stringify(next)); } catch { /* Storage may be unavailable. */ }
  }

  return <div ref={rootRef} className="relative shrink-0">
    <button type="button" disabled={disabled} aria-label="Открыть панель эмодзи" aria-expanded={open} onClick={() => setOpen((value) => !value)} className={cn("grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-white/[.055] hover:text-amber-300 disabled:opacity-30", open && "bg-white/[.055] text-amber-300")}><Smile className="size-5" /></button>
    {open && <div role="dialog" aria-label="Панель эмодзи" className="glass absolute bottom-12 right-0 z-50 w-[344px] overflow-hidden rounded-2xl shadow-[0_22px_70px_rgba(0,0,0,.55)]">
      <div className="flex h-11 items-center justify-between border-b border-white/[.07] px-4"><span className="text-sm font-semibold text-slate-200">{label}</span><span className="text-[10px] text-slate-600">Нажмите для вставки</span></div>
      <div className="scrollbar-thin h-64 overflow-y-auto p-2.5">
        {emojis.length ? <div className="grid grid-cols-8 gap-0.5">{emojis.map((emoji, index) => <button key={`${emoji}-${index}`} type="button" aria-label={`Вставить ${emoji}`} onClick={() => choose(emoji)} className="grid size-10 place-items-center rounded-xl text-[25px] leading-none hover:bg-white/[.075] focus:bg-violet-400/15 focus:outline-none" style={{ fontFamily: emojiFont }}>{emoji}</button>)}</div> : <div className="grid h-full place-items-center text-center text-xs text-slate-500">Здесь появятся недавно<br />использованные эмодзи</div>}
      </div>
      <div className="flex h-12 items-center justify-between border-t border-white/[.07] px-2">
        <button type="button" aria-label="Недавние эмодзи" title="Недавние" onClick={() => setCategory("recent")} className={cn("grid size-9 place-items-center rounded-lg text-xl grayscale hover:bg-white/[.06] hover:grayscale-0", category === "recent" && "bg-violet-400/15 grayscale-0")} style={{ fontFamily: emojiFont }}>🕘</button>
        {emojiCategories.map((item) => <button key={item.id} type="button" aria-label={item.label} title={item.label} onClick={() => setCategory(item.id)} className={cn("grid size-9 place-items-center rounded-lg text-xl grayscale hover:bg-white/[.06] hover:grayscale-0", category === item.id && "bg-violet-400/15 grayscale-0")} style={{ fontFamily: emojiFont }}>{item.icon}</button>)}
      </div>
    </div>}
  </div>;
}
