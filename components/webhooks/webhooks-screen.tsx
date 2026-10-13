"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Webhook } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Sheet } from "@/components/ui/sheet";
import { createWebhookEndpoint } from "@/lib/actions/webhook-endpoints";
import type { EndpointListItem } from "@/lib/webhooks/action-types";
import { StatusChip } from "./status-chip";

/**
 * Integraciones › Webhooks entrantes: todos los endpoints del negocio.
 *
 * Quien solo tiene `integrations.manage` ve la lista (sin URL ni acciones: `canEdit` en false).
 * Crear, abrir el historial y todo lo demas pide `flows.edit`.
 */
export function WebhooksScreen({ endpoints, canEdit, timeZone }: { endpoints: EndpointListItem[]; canEdit: boolean; timeZone: string }) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Webhooks entrantes"
        tooltip="Una URL por cada formulario externo (Typeform, Tally, Framer…). Lo que llega se guarda, y los flujos que lo escuchan crean o actualizan el contacto."
        backHref={
          <Link href="/dashboard/settings/integrations" className="mr-1 text-sm text-muted-foreground hover:text-foreground" aria-label="Volver a Integraciones">
            ←
          </Link>
        }
        right={
          canEdit ? (
            <button type="button" onClick={() => setCreating(true)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Plus className="h-4 w-4" aria-hidden /> Nuevo endpoint
            </button>
          ) : undefined
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-6xl">
          {endpoints.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <Webhook className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="mt-3 text-sm font-medium">Todavía no recibís webhooks</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Creá un endpoint, copiá su URL en tu formulario externo y armá un flujo con el disparador «Webhook recibido».
              </p>
              {canEdit && (
                <button type="button" onClick={() => setCreating(true)} className="mt-4 h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">
                  Crear el primer endpoint
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-border text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">Endpoint</th>
                    <th scope="col" className="px-4 py-2 font-medium">Estado</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Envíos (7 días)</th>
                    <th scope="col" className="px-4 py-2 font-medium">Último envío</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Errores (7 días)</th>
                    <th scope="col" className="px-4 py-2 font-medium">Flujos</th>
                  </tr>
                </thead>
                <tbody>
                  {endpoints.map((e) => (
                    <tr key={e.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                      <td className="px-4 py-3">
                        {canEdit ? (
                          <Link href={`/dashboard/settings/integrations/webhooks/${e.id}`} className="font-medium hover:underline">{e.name}</Link>
                        ) : (
                          <span className="font-medium">{e.name}</span>
                        )}
                        {e.description && <p className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground">{e.description}</p>}
                      </td>
                      <td className="px-4 py-3">
                        {e.status === "paused" ? <StatusChip label="Pausado" tone="neutral" /> : e.listening ? <StatusChip label="Escuchando" tone="warning" /> : <StatusChip label="Activo" tone="success" />}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{e.received7d}</td>
                      <td className="px-4 py-3 text-muted-foreground">{e.lastReceivedAt ? new Date(e.lastReceivedAt).toLocaleString("es", { dateStyle: "short", timeStyle: "short", timeZone }) : "Nunca"}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${e.errors7d > 0 ? "font-medium text-red-600 dark:text-red-400" : ""}`}>{e.errors7d}</td>
                      <td className="px-4 py-3">
                        {e.flows.length === 0 ? (
                          <span className="text-xs text-muted-foreground">Ninguno</span>
                        ) : (
                          <ul className="flex flex-wrap gap-1">
                            {e.flows.map((f) => (
                              <li key={f.id}>
                                <Link href={`/dashboard/flows/${f.id}`} className="rounded bg-muted px-1.5 py-0.5 text-xs hover:bg-accent">{f.name}</Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {creating && <CreateEndpointSheet onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateEndpointSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [eventIdPath, setEventIdPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const res = await createWebhookEndpoint({ name, description, eventIdPath });
      if (!res.ok) return setError(res.error);
      router.push(`/dashboard/settings/integrations/webhooks/${res.endpointId}`);
    });
  }

  return (
    <Sheet title="Nuevo endpoint" onClose={onClose}>
      <form
        className="space-y-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div>
          <label htmlFor="wh-name" className="text-sm font-medium">Nombre</label>
          <input id="wh-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="Formulario de la landing (Typeform)" className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" />
        </div>
        <div>
          <label htmlFor="wh-desc" className="text-sm font-medium">Descripción <span className="font-normal text-muted-foreground">(opcional)</span></label>
          <textarea id="wh-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="wh-path" className="text-sm font-medium">Ruta del id del envío <span className="font-normal text-muted-foreground">(opcional)</span></label>
          <input id="wh-path" value={eventIdPath} onChange={(e) => setEventIdPath(e.target.value)} placeholder="event_id" className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm" />
          <p className="mt-1 text-xs text-muted-foreground">Si tu formulario manda un id único por envío (por ejemplo <code>event_id</code>), lo usamos para no procesar dos veces el mismo envío.</p>
        </div>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cancelar</button>
          <button type="submit" disabled={pending || !name.trim()} className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {pending ? "Creando…" : "Crear endpoint"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
