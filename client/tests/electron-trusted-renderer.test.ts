import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isTrustedRendererUrl } from "../electron/trusted-renderer";

const rendererRoot = path.resolve("/opt/opencord/out");
const indexFile = path.join(rendererRoot, "index.html");
const indexUrl = pathToFileURL(indexFile).href;
const trust = (url: string | null | undefined, caseInsensitive = false): boolean =>
  isTrustedRendererUrl(url, { allowedFiles: [indexFile], caseInsensitive });

describe("isTrustedRendererUrl", () => {
  it("доверяет ровно той странице, которую загружает оболочка", () => {
    expect(trust(indexUrl)).toBe(true);
  });

  it("не доверяет другим локальным файлам", () => {
    // Каталог предпросмотра вложений: туда попадает контент, присланный сервером.
    expect(trust(pathToFileURL(path.resolve("/tmp/opencord-previews/payload.html")).href)).toBe(false);
    // Соседний файл внутри самого экспорта тоже не является оболочкой.
    expect(trust(pathToFileURL(path.join(rendererRoot, "404.html")).href)).toBe(false);
    expect(trust("file:///")).toBe(false);
    expect(trust("file://")).toBe(false);
  });

  it("не поддаётся обходу через точечные сегменты пути", () => {
    const rootUrl = pathToFileURL(rendererRoot).href;
    expect(trust(`${rootUrl}/../../evil/index.html`)).toBe(false);
    // Тот же файл, записанный через `..`, остаётся доверенным: разбор URL нормализует путь.
    expect(trust(`${rootUrl}/../out/index.html`)).toBe(true);
  });

  it("не принимает UNC-путь на чужую машину с совпадающим pathname", () => {
    expect(trust("file://attacker.example/opt/opencord/out/index.html")).toBe(false);
  });

  it("игнорирует query и fragment: документ тот же самый", () => {
    expect(trust(`${indexUrl}#settings`)).toBe(true);
    expect(trust(`${indexUrl}?x=1`)).toBe(true);
  });

  it("сравнивает percent-кодирование по смыслу, а не побайтово", () => {
    const spaced = path.resolve("/opt/open cord/out/index.html");
    const encoded = pathToFileURL(spaced).href;
    const options = { allowedFiles: [spaced], caseInsensitive: false };
    expect(encoded).toContain("%20");
    expect(isTrustedRendererUrl(encoded, options)).toBe(true);
    // Тот же путь без percent-кодирования пробела — тоже тот же самый файл.
    expect(isTrustedRendererUrl(encoded.replaceAll("%20", " "), options)).toBe(true);
  });

  it("учитывает регистронезависимость файловой системы, когда она включена", () => {
    const shouted = indexUrl.replace("/out/index.html", "/OUT/INDEX.HTML");
    expect(trust(shouted, true)).toBe(true);
    expect(trust(shouted, false)).toBe(false);
  });

  it("отклоняет не-file схемы и мусор", () => {
    expect(trust("https://example.com/index.html")).toBe(false);
    expect(trust("javascript:alert(1)")).toBe(false);
    expect(trust("not a url")).toBe(false);
    expect(trust(null)).toBe(false);
    expect(trust(undefined)).toBe(false);
    expect(trust("")).toBe(false);
  });

  it("в dev-режиме сверяет origin dev-сервера и не доверяет диску", () => {
    const options = { developmentUrl: "http://localhost:3000", allowedFiles: [indexFile] };
    expect(isTrustedRendererUrl("http://localhost:3000/", options)).toBe(true);
    expect(isTrustedRendererUrl("http://localhost:3000/some/page", options)).toBe(true);
    expect(isTrustedRendererUrl("http://localhost:3001/", options)).toBe(false);
    expect(isTrustedRendererUrl("http://evil.example/", options)).toBe(false);
    expect(isTrustedRendererUrl(indexUrl, options)).toBe(false);
  });
});
