import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusMenu } from "@/components/status-menu";
import { dictionaries } from "@/lib/i18n";

const t = dictionaries.ru;

describe("StatusMenu", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the four dictionary labels", async () => {
    const user = userEvent.setup();
    render(<StatusMenu value="online" onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: t.profile.status }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual([t.statuses.online, t.statuses.idle, t.statuses.dnd, t.statuses.invisible]);
  });

  it("marks exactly the current status with aria-checked", async () => {
    const user = userEvent.setup();
    render(<StatusMenu value="idle" onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: t.profile.status }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitemradio");
    const checked = items.filter((item) => item.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveTextContent(t.statuses.idle);
  });

  it("calls onChange once with the new status and closes the menu", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatusMenu value="online" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: t.profile.status }));
    await user.click(screen.getByRole("menuitemradio", { name: t.statuses.dnd }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("dnd");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<StatusMenu value="online" onChange={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: t.profile.status });
    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on an outside pointerdown", async () => {
    const user = userEvent.setup();
    render(<StatusMenu value="online" onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: t.profile.status }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("moves focus to the next item on ArrowDown", async () => {
    const user = userEvent.setup();
    render(<StatusMenu value="online" onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: t.profile.status }));
    expect(screen.getByRole("menuitemradio", { name: t.statuses.online })).toHaveFocus();

    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(screen.getByRole("menuitemradio", { name: t.statuses.idle })).toHaveFocus();
  });
});
