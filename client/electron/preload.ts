import { contextBridge, ipcRenderer, webUtils } from "electron";
import { attachmentSchema } from "@opencord/shared";
import { IPC, type OpenCordBridge } from "../src/shared/bridge";
import { parsePersistedState } from "../src/shared/state";
import { deploymentConnectionSchema, deploymentEnvironmentSchema, deploymentProgressSchema, deploymentRequestSchema, deploymentStartResultSchema, selectedServerBundleSchema, selectedSshKeySchema, sshHostIdentitySchema, sshTargetSchema } from "../src/shared/deployment";
import { attachmentDownloadRequestSchema, attachmentPreviewResultSchema, attachmentTransferContextSchema, attachmentUploadBytesRequestSchema, attachmentUploadRequestSchema, attachmentUploadResultSchema } from "../src/shared/attachments";
import { clientUpdateStateSchema } from "../src/shared/updater";
import { screenShareDiagnosticSchema, screenShareSelectionSchema, screenShareSourcesSchema } from "../src/shared/screen-share";
import { serverProbeAddressSchema, serverProbeResultSchema } from "../src/shared/server-probe";
import { keybindActionEventSchema, keybindMapSchema } from "../src/shared/keybinds";

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
    getOrCreate: () => ipcRenderer.invoke(IPC.identityGetOrCreate) as Promise<{ publicKey: string; fingerprint: string; discriminator: string }>,
    signChallenge: (challenge) => ipcRenderer.invoke(IPC.identitySignChallenge, challenge) as Promise<string>,
    reset: () => ipcRenderer.invoke(IPC.identityReset) as Promise<{ publicKey: string; fingerprint: string; discriminator: string }>,
  },
  deployment: {
    selectServerBundle: async () => {
      const result: unknown = await ipcRenderer.invoke(IPC.deploymentSelectBundle);
      return result === null ? null : selectedServerBundleSchema.parse(result);
    },
    selectPrivateKey: async () => {
      const result: unknown = await ipcRenderer.invoke(IPC.deploymentSelectKey);
      return result === null ? null : selectedSshKeySchema.parse(result);
    },
    releasePrivateKey: (credentialId) => ipcRenderer.invoke(IPC.deploymentReleaseKey, credentialId) as Promise<void>,
    inspectHost: async (target) => sshHostIdentitySchema.parse(await ipcRenderer.invoke(IPC.deploymentInspectHost, sshTargetSchema.parse(target))),
    inspectEnvironment: async (connection) => deploymentEnvironmentSchema.parse(await ipcRenderer.invoke(IPC.deploymentInspectEnvironment, deploymentConnectionSchema.parse(connection))),
    start: async (request) => deploymentStartResultSchema.parse(await ipcRenderer.invoke(IPC.deploymentStart, deploymentRequestSchema.parse(request))),
    cancel: (operationId) => ipcRenderer.invoke(IPC.deploymentCancel, operationId) as Promise<void>,
    onProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => listener(deploymentProgressSchema.parse(value));
      ipcRenderer.on(IPC.deploymentProgress, handler);
      return () => ipcRenderer.removeListener(IPC.deploymentProgress, handler);
    },
  },
  attachments: {
    selectAndUpload: async (context) => attachmentUploadResultSchema.parse(await ipcRenderer.invoke(IPC.attachmentSelectAndUpload, attachmentTransferContextSchema.parse(context))),
    uploadFile: async (context, file) => {
      const parsedContext = attachmentTransferContextSchema.parse(context);
      // File.path удалён из Chromium (Electron 32+); путь к файлу даёт webUtils.getPathForFile.
      const filePath = webUtils.getPathForFile(file);
      if (filePath) {
        return attachmentSchema.parse(await ipcRenderer.invoke(IPC.attachmentUploadFile, attachmentUploadRequestSchema.parse({ context: parsedContext, filePath })));
      }
      // Файл без пути на диске (например, скриншот из буфера обмена): передаём байты целиком.
      const contents = new Uint8Array(await file.arrayBuffer());
      return attachmentSchema.parse(await ipcRenderer.invoke(IPC.attachmentUploadBytes, attachmentUploadBytesRequestSchema.parse({ context: parsedContext, fileName: file.name || "clipboard-image.png", mimeType: file.type || "application/octet-stream", contents })));
    },
    download: async (request) => (await ipcRenderer.invoke(IPC.attachmentDownload, attachmentDownloadRequestSchema.parse(request))) === true,
    preview: async (request) => attachmentPreviewResultSchema.parse(await ipcRenderer.invoke(IPC.attachmentPreview, attachmentDownloadRequestSchema.parse(request))),
    setLatencySensitive: async (value) => { await ipcRenderer.invoke(IPC.attachmentSetLatencySensitive, value === true); },
  },
  server: {
    probe: async (address) => serverProbeResultSchema.parse(await ipcRenderer.invoke(IPC.serverProbe, serverProbeAddressSchema.parse(address))),
  },
  screenShare: {
    listSources: async () => screenShareSourcesSchema.parse(await ipcRenderer.invoke(IPC.screenShareListSources)),
    selectSource: async (selection) => { await ipcRenderer.invoke(IPC.screenShareSelectSource, screenShareSelectionSchema.parse(selection)); },
    report: async (message) => { await ipcRenderer.invoke(IPC.screenShareDiagnostic, screenShareDiagnosticSchema.parse(message)); },
  },
  updates: {
    getState: async () => clientUpdateStateSchema.parse(await ipcRenderer.invoke(IPC.updateGetState)),
    check: async () => clientUpdateStateSchema.parse(await ipcRenderer.invoke(IPC.updateCheck)),
    download: async () => clientUpdateStateSchema.parse(await ipcRenderer.invoke(IPC.updateDownload)),
    install: () => ipcRenderer.invoke(IPC.updateInstall) as Promise<void>,
    onStateChange: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => listener(clientUpdateStateSchema.parse(value));
      ipcRenderer.on(IPC.updateStateChanged, handler);
      return () => ipcRenderer.removeListener(IPC.updateStateChanged, handler);
    },
  },
  keybinds: {
    apply: async (map) => { await ipcRenderer.invoke(IPC.keybindsApply, keybindMapSchema.parse(map ?? {})); },
    setCaptureMode: async (active) => { await ipcRenderer.invoke(IPC.keybindsCapture, active === true); },
    onAction: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => listener(keybindActionEventSchema.parse(value));
      ipcRenderer.on(IPC.keybindsAction, handler);
      return () => ipcRenderer.removeListener(IPC.keybindsAction, handler);
    },
  },
};

contextBridge.exposeInMainWorld("openCord", bridge);
