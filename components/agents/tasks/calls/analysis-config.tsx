"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, History, Plus } from "lucide-react";
import { saveCallTaskSettings } from "@/lib/actions/call-task-settings";
import { decideCategoryProposal } from "@/lib/actions/call-proposals";
import { Switch } from "@/components/ui/switch";
import { Notice, Section, inputClass } from "@/components/agents/fields";
import { cn } from "@/lib/utils";
import type { CallConfigData } from "@/lib/calls/config-data";
import { CATEGORY_GROUPS, CATEGORY_GROUP_LABELS, uniqueKey, validateRubric, type CategoryGroup } from "@/lib/calls/rubric";
import { MAX_COMPANY_CONTEXT, type CallAnalysisSettings } from "@/lib/calls/task-settings";
import { RubricEditor } from "./rubric-editor";
import { PromptTestPanel } from "./prompt-test-panel";

type Data = Extract<CallConfigData, { task: "call_analysis" }>;

/**
 * Configuracion de "Analisis de llamadas" (F19): cuando se analiza, que se
 * analiza, el contexto del negocio, la rubrica y las categorias (con la bandeja
 * de propuestas de la IA). No hay borrador ni "publicar": lo guardado es lo
 * vigente, igual que las instrucciones de las tareas. Sin `calls.configure`,
 * todo en solo lectura.
 */
