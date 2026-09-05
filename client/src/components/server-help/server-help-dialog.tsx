"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { unmetHelpRequires, type ServerHelp, type ServerHelpBlock, type ServerHelpPage } from "@opencord/shared";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const TEXT_SIZE_CLASS = {
  xs: "text-[11px] leading-5",
  sm: "text-[13px] leading-6",
  md: "text-sm leading-6",
  lg: "text-base leading-7",
} as const;

const TEXT_WEIGHT_CLASS = { normal: "font-normal", medium: "font-medium", bold: "font-bold" } as const;

/**
 * Какие страницы видит зритель. Это только UI-маршрутизация: спека приходит
 * целиком, настоящее принуждение — серверный блок писанины до `help.accept`.
 */
export function visibleHelpPages(spec: ServerHelp, viewerAccepted: boolean): ServerHelpPage[] {
  return spec.pages.filter((page) => page.audience === "always" || (viewerAccepted ? page.audience === "accepted" : page.audience === "pending"));
}

/** Контролы страницы, требуемые её accept-кнопками (для звёздочек `*`). */
function requiredControlIds(page: ServerHelpPage): Set<string> {
  const ids = new Set<string>();
  for (const block of page.blocks) {
    if (block.kind === "button" && block.action.kind === "accept") {
      for (const id of block.requires) ids.add(id);
    }
  }
  return ids;
}

/**
 * Pure renderer for a compiled help spec. Interactive controls keep local-only
 * state (never sent to the server) — except the `help.accept` handshake: an
 * accept button sends the current control states once, and the server records
 * the acceptance. Plain text nodes only — no HTML injection surface.
 */
export function ServerHelpBody({ spec, pages: pagesOverride, onClose, onAccept, acceptPending = false }: {
  spec: ServerHelp;
  /** Явно заданный список страниц (гейт показывает только свою). По умолчанию — все. */
  pages?: ServerHelpPage[];
  onClose: () => void;
  onAccept?: (controls: Record<string, boolean | string>) => void;
  acceptPending?: boolean;
}): React.ReactElement {
  const { t } = useI18n();
  const pages = pagesOverride ?? spec.pages;
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [controls, setControls] = useState<Record<string, boolean | string>>({});
  const active = pages.find((page) => page.id === activePageId) ?? pages[0];

  function controlKey(pageId: string, controlId: string): string {
    return `${pageId}:${controlId}`;
  }

  /** Состояния контролов одной страницы без префикса — для `unmetHelpRequires`. */
  function pageControls(pageId: string): Record<string, boolean | string> {
    const slice: Record<string, boolean | string> = {};
    for (const [key, value] of Object.entries(controls)) {
      const separator = key.indexOf(":");
      if (separator > 0 && key.slice(0, separator) === pageId) slice[key.slice(separator + 1)] = value;
    }
    return slice;
  }

  function renderBlock(page: ServerHelpPage, block: ServerHelpBlock, index: number): React.ReactElement {
    const pageId = page.id;
    const required = requiredControlIds(page);
    switch (block.kind) {
      case "text":
        return (
          <p key={index} className={cn("whitespace-pre-wrap text-slate-200", TEXT_SIZE_CLASS[block.size], TEXT_WEIGHT_CLASS[block.weight], block.align === "center" && "text-center")}>
            {block.text}
          </p>
        );
      case "divider":
        return <hr key={index} className="border-white/[.08]" />;
      case "button": {
        if (block.action.kind === "accept") {
          const unmet = unmetHelpRequires(page, pageControls(pageId));
          const disabled = unmet.length > 0 || acceptPending || !onAccept;
          return (
            <Button
              key={index}
              variant={block.variant === "primary" ? "default" : "secondary"}
              size="sm"
              className="w-full"
              disabled={disabled}
              title={unmet.length > 0 ? t.help.acceptBlocked : undefined}
              onClick={() => onAccept?.(pageControls(pageId))}
            >
              {acceptPending ? t.help.acceptSending : block.label}
            </Button>
          );
        }
        return (
          <Button
            key={index}
            variant={block.variant === "primary" ? "default" : "secondary"}
            size="sm"
            className="w-full"
            onClick={() => {
              if (block.action.kind === "page") setActivePageId(block.action.pageId);
              else onClose();
            }}
          >
            {block.label}
          </Button>
        );
      }
      case "checkbox": {
        const key = controlKey(pageId, block.id);
        const checked = controls[key] === undefined ? block.defaultChecked : controls[key] === true;
        return (
          <label key={index} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-white/[.06] bg-black/10 px-3 py-2 text-[13px] text-slate-200 transition hover:border-white/[.12]">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setControls((current) => ({ ...current, [key]: event.target.checked }))}
              className="size-4 shrink-0 cursor-pointer accent-violet-400"
            />
            <span className="min-w-0 flex-1 leading-5">
              {block.label}
              {required.has(block.id) && <span className="text-red-300" title={t.help.required}> *</span>}
            </span>
          </label>
        );
      }
      case "switch": {
        const key = controlKey(pageId, block.id);
        const checked = controls[key] === undefined ? block.defaultChecked : controls[key] === true;
        return (
          <div key={index} className="flex items-center justify-between gap-4 rounded-lg border border-white/[.06] bg-black/10 px-3 py-2">
            <span className="min-w-0 flex-1 text-[13px] leading-5 text-slate-200">
              {block.label}
              {required.has(block.id) && <span className="text-red-300" title={t.help.required}> *</span>}
            </span>
            <Switch aria-label={block.label} checked={checked} onCheckedChange={(next) => setControls((current) => ({ ...current, [key]: next }))} />
          </div>
        );
      }
      case "select": {
        const key = controlKey(pageId, block.id);
        const stored = controls[key];
        const value = typeof stored === "string" ? stored : (block.defaultValue ?? "");
        const label = required.has(block.id) ? `${block.label} *` : block.label;
        return (
          <Combobox
            key={index}
            label={label}
            value={value}
            placeholder={block.label}
            icon={SlidersHorizontal}
            options={block.options.map((option) => ({ value: option, label: option }))}
            clearable={false}
            onChange={(next) => setControls((current) => ({ ...current, [key]: next }))}
          />
        );
      }
    }
  }

  if (!active) return <p className="px-1 py-6 text-center text-sm text-slate-500">{t.help.empty}</p>;

  return (
    <div className="min-w-0">
      {pages.length > 1 && (
        <div role="tablist" aria-label={t.help.pages} className="scrollbar-none mb-3 flex gap-1 overflow-x-auto">
          {pages.map((page) => (
            <button
              key={page.id}
              type="button"
              role="tab"
              aria-selected={page.id === active.id}
              onClick={() => setActivePageId(page.id)}
              className={cn(
                "shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition",
                page.id === active.id ? "bg-violet-500/15 text-violet-200" : "text-slate-500 hover:bg-white/[.04] hover:text-slate-200",
              )}
            >
              {page.title}
            </button>
          ))}
        </div>
      )}
      {/* Bounded box: long pages scroll inside instead of growing the dialog. */}
      <div key={active.id} className="scrollbar-thin max-h-[46vh] min-h-24 space-y-2.5 overflow-y-auto overscroll-contain rounded-xl border border-white/[.06] bg-black/15 p-4">
        {active.blocks.length === 0 ? <p className="py-4 text-center text-xs text-slate-500">{t.help.emptyPage}</p> : active.blocks.map((block, index) => renderBlock(active, block, index))}
      </div>
    </div>
  );
}

