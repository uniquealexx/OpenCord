"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const emojiFont = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
// Частые реакции — компактный набор для быстрого отклика у сообщения.
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👏", "🙏", "💯"];

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

/**
 * Компактная палитра реакций. Рендерится через портал в document.body с
 * position: fixed, поэтому не обрезается скролл-контейнером чата
 * (overflow-y-auto) и не вылезает за его границы: координаты считаются от
 * кнопки-триггера через getBoundingClientRect() и зажимаются к вьюпорту,
 * при нехватке места снизу палитра раскрывается вверх.
 */
export function ReactionPalette({ anchorRef, label, pickLabel, onSelect, onClose }: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  label: string;
  pickLabel: (emoji: string) => string;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Стартовая позиция за пределами экрана: после монтирования измеряем размеры
  // палитры и ставим реальные координаты одним проходом.
  const [position, setPosition] = useState({ left: -9999, top: -9999 });

  useEffect(() => {
    const anchor = anchorRef.current;
    const root = rootRef.current;
    if (!anchor || !root) return;
    const anchorRect = anchor.getBoundingClientRect();
    const width = root.offsetWidth;
    const height = root.offsetHeight;
    // Правый край палитры прижимаем к правому краю кнопки, затем зажимаем к вьюпорту.
    const left = Math.min(Math.max(anchorRect.right - width, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN));
    // Сначала под кнопкой; если не влезает — раскрываем над ней.
    let top = anchorRect.bottom + ANCHOR_GAP;
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) top = Math.max(VIEWPORT_MARGIN, anchorRect.top - height - ANCHOR_GAP);
    setPosition({ left, top });
    const frame = window.requestAnimationFrame(() => buttonRefs.current[0]?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [anchorRef]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target as Node;
      // Клик по кнопке-триггеру обрабатывает её собственный onClick (toggle).
      if (root.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      onClose();
      anchorRef.current?.focus();
    };
    // Палитра позиционируется fixed — при прокрутке или ресайзе она «отклеится»
    // от сообщения, поэтому закрываем её. Capture ловит скролл любого контейнера.
    const closeOnViewportChange = (): void => onClose();
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("scroll", closeOnViewportChange, true);
    window.addEventListener("resize", closeOnViewportChange);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("scroll", closeOnViewportChange, true);
      window.removeEventListener("resize", closeOnViewportChange);
    };
  }, [anchorRef, onClose]);

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const currentIndex = buttonRefs.current.findIndex((button) => button === document.activeElement);
    if (currentIndex < 0) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = currentIndex + 1;
    else if (event.key === "ArrowLeft") nextIndex = currentIndex - 1;
    else if (event.key === "ArrowDown") nextIndex = currentIndex + 5;
    else if (event.key === "ArrowUp") nextIndex = currentIndex - 5;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = REACTION_EMOJIS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    buttonRefs.current[(nextIndex + REACTION_EMOJIS.length) % REACTION_EMOJIS.length]?.focus();
  };

  return createPortal(
    <div ref={rootRef} role="dialog" aria-label={label} className="glass fixed z-50 max-w-[calc(100vw-1rem)] rounded-xl p-1.5 shadow-[0_18px_55px_rgba(0,0,0,.5)]" style={{ left: position.left, top: position.top }}>
      <div className="grid grid-cols-5 gap-0.5" onKeyDown={moveFocus}>
        {REACTION_EMOJIS.map((emoji, index) => <button ref={(button) => { buttonRefs.current[index] = button; }} key={emoji} type="button" aria-label={pickLabel(emoji)} onClick={() => onSelect(emoji)} className="grid size-8 place-items-center rounded-lg text-lg leading-none transition hover:bg-white/[.075] focus-visible:bg-violet-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50" style={{ fontFamily: emojiFont }}>{emoji}</button>)}
      </div>
    </div>,
    document.body
  );
}
