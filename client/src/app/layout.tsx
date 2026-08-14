import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "OpenCord", description: "Open-source communication client" };

// viewport-fit=cover + env(safe-area-inset-*) в .app-shell дают корректные отступы
// от статус-бара и системных жестов в мобильной оболочке (на десктопе insets равны нулю).
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  // Язык по умолчанию — английский; I18nRoot обновляет атрибут при смене языка в настройках.
  return <html lang="en" className="dark"><body>{children}</body></html>;
}
