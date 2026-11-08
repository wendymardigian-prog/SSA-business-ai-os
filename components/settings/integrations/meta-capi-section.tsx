"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setMetaCapiPurchase } from "@/lib/actions/meta-capi";
import { formatDateTimeWithZone } from "@/lib/scheduling/booker/format";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { SKIP_REASON_LABELS, type SkipReason } from "@/lib/meta/capi/events";

export interface MetaCapiEventRow {
  id: string;
  event_name: string;
  source_type: "form" | "booking" | "payment" | "contact";
  status: "pending" | "sent" | "failed" | "skipped";
  skip_reason: string | null;
  error: string | null;
  test: boolean;
  action_source: string | null;
  created_at: string;
  sent_at: string | null;
}

const SOURCE_LABELS: Record<MetaCapiEventRow["source_type"], string> = {
  form: "Formulario",
  booking: "Reunión",
  payment: "Pago",
  contact: "Automatización",
};

const STATUS_LABELS: Record<MetaCapiEventRow["status"], { label: string; className: string }> = {
  pending: { label: "En cola", className: "bg-muted text-muted-foreground" },
  sent: { label: "Enviado", className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" },
  failed: { label: "Falló", className: "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200" },
  skipped: { label: "No se mandó", className: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" },
};

function detailOf(row: MetaCapiEventRow): string | null {
  if (row.status === "skipped" && row.skip_reason) return SKIP_REASON_LABELS[row.skip_reason as SkipReason] ?? row.skip_reason;
  if (row.status === "failed" || row.status === "pending") return row.error;
  if (row.status === "sent") return row.test ? "Con el código de prueba: se ve en «Probar eventos»." : null;
  return null;
}

/**
 * La sección propia de la tarjeta «Meta: API de Conversiones» (00327): mandar cada pago cobrado como compra y los
 * últimos envíos (qué se mandó, qué no y por qué). Los leads y las reuniones se mandan con el paso «Enviar evento a
 * Meta» de las automatizaciones.
 */
export function MetaCapiSection({
  connected,
  purchaseEnabled,
  events,
  readOnly,
}: {
  connected: boolean;
  purchaseEnabled: boolean;
  events: MetaCapiEventRow[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const timezone = useViewerTimezone();
  const [enabled, setEnabled] = useState(purchaseEnabled);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(next: boolean) {
    setError(null);
    setEnabled(next);
    startSave(async () => {
      const result = await setMetaCapiPurchase({ enabled: next });
      if (!result.ok) {
        setEnabled(!next);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-6 space-y-6">
      <section className="space-y-2 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Leads y reuniones</h2>
        <p className="text-xs text-muted-foreground">
          Se mandan con el paso «Enviar evento a Meta»: en un formulario o en un evento de la Agenda, entrá a Automatizaciones y
          sumalo como un paso más. Ahí elegís qué evento recibe Meta (Lead, Schedule…) y su valor.
        </p>
      </section>

      <section className="space-y-2 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Compras</h2>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            disabled={readOnly || !connected || saving}
            onChange={(e) => toggle(e.target.checked)}
            className="mt-1"
          />
          <span>
            Mandar cada pago cobrado como compra (Purchase)
            <span className="block text-xs text-muted-foreground">
              Un evento por cada pago, con su monto en dólares. Los reembolsos no se mandan y los pagos cobrados antes de
              prenderlo tampoco.
            </span>
          </span>
          {saving && <Loader2 className="mt-1 h-4 w-4 animate-spin text-muted-foreground" aria-label="Guardando" />}
        </label>
        {!connected && <p className="text-xs text-muted-foreground">Guardá primero el Pixel y el token.</p>}
        {error && (
          <p role="alert" className="text-xs text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Últimos envíos</h2>
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground">Todavía no se mandó ningún evento.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {events.map((row) => {
              const status = STATUS_LABELS[row.status];
              const detail = detailOf(row);
              return (
                <li key={row.id} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {row.event_name} <span className="font-normal text-muted-foreground">· {SOURCE_LABELS[row.source_type]}</span>
                    </p>
                    {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatDateTimeWithZone(row.sent_at ?? row.created_at, timezone)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}>{status.label}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
