import type { PersistedClientState } from "./state";
import type { DeploymentConnection, DeploymentEnvironment, DeploymentProgress, DeploymentRequest, DeploymentStartResult, SelectedSshKey, SshHostIdentity, SshTarget } from "./deployment";
import type { Attachment } from "@opencord/shared";
import type { AttachmentDownloadRequest, AttachmentTransferContext } from "./attachments";

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
  deploymentReleaseKey: "deployment:release-key",
  deploymentInspectHost: "deployment:inspect-host",
  deploymentInspectEnvironment: "deployment:inspect-environment",
  deploymentStart: "deployment:start",
  deploymentCancel: "deployment:cancel",
  deploymentProgress: "deployment:progress",
  attachmentSelectAndUpload: "attachment:select-and-upload",
  attachmentDownload: "attachment:download",
  attachmentPreview: "attachment:preview",
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
}
