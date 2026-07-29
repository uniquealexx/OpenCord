#!/usr/bin/env node

const repository = "uniquealexx/OpenCord";
const githubOrigin = "https://github.com";
const maxBundleSizeBytes = 2 * 1024 * 1024 * 1024;
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  return isPlainObject(value) && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function parseJson(input, label) {
  try {
    return JSON.parse(input);
  } catch {
    fail(`${label} содержит некорректный JSON.`);
  }
}

function parseSemver(value, label) {
  if (typeof value !== "string") fail(`${label} не является SemVer.`);
  const match = semverPattern.exec(value);
  if (!match) fail(`${label} не является корректной SemVer-версией: ${value}`);
  return {
    value,
    core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])],
    prerelease: match[4]?.split(".") ?? [],
  };
}

function compareSemver(leftValue, rightValue) {
  const left = parseSemver(leftValue, "Установленная версия");
  const right = parseSemver(rightValue, "Версия релиза");
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] < right.core[index]) return -1;
    if (left.core[index] > right.core[index]) return 1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1;
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) return BigInt(leftPart) < BigInt(rightPart) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function validateChannel(channel) {
  if (channel !== "stable") fail(`Канал обновлений пока не поддерживается: ${channel || "не указан"}. Доступен только stable.`);
}

function resolveRelease(apiResponse, channel) {
  validateChannel(channel);
  if (!isPlainObject(apiResponse) || apiResponse.draft !== false || apiResponse.prerelease !== false) {
    fail("GitHub вернул не опубликованный stable-релиз OpenCord.");
  }
  if (typeof apiResponse.tag_name !== "string" || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(apiResponse.tag_name)) {
    fail("GitHub stable-релиз содержит некорректный тег версии.");
  }
  const version = apiResponse.tag_name.slice(1);
  parseSemver(version, "Версия GitHub-релиза");
  if (!Array.isArray(apiResponse.assets)) fail("GitHub stable-релиз не содержит списка артефактов.");
  const matchingAssets = apiResponse.assets.filter((asset) => isPlainObject(asset) && asset.name === "release-manifest.json");
  if (matchingAssets.length !== 1) fail("В stable-релизе должен быть ровно один release-manifest.json.");
  const manifestUrl = matchingAssets[0].browser_download_url;
  const expectedUrl = `${githubOrigin}/${repository}/releases/download/${apiResponse.tag_name}/release-manifest.json`;
  if (manifestUrl !== expectedUrl) fail("GitHub stable-релиз содержит неожиданный URL manifest.");
  process.stdout.write(`${version}\t${manifestUrl}\n`);
}

function validateManifest(manifest, channel, releaseVersion, installedVersion, installedChannel, installedProtocol) {
  validateChannel(channel);
  if (!hasExactKeys(manifest, ["schemaVersion", "product", "releaseChannel", "version", "protocolVersion", "commit", "publishedAt", "releaseUrl", "artifacts"])) {
    fail("release-manifest.json не соответствует поддерживаемому контракту.");
  }
  if (manifest.schemaVersion !== 1 || manifest.product !== "opencord" || manifest.releaseChannel !== channel) fail("Manifest предназначен для другого продукта, формата или канала.");
  const release = parseSemver(manifest.version, "Версия manifest");
  if (release.prerelease.length !== 0 || manifest.version !== releaseVersion) fail("Версия manifest не совпадает со stable GitHub-релизом.");
  if (!Number.isInteger(manifest.protocolVersion) || manifest.protocolVersion < 1) fail("Manifest содержит некорректную версию протокола.");
  if (!Number.isInteger(installedProtocol) || installedProtocol < 1) fail("Установленный сервер сообщил некорректную версию протокола.");
  if (!["development", "beta", "stable"].includes(installedChannel)) fail("Установленный сервер сообщил некорректный release channel.");
  if (manifest.protocolVersion !== installedProtocol) fail(`Автообновление изменяет протокол ${installedProtocol} -> ${manifest.protocolVersion}. Обновите OpenCord Client и выполните развёртывание из него.`);
  if (typeof manifest.commit !== "string" || !/^[a-f0-9]{40}$/u.test(manifest.commit)) fail("Stable manifest не содержит корректный commit.");
  if (typeof manifest.publishedAt !== "string" || Number.isNaN(Date.parse(manifest.publishedAt))) fail("Stable manifest не содержит корректную дату публикации.");
  const tag = `v${manifest.version}`;
  if (manifest.releaseUrl !== `${githubOrigin}/${repository}/releases/tag/${tag}`) fail("Manifest содержит неожиданный URL релиза.");
  if (!hasExactKeys(manifest.artifacts, ["serverBundle", "serverImage", "windowsClient"])) fail("Manifest содержит некорректный список артефактов.");
  const bundle = manifest.artifacts.serverBundle;
  if (!hasExactKeys(bundle, ["fileName", "downloadUrl", "sha256", "sizeBytes", "bundleFormatVersion", "target", "installModes"])) fail("Описание server bundle не соответствует контракту.");
  const expectedFileName = `opencord-server-${manifest.version}.tar.gz`;
  const expectedDownloadUrl = `${githubOrigin}/${repository}/releases/download/${tag}/${expectedFileName}`;
  if (bundle.fileName !== expectedFileName || bundle.downloadUrl !== expectedDownloadUrl) fail("Manifest содержит неожиданный server bundle URL.");
  if (!/^[a-f0-9]{64}$/u.test(bundle.sha256)) fail("Manifest содержит некорректную SHA-256 server bundle.");
  if (!Number.isSafeInteger(bundle.sizeBytes) || bundle.sizeBytes < 1 || bundle.sizeBytes > maxBundleSizeBytes) fail("Размер server bundle вне допустимого диапазона.");
  if (bundle.bundleFormatVersion !== 1 || !hasExactKeys(bundle.target, ["os", "arch"]) || bundle.target.os !== "linux" || bundle.target.arch !== "x64") fail("Server bundle предназначен для неподдерживаемой платформы или формата.");
  if (!Array.isArray(bundle.installModes) || bundle.installModes.length !== 2 || bundle.installModes[0] !== "docker" || bundle.installModes[1] !== "native") fail("Server bundle не поддерживает ожидаемые способы установки.");

  const comparison = compareSemver(installedVersion, manifest.version);
  const status = comparison < 0 || (comparison === 0 && installedChannel !== channel) ? "update" : comparison === 0 ? "current" : "newer";
  process.stdout.write([status, manifest.version, bundle.downloadUrl, bundle.sha256, String(bundle.sizeBytes), manifest.commit.slice(0, 12)].join("\t") + "\n");
}

let input = "";
for await (const chunk of process.stdin) input += chunk;
const modeIndex = process.argv.findIndex((argument) => argument === "resolve-release" || argument === "resolve-manifest");
if (modeIndex < 0) fail("Не указан режим проверки release channel.");
const mode = process.argv[modeIndex];
const args = process.argv.slice(modeIndex + 1);
const payload = parseJson(input, mode === "resolve-release" ? "Ответ GitHub Releases" : "release-manifest.json");

if (mode === "resolve-release") resolveRelease(payload, args[0] ?? "");
else validateManifest(payload, args[0] ?? "", args[1] ?? "", args[2] ?? "", args[3] ?? "", Number(args[4]));
