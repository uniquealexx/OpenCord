import type { PersistedClientState } from "./state";
import type { DeploymentConnection, DeploymentEnvironment, DeploymentProgress, DeploymentRequest, DeploymentStartResult, SelectedServerBundle, SelectedSshKey, SshHostIdentity, SshTarget } from "./deployment";
import type { Attachment } from "@opencord/shared";
import type { AttachmentDownloadRequest, AttachmentTransferContext } from "./attachments";
import type { ClientUpdateState } from "./updater";
import type { ScreenShareSelection, ScreenShareSource } from "./screen-share";

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
  deploymentSelectKey: "deployment:select-key",
  deploymentSelectBundle: "deployment:select-bundle",
  deploymentReleaseKey: "deployment:release-key",
  deploymentInspectHost: "deployment:inspect-host",
  deploymentInspectEnvironment: "deployment:inspect-environment",
  deploymentStart: "deployment:start",
  deploymentCancel: "deployment:cancel",
  deploymentProgress: "deployment:progress",
  attachmentSelectAndUpload: "attachment:select-and-upload",
  attachmentDownload: "attachment:download",
  attachmentPreview: "attachment:preview",
  screenShareListSources: "screen-share:list-sources",
  screenShareSelectSource: "screen-share:select-source",
  screenShareDiagnostic: "screen-share:diagnostic",
  updateGetState: "update:get-state",
  updateCheck: "update:check",
  updateDownload: "update:download",
  updateInstall: "update:install",
  updateStateChanged: "update:state-changed",
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
  deployment: {
    selectPrivateKey(): Promise<SelectedSshKey | null>;
    selectServerBundle(): Promise<SelectedServerBundle | null>;
    releasePrivateKey(credentialId: string): Promise<void>;
    inspectHost(target: SshTarget): Promise<SshHostIdentity>;
    inspectEnvironment(connection: DeploymentConnection): Promise<DeploymentEnvironment>;
    start(request: DeploymentRequest): Promise<DeploymentStartResult>;
    cancel(operationId: string): Promise<void>;
    onProgress(listener: (progress: DeploymentProgress) => void): () => void;
  };
  attachments: {
    selectAndUpload(context: AttachmentTransferContext): Promise<Attachment | null>;
    download(request: AttachmentDownloadRequest): Promise<boolean>;
    preview(request: AttachmentDownloadRequest): Promise<string>;
  };
  screenShare?: {
    listSources(): Promise<ScreenShareSource[]>;
    selectSource(selection: ScreenShareSelection): Promise<void>;
    report(message: string): Promise<void>;
  };
  updates?: {
    getState(): Promise<ClientUpdateState>;
    check(): Promise<ClientUpdateState>;
    download(): Promise<ClientUpdateState>;
    install(): Promise<void>;
    onStateChange(listener: (state: ClientUpdateState) => void): () => void;
  };
}
