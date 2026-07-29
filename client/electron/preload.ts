import { contextBridge, ipcRenderer } from "electron";
import { IPC, type OpenCordBridge } from "../src/shared/bridge";
import { parsePersistedState } from "../src/shared/state";
import { deploymentConnectionSchema, deploymentEnvironmentSchema, deploymentProgressSchema, deploymentRequestSchema, deploymentStartResultSchema, selectedServerBundleSchema, selectedSshKeySchema, sshHostIdentitySchema, sshTargetSchema } from "../src/shared/deployment";
import { attachmentDownloadRequestSchema, attachmentPreviewResultSchema, attachmentTransferContextSchema, attachmentUploadResultSchema } from "../src/shared/attachments";

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
    download: async (request) => (await ipcRenderer.invoke(IPC.attachmentDownload, attachmentDownloadRequestSchema.parse(request))) === true,
    preview: async (request) => attachmentPreviewResultSchema.parse(await ipcRenderer.invoke(IPC.attachmentPreview, attachmentDownloadRequestSchema.parse(request))),
  },
};

contextBridge.exposeInMainWorld("openCord", bridge);
