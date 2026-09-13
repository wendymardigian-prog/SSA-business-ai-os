"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, RotateCcw } from "lucide-react";
import { saveSystemPrompt, restorePromptVersion } from "@/lib/actions/agents";
import { MAX_PROMPT_CHARS } from "@/lib/agent/validate";
import { formatDateTime } from "@/components/contacts/ui";
import type { AgentScreenData } from "@/lib/agent/screen";
import { Field, Notice, Section, inputClass } from "./fields";

/**
 * System prompt con versionado (F26). Guardar crea una version nueva; volver a
 * una anterior la activa sin reescribir el historial. Cada run guarda la
 * version que uso.
 */
export function PromptSection({ data }: { data: AgentScreenData }) {
  const router = useRouter();
  const { agent, versions } = data;
  const [prompt, setPrompt] = useState(agent.systemPrompt);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [comparing, setComparing] = useState<number | null>(null);
  const [pending, start] = useTransition();

  const dirty = prompt.trim() !== agent.systemPrompt.trim();
  const compared = versions.find((v) => v.version === comparing) ?? null;

  function save() {
    setMessage(null);
    start(async () => {
      const result = await saveSystemPrompt(agent.id, prompt, note);
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      setNote("");
      setMessage({ tone: "success", text: "Prompt guardado como versión nueva." });
      router.refresh();
    });
  }

  function restore(version: number) {
    setMessage(null);
    start(async () => {
      const result = await restorePromptVersion(agent.id, version);
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      const restored = versions.find((v) => v.version === version);
      if (restored) setPrompt(restored.systemPrompt);
      setComparing(null);
      setMessage({ tone: "success", text: `Volviste a la versión ${version}.` });
      router.refresh();
    });
  }

  return (
    <Section
      title="System prompt"
      description="Las instrucciones del agente. Cada vez que lo guardás queda una versión, y cada respuesta del agente registra con qué versión la dio."
    >
      <Field label={`Prompt (versión activa: ${agent.promptVersion ?? "—"})`} hint={`${prompt.length} / ${MAX_PROMPT_CHARS} caracteres`}>
        {(id) => (
          <textarea
            id={id}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={12}
            maxLength={MAX_PROMPT_CHARS}
            className={`${inputClass} font-mono text-xs leading-relaxed`}
          />
        )}
      </Field>
      <Field label="Qué cambiaste (opcional)">
        {(id) => (
          <input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Ej: que derive cuando preguntan por precios" className={inputClass} />
        )}
      </Field>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Guardar versión nueva
        </button>
        {dirty && <span className="text-xs text-amber-700 dark:text-amber-400">Cambios sin guardar</span>}
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <div>
        <h3 className="flex items-center gap-1.5 text-xs font-semibold">
          <History className="h-3.5 w-3.5" aria-hidden /> Historial
        </h3>
        {versions.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Todavía no hay versiones guardadas.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {versions.map((v) => (
              <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm">
                    Versión {v.version}
                    {v.version === agent.promptVersion && (
                      <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                        Activa
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDateTime(v.createdAt)}
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
                  {v.version !== agent.promptVersion && (
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
              <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-[11px]">{compared.systemPrompt}</pre>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground">Activa (versión {agent.promptVersion ?? "—"})</p>
              <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-[11px]">{agent.systemPrompt}</pre>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
