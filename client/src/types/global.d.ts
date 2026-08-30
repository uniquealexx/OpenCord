import type { OpenCordBridge } from "@/shared/bridge";
import type { NativeShell } from "@/platform/native-shell";

declare global {
  interface Window {
    openCord?: OpenCordBridge;
    /** Устанавливается только в Android-оболочке; вызывается из MainActivity. */
    __opencordNative?: NativeShell;
  }
}

export {};
