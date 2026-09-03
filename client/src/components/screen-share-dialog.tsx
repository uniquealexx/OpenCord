"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Image from "next/image";
import {
  DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE,
  DEFAULT_SCREEN_SHARE_MAX_RESOLUTION,
  SCREEN_SHARE_FRAME_RATES,
  SCREEN_SHARE_RESOLUTIONS,
  type ScreenShareFrameRate,
  type ScreenShareResolution,
} from "@opencord/shared";
import {
  Check,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MonitorUp,
  ScreenShare,
  Square,
  Volume2,
} from "lucide-react";
import type {
  ScreenShareSettings,
  ScreenShareStream,
} from "@/hooks/use-voice-session";
import type { ScreenShareSource } from "@/shared/screen-share";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { currentDictionary, useI18n, type Dictionary } from "@/lib/i18n";

const resolutions: Record<
  ScreenShareResolution,
  { width: number; height: number }
> = {
  480: { width: 854, height: 480 },
  720: { width: 1280, height: 720 },
  1080: { width: 1920, height: 1080 },
  1440: { width: 2560, height: 1440 },
};

const bitrates: Record<
  ScreenShareResolution,
  Record<ScreenShareFrameRate, number>
> = {
  480: { 15: 800_000, 30: 1_500_000, 60: 2_500_000 },
  720: { 15: 1_500_000, 30: 3_000_000, 60: 5_000_000 },
  1080: { 15: 2_500_000, 30: 5_000_000, 60: 8_000_000 },
  1440: { 15: 5_000_000, 30: 10_000_000, 60: 16_000_000 },
};

export function screenShareResolutionLabel(
  resolution: ScreenShareResolution,
  t?: Dictionary,
): string {
  return resolution === 1440
    ? (t ?? currentDictionary()).screenShare.source
    : `${resolution}p`;
}

export const SCREEN_SHARE_SURFACE_CLASS_NAME =
  "relative grid min-h-0 w-full place-items-center overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl fullscreen:h-screen fullscreen:w-screen fullscreen:max-h-none fullscreen:rounded-none fullscreen:border-0";
export const SCREEN_SHARE_CANVAS_CLASS_NAME =
  "block size-full min-h-0 min-w-0 bg-black object-contain";

function reportScreenShare(
  stage: string,
  details: Record<string, unknown>,
): void {
  void window.openCord?.screenShare?.report?.(
    `${stage} ${JSON.stringify(details)}`,
  );
}

export function screenShareSettings(
  resolution: ScreenShareResolution,
  frameRate: ScreenShareFrameRate,
  includeAudio: boolean,
  contentHint: "detail" | "motion",
  sourceWidth = resolutions[resolution].width,
  sourceHeight = resolutions[resolution].height,
): ScreenShareSettings {
  const safeWidth = Math.max(1, sourceWidth);
  const safeHeight = Math.max(1, sourceHeight);
  const sourceScale =
    resolution === 1440
      ? Math.min(
          1,
          resolutions[1440].width / safeWidth,
          resolutions[1440].height / safeHeight,
        )
      : Math.min(1, resolution / safeHeight);
  const width = Math.max(2, Math.round((safeWidth * sourceScale) / 2) * 2);
  const height = Math.max(2, Math.round((safeHeight * sourceScale) / 2) * 2);
  const baselinePixels =
    resolutions[resolution].width * resolutions[resolution].height;
  const actualPixels = width * height;
  const scaledBitrate =
    Math.ceil(
      (bitrates[resolution][frameRate] * actualPixels) /
        baselinePixels /
        100_000,
    ) * 100_000;
  return {
    width,
    height,
    frameRate,
    maxBitrate: Math.min(20_000_000, scaledBitrate),
    includeAudio,
    contentHint,
  };
}

