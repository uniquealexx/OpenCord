"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { registerBackHandler } from "@/platform/native-shell";

/**
 * Стек экранов для мобильного интерфейса.
 *
 * Телефонная навигация поэкранная, а не «всё на одном холсте»: у пользователя есть
 * история и ожидание, что «Назад» вернёт на предыдущий экран, а не закроет раздел
 * целиком. Стек хранит только ключи экранов — что именно рисовать, решает вызывающий
 * компонент; так один и тот же примитив годится и для настроек, и для чата.
 *
 * Пока стек глубже одного экрана, он перехватывает системную кнопку «Назад»
 * (см. `platform/native-shell.ts`); на самом нижнем экране событие уходит наружу,
 * и его обрабатывает общий стек приложения — обычно закрытием раздела.
 */
export interface ScreenStack<Key extends string> {
  /** Экран, который сейчас показан. */
  current: Key;
  /** Глубина стека: 1 — корневой экран. */
  depth: number;
  push: (key: Key) => void;
  /** Возвращает false, если возвращаться уже некуда (стек на корневом экране). */
  pop: () => boolean;
  reset: () => void;
}

export function useScreenStack<Key extends string>(root: Key): ScreenStack<Key> {
  const [stack, setStack] = useState<Key[]>([root]);

  const push = useCallback((key: Key) => setStack((current) => [...current, key]), []);
  const reset = useCallback(() => setStack([root]), [root]);
  // Результат считается по текущему состоянию, а не внутри апдейтера: React может
  // вызвать апдейтер отложенно и дважды, и возвращаемый флаг был бы недостоверным.
  const pop = useCallback((): boolean => {
    if (stack.length <= 1) return false;
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
    return true;
  }, [stack.length]);

  // Внутри раздела «Назад» поднимается на экран вверх; на корневом экране —
  // не перехватываем, чтобы раздел мог закрыться целиком.
  const nested = stack.length > 1;
  useEffect(() => {
    if (!nested) return;
    return registerBackHandler(() => {
      setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
      return true;
    });
  }, [nested]);

  return useMemo(
    () => ({ current: stack[stack.length - 1] ?? root, depth: stack.length, push, pop, reset }),
    [pop, push, reset, root, stack],
  );
}
