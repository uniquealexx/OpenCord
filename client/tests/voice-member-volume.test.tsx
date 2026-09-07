import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberList } from "@/components/client-app";
import type { LocalProfile, MockServer } from "@/shared/state";

const profile: LocalProfile = { id: "local-user", username: "lina", discriminator: "1234", bio: "", avatar: null, banner: null, memberBackground: null, createdAt: new Date().toISOString() };

function serverWith(members: MockServer["members"]): MockServer {
  return { id: "test-server", name: "Тестовый сервер", address: "wss://voice.example", accent: "#7c5cff", maxAttachmentBytes: 10 * 1024 * 1024, channels: [], members };
}

const remoteMember = { id: "voice-member", username: "mira", role: "Участник", serverRole: "member" as const, status: "online" as const, avatarColor: "#7c5cff" };

afterEach(() => cleanup());

describe("MemberList voice context menu", () => {
  it("mutes a voice participant for me from the context menu", () => {
    const onParticipantMuted = vi.fn();
    const onParticipantVolume = vi.fn();
    render(<MemberList server={serverWith([remoteMember])} profile={profile} access={{ id: "local-user", role: "member", permissions: [] }} voiceUserIds={["voice-member"]} locallyMutedParticipantIds={[]} participantVolumes={{}} onParticipantMuted={onParticipantMuted} onParticipantVolume={onParticipantVolume} />);
    fireEvent.contextMenu(screen.getByText("mira"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Заглушить у себя: mira" }));
    expect(onParticipantMuted).toHaveBeenCalledWith("voice-member", true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("adjusts a voice participant volume from the context menu", () => {
    const onParticipantMuted = vi.fn();
    const onParticipantVolume = vi.fn();
    render(<MemberList server={serverWith([remoteMember])} profile={profile} access={{ id: "local-user", role: "member", permissions: [] }} voiceUserIds={["voice-member"]} locallyMutedParticipantIds={[]} participantVolumes={{}} onParticipantMuted={onParticipantMuted} onParticipantVolume={onParticipantVolume} />);
    fireEvent.contextMenu(screen.getByText("mira"));
    fireEvent.change(screen.getByRole("slider", { name: "Громкость у себя: mira" }), { target: { value: "50" } });
    expect(onParticipantVolume).toHaveBeenCalledWith("voice-member", 0.5);
  });

  it("marks locally muted voice participants with an icon", () => {
    render(<MemberList server={serverWith([remoteMember])} profile={profile} access={{ id: "local-user", role: "member", permissions: [] }} voiceUserIds={["voice-member"]} locallyMutedParticipantIds={["voice-member"]} participantVolumes={{}} onParticipantMuted={vi.fn()} onParticipantVolume={vi.fn()} />);
    expect(screen.getByLabelText("Заглушён у вас")).toBeInTheDocument();
  });

  it("does not open the voice menu for members outside voice", () => {
    render(<MemberList server={serverWith([remoteMember])} profile={profile} access={{ id: "local-user", role: "member", permissions: [] }} voiceUserIds={[]} locallyMutedParticipantIds={[]} participantVolumes={{}} onParticipantMuted={vi.fn()} onParticipantVolume={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("mira"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
