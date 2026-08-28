import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientApp } from "@/components/client-app";
import { createDefaultState, type PersistedClientState } from "@/shared/state";

const { voiceLeave } = vi.hoisted(() => ({ voiceLeave: vi.fn(async () => undefined) }));

vi.mock("@/hooks/use-voice-session", () => ({
  useVoiceSession: () => ({
    status: "connected" as const,
    channelId: "voice",
    muted: false,
    deafened: false,
    activeSpeakerIds: [] as string[],
    screenShares: [] as never[],
    isScreenSharing: false,
    locallyMutedParticipantIds: [] as string[],
    participantVolumes: {} as Record<string, number>,
    setMuted: vi.fn(),
    setDeafened: vi.fn(),
    setParticipantMuted: vi.fn(),
    setParticipantVolume: vi.fn(),
    startScreenShare: vi.fn(),
    stopScreenShare: vi.fn(),
    leave: voiceLeave,
  }),
}));

function stateWithTwoServers(): PersistedClientState {
  const state: PersistedClientState = {
    ...createDefaultState(),
    onboardingComplete: true,
    profile: { id: "local-user", username: "lina", discriminator: "1234", bio: "", avatar: null, banner: null, createdAt: new Date().toISOString() },
  };
  state.servers = [
    {
      id: "first-server",
      name: "Первый сервер",
      address: null,
      accent: "#4d6bfe",
      maxAttachmentBytes: 10 * 1024 * 1024,
      channels: [
        { id: "general", serverId: "first-server", name: "общий", kind: "text", description: "", participantLimit: null },
        { id: "voice", serverId: "first-server", name: "Гостиная", kind: "voice", description: "", participantLimit: 25 },
      ],
      members: [],
    },
    {
      id: "second-server",
      name: "Второй сервер",
      address: null,
      accent: "#4d6bfe",
      maxAttachmentBytes: 10 * 1024 * 1024,
      channels: [
        { id: "second-general", serverId: "second-server", name: "главный", kind: "text", description: "", participantLimit: null },
      ],
      members: [],
    },
  ];
  state.activeServerId = "first-server";
  state.activeChannelId = "general";
  return state;
}

describe("voice session on server switch", () => {
  beforeEach(() => {
    voiceLeave.mockClear();
    window.openCord = {
      storage: { load: vi.fn(async () => stateWithTwoServers()), save: vi.fn(async () => undefined), reset: vi.fn(async () => createDefaultState()) },
      attachments: { selectAndUpload: vi.fn(async () => null), uploadFile: vi.fn(async () => { throw new Error("uploadFile не ожидается в этом тесте"); }), download: vi.fn(async () => true), preview: vi.fn(async () => "data:image/png;base64,AA=="), setLatencySensitive: vi.fn(async () => undefined) },
    } as unknown as NonNullable<typeof window.openCord>;
  });

  afterEach(() => { cleanup(); });

  it("leaves the voice session and hides the voice panel when switching servers", async () => {
    const user = userEvent.setup();
    render(<ClientApp />);
    await screen.findByText("Первый сервер");
    expect(screen.getByRole("button", { name: "Выйти из голосового канала" })).toBeInTheDocument();

    await user.click(screen.getByTitle("Второй сервер"));
    await waitFor(() => expect(voiceLeave).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "Выйти из голосового канала" })).not.toBeInTheDocument();
  });
});
