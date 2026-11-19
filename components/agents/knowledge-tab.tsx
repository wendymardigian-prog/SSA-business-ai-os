"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { updateAgentKnowledge } from "@/lib/actions/agents";
import { countIncludedDocuments, type AgentScreenData } from "@/lib/agent/screen";
import { Notice, Section } from "./fields";

const sameSet = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/**
 * Pestana Conocimiento (F27, ): si el agente accede a la base, a qué
 * parte (toda, o carpetas, documentos y etiquetas) y qué hace si no encuentra
 * nada. El contador muestra cuántos documentos lee con la selección actual,
 * con el mismo criterio que la búsqueda (00412), para que no haya sorpresas.
 */
export function KnowledgeTab({ data }: { data: AgentScreenData }) {
  const router = useRouter();
  const { agent, knowledgeDocs } = data;
  const folders = data.knowledgeFolders ?? [];
  const [enabled, setEnabled] = useState(agent.knowledgeEnabled);
  const [tags, setTags] = useState<string[]>(agent.knowledgeTags);
  const [documentIds, setDocumentIds] = useState<string[]>(agent.knowledgeDocumentIds);
  const [folderIds, setFolderIds] = useState<string[]>(agent.knowledgeFolderIds);
  const [partial, setPartial] = useState(agent.knowledgeTags.length + agent.knowledgeDocumentIds.length + agent.knowledgeFolderIds.length > 0);
  const [docQuery, setDocQuery] = useState("");
  const [fallback, setFallback] = useState(agent.knowledgeFallback);
  const [citeSources, setCiteSources] = useState(agent.citeSources);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const allTags = [...new Set(knowledgeDocs.flatMap((d) => d.tags))].sort();
  const effTags = partial ? tags : [];
  const effDocs = partial ? documentIds : [];
  const effFolders = partial ? folderIds : [];
  const counts = countIncludedDocuments(knowledgeDocs, effTags, effDocs, effFolders);
  const nothingPicked = partial && effTags.length + effDocs.length + effFolders.length === 0;
  const publicDocs = knowledgeDocs.filter((d) => !d.internalOnly);
  const q = docQuery.trim().toLowerCase();
  const shownDocs = q ? publicDocs.filter((d) => d.title.toLowerCase().includes(q)) : publicDocs;
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  const dirty =
    enabled !== agent.knowledgeEnabled ||
    fallback !== agent.knowledgeFallback ||
    citeSources !== agent.citeSources ||
    !sameSet(effTags, agent.knowledgeTags) ||
    !sameSet(effDocs, agent.knowledgeDocumentIds) ||
    !sameSet(effFolders, agent.knowledgeFolderIds);

  const toggle = (setter: (fn: (prev: string[]) => string[]) => void) => (value: string) => {
    setMessage(null);
    setter((prev) => (prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value]));
  };
  const toggleTag = toggle(setTags);
  const toggleFolder = toggle(setFolderIds);
  const toggleDoc = toggle(setDocumentIds);

  function save() {
    setMessage(null);
    if (enabled && nothingPicked) {
      setMessage({ tone: "error", text: "Elegí al menos una carpeta, un documento o una etiqueta, o marcá «Toda la base»." });
      return;
    }
    start(async () => {
      const result = await updateAgentKnowledge(agent.id, { enabled, tags: effTags, documentIds: effDocs, folderIds: effFolders, fallback, citeSources });
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
            <fieldset>
              <legend className="text-xs font-semibold">A qué parte de la base llega</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="radio" name="kb-scope" checked={!partial} onChange={() => { setMessage(null); setPartial(false); }} />
                  Toda la base
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="radio" name="kb-scope" checked={partial} onChange={() => { setMessage(null); setPartial(true); }} />
                  Solo una parte
                </label>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Los documentos de uso interno nunca llegan al agente. Con «Solo una parte» lee lo que esté en alguna de las carpetas, documentos o etiquetas elegidos.
              </p>
            </fieldset>

            {partial && (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold">Carpetas</p>
                  <p className="text-[11px] text-muted-foreground">Todo lo que haya dentro, también lo que se agregue después.</p>
                  {folders.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Todavía no hay carpetas.{" "}
                      <Link href="/dashboard/knowledge" className="underline underline-offset-2">Crear una en la base de conocimiento</Link>
                    </p>
                  ) : (
                    <ChipGroup label="Carpetas" options={folders.map((f) => ({ value: f.id, label: f.name }))} selected={folderIds} onToggle={toggleFolder} />
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold">Documentos sueltos</p>
                  {publicDocs.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">La base todavía no tiene documentos que el agente pueda leer.</p>
                  ) : (
                    <>
                      {publicDocs.length > 8 && (
                        <input
                          type="search"
                          value={docQuery}
                          onChange={(e) => setDocQuery(e.target.value)}
                          placeholder="Buscar documento…"
                          aria-label="Buscar documento"
                          className="mt-2 w-full max-w-sm rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
                        />
                      )}
                      <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2" aria-label="Documentos">
                        {shownDocs.map((d) => (
                          <li key={d.id}>
                            <label className="flex min-w-0 cursor-pointer items-center gap-2 text-sm">
                              <input type="checkbox" checked={documentIds.includes(d.id)} onChange={() => toggleDoc(d.id)} />
                              <span className="truncate">{d.title}</span>
                              {d.folderId && folderName.has(d.folderId) && (
                                <span className="shrink-0 text-[11px] text-muted-foreground">{folderName.get(d.folderId)}</span>
                              )}
                            </label>
                          </li>
                        ))}
                        {shownDocs.length === 0 && <li className="text-xs text-muted-foreground">Ningún documento coincide.</li>}
                      </ul>
                    </>
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold">Etiquetas</p>
                  {allTags.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">Los documentos todavía no tienen etiquetas.</p>
                  ) : (
                    <ChipGroup label="Etiquetas" options={allTags.map((t) => ({ value: t, label: t }))} selected={tags} onToggle={toggleTag} />
                  )}
                </div>
              </div>
            )}

            <Notice tone={counts.included === 0 || nothingPicked ? "warning" : "info"}>
              Con esta selección el agente lee <strong>{counts.included}</strong> documento{counts.included === 1 ? "" : "s"}.
              {counts.internalExcluded > 0 && ` ${counts.internalExcluded} de uso interno nunca se usan.`}
              {counts.outsideTags > 0 && ` ${counts.outsideTags} quedan fuera de la parte elegida.`}
              {nothingPicked && " Elegí al menos una carpeta, un documento o una etiqueta."}
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

            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" checked={citeSources} onChange={(e) => setCiteSources(e.target.checked)} className="mt-0.5" />
              <span>
                Citar la fuente en la respuesta
                <span className="block text-xs text-muted-foreground">
                  Si usa un documento, la respuesta cierra con «Fuente: «Documento», pág. N». Apagado, el lead no ve nada de esto; el documento y la página
                  quedan igual en Corridas.
                </span>
              </span>
            </label>
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

function ChipGroup({ label, options, selected, onToggle }: { label: string; options: Array<{ value: string; label: string }>; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={selected.includes(o.value)}
          onClick={() => onToggle(o.value)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs transition-colors",
            selected.includes(o.value) ? "border-primary-edge bg-primary text-primary-foreground" : "border-border hover:bg-accent",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
