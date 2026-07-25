import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("packaged renderer exposes only the typed OpenCord bridge", async () => {
  const userData = await mkdtemp(path.join(tmpdir(), "opencord-electron-test-"));
  const serverData = await mkdtemp(path.join(tmpdir(), "opencord-server-test-"));
  const port = 33210;
  const server = spawn(process.execPath, [path.resolve("..", "server", "dist", "index.js")], { env: { ...process.env, PORT: String(port), PGLITE_DATA_DIR: serverData, LOG_LEVEL: "silent" }, stdio: "ignore" });
  await waitForServer(`http://127.0.0.1:${port}/health`);
  const app = await electron.launch({ args: ["."], cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test", OPENCORD_TEST_USER_DATA: userData, ELECTRON_RENDERER_URL: process.env.ELECTRON_RENDERER_URL ?? "" } });
  const electronErrors: string[] = [];
  app.process().stderr?.on("data", (chunk: Buffer) => electronErrors.push(chunk.toString("utf8")));
  const page = await app.firstWindow();
  const rendererErrors: string[] = [];
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) rendererErrors.push(`console.${message.type()}: ${message.text()}`); });
  page.on("pageerror", (error) => rendererErrors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => rendererErrors.push(`requestfailed: ${request.url()} — ${request.failure()?.errorText ?? "unknown"}`));
  await expect(page).toHaveTitle("OpenCord");
  const surface = await page.evaluate(() => ({
    hasBridge: typeof window.openCord === "object",
    bridgeKeys: Object.keys(window.openCord ?? {}).sort(),
    hasNodeRequire: "require" in window,
  }));
  expect(surface, electronErrors.join("\n")).toEqual({ hasBridge: true, bridgeKeys: ["attachments", "deployment", "identity", "storage", "window"], hasNodeRequire: false });

  const onboardingName = page.getByPlaceholder("Отображаемое имя");
  await page.waitForTimeout(process.env.ELECTRON_RENDERER_URL ? 15_000 : 1_000);
  if (!(await onboardingName.isVisible())) {
    const diagnostics = await page.evaluate(() => ({ href: location.href, scripts: [...document.scripts].map((script) => script.src), readyState: document.readyState }));
    throw new Error(`Renderer did not hydrate: ${JSON.stringify({ rendererErrors, diagnostics })}`);
  }
  await expect(onboardingName).toBeVisible();
  await page.screenshot({ path: "test-results/onboarding.png" });
  await onboardingName.fill("Лина");
  await page.getByRole("button", { name: "Создать локальный профиль" }).click();
  await expect(page.getByRole("heading", { name: "Главный экран" })).toBeVisible();
  await page.getByTitle("Подключиться").click();
  await page.getByLabel("HTTPS-адрес сервера").fill(`http://127.0.0.1:${port}`);
  await page.getByRole("button", { name: "Подключиться к серверу" }).click();
  await expect(page.getByText("подключено")).toBeVisible({ timeout: 10_000 });
  const composer = page.getByLabel(/Написать в #общий/);
  await composer.fill("Первое сетевое сообщение");
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(page.getByText("Первое сетевое сообщение")).toBeVisible();
  await page.screenshot({ path: "test-results/chat.png" });
  await page.evaluate(() => window.openCord?.storage.reset());
  await app.close();
  server.kill();
  await rm(userData, { recursive: true, force: true });
  await rm(serverData, { recursive: true, force: true });
});

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* Server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("OpenCord test server did not start");
}
