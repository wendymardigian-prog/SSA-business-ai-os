"use client";

/**
 * Los tres estados en que el booker no puede ofrecer horarios (F58).
 *
 * El texto y el boton salen de `resolveUnavailableMessage` del nucleo: lo que
 * se configura en el editor es exactamente lo que se ve acá.
 *
 * - `no_slots`: hay agenda, pero en ese rango no queda nada.
 * - `unavailable`: la persona no puede recibir agendas (calendario caído,
 *   perfil apagado). Se ofrece reintentar.
 * - `load_error`: falló la consulta. También se ofrece reintentar.
 */

import type { UnavailableKey, UnavailableMessages } from "@/lib/scheduling/types";
import { buildCtaHref, resolveUnavailableMessage } from "@/lib/scheduling/booker/unavailable";

export function UnavailableState({
  messages,
  which,
  eventTitle,
  hostName,
  onRetry,
}: {
  messages: UnavailableMessages | null;
  which: UnavailableKey;
  eventTitle: string;
  hostName: string;
  onRetry?: () => void;
}) {
  const vars = { event_title: eventTitle, host_name: hostName };
  const msg = resolveUnavailableMessage({ unavailable_messages: messages }, which, vars);
  const href = msg.cta ? buildCtaHref(msg.cta, vars) : null;

  return (
    <div className="flex flex-col items-start gap-3 p-5" role="status">
      <h2 className="text-base font-semibold">{msg.title}</h2>
      <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{msg.body}</p>
      <div className="flex flex-wrap gap-2">
        {href && msg.cta && (
          <a
            href={href}
            target={msg.cta.kind === "link" ? "_blank" : undefined}
            rel={msg.cta.kind === "link" ? "noopener noreferrer" : undefined}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            {msg.cta.label}
          </a>
        )}
        {msg.showRetry && onRetry && (
          <button type="button" onClick={onRetry} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
            Probar de nuevo
          </button>
        )}
      </div>
    </div>
  );
}
