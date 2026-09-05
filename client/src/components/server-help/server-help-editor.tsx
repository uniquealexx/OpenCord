"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE, DEFAULT_SCREEN_SHARE_MAX_RESOLUTION, type ServerHelp, type ServerSettings } from "@opencord/shared";
import { DEFAULT_HELP_PAGE_SOURCE, parseHelpSource, specToSource } from "@/components/server-help/builder";
import { ServerHelpBody } from "@/components/server-help/server-help-dialog";
import { ScriptEditor, parseErrorLine } from "@/components/server-help/script-editor";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import type { MockServer } from "@/shared/state";

/** Живой справочник по api.* с песочницей (GitHub Pages, EN/RU/ZH). */
export const HELP_API_DOCS_URL = "https://uniquealexx.github.io/OpenCord/";

/**
 * The `?`-button settings tab. The admin writes builder calls (parsed locally,
 * never executed — see builder.ts); only the compiled JSON spec is saved to
 * the server, so viewing members never run this code.
 */
export function ServerHelpEditor({ server, canManage, onSaveSettings }: { server: MockServer; canManage: boolean; onSaveSettings: (settings: ServerSettings) => boolean }): React.ReactElement {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(server.helpPage?.enabled ?? false);
  const [source, setSource] = useState(() => (server.helpPage && server.helpPage.pages.length > 0 ? specToSource(server.helpPage) : DEFAULT_HELP_PAGE_SOURCE));
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ServerHelp | null>(null);
  // Симуляция гейта в предпросмотре: accept никуда не отправляется, только
  // показывает, как диалог выглядит после принятия.
  const [previewAccepted, setPreviewAccepted] = useState(false);
  const errorLine = parseErrorLine(error);
  // Внешние ссылки безопасно открывает только десктоп (main делает shell.openExternal
  // по https). На Android моста для этого нет — уводить WebView со страницы нельзя,
  // поэтому ссылку там не показываем.
  const canOpenExternalDocs = typeof window !== "undefined" && Boolean(window.openCord?.window);

  function changeSource(next: string): void {
    setSource(next);
    if (error !== null) setError(null);
  }

  function runPreview(): void {
    const result = parseHelpSource(source);
    if (!result.ok) {
      setPreview(null);
      setPreviewAccepted(false);
      setError(result.error);
      return;
    }
    setError(null);
    setPreviewAccepted(false);
    setPreview(result.spec);
  }

  function save(): void {
    if (!canManage) return;
    const result = parseHelpSource(source);
    if (!result.ok) {
      setPreview(null);
      setError(result.error);
      return;
    }
    if (enabled && result.spec.pages.length === 0) {
      setError(t.serverSettings.helpNeedsPage);
      return;
    }
    setError(null);
    onSaveSettings({
      name: server.name,
      description: server.description ?? "",
      maxAttachmentBytes: server.maxAttachmentBytes,
      screenShareMaxResolution: server.screenShareMaxResolution ?? DEFAULT_SCREEN_SHARE_MAX_RESOLUTION,
      screenShareMaxFrameRate: server.screenShareMaxFrameRate ?? DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE,
      helpPage: { enabled, gate: result.spec.gate, pages: result.spec.pages },
    });
  }

  function resetExample(): void {
    setSource(DEFAULT_HELP_PAGE_SOURCE);
    setError(null);
    setPreview(null);
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">{t.serverSettings.helpTitle}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{t.serverSettings.helpDescription}</p>
      </div>
      <section className="space-y-5 rounded-3xl border border-white/[.08] bg-panel p-5 sm:p-6">
        <div className="flex min-h-12 items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-200">{t.serverSettings.helpEnabled}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{t.serverSettings.helpEnabledHint}</p>
          </div>
          <Switch aria-label={t.serverSettings.helpEnabled} checked={enabled} disabled={!canManage} onCheckedChange={setEnabled} />
        </div>
        <div className="border-t border-white/[.06] pt-5">
          <label className="block text-xs font-semibold text-slate-300" htmlFor="server-help-source">{t.serverSettings.helpSourceLabel}</label>
          <p className="mt-1 text-xs leading-5 text-slate-500">{t.serverSettings.helpSourceHint}</p>
          <ScriptEditor id="server-help-source" value={source} onChange={changeSource} disabled={!canManage} invalid={error !== null} errorLine={errorLine} />
          {error && <p role="alert" className="mt-2 text-xs leading-5 text-red-300">{t.serverSettings.helpCompileError(error)}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {canManage ? (
              <>
                <Button size="sm" onClick={runPreview}>{t.serverSettings.helpRun}</Button>
                <Button size="sm" variant="secondary" onClick={save}>{t.serverSettings.helpSave}</Button>
                <Button size="sm" variant="ghost" onClick={resetExample}>{t.serverSettings.helpResetExample}</Button>
              </>
            ) : (
              <p className="text-xs text-slate-500">{t.server.onlyOwner}</p>
            )}
          </div>
          {canOpenExternalDocs && (
            <p className="mt-3 text-xs leading-5 text-slate-500">
              <a href={HELP_API_DOCS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-violet-300 underline-offset-4 hover:underline">
                {t.serverSettings.helpApiDocs}
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            </p>
          )}
        </div>
        {preview && (
          <div className="border-t border-white/[.06] pt-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{t.serverSettings.helpPreviewTitle}</p>
            <ServerHelpBody spec={{ enabled: true, gate: preview.gate, pages: preview.pages }} onClose={() => undefined} onAccept={() => setPreviewAccepted(true)} />
            {previewAccepted && <p className="mt-2 text-xs leading-5 text-emerald-300">{t.serverSettings.helpPreviewAccepted}</p>}
          </div>
        )}
      </section>
    </div>
  );
}
