"use client";

import { useEffect, useRef } from "react";
import type { KeybindActionEvent, KeybindMap } from "@/shared/keybinds";
import type { VoiceSession } from "./use-voice-session";

/**
 * Глобальные бинды mute/deafen. События приходят из main-процесса (глобальный
 * хук клавиатуры) и работают без фокуса окна. «Нажатия» применяются только в
 * активной голосовой сессии; «отпускания» — всегда, иначе отпущенная клавиша
 * оставит микрофон заглушённым после выхода из канала. Снимать мут можно
 * только без серверного мута — тот же guard, что у кнопок в интерфейсе.
 */
export function useKeybindActions(voice: VoiceSession, serverMuted: boolean, binds: KeybindMap | null): void {
  const stateRef = useRef({ voice, serverMuted });
  useEffect(() => { stateRef.current = { voice, serverMuted }; });

  const serializedBinds = JSON.stringify(binds ?? null);
  useEffect(() => {
    const bridge = window.openCord?.keybinds;
    if (!bridge) return;
    void bridge.apply(JSON.parse(serializedBinds) as KeybindMap | null);
  }, [serializedBinds]);

  useEffect(() => {
    const bridge = window.openCord?.keybinds;
    if (!bridge) return;
    return bridge.onAction((event: KeybindActionEvent) => {
      const { voice: session, serverMuted: adminMuted } = stateRef.current;
      const setMicMuted = (value: boolean): void => {
        if (!value && adminMuted) return;
        void session.setMuted(value);
      };
      if (event.phase === "release") {
        // Release-события посылает main только для hold-биндов (у toggle зажатых
        // состояний нет); чужие release игнорируем.
        if (event.mode !== "hold") return;
        if (event.action === "mute") setMicMuted(false);
        else void session.setDeafened(false);
        return;
      }
      const inSession = session.status === "connecting" || session.status === "connected" || session.status === "reconnecting";
      if (!inSession) return;
      if (event.action === "mute") setMicMuted(event.mode === "hold" ? true : !session.muted);
      else void session.setDeafened(event.mode === "hold" ? true : !session.deafened);
    });
  }, []);
}
