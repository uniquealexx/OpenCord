// Сборка Android APK Capacitor-оболочки (client/android).
//
// Запускать после `pnpm build:renderer && cap sync android` (см. скрипт android:debug).
// JAVA_HOME/ANDROID_HOME берутся из окружения; если не заданы, на Windows
// используются JBR из Android Studio и стандартный путь SDK (%LOCALAPPDATA%\Android\Sdk).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const flavor = process.argv[2] === "release" ? "release" : "debug";
const variant = flavor === "release" ? "assembleRelease" : "assembleDebug";
const androidDir = path.resolve(import.meta.dirname, "..", "android");

// Версия продукта из client/package.json уходит в versionName манифеста.
const clientPackage = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "..", "package.json"), "utf8"));
if (typeof clientPackage.version !== "string") {
  console.error("client/package.json не содержит version");
  process.exit(1);
}
const opencordVersion = clientPackage.version;

const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  ?? (process.platform === "win32" ? path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk") : null);

let javaHome = process.env.JAVA_HOME;
if (!javaHome && process.platform === "win32") {
  const jbr = "C:\\Program Files\\Android\\Android Studio\\jbr";
  if (existsSync(jbr)) javaHome = jbr;
}

const env = { ...process.env };
if (javaHome) env.JAVA_HOME = javaHome;
if (sdk) env.ANDROID_HOME = sdk;

if (!sdk || !existsSync(sdk)) {
  console.error("Android SDK не найден. Задайте ANDROID_HOME или установите SDK (см. docs/mobile-android-prototype.md).");
  process.exit(1);
}
if (!javaHome || !existsSync(javaHome)) {
  console.error("JDK 17+ не найден. Задайте JAVA_HOME (подходит JBR из Android Studio: C:\\Program Files\\Android\\Android Studio\\jbr).");
  process.exit(1);
}

console.info(`JAVA_HOME=${javaHome}`);
console.info(`ANDROID_HOME=${sdk}`);

// Путь к обёртке абсолютный: cmd.exe не ищет исполняемые файлы в рабочем каталоге
// дочернего процесса (и запрет может быть включён политикой NoDefaultCurrentDirectoryInExePath).
const gradlew = process.platform === "win32" ? path.join(androidDir, "gradlew.bat") : "./gradlew";
const gradleArgs = [variant, "--console=plain", `-PopencordVersion=${opencordVersion}`];
const result = process.platform === "win32"
  ? spawnSync("cmd", ["/c", gradlew, ...gradleArgs], { cwd: androidDir, env, stdio: "inherit" })
  : spawnSync(gradlew, gradleArgs, { cwd: androidDir, env, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);

const apkName = flavor === "release" ? "app-release.apk" : "app-debug.apk";
const apkPath = path.join(androidDir, "app", "build", "outputs", "apk", flavor, apkName);
if (!existsSync(apkPath)) {
  console.error(`APK не найден после сборки: ${apkPath}`);
  process.exit(1);
}
console.info(`APK: ${apkPath}`);

