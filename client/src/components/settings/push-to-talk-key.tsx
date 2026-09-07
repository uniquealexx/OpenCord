"use client";

import { useEffect, useRef, useState } from "react";
import { Keyboard, Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { formatKeyLabel } from "@/lib/keybinds";
import { cn } from "@/lib/utils";
import { DEFAULT_PUSH_TO_TALK_KEY, pushToTalkKeySchema } from "@/shared/state";

export function PushToTalkKeyRow({ value, onChange }: { value: string; onChange: (code: string) => void }): React.ReactElement {
  const { t } = useI18n();
  const [capturing, setCapturing] = useState(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!capturing) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") {
        setCapturing(false);
        return;
      }
      const parsed = pushToTalkKeySchema.safeParse(event.code);
      if (!parsed.success) return;
      onChangeRef.current(parsed.data);
      setCapturing(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturing]);

  const isDefault = value === DEFAULT_PUSH_TO_TALK_KEY;

  return (
    <div data-testid="ptt-key-row" className={cn("rounded-xl border p-3 transition-colors", capturing ? "border-violet-400/40 bg-violet-400/[.06]" : "border-white/7 bg-white/[.025]")}>
      <div className="flex items-center justify-between gap-3 rounded-lg bg-black/25 px-3 py-2 ring-1 ring-inset ring-white/8">
        {capturing ? (
          <span role="status" className="inline-flex min-w-0 flex-1 items-center gap-2">
            <span className="relative flex size-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-violet-400" />
            </span>
            <span className="text-sm text-violet-200">{t.settings.pushToTalkPress}</span>
          </span>
        ) : (
          <kbd className="rounded-md border border-white/12 bg-white/[.07] px-1.5 py-0.5 font-sans text-xs font-semibold text-slate-100 shadow-[0_2px_4px_rgba(0,0,0,.35)]">
            {formatKeyLabel(value)}
          </kbd>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {!capturing && !isDefault && (
            <Button variant="ghost" size="sm" title={t.settings.pushToTalkResetHint} aria-label={t.settings.pushToTalkReset} onClick={() => onChange(DEFAULT_PUSH_TO_TALK_KEY)}>
              <RotateCcw className="size-4" />
            </Button>
          )}
          <Button variant={capturing ? "danger" : "secondary"} size="sm" className="min-w-28 justify-center" onClick={() => setCapturing((current) => !current)}>
            {!capturing && <Pencil className="size-3.5" />}
            {capturing ? t.settings.keybindCancel : t.settings.pushToTalkChange}
          </Button>
        </div>
      </div>
      {!capturing && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] leading-4 text-slate-500">
          <Keyboard className="size-3.5 shrink-0" />
          {t.settings.pttHoldHint}
        </p>
      )}
    </div>
  );
}
