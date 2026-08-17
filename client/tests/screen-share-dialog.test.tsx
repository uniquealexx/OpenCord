import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCREEN_SHARE_CANVAS_CLASS_NAME, SCREEN_SHARE_SURFACE_CLASS_NAME, ScreenShareDialog, ScreenShareSurface, screenShareResolutionLabel, screenShareSettings } from "@/components/screen-share-dialog";
import type { ScreenShareStream } from "@/hooks/use-voice-session";

describe("ScreenShareDialog", () => {
  const listSources = vi.fn(async () => [{ id: "screen:1:0", name: "Экран 1", kind: "screen" as const, width: 2_560, height: 1_080, thumbnail: "data:image/png;base64,AA==", appIcon: null }]);
  const selectSource = vi.fn(async () => undefined);

  beforeEach(() => {
    listSources.mockClear();
    selectSource.mockClear();
    window.openCord = { screenShare: { listSources, selectSource } } as unknown as Window["openCord"];
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("maps quality controls to LiveKit capture and encoding settings", () => {
    expect(screenShareSettings(1080, 60, true, "motion")).toEqual({ width: 1920, height: 1080, frameRate: 60, maxBitrate: 8_000_000, includeAudio: true, contentHint: "motion" });
    expect(screenShareSettings(1080, 60, true, "motion", 2_560, 1_080)).toEqual({ width: 2_560, height: 1_080, frameRate: 60, maxBitrate: 10_700_000, includeAudio: true, contentHint: "motion" });
    expect(screenShareSettings(720, 30, false, "detail", 2_560, 1_080)).toEqual({ width: 1_706, height: 720, frameRate: 30, maxBitrate: 4_000_000, includeAudio: false, contentHint: "detail" });
    expect(screenShareSettings(1080, 30, false, "detail", 1_280, 720)).toEqual({ width: 1_280, height: 720, frameRate: 30, maxBitrate: 2_300_000, includeAudio: false, contentHint: "detail" });
    expect(screenShareSettings(1440, 60, true, "motion", 2_560, 1_080)).toEqual({ width: 2_560, height: 1_080, frameRate: 60, maxBitrate: 12_000_000, includeAudio: true, contentHint: "motion" });
    expect(screenShareSettings(1440, 60, true, "motion", 3_840, 2_160)).toEqual({ width: 2_560, height: 1_440, frameRate: 60, maxBitrate: 16_000_000, includeAudio: true, contentHint: "motion" });
    expect(screenShareResolutionLabel(1440)).toBe("Source");
  });

  it("scales every received quality to the available surface and fullscreen viewport", () => {
    expect(SCREEN_SHARE_CANVAS_CLASS_NAME.split(" ")).toEqual(expect.arrayContaining(["size-full", "object-contain"]));
    expect(SCREEN_SHARE_CANVAS_CLASS_NAME).not.toContain("max-h-full");
    expect(SCREEN_SHARE_CANVAS_CLASS_NAME).not.toContain("max-w-full");
    expect(SCREEN_SHARE_SURFACE_CLASS_NAME.split(" ")).toEqual(expect.arrayContaining(["fullscreen:h-screen", "fullscreen:w-screen", "fullscreen:max-h-none"]));
  });

  it("shows embedded voice controls only while the share surface is fullscreen", async () => {
    const user = userEvent.setup();
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: vi.fn(async () => {
      fullscreenElement = screen.getByRole("button", { name: "На весь экран" }).parentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
    }) });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: vi.fn(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    }) });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ clearRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    Object.defineProperty(window, "MediaStreamTrackProcessor", { configurable: true, value: class {
      readable = { getReader: () => ({ read: async () => ({ done: true }), cancel: async () => undefined }) };
    } });
    const stream = { local: false, participantIdentity: "member", participantName: "Марина", track: { mediaStreamTrack: { readyState: "live", muted: false, enabled: true, getSettings: () => ({ width: 1920, height: 1080 }) } } } as unknown as ScreenShareStream;

    render(<ScreenShareSurface stream={stream} fullscreenControls={<button type="button">Выключить микрофон</button>} />);

    expect(screen.queryByTestId("fullscreen-voice-controls")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "На весь экран" }));
    expect(screen.getByTestId("fullscreen-voice-controls")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Выключить микрофон" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Выйти из полноэкранного режима" }));
    expect(screen.queryByTestId("fullscreen-voice-controls")).not.toBeInTheDocument();
  });

  it("keeps every received ultrawide pixel in the canvas backing buffer", async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ clearRect: vi.fn(), drawImage } as unknown as CanvasRenderingContext2D);
    const frame = { displayWidth: 2_560, displayHeight: 1_080, codedWidth: 2_560, codedHeight: 1_080, close: vi.fn() };
    let readCount = 0;
    Object.defineProperty(window, "MediaStreamTrackProcessor", { configurable: true, value: class {
      readable = { getReader: () => ({ read: async () => readCount++ === 0 ? { done: false, value: frame } : { done: true }, cancel: async () => undefined }) };
    } });
    const stream = { local: false, participantIdentity: "member", participantName: "Марина", track: { mediaStreamTrack: { readyState: "live", muted: false, enabled: true, getSettings: () => ({ width: 2_560, height: 1_080 }) } } } as unknown as ScreenShareStream;

    render(<ScreenShareSurface stream={stream} />);

    const canvas = screen.getByLabelText("Демонстрация экрана") as HTMLCanvasElement;
    await waitFor(() => expect(drawImage).toHaveBeenCalledWith(frame, 0, 0, 2_560, 1_080));
    expect(canvas).toMatchObject({ width: 2_560, height: 1_080 });
    expect(frame.close).toHaveBeenCalledOnce();
  });

  it("selects an Electron source before starting the stream", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn(async () => undefined);
    render(<ScreenShareDialog open onOpenChange={vi.fn()} onStart={onStart} />);

    await screen.findByText("Экран 1");
    expect(screen.getByText(/Кадр 1706×720/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "1080p" }));
    await user.click(screen.getByRole("button", { name: "60" }));
    await user.click(screen.getByRole("button", { name: "Начать демонстрацию" }));

    await waitFor(() => expect(selectSource).toHaveBeenCalledWith({ sourceId: "screen:1:0", includeAudio: true }));
    expect(onStart).toHaveBeenCalledWith({ width: 2_560, height: 1_080, frameRate: 60, maxBitrate: 10_700_000, includeAudio: true, contentHint: "motion" });
  });

  it("shows an application icon when Windows cannot provide a minimized-window preview", async () => {
    listSources.mockResolvedValueOnce([{ id: "window:2:0", name: "Minimized app", kind: "window", width: 480, height: 270, thumbnail: "data:image/png;base64,AA==", appIcon: null, previewUnavailable: true } as never]);

    render(<ScreenShareDialog open onOpenChange={vi.fn()} onStart={vi.fn(async () => undefined)} />);

    const source = await screen.findByRole("button", { name: "Minimized app" });
    expect(source.querySelector("img")).toBeNull();
    expect(source.querySelector("svg")).not.toBeNull();
  });

  it("hides quality and FPS options above the server limits", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn(async () => undefined);
    render(<ScreenShareDialog open maxResolution={480} maxFrameRate={15} onOpenChange={vi.fn()} onStart={onStart} />);

    await screen.findByText("Экран 1");
    expect(screen.getByRole("button", { name: "480p" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "720p" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "1080p" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "15" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "30" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "60" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Начать демонстрацию" }));

    expect(onStart).toHaveBeenCalledWith({ width: 1_138, height: 480, frameRate: 15, maxBitrate: 1_100_000, includeAudio: true, contentHint: "detail" });
  });

  it("offers source quality when the server allows 2K", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn(async () => undefined);
    render(<ScreenShareDialog open maxResolution={1440} onOpenChange={vi.fn()} onStart={onStart} />);

    await screen.findByText("Экран 1");
    await user.click(screen.getByRole("button", { name: "Источник" }));
    await user.click(screen.getByRole("button", { name: "60" }));
    expect(screen.getByText(/Кадр 2560×1080/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Начать демонстрацию" }));

    expect(onStart).toHaveBeenCalledWith({ width: 2_560, height: 1_080, frameRate: 60, maxBitrate: 12_000_000, includeAudio: true, contentHint: "motion" });
  });
});
