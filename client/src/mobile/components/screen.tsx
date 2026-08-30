"use client";

import { ChevronLeft, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Каркас мобильного экрана: шапка фиксированной высоты и прокручиваемое тело.
 *
 * Именно этим мобильный экран отличается от адаптированного диалога: он занимает
 * весь экран целиком, шапка не «плавает» поверх содержимого, а заголовок и кнопка
 * возврата стоят там, где их ждёт палец — слева сверху. Нижний отступ учитывает
 * жестовую панель и клавиатуру (переменные задаются в `globals.css`).
 */
export function Screen({
  title,
  subtitle,
  onBack,
  onClose,
  actions,
  footer,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  /** Показывает стрелку «назад». Если не задан, слева рисуется крестик закрытия. */
  onBack?: () => void;
  onClose?: () => void;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <section className={cn("absolute inset-0 z-50 flex flex-col bg-canvas", className)}>
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-white/[.055] px-1.5">
        {onBack ? (
          <button type="button" aria-label={t.common.back} onClick={onBack} className="grid size-11 shrink-0 place-items-center rounded-xl text-slate-300 transition hover:bg-white/6 hover:text-slate-100">
            <ChevronLeft className="size-6" />
          </button>
        ) : onClose ? (
          <button type="button" aria-label={t.common.close} onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-xl text-slate-300 transition hover:bg-white/6 hover:text-slate-100">
            <X className="size-5" />
          </button>
        ) : (
          <span className="w-2" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold leading-5 text-slate-100">{title}</h1>
          {subtitle && <p className="truncate text-[11px] leading-4 text-slate-500">{subtitle}</p>}
        </div>
        {actions}
      </header>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1.5rem+var(--shell-inset-bottom,0px))] pt-4">
        {children}
      </div>
      {footer && <div className="shrink-0 border-t border-white/[.055] px-4 py-3">{footer}</div>}
    </section>
  );
}
