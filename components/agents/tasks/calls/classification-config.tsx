"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { saveCallTaskSettings } from "@/lib/actions/call-task-settings";
import { decideTypeProposal } from "@/lib/actions/call-proposals";
import { Switch } from "@/components/ui/switch";
import { Notice, Section, inputClass } from "@/components/agents/fields";
import { cn } from "@/lib/utils";
import type { CallConfigData } from "@/lib/calls/config-data";
import { newCustomType, validTypeKeys, type CallClassificationSettings, type ClassificationRuleSetting, type RuleCondition } from "@/lib/calls/task-settings";

type Data = Extract<CallConfigData, { task: "call_classification" }>;

const COND_LABELS: Record<RuleCondition, { label: string; kind: "minutes" | "number" | "terms" | "none"; hint?: string }> = {
  duration_lt: { label: "Dura menos de", kind: "minutes", hint: "minutos" },
  people_gte: { label: "Participan al menos", kind: "number", hint: "personas" },
  title_contains: { label: "El título contiene", kind: "terms", hint: "palabras separadas por coma" },
  email_contains: { label: "Algún correo contiene", kind: "terms", hint: "textos separados por coma (por ejemplo, un dominio)" },
  only_team: { label: "Solo hay gente del equipo", kind: "none" },
  has_appointment: { label: "Tiene una agenda vinculada", kind: "none" },
};

const COND_ORDER = Object.keys(COND_LABELS) as RuleCondition[];

/**
 * Configuracion de "Clasificacion de llamadas" (F17, F19): si usa IA, las
 * reglas (se aplican en orden, la primera que cumple decide), el umbral de
 * confianza y los tipos. Sin `calls.configure` se ve entero pero no se edita.
 */
