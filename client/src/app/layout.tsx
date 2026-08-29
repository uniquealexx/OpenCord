import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "OpenCord", description: "Open-source communication client" };

// viewport-fit=cover + env(safe-area-inset-*) в .app-shell дают корректные отступы
// от статус-бара и системных жестов в мобильной оболочке (на десктопе insets равны нулю).
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

/**
 * Страховка на случай, если в интерфейс когда-нибудь попадёт инъекция: сейчас в клиенте
 * нет ни `dangerouslySetInnerHTML`, ни рендера markdown как HTML, но и сетки безопасности
 * не было. Инъекция в renderer получила бы доступ к мосту `window.openCord` — загрузке
 * вложений, SSH-деплою, подписи идентичности, — поэтому политика режет всё лишнее.
 *
 * Реальные потребности приложения: превью и аватары приходят как `data:`, кэш видео —
 * как `file:`, rnnoise компилирует WebAssembly и подключает AudioWorklet через `blob:`
 * (см. `shared/rnnoise-processor.ts`), а статический экспорт Next.js встраивает
 * flight-данные inline-скриптами. `connect-src` открыт для ws/wss/http/https: сервер
 * задаёт пользователь, поэтому список хостов заранее неизвестен.
 *
 * Заголовок передаётся через meta: renderer грузится с `file://`, где HTTP-заголовков
 * и `onHeadersReceived` нет.
 */
const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: file:",
  "media-src 'self' data: blob: file:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob: file: ws: wss: http: https:",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  // Язык по умолчанию — английский; I18nRoot обновляет атрибут при смене языка в настройках.
  return (
    <html lang="en" className="dark">
      <head>
        <meta httpEquiv="Content-Security-Policy" content={contentSecurityPolicy} />
      </head>
      <body>{children}</body>
    </html>
  );
}
