import { app, BrowserWindow, dialog, ipcMain, session, shell, type OpenDialogOptions } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { IPC } from "../src/shared/bridge";
import { selectedSshKeySchema } from "../src/shared/deployment";
import { parsePersistedState } from "../src/shared/state";
import { ClientStateStore } from "./storage";
import { IdentityStore } from "./identity";
import { DeploymentManager } from "./deployment";
import { LocalServerBundleProvider } from "./server-bundle";
import { attachmentDownloadRequestSchema, attachmentTransferContextSchema } from "../src/shared/attachments";
import { downloadAttachment, previewAttachment, uploadAttachment } from "./attachments";

const developmentUrl = process.env.ELECTRON_RENDERER_URL;
let mainWindow: BrowserWindow | null = null;
let store: ClientStateStore;
let identityStore: IdentityStore;
let deploymentManager: DeploymentManager;
let serverBundleProvider: LocalServerBundleProvider;
const selectedSshKeys = new Map<string, string>();

function isTrustedRenderer(url: string): boolean {
  if (developmentUrl) {
    try { return new URL(url).origin === new URL(developmentUrl).origin; } catch { return false; }
  }
  return url.startsWith("file://");
}

function configureMediaPermissions(): void {
  const appSession = session.defaultSession;
  appSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => permission === "media"
    && details.mediaType === "audio"
    && isTrustedRenderer(webContents?.getURL() || requestingOrigin));
  appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const audioOnly = permission === "media" && "mediaTypes" in details && details.mediaTypes?.includes("audio") === true && details.mediaTypes.includes("video") === false;
    callback(audioOnly && isTrustedRenderer(webContents.getURL()));
  });
  // Never grant a screen or system-audio capture source in this client.
  appSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: "#090b12",
    title: "OpenCord",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("maximize", () => mainWindow?.webContents.send(IPC.windowMaximizedChanged, true));
  mainWindow.on("unmaximize", () => mainWindow?.webContents.send(IPC.windowMaximizedChanged, false));
  mainWindow.on("closed", () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`OpenCord preload failed (${preloadPath}):`, error);
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = developmentUrl ? url.startsWith(developmentUrl) : url.startsWith("file://");
    if (!allowed) event.preventDefault();
  });

  if (developmentUrl) {
    void mainWindow.loadURL(developmentUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "..", "out", "index.html"));
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.windowMinimize, () => mainWindow?.minimize());
  ipcMain.handle(IPC.windowToggleMaximize, () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle(IPC.windowClose, () => mainWindow?.close());
  ipcMain.handle(IPC.windowIsMaximized, () => mainWindow?.isMaximized() ?? false);
  ipcMain.handle(IPC.storageLoad, () => store.load());
  ipcMain.handle(IPC.storageSave, (_event, input: unknown) => store.save(parsePersistedState(input)));
  ipcMain.handle(IPC.storageReset, () => store.reset());
  ipcMain.handle(IPC.identityGetOrCreate, () => identityStore.getOrCreate());
  ipcMain.handle(IPC.identitySignChallenge, (_event, challenge: unknown) => identityStore.signChallenge(challenge));
  ipcMain.handle(IPC.identityReset, () => identityStore.reset());
  ipcMain.handle(IPC.deploymentSelectBundle, () => serverBundleProvider.select());
  ipcMain.handle(IPC.deploymentSelectKey, async () => {
    const options: OpenDialogOptions = {
      title: "Выберите приватный SSH-ключ",
      properties: ["openFile"],
      filters: [{ name: "SSH-ключи", extensions: ["pem", "key", "ppk"] }, { name: "Все файлы", extensions: ["*"] }],
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    const keyPath = result.filePaths[0];
    if (result.canceled || !keyPath) return null;
    const credentialId = randomUUID();
    selectedSshKeys.set(credentialId, keyPath);
    return selectedSshKeySchema.parse({ credentialId, label: path.basename(keyPath) });
  });
  ipcMain.handle(IPC.deploymentReleaseKey, (_event, credentialId: unknown) => {
    if (typeof credentialId === "string") selectedSshKeys.delete(credentialId);
  });
  ipcMain.handle(IPC.deploymentInspectHost, (_event, input: unknown) => deploymentManager.inspectHost(input));
  ipcMain.handle(IPC.deploymentInspectEnvironment, (_event, input: unknown) => deploymentManager.inspectEnvironment(input));
  ipcMain.handle(IPC.deploymentStart, (_event, input: unknown) => deploymentManager.start(input));
  ipcMain.handle(IPC.deploymentCancel, (_event, operationId: unknown) => deploymentManager.cancel(operationId));
  ipcMain.handle(IPC.attachmentSelectAndUpload, async (_event, input: unknown) => {
    const context = attachmentTransferContextSchema.parse(input);
    const options: OpenDialogOptions = { title: "Выберите файл", properties: ["openFile"] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return null;
    return uploadAttachment(filePath, context.serverAddress, context.sessionToken);
  });
  ipcMain.handle(IPC.attachmentDownload, async (_event, input: unknown) => {
    const request = attachmentDownloadRequestSchema.parse(input);
    const options = { title: "Сохранить вложение", defaultPath: request.attachment.fileName };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    await downloadAttachment(request.serverAddress, request.sessionToken, request.attachment, result.filePath);
    return true;
  });
  ipcMain.handle(IPC.attachmentPreview, async (_event, input: unknown) => {
    const request = attachmentDownloadRequestSchema.parse(input);
    return previewAttachment(request.serverAddress, request.sessionToken, request.attachment);
  });
}

if (process.env.NODE_ENV === "test" && process.env.OPENCORD_TEST_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.OPENCORD_TEST_USER_DATA));
}

app.setAppUserModelId("org.opencord.desktop");

void app.whenReady().then(() => {
  configureMediaPermissions();
  store = new ClientStateStore(app.getPath("userData"));
  identityStore = new IdentityStore(app.getPath("userData"));
  const releaseDirectory = app.isPackaged ? path.join(process.resourcesPath, "server-bundles") : path.resolve(app.getAppPath(), "..", "release");
  serverBundleProvider = new LocalServerBundleProvider(releaseDirectory, app.getVersion(), async () => {
    const options: OpenDialogOptions = {
      title: "Выберите OpenCord Server bundle",
      properties: ["openFile"],
      filters: [{ name: "OpenCord Server bundle", extensions: ["gz"] }],
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  deploymentManager = new DeploymentManager(serverBundleProvider, (credentialId) => {
    const keyPath = selectedSshKeys.get(credentialId);
    return keyPath;
  }, (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.deploymentProgress, progress);
  });
  registerIpc();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
