import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationToasts, type NotificationToast } from "@/components/notification-toasts";

function toast(overrides: Partial<NotificationToast> = {}): NotificationToast {
  return { id: "toast-1", channelId: "channel-1", channelName: "общий", authorName: "Мира", kind: "message", excerpt: "Привет всем", ...overrides };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("NotificationToasts", () => {
  it("renders toasts with localized titles and opens the channel on click", () => {
    const onOpen = vi.fn();
    render(<NotificationToasts toasts={[toast(), toast({ id: "toast-2", kind: "mention" }), toast({ id: "toast-3", kind: "everyone" })]} onOpen={onOpen} onDismiss={vi.fn()} />);
    expect(screen.getByText("Мира в #общий")).toBeInTheDocument();
    expect(screen.getByText("Мира упомянул вас в #общий")).toBeInTheDocument();
    expect(screen.getByText("Мира обратился ко всем в #общий")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Мира в #общий" }));
    expect(onOpen).toHaveBeenCalledWith("channel-1");
  });

  it("dismisses a toast via its close button", () => {
    const onDismiss = vi.fn();
    render(<NotificationToasts toasts={[toast()]} onOpen={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(onDismiss).toHaveBeenCalledWith("toast-1");
  });

  it("auto-dismisses toasts after a timeout", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<NotificationToasts toasts={[toast()]} onOpen={vi.fn()} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onDismiss).toHaveBeenCalledWith("toast-1");
  });

  it("shows at most four toasts, dropping the oldest", () => {
    render(
      <NotificationToasts
        toasts={[toast({ id: "t1", excerpt: "First" }), toast({ id: "t2", excerpt: "Second" }), toast({ id: "t3", excerpt: "Third" }), toast({ id: "t4", excerpt: "Fourth" }), toast({ id: "t5", excerpt: "Fifth" })]}
        onOpen={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByText("First")).not.toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getByText("Fifth")).toBeInTheDocument();
  });

  it("renders nothing without toasts", () => {
    const { container } = render(<NotificationToasts toasts={[]} onOpen={vi.fn()} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
