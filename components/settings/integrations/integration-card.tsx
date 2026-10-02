"use client";

import Link from "next/link";
import { AlertTriangle, Check, Plug, TriangleAlert } from "lucide-react";
import { STATUS_LABELS, type IntegrationStatus } from "@/lib/integrations/status";
import { CHIP_LABELS, chipsOf, type ProviderDefinition } from "@/lib/integrations/providers";
import { formatConnectedSince, formatLastRefreshed, formatOAuthExpiry } from "@/lib/integrations/format";
import { GoogleServices } from "./google-services";
import type { IntegrationCardData } from "./types";

/**
 * La card de una integracion (F2, G2).
 *
 * Compacta a proposito: icono, nombre, chips, una linea, el estado, la
 * cuenta, la barra de uso y UN boton que ahora navega al detalle (G5) en vez
 * de abrir un modal. Todo el formulario vive ahi. Antes la pantalla era una
 * columna con los campos a la vista, y con quince integraciones eso no se
 * puede leer.
 */

const STATUS_STYLES: Record<IntegrationStatus, string> = {
  connected: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  attention: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  error: "bg-red-500/10 text-red-600 dark:text-red-400",
  not_connected: "bg-muted text-muted-foreground",
};

function StatusBadge({ status }: { status: IntegrationStatus }) {
  const Icon = status === "connected" ? Check : status === "not_connected" ? Plug : TriangleAlert;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function IntegrationCard({
  provider,
  data,
  detailHref,
}: {
  provider: ProviderDefinition;
  data: IntegrationCardData;
  /** A donde navega el boton (G5). Ya lleva el chip y "Requiere atencion" vigentes, para volver igual. */
  detailHref: string;
}) {
  const connected = data.status !== "not_connected";
  const usage = data.usage;
  const chips = chipsOf(provider);
  const connectedSince = formatConnectedSince(data.connectedAt);

  // Client ID y Secret guardados, pero nadie autorizo la cuenta todavia: la
  // integracion igual figura "Conectada" (preexistente, no se cambia), pero
  // la card lo dice.
  const missingAuthorization = provider.connection === "oauth_app" && connected && !data.oauth;

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">{provider.label}</h3>
        <StatusBadge status={data.status} />
      </div>

      {chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              {CHIP_LABELS[chip]}
            </span>
          ))}
        </div>
      )}

      <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{provider.description}</p>

      {data.account && (
        <p className="mt-2 truncate text-xs font-medium" title={data.account}>
          {data.account}
        </p>
      )}

      {connectedSince && <p className="mt-1 text-[11px] text-muted-foreground">{connectedSince}</p>}

      {data.oauth && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {[formatOAuthExpiry(data.oauth.tokenExpiresAt), formatLastRefreshed(data.oauth.lastRefreshedAt)]
            .filter(Boolean)
            .join(" · ") || "Sin vencimiento conocido"}
        </p>
      )}

      {provider.id === "google" && (
        <GoogleServices youtubeConnected={Boolean(data.oauth)} calendarPeople={data.calendarPeople ?? 0} />
      )}

      {missingAuthorization && (
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">Falta autorizar la cuenta.</p>
      )}

      {data.reasons.length > 0 && (
        <div className="mt-2 space-y-1">
          {data.reasons.slice(0, 2).map((reason) => (
            <p
              key={reason}
              className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden />
              <span>{reason}</span>
            </p>
          ))}
          {data.reasons.length > 2 && (
            <p className="pl-[18px] text-[11px] text-amber-600 dark:text-amber-400">
              +{data.reasons.length - 2} más
            </p>
          )}
        </div>
      )}

      {usage && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{usage.text}</span>
          </div>
          {usage.ratio !== null && (
            <div
              className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={usage.used}
              aria-valuemin={0}
              aria-valuemax={usage.limit ?? undefined}
              aria-label={usage.text}
            >
              <div
                className={`h-full rounded-full ${usage.needsAttention ? "bg-amber-500" : "bg-primary"}`}
                style={{ width: `${Math.round(usage.ratio * 100)}%` }}
              />
            </div>
          )}
          {usage.hint && <p className="mt-1 text-[11px] text-muted-foreground">{usage.hint}</p>}
        </div>
      )}

      <Link
        href={detailHref}
        className="mt-4 flex h-9 w-full items-center justify-center rounded-lg border border-border text-sm font-medium hover:bg-accent"
      >
        {connected ? "Configurar" : "Conectar"}
      </Link>
    </div>
  );
}
