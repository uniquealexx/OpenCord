// Сборка Android APK Capacitor-оболочки (client/android).
//
// Запускать после `pnpm build:renderer && cap sync android` (см. скрипт android:debug).
// JAVA_HOME/ANDROID_HOME берутся из окружения; если не заданы, на Windows
// используются JBR из Android Studio и стандартный путь SDK (%LOCALAPPDATA%\Android\Sdk).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const flavor = process.argv[2] === "release" ? "release" : "debug";
const variant = flavor === "release" ? "assembleRelease" : "assembleDebug";
const androidDir = path.resolve(import.meta.dirname, "..", "android");

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

const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const result = process.platform === "win32"
  ? spawnSync("cmd", ["/c", gradlew, variant, "--console=plain"], { cwd: androidDir, env, stdio: "inherit" })
  : spawnSync(gradlew, [variant, "--console=plain"], { cwd: androidDir, env, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);

const apkName = flavor === "release" ? "app-release.apk" : "app-debug.apk";
const apkPath = path.join(androidDir, "app", "build", "outputs", "apk", flavor, apkName);
if (!existsSync(apkPath)) {
  console.error(`APK не найден после сборки: ${apkPath}`);
  process.exit(1);
}
console.info(`APK: ${apkPath}`);

