import type { PersistedClientState } from "./state";

export const IPC = {
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggle-maximize",
  windowClose: "window:close",
  windowIsMaximized: "window:is-maximized",
  windowMaximizedChanged: "window:maximized-changed",
  storageLoad: "storage:load",
  storageSave: "storage:save",
  storageReset: "storage:reset",
  identityGetOrCreate: "identity:get-or-create",
  identitySignChallenge: "identity:sign-challenge",
  identityReset: "identity:reset",
} as const;

export interface PublicIdentity {
  publicKey: string;
  fingerprint: string;
}

export interface OpenCordBridge {
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<boolean>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximizedChange(listener: (maximized: boolean) => void): () => void;
  };
  storage: {
    load(): Promise<PersistedClientState>;
    save(nextState: PersistedClientState): Promise<PersistedClientState>;
    reset(): Promise<PersistedClientState>;
  };
  identity: {
    getOrCreate(): Promise<PublicIdentity>;
    signChallenge(challenge: string): Promise<string>;
    reset(): Promise<PublicIdentity>;
  };
}
