"use client";

import { memo, useMemo } from "react";
import { messageSegments } from "@/lib/messages/text-links";

/**
 * El texto de un mensaje con sus links clicables. Va adentro del `<p>` que ya tenia cada burbuja, que decide los saltos
 * de linea y el tamaño. El link hereda el color de la burbuja: un fondo de marca y uno gris piden colores distintos.
 *
 * `outbound`: en un mensaje nuestro, un link medido va directo al destino (ver `trackedLinkDestination`).
 */
export const MessageText = memo(function MessageText({ text, outbound = false }: { text: string | null | undefined; outbound?: boolean }) {
  const segments = useMemo(() => messageSegments(text, outbound), [text, outbound]);
  return (
    <>
      {segments.map((segment, index) =>
        segment.type === "link" ? (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="break-all underline underline-offset-2 hover:opacity-80 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {segment.value}
          </a>
        ) : (
          segment.value
        ),
      )}
    </>
  );
});
