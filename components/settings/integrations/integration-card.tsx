"use client";

import { AlertTriangle, Check, Plug, TriangleAlert } from "lucide-react";
import { STATUS_LABELS, type IntegrationStatus } from "@/lib/integrations/status";
import type { ProviderDefinition } from "@/lib/integrations/providers";
import type { IntegrationCardData } from "./types";

/**
 * La card de una integracion (F2).
 *
 * Compacta a proposito: icono, nombre, una linea, el estado, la cuenta, la
 * barra de uso y UN boton. Todo lo demas vive en el modal. Antes la pantalla
 * era una columna con los campos a la vista, y con quince integraciones eso no
 * se puede leer.
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
  onOpen,
}: {
  provider: ProviderDefinition;
  data: IntegrationCardData;
  onOpen: () => void;
}) {
  const connected = data.status !== "not_connected";
  const usage = data.usage;

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">{provider.label}</h3>
        <StatusBadge status={data.status} />
      </div>

      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{provider.description}</p>

      {data.account && (
        <p className="mt-2 truncate text-xs font-medium" title={data.account}>
          {data.account}
        </p>
      )}

      {data.reasons.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden />
          <span>{data.reasons[0]}</span>
        </p>
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

      <button
        type="button"
        onClick={onOpen}
        className="mt-4 h-9 w-full rounded-lg border border-border text-sm font-medium hover:bg-accent"
      >
        {connected ? "Configurar" : "Conectar"}
      </button>
    </div>
  );
}