export function ScreenShareDialog({
  open,
  maxResolution = DEFAULT_SCREEN_SHARE_MAX_RESOLUTION,
  maxFrameRate = DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE,
  onOpenChange,
  onStart,
}: {
  open: boolean;
  maxResolution?: ScreenShareResolution;
  maxFrameRate?: ScreenShareFrameRate;
  onOpenChange: (open: boolean) => void;
  onStart: (settings: ScreenShareSettings) => Promise<void>;
}): React.ReactElement {
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
  const availableResolutions = SCREEN_SHARE_RESOLUTIONS.filter(
    (value) => value <= maxResolution,
  );
  const availableFrameRates = SCREEN_SHARE_FRAME_RATES.filter(
    (value) => value <= maxFrameRate,
  );
  const selectedResolution =
    resolution > maxResolution ? maxResolution : resolution;
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
        setSelectedId((current) =>
          nextSources.some((source) => source.id === current)
            ? current
            : (nextSources[0]?.id ?? null),
        );
      } catch (reason) {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : currentDictionary().screenShare.listFailed,
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const selected = useMemo(
    () => sources.find((source) => source.id === selectedId),
    [selectedId, sources],
  );
  const selectedSettings = screenShareSettings(
    selectedResolution,
    selectedFrameRate,
    includeAudio,
    contentHint,
    selected?.width,
    selected?.height,
  );
  async function start(): Promise<void> {
    const bridge = window.openCord?.screenShare;
    if (!bridge || !selected) return;
    setStarting(true);
    setError("");
    try {
      await bridge.selectSource({ sourceId: selected.id, includeAudio });
      await onStart(selectedSettings);
      onOpenChange(false);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t.screenShare.startFailed,
      );
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-hidden border-white/[.08] bg-canvas p-0 shadow-[0_24px_70px_rgba(0,0,0,.52)] sm:max-w-6xl [&>div:first-of-type]:max-h-none [&>div:first-of-type]:overflow-hidden">
        <DialogHeader className="mb-3 pr-10 text-left">
          <DialogTitle className="text-sm font-semibold tracking-tight text-slate-200">
            {t.screenShare.title}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="grid min-h-[500px] place-items-center text-sm text-slate-500">
            <div className="grid justify-items-center gap-3"><span className="grid size-12 place-items-center rounded-2xl bg-violet-400/10"><LoaderCircle className="size-6 animate-spin text-violet-300" /></span>{t.screenShare.loadingSources}</div>
          </div>
        ) : (
          <div className="grid min-h-0 lg:h-[500px] lg:grid-cols-[minmax(0,1fr)_260px]">
            <section className="min-w-0 overflow-hidden px-6 py-4 sm:px-7">
              <div className="mb-3 flex items-center justify-between gap-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">
                  {t.screenShare.chooseWhat}
                </h3>
                <span className="rounded-full border border-white/[.06] bg-white/[.025] px-2.5 py-1 text-[10px] text-slate-500">
                  {t.screenShare.sourcesCount(sources.length)}
                </span>
              </div>
              <div className="scrollbar-thin grid max-h-[430px] grid-cols-2 gap-3 overflow-y-auto pr-2 sm:grid-cols-3 lg:max-h-[440px]">
                {sources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => setSelectedId(source.id)}
                    aria-pressed={selectedId === source.id}
                    className={cn(
                      "group relative overflow-hidden rounded-2xl border bg-rail p-1.5 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60",
                      selectedId === source.id
                        ? "border-violet-400/60 bg-violet-400/[.08] ring-1 ring-violet-400/25"
                        : "border-white/[.07] hover:border-white/20 hover:bg-white/[.025]",
                    )}
                  >
                    <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
                      {source.previewUnavailable ? (
                        <div className="grid size-full place-items-center bg-panel">
                          {source.appIcon ? (
                            <Image
                              unoptimized
                              width={48}
                              height={48}
                              src={source.appIcon}
                              alt=""
                              className="size-12 rounded-xl object-contain opacity-90"
                            />
                          ) : (
                            <Square className="size-10 text-slate-600" />
                          )}
                        </div>
                      ) : (
                        <Image
                          unoptimized
                          fill
                          sizes="240px"
                          src={source.thumbnail}
                          alt=""
                          className="object-cover"
                        />
                      )}
                      {selectedId === source.id && <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-white ring-2 ring-black/35"><Check className="size-3.5 stroke-[3]" /></span>}
                    </div>
                    <div className="flex h-10 items-center gap-2 px-1.5">
                      {source.appIcon ? (
                        <Image
                          unoptimized
                          width={16}
                          height={16}
                          src={source.appIcon}
                          alt=""
                          className="size-4 rounded-sm"
                        />
                      ) : source.kind === "screen" ? (
                        <MonitorUp className="size-4 shrink-0 text-cyan-300" />
                      ) : (
                        <Square className="size-4 shrink-0 text-violet-300" />
                      )}
                      <span className={cn("min-w-0 truncate text-[11px] font-semibold", selectedId === source.id ? "text-slate-100" : "text-slate-400 group-hover:text-slate-200")}>
                        {source.name}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              {!sources.length && !error && (
                <p className="rounded-2xl border border-dashed border-white/10 bg-black/10 p-8 text-center text-sm text-slate-500">
                  {t.screenShare.noSources}
                </p>
              )}
            </section>
            <aside className="space-y-4 border-t border-white/[.06] bg-sidebar p-5 lg:border-l lg:border-t-0">
              <OptionGroup
                label={t.screenShare.quality}
                values={availableResolutions}
                value={selectedResolution}
                format={(value) =>
                  screenShareResolutionLabel(value as ScreenShareResolution, t)
                }
                onChange={(value) =>
                  setResolution(value as ScreenShareResolution)
                }
              />
              <OptionGroup
                label={t.screenShare.fps}
                values={availableFrameRates}
                value={selectedFrameRate}
                format={String}
                onChange={(value) => {
                  const next = value as ScreenShareFrameRate;
                  setFrameRate(next);
                  if (next === 60) setContentHint("motion");
                }}
              />
              <div className="border-t border-white/[.06] pt-4">
                <p className="mb-2.5 text-[11px] font-semibold text-slate-400">
                  {t.screenShare.content}
                </p>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/20 p-1">
                  <button
                    type="button"
                    onClick={() => setContentHint("detail")}
                    className={cn(
                      "rounded-lg px-2 py-2.5 text-[11px] font-semibold transition",
                      contentHint === "detail"
                        ? "bg-primary text-white"
                        : "text-slate-500 hover:bg-white/[.035] hover:text-slate-300",
                    )}
                  >
                    {t.screenShare.text}
                  </button>
                  <button
                    type="button"
                    onClick={() => setContentHint("motion")}
                    className={cn(
                      "rounded-lg px-2 py-2.5 text-[11px] font-semibold transition",
                      contentHint === "motion"
                        ? "bg-primary text-white"
                        : "text-slate-500 hover:bg-white/[.035] hover:text-slate-300",
                    )}
                  >
                    {t.screenShare.motion}
                  </button>
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.025] p-3 text-xs text-slate-300 transition hover:border-white/15 hover:bg-white/[.04]">
                <input
                  type="checkbox"
                  checked={includeAudio}
                  onChange={(event) => setIncludeAudio(event.target.checked)}
                  className="size-4 rounded accent-violet-500"
                />
                <span className="grid size-7 place-items-center rounded-lg bg-cyan-400/10"><Volume2 className="size-3.5 text-cyan-300" /></span>
                <span className="font-medium">{t.screenShare.systemAudio}</span>
              </label>
              <p className="truncate px-1 text-[10px] text-slate-600" title={`${t.screenShare.frame(selectedSettings.width, selectedSettings.height)} · ${t.screenShare.bitrate((selectedSettings.maxBitrate / 1_000_000).toFixed(1))}`}>
                {t.screenShare.frame(selectedSettings.width, selectedSettings.height)} · {t.screenShare.bitrate((selectedSettings.maxBitrate / 1_000_000).toFixed(1))}
              </p>
            </aside>
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="mx-6 mb-4 rounded-xl border border-red-400/20 bg-red-400/[.07] px-4 py-3 text-xs text-red-200 sm:mx-7"
          >
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-white/[.06] bg-canvas px-6 py-3 sm:px-7">
          <Button variant="secondary" onClick={() => onOpenChange(false)} className="min-w-24 border-white/[.08] bg-white/[.035]">
            {t.screenShare.cancel}
          </Button>
          <Button
            onClick={() => void start()}
            disabled={!selected || loading || starting}
            className="min-w-52 bg-primary hover:bg-violet-400"
          >
            {starting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ScreenShare className="size-4" />
            )}
            {t.screenShare.start}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OptionGroup({
  label,
  values,
  value,
  format,
  onChange,
}: {
  label: string;
  values: readonly number[];
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}): React.ReactElement {
  return (
    <div>
      <p className="mb-2.5 text-[11px] font-semibold text-slate-400">{label}</p>
      <div
        className="grid gap-1 rounded-xl bg-black/20 p-1"
        style={{
          gridTemplateColumns: `repeat(${values.length === 4 ? 2 : values.length}, minmax(0, 1fr))`,
        }}
      >
        {values.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={cn(
              "rounded-lg px-2 py-2.5 text-[11px] font-medium transition",
              value === option
                ? "bg-primary text-white"
                : "text-slate-500 hover:bg-white/[.035] hover:text-slate-300",
            )}
          >
            {format(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ScreenShareSurface({
  stream,
  className,
  fullscreenControls,
}: {
  stream: ScreenShareStream;
  className?: string;
  fullscreenControls?: ReactNode;
}): React.ReactElement {
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
    const handleFullscreenChange = (): void =>
      setFullscreen(document.fullscreenElement === surfaceRef.current);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!stream || !video || !canvas) return;
    const context = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
    const Processor = (
      window as unknown as {
        MediaStreamTrackProcessor?: new (options: {
          track: MediaStreamTrack;
        }) => { readable: ReadableStream<VideoFrame> };
      }
    ).MediaStreamTrackProcessor;
    reportScreenShare("viewer-track", {
      local: stream.local,
      readyState: stream.track.mediaStreamTrack.readyState,
      muted: stream.track.mediaStreamTrack.muted,
      enabled: stream.track.mediaStreamTrack.enabled,
      settings: stream.track.mediaStreamTrack.getSettings(),
      processorAvailable: Boolean(Processor),
    });
    if (context && Processor) {
      const reader = new Processor({
        track: stream.track.mediaStreamTrack,
      }).readable.getReader();
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
            if (canvas.width !== width || canvas.height !== height) {
              canvas.width = width;
              canvas.height = height;
            }
            context.drawImage(frame, 0, 0, width, height);
            if (!firstFrameLogged) {
              firstFrameLogged = true;
              reportScreenShare("processor-first-frame", {
                canvasWidth: width,
                canvasHeight: height,
              });
            }
          } finally {
            frame.close();
          }
        }
      })().catch((error: unknown) => {
        if (!stopped)
          console.warn("Screen share frame processor failed", error);
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
      if (
        context &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        context.drawImage(video, 0, 0, width, height);
        if (!firstFrameLogged) {
          firstFrameLogged = true;
          const sample = context.getImageData(
            Math.max(0, Math.floor(width / 2) - 8),
            Math.max(0, Math.floor(height / 2) - 8),
            Math.min(16, width),
            Math.min(16, height),
          ).data;
          let brightness = 0;
          for (let index = 0; index < sample.length; index += 4)
            brightness +=
              (sample[index] ?? 0) +
              (sample[index + 1] ?? 0) +
              (sample[index + 2] ?? 0);
          reportScreenShare("first-frame", {
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            canvasWidth: width,
            canvasHeight: height,
            averageBrightness: brightness / (sample.length / 4) / 3,
          });
        }
      }
      animationFrame = window.requestAnimationFrame(drawFrame);
    };
    const play = (): void => {
      void video
        .play()
        .then(() => {
          reportScreenShare("playback-started", {
            readyState: video.readyState,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
          });
          if (!animationFrame)
            animationFrame = window.requestAnimationFrame(drawFrame);
        })
        .catch((error: unknown) =>
          console.warn("Screen share preview playback failed", error),
        );
    };
    video.muted = true;
    video.volume = 0;
    video.srcObject = mediaStream;
    const metadataTimeout = window.setTimeout(
      () =>
        reportScreenShare("metadata-timeout", {
          readyState: video.readyState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          trackReadyState: stream.track.mediaStreamTrack.readyState,
          trackMuted: stream.track.mediaStreamTrack.muted,
        }),
      2_000,
    );
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
    if (document.fullscreenElement === surfaceRef.current)
      await document.exitFullscreen();
    else await surfaceRef.current?.requestFullscreen();
  }
  return (
    <div
      ref={surfaceRef}
      className={cn(SCREEN_SHARE_SURFACE_CLASS_NAME, className)}
    >
      <video
        ref={attachVideo}
        autoPlay
        playsInline
        muted
        className="pointer-events-none absolute size-px opacity-0"
      />
      <canvas
        ref={attachCanvas}
        aria-label={t.screenShare.canvasAria}
        className={SCREEN_SHARE_CANVAS_CLASS_NAME}
      />
      {fullscreen && fullscreenControls && (
        <div
          data-testid="fullscreen-voice-controls"
          className="absolute inset-x-0 bottom-5 z-20 flex justify-center px-4"
        >
          {fullscreenControls}
        </div>
      )}
      <button
        type="button"
        aria-label={
          fullscreen
            ? t.screenShare.exitFullscreen
            : t.screenShare.enterFullscreen
        }
        onClick={() => void toggleFullscreen()}
        className={cn(
          "absolute right-3 z-30 rounded-xl bg-black/60 p-2 text-white backdrop-blur transition hover:bg-black/80",
          fullscreen ? "top-3" : "bottom-3",
        )}
      >
        {fullscreen ? (
          <Minimize2 className="size-5" />
        ) : (
          <Maximize2 className="size-5" />
        )}
      </button>
    </div>
  );
}

export function ScreenShareViewer({
  stream,
  open,
  onOpenChange,
}: {
  stream?: ScreenShareStream;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>
            {stream?.local
              ? t.screenShare.yourShare
              : t.screenShare.screenOf(
                  stream?.participantName ?? t.screenShare.participant,
                )}
          </DialogTitle>
          <DialogDescription>{t.screenShare.adaptiveHint}</DialogDescription>
        </DialogHeader>
        {stream && (
          <ScreenShareSurface
            stream={stream}
            className="h-[68vh] max-h-[68vh]"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
