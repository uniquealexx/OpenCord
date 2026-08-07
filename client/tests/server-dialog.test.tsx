import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerDialog } from "@/components/server-dialog";
import type { ServerProbeResult } from "@/shared/server-probe";

describe("ServerDialog", () => {
  const probe = vi.fn(async (): Promise<ServerProbeResult> => ({ ok: true, health: {} as never }));

  beforeEach(() => {
    probe.mockClear();
    window.openCord = { server: { probe } } as unknown as NonNullable<typeof window.openCord>;
  });

  afterEach(() => { cleanup(); delete window.openCord; });

  it("keeps the dialog open when the normalized address is already present", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn(() => false);
    render(<ServerDialog open onOpenChange={vi.fn()} onAdd={onAdd} />);
    await user.type(screen.getByLabelText("Адрес сервера"), "http://127.0.0.1:3210/");
    await user.click(screen.getByRole("button", { name: "Подключиться к серверу" }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(await screen.findByText("Этот адрес уже добавлен в клиент.")).toBeInTheDocument();
  });

  it("requires explicit confirmation before connecting to an insecure remote HTTP server", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn(() => true);
    render(<ServerDialog open onOpenChange={vi.fn()} onAdd={onAdd} />);

    await user.type(screen.getByLabelText("Адрес сервера"), "http://203.0.113.42:3210");
    const submit = screen.getByRole("button", { name: "Подключиться к серверу" });
    expect(screen.getByText("Подключение без TLS небезопасно")).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.click(screen.getByLabelText("Я доверяю этой сети и понимаю риск подключения без HTTPS"));
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ address: "http://203.0.113.42:3210" }));
  });

  it("does not add a server when its health endpoint is unavailable", async () => {
    const user = userEvent.setup();
    probe.mockResolvedValueOnce({ ok: false, code: "unavailable" });
    const onAdd = vi.fn(() => true);
    render(<ServerDialog open onOpenChange={vi.fn()} onAdd={onAdd} />);

    await user.type(screen.getByLabelText("Адрес сервера"), "http://127.0.0.1:65530");
    await user.click(screen.getByRole("button", { name: "Подключиться к серверу" }));

    expect(probe).toHaveBeenCalledWith("http://127.0.0.1:65530");
    expect(onAdd).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Сервер недоступен");
  });

  it("does not add a non-OpenCord or protocol-incompatible endpoint", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn(() => true);
    probe.mockResolvedValueOnce({ ok: false, code: "not-opencord" });
    const { unmount } = render(<ServerDialog open onOpenChange={vi.fn()} onAdd={onAdd} />);
    await user.type(screen.getByLabelText("Адрес сервера"), "http://127.0.0.1:4000");
    await user.click(screen.getByRole("button", { name: "Подключиться к серверу" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("не найден совместимый OpenCord Server");
    unmount();

    probe.mockResolvedValueOnce({ ok: false, code: "incompatible", protocolVersion: 99 });
    render(<ServerDialog open onOpenChange={vi.fn()} onAdd={onAdd} />);
    await user.type(screen.getByLabelText("Адрес сервера"), "http://127.0.0.1:4001");
    await user.click(screen.getByRole("button", { name: "Подключиться к серверу" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("версию протокола 99");
    expect(onAdd).not.toHaveBeenCalled();
  });
});
