import { ClientApp } from "@/components/client-app";
import { TitleBar } from "@/components/title-bar";
import { I18nRoot } from "@/lib/i18n";

export default function Home(): React.ReactElement {
  // Оболочка растягивается через fixed inset-0, а не h-screen/w-screen: единицы
  // vh/vw считаются от немасштабированного вьюпорта, и при масштабе интерфейса
  // меньше 100% (`zoom` в настройках) окно оказывалось меньше экрана — вёрстка
  // «отъезжала» от краёв. У фиксированного элемента inset:0 всегда равен экрану.
  return <I18nRoot><div className="app-shell fixed inset-0 flex flex-col overflow-hidden"><TitleBar /><ClientApp /></div></I18nRoot>;
}
