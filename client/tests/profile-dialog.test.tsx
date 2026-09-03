import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileDialog } from "@/components/profile-dialog";
import type { LocalProfile } from "@/shared/state";

const profile: LocalProfile = {
  id: "local-user",
  username: "lina",
  discriminator: "1234",
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

  it("saves a length-limited custom status with the chosen emoji", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProfileDialog profile={profile} open onOpenChange={vi.fn()} onSave={onSave} />);

    const input = screen.getByRole("textbox", { name: "Свой статус" });
    await user.type(input, "Работаю над релизом");
    expect(input).toHaveAttribute("maxlength", "32");
    await user.click(screen.getByRole("button", { name: "Открыть панель эмодзи" }));
    await user.click(screen.getByRole("button", { name: "Вставить 😀" }));
    await user.click(screen.getByRole("button", { name: "Сохранить профиль" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ customStatus: "Работаю над релизом", customStatusEmoji: "😀" }));
  });

  it("clears the custom status together with its emoji", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProfileDialog profile={{ ...profile, customStatus: "Раньше", customStatusEmoji: "🚀" }} open onOpenChange={vi.fn()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Очистить свой статус" }));
    await user.click(screen.getByRole("button", { name: "Сохранить профиль" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ customStatus: "", customStatusEmoji: "" }));
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

  it("shows the generated tag and normalizes an edited username", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProfileDialog profile={profile} open onOpenChange={vi.fn()} onSave={onSave} />);

    expect(screen.getByText("lina#1234")).toBeInTheDocument();

    const usernameInput = screen.getByRole("textbox", { name: "Username (id)" });
    await user.clear(usernameInput);
    await user.type(usernameInput, "  LiNa.Dev  ");
    await user.click(screen.getByRole("button", { name: "Сохранить профиль" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ username: "lina.dev" }));
  });

  it("blocks saving an invalid username", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProfileDialog profile={profile} open onOpenChange={vi.fn()} onSave={onSave} />);

    const usernameInput = screen.getByRole("textbox", { name: "Username (id)" });
    await user.clear(usernameInput);
    await user.type(usernameInput, "плохое имя");
    expect(screen.getByRole("button", { name: "Сохранить профиль" })).toBeDisabled();
  });
});

describe("ProfileDialog customization", () => {
  it("saves a preset accent color and previews the tinted card glass", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProfileDialog profile={profile} open onOpenChange={vi.fn()} onSave={onSave} />);

    await user.click(screen.getByRole("radio", { name: "Цвет #7c3aed" }));
    expect(screen.getByTestId("profile-accent-preview")).toHaveStyle({ backgroundColor: "#7c3aed73" });
    await user.click(screen.getByRole("button", { name: "Сохранить профиль" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ accentColor: "#7c3aed" }));
  });

  it("picks a custom color in the saturation and hue picker without alpha", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProfileDialog profile={profile} open onOpenChange={vi.fn()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Свой цвет" }));
    expect(screen.getByTestId("accent-color-popover")).toBeInTheDocument();
    const hexInput = screen.getByLabelText("Свой цвет в HEX");
    fireEvent.change(hexInput, { target: { value: "#123abc" } });
    await user.click(screen.getByRole("button", { name: "Сохранить профиль" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ accentColor: "#123abc" }));
  });

  it("resets the accent color back to the default glass", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProfileDialog profile={{ ...profile, accentColor: "#4d6bfe" }} open onOpenChange={vi.fn()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Сбросить на обычный" }));
    await user.click(screen.getByRole("button", { name: "Сохранить профиль" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ accentColor: null }));
  });

  it("keeps future customization options as disabled placeholders", () => {
    render(<ProfileDialog profile={profile} open onOpenChange={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByText("Декорация аватара")).toBeInTheDocument();
    expect(screen.getAllByText("Скоро")).toHaveLength(1);
  });

  it("saves the nickname font selected in the combobox", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProfileDialog profile={profile} open onOpenChange={vi.fn()} onSave={onSave} />);

    await user.click(screen.getByRole("combobox", { name: "Шрифт ника" }));
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(6);
    expect(options[1]!.querySelector("span")?.getAttribute("style")).toContain("OpenCord Pixel");
    await user.click(options[1]!);
    await user.click(screen.getByRole("button", { name: "Сохранить профиль" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ nameFont: "pixel" }));
  });

  it("restores a saved nickname font", async () => {
    render(<ProfileDialog profile={{ ...profile, nameFont: "mono" }} open onOpenChange={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "Шрифт ника" })).toHaveTextContent("lina");
  });

  it("enables the name glow and saves its color", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProfileDialog profile={profile} open onOpenChange={vi.fn()} onSave={onSave} />);

    expect(onSave).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText("Подсветка ника"));
    const glowPicker = screen.getByTestId("name-glow-picker");
    await user.click(within(glowPicker).getByRole("radio", { name: "Цвет #34d399" }));
    await user.click(screen.getByRole("button", { name: "Сохранить профиль" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ nameGlow: "#34d399" }));
  });

  it("keeps the name glow off while the checkbox is unchecked", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProfileDialog profile={profile} open onOpenChange={vi.fn()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Сохранить профиль" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ nameGlow: null }));
  });

  it("restores a saved name glow with its checkbox and color", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ProfileDialog profile={{ ...profile, nameGlow: "#58b0ff" }} open onOpenChange={vi.fn()} onSave={onSave} />);

    expect(screen.getByLabelText("Подсветка ника")).toBeChecked();
    const glowPicker = screen.getByTestId("name-glow-picker");
    expect(within(glowPicker).getByRole("radio", { name: "Цвет #58b0ff" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByLabelText("Подсветка ника"));
    await user.click(screen.getByRole("button", { name: "Сохранить профиль" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ nameGlow: null }));
  });
});
