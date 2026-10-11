"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { History, RotateCcw } from "lucide-react";
import { saveTaskInstructions, restoreTaskInstructions } from "@/lib/actions/ai-tasks";
import { formatDateTime } from "@/components/contacts/ui";
import { Field, Notice, Section, inputClass } from "@/components/agents/fields";
import type { TaskPromptVersion } from "@/lib/ai-tasks/store";

/** Mismo tope que el prompt de un agente. */
const MAX_INSTRUCTIONS_CHARS = 32_000;

/**
 * Las instrucciones de una tarea (Bloque Agentes IA: instrucciones), con
 * historial. Mismo patrón que `PromptSection` del agente: guardar crea una
 * versión nueva y la activa; volver a una anterior la activa sin reescribir
 * el historial. "Volver al texto del sistema" saca la versión activa (no es
 * "volver a una versión mas", es dejar de usar una).
 *
 * `technical` es la parte fija que nunca se edita (anti-inyección, formato
 * de salida): se muestra abajo, solo para leer, para que quede claro que lo
 * de arriba es lo único que cambia.
 */
export function TaskInstructionsPanel({
  taskId,
  taskName,
  defaultText,
  activeVersion,
  activeText,
  versions,
  technical,
  variables = [],
  testPanel,
}: {
  taskId: string;
  taskName: string;
  /** El texto del sistema (v0): lo que se usa sin ninguna versión activa. */
  defaultText: string;
  activeVersion: number | null;
  activeText: string;
  versions: TaskPromptVersion[];
  technical: string;
  /** Las `{{variables}}` que esta tarea reemplaza en sus instrucciones. */
  variables?: Array<{ name: string; description: string }>;
  /** "Probar antes de guardar": recibe el texto que hay en el editor, guardado o no. */
  testPanel?: (draftText: string) => ReactNode;
}) {
  const router = useRouter();
  const [text, setText] = useState(activeText);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [comparing, setComparing] = useState<number | null>(null);
  const [pending, start] = useTransition();

  const dirty = text.trim() !== activeText.trim();
  const compared = versions.find((v) => v.version === comparing) ?? null;
  const overLimit = text.length > MAX_INSTRUCTIONS_CHARS;

  function save() {
    setMessage(null);
    start(async () => {
      const result = await saveTaskInstructions(taskId, text, note);
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      setNote("");
      setMessage({ tone: "success", text: "Instrucciones guardadas como versión nueva." });
      router.refresh();
    });
  }

  function restore(version: number | null) {
    setMessage(null);
    start(async () => {
      const result = await restoreTaskInstructions(taskId, version);
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      setText(version === null ? defaultText : (versions.find((v) => v.version === version)?.instructions ?? defaultText));
      setComparing(null);
      setMessage({ tone: "success", text: version === null ? "Volviste al texto del sistema." : `Volviste a la versión ${version}.` });
      router.refresh();
    });
  }

  return (
    <Section
      title="Instrucciones"
      description={
        technical
          ? `Qué hacer y con qué criterio para "${taskName}". Lo técnico (seguridad y el formato de salida que el código lee después) nunca se edita acá: queda siempre fijo, abajo.`
          : `Qué hacer y con qué criterio para "${taskName}". Es el prompt de sistema completo: la salida es texto libre y no hay una parte técnica fija.`
      }
    >
      <Field
        label={`Instrucciones (versión activa: ${activeVersion ?? "texto del sistema"})`}
        hint={
          <span className={overLimit ? "text-red-700 dark:text-red-400" : undefined}>
            {text.length.toLocaleString("es")} / {MAX_INSTRUCTIONS_CHARS.toLocaleString("es")} caracteres
          </span>
        }
      >
        {(id) => (
          <textarea
            id={id}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            aria-invalid={overLimit}
            className={`${inputClass} min-h-[16rem] max-h-[50vh] resize-y font-mono text-xs leading-relaxed`}
          />
        )}
      </Field>
      {variables.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Podés usar{" "}
          {variables.map((v, i) => (
            <span key={v.name}>
              {i > 0 && ", "}
              <code className="rounded bg-muted px-1 py-0.5">{`{{${v.name}}}`}</code> ({v.description})
            </span>
          ))}
          : se reemplaza solo en cada análisis.
        </p>
      )}
      <Field label="Qué cambiaste (opcional)">
        {(id) => <input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Ej: que agrupe por urgencia" className={inputClass} />}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending || overLimit || text.trim().length === 0}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Guardar versión nueva
        </button>
        {activeVersion !== null && (
          <button
            type="button"
            onClick={() => restore(null)}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" aria-hidden /> Volver al texto del sistema
          </button>
        )}
        {overLimit ? (
          <span className="text-xs text-red-700 dark:text-red-400">Te pasaste del tope. Recortalo para poder guardar.</span>
        ) : (
          dirty && <span className="text-xs text-amber-700 dark:text-amber-400">Cambios sin guardar</span>
        )}
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      {testPanel?.(text)}

      <div>
        <h3 className="flex items-center gap-1.5 text-xs font-semibold">
          <History className="h-3.5 w-3.5" aria-hidden /> Historial
        </h3>
        {versions.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Todavía no hay versiones guardadas: se está usando el texto del sistema.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {versions.map((v) => (
              <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm">
                    Versión {v.version}
                    {v.version === activeVersion && (
                      <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                        Activa
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDateTime(v.createdAt)}
                    {` · ${v.instructions.length.toLocaleString("es")} caracteres`}
                    {v.authorLabel ? ` · ${v.authorLabel}` : ""}
                    {v.note ? ` · ${v.note}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setComparing(comparing === v.version ? null : v.version)}
                    className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                    aria-expanded={comparing === v.version}
                  >
                    {comparing === v.version ? "Ocultar" : "Comparar"}
                  </button>
                  {v.version !== activeVersion && (
                    <button
                      type="button"
                      onClick={() => restore(v.version)}
                      disabled={pending}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden /> Volver a esta
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {compared && (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground">Versión {compared.version}</p>
              <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-[11px]">{compared.instructions}</pre>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground">Activa (versión {activeVersion ?? "texto del sistema"})</p>
              <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-[11px]">{activeText}</pre>
            </div>
          </div>
        )}
      </div>

      {technical && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground">Parte técnica (fija, no se edita)</h3>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-dashed border-border bg-muted/40 p-3 text-[11px] text-muted-foreground">
            {technical}
          </pre>
        </div>
      )}
    </Section>
  );
}
