import { ClientApp } from "@/components/client-app";
import { TitleBar } from "@/components/title-bar";

export default function Home(): React.ReactElement {
  return <div className="flex h-screen w-screen flex-col overflow-hidden"><TitleBar /><ClientApp /></div>;
}
