import { contextBridge, ipcRenderer } from "electron";
import { IPC, type OpenCordBridge } from "../src/shared/bridge";
import { parsePersistedState } from "../src/shared/state";

const bridge: OpenCordBridge = {
  window: {
    minimize: () => ipcRenderer.invoke(IPC.windowMinimize) as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize) as Promise<boolean>,
    close: () => ipcRenderer.invoke(IPC.windowClose) as Promise<void>,
    isMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized) as Promise<boolean>,
    onMaximizedChange: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, maximized: unknown): void => listener(maximized === true);
      ipcRenderer.on(IPC.windowMaximizedChanged, handler);
      return () => ipcRenderer.removeListener(IPC.windowMaximizedChanged, handler);
    },
  },
  storage: {
    load: async () => parsePersistedState(await ipcRenderer.invoke(IPC.storageLoad)),
    save: async (nextState) => parsePersistedState(await ipcRenderer.invoke(IPC.storageSave, parsePersistedState(nextState))),
    reset: async () => parsePersistedState(await ipcRenderer.invoke(IPC.storageReset)),
  },
  identity: {
    getOrCreate: () => ipcRenderer.invoke(IPC.identityGetOrCreate) as Promise<{ publicKey: string; fingerprint: string }>,
    signChallenge: (challenge) => ipcRenderer.invoke(IPC.identitySignChallenge, challenge) as Promise<string>,
    reset: () => ipcRenderer.invoke(IPC.identityReset) as Promise<{ publicKey: string; fingerprint: string }>,
  },
};

contextBridge.exposeInMainWorld("openCord", bridge);
