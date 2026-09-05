"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { MOBILE_LAYOUT_MAX_WIDTH } from "@/hooks/use-mobile-layout";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/** Насколько нужно утянуть лист вниз, чтобы он закрылся. */
const SHEET_DISMISS_DISTANCE = 96;

export function DialogContent({ className, hideClose = false, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content> & { hideClose?: boolean }): React.ReactElement {
  const { t } = useI18n();
  const contentRef = React.useRef<HTMLDivElement>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const dragRef = React.useRef<{ startY: number; delta: number } | null>(null);

  /** Жест закрытия существует только у нижнего листа; по центру экрана он бессмыслен. */
  const isSheet = (): boolean => typeof window !== "undefined" && window.innerWidth < MOBILE_LAYOUT_MAX_WIDTH;

  const setSheetOffset = (offset: number | null): void => {
    const node = contentRef.current;
    if (!node) return;
    node.style.transition = offset === null ? "transform 180ms ease-out" : "none";
    node.style.transform = offset === null ? "" : `translateY(${offset}px)`;
  };

  const startDrag = (event: React.TouchEvent<HTMLDivElement>): void => {
    if (!isSheet() || event.touches.length !== 1) return;
    const touch = event.touches[0];
    // Тянуть лист можно только когда содержимое прокручено к началу, иначе жест
    // отбирал бы у пользователя обычную прокрутку внутри листа.
    if (!touch || (bodyRef.current?.scrollTop ?? 0) > 0) return;
    dragRef.current = { startY: touch.clientY, delta: 0 };
  };

  const moveDrag = (event: React.TouchEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    const touch = event.touches[0];
    if (!drag || !touch) return;
    drag.delta = Math.max(0, touch.clientY - drag.startY);
    setSheetOffset(drag.delta);
  };

  const endDrag = (): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    setSheetOffset(null);
    if (drag.delta > SHEET_DISMISS_DISTANCE) closeRef.current?.click();
  };

  // Клавиатура открывается уже после фокуса и может перекрыть поле: как только
  // высота листа пересчитана, подтягиваем активное поле в видимую часть.
  React.useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      window.setTimeout(() => target.scrollIntoView({ block: "nearest", behavior: "smooth" }), 250);
    };
    body.addEventListener("focusin", onFocusIn);
    return () => body.removeEventListener("focusin", onFocusIn);
  }, []);

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md data-[state=closed]:animate-out data-[state=open]:animate-in" />
      {/* На телефоне диалог — нижний лист во всю ширину: он ближе к пальцу, не
          оставляет бесполезных полей по краям и поднимается над клавиатурой
          (`--keyboard-offset`), а не прячется под ней.
          На десктопе — прежнее модальное окно по центру. */}
      <DialogPrimitive.Content
        ref={contentRef}
        onTouchStart={startDrag}
        onTouchMove={moveDrag}
        onTouchEnd={endDrag}
        onTouchCancel={endDrag}
        className={cn(
          // Высоты заданы в процентах от вьюпорта, а не в vh/dvh: у фиксированного
          // элемента проценты считаются от текущего (в том числе масштабированного)
          // вьюпорта, поэтому вёрстка не разъезжается при масштабе меньше 100%.
          "glass fixed z-50 flex flex-col overflow-hidden text-slate-100 shadow-[0_24px_70px_rgba(0,0,0,.55)] outline-none",
          "left-1/2 top-1/2 max-h-[86%] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl",
          "max-md:left-0 max-md:right-0 max-md:top-auto max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:rounded-t-3xl max-md:border-b-0",
          "max-md:bottom-[var(--keyboard-offset,0px)] max-md:max-h-[calc(92%-var(--keyboard-offset,0px))]",
          className,
        )}
        {...props}
      >
        <div
          ref={bodyRef}
          className="scrollbar-thin m-1 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl p-5 pr-6 max-md:m-0 max-md:rounded-none max-md:px-4 max-md:pb-[calc(1rem+var(--shell-inset-bottom,0px))] max-md:pt-5"
        >
          <span aria-hidden="true" className="mx-auto mb-4 hidden h-1 w-10 rounded-full bg-white/20 max-md:block" />
          {children}
        </div>
        <DialogPrimitive.Close ref={closeRef} aria-label={t.common.close} className={hideClose ? "hidden" : "absolute right-4 top-4 grid size-9 place-items-center rounded-md text-slate-500 transition hover:bg-white/10 hover:text-white max-md:right-2 max-md:top-3 max-md:size-11"}><X className="size-4 max-md:size-5" /></DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn("mb-6 space-y-2 pr-8", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>): React.ReactElement {
  return <DialogPrimitive.Title className={cn("text-xl font-bold tracking-tight", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>): React.ReactElement {
  return <DialogPrimitive.Description className={cn("text-sm leading-6 text-slate-400", className)} {...props} />;
}
