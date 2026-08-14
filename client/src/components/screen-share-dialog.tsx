"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE, DEFAULT_SCREEN_SHARE_MAX_RESOLUTION, SCREEN_SHARE_FRAME_RATES, SCREEN_SHARE_RESOLUTIONS, type ScreenShareFrameRate, type ScreenShareResolution } from "@opencord/shared";
import { LoaderCircle, Maximize2, Minimize2, MonitorUp, ScreenShare, Square, Volume2 } from "lucide-react";
import type { ScreenShareSettings, ScreenShareStream } from "@/hooks/use-voice-session";
import type { ScreenShareSource } from "@/shared/screen-share";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { currentDictionary, useI18n, type Dictionary } from "@/lib/i18n";

const resolutions: Record<ScreenShareResolution, { width: number; height: number }> = {
  480: { width: 854, height: 480 },
  720: { width: 1280, height: 720 },
  1080: { width: 1920, height: 1080 },
  1440: { width: 2560, height: 1440 },
};

const bitrates: Record<ScreenShareResolution, Record<ScreenShareFrameRate, number>> = {
  480: { 15: 800_000, 30: 1_500_000, 60: 2_500_000 },
  720: { 15: 1_500_000, 30: 3_000_000, 60: 5_000_000 },
  1080: { 15: 2_500_000, 30: 5_000_000, 60: 8_000_000 },
  1440: { 15: 5_000_000, 30: 10_000_000, 60: 16_000_000 },
};

export function screenShareResolutionLabel(resolution: ScreenShareResolution, t?: Dictionary): string {
  return resolution === 1440 ? (t ?? currentDictionary()).screenShare.source : `${resolution}p`;
}

export const SCREEN_SHARE_SURFACE_CLASS_NAME = "relative grid min-h-0 w-full place-items-center overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl fullscreen:h-screen fullscreen:w-screen fullscreen:max-h-none fullscreen:rounded-none fullscreen:border-0";
export const SCREEN_SHARE_CANVAS_CLASS_NAME = "block size-full min-h-0 min-w-0 bg-black object-contain";

function reportScreenShare(stage: string, details: Record<string, unknown>): void {
  void window.openCord?.screenShare?.report?.(`${stage} ${JSON.stringify(details)}`);
}

export function screenShareSettings(resolution: ScreenShareResolution, frameRate: ScreenShareFrameRate, includeAudio: boolean, contentHint: "detail" | "motion", sourceWidth = resolutions[resolution].width, sourceHeight = resolutions[resolution].height): ScreenShareSettings {
  const safeWidth = Math.max(1, sourceWidth);
  const safeHeight = Math.max(1, sourceHeight);
  const sourceScale = resolution === 1440 ? Math.min(1, resolutions[1440].width / safeWidth, resolutions[1440].height / safeHeight) : Math.min(1, resolution / safeHeight);
  const width = Math.max(2, Math.round((safeWidth * sourceScale) / 2) * 2);
  const height = Math.max(2, Math.round((safeHeight * sourceScale) / 2) * 2);
  const baselinePixels = resolutions[resolution].width * resolutions[resolution].height;
  const actualPixels = width * height;
  const scaledBitrate = Math.ceil((bitrates[resolution][frameRate] * actualPixels / baselinePixels) / 100_000) * 100_000;
  return { width, height, frameRate, maxBitrate: Math.min(20_000_000, scaledBitrate), includeAudio, contentHint };
}

