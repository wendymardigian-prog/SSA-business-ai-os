"use client";

/**
 * Lo auditable de una ejecución (00515): el webhook que llegó (datos, variables, URL y cabeceras), lo que usó y dejó
 * cada paso, y «Volver a ejecutar con el mismo webhook». Solo se dibuja con datos para quien tiene `flows.edit` (el
 * servidor ni siquiera los manda a quien no).
 */
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Loader2, RefreshCcw } from "lucide-react";
import { JsonTree } from "@/components/webhooks/json-tree";
import { rerunFlowRunFromWebhook } from "@/lib/actions/flow-runs";
import { formatRunDate } from "@/lib/flows/runs";
import type { RunAudit, RunStepAudit } from "@/lib/flows/run-audit";
import { serviceHref } from "@/lib/services/screens/record-url"; // @plantilla-quitar(servicios)
import { cn } from "@/lib/utils";

type Tab = "datos" | "variables" | "url" | "cabeceras";

const isEmpty = (value: unknown): boolean =>
  value === null || value === undefined || (typeof value === "object" && Object.keys(value as object).length === 0);

/** «Webhook recibido»: lo que llegó, tal cual y como variables. */
export function RunWebhookSection({
  audit,
  canSeeData,
  timeZone,
  flowId,
  runId,
  canRerun,
}: {
  audit: RunAudit | null;
  canSeeData: boolean;
  timeZone: string;
  flowId: string;
  runId: string;
  canRerun: boolean;
}) {
  const [tab, setTab] = useState<Tab>("datos");
  const webhook = audit?.webhook ?? null;

  return (
    <section aria-label="Webhook recibido" className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Webhook recibido</h3>
        {webhook && (
          <span className="text-xs text-muted-foreground">
            {webhook.endpointName ? `${webhook.endpointName} · ` : ""}
            {formatRunDate(webhook.receivedAt, timeZone)}
          </span>
        )}
      </div>
      <div className="space-y-2 p-3">
        {!canSeeData ? (
          <p className="text-xs text-muted-foreground">Los datos que llegaron tienen información personal: para verlos necesitás permiso para editar automatizaciones.</p>
        ) : !webhook ? (
          <p className="text-xs text-muted-foreground">No se encontró el envío de esta ejecución (puede haberse borrado a los 12 meses).</p>
        ) : webhook.cleared ? (
          <p className="text-xs text-muted-foreground">Los datos de este envío se borraron a los 90 días.</p>
        ) : (
          <>
            <div role="tablist" aria-label="Qué ver del envío" className="flex flex-wrap gap-1">
              {(
                [
                  ["datos", "Datos"],
                  ["variables", "Variables"],
                  ...(!isEmpty(webhook.query) ? [["url", "URL"]] : []),
                  ...(!isEmpty(webhook.headers) ? [["cabeceras", "Cabeceras"]] : []),
                ] as Array<[Tab, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={cn("rounded-md px-2 py-1 text-xs font-medium", tab === key ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60")}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="max-h-72 overflow-auto rounded-md bg-muted/40 p-2">
              {tab === "datos" && <JsonTree value={(webhook.payload ?? {}) as never} />}
              {tab === "variables" && (
                <>
                  <p className="mb-1 text-[11px] text-muted-foreground">Cada dato se usa en los pasos como <code>{"{{webhook.data.…}}"}</code>. Tocá uno para copiar su valor.</p>
                  <JsonTree value={webhook.data as never} rootPath="webhook.data" />
                </>
              )}
              {tab === "url" && <JsonTree value={(webhook.query ?? {}) as never} />}
              {tab === "cabeceras" && <JsonTree value={(webhook.headers ?? {}) as never} />}
            </div>
            {webhook.contentType && <p className="text-[11px] text-muted-foreground">Formato: {webhook.contentType}</p>}
          </>
        )}
        {canRerun && <RerunButton flowId={flowId} runId={runId} />}
      </div>
    </section>
  );
}

/** «Volver a ejecutar con el mismo webhook», con confirmación. */
function RerunButton({ flowId, runId }: { flowId: string; runId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="border-t border-border pt-2">
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent">
          <RefreshCcw className="h-3 w-3" aria-hidden /> Volver a ejecutar con el mismo webhook
        </button>
      ) : (
        <div role="alertdialog" aria-label="Confirmar volver a ejecutar" className="space-y-2 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200">
          <p>Corre toda la automatización otra vez con estos mismos datos. Crear o actualizar el contacto no duplica nada, pero un mensaje o un email se volverían a mandar.</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await rerunFlowRunFromWebhook({ flowId, runId });
                  if (!res.ok) {
                    setMessage({ ok: false, text: res.error });
                    return;
                  }
                  setConfirming(false);
                  setMessage({ ok: true, text: "Listo: se volvió a ejecutar." });
                  if (res.runId) {
                    const next = new URLSearchParams(searchParams.toString());
                    next.set("ejecucion", res.runId);
                    router.replace(`?${next.toString()}`, { scroll: false });
                  }
                  router.refresh();
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />} Sí, volver a ejecutar
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="rounded-lg border border-border px-2.5 py-1 font-medium hover:bg-accent">
              Cancelar
            </button>
          </div>
        </div>
      )}
      {message && <p role="status" className={cn("mt-1.5 text-xs", message.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300")}>{message.text}</p>}
    </div>
  );
}

const RESULT_TEXT: Record<string, string> = {
  created: "creado",
  updated: "actualizado",
  unchanged: "sin cambios",
  found: "ya existía",
  skipped: "sin datos",
};

/** Los enlaces a lo que el paso creó o encontró (contacto o servicio). */
function ResultLinks({ output }: { output: unknown }) {
  type Result = { contact?: { id?: string; name?: string | null; result?: string }; service?: { id?: string } };
  const out = (output && typeof output === "object" ? output : {}) as { result?: Result; variables?: { service?: { id?: string } } };
  // Lo que el paso declaró y, para el servicio, la variable `service.id` que deja «Crear servicio».
  const result: Result = { ...(out.result ?? {}) };
  if (!result.service?.id && typeof out.variables?.service?.id === "string") result.service = { id: out.variables.service.id };
  const items: Array<{ href: string; text: string }> = [];
  if (result.contact?.id) items.push({ href: `/dashboard/contacts/${result.contact.id}`, text: `Contacto ${RESULT_TEXT[result.contact.result ?? ""] ?? ""}: ${result.contact.name || "ver ficha"}`.replace(" :", ":") });
  if (result.service?.id) items.push({ href: serviceHref(result.service.id), text: "Servicio: ver ficha" }); // @plantilla-quitar(servicios)
  if (items.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {items.map((i) => (
        <li key={i.href}>
          <Link href={i.href} className="text-xs font-medium text-primary-ink hover:underline">{i.text}</Link>
        </li>
      ))}
    </ul>
  );
}

/** Lo que usó y lo que dejó un paso, plegado. */
export function RunStepData({ data }: { data: RunStepAudit | undefined }) {
  const [open, setOpen] = useState(false);
  if (!data) return null;
  return (
    <div className="mt-1">
      <ResultLinks output={data.output} />
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        {open ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />} Ver los datos del paso
      </button>
      {open && (
        <div className="mt-1 space-y-2">
          {!isEmpty(data.input) && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground">Usó</p>
              <div className="max-h-56 overflow-auto rounded-md bg-muted/40 p-2"><JsonTree value={data.input as never} /></div>
            </div>
          )}
          {!isEmpty(data.output) && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground">Resultado</p>
              <div className="max-h-56 overflow-auto rounded-md bg-muted/40 p-2"><JsonTree value={data.output as never} /></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
