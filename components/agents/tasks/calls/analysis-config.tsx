"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ChevronDown, Plus } from "lucide-react";
import { saveCallTaskSettings } from "@/lib/actions/call-task-settings";
import { decideCategoryProposal } from "@/lib/actions/call-proposals";
import { Switch } from "@/components/ui/switch";
import { Notice, Section, inputClass } from "@/components/agents/fields";
import { cn } from "@/lib/utils";
import type { CallConfigData } from "@/lib/calls/config-data";
import { PROFILE_STATE_LABELS, profileState, type CallAnalysisProfile } from "@/lib/calls/profiles";
import { CATEGORY_GROUPS, CATEGORY_GROUP_LABELS, uniqueKey, type CategoryGroup } from "@/lib/calls/rubric";
import { MAX_COMPANY_CONTEXT, type CallAnalysisSettings } from "@/lib/calls/task-settings";
import { ProfileEditor, type ProfileTarget } from "./profile-editor";

type Data = Extract<CallConfigData, { task: "call_analysis" }>;

/**
 * Configuracion de "Analisis de llamadas": un analizador por tipo de reunion y lo que comparten
 * todos (el contexto del negocio y las categorias). Sin analizador, ese tipo no se analiza ni
 * gasta IA. Sin `calls.configure`, todo en solo lectura.
 */
export function AnalysisConfig({ data }: { data: Data }) {
  const router = useRouter();
  const readOnly = !data.canEdit;
  const [settings, setSettings] = useState<CallAnalysisSettings>(data.settings);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const dirty = JSON.stringify(settings) !== JSON.stringify(data.settings);
  const patch = (p: Partial<CallAnalysisSettings>) => {
    setMessage(null);
    setSettings((s) => ({ ...s, ...p }));
  };

  function save() {
    setMessage(null);
    start(async () => {
      const result = await saveCallTaskSettings("call_analysis", settings);
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      setMessage({ tone: "success", text: "Configuración guardada." });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {readOnly && <Notice tone="info">Podés ver cómo está configurado, pero para cambiarlo necesitás el permiso “Configurar el análisis de llamadas”.</Notice>}

      <Section title="Analizadores por tipo de reunión" description="Cada tipo se evalúa con lo suyo: instrucciones, rúbrica, puntaje y cuándo corre. Un tipo sin analizador no se analiza ni gasta IA.">
        <ProfileList data={data} />
      </Section>

      <Section title="Lo que comparten todos" description="Viaja en cada análisis y en cada prueba.">
        <div>
          <label htmlFor="call-company-context" className="block text-xs font-semibold text-foreground">Contexto del negocio</label>
          <textarea id="call-company-context" value={settings.company_context ?? ""} disabled={readOnly} onChange={(e) => patch({ company_context: e.target.value || null })} rows={5} className={cn(inputClass, "mt-1 resize-y")} />
          <p className={cn("mt-1 text-[11px]", (settings.company_context?.length ?? 0) > MAX_COMPANY_CONTEXT ? "text-red-700" : "text-muted-foreground")}>
            {(settings.company_context?.length ?? 0).toLocaleString("es")} / {MAX_COMPANY_CONTEXT.toLocaleString("es")} caracteres. Qué vendés, a quién y cómo.
          </p>
        </div>
        <div className="flex items-start gap-3">
          <Switch checked={settings.allow_new_categories} onChange={(v) => patch({ allow_new_categories: v })} disabled={readOnly} label="La IA puede proponer categorías nuevas" />
          <span>
            <span className="block text-sm font-medium">La IA puede proponer categorías nuevas</span>
            <span className="block text-xs text-muted-foreground">Las propuestas llegan a la bandeja de abajo; nada se suma solo.</span>
          </span>
        </div>
      </Section>

      <Section title="Categorías" description="Los dolores, deseos, objeciones y razones que la IA elige en el formato de ventas. Son las mismas para todos los tipos, así el dashboard las puede comparar. La clave de una categoría no cambia al renombrarla.">
        {data.categoryProposals.length > 0 && <CategoryInbox data={data} dirty={dirty} settings={settings} onError={(text) => setMessage({ tone: "error", text })} />}
        {CATEGORY_GROUPS.map((group) => (
          <CategoryList key={group} group={group} settings={settings} readOnly={readOnly} onChange={(categories) => patch({ categories })} />
        ))}
      </Section>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={!dirty || pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {pending ? "Guardando…" : "Guardar"}
          </button>
          {dirty && <span className="text-xs text-amber-700 dark:text-amber-400">Cambios sin guardar</span>}
        </div>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </div>
  );
}

const STATE_CLASS = {
  none: "bg-muted text-muted-foreground",
  manual: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  auto: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
} as const;

/** La lista por area y tipo, con su estado. Se edita uno a la vez, abajo de su fila. */
function ProfileList({ data }: { data: Data }) {
  const [open, setOpen] = useState<string | null>(null);
  const profileFor = (id: string): CallAnalysisProfile | null => data.profiles.find((p) => p.categoryId === id) ?? null;

  const row = (target: ProfileTarget, hint?: string) => {
    const profile = profileFor(target.categoryId);
    const state = profileState(profile);
    const isOpen = open === target.categoryId;
    return (
      <li key={target.categoryId}>
        <div className="flex items-center gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{target.label}</p>
            {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
          </div>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", STATE_CLASS[state])}>{PROFILE_STATE_LABELS[state]}</span>
          <button type="button" onClick={() => setOpen(isOpen ? null : target.categoryId)} aria-expanded={isOpen} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent">
            {state === "none" ? "Configurar" : "Editar"}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} aria-hidden />
          </button>
        </div>
        {/* La clave vuelve a armar el formulario si el analizador cambio en el servidor (al guardar o quitar). */}
        {isOpen && <ProfileEditor key={`${target.categoryId}:${profile?.id ?? "nuevo"}`} data={data} target={target} profile={profile} onClose={() => setOpen(null)} />}
      </li>
    );
  };

  return (
    <div className="space-y-3">
      {data.categoryGroups.map((group) => (
        <section key={group.areaId} aria-label={group.areaName} className="overflow-hidden rounded-lg border border-border">
          <h4 className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-semibold">{group.areaName}</h4>
          <ul className="divide-y divide-border">
            {group.types.map((t) => row({ categoryId: t.id, label: t.name }))}
            {row({ categoryId: group.areaId, label: group.types.length > 0 ? "Toda el área" : group.areaName }, group.types.length > 0 ? "Para los tipos sin analizador propio y lo que tiene área pero no tipo." : undefined)}
          </ul>
        </section>
      ))}
    </div>
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
