// Точка соприкосновения renderer и Android-оболочки (`MainActivity.java`).
//
// Нативный слой умеет то, чего WebView не знает сам: реальные системные отступы,
// высоту экранной клавиатуры и системную кнопку «Назад». Он вызывает методы
// `window.__opencordNative`, объявленные здесь; всё остальное приложение работает
// с обычными React-хуками и CSS-переменными.
//
// В Electron и в браузере объект не устанавливается: хуки просто ничего не делают.

/** Обработчик «Назад»; возвращает true, если событие поглощено (что-то закрылось). */
export type BackHandler = () => boolean;

/** Последний зарегистрированный обработчик получает событие первым: это порядок
 *  вложенности слоёв (диалог поверх панели поверх экрана). */
const backHandlers: BackHandler[] = [];
let exitHintHandler: (() => void) | null = null;

export function registerBackHandler(handler: BackHandler): () => void {
  backHandlers.push(handler);
  return () => {
    const index = backHandlers.lastIndexOf(handler);
    if (index >= 0) backHandlers.splice(index, 1);
  };
}

export function setExitHintHandler(handler: (() => void) | null): void {
  exitHintHandler = handler;
}

/** Экспортируется для тестов: тот же путь, что вызывает нативный слой. */
export function runBackHandlers(): boolean {
  for (let index = backHandlers.length - 1; index >= 0; index -= 1) {
    if (backHandlers[index]?.() === true) return true;
  }
  return false;
}

/**
 * Высота клавиатуры.
 *
 * Единственный источник — `visualViewport`: он измеряет ту часть окна, которую
 * перестало быть видно, то есть ровно то смещение, которое нужно вёрстке. Это
 * верно в обоих случаях: если система сама ужала окно под клавиатуру
 * (`adjustResize`), скрытой части нет и смещение равно нулю — раскладка уже
 * учла клавиатуру; если окно не ужалось, скрытая часть и есть клавиатура.
 *
 * Нативный IME-инсет сюда не годится: он сообщает полную высоту клавиатуры
 * независимо от того, ужато ли уже окно, и при `adjustResize` смещение
 * применялось дважды — лист уезжал вверх на двойную высоту клавиатуры.
 */
let keyboardHeight = 0;

/** Изменения меньше этого — не клавиатура, а панели браузера и дрожание вьюпорта. */
const KEYBOARD_MIN_HEIGHT = 80;

function toPixels(value: number): number {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
}

/**
 * Раскладывает системные отступы в CSS-переменные. Android WebView не заполняет
 * `env(safe-area-inset-*)` предсказуемо, поэтому вёрстка читает эти переменные
 * (на десктопе они не заданы и значения по умолчанию равны нулю).
 */
export function applyInsets(top: number, bottom: number, left: number, right: number): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--android-inset-top", `${toPixels(top)}px`);
  root.style.setProperty("--android-inset-bottom", `${toPixels(bottom)}px`);
  root.style.setProperty("--android-inset-left", `${toPixels(left)}px`);
  root.style.setProperty("--android-inset-right", `${toPixels(right)}px`);
}

/** Экспортируется для тестов: та же точка входа, что использует наблюдатель вьюпорта. */
export function applyKeyboardHeight(height: number): void {
  if (typeof document === "undefined") return;
  keyboardHeight = height >= KEYBOARD_MIN_HEIGHT ? toPixels(height) : 0;
  const root = document.documentElement;
  root.style.setProperty("--android-keyboard-height", `${keyboardHeight}px`);
  root.dataset.keyboard = keyboardHeight > 0 ? "open" : "closed";
}

export function installKeyboardTracking(): () => void {
  const viewport = typeof window === "undefined" ? undefined : window.visualViewport;
  if (!viewport) return () => undefined;
  const update = (): void => applyKeyboardHeight(window.innerHeight - viewport.height - viewport.offsetTop);
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  return () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
  };
}

export interface NativeShell {
  setInsets(top: number, bottom: number, left: number, right: number): void;
  back(): boolean;
  exitHint(): void;
}

export function installNativeShell(): void {
  if (typeof window === "undefined") return;
  const shell: NativeShell = {
    setInsets: applyInsets,
    back: runBackHandlers,
    exitHint: () => exitHintHandler?.(),
  };
  (window as Window & { __opencordNative?: NativeShell }).__opencordNative = shell;
  installKeyboardTracking();
}
