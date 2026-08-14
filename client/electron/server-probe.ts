// Проверка адреса OpenCord Server перенесена в общий модуль src/shared/server-probe,
// чтобы её могли использовать и Electron-main, и мобильный адаптер (CapacitorHttp).
export { probeOpenCordServer, type HealthFetch } from "../src/shared/server-probe";
