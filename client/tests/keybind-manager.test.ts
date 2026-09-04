import { describe, expect, it } from "vitest";
import { KeybindManager, type KeybindHost } from "../electron/keybinds";
import type { KeybindMap } from "../src/shared/keybinds";
import type { KeybindActionEvent } from "../src/shared/keybinds";

function createManager(map: unknown): { manager: KeybindManager; sent: KeybindActionEvent[] } {
  const sent: KeybindActionEvent[] = [];
  const host: KeybindHost = { send: (event) => sent.push(event) };
  const manager = new KeybindManager(host);
  manager.configure(map as KeybindMap);
  return { manager, sent };
}

const MUTE_TOGGLE = { mute: { trigger: { code: "KeyM", control: false, alt: false, shift: false, meta: false }, mode: "toggle" } };
const MUTE_HOLD = { mute: { trigger: { code: "KeyM", control: true, alt: false, shift: false, meta: false }, mode: "hold" } };

describe("KeybindManager", () => {
  it("toggle fires once per physical press and ignores OS auto-repeat", () => {
    const { manager, sent } = createManager(MUTE_TOGGLE);
    manager.handleKeyDown({ code: "KeyM" });
    manager.handleKeyDown({ code: "KeyM" }); // авто-повтор
    manager.handleKeyUp({ code: "KeyM" });
    manager.handleKeyDown({ code: "KeyM" });
    expect(sent).toEqual([
      { action: "mute", mode: "toggle", phase: "press" },
      { action: "mute", mode: "toggle", phase: "press" },
    ]);
  });

  it("hold sends press on keydown and release on keyup, no duplicates while held", () => {
    const { manager, sent } = createManager(MUTE_HOLD);
    manager.handleKeyDown({ code: "ControlLeft" });
    manager.handleKeyDown({ code: "KeyM" });
    manager.handleKeyDown({ code: "KeyM" }); // авто-повтор
    manager.handleKeyUp({ code: "KeyM" });
    manager.handleKeyUp({ code: "ControlLeft" });
    manager.handleKeyDown({ code: "ControlLeft" });
    manager.handleKeyDown({ code: "KeyM" });
    expect(sent).toEqual([
      { action: "mute", mode: "hold", phase: "press" },
      { action: "mute", mode: "hold", phase: "release" },
      { action: "mute", mode: "hold", phase: "press" },
    ]);
  });

  it("releasing modifiers before the key still releases the held action", () => {
    const { manager, sent } = createManager(MUTE_HOLD);
    manager.handleKeyDown({ code: "ControlLeft" });
    manager.handleKeyDown({ code: "KeyM" });
    manager.handleKeyUp({ code: "ControlLeft" });
    manager.handleKeyUp({ code: "KeyM" });
    expect(sent).toEqual([
      { action: "mute", mode: "hold", phase: "press" },
      { action: "mute", mode: "hold", phase: "release" },
    ]);
  });

  it("requires tracked modifiers to match", () => {
    const { manager, sent } = createManager(MUTE_HOLD);
    manager.handleKeyDown({ code: "KeyM" });
    expect(sent).toEqual([]);
  });

  it("ignores unbound keys and unmapped actions", () => {
    const { manager, sent } = createManager(MUTE_TOGGLE);
    manager.handleKeyDown({ code: "KeyZ" });
    manager.handleKeyUp({ code: "KeyZ" });
    expect(sent).toEqual([]);
  });

  it("reconfiguring releases held binds and applies the new map", () => {
    const { manager, sent } = createManager(MUTE_HOLD);
    manager.handleKeyDown({ code: "ControlLeft" });
    manager.handleKeyDown({ code: "KeyM" });
    manager.configure({ deafen: { trigger: { code: "F9", control: false, alt: false, shift: false, meta: false }, mode: "toggle" } });
    expect(sent.at(-1)).toEqual({ action: "mute", mode: "hold", phase: "release" });
    manager.handleKeyDown({ code: "F9" });
    expect(sent.at(-1)).toEqual({ action: "deafen", mode: "toggle", phase: "press" });
    manager.handleKeyDown({ code: "KeyM" });
    expect(sent).toHaveLength(3); // F9 + release(mute) при пере-конфигурации; KeyM больше не действует
  });

  it("suppression (settings key capture) still tracks state but sends nothing, and flushes held binds", () => {
    const { manager, sent } = createManager(MUTE_HOLD);
    manager.handleKeyDown({ code: "ControlLeft" });
    manager.handleKeyDown({ code: "KeyM" });
    manager.setSuppressed(true);
    expect(sent.at(-1)).toEqual({ action: "mute", mode: "hold", phase: "release" });
    manager.handleKeyDown({ code: "KeyN" });
    manager.handleKeyUp({ code: "KeyN" });
    manager.handleKeyUp({ code: "KeyM" }); // пользователь отпустил Ctrl+M, пока шёл захват
    manager.handleKeyUp({ code: "ControlLeft" });
    manager.setSuppressed(false);
    manager.handleKeyDown({ code: "ControlLeft" });
    manager.handleKeyDown({ code: "KeyM" });
    expect(sent.at(-1)).toEqual({ action: "mute", mode: "hold", phase: "press" }); // работает снова после снятия
  });
});
