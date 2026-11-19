"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Loader2, Maximize2, SquarePen, Sparkles, X } from "lucide-react";
import { continueAssistantMessage, loadAssistantPanel, newAssistantConversation, sendAssistantMessage, type AssistantPanelData } from "@/lib/actions/assistant";
import { MessageBubble } from "./assistant-parts";

/**
 * El asistente del equipo: un botón flotante en todas las pantallas del panel y, al
 * tocarlo, un panel acoplado a la derecha (en el teléfono ocupa la pantalla). Cada consulta del asistente se ve como
 * un paso plegado que se despliega para ver qué devolvió; lo que quiere crear queda propuesto y se aprueba o se
 * rechaza aquí mismo; al decidir, sigue desde el paso donde estaba. Abierto o cerrado se recuerda en este
 * navegador. En la pantalla completa (`/dashboard/asistente`) no se muestra: ya está ahí.
 */

export const ASSISTANT_FULL_PATH = "/dashboard/asistente";

const OPEN_KEY = "rer-assistant-open";
const OPEN_EVENT = "rer-assistant-open-change";

function subscribeOpen(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(OPEN_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(OPEN_EVENT, onChange);
  };
}

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function AssistantDock() {
  const pathname = usePathname();
  const [data, setData] = useState<AssistantPanelData | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const reload = useCallback(async () => {
    try {
      const d = await loadAssistantPanel();
      setData(d);
      return d;
    } catch {
      setError("No pude abrir el asistente. Probá otra vez.");
      return null;
    }
  }, []);

  const resume = useCallback(
    (messageId: string) => {
      setError(null);
      startTransition(async () => {
        const r = await continueAssistantMessage(messageId);
        if (r.messages) setData((d) => ({ available: d?.available ?? true, offReason: d?.offReason ?? null, messages: r.messages! }));
        if (!r.ok) setError(r.message);
      });
    },
    [],
  );

  // Al aprobar o rechazar lo propuesto, la respuesta sigue desde el paso donde estaba.
  const decided = useCallback(async () => {
    const d = await reload();
    const last = d?.messages[d.messages.length - 1];
    if (last?.canResume && last.phase === "waiting") resume(last.id);
  }, [reload, resume]);

  // Abierto o cerrado sale del navegador (sin parpadeo al hidratar); si no deja guardar, vale la sesión.
  const stored = useSyncExternalStore(subscribeOpen, readOpen, () => false);
  const [session, setSession] = useState<boolean | null>(null);
  const open = session ?? stored;
  const setOpen = useCallback((next: boolean) => {
    setSession(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      /* sin localStorage: no se recuerda */
    }
    window.dispatchEvent(new Event(OPEN_EVENT));
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (data) return;
    let alive = true;
    loadAssistantPanel()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setError("No pude abrir el asistente. Probá otra vez.");
      });
    return () => {
      alive = false;
    };
  }, [open, data]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [data?.messages.length, pending]);

  const send = () => {
    const value = text.trim();
    if (!value || pending) return;
    setError(null);
    setText("");
    startTransition(async () => {
      const r = await sendAssistantMessage(value);
      if (r.messages) setData((d) => ({ available: d?.available ?? true, offReason: d?.offReason ?? null, messages: r.messages! }));
      if (!r.ok) {
        setError(r.message);
        if (!r.messages) setText(value);
      }
    });
  };

  const fresh = () => {
    setError(null);
    startTransition(async () => {
      const r = await newAssistantConversation();
      if (!r.ok) setError(r.message ?? "No pude empezar una conversación nueva.");
      await reload();
    });
  };

  if (pathname?.startsWith(ASSISTANT_FULL_PATH)) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir el asistente"
        title="Asistente"
        className="fixed bottom-4 right-4 z-40 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-offset-2 transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-edge"
      >
        <Sparkles className="size-5" aria-hidden />
      </button>
    );
  }

  const messages = data?.messages ?? [];
  return (
    <aside
      aria-label="Asistente"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
      className="fixed inset-0 z-50 flex flex-col bg-background lg:static lg:z-auto lg:w-[400px] lg:shrink-0 lg:border-l lg:border-border"
    >
      {/* La cabecera a la altura de la de la página, solo con iconos a la derecha. */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <Sparkles className="size-[18px] text-primary-ink" aria-hidden />
        <h2 className="flex-1 text-[15px] font-semibold">Asistente</h2>
        <button type="button" onClick={fresh} disabled={pending} aria-label="Nueva conversación" title="Nueva conversación" className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
          <SquarePen className="size-4" aria-hidden />
        </button>
        <Link href={ASSISTANT_FULL_PATH} aria-label="Abrir a pantalla completa" title="Pantalla completa" className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <Maximize2 className="size-4" aria-hidden />
        </Link>
        <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar el asistente" className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div ref={listRef} className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4" aria-live="polite">
        {!data && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Abriendo…
          </p>
        )}
        {data && data.offReason && <p className="rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-100">{data.offReason}</p>}
        {data && !data.offReason && messages.length === 0 && (
          <div className="space-y-2 text-[13px] leading-relaxed text-muted-foreground">
            <p>Pregúntame por tus clientes, servicios, tareas, tickets y reuniones, o pídeme que prepare una tarea, una nota o un ticket.</p>
            <p>Actúo con tu rol: solo veo lo que tu rol te deja ver, y lo que quiera crear te lo dejo propuesto para que lo apruebes.</p>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} onDecided={decided} onResume={resume} resuming={pending} compact />
        ))}
        {pending && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Pensando…
          </p>
        )}
      </div>

      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {error && (
          <p role="alert" className="mb-2 text-xs text-destructive">
            {error}
          </p>
        )}
        <label htmlFor="assistant-input" className="sr-only">
          Escribile al asistente
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="assistant-input"
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            maxLength={4000}
            disabled={!data?.available}
            placeholder={data?.available ? "Preguntá algo sobre tus contactos…" : "El asistente no está disponible"}
            className="min-h-[52px] flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-edge disabled:opacity-60"
          />
          <button type="submit" disabled={pending || !text.trim() || !data?.available} aria-label="Enviar" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50">
            <ArrowRight className="size-4" aria-hidden />
          </button>
        </div>
      </form>
    </aside>
  );
}
