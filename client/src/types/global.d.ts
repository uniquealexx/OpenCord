import type { OpenCordBridge } from "@/shared/bridge";

declare global {
  interface Window {
    openCord?: OpenCordBridge;
  }
}

export {};
