import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "OpenCord", description: "Open-source communication client" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  // Язык по умолчанию — английский; I18nRoot обновляет атрибут при смене языка в настройках.
  return <html lang="en" className="dark"><body>{children}</body></html>;
}
