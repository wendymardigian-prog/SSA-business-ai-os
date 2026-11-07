"use client";

import { useEffect, useState } from "react";
import type { LinkPreview } from "@/lib/link-preview/parse";

/**
 * La tarjeta de un link, una sola vez por sesion del navegador. Vive afuera de los componentes porque un mensaje se
 * vuelve a montar cuando se confirma un envio y cuando se cambia de conversacion, y no tiene sentido volver a pedirla.
 * Lo que falla por el tope o por la red no se guarda: la proxima vez se puede pedir.
 */
const known = new Map<string, LinkPreview | null>();
const running = new Map<string, Promise<LinkPreview | null>>();

function request(url: string): Promise<LinkPreview | null> {
  const current = running.get(url);
  if (current) return current;
  const pending = fetch("/api/v1/link-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) })
    .then(async (response) => {
      if (!response.ok) return null;
      const { preview } = (await response.json()) as { preview: LinkPreview | null };
      known.set(url, preview);
      return preview;
    })
    .catch(() => null)
    .finally(() => running.delete(url));
  running.set(url, pending);
  return pending;
}

/** `enabled` en false no pide nada: lo usa la tarjeta hasta que el mensaje entra en pantalla. */
export function useLinkPreview(url: string | null, enabled: boolean): LinkPreview | null {
  const [state, setState] = useState<{ url: string; preview: LinkPreview | null } | null>(null);

  useEffect(() => {
    if (!url || !enabled || known.has(url)) return;
    let cancelled = false;
    void request(url).then((preview) => {
      if (!cancelled) setState({ url, preview });
    });
    return () => {
      cancelled = true;
    };
  }, [url, enabled]);

  if (!url) return null;
  if (known.has(url)) return known.get(url) ?? null;
  return state?.url === url ? state.preview : null;
}
