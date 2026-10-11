"use client";

import { useEffect, useRef } from "react";

/**
 * El widget de Cloudflare Turnstile (F11). Carga el script de Cloudflare una
 * sola vez, dibuja el widget con la site key PÚBLICA del formulario y avisa el
 * token. El token es de un solo uso: `resetKey` lo vuelve a pedir después de
 * cada intento.
 */
interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __ssaTurnstileLoading?: Promise<void>;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (window.__ssaTurnstileLoading) return window.__ssaTurnstileLoading;
  window.__ssaTurnstileLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      window.__ssaTurnstileLoading = undefined;
      reject(new Error("No se pudo cargar Turnstile"));
    };
    document.head.appendChild(script);
  });
  return window.__ssaTurnstileLoading;
}

export function TurnstileWidget({
  siteKey,
  onToken,
  onError,
  resetKey,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  onError?: () => void;
  resetKey: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const handlers = useRef({ onToken, onError });

  useEffect(() => {
    handlers.current = { onToken, onError };
  }, [onToken, onError]);

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(container.current, {
          sitekey: siteKey,
          callback: (token: string) => handlers.current.onToken(token),
          "expired-callback": () => handlers.current.onToken(null),
          "error-callback": () => {
            handlers.current.onToken(null);
            handlers.current.onError?.();
          },
        });
      })
      .catch(() => handlers.current.onError?.());
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetKey > 0 && widgetId.current && window.turnstile) {
      handlers.current.onToken(null);
      window.turnstile.reset(widgetId.current);
    }
  }, [resetKey]);

  return <div ref={container} className="min-h-[65px]" />;
}
