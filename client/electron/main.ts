import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, nativeImage, session, shell, Tray, type DesktopCapturerSource, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { IPC } from "../src/shared/bridge";
import { selectedSshKeySchema } from "../src/shared/deployment";
import { parsePersistedState } from "../src/shared/state";
import { ClientStateStore } from "./storage";
import { IdentityStore } from "./identity";
import { DeploymentManager } from "./deployment";
import { GitHubReleaseBundleProvider, githubReleaseManifestUrl, LocalServerBundleProvider, ReleaseAwareServerBundleProvider } from "./server-bundle";
import { attachmentDownloadRequestSchema, attachmentTransferContextSchema } from "../src/shared/attachments";
import { downloadAttachment, prepareAttachmentPreviewDirectory, previewAttachment, uploadAttachment } from "./attachments";
import { autoUpdater } from "electron-updater";
import { ClientUpdateManager, runRequiredStartupUpdate } from "./client-updater";
import type { ClientUpdateState } from "../src/shared/updater";
import { screenShareDiagnosticSchema, screenShareSelectionSchema, screenShareSourcesSchema } from "../src/shared/screen-share";
import { isAllowedRendererPermission } from "./permissions";
import { probeOpenCordServer } from "./server-probe";
import { shouldHideWindowOnClose } from "./window-lifecycle";

const developmentUrl = process.env.ELECTRON_RENDERER_URL;
let mainWindow: BrowserWindow | null = null;
let updateWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: ClientStateStore;
let identityStore: IdentityStore;
let deploymentManager: DeploymentManager;
let serverBundleProvider: ReleaseAwareServerBundleProvider;
let clientUpdateManager: ClientUpdateManager;
let attachmentPreviewDirectory: string;
let bundleCleanupStarted = false;
let clientUpdateInstalling = false;
let startupGateCompleted = false;
let quitting = false;
let trayNoticeShown = false;
const selectedSshKeys = new Map<string, string>();
let pendingScreenShare: { source: DesktopCapturerSource; includeAudio: boolean; expiresAt: number } | null = null;
const TRAY_ICON_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACuSURBVFhH7c5LCsMwEARRHzRHyd0dBFmYl9FIY0NwiBpqNZ+ubVt55/nY929i/xL4PYEo7mTYPyVQibdi/1DgTPxxWiCKO5W9hv1dAeM8wjhv2B8KGOcZxrn9QwFnM2T39t9PIDuu0Ptj/xJYAh8C2fEs2b399xeInmQY5/aHAjOPIozzhv1dgehhizuVvYb9qUDv+Sj+uCRQlfBW7J8SOBLFnQz7ywJXsX8J/G9ebgdsQL8M5kwAAAAASUVORK5CYII=";

function isTrustedRenderer(url: string): boolean {
  if (developmentUrl) {
    try { return new URL(url).origin === new URL(developmentUrl).origin; } catch { return false; }
  }
  return url.startsWith("file://");
}

function configureMediaPermissions(): void {
  const appSession = session.defaultSession;
  appSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const trustedRenderer = isTrustedRenderer(webContents?.getURL() || requestingOrigin);
    void details;
    return trustedRenderer && isAllowedRendererPermission(permission);
  });
  appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const trustedRenderer = isTrustedRenderer(webContents.getURL());
    if (isAllowedRendererPermission(permission)) {
      void details;
      callback(trustedRenderer);
      return;
    }
    callback(false);
  });
  appSession.setDisplayMediaRequestHandler((request, callback) => {
    const selection = pendingScreenShare;
    pendingScreenShare = null;
    const requestFrame = request.frame;
    const trustedFrame = isTrustedRenderer(requestFrame?.url || request.securityOrigin);
    // The source picker awaits an IPC round trip before LiveKit calls
    // getDisplayMedia, so Chromium no longer reports an active user gesture.
    // The short-lived, single-use selection is the authorization boundary.
    if (!selection || selection.expiresAt < Date.now() || !trustedFrame) {
      console.warn("Screen share request denied", { hasSelection: Boolean(selection), expired: Boolean(selection && selection.expiresAt < Date.now()), trustedFrame, securityOrigin: request.securityOrigin, frameUrl: requestFrame?.url });
      callback({});
      return;
    }
    console.info("Screen share source granted", { sourceId: selection.source.id, includeAudio: selection.includeAudio, securityOrigin: request.securityOrigin, frameUrl: requestFrame?.url });
    callback({ video: selection.source, ...(selection.includeAudio ? { audio: "loopback" as const } : {}) });
  });
}

