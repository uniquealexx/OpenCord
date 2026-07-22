import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "OpenCord", description: "Open-source communication client" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return <html lang="ru" className="dark"><body>{children}</body></html>;
}
