import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("packaged renderer loads and runs the local RNNoise AudioWorklet", async () => {
  const mediaDirectory = path.resolve("out", "_next", "static", "media");
  const mediaFiles = await readdir(mediaDirectory);
  const workletFile = mediaFiles.find((file) => file.startsWith("workletProcessor.") && file.endsWith(".js"));
  const wasmFile = mediaFiles.find((file) => file.startsWith("rnnoise_simd.") && file.endsWith(".wasm"));
  expect(workletFile).toBeTruthy();
  expect(wasmFile).toBeTruthy();

  const userData = await mkdtemp(path.join(tmpdir(), "opencord-rnnoise-test-"));
  const app = await electron.launch({ args: ["."], cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test", OPENCORD_TEST_USER_DATA: userData, ELECTRON_RENDERER_URL: "" } });
  try {
    const page = await app.firstWindow();
    await expect(page).toHaveTitle("OpenCord");
    const result = await page.evaluate(async ({ workletFile, wasmFile }) => {
      const load = <T extends XMLHttpRequestResponseType>(relativePath: string, responseType: T): Promise<XMLHttpRequest["response"]> => new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("GET", new URL(relativePath, location.href).href);
        request.responseType = responseType;
        request.addEventListener("load", () => resolve(request.response));
        request.addEventListener("error", () => reject(new Error(`Unable to load ${relativePath}`)));
        request.send();
      });
      const workletSource = await load(`_next/static/media/${workletFile}`, "text") as string;
      const wasmBinary = await load(`_next/static/media/${wasmFile}`, "arraybuffer") as ArrayBuffer;
      const context = new AudioContext({ sampleRate: 48_000 });
      const blobUrl = URL.createObjectURL(new Blob([workletSource], { type: "text/javascript" }));
      let processorError = false;
      try {
        await context.audioWorklet.addModule(blobUrl);
        const processor = new AudioWorkletNode(context, "@sapphi-red/web-noise-suppressor/rnnoise", { processorOptions: { maxChannels: 1, wasmBinary } });
        processor.addEventListener("processorerror", () => { processorError = true; });
        const oscillator = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        oscillator.connect(processor).connect(destination);
        oscillator.start();
        await context.resume();
        await new Promise((resolve) => setTimeout(resolve, 150));
        oscillator.stop();
        processor.port.postMessage("destroy");
        processor.disconnect();
        return { processorError, sampleRate: context.sampleRate, workletBytes: workletSource.length, wasmBytes: wasmBinary.byteLength };
      } finally {
        URL.revokeObjectURL(blobUrl);
        await context.close();
      }
    }, { workletFile: workletFile!, wasmFile: wasmFile! });

    expect(result).toMatchObject({ processorError: false, sampleRate: 48_000 });
    expect(result.workletBytes).toBeGreaterThan(10_000);
    expect(result.wasmBytes).toBeGreaterThan(100_000);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
