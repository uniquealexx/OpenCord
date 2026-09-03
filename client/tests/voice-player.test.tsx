import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoicePlayer, isVoiceMessage } from "@/components/voice-player";

const play = vi.fn(async () => undefined);
const pause = vi.fn();

function stubMedia(): void {
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: pause });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  play.mockClear();
  pause.mockClear();
});

describe("isVoiceMessage", () => {
  it("accepts recorder output and rejects plain audio files", () => {
    expect(isVoiceMessage({ fileName: "voice-message-20260102-030405.webm", mimeType: "audio/webm" })).toBe(true);
    expect(isVoiceMessage({ fileName: "voice-message-20260102-030405.ogg", mimeType: "audio/ogg" })).toBe(true);
    expect(isVoiceMessage({ fileName: "voice-message-20260102-030405.m4a", mimeType: "audio/mp4" })).toBe(true);
    expect(isVoiceMessage({ fileName: "song.mp3", mimeType: "audio/mpeg" })).toBe(false);
    expect(isVoiceMessage({ fileName: "voice-message-20260102-030405.mp3", mimeType: "audio/mpeg" })).toBe(true);
    expect(isVoiceMessage({ fileName: "voice-message-20260102-030405.webm", mimeType: "video/webm" })).toBe(false);
    expect(isVoiceMessage({ fileName: "voice-message-note.webm", mimeType: "audio/webm" })).toBe(false);
    expect(isVoiceMessage({ fileName: "voice-message-20260102-030405.webm", mimeType: "application/octet-stream" })).toBe(false);
  });
});

describe("VoicePlayer", () => {
  it("toggles playback and shows elapsed time", async () => {
    stubMedia();
    render(<VoicePlayer src="blob:voice" label="Голосовое" durationHint={42} />);

    const button = screen.getByRole("button", { name: /Слушать голосовое/u });
    expect(screen.getByText("0:00 / 0:42")).toBeInTheDocument();

    fireEvent.click(button);
    await screen.findByRole("button", { name: /Пауза/u });
    expect(play).toHaveBeenCalledOnce();

    const audio = document.querySelector("audio") as HTMLAudioElement;
    fireEvent.timeUpdate(audio, { target: { currentTime: 7 } });
    expect(screen.getByText("0:07 / 0:42")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Пауза/u }));
    expect(pause).toHaveBeenCalledOnce();
  });

  it("seeks by clicking the progress bar", () => {
    stubMedia();
    render(<VoicePlayer src="blob:voice" label="Голосовое" durationHint={40} />);

    const slider = screen.getByRole("slider", { name: "Голосовое" });
    slider.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, right: 300, bottom: 0, height: 0, x: 100, y: 0, toJSON: () => ({}) });
    fireEvent.click(slider, { clientX: 200 });

    const audio = document.querySelector("audio") as HTMLAudioElement;
    expect(audio.currentTime).toBe(20);
  });

  it("reports load errors through onError", () => {
    stubMedia();
    const onError = vi.fn();
    render(<VoicePlayer src="blob:broken" label="Голосовое" onError={onError} />);

    fireEvent.error(document.querySelector("audio") as HTMLAudioElement);
    expect(onError).toHaveBeenCalledOnce();
  });
});
