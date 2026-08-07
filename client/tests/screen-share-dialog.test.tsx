import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenShareDialog, screenShareSettings } from "@/components/screen-share-dialog";

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
