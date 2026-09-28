"use client";

/**
 * La sección "Flujos" del evento (F48).
 *
 * Una fila por flujo, con lo que hace en palabras y un interruptor. Prender un
 * recordatorio relativo además reprograma los avisos de las reuniones que ya
 * están agendadas: quien lo prende espera que valga para lo que ya tiene.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/agents/fields";
import { Switch } from "@/components/ui/switch";
import type { EventFlowRow } from "@/lib/scheduling/data/event-flows";
import { toggleEventFlow } from "@/lib/actions/scheduling/event-flows";

export function FlowsSection({ eventId, flows }: { eventId: string; flows: EventFlowRow[] }) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function toggle(flow: EventFlowRow, enabled: boolean) {
    setNotice(null);
    start(async () => {
      const result = await toggleEventFlow({ flowId: flow.id, enabled });
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      setNotice({
        kind: "ok",
        text: enabled
          ? result.data.backfilled > 0
            ? `"${flow.name}" quedó encendido. Se programaron ${result.data.backfilled} avisos para las reuniones que ya tenías.`
            : `"${flow.name}" quedó encendido.`
          : `"${flow.name}" quedó apagado.`,
      });
      router.refresh();
    });
  }

  return (
    <section className="space-y-3">
      {notice && <Notice tone={notice.kind === "ok" ? "success" : "error"}>{notice.text}</Notice>}

      {flows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Este evento no tiene flujos. Se crean solos al crear un evento, si la opción está encendida en Ajustes.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {flows.map((flow) => (
            <li key={flow.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className="min-w-0 flex-1">
                <Link
                  href={`/dashboard/agenda/configuracion/eventos/${eventId}/flujos/${flow.id}`}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {flow.name}
                </Link>
                <span className="block text-xs text-muted-foreground">{flow.describe}</span>
              </span>
              <Switch checked={flow.enabled} disabled={pending} onChange={(v: boolean) => toggle(flow, v)} label={`Encender ${flow.name}`} />
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Los flujos nacen apagados a propósito: primero se lee el texto, después se prende. Cada uno se puede editar acá o abrir en el canvas.
      </p>
    </section>
  );
}