function requireMainRenderer(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id || !isTrustedRenderer(event.sender.getURL())) throw new Error("Недоверенный источник запроса");
}

async function listScreenShareSources(): Promise<DesktopCapturerSource[]> {
  return desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 480, height: 270 }, fetchWindowIcons: true });
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
  mainWindow.on("close", (event) => {
    if (!shouldHideWindowOnClose(quitting, clientUpdateInstalling)) return;
    event.preventDefault();
    mainWindow?.hide();
    showTrayNotice();
  });
  mainWindow.on("maximize", () => mainWindow?.webContents.send(IPC.windowMaximizedChanged, true));
  mainWindow.on("unmaximize", () => mainWindow?.webContents.send(IPC.windowMaximizedChanged, false));
  mainWindow.on("closed", () => { mainWindow = null; });
  createTray();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`OpenCord preload failed (${preloadPath}):`, error);
  });
  mainWindow.webContents.on("console-message", (details) => {
    if (details.message.startsWith("[screen-share]")) console.info(details.message);
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

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  if (tray && !tray.isDestroyed()) return;
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("OpenCord");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Открыть OpenCord", click: showMainWindow },
    { type: "separator" },
    { label: "Выйти", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
}

function showTrayNotice(): void {
  if (trayNoticeShown || process.platform !== "win32" || !tray || tray.isDestroyed()) return;
  trayNoticeShown = true;
  tray.displayBalloon({ iconType: "info", title: "OpenCord продолжает работать", content: "Приложение скрыто в системном трее. Для полного выхода используйте меню значка OpenCord." });
}

function createUpdateWindow(): void {
  updateWindow = new BrowserWindow({
    width: 540,
    height: 390,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    backgroundColor: "#090b12",
    title: "Обновление OpenCord",
    webPreferences: {
      preload: path.join(__dirname, "update-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  updateWindow.once("ready-to-show", () => updateWindow?.show());
  updateWindow.on("closed", () => { updateWindow = null; });
  updateWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  updateWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) event.preventDefault();
  });
  void updateWindow.loadFile(path.join(__dirname, "..", "out", "update.html"));
}

function emitClientUpdateState(state: ClientUpdateState): void {
  for (const window of [mainWindow, updateWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(IPC.updateStateChanged, state);
  }
}

async function prepareAndInstallClientUpdate(): Promise<void> {
  if (!bundleCleanupStarted) {
    bundleCleanupStarted = true;
    await serverBundleProvider.dispose();
  }
  clientUpdateInstalling = true;
  try {
    clientUpdateManager.install();
  } catch (error) {
    clientUpdateInstalling = false;
    throw error;
  }
}

async function showRequiredUpdateError(message: string): Promise<"retry" | "quit"> {
  const options = {
    type: "error" as const,
    title: "Не удалось обновить OpenCord",
    message: "Для запуска OpenCord необходимо проверить и установить актуальную версию.",
    detail: message,
    buttons: ["Повторить", "Выйти"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const result = updateWindow ? await dialog.showMessageBox(updateWindow, options) : await dialog.showMessageBox(options);
  return result.response === 0 ? "retry" : "quit";
}

async function passStartupUpdateGate(): Promise<void> {
  if (!app.isPackaged || process.platform !== "win32") {
    startupGateCompleted = true;
    createWindow();
    return;
  }

  if (!updateWindow || updateWindow.isDestroyed()) createUpdateWindow();
  const result = await runRequiredStartupUpdate(clientUpdateManager, showRequiredUpdateError);
  if (result === "quit") {
    app.quit();
    return;
  }
  if (result === "install") {
    try {
      await prepareAndInstallClientUpdate();
    } catch (error) {
      const decision = await showRequiredUpdateError(error instanceof Error ? error.message : String(error));
      if (decision === "retry") await passStartupUpdateGate();
      else app.quit();
    }
    return;
  }

  startupGateCompleted = true;
  createWindow();
  if (updateWindow && !updateWindow.isDestroyed()) updateWindow.destroy();
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
  ipcMain.handle(IPC.serverProbe, (event, input: unknown) => {
    requireMainRenderer(event);
    return probeOpenCordServer(input);
  });
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
    return uploadAttachment(filePath, context.serverAddress, context.sessionToken, context.maxAttachmentBytes);
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
    return previewAttachment(request.serverAddress, request.sessionToken, request.attachment, attachmentPreviewDirectory);
  });
  ipcMain.handle(IPC.updateGetState, () => clientUpdateManager.getState());
  ipcMain.handle(IPC.updateCheck, () => clientUpdateManager.check());
  ipcMain.handle(IPC.updateDownload, () => clientUpdateManager.download());
  ipcMain.handle(IPC.updateInstall, () => prepareAndInstallClientUpdate());
}

if (process.env.NODE_ENV === "test" && process.env.OPENCORD_TEST_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.OPENCORD_TEST_USER_DATA));
}

app.setAppUserModelId("org.opencord.desktop");

void app.whenReady().then(async () => {
  configureMediaPermissions();
  attachmentPreviewDirectory = await prepareAttachmentPreviewDirectory(app.getPath("temp"));
  store = new ClientStateStore(app.getPath("userData"));
  identityStore = new IdentityStore(app.getPath("userData"));
  const releaseDirectory = app.isPackaged ? path.join(process.resourcesPath, "server-bundles") : path.resolve(app.getAppPath(), "..", "release");
  const localBundleProvider = new LocalServerBundleProvider(releaseDirectory, app.getVersion(), async () => {
    const options: OpenDialogOptions = {
      title: "Выберите OpenCord Server bundle",
      properties: ["openFile"],
      filters: [{ name: "OpenCord Server bundle", extensions: ["gz"] }],
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  const releaseBundleProvider = new GitHubReleaseBundleProvider(
    githubReleaseManifestUrl(app.getVersion()),
    app.getVersion(),
    app.getPath("temp"),
  );
  serverBundleProvider = new ReleaseAwareServerBundleProvider(localBundleProvider, releaseBundleProvider);
  clientUpdateManager = new ClientUpdateManager(
    autoUpdater,
    app.getVersion(),
    app.isPackaged && process.platform === "win32",
    emitClientUpdateState,
  );
  deploymentManager = new DeploymentManager(serverBundleProvider, (credentialId) => {
    const keyPath = selectedSshKeys.get(credentialId);
    return keyPath;
  }, (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.deploymentProgress, progress);
  });
  ipcMain.handle(IPC.screenShareListSources, async (event) => {
    requireMainRenderer(event);
    const sources = await listScreenShareSources();
    return screenShareSourcesSchema.parse(sources.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.id.startsWith("screen:") ? "screen" : "window",
      thumbnail: source.thumbnail.toDataURL(),
      appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
    })));
  });
  ipcMain.handle(IPC.screenShareSelectSource, async (event, input: unknown) => {
    requireMainRenderer(event);
    const selection = screenShareSelectionSchema.parse(input);
    const source = (await listScreenShareSources()).find((item) => item.id === selection.sourceId);
    if (!source) throw new Error("Выбранный экран или окно больше недоступны");
    const expiresAt = Date.now() + 15_000;
    pendingScreenShare = { source, includeAudio: selection.includeAudio, expiresAt };
    console.info("Screen share source selected", { sourceId: source.id, includeAudio: selection.includeAudio });
  });
  ipcMain.handle(IPC.screenShareDiagnostic, async (event, input: unknown) => {
    requireMainRenderer(event);
    console.info("[screen-share]", screenShareDiagnosticSchema.parse(input));
  });
  registerIpc();
  await passStartupUpdateGate();
  app.on("activate", () => { if (startupGateCompleted) showMainWindow(); });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && (quitting || !tray || tray.isDestroyed())) app.quit();
});

app.on("before-quit", (event) => {
  quitting = true;
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
  if (clientUpdateInstalling) return;
  if (!serverBundleProvider || bundleCleanupStarted) return;
  event.preventDefault();
  bundleCleanupStarted = true;
  void serverBundleProvider.dispose().finally(() => app.quit());
});
