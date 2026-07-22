import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Onboarding } from "@/components/onboarding";

describe("Onboarding", () => {
  it("creates a trimmed local profile", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<Onboarding onComplete={onComplete} />);
    const submit = screen.getByRole("button", { name: /создать локальный профиль/i });
    expect(submit).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Отображаемое имя"), "  Лина  ");
    await user.type(screen.getByPlaceholderText(/создаю открытые сообщества/i), "Люблю открытый код");
    await user.click(submit);
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Лина", bio: "Люблю открытый код", id: "local-user" }));
  });
});
