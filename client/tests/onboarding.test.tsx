import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Onboarding } from "@/components/onboarding";

afterEach(cleanup);

describe("Onboarding", () => {
  it("creates a trimmed local profile", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<Onboarding language="ru" onLanguageChange={vi.fn()} onComplete={onComplete} />);
    const submit = screen.getByRole("button", { name: /создать локальный профиль/i });
    expect(submit).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Отображаемое имя"), "  Лина  ");
    await user.type(screen.getByPlaceholderText(/создаю открытые сообщества/i), "Люблю открытый код");
    await user.click(submit);
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Лина", bio: "Люблю открытый код", id: "local-user" }));
  });

  it("reports the language chosen at first launch", async () => {
    const onLanguageChange = vi.fn();
    const user = userEvent.setup();
    render(<Onboarding language="en" onLanguageChange={onLanguageChange} onComplete={vi.fn()} />);
    const group = screen.getByRole("group", { name: "Язык интерфейса" });
    expect(group).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "中文" }));
    expect(onLanguageChange).toHaveBeenCalledWith("zh");
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(onLanguageChange).toHaveBeenCalledWith("en");
  });
});