export function ServerHelpDialog({ open, onOpenChange, spec, serverName, viewerAccepted, gatePageId = null, onAccept, acceptPending = false, acceptError = null }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spec: ServerHelp | null | undefined;
  serverName: string;
  /** Принял ли зритель правила — фильтрует вкладки по audience. */
  viewerAccepted: boolean;
  /** Гейт-режим: показывается только эта страница без вкладок и без закрытия. */
  gatePageId?: string | null;
  onAccept?: (controls: Record<string, boolean | string>) => void;
  acceptPending?: boolean;
  acceptError?: string | null;
}): React.ReactElement {
  const { t } = useI18n();
  const gatePage = gatePageId ? (spec?.pages.find((page) => page.id === gatePageId) ?? null) : null;
  const enabled = spec?.enabled === true && (spec?.pages.length ?? 0) > 0;
  // В гейт-режиме вкладок нет: новичок видит только страницу правил.
  const pages = gatePage ? [gatePage] : spec ? visibleHelpPages(spec, viewerAccepted) : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose={gatePage !== null} onEscapeKeyDown={gatePage ? (event) => event.preventDefault() : undefined} onPointerDownOutside={gatePage ? (event) => event.preventDefault() : undefined}>
        <DialogHeader>
          <DialogTitle>{serverName}</DialogTitle>
          <DialogDescription>{gatePage ? t.help.gateDescription : t.help.dialogDescription}</DialogDescription>
        </DialogHeader>
        {enabled && pages.length > 0
          ? <ServerHelpBody spec={spec!} pages={pages} onClose={() => onOpenChange(false)} onAccept={onAccept} acceptPending={acceptPending} />
          : <p className="px-1 py-6 text-center text-sm text-slate-500">{t.help.empty}</p>}
        {acceptError && <p role="alert" className="mt-2 text-xs leading-5 text-red-300">{acceptError}</p>}
      </DialogContent>
    </Dialog>
  );
}
