"use client";
// @plantilla-quitar(servicios)

import { useState, useTransition } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { formatDateTime } from "@/components/contacts/ui";
import { loadTutorConversations } from "@/lib/actions/tutor";
import {
  ANSWER_STATE_LABELS,
  CONVERSATION_FILTER_LABELS,
  answerState,
  citationClock,
  preview,
  searchSummary,
  type ConversationFilter,
  type ConversationItem,
  type ConversationsPage,
} from "@/lib/program/tutor-conversations";
import { cn } from "@/lib/utils";

const EMPTY: Record<ConversationFilter, string> = {
  todas: "Todavía nadie le preguntó al tutor de este programa.",
  abajo: "Ningún estudiante marcó una respuesta como «No me sirvió».",
  arriba: "Ningún estudiante marcó una respuesta como «Me sirvió».",
  "sin-clases": "Todas las respuestas citaron al menos una clase.",
};

/**
 * Portal › un programa › Asistente IA › Conversaciones: cada respuesta del tutor con su pregunta. El filtro vive en la
 * barra superior (`?filtro=`); acá solo se lista, se abre una respuesta y se cargan las anteriores.
 */
export function ProgramTutorConversations({ productId, filter, initial, error }: { productId: string; filter: ConversationFilter; initial: ConversationsPage | null; error: string | null }) {
  const tz = useViewerTimezone();
  const [items, setItems] = useState<ConversationItem[]>(initial?.items ?? []);
  const [hasMore, setHasMore] = useState(initial?.has_more ?? false);
  const [open, setOpen] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (error) return <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>;

  const more = () =>
    start(async () => {
      setLoadError(null);
      const last = items[items.length - 1];
      const r = await loadTutorConversations(productId, filter, last?.created_at ?? null);
      if (!r.ok) return setLoadError(r.error.message);
      const seen = new Set(items.map((i) => i.id));
      setItems([...items, ...r.data.items.filter((i) => !seen.has(i.id))]);
      setHasMore(r.data.has_more);
    });

  return (
    <section aria-labelledby="conversaciones" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="conversaciones" className="text-sm font-semibold">
          Conversaciones{filter !== "todas" ? ` · ${CONVERSATION_FILTER_LABELS[filter]}` : ""}
        </h2>
        <p className="text-xs text-muted-foreground">Lo que preguntan los estudiantes y cómo respondió el tutor. «Sin clases» = respondió sin citar ninguna clase.</p>
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{EMPTY[filter]}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {items.map((m) => {
            const state = answerState(m);
            const label = ANSWER_STATE_LABELS[state];
            const isOpen = open === m.id;
            const summary = searchSummary(m.result);
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : m.id)}
                  aria-expanded={isOpen}
                  className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-accent/50"
                >
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{m.student ?? "Estudiante"}</span>
                    <span>{formatDateTime(m.created_at, tz)}</span>
                    {label && (
                      <span className={cn("rounded px-1.5", state === "failed" ? "bg-destructive/10 text-destructive" : "bg-warn/15")}>{label}</span>
                    )}
                    {m.feedback === "up" && (
                      <span className="inline-flex items-center gap-1 rounded bg-good/15 px-1.5">
                        <ThumbsUp className="size-3" aria-hidden /> Le sirvió
                      </span>
                    )}
                    {m.feedback === "down" && (
                      <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 text-destructive">
                        <ThumbsDown className="size-3" aria-hidden /> No le sirvió
                      </span>
                    )}
                  </span>
                  <span className="text-sm font-medium">{preview(m.question, 200) || "(sin pregunta)"}</span>
                  {!isOpen && <span className="text-sm text-muted-foreground">{preview(m.answer)}</span>}
                </button>
                {isOpen && (
                  <div className="space-y-3 px-4 pb-4">
                    {m.question && <p className="whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2 text-sm">{m.question}</p>}
                    <p className="whitespace-pre-wrap text-sm">{m.answer}</p>
                    {m.citations.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium">Citó</p>
                        <ul className="flex flex-wrap gap-1.5">
                          {m.citations.map((c, k) => {
                            const at = citationClock(c.second);
                            return (
                              <li key={`${c.item_id}-${k}`} className="rounded-md border border-border px-2 py-0.5 text-xs">
                                {c.title}
                                {at ? ` · ${at}` : ""}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {loadError && <p role="alert" className="text-xs text-destructive">{loadError}</p>}
      {hasMore && (
        <button type="button" onClick={more} disabled={pending} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">
          {pending ? "Cargando…" : "Cargar más"}
        </button>
      )}
    </section>
  );
}
