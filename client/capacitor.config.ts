import type { CapacitorConfig } from "@capacitor/cli";

// Мобильный прототип OpenCord. Оболочка упаковывает статический экспорт Next.js
// (webDir: out) в WebView; см. docs/mobile-android-prototype.md.
//
// androidScheme: "http" — происхождение локальной оболочки http://localhost.
// Это не ослабляет защиту канала: подключение к серверам по-прежнему возможно
// только по https://-адресам (wss://), cleartext запрещён (см. AndroidManifest).
const config: CapacitorConfig = {
  appId: "org.opencord.mobile",
  appName: "OpenCord",
  webDir: "out",
  server: {
    androidScheme: "http",
  },
};

export default config;
