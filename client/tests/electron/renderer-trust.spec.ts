import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { _electron as electron, expect, test } from "@playwright/test";

/**
 * Preload с мостом `window.openCord` привязан к webContents, а не к странице, и CSP
 * живёт только внутри index.html. Значит уход на любой другой локальный файл отдал бы
 * ему мост без политики — а положить файл на диск сервер умеет сам (предпросмотр
 * вложений). Оболочка обязана оставаться на своей единственной странице.
 */
test("renderer cannot navigate away from the shell page", async () => {
  test.setTimeout(60_000);
  const userData = await mkdtemp(path.join(tmpdir(), "opencord-trust-test-"));
  const payloadDirectory = await mkdtemp(path.join(tmpdir(), "opencord-trust-payload-"));
  const payloadFile = path.join(payloadDirectory, "payload.html");
  await writeFile(payloadFile, "<!doctype html><title>payload</title><body>payload</body>", "utf8");
  const payloadUrl = pathToFileURL(payloadFile).href;

  const app = await electron.launch({ args: ["."], cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test", OPENCORD_TEST_USER_DATA: userData, ELECTRON_RENDERER_URL: "" } });
  try {
    const page = await app.firstWindow();
    await expect(page).toHaveTitle("OpenCord");
    const shellUrl = page.url();

    for (const attempt of ["location", "anchor"] as const) {
      await page.evaluate(({ url, attempt }) => {
        if (attempt === "location") { location.href = url; return; }
        const link = document.createElement("a");
        link.href = url;
        document.body.append(link);
        link.click();
      }, { url: payloadUrl, attempt });
      await page.waitForTimeout(500);
      expect(page.url(), `навигация через ${attempt} должна быть заблокирована`).toBe(shellUrl);
    }

    // Оболочка цела: блокировка не должна оставлять окно в подвешенной загрузке.
    // Состояние снимается напрямую — после прерванной навигации Playwright ещё
    // считает переход незавершённым, хотя документ уже давно на месте.
    expect(await page.evaluate(() => ({ bridge: typeof window.openCord, title: document.title, readyState: document.readyState }))).toEqual({ bridge: "object", title: "OpenCord", readyState: "complete" });
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.isLoading() ?? true)).toBe(false);

    // Микрофон оболочке выдаётся молча, без запроса — это и есть причина, по которой
    // доверие нельзя выдавать по префиксу file://.
    expect(await page.evaluate(() => navigator.permissions.query({ name: "microphone" as PermissionName }).then((status) => status.state))).toBe("granted");

    // Тот же preload и та же сессия, но другой файл на диске: разрешения не наследуются.
    const outsider = await app.evaluate(async ({ BrowserWindow }, args) => {
      const window = new BrowserWindow({ show: false, webPreferences: { preload: args.preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
      await window.loadURL(args.url);
      const state: unknown = await window.webContents.executeJavaScript(`navigator.permissions.query({ name: "microphone" }).then((status) => status.state)`);
      window.destroy();
      return state;
    }, { url: payloadUrl, preload: path.resolve("dist-electron", "preload.js") });
    expect(outsider).toBe("denied");
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(payloadDirectory, { recursive: true, force: true });
  }
});