export function ScreenShareDialog({ open, maxResolution = DEFAULT_SCREEN_SHARE_MAX_RESOLUTION, maxFrameRate = DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE, onOpenChange, onStart }: { open: boolean; maxResolution?: ScreenShareResolution; maxFrameRate?: ScreenShareFrameRate; onOpenChange: (open: boolean) => void; onStart: (settings: ScreenShareSettings) => Promise<void> }): React.ReactElement {
  const { t } = useI18n();
  const [sources, setSources] = useState<ScreenShareSource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolution, setResolution] = useState<ScreenShareResolution>(720);
  const [frameRate, setFrameRate] = useState<ScreenShareFrameRate>(30);
  const [includeAudio, setIncludeAudio] = useState(true);
  const [contentHint, setContentHint] = useState<"detail" | "motion">("detail");
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const availableResolutions = SCREEN_SHARE_RESOLUTIONS.filter((value) => value <= maxResolution);
  const availableFrameRates = SCREEN_SHARE_FRAME_RATES.filter((value) => value <= maxFrameRate);
  const selectedResolution = resolution > maxResolution ? maxResolution : resolution;
  const selectedFrameRate = frameRate > maxFrameRate ? maxFrameRate : frameRate;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setLoading(true);
      setError("");
      const bridge = window.openCord?.screenShare;
      if (!bridge) {
        setLoading(false);
        setError(currentDictionary().screenShare.desktopOnly);
        return;
      }
      try {
        const nextSources = await bridge.listSources();
        if (cancelled) return;
        setSources(nextSources);
        setSelectedId((current) => nextSources.some((source) => source.id === current) ? current : nextSources[0]?.id ?? null);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : currentDictionary().screenShare.listFailed);
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [open]);

  const selected = useMemo(() => sources.find((source) => source.id === selectedId), [selectedId, sources]);
  const selectedSettings = screenShareSettings(selectedResolution, selectedFrameRate, includeAudio, contentHint, selected?.width, selected?.height);
  async function start(): Promise<void> {
    const bridge = window.openCord?.screenShare;
    if (!bridge || !selected) return;
    setStarting(true); setError("");
    try {
      await bridge.selectSource({ sourceId: selected.id, includeAudio });
      await onStart(selectedSettings);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t.screenShare.startFailed);
    } finally { setStarting(false); }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-4xl"><DialogHeader><div className="mb-2 grid size-11 place-items-center rounded-2xl bg-cyan-400/10 text-cyan-300"><MonitorUp className="size-5" /></div><DialogTitle>{t.screenShare.title}</DialogTitle><DialogDescription>{t.screenShare.description}</DialogDescription></DialogHeader>
    {loading ? <div className="grid min-h-52 place-items-center text-sm text-slate-500"><LoaderCircle className="mb-2 size-6 animate-spin text-violet-300" />{t.screenShare.loadingSources}</div> : <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
      <section><div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-bold uppercase tracking-[.12em] text-slate-500">{t.screenShare.chooseWhat}</h3><span className="text-[10px] text-slate-600">{t.screenShare.sourcesCount(sources.length)}</span></div><div className="scrollbar-thin grid max-h-[360px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">{sources.map((source) => <button key={source.id} type="button" onClick={() => setSelectedId(source.id)} className={cn("group overflow-hidden rounded-2xl border bg-black/20 p-1.5 text-left transition", selectedId === source.id ? "border-violet-400/70 ring-2 ring-violet-400/20" : "border-white/8 hover:border-white/20")}><div className="relative aspect-video overflow-hidden rounded-xl bg-[#191b1e]"><Image unoptimized fill sizes="240px" src={source.thumbnail} alt="" className="object-cover" /></div><div className="flex items-center gap-2 px-1.5 pb-1 pt-2">{source.appIcon ? <Image unoptimized width={16} height={16} src={source.appIcon} alt="" className="size-4 rounded" /> : source.kind === "screen" ? <MonitorUp className="size-4 text-cyan-300" /> : <Square className="size-4 text-violet-300" />}<span className="min-w-0 truncate text-xs font-medium text-slate-300">{source.name}</span></div></button>)}</div>{!sources.length && !error && <p className="rounded-2xl border border-white/8 bg-black/15 p-5 text-sm text-slate-500">{t.screenShare.noSources}</p>}</section>
      <aside className="space-y-4 rounded-xl border border-white/10 bg-white/[.03] p-4"><OptionGroup label={t.screenShare.quality} values={availableResolutions} value={selectedResolution} format={(value) => screenShareResolutionLabel(value as ScreenShareResolution, t)} onChange={(value) => setResolution(value as ScreenShareResolution)} /><OptionGroup label={t.screenShare.fps} values={availableFrameRates} value={selectedFrameRate} format={String} onChange={(value) => { const next = value as ScreenShareFrameRate; setFrameRate(next); if (next === 60) setContentHint("motion"); }} /><div><p className="mb-2 text-xs font-semibold text-slate-400">{t.screenShare.content}</p><div className="grid grid-cols-2 gap-1 rounded-lg bg-white/[.04] p-1"><button type="button" onClick={() => setContentHint("detail")} className={cn("rounded-lg px-2 py-2 text-[11px] font-semibold", contentHint === "detail" ? "bg-violet-500 text-white" : "text-slate-500")}>{t.screenShare.text}</button><button type="button" onClick={() => setContentHint("motion")} className={cn("rounded-lg px-2 py-2 text-[11px] font-semibold", contentHint === "motion" ? "bg-violet-500 text-white" : "text-slate-500")}>{t.screenShare.motion}</button></div></div><label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/8 bg-white/[.025] p-3 text-xs text-slate-300"><input type="checkbox" checked={includeAudio} onChange={(event) => setIncludeAudio(event.target.checked)} className="size-4 accent-violet-500" /><Volume2 className="size-4 text-cyan-300" /><span>{t.screenShare.systemAudio}</span></label><div className="rounded-xl bg-violet-400/[.06] p-3 text-[11px] leading-5 text-violet-100/65"><strong className="block text-violet-200">{screenShareResolutionLabel(selectedResolution, t)} · {selectedFrameRate} FPS</strong>{t.screenShare.frame(selectedSettings.width, selectedSettings.height)} · {t.screenShare.bitrate((selectedSettings.maxBitrate / 1_000_000).toFixed(1))}<span className="block">{contentHint === "motion" ? t.screenShare.prioritySmoothness : t.screenShare.prioritySharpness}</span><span className="mt-1 block text-[10px] text-slate-500">{t.screenShare.serverLimit(screenShareResolutionLabel(maxResolution), maxFrameRate)}</span></div></aside>
    </div>}
    {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/[.07] px-4 py-3 text-xs text-red-200">{error}</p>}
    <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>{t.screenShare.cancel}</Button><Button onClick={() => void start()} disabled={!selected || loading || starting}>{starting ? <LoaderCircle className="size-4 animate-spin" /> : <ScreenShare className="size-4" />}{t.screenShare.start}</Button></div>
  </DialogContent></Dialog>;
}

function OptionGroup({ label, values, value, format, onChange }: { label: string; values: readonly number[]; value: number; format: (value: number) => string; onChange: (value: number) => void }): React.ReactElement {
  return <div><p className="mb-2 text-xs font-semibold text-slate-400">{label}</p><div className="grid gap-1 rounded-lg bg-white/[.04] p-1" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}>{values.map((option) => <button key={option} type="button" onClick={() => onChange(option)} className={cn("rounded-md px-2 py-2 text-[11px] font-medium", value === option ? "bg-primary text-white shadow-[0_1px_2px_rgba(0,0,0,.4)]" : "text-slate-500 hover:text-slate-300")}>{format(option)}</button>)}</div></div>;
}

export function ScreenShareSurface({ stream, className, fullscreenControls }: { stream: ScreenShareStream; className?: string; fullscreenControls?: ReactNode }): React.ReactElement {
  const { t } = useI18n();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const attachVideo = useCallback((node: HTMLVideoElement | null): void => {
    videoRef.current = node;
    setPortalReady(Boolean(node && canvasRef.current));
  }, []);
  const attachCanvas = useCallback((node: HTMLCanvasElement | null): void => {
    canvasRef.current = node;
    setPortalReady(Boolean(node && videoRef.current));
  }, []);
  useEffect(() => {
    const handleFullscreenChange = (): void => setFullscreen(document.fullscreenElement === surfaceRef.current);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!stream || !video || !canvas) return;
    const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    const Processor = (window as unknown as { MediaStreamTrackProcessor?: new (options: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> } }).MediaStreamTrackProcessor;
    reportScreenShare("viewer-track", { local: stream.local, readyState: stream.track.mediaStreamTrack.readyState, muted: stream.track.mediaStreamTrack.muted, enabled: stream.track.mediaStreamTrack.enabled, settings: stream.track.mediaStreamTrack.getSettings(), processorAvailable: Boolean(Processor) });
    if (context && Processor) {
      const reader = new Processor({ track: stream.track.mediaStreamTrack }).readable.getReader();
      let stopped = false;
      let firstFrameLogged = false;
      void (async () => {
        while (!stopped) {
          const result = await reader.read();
          if (result.done) break;
          const frame = result.value;
          try {
            const sourceWidth = frame.displayWidth || frame.codedWidth;
            const sourceHeight = frame.displayHeight || frame.codedHeight;
            const width = sourceWidth;
            const height = sourceHeight;
            if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
            context.drawImage(frame, 0, 0, width, height);
            if (!firstFrameLogged) {
              firstFrameLogged = true;
              reportScreenShare("processor-first-frame", { canvasWidth: width, canvasHeight: height });
            }
          } finally {
            frame.close();
          }
        }
      })().catch((error: unknown) => {
        if (!stopped) console.warn("Screen share frame processor failed", error);
      });
      return () => {
        stopped = true;
        void reader.cancel().catch(() => undefined);
        context.clearRect(0, 0, canvas.width, canvas.height);
      };
    }

    const mediaStream = new MediaStream([stream.track.mediaStreamTrack]);
    let animationFrame = 0;
    let stopped = false;
    let firstFrameLogged = false;
    const drawFrame = (): void => {
      if (stopped) return;
      if (context && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        context.drawImage(video, 0, 0, width, height);
        if (!firstFrameLogged) {
          firstFrameLogged = true;
          const sample = context.getImageData(Math.max(0, Math.floor(width / 2) - 8), Math.max(0, Math.floor(height / 2) - 8), Math.min(16, width), Math.min(16, height)).data;
          let brightness = 0;
          for (let index = 0; index < sample.length; index += 4) brightness += (sample[index] ?? 0) + (sample[index + 1] ?? 0) + (sample[index + 2] ?? 0);
          reportScreenShare("first-frame", { videoWidth: video.videoWidth, videoHeight: video.videoHeight, canvasWidth: width, canvasHeight: height, averageBrightness: brightness / (sample.length / 4) / 3 });
        }
      }
      animationFrame = window.requestAnimationFrame(drawFrame);
    };
    const play = (): void => {
      void video.play().then(() => {
        reportScreenShare("playback-started", { readyState: video.readyState, videoWidth: video.videoWidth, videoHeight: video.videoHeight });
        if (!animationFrame) animationFrame = window.requestAnimationFrame(drawFrame);
      }).catch((error: unknown) => console.warn("Screen share preview playback failed", error));
    };
    video.muted = true;
    video.volume = 0;
    video.srcObject = mediaStream;
    const metadataTimeout = window.setTimeout(() => reportScreenShare("metadata-timeout", { readyState: video.readyState, videoWidth: video.videoWidth, videoHeight: video.videoHeight, trackReadyState: stream.track.mediaStreamTrack.readyState, trackMuted: stream.track.mediaStreamTrack.muted }), 2_000);
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) play();
    else video.addEventListener("loadedmetadata", play, { once: true });
    return () => {
      stopped = true;
      window.clearTimeout(metadataTimeout);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      video.removeEventListener("loadedmetadata", play);
      video.pause();
      video.srcObject = null;
      context?.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [portalReady, stream]);
  async function toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement === surfaceRef.current) await document.exitFullscreen();
    else await surfaceRef.current?.requestFullscreen();
  }
  return <div ref={surfaceRef} className={cn(SCREEN_SHARE_SURFACE_CLASS_NAME, className)}><video ref={attachVideo} autoPlay playsInline muted className="pointer-events-none absolute size-px opacity-0" /><canvas ref={attachCanvas} aria-label={t.screenShare.canvasAria} className={SCREEN_SHARE_CANVAS_CLASS_NAME} />{fullscreen && fullscreenControls && <div data-testid="fullscreen-voice-controls" className="absolute inset-x-0 bottom-5 z-20 flex justify-center px-4">{fullscreenControls}</div>}<button type="button" aria-label={fullscreen ? t.screenShare.exitFullscreen : t.screenShare.enterFullscreen} onClick={() => void toggleFullscreen()} className={cn("absolute right-3 z-30 rounded-xl bg-black/60 p-2 text-white backdrop-blur transition hover:bg-black/80", fullscreen ? "top-3" : "bottom-3")} >{fullscreen ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}</button></div>;
}

export function ScreenShareViewer({ stream, open, onOpenChange }: { stream?: ScreenShareStream; open: boolean; onOpenChange: (open: boolean) => void }): React.ReactElement {
  const { t } = useI18n();
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-6xl"><DialogHeader><DialogTitle>{stream?.local ? t.screenShare.yourShare : t.screenShare.screenOf(stream?.participantName ?? t.screenShare.participant)}</DialogTitle><DialogDescription>{t.screenShare.adaptiveHint}</DialogDescription></DialogHeader>{stream && <ScreenShareSurface stream={stream} className="h-[68vh] max-h-[68vh]" />}</DialogContent></Dialog>;
}
