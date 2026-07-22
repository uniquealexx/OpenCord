import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { IPC } from "../src/shared/bridge";
import { parsePersistedState } from "../src/shared/state";
import { ClientStateStore } from "./storage";
import { IdentityStore } from "./identity";

const developmentUrl = process.env.ELECTRON_RENDERER_URL;
let mainWindow: BrowserWindow | null = null;
let store: ClientStateStore;
let identityStore: IdentityStore;

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
}

if (process.env.NODE_ENV === "test" && process.env.OPENCORD_TEST_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.OPENCORD_TEST_USER_DATA));
}

app.setAppUserModelId("org.opencord.desktop");

void app.whenReady().then(() => {
  store = new ClientStateStore(app.getPath("userData"));
  identityStore = new IdentityStore(app.getPath("userData"));
  registerIpc();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
