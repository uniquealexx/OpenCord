import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../src/shared/bridge";
import { clientUpdateStateSchema, type ClientUpdateState } from "../src/shared/updater";

contextBridge.exposeInMainWorld("openCordUpdateGate", {
  getState: async (): Promise<ClientUpdateState> => clientUpdateStateSchema.parse(await ipcRenderer.invoke(IPC.updateGetState)),
  onStateChange: (listener: (state: ClientUpdateState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => listener(clientUpdateStateSchema.parse(value));
    ipcRenderer.on(IPC.updateStateChanged, handler);
    return () => ipcRenderer.removeListener(IPC.updateStateChanged, handler);
  },
});
