import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCREEN_SHARE_CANVAS_CLASS_NAME, SCREEN_SHARE_SURFACE_CLASS_NAME, ScreenShareDialog, ScreenShareSurface, screenShareSettings } from "@/components/screen-share-dialog";
import type { ScreenShareStream } from "@/hooks/use-voice-session";

describe("ScreenShareDialog", () => {
  const listSources = vi.fn(async () => [{ id: "screen:1:0", name: "Экран 1", kind: "screen" as const, thumbnail: "data:image/png;base64,AA==", appIcon: null }]);
  const selectSource = vi.fn(async () => undefined);

  beforeEach(() => {
    listSources.mockClear();
    selectSource.mockClear();
    window.openCord = { screenShare: { listSources, selectSource } } as unknown as Window["openCord"];
  });

  afterEach(cleanup);

  it("maps quality controls to LiveKit capture and encoding settings", () => {
    expect(screenShareSettings(1080, 60, true, "motion")).toEqual({ width: 1920, height: 1080, frameRate: 60, maxBitrate: 8_000_000, includeAudio: true, contentHint: "motion" });
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

  it("selects an Electron source before starting the stream", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn(async () => undefined);
    render(<ScreenShareDialog open onOpenChange={vi.fn()} onStart={onStart} />);

    await screen.findByText("Экран 1");
    await user.click(screen.getByRole("button", { name: "1080p" }));
    await user.click(screen.getByRole("button", { name: "60" }));
    await user.click(screen.getByRole("button", { name: "Начать демонстрацию" }));

    await waitFor(() => expect(selectSource).toHaveBeenCalledWith({ sourceId: "screen:1:0", includeAudio: true }));
    expect(onStart).toHaveBeenCalledWith({ width: 1920, height: 1080, frameRate: 60, maxBitrate: 8_000_000, includeAudio: true, contentHint: "motion" });
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

    expect(onStart).toHaveBeenCalledWith({ width: 854, height: 480, frameRate: 15, maxBitrate: 800_000, includeAudio: true, contentHint: "detail" });
  });
});
