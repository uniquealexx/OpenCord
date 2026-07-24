import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ServerDialog } from "@/components/server-dialog";

describe("ServerDialog", () => {
  it("keeps the dialog open when the normalized address is already present", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn(() => false);
    render(<ServerDialog open onOpenChange={vi.fn()} onAdd={onAdd} />);
    await user.type(screen.getByLabelText("HTTPS-адрес сервера"), "http://127.0.0.1:3210/");
    await user.click(screen.getByRole("button", { name: "Подключиться к серверу" }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(await screen.findByText("Этот адрес уже добавлен в клиент.")).toBeInTheDocument();
  });
});
