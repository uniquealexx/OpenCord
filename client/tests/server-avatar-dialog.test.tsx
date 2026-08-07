import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerAvatarDialog } from "@/components/server-avatar-dialog";
import type { MockServer } from "@/shared/state";

const server: MockServer = {
  id: "server",
  name: "OpenCord",
  avatar: null,
  address: "http://127.0.0.1:3210",
  accent: "#7c5cff",
  maxAttachmentBytes: 10 * 1024 * 1024,
  channels: [],
  members: [],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ServerAvatarDialog crop", () => {
  it("opens the square crop editor before saving a server avatar", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ clearRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["avatar"], { type: "image/webp" })));
    const onSave = vi.fn(() => true);
    render(<ServerAvatarDialog server={server} open onOpenChange={vi.fn()} onSave={onSave} />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    fireEvent.change(input!, { target: { files: [new File(["source"], "server.png", { type: "image/png" })] } });
    expect(screen.getByRole("heading", { name: "Кадрирование аватара сервера" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Применить" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Кадрирование аватара сервера" })).not.toBeInTheDocument());
    fireEvent.submit(screen.getByRole("button", { name: "Сохранить аватар" }).closest("form")!);

    expect(onSave).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/webp;base64,/u));
  });

  it("can crop an already installed server avatar", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 256, height: 256, close: vi.fn() })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ clearRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    render(<ServerAvatarDialog server={{ ...server, avatar: "data:image/webp;base64,AA==" }} open onOpenChange={vi.fn()} onSave={vi.fn(() => true)} />);

    await user.click(screen.getByRole("button", { name: "Кадрировать" }));

    expect(screen.getByRole("heading", { name: "Кадрирование аватара сервера" })).toBeInTheDocument();
  });
});