export function ClassificationConfig({ data }: { data: Data }) {
  const router = useRouter();
  const readOnly = !data.canEdit;
  const [settings, setSettings] = useState<CallClassificationSettings>(data.settings);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [newType, setNewType] = useState({ name: "", description: "" });

  const dirty = JSON.stringify(settings) !== JSON.stringify(data.settings);
  const types = validTypeKeys(settings.custom_types);
  const patch = (p: Partial<CallClassificationSettings>) => {
    setMessage(null);
    setSettings((s) => ({ ...s, ...p }));
  };
  const updateRule = (id: string, p: Partial<ClassificationRuleSetting>) => patch({ rules: settings.rules.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  const move = (index: number, dir: -1 | 1) => {
    const rules = [...settings.rules];
    const target = index + dir;
    if (target < 0 || target >= rules.length) return;
    [rules[index], rules[target]] = [rules[target], rules[index]];
    patch({ rules });
  };

  function save() {
    setMessage(null);
    start(async () => {
      const result = await saveCallTaskSettings("call_classification", settings);
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      setMessage({ tone: "success", text: "Configuración guardada." });
      router.refresh();
    });
  }

  function decide(name: string, decision: "accept" | "discard") {
    setMessage(null);
    start(async () => {
      const result = await decideTypeProposal({ name, decision });
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {readOnly && <Notice tone="info">Podés ver cómo está configurado, pero para cambiarlo necesitás el permiso “Configurar el análisis de llamadas”.</Notice>}

      <Section title="Cómo se clasifica" description="Primero corren las reglas, sin gastar IA. Lo que ninguna regla decide, lo decide la IA (si está prendida) o queda “Por revisar” para que alguien elija el tipo.">
        <fieldset disabled={readOnly} className="space-y-2">
          <legend className="sr-only">Clasificación con IA</legend>
          {([["now", "Con IA", "Las reglas primero; lo demás lo decide la IA."], ["off", "Solo reglas", "Lo que las reglas no deciden queda “Por revisar”."]] as const).map(([value, label, desc]) => (
            <label key={value} className="flex cursor-pointer items-start gap-3">
              <input type="radio" name="call-class-mode" checked={settings.mode === value} onChange={() => patch({ mode: value })} className="mt-1 h-4 w-4" />
              <span>
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-muted-foreground">{desc}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div>
          <label htmlFor="call-class-threshold" className="block text-xs font-semibold text-foreground">
            Confianza mínima para aceptar lo que decide la IA: {Math.round(settings.confidence_threshold * 100)}%
          </label>
          <input id="call-class-threshold" type="range" min={0} max={100} step={5} value={Math.round(settings.confidence_threshold * 100)} disabled={readOnly} onChange={(e) => patch({ confidence_threshold: Number(e.target.value) / 100 })} className="mt-1 w-full" />
          <p className="mt-1 text-[11px] text-muted-foreground">Por debajo de esto, la llamada queda “Por revisar” y no se analiza sola.</p>
        </div>
      </Section>

      <Section title="Reglas" description="Se revisan de arriba hacia abajo: gana la primera que se cumple. Sirven para lo obvio (una llamada de 2 minutos no es un cierre) sin gastar IA.">
        {settings.rules.length === 0 && <p className="text-sm text-muted-foreground">No hay reglas: todo lo decide la IA (o queda por revisar).</p>}
        <ol className="space-y-2">
          {settings.rules.map((r, i) => {
            const meta = COND_LABELS[r.cond];
            return (
              <li key={r.id} className={cn("rounded-lg border border-border p-3", !r.on && "opacity-60")}>
                <div className="flex flex-wrap items-center gap-2">
                  <Switch checked={r.on} onChange={(on) => updateRule(r.id, { on })} disabled={readOnly} label={`Regla ${i + 1} activa`} size="sm" />
                  <select aria-label={`Condición de la regla ${i + 1}`} value={r.cond} disabled={readOnly} onChange={(e) => updateRule(r.id, { cond: e.target.value as RuleCondition, value: null })} className={cn(inputClass, "w-auto py-1.5")}>
                    {COND_ORDER.map((c) => (
                      <option key={c} value={c}>{COND_LABELS[c].label}</option>
                    ))}
                  </select>
                  {meta.kind === "minutes" || meta.kind === "number" ? (
                    <input aria-label={`Valor de la regla ${i + 1}`} type="number" min={1} value={typeof r.value === "number" ? r.value : ""} disabled={readOnly} onChange={(e) => updateRule(r.id, { value: Number(e.target.value) || null })} className={cn(inputClass, "w-20 py-1.5")} />
                  ) : meta.kind === "terms" ? (
                    <input aria-label={`Valor de la regla ${i + 1}`} value={Array.isArray(r.value) ? r.value.join(", ") : ""} disabled={readOnly} onChange={(e) => updateRule(r.id, { value: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} className={cn(inputClass, "min-w-40 flex-1 py-1.5")} />
                  ) : null}
                  {meta.hint && <span className="text-xs text-muted-foreground">{meta.hint}</span>}
                  <span className="text-xs text-muted-foreground">→ es</span>
                  <select aria-label={`Tipo de la regla ${i + 1}`} value={r.type} disabled={readOnly} onChange={(e) => updateRule(r.id, { type: e.target.value })} className={cn(inputClass, "w-auto py-1.5")}>
                    {types.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {!readOnly && (
                    <span className="ml-auto flex items-center gap-1">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Subir la regla ${i + 1}`} className="rounded-md p-1.5 hover:bg-accent disabled:opacity-30"><ArrowUp className="h-4 w-4" aria-hidden /></button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === settings.rules.length - 1} aria-label={`Bajar la regla ${i + 1}`} className="rounded-md p-1.5 hover:bg-accent disabled:opacity-30"><ArrowDown className="h-4 w-4" aria-hidden /></button>
                      <button type="button" onClick={() => patch({ rules: settings.rules.filter((x) => x.id !== r.id) })} aria-label={`Borrar la regla ${i + 1}`} className="rounded-md p-1.5 text-red-700 hover:bg-accent"><Trash2 className="h-4 w-4" aria-hidden /></button>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {!readOnly && (
          <button type="button" onClick={() => patch({ rules: [...settings.rules, { id: `r-${Date.now().toString(36)}`, on: true, cond: "title_contains", value: [], type: "otra" }] })} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <Plus className="h-3.5 w-3.5" aria-hidden /> Agregar regla
          </button>
        )}
      </Section>

      <Section title="Tipos de llamada" description="Los del sistema no se borran. Podés sumar los tuyos y archivarlos cuando ya no hagan falta.">
        <ul className="flex flex-wrap gap-1.5">
          {types.map((t) => (
            <li key={t} className="rounded-full bg-muted px-2.5 py-1 text-xs">{t}</li>
          ))}
        </ul>
        {settings.custom_types.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {settings.custom_types.map((t) => (
              <li key={t.clave} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className={cn("min-w-0", t.archivado && "opacity-60")}>
                  <p className="text-sm font-medium">{t.nombre} <span className="font-mono text-[11px] text-muted-foreground">{t.clave}</span></p>
                  {t.descripcion && <p className="text-xs text-muted-foreground">{t.descripcion}</p>}
                </div>
                {!readOnly && (
                  <button type="button" onClick={() => patch({ custom_types: settings.custom_types.map((x) => (x.clave === t.clave ? { ...x, archivado: !x.archivado } : x)) })} className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent">
                    {t.archivado ? "Volver a activar" : "Archivar"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <input aria-label="Nombre del tipo nuevo" placeholder="Nombre (ej: Mesa redonda)" value={newType.name} maxLength={60} onChange={(e) => setNewType({ ...newType, name: e.target.value })} className={inputClass} />
            <input aria-label="Descripción del tipo nuevo" placeholder="Cuándo se usa" value={newType.description} maxLength={400} onChange={(e) => setNewType({ ...newType, description: e.target.value })} className={inputClass} />
            <button
              type="button"
              disabled={!newType.name.trim()}
              onClick={() => {
                patch({ custom_types: [...settings.custom_types, newCustomType(newType.name, newType.description, settings.custom_types)] });
                setNewType({ name: "", description: "" });
              }}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Agregar
            </button>
          </div>
        )}
        <div className="flex items-center gap-3">
          <Switch checked={settings.allow_ai_types} onChange={(v) => patch({ allow_ai_types: v })} disabled={readOnly} label="La IA puede proponer tipos nuevos" />
          <span className="text-sm">La IA puede proponer tipos nuevos</span>
        </div>
        {data.typeProposals.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold">Tipos propuestos por la IA</h4>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {data.typeProposals.map((p) => (
                <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="text-sm">{p.name} <span className="text-xs text-muted-foreground">· {p.calls} {p.calls === 1 ? "llamada" : "llamadas"}</span></span>
                  <span className="flex gap-2">
                    <button type="button" disabled={pending || dirty} onClick={() => decide(p.name, "accept")} className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50">Aceptar</button>
                    <button type="button" disabled={pending || dirty} onClick={() => decide(p.name, "discard")} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50">Descartar</button>
                  </span>
                </li>
              ))}
            </ul>
            {dirty && <p className="mt-1 text-[11px] text-muted-foreground">Guardá los cambios de arriba antes de aceptar o descartar una propuesta.</p>}
          </div>
        )}
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
