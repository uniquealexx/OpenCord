import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientApp } from "@/components/client-app";
import { createDefaultState, type PersistedClientState } from "@/shared/state";

function readyState(): PersistedClientState {
  return {
    ...createDefaultState(),
    onboardingComplete: true,
    profile: { id: "local-user", displayName: "Лина", bio: "", avatar: null, createdAt: new Date().toISOString() },
  };
}

describe("ClientApp", () => {
  const save = vi.fn(async (state: PersistedClientState) => state);

  beforeEach(() => {
    save.mockClear();
    window.openCord = {
      window: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), isMaximized: vi.fn(), onMaximizedChange: vi.fn(() => () => undefined) },
      storage: { load: vi.fn(async () => readyState()), save, reset: vi.fn(async () => createDefaultState()) },
      identity: { getOrCreate: vi.fn(async () => ({ publicKey: "test-public-key", fingerprint: "test" })), signChallenge: vi.fn(async () => "test-signature"), reset: vi.fn(async () => ({ publicKey: "new-test-public-key", fingerprint: "new-test" })) },
    };
  });

  it("switches channels and sends a local message", async () => {
    const user = userEvent.setup();
    render(<ClientApp />);
    await screen.findByText("Открытое пространство");
    await user.click(screen.getByRole("button", { name: /общий/i }));
    const composer = screen.getByLabelText(/написать в #общий/i);
    await user.type(composer, "Привет, OpenCord!");
    await user.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByText("Привет, OpenCord!")).toBeInTheDocument();
    expect(save).toHaveBeenCalled();
  });
});
