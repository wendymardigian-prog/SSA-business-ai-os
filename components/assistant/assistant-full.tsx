"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, Loader2, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { loadAssistantPanel, newAssistantConversation, type AssistantPanelData } from "@/lib/actions/assistant";
import type { PanelMessage } from "@/lib/assistant/actor";
import { createSseReader } from "@/lib/assistant/sse";
import type { AssistantStep } from "@/lib/assistant/steps";
import { MessageBubble } from "./assistant-parts";

/**
 * El asistente a pantalla completa: una sola columna con la conversación, y dentro de cada
 * respuesta el plan (lo que se propone hacer), los pasos (lo que pasó de verdad) y la aprobación de lo que quiere escribir.
 *
 * Responde en directo: la ruta `/api/assistant/stream` manda cada plan y cada paso al momento. Pero la pantalla se
 * dibuja SIEMPRE desde lo guardado (que es también la auditoría): si se cierra la pestaña a mitad, al volver se ve
 * dónde iba y se sigue mirando hasta que termine; al aprobar o rechazar, sigue desde el paso donde estaba.
 */

const POLL_MS = 3_000;

type StreamBody = { text: string } | { continueId: string };

export function AssistantFullScreen({ initial, roleName }: { initial: AssistantPanelData; roleName?: string }) {
  const [data, setData] = useState<AssistantPanelData>(initial);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      const d = await loadAssistantPanel();
      setData(d);
      return d;
    } catch {
      setError("No pude leer la conversación. Probá otra vez.");
      return null;
    }
  }, []);

  // Lo que llega en directo se suma a la respuesta que se está escribiendo; al terminar, se relee lo guardado.
  const patchMessage = useCallback((messageId: string, fn: (m: PanelMessage) => PanelMessage) => {
    setData((d) => ({ ...d, messages: d.messages.map((m) => (m.id === messageId ? fn(m) : m)) }));
  }, []);

  const stream = useCallback(
    async (body: StreamBody) => {
      setError(null);
      setStreaming(true);
      let liveId: string | null = null;
      try {
        const res = await fetch("/api/assistant/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(j?.error ?? "No pude hablar con el asistente. Probá otra vez.");
          if ("text" in body) setText(body.text);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const sse = createSseReader(({ event, data: payload }) => {
          const p = payload as Record<string, unknown>;
          if (event === "start" && typeof p.messageId === "string") {
            liveId = p.messageId;
            void reload();
          } else if (event === "plan" && liveId && Array.isArray(p.plan)) {
            const plan = p.plan as string[];
            patchMessage(liveId, (m) => ({ ...m, plan }));
          } else if (event === "step" && liveId && p.step) {
            const step = p.step as AssistantStep;
            patchMessage(liveId, (m) => ({ ...m, steps: [...m.steps, { ...step, proposal: step.proposal_id ? { phase: "pending", label: step.label } : undefined }] }));
          } else if (event === "end" && p.ok === false && typeof p.message === "string") {
            setError(p.message);
          }
        });
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          sse.push(decoder.decode(value, { stream: true }));
        }
        sse.end();
      } catch {
        setError("Se cortó la conexión. Lo que alcanzó a hacer quedó guardado.");
      } finally {
        setStreaming(false);
        await reload();
      }
    },
    [patchMessage, reload],
  );

  const send = () => {
    const value = text.trim();
    if (!value || streaming) return;
    setText("");
    void stream({ text: value });
  };

  // Al aprobar o rechazar, sigue desde el paso donde estaba.
  const decided = useCallback(async () => {
    const d = await reload();
    const last = d?.messages[d.messages.length - 1];
    if (last?.canResume && last.phase === "waiting") void stream({ continueId: last.id });
  }, [reload, stream]);

  const resume = useCallback((id: string) => void stream({ continueId: id }), [stream]);

  // Una respuesta que sigue trabajando sin esta pestaña (se cerró y se volvió): se mira hasta que termine.
  const running = data.messages.some((m) => m.phase === "running");
  useEffect(() => {
    if (!running || streaming) return;
    const t = window.setInterval(() => void reload(), POLL_MS);
    return () => window.clearInterval(t);
  }, [running, streaming, reload]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [data.messages.length, streaming]);

  const fresh = async () => {
    setError(null);
    const r = await newAssistantConversation();
    if (!r.ok) setError(r.message ?? "No pude empezar una conversación nueva.");
    await reload();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* La barra de siempre: en el celular es la única vía al menú (lib/nav/page-actions.test.ts). */}
      <PageHeader
        route="/dashboard/asistente"
        title="Asistente"
        backHref={
          <Link
            href="/dashboard"
            aria-label="Volver a Inicio"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
        }
        titleSlot={
          <div className="flex min-w-0 items-center gap-2 [flex-shrink:0.01]">
            <h1 className="min-w-0 truncate text-lg font-bold sm:text-xl">Asistente</h1>
            <span className="hidden shrink-0 rounded-md bg-blue-500/15 px-2 py-0.5 text-xs text-blue-700 ring-1 ring-inset ring-blue-500/30 dark:text-blue-300 sm:inline">Agente integral</span>
          </div>
        }
        right={
          <div className="flex items-center gap-2">
            {roleName && <span className="hidden rounded-md bg-muted px-3 py-1 text-xs text-foreground/80 md:inline">Actúa con tu rol: {roleName}</span>}
            <button type="button" onClick={() => void fresh()} disabled={streaming} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              <Plus className="size-4" aria-hidden /> <span className="hidden sm:inline">Nueva conversación</span>
              <span className="sr-only sm:hidden">Nueva conversación</span>
            </button>
          </div>
        }
      />

      {/* Una sola columna de 720 px; el plan, cada consulta y lo que espera aprobación van dentro de la conversación. */}
      <section aria-label="Conversación" className="flex min-h-0 flex-1 flex-col">
        <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 lg:px-6" aria-live="polite">
          <div className="mx-auto w-full max-w-[720px] space-y-4">
            {data.offReason && <p className="rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-100">{data.offReason}</p>}
            {!data.offReason && data.messages.length === 0 && (
              <div className="mx-auto max-w-xl space-y-2 py-10 text-center text-sm text-muted-foreground">
                <p className="text-base font-medium text-foreground">¿En qué te ayudo?</p>
                <p>Pregúntame por tus clientes, servicios, tareas, tickets y reuniones, o pídeme que prepare una tarea, una nota o un ticket.</p>
                <p>Te enseño mi plan y cada consulta que hago. Lo que quiera crear lo dejo propuesto y espero a que lo apruebes.</p>
              </div>
            )}
            {data.messages.map((m) => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
                <MessageBubble message={m} onDecided={decided} onResume={resume} resuming={streaming} variant="full" />
              </div>
            ))}
          </div>
        </div>

        <form
          className="px-4 pb-4 pt-2 lg:px-6"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className="mx-auto w-full max-w-[720px]">
            {error && (
              <p role="alert" className="mb-2 text-xs text-destructive">
                {error}
              </p>
            )}
            <label htmlFor="assistant-full-input" className="sr-only">
              Escribile al asistente
            </label>
            <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-4 py-2 focus-within:ring-2 focus-within:ring-primary-edge">
              <textarea
                id="assistant-full-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                maxLength={4000}
                disabled={!data.available || streaming || running}
                placeholder={data.available ? "Pedile algo: «¿qué reuniones tengo esta semana?»" : "El asistente no está disponible"}
                className="field-sizing-content max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-sm leading-5 placeholder:text-muted-foreground focus-visible:outline-none disabled:opacity-60"
              />
              <button type="submit" disabled={streaming || running || !text.trim() || !data.available} aria-label="Enviar" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50">
                {streaming ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}
              </button>
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">Las lecturas las hace solo y las ves en los pasos. Todo lo que escribe, envía o cambia espera tu aprobación. Solo puede hacer lo que tu rol permite.</p>
          </div>
        </form>
      </section>
    </div>
  );
}
