import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canMoveVoiceParticipant, ChannelSidebar, VoiceParticipantRow } from "@/components/client-app";
import { I18nRoot } from "@/lib/i18n";
import { createDefaultState, type MockChannel, type PersistedClientState } from "@/shared/state";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function readyState(): PersistedClientState {
  const state: PersistedClientState = {
    ...createDefaultState(),
    onboardingComplete: true,
    profile: { id: "local-user", username: "lina", discriminator: "1234", bio: "", avatar: null, banner: null, memberBackground: null, createdAt: new Date().toISOString() },
  };
  const voiceA: MockChannel = { id: "11111111-1111-4111-8111-111111111111", serverId: "test-server", name: "Гостиная", kind: "voice", description: "", participantLimit: 25, slowmodeSeconds: 0 };
  const voiceB: MockChannel = { id: "22222222-2222-4222-8222-222222222222", serverId: "test-server", name: "Вторая", kind: "voice", description: "", participantLimit: 25, slowmodeSeconds: 0 };
  state.servers = [{
    id: "test-server",
    name: "Тестовый сервер",
    address: null,
    accent: "#7c5cff",
    maxAttachmentBytes: 10 * 1024 * 1024,
    channels: [
      { id: "welcome", serverId: "test-server", name: "добро-пожаловать", kind: "text", description: "Начните знакомство", participantLimit: null, slowmodeSeconds: 0 },
      voiceA,
      voiceB,
    ],
    members: [{ id: "member-1", username: "member", discriminator: "0001", role: "Участник", serverRole: "member", status: "online", avatarColor: "#4d6bfe" }],
  }];
  state.activeServerId = "test-server";
  state.activeChannelId = "welcome";
  return state;
}

describe("canMoveVoiceParticipant", () => {
  it("mirrors the disconnect hierarchy: owner moves anyone, admin moves members only", () => {
    expect(canMoveVoiceParticipant(true, "owner", "administrator", "owner", "admin")).toBe(true);
    expect(canMoveVoiceParticipant(true, "owner", "member", "owner", "member")).toBe(true);
    expect(canMoveVoiceParticipant(true, "administrator", "member", "admin", "member")).toBe(true);
    expect(canMoveVoiceParticipant(true, "administrator", "administrator", "admin", "other-admin")).toBe(false);
    expect(canMoveVoiceParticipant(true, "owner", "owner", "owner", "other-owner")).toBe(false);
    expect(canMoveVoiceParticipant(true, "administrator", "member", "admin", "admin")).toBe(false);
    expect(canMoveVoiceParticipant(false, "owner", "member", "owner", "member")).toBe(false);
    expect(canMoveVoiceParticipant(true, "owner", undefined, "owner", "member")).toBe(false);
    expect(canMoveVoiceParticipant(true, undefined, "member", "owner", "member")).toBe(false);
  });
});

describe("voice move drag and drop", () => {
  it("makes the row draggable only with the permission and drops with the right ids", () => {
    const state = readyState();
    const server = state.servers[0]!;
    const first = server.channels.find((channel) => channel.kind === "voice")!;
    const onMoveParticipant = vi.fn();
    render(
      <I18nRoot>
        <ChannelSidebar
          server={server}
          profile={state.profile!}
          canManageChannels={false}
          voiceParticipants={[{ userId: "member-1", channelId: first.id, muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null }]}
          currentUserId="owner-1"
          canMoveVoice
          currentUserRole="owner"
          onCreateChannel={vi.fn()}
          onEditChannel={vi.fn()}
          onDeleteChannel={vi.fn()}
          onSelectChannel={vi.fn()}
          onServerMenu={vi.fn()}
          onProfile={vi.fn()}
          onSettings={vi.fn()}
          onMoveParticipant={onMoveParticipant}
        />
      </I18nRoot>,
    );
    const row = screen.getByTitle("Drag to another voice channel to move");
    expect(row.getAttribute("draggable")).toBe("true");
    const data = new Map<string, string>();
    const dataTransfer = { setData: vi.fn((format: string, value: string) => { data.set(format, value); }), getData: vi.fn((format: string) => data.get(format) ?? ""), types: ["application/x-opencord-voice-user"], dropEffect: "", effectAllowed: "" };
    fireEvent.dragStart(row, { dataTransfer } as unknown as Event);
    expect(dataTransfer.setData).toHaveBeenCalledWith("application/x-opencord-voice-user", "member-1");
  });

  it("does not make the row draggable without the move permission", () => {
    const state = readyState();
    const server = state.servers[0]!;
    const voice = server.channels.find((channel) => channel.kind === "voice")!;
    render(
      <I18nRoot>
        <ChannelSidebar
          server={server}
          profile={state.profile!}
          canManageChannels={false}
          voiceParticipants={[{ userId: "member-1", channelId: voice.id, muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null }]}
          currentUserId="member-2"
          canMoveVoice={false}
          currentUserRole="member"
          onCreateChannel={vi.fn()}
          onEditChannel={vi.fn()}
          onDeleteChannel={vi.fn()}
          onSelectChannel={vi.fn()}
          onServerMenu={vi.fn()}
          onProfile={vi.fn()}
          onSettings={vi.fn()}
        />
      </I18nRoot>,
    );
    expect(screen.queryByTitle("Drag to another voice channel to move")).not.toBeInTheDocument();
  });

  it("renders VoiceParticipantRow without dragging by default", () => {
    const state = readyState();
    const voice = state.servers[0]!.channels.find((channel) => channel.kind === "voice")!;
    const { container } = render(
      <I18nRoot>
        <VoiceParticipantRow
          participant={{ userId: "member-1", channelId: voice.id, muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null }}
          profile={state.profile!}
          currentUserId="owner-1"
          speaking={false}
        />
      </I18nRoot>,
    );
    expect(container.querySelector("[draggable='true']")).toBeNull();
  });
});
