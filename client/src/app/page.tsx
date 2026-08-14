import { ClientApp } from "@/components/client-app";
import { TitleBar } from "@/components/title-bar";
import { I18nRoot } from "@/lib/i18n";

export default function Home(): React.ReactElement {
  return <I18nRoot><div className="app-shell flex h-screen w-screen flex-col overflow-hidden"><TitleBar /><ClientApp /></div></I18nRoot>;
}
