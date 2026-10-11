"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Lightbulb, Loader2, NotebookPen } from "lucide-react";
import { sendCallToKnowledge, summarizeCall } from "@/lib/actions/calls-use";
import { callBadgeClass } from "@/lib/calls/badges";

/**
 * Lo que se hizo con la llamada despues de analizarla (F29, F30, F31): el
 * resumen con sus proximos pasos, las ideas de contenido, el estado de la
 * memoria del contacto y el documento de Conocimiento. Los botones encolan un
 * trabajo; la pantalla se actualiza sola mientras corre.
 */

export interface CallUsesData {
  callId: string;
  summary: {
    resumen?: string;
    proximos_pasos?: string;
    puntos_clave?: string[];
    sentimiento?: string;
    ideas?: Array<{ gancho: string }>;
  } | null;
  summaryStatus: string;
  memoryStatus: string;
  hasContact: boolean;
  ideas: Array<{ id: string; title: string }>;
  knowledge: { id: string; status: string; errorDetail: string | null } | null;
  /** Tiene `calls.edit` y la llamada se puede resumir. */
  canSummarize: boolean;
  summarizeDisabledReason: string | null;
  /** Tiene `calls.edit` y `knowledge.edit` y la llamada es de venta. */
  canKnowledge: boolean;
  knowledgeDisabledReason: string | null;
}

const SENTIMENT: Record<string, { label: string; tone: Parameters<typeof callBadgeClass>[0] }> = {
  positivo: { label: "Sentimiento positivo", tone: "positive" },
  neutral: { label: "Sentimiento neutral", tone: "neutral" },
  negativo: { label: "Sentimiento negativo", tone: "review" },
};

function Action({ label, icon, run, disabledReason, pendingLabel }: { label: string; icon: React.ReactNode; run: () => Promise<{ ok: boolean; error?: string }>; disabledReason: string | null; pendingLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending || !!disabledReason}
        title={disabledReason ?? undefined}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await run();
            if (!r.ok) return setError(r.error ?? "No se pudo");
            router.refresh();
          });
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon} {pending ? pendingLabel : label}
      </button>
      {error && <span role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</span>}
    </span>
  );
}

export function CallUsesCard({ data }: { data: CallUsesData }) {
  const s = data.summary;
  const sentiment = s?.sentimiento ? SENTIMENT[s.sentimiento] : null;
  const summarizing = data.summaryStatus === "pending";
  const kb = data.knowledge;

  return (
    <section className="space-y-3 rounded-lg border border-border p-3" aria-labelledby={`uses-${data.callId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`uses-${data.callId}`} className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Resumen y próximos pasos</h3>
        <div className="flex flex-wrap items-center gap-2">
          {data.canSummarize && (
            <Action
              label={s ? "Resumir de nuevo" : "Resumir"}
              pendingLabel="Resumiendo…"
              icon={<NotebookPen className="h-4 w-4" aria-hidden />}
              disabledReason={summarizing ? "Ya se está resumiendo" : data.summarizeDisabledReason}
              run={() => summarizeCall({ callId: data.callId })}
            />
          )}
          {data.canKnowledge && (
            <Action
              label={kb ? "Volver a mandar a Conocimiento" : "Mandar a Conocimiento"}
              pendingLabel="Mandando…"
              icon={<BookOpen className="h-4 w-4" aria-hidden />}
              disabledReason={data.knowledgeDisabledReason}
              run={() => sendCallToKnowledge({ callId: data.callId })}
            />
          )}
        </div>
      </div>

      {summarizing && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Se está resumiendo. La pantalla se actualiza sola.
        </p>
      )}
      {data.summaryStatus === "error" && !summarizing && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">No se pudo resumir la llamada. {data.canSummarize ? "Probá de nuevo con “Resumir”." : ""}</p>
      )}

      {s ? (
        <div className="space-y-3 text-sm">
          {sentiment && <span className={callBadgeClass(sentiment.tone)}>{sentiment.label}</span>}
          {s.resumen && <p className="whitespace-pre-line leading-relaxed">{s.resumen}</p>}
          {s.proximos_pasos && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground">Próximos pasos</h4>
              <p className="whitespace-pre-line">{s.proximos_pasos}</p>
            </div>
          )}
          {s.puntos_clave && s.puntos_clave.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground">Puntos clave</h4>
              <ul className="list-disc space-y-0.5 pl-5">
                {s.puntos_clave.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        !summarizing && data.summaryStatus !== "error" && <p className="text-sm text-muted-foreground">Todavía no se resumió esta llamada.</p>
      )}

      {data.ideas.length > 0 && (
        <div>
          <h4 className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Lightbulb className="h-3.5 w-3.5" aria-hidden /> Ideas de contenido que salieron de esta llamada</h4>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {data.ideas.map((i) => (
              <li key={i.id}>{i.title}</li>
            ))}
          </ul>
          <Link href="/dashboard/content" className="mt-1 inline-block text-xs text-primary underline-offset-2 hover:underline">Verlas en el banco de ideas</Link>
        </div>
      )}

      <dl className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        <div>
          <dt className="inline font-medium">Memoria del contacto: </dt>
          <dd className="inline">
            {!data.hasContact
              ? "la llamada no tiene contacto"
              : data.memoryStatus === "applied" ? "actualizada con esta llamada"
              : data.memoryStatus === "conflict" ? "no se pudo actualizar (otro proceso la cambió a la vez): volvé a resumir para reintentar"
              : data.memoryStatus === "skipped" ? "sin cambios"
              : "todavía no"}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">Conocimiento: </dt>
          <dd className="inline">
            {!kb ? "no se mandó"
              : kb.status === "ready" ? "indexada y lista (documento interno)"
              : kb.status === "error" ? `con error: ${kb.errorDetail ?? "no se pudo indexar"}`
              : "indexándose…"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
