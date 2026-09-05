import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerHelp } from "@opencord/shared";
import { ServerHelpDialog, visibleHelpPages } from "@/components/server-help/server-help-dialog";

const spec: ServerHelp = {
  enabled: true,
  gate: { enabled: false, pageId: null },
  pages: [
    {
      id: "rules",
      title: "Rules",
      audience: "always",
      blocks: [
        { kind: "text", text: "No spam", size: "lg", weight: "bold", align: "left" },
        { kind: "checkbox", id: "read", label: "I read the rules", defaultChecked: false },
        { kind: "switch", id: "notify", label: "Notify me", defaultChecked: true },
        { kind: "select", id: "topic", label: "Topic", options: ["Roles", "Voice"], defaultValue: "Voice" },
        { kind: "button", label: "Open FAQ", variant: "secondary", action: { kind: "page", pageId: "faq" }, requires: [] },
        { kind: "button", label: "Got it", variant: "primary", action: { kind: "close" }, requires: [] },
      ],
    },
    { id: "faq", title: "FAQ", audience: "always", blocks: [{ kind: "text", text: "Ask an admin", size: "sm", weight: "normal", align: "left" }] },
  ],
};

const gateSpec: ServerHelp = {
  enabled: true,
  gate: { enabled: true, pageId: "rules" },
  pages: [
    {
      id: "rules",
      title: "Rules",
      audience: "pending",
      blocks: [
        { kind: "text", text: "No spam", size: "sm", weight: "normal", align: "left" },
        { kind: "checkbox", id: "agree", label: "I read the rules", defaultChecked: false },
        { kind: "button", label: "Accept", variant: "primary", action: { kind: "accept" }, requires: ["agree"] },
      ],
    },
    { id: "news", title: "News", audience: "accepted", blocks: [{ kind: "text", text: "News", size: "sm", weight: "normal", align: "left" }] },
  ],
};

afterEach(() => cleanup());

describe("server help dialog", () => {
  it("renders pages with existing UI primitives inside a bounded scroll box", () => {
    render(<ServerHelpDialog open onOpenChange={vi.fn()} spec={spec} serverName="Team" viewerAccepted />);
    expect(screen.getByRole("heading", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Rules" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("No spam")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "I read the rules" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Notify me" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("combobox", { name: "Topic" })).toBeInTheDocument();
    // Контент ограничен по высоте и скроллится внутри, а не растит окно.
    // Диалог рендерится в портал, поэтому ищем по всему документу.
    const scrollBox = document.querySelector("div.max-h-\\[46vh\\]");
    expect(scrollBox).not.toBeNull();
    expect(scrollBox?.className).toContain("overflow-y-auto");
  });

  it("navigates between pages and closes on demand", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ServerHelpDialog open onOpenChange={onOpenChange} spec={spec} serverName="Team" viewerAccepted />);
    await user.click(screen.getByRole("button", { name: "Open FAQ" }));
    expect(screen.getByText("Ask an admin")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "FAQ" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Rules" }));
    expect(screen.getByText("No spam")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps checkbox and select state local without sending anything", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ServerHelpDialog open onOpenChange={onOpenChange} spec={spec} serverName="Team" viewerAccepted />);
    const checkbox = screen.getByRole("checkbox", { name: "I read the rules" });
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("combobox", { name: "Topic" }));
    const listbox = screen.getByRole("listbox", { name: "Topic" });
    await user.click(within(listbox).getByRole("option", { name: "Roles" }));
    expect(screen.getByRole("combobox", { name: "Topic" })).toHaveTextContent("Roles");
  });

  it("shows the empty state when help is disabled", () => {
    render(<ServerHelpDialog open onOpenChange={vi.fn()} spec={{ enabled: false, gate: { enabled: false, pageId: null }, pages: [] }} serverName="Team" viewerAccepted />);
    expect(screen.queryByText("No spam")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("filters tabs by audience for pending and accepted viewers", () => {
    expect(visibleHelpPages(gateSpec, false).map((page) => page.id)).toEqual(["rules"]);
    expect(visibleHelpPages(gateSpec, true).map((page) => page.id)).toEqual(["news"]);
    expect(visibleHelpPages(spec, false).map((page) => page.id)).toEqual(["rules", "faq"]);
  });

  it("shows only the gate page without tabs or close controls in gate mode", () => {
    const onOpenChange = vi.fn();
    render(<ServerHelpDialog open onOpenChange={onOpenChange} spec={gateSpec} serverName="Team" viewerAccepted={false} gatePageId="rules" onAccept={vi.fn()} />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText("No spam")).toBeInTheDocument();
    expect(screen.queryByText("News")).not.toBeInTheDocument();
    // Крестик скрыт: закрыть можно только принятием.
    expect(document.querySelector("button.absolute.right-4")).toBeNull();
  });

  it("disables the accept button until required controls are confirmed", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<ServerHelpDialog open onOpenChange={vi.fn()} spec={gateSpec} serverName="Team" viewerAccepted={false} gatePageId="rules" onAccept={onAccept} />);
    const accept = screen.getByRole("button", { name: "Accept" });
    expect(accept).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /I read the rules/ }));
    expect(accept).toBeEnabled();
    await user.click(accept);
    expect(onAccept).toHaveBeenCalledWith({ agree: true });
  });
});
