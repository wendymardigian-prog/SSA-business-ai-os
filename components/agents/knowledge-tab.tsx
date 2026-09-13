"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { updateAgentKnowledge } from "@/lib/actions/agents";
import { countIncludedDocuments, type AgentScreenData } from "@/lib/agent/screen";
import { Notice, Section } from "./fields";

/**
 * Pestana Conocimiento (F27): si el agente accede a la base, por que tags, y
 * que hace si no encuentra nada. El contador muestra cuantos documentos lee
 * con la seleccion actual, para que no haya sorpresas.
 */
export function KnowledgeTab({ data }: { data: AgentScreenData }) {
  const router = useRouter();
  const { agent, knowledgeDocs } = data;
  const [enabled, setEnabled] = useState(agent.knowledgeEnabled);
  const [tags, setTags] = useState<string[]>(agent.knowledgeTags);
  const [fallback, setFallback] = useState(agent.knowledgeFallback);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const allTags = [...new Set(knowledgeDocs.flatMap((d) => d.tags))].sort();
  const counts = countIncludedDocuments(knowledgeDocs, tags);
  const dirty =
    enabled !== agent.knowledgeEnabled ||
    fallback !== agent.knowledgeFallback ||
    JSON.stringify([...tags].sort()) !== JSON.stringify([...agent.knowledgeTags].sort());

  function toggleTag(tag: string) {
    setMessage(null);
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  function save() {
    setMessage(null);
    start(async () => {
      const result = await updateAgentKnowledge(agent.id, { enabled, tags, fallback });
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      setMessage({ tone: "success", text: "Acceso a la base de conocimiento guardado." });
      router.refresh();
    });
  }

  return (
    <>
      <Section
        title="Base de conocimiento"
        description="El agente responde primero con lo que sabe por su prompt. Si le falta un dato y tiene acceso, busca en la base. Si no lo encuentra y no sabe, deriva a una persona."
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Acceso a la base de conocimiento</p>
            <p className="text-xs text-muted-foreground">
              Apagado: el agente no tiene la herramienta de buscar y responde solo con su prompt.
            </p>
          </div>
          <Switch checked={enabled} onChange={(v) => { setMessage(null); setEnabled(v); }} label="Acceso a la base de conocimiento" />
        </div>

        {enabled && (
          <>
            <div>
              <p className="text-xs font-semibold">Etiquetas que puede consultar</p>
              <p className="text-[11px] text-muted-foreground">Sin ninguna elegida: toda la base, salvo los documentos de uso interno.</p>
              {allTags.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Los documentos todavía no tienen etiquetas.{" "}
                  <Link href="/dashboard/knowledge" className="underline underline-offset-2">Ir a la base de conocimiento</Link>
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Etiquetas">
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={tags.includes(tag)}
                      onClick={() => toggleTag(tag)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition-colors",
                        tags.includes(tag) ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent",
                      )}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Notice tone={counts.included === 0 ? "warning" : "info"}>
              Con esta selección el agente lee <strong>{counts.included}</strong> documento{counts.included === 1 ? "" : "s"}.
              {counts.internalExcluded > 0 && ` ${counts.internalExcluded} de uso interno nunca se usan.`}
              {counts.outsideTags > 0 && ` ${counts.outsideTags} quedan afuera por etiqueta.`}
            </Notice>

            <fieldset>
              <legend className="text-xs font-semibold">Si no encuentra nada relevante</legend>
              <div className="mt-2 space-y-2">
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input type="radio" name="kb-fallback" checked={fallback === "general"} onChange={() => setFallback("general")} className="mt-0.5" />
                  <span>
                    El agente decide: responde con lo que sabe y deriva si no está seguro
                    <span className="block text-xs text-muted-foreground">Recomendado. Una búsqueda vacía no deriva sola.</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input type="radio" name="kb-fallback" checked={fallback === "escalate"} onChange={() => setFallback("escalate")} className="mt-0.5" />
                  <span>
                    Se le indica que derive a una persona
                    <span className="block text-xs text-muted-foreground">Más conservador: puede derivar preguntas que el prompt ya contesta.</span>
                  </span>
                </label>
              </div>
            </fieldset>
          </>
        )}

        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={!dirty || pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            Guardar
          </button>
          {message && (
            <span role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-xs text-red-700 dark:text-red-400" : "text-xs text-emerald-700 dark:text-emerald-400"}>
              {message.text}
            </span>
          )}
        </div>
      </Section>
    </>
  );
}
