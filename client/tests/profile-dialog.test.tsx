import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileDialog } from "@/components/profile-dialog";
import type { LocalProfile } from "@/shared/state";

const profile: LocalProfile = {
  id: "local-user",
  displayName: "Лина",
  bio: "",
  avatar: null,
  banner: null,
  createdAt: "2026-08-07T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ProfileDialog status", () => {
  it("saves the selected status with the local profile", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProfileDialog profile={profile} open onOpenChange={vi.fn()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Не беспокоить" }));
    await user.click(screen.getByRole("button", { name: "Сохранить профиль" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ status: "dnd" }));
  });

  it("explains that invisible is shown as offline", async () => {
    const user = userEvent.setup();
    render(<ProfileDialog profile={profile} open onOpenChange={vi.fn()} onSave={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Невидимка" }));
    expect(screen.getByText("Для остальных участников вы будете отображаться не в сети.")).toBeInTheDocument();
  });

  it("opens the crop editor before saving a selected profile banner", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1_200, height: 800, close })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ clearRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["banner"], { type: "image/webp" })));
    const onSave = vi.fn();
    render(<ProfileDialog profile={profile} open onOpenChange={vi.fn()} onSave={onSave} />);
    const bannerInput = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[0];
    expect(bannerInput).toBeDefined();

    fireEvent.change(bannerInput!, { target: { files: [new File(["source"], "banner.png", { type: "image/png" })] } });
    expect(screen.getByRole("heading", { name: "Кадрирование шапки" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Применить" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Кадрирование шапки" })).not.toBeInTheDocument());
    await waitFor(() => expect(document.querySelector('img[src^="data:image/webp;base64,"]')).not.toBeNull());
    expect(screen.getByRole("button", { name: "Заменить" })).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole("button", { name: "Сохранить профиль" }).closest("form")!);
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ banner: expect.stringMatching(/^data:image\/webp;base64,/u) }));
    expect(close).toHaveBeenCalled();
  });

  it("opens a square crop editor for the user avatar", () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ clearRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    render(<ProfileDialog profile={profile} open onOpenChange={vi.fn()} onSave={vi.fn()} />);
    const avatarInput = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[1];
    expect(avatarInput).toBeDefined();

    fireEvent.change(avatarInput!, { target: { files: [new File(["source"], "avatar.png", { type: "image/png" })] } });

    expect(screen.getByRole("heading", { name: "Кадрирование аватара" })).toBeInTheDocument();
    expect(screen.getByLabelText("Область кадрирования").parentElement).toHaveClass("rounded-full");
  });

  it("can reopen the crop editor for an installed profile banner", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 600, height: 240, close: vi.fn() })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ clearRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    render(<ProfileDialog profile={{ ...profile, banner: "data:image/webp;base64,AA==" }} open onOpenChange={vi.fn()} onSave={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Кадрировать" }));

    expect(screen.getByRole("heading", { name: "Кадрирование шапки" })).toBeInTheDocument();
  });
});
