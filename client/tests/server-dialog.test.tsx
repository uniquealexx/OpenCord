import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ServerDialog } from "@/components/server-dialog";

describe("ServerDialog", () => {
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
});
