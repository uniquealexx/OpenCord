import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyBulkDeleteOptimistic,
  BULK_DELETE_SELECT_LIMIT,
  bulkSelectAllIds,
  isBulkDeletableMessage,
  Message,
  restoreBulkDeleteRollback,
  toggleBulkSelection,
} from "@/components/client-app";
import { dictionaries, setActiveLanguage } from "@/lib/i18n";
import type { MockMessage } from "@/shared/state";

function makeMessage(id: string, extra?: Partial<MockMessage>): MockMessage {
  return {
    id,
    channelId: "channel-1",
    authorId: "author-1",
    authorName: "Lina",
    authorColor: "#7c5cff",
    content: `Message ${id}`,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

function renderMessage(message: MockMessage, props?: { selectMode?: boolean; selected?: boolean; onToggleSelect?: () => void }): void {
  render(
    <Message
      message={message}
      members={[]}
      compact={false}
      grouped={false}
      ownAvatar={null}
      currentUserId="local-user"
      canManageMessages
      previewAvailable={false}
      canAttach={false}
      uploading={false}
      selectMode={props?.selectMode}
      selected={props?.selected}
      onToggleSelect={props?.onToggleSelect}
      onAttach={vi.fn(async () => null)}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onDownload={vi.fn()}
      onPreview={vi.fn(async () => "")}
      onToggleReaction={vi.fn()}
    />,
  );
}

afterEach(() => {
  setActiveLanguage("en");
  cleanup();
});

describe("bulk delete selection", () => {
  it("toggles ids and respects the server limit", () => {
    expect(toggleBulkSelection([], "a")).toEqual(["a"]);
    expect(toggleBulkSelection(["a", "b"], "a")).toEqual(["b"]);
    const full = Array.from({ length: BULK_DELETE_SELECT_LIMIT }, (_, index) => `id-${index}`);
    expect(toggleBulkSelection(full, "overflow")).toEqual(full);
    expect(toggleBulkSelection(full, full[0]!)).toHaveLength(BULK_DELETE_SELECT_LIMIT - 1);
  });

  it("selects all visible ids up to the server limit", () => {
    expect(bulkSelectAllIds([{ id: "a" }, { id: "b" }])).toEqual(["a", "b"]);
    const many = Array.from({ length: BULK_DELETE_SELECT_LIMIT + 10 }, (_, index) => ({ id: `id-${index}` }));
    expect(bulkSelectAllIds(many)).toHaveLength(BULK_DELETE_SELECT_LIMIT);
  });

  it("allows only regular channel messages", () => {
    expect(isBulkDeletableMessage({})).toBe(true);
    expect(isBulkDeletableMessage({ kind: "chat" })).toBe(true);
    expect(isBulkDeletableMessage({ kind: "pm" })).toBe(false);
    expect(isBulkDeletableMessage({ kind: "apm" })).toBe(false);
  });

  it("removes selected messages optimistically and restores them on rollback", () => {
    const messages = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    const optimistic = applyBulkDeleteOptimistic(messages, ["a", "b"]);
    expect(optimistic.map((message) => message.id)).toEqual(["c"]);
    const restored = restoreBulkDeleteRollback(optimistic, messages.filter((message) => message.id !== "c"));
    expect(restored.map((message) => message.id).sort()).toEqual(["a", "b", "c"]);
    expect(restoreBulkDeleteRollback(messages, [makeMessage("a")])).toHaveLength(3);
  });
});

describe("bulk delete message checkboxes", () => {
  it("shows no checkbox outside select mode", () => {
    renderMessage(makeMessage("a"));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows a checkbox in select mode and toggles the selection", () => {
    const onToggleSelect = vi.fn();
    renderMessage(makeMessage("a"), { selectMode: true, selected: false, onToggleSelect });
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
  });

  it("reflects the selected state and disables private messages", () => {
    renderMessage(makeMessage("a"), { selectMode: true, selected: true });
    expect(screen.getByRole("checkbox")).toBeChecked();
    cleanup();
    renderMessage(makeMessage("pm-1", { kind: "pm" }), { selectMode: true, selected: false });
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });
});

describe("bulk delete i18n", () => {
  it("provides the confirm copy with the count and both failure notices in every language", () => {
    for (const dictionary of Object.values(dictionaries)) {
      expect(dictionary.chat.bulkDelete(3)).toContain("3");
      expect(dictionary.chat.bulkConfirmMessage(3)).toContain("3");
      expect(dictionary.chat.bulkConfirmTitle.length).toBeGreaterThan(0);
      expect(dictionary.chat.bulkSelect.length).toBeGreaterThan(0);
      expect(dictionary.chat.bulkCancel.length).toBeGreaterThan(0);
      expect(dictionary.chat.bulkSelectAll.length).toBeGreaterThan(0);
      expect(dictionary.chat.bulkSelected(3)).toContain("3");
      expect(dictionary.notices.bulkDeleteNotReady.length).toBeGreaterThan(0);
      expect(dictionary.notices.bulkDeleteFailed.length).toBeGreaterThan(0);
    }
  });
});
