// Runs electron-builder for the Linux client targets.
// electron-builder >= 26 assembles AppImage with the native mksquashfs binary and
// deb with the native fpm binary; neither tool exists for Windows hosts, so the
// Linux targets must be built on a Linux/macOS host. Use WSL2 or the CI ubuntu
// runner.
import { spawnSync } from "node:child_process";

if (process.platform === "win32") {
  console.error(
    "Linux targets (AppImage, deb) cannot be built on Windows: electron-builder 26 requires the " +
      "native mksquashfs and fpm tools, which exist only on Linux and macOS. " +
      "Build them inside WSL2 (with a checkout on the WSL filesystem) or on the CI ubuntu runner.",
  );
  process.exit(1);
}
const result = spawnSync(
  "npx",
  ["electron-builder", "--linux", "appimage", "deb", "--x64", "--publish", "never"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