export function AnalysisConfig({ data }: { data: Data }) {
  const router = useRouter();
  const readOnly = !data.canEdit;
  const [settings, setSettings] = useState<CallAnalysisSettings>(data.settings);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const dirty = JSON.stringify(settings) !== JSON.stringify(data.settings);
  const problems = validateRubric(settings.rubric);
  const canSave = dirty && problems.length === 0 && !pending;
  const patch = (p: Partial<CallAnalysisSettings>) => {
    setMessage(null);
    setSettings((s) => ({ ...s, ...p }));
  };

  function save() {
    setMessage(null);
    start(async () => {
      const result = await saveCallTaskSettings("call_analysis", settings);
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      setMessage({
        tone: "success",
        text: result.rubricVersion !== undefined && result.rubricVersion !== data.settings.rubric.version ? `Configuración guardada. La rúbrica pasó a la versión ${result.rubricVersion}.` : "Configuración guardada.",
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {readOnly && <Notice tone="info">Podés ver cómo está configurado, pero para cambiarlo necesitás el permiso “Configurar el análisis de llamadas”.</Notice>}

      <Section title="Cuándo y qué se analiza" description="Analizar cuesta: cada llamada es una corrida de IA con la transcripción completa. Por eso arranca en “Solo con el botón”.">
        <fieldset disabled={readOnly} className="space-y-2">
          <legend className="sr-only">Análisis automático</legend>
          {([["off", "Solo con el botón", "Alguien aprieta Analizar en cada llamada (o Analizar pendientes en la lista)."], ["now", "Automático", "Apenas se clasifica una llamada de un tipo que se analiza, se analiza sola."]] as const).map(([value, label, desc]) => (
            <label key={value} className="flex cursor-pointer items-start gap-3">
              <input type="radio" name="call-analysis-mode" checked={settings.mode === value} onChange={() => patch({ mode: value })} className="mt-1 h-4 w-4" />
              <span>
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-muted-foreground">{desc}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset disabled={readOnly}>
          <legend className="text-xs font-semibold">Tipos de llamada que se analizan</legend>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {data.validTypes.map((t) => {
              const on = settings.analyze_types.includes(t);
              return (
                <label key={t} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={on} onChange={() => patch({ analyze_types: on ? settings.analyze_types.filter((x) => x !== t) : [...settings.analyze_types, t] })} className="h-4 w-4" />
                  {t}
                </label>
              );
            })}
          </div>
        </fieldset>

        {([
          ["auto_summary", "Resumir después de analizar", "Saca el resumen, los próximos pasos y las ideas de contenido, y actualiza la memoria del contacto."],
          ["auto_knowledge", "Mandar a Conocimiento", "Cada llamada analizada queda como documento interno que el agente puede consultar."],
          ["allow_new_categories", "La IA puede proponer categorías nuevas", "Las propuestas llegan a la bandeja de abajo; nada se suma solo."],
        ] as const).map(([key, label, desc]) => (
          <div key={key} className="flex items-start gap-3">
            <Switch checked={settings[key]} onChange={(v) => patch({ [key]: v })} disabled={readOnly} label={label} />
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-xs text-muted-foreground">{desc}</span>
            </span>
          </div>
        ))}

        <div>
          <label htmlFor="call-company-context" className="block text-xs font-semibold text-foreground">Contexto del negocio</label>
          <textarea id="call-company-context" value={settings.company_context ?? ""} disabled={readOnly} onChange={(e) => patch({ company_context: e.target.value || null })} rows={5} className={cn(inputClass, "mt-1 resize-y")} />
          <p className={cn("mt-1 text-[11px]", (settings.company_context?.length ?? 0) > MAX_COMPANY_CONTEXT ? "text-red-700" : "text-muted-foreground")}>
            {(settings.company_context?.length ?? 0).toLocaleString("es")} / {MAX_COMPANY_CONTEXT.toLocaleString("es")} caracteres. Qué vendés, a quién y cómo. Viaja en cada análisis y en cada prueba.
          </p>
        </div>
      </Section>

      <Section title="Rúbrica" description={`Versión ${settings.rubric.version}. Cada análisis guarda la copia de la rúbrica con la que se hizo: cambiarla no altera los puntajes de las llamadas viejas.`}>
        {data.usingDefaultRubric && <Notice tone="info">Todavía no guardaste una rúbrica: se está usando la genérica de arranque. Cargá la de tu negocio y guardala.</Notice>}
        <RubricEditor value={settings.rubric} onChange={(rubric) => patch({ rubric })} readOnly={readOnly} />
        {!readOnly && data.rubricHistory.length > 0 && <RubricHistory history={data.rubricHistory} onLoad={(rubric) => patch({ rubric })} />}
      </Section>

      <PromptTestPanel
        calls={data.testableCalls}
        what="la rúbrica"
        getDraft={() => ({ rubricDraft: settings.rubric })}
        disabled={readOnly || problems.length > 0}
        disabledReason={readOnly ? "Necesitás el permiso de configurar." : problems.length > 0 ? "Corregí la rúbrica para poder probarla." : undefined}
      />

      <Section title="Categorías" description="Los dolores, deseos, objeciones y razones que la IA elige para cada llamada. La clave de una categoría no cambia al renombrarla.">
        {data.categoryProposals.length > 0 && <CategoryInbox data={data} dirty={dirty} settings={settings} onError={(text) => setMessage({ tone: "error", text })} />}
        {CATEGORY_GROUPS.map((group) => (
          <CategoryList key={group} group={group} settings={settings} readOnly={readOnly} onChange={(categories) => patch({ categories })} />
        ))}
      </Section>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={!canSave} title={problems[0]} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {pending ? "Guardando…" : "Guardar"}
          </button>
          {dirty && problems.length === 0 && <span className="text-xs text-amber-700 dark:text-amber-400">Cambios sin guardar</span>}
          {problems.length > 0 && <span className="text-xs text-amber-800 dark:text-amber-300">No se puede guardar: {problems[0]}</span>}
        </div>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </div>
  );
}

function RubricHistory({ history, onLoad }: { history: Data["rubricHistory"]; onLoad: (rubric: Data["settings"]["rubric"]) => void }) {
  return (
    <details className="rounded-lg border border-border">
      <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-semibold">
        <History className="h-3.5 w-3.5" aria-hidden /> Historial de la rúbrica
      </summary>
      <ul className="divide-y divide-border border-t border-border">
        {history.map((h) => (
          <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
            <span>Versión {h.version} · {new Date(h.at).toLocaleString("es")}</span>
            <button type="button" onClick={() => onLoad(h.rubric)} className="rounded-md border border-border px-2 py-1 font-medium hover:bg-accent">Cargar en el editor</button>
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">Cargarla no la guarda: la ves en el editor, la probás y recién ahí decidís.</p>
    </details>
  );
}

function CategoryList({ group, settings, readOnly, onChange }: { group: CategoryGroup; settings: CallAnalysisSettings; readOnly: boolean; onChange: (c: CallAnalysisSettings["categories"]) => void }) {
  const list = settings.categories.accepted[group];
  const [name, setName] = useState("");
  const set = (next: typeof list) => onChange({ ...settings.categories, accepted: { ...settings.categories.accepted, [group]: next } });
  return (
    <div>
      <h4 className="text-xs font-semibold">{CATEGORY_GROUP_LABELS[group]}</h4>
      {list.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Todavía no hay categorías. La IA usa “otra” hasta que sumes alguna.</p>}
      <ul className="mt-1 space-y-1">
        {list.map((c) => (
          <li key={c.clave} className={cn("flex items-center gap-2", c.archivado && "opacity-60")}>
            <input aria-label={`Nombre de la categoría ${c.nombre}`} value={c.nombre} disabled={readOnly} onChange={(e) => set(list.map((x) => (x.clave === c.clave ? { ...x, nombre: e.target.value } : x)))} className={cn(inputClass, "py-1.5")} />
            {!readOnly && (
              <button type="button" onClick={() => set(list.map((x) => (x.clave === c.clave ? { ...x, archivado: !x.archivado } : x)))} aria-label={c.archivado ? `Volver a activar ${c.nombre}` : `Archivar ${c.nombre}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent">
                {c.archivado ? <ArchiveRestore className="h-4 w-4" aria-hidden /> : <Archive className="h-4 w-4" aria-hidden />}
              </button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            set([...list, { clave: uniqueKey(trimmed, list.map((x) => x.clave)), nombre: trimmed }]);
            setName("");
          }}
        >
          <input aria-label={`Nueva categoría de ${CATEGORY_GROUP_LABELS[group]}`} placeholder="Nueva categoría" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={cn(inputClass, "py-1.5")} />
          <button type="submit" disabled={!name.trim()} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50">
            <Plus className="h-3.5 w-3.5" aria-hidden /> Agregar
          </button>
        </form>
      )}
    </div>
  );
}

function CategoryInbox({ data, dirty, settings, onError }: { data: Data; dirty: boolean; settings: CallAnalysisSettings; onError: (text: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState<Record<string, string>>({});
  const readOnly = !data.canEdit;

  function decide(p: Data["categoryProposals"][number], decision: "accept" | "merge" | "discard") {
    start(async () => {
      const result = await decideCategoryProposal({ group: p.group, key: p.key, decision, name: p.name, targetKey: target[`${p.group}:${p.key}`] ?? p.suggestion?.clave });
      if (!result.ok) return onError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      <h4 className="text-xs font-semibold">Propuestas de la IA ({data.categoryProposals.length})</h4>
      <p className="mt-0.5 text-[11px] text-muted-foreground">Aceptar la suma a la lista. Unir la mapea a una que ya existe, sin tocar los análisis. Descartar hace que se muestre como “Otra”.</p>
      {dirty && <p className="mt-1 text-[11px] text-muted-foreground">Guardá los cambios antes de decidir sobre una propuesta.</p>}
      <ul className="mt-2 divide-y divide-border">
        {data.categoryProposals.map((p) => {
          const k = `${p.group}:${p.key}`;
          const accepted = settings.categories.accepted[p.group].filter((c) => !c.archivado);
          return (
            <li key={k} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{p.name}</span>{" "}
                <span className="text-xs text-muted-foreground">· {CATEGORY_GROUP_LABELS[p.group]} · {p.calls} {p.calls === 1 ? "llamada" : "llamadas"}</span>
              </span>
              {!readOnly && (
                <span className="flex flex-wrap items-center gap-2">
                  <button type="button" disabled={pending || dirty} onClick={() => decide(p, "accept")} className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50">Aceptar</button>
                  {accepted.length > 0 && (
                    <>
                      <select aria-label={`Unir ${p.name} con`} value={target[k] ?? p.suggestion?.clave ?? accepted[0].clave} onChange={(e) => setTarget({ ...target, [k]: e.target.value })} className={cn(inputClass, "w-auto py-1 text-xs")}>
                        {accepted.map((c) => (
                          <option key={c.clave} value={c.clave}>{c.nombre}</option>
                        ))}
                      </select>
                      <button type="button" disabled={pending || dirty} onClick={() => decide(p, "merge")} className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50">Unir</button>
                    </>
                  )}
                  <button type="button" disabled={pending || dirty} onClick={() => decide(p, "discard")} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50">Descartar</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
