"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

export interface LocalIdentity {
  publicKey: string;
  fingerprint: string;
  discriminator: string;
}

export interface LocalIdentityState {
  identity: LocalIdentity | null;
  status: "loading" | "ready" | "unavailable";
  publicKeyCopied: boolean;
  publicKeyCopyFailed: boolean;
  copyPublicKey: () => Promise<void>;
  reset: () => void;
}

/**
 * Локальная криптографическая идентичность для экрана настроек.
 *
 * Общая для десктопного диалога и мобильного экрана: сброс ключа — необратимая
 * операция, и её поведение (включая уведомление вызывающего кода через
 * `onReset`) не должно расходиться между платформами.
 */
export function useLocalIdentity(active: boolean, onReset?: (identity: LocalIdentity) => void): LocalIdentityState {
  const { t } = useI18n();
  const [identity, setIdentity] = useState<LocalIdentity | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [publicKeyCopied, setPublicKeyCopied] = useState(false);
  const [publicKeyCopyFailed, setPublicKeyCopyFailed] = useState(false);

  useEffect(() => {
    if (!active) return;
    void window.openCord?.identity
      .getOrCreate()
      .then((value) => { setIdentity(value); setStatus("ready"); })
      .catch(() => { setIdentity(null); setStatus("unavailable"); });
  }, [active]);

  const reset = useCallback((): void => {
    void window.openCord?.identity
      .reset()
      .then((value) => {
        setIdentity(value);
        setStatus("ready");
        setPublicKeyCopied(false);
        setPublicKeyCopyFailed(false);
        onReset?.(value);
      })
      .catch(() => { setIdentity(null); setStatus("unavailable"); });
  }, [onReset]);

  const copyPublicKey = useCallback(async (): Promise<void> => {
    if (!identity) return;
    setPublicKeyCopyFailed(false);
    try {
      if (!navigator.clipboard?.writeText) throw new Error(t.settings.clipboardUnavailable);
      await navigator.clipboard.writeText(identity.publicKey);
      setPublicKeyCopied(true);
    } catch {
      setPublicKeyCopyFailed(true);
    }
  }, [identity, t]);

  return { identity, status, publicKeyCopied, publicKeyCopyFailed, copyPublicKey, reset };
}
