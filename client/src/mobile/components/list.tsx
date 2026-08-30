"use client";

import { ChevronRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * Строки списка для мобильных экранов.
 *
 * Отличие от десктопных карточек — в распределении текста. На широком экране
 * пояснение помещается рядом с заголовком, на телефоне оно сжимает и заголовок,
 * и элемент управления. Поэтому здесь пояснение всегда идёт отдельной строкой под
 * заголовком, а управляющий элемент отделён фиксированным отступом и не сжимается.
 */

export function ListGroup({ title, hint, children }: { title?: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="mb-6">
      {title && <h2 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[.14em] text-slate-500">{title}</h2>}
      <div className="divide-y divide-white/[.06] overflow-hidden rounded-2xl border border-white/[.07] bg-white/[.025]">{children}</div>
      {hint && <p className="mt-2 px-1 text-xs leading-5 text-slate-500">{hint}</p>}
    </section>
  );
}

/**
 * Строка-переход в подраздел.
 *
 * Короткое значение стоит справа от заголовка, длинное уходит на вторую строку:
 * иначе на узком экране обрезаются оба сразу и строка перестаёт что-либо сообщать.
 */
const INLINE_VALUE_MAX_LENGTH = 14;

export function ListLink({ label, value, icon, danger, onClick }: { label: string; value?: string; icon?: React.ReactNode; danger?: boolean; onClick: () => void }): React.ReactElement {
  const inlineValue = value && value.length <= INLINE_VALUE_MAX_LENGTH ? value : undefined;
  const stackedValue = value && !inlineValue ? value : undefined;
  return (
    <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition active:bg-white/[.05]">
      {icon && <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg bg-white/[.05]", danger ? "text-red-300" : "text-slate-400")}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[15px] font-medium leading-6", danger ? "text-red-200" : "text-slate-200")}>{label}</span>
        {stackedValue && <span className="mt-0.5 block truncate text-xs leading-5 text-slate-500">{stackedValue}</span>}
      </span>
      {inlineValue && <span className="shrink-0 text-sm text-slate-500">{inlineValue}</span>}
      <ChevronRight className="size-5 shrink-0 text-slate-600" />
    </button>
  );
}

/** Строка с тумблером; пояснение — отдельной строкой, чтобы не сжимать заголовок. */
export function ListToggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }): React.ReactElement {
  return (
    <div className="flex min-h-14 items-start gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium leading-6 text-slate-200">{label}</p>
        {hint && <p className="mt-0.5 text-xs leading-5 text-slate-500">{hint}</p>}
      </div>
      <span className="mt-1 shrink-0">
        <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
      </span>
    </div>
  );
}

/**
 * Выбор одного значения из списка. На телефоне это вертикальный список с отметкой,
 * а не сегментированная кнопка: подписи вроде «Активация голосом» в узкий сегмент
 * не помещаются и переносятся на две строки.
 */
export function ListChoice<Value extends string | number>({ label, options, value, onChange }: { label: string; options: { value: Value; label: string; hint?: string }[]; value: Value; onChange: (value: Value) => void }): React.ReactElement {
  return (
    <div role="radiogroup" aria-label={label} className="contents">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition active:bg-white/[.05]"
          >
            <span className="min-w-0 flex-1">
              <span className={cn("block text-[15px] font-medium leading-6", selected ? "text-violet-200" : "text-slate-200")}>{option.label}</span>
              {option.hint && <span className="mt-0.5 block text-xs leading-5 text-slate-500">{option.hint}</span>}
            </span>
            <span aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center rounded-full border-2", selected ? "border-violet-400" : "border-white/20")}>
              {selected && <span className="size-2.5 rounded-full bg-violet-400" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Строка с произвольным содержимым под заголовком: слайдеры, поля, индикаторы. */
export function ListBlock({ label, hint, children }: { label?: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="px-4 py-3">
      {label && <p className="text-[15px] font-medium leading-6 text-slate-200">{label}</p>}
      {hint && <p className="mt-0.5 text-xs leading-5 text-slate-500">{hint}</p>}
      <div className={cn(label || hint ? "mt-3" : undefined)}>{children}</div>
    </div>
  );
}
