"use client";

import { memo, useEffect, useState } from "react";
import { linkPreviewCapability } from "@/lib/channels/link-preview";
import { firstPreviewableLink } from "@/lib/messages/text-links";
import { ComposerLinkCard } from "./link-preview-card";

const DEBOUNCE_MS = 600;

/**
 * La tarjeta del link que se esta escribiendo. La caja de texto no puede pintar links, asi que se muestra arriba. Espera a
 * que se deje de escribir: una URL a medio tipear es otra pagina, y pedirla no sirve para nada.
 */
export const ComposerLinkPreview = memo(function ComposerLinkPreview({ text, provider, platform }: { text: string; provider: string | null | undefined; platform: string | null | undefined }) {
  const capability = linkPreviewCapability(provider, platform);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!capability.card) return;
    const timer = setTimeout(() => setUrl(firstPreviewableLink(text, true)), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, capability.card]);

  // Se borro el link: la tarjeta se va enseguida, sin esperar.
  if (!capability.card || !url || !firstPreviewableLink(text, true)) return null;
  return <ComposerLinkCard url={url} notice={capability.notice} />;
});
