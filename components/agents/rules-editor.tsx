"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ChevronUp, ChevronDown, Play, Save, AlertTriangle } from "lucide-react";
import { RULE_FIELDS, RULE_ACTIONS, fieldDef, type RuleAction, type RuleOperator } from "@/lib/agent/rules/fields";
import type { Rule, RuleCondition } from "@/lib/agent/rules/evaluate";
import { unreachableRuleIds } from "@/lib/agent/rules/unreachable";
import { defaultRulesTemplate } from "@/lib/agent/rules/template";
import { saveResponseRulesAction, setResponseRulesDefaultAction, simulateResponseRulesAction } from "@/lib/actions/agents";
import type { SimulationResult } from "@/lib/agent/rules/simulate";
import { Notice } from "./fields";

const ACTION_LABEL: Record<RuleAction, string> = {
  send: "Enviar directo",
  draft: "Dejar borrador",
  skip: "No responder",
};

const OP_LABEL: Record<string, string> = {
  contains_any: "contiene alguna de",
  not_contains_any: "no contiene ninguna de",
  is: "es",
  is_not: "no es",
  gt: "es mayor que",
  lt: "es menor que",
  has_any: "tiene alguna de",
  has_none: "no tiene ninguna de",
};

let nextId = 1;
const newRuleId = () => `r_${Date.now()}_${nextId++}`;

export function RulesEditor({
  agentId,
  initialRules,
  initialDefault,
  channels,
  tags,
}: {
  agentId: string;
  initialRules: Rule[];
  initialDefault: RuleAction;
  channels: Array<{ id: string; label: string }>;
  tags: string[];
}) {
  const router = useRouter();
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [defaultAction, setDefaultAction] = useState<RuleAction>(initialDefault);
  const [sim, setSim] = useState<{ result: SimulationResult; sampled: number; hash: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const hash = useMemo(() => JSON.stringify({ rules, defaultAction }), [rules, defaultAction]);
  const simulatedForCurrent = sim?.hash === hash;
  const unreachable = useMemo(() => new Set(unreachableRuleIds(rules)), [rules]);

  function patchRule(id: string, patch: Partial<Rule>) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setSaved(false);
  }
  function move(index: number, dir: -1 | 1) {
    setRules((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
    setSaved(false);
  }
  function addRule() {
    setRules((prev) => [...prev, { id: newRuleId(), name: "", enabled: true, action: "draft", conditions: [{ field: "inbound.text", op: "contains_any", value: [] }] }]);
    setSaved(false);
  }
  function loadTemplate() {
    const t = defaultRulesTemplate();
    setRules(t.rules);
    setDefaultAction(t.defaultAction);
    setSaved(false);
  }

  function simulate() {
    setError(null);
    start(async () => {
      const res = await simulateResponseRulesAction(agentId, rules, defaultAction);
      if (!res.ok) return setError(res.error);
      setSim({ result: res.result, sampled: res.sampled, hash });
    });
  }
  function save() {
    setError(null);
    start(async () => {
      const a = await saveResponseRulesAction(agentId, rules);
      if (!a.ok) return setError(a.error);
      const b = await setResponseRulesDefaultAction(agentId, defaultAction);
      if (!b.ok) return setError(b.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="mt-4 space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Reglas de respuesta</h3>
        {rules.length === 0 && (
          <button type="button" onClick={loadTemplate} className="text-xs text-primary underline underline-offset-2">
            Cargar plantilla
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Se leen de arriba hacia abajo. Gana la primera regla que coincide. Los guardarraíles del agente van primero: ninguna regla los saltea.
      </p>

      <ol className="space-y-3">
        {rules.map((rule, index) => (
          <li key={rule.id} className={`rounded-lg border p-3 ${unreachable.has(rule.id) ? "border-amber-300" : "border-border"}`}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">{index + 1}.</span>
              <input
                value={rule.name ?? ""}
                onChange={(e) => patchRule(rule.id, { name: e.target.value })}
                placeholder="Nombre (opcional)"
                className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
              />
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={rule.enabled} onChange={(e) => patchRule(rule.id, { enabled: e.target.checked })} />
                Activa
              </label>
              <button type="button" aria-label="Subir" onClick={() => move(index, -1)} disabled={index === 0} className="p-1 disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
              <button type="button" aria-label="Bajar" onClick={() => move(index, 1)} disabled={index === rules.length - 1} className="p-1 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
              <button type="button" aria-label="Borrar" onClick={() => { setRules((p) => p.filter((r) => r.id !== rule.id)); setSaved(false); }} className="p-1 text-red-600"><Trash2 className="h-4 w-4" /></button>
            </div>

            <div className="mt-2 space-y-2 pl-6">
              {rule.conditions.map((cond, ci) => (
                <ConditionRow
                  key={ci}
                  cond={cond}
                  channels={channels}
                  tags={tags}
                  onChange={(next) => patchRule(rule.id, { conditions: rule.conditions.map((c, i) => (i === ci ? next : c)) })}
                  onRemove={rule.conditions.length > 1 ? () => patchRule(rule.id, { conditions: rule.conditions.filter((_, i) => i !== ci) }) : undefined}
                />
              ))}
              <button
                type="button"
                onClick={() => patchRule(rule.id, { conditions: [...rule.conditions, { field: "inbound.text", op: "contains_any", value: [] }] })}
                className="text-xs text-primary underline underline-offset-2"
              >
                + y además…
              </button>
            </div>

            <div className="mt-2 flex items-center gap-2 pl-6">
              <span className="text-xs text-muted-foreground">Entonces:</span>
              <select value={rule.action} onChange={(e) => patchRule(rule.id, { action: e.target.value as RuleAction })} className="rounded-md border border-input bg-background px-2 py-1 text-sm">
                {RULE_ACTIONS.map((a) => (<option key={a} value={a}>{ACTION_LABEL[a]}</option>))}
              </select>
            </div>
            {unreachable.has(rule.id) && (
              <p className="mt-2 flex items-center gap-1 pl-6 text-xs text-amber-700">
                <AlertTriangle className="h-3 w-3" /> Una regla anterior ya cubre este caso: nunca va a coincidir.
              </p>
            )}
          </li>
        ))}
      </ol>

      <button type="button" onClick={addRule} className="flex items-center gap-1 text-sm text-primary underline underline-offset-2">
        <Plus className="h-4 w-4" /> Agregar regla
      </button>

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <span className="text-sm text-muted-foreground">Si ninguna regla coincide:</span>
        <select value={defaultAction} onChange={(e) => { setDefaultAction(e.target.value as RuleAction); setSaved(false); }} className="rounded-md border border-input bg-background px-2 py-1 text-sm">
          {RULE_ACTIONS.map((a) => (<option key={a} value={a}>{ACTION_LABEL[a]}</option>))}
        </select>
      </div>

      {sim && simulatedForCurrent && (
        <div className="rounded-lg border border-border bg-accent/30 p-3 text-sm">
          <p className="font-medium">Simulación sobre {sim.sampled} turnos de los últimos 30 días</p>
          <p className="mt-1 text-muted-foreground">
            Enviar directo: {sim.result.totals.send} · Dejar borrador: {sim.result.totals.draft} · No responder: {sim.result.totals.skip}
          </p>
          {sim.result.totals.send > 0 && (
            <p className="mt-1 text-muted-foreground">
              De los que se habrían enviado directo: {sim.result.wouldSendContrast.approvedUnchanged} se aprobaron sin cambios,
              {" "}{sim.result.wouldSendContrast.corrected} se corrigieron, {sim.result.wouldSendContrast.discarded} se descartaron.
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            La temperatura y las etiquetas se toman como están hoy. La intención no se simula para turnos que no la tengan guardada.
          </p>
        </div>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {saved && <Notice tone="success">Reglas guardadas.</Notice>}

      <div className="flex items-center gap-2">
        <button type="button" onClick={simulate} disabled={pending} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50">
          <Play className="h-4 w-4" /> Simular
        </button>
        <button type="button" onClick={save} disabled={pending || !simulatedForCurrent} className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50" title={!simulatedForCurrent ? "Simulá los cambios antes de guardar" : undefined}>
          <Save className="h-4 w-4" /> Guardar
        </button>
        {!simulatedForCurrent && <span className="text-xs text-muted-foreground">Simulá antes de guardar.</span>}
      </div>
    </div>
  );
}

function ConditionRow({
  cond,
  channels,
  tags,
  onChange,
  onRemove,
}: {
  cond: RuleCondition;
  channels: Array<{ id: string; label: string }>;
  tags: string[];
  onChange: (next: RuleCondition) => void;
  onRemove?: () => void;
}) {
  const def = fieldDef(cond.field);
  const ops = def?.operators ?? [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={cond.field}
        onChange={(e) => {
          const nd = fieldDef(e.target.value);
          onChange({ field: e.target.value, op: (nd?.operators[0] ?? "is") as RuleOperator, value: defaultValueFor(nd?.valueType) });
        }}
        className="rounded-md border border-input bg-background px-2 py-1 text-sm"
      >
        {RULE_FIELDS.map((f) => (<option key={f.field} value={f.field}>{f.label}</option>))}
      </select>
      <select value={cond.op} onChange={(e) => onChange({ ...cond, op: e.target.value as RuleOperator })} className="rounded-md border border-input bg-background px-2 py-1 text-sm">
        {ops.map((op) => (<option key={op} value={op}>{OP_LABEL[op] ?? op}</option>))}
      </select>
      <ValueInput valueType={def?.valueType} value={cond.value} channels={channels} tags={tags} onChange={(v) => onChange({ ...cond, value: v })} />
      {onRemove && (<button type="button" aria-label="Quitar condición" onClick={onRemove} className="p-1 text-muted-foreground"><Trash2 className="h-3.5 w-3.5" /></button>)}
    </div>
  );
}

function defaultValueFor(valueType?: string): unknown {
  switch (valueType) {
    case "words":
    case "tags": return [];
    case "number": return 0;
    case "bool": return true;
    case "temperature": return "hot";
    case "channel": return "";
    case "intent": return { category_id: "" };
    default: return "";
  }
}

function ValueInput({
  valueType,
  value,
  channels,
  tags,
  onChange,
}: {
  valueType?: string;
  value: unknown;
  channels: Array<{ id: string; label: string }>;
  tags: string[];
  onChange: (v: unknown) => void;
}) {
  const cls = "rounded-md border border-input bg-background px-2 py-1 text-sm";
  if (valueType === "words" || valueType === "tags") {
    return (
      <input
        value={Array.isArray(value) ? value.join(", ") : ""}
        onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
        placeholder={valueType === "tags" ? "etiquetas separadas por coma" : "palabras separadas por coma"}
        className={`${cls} min-w-[16rem] flex-1`}
      />
    );
  }
  if (valueType === "number") {
    return <input type="number" value={typeof value === "number" ? value : 0} onChange={(e) => onChange(Number(e.target.value))} className={`${cls} w-24`} />;
  }
  if (valueType === "bool") {
    return (
      <select value={value ? "true" : "false"} onChange={(e) => onChange(e.target.value === "true")} className={cls}>
        <option value="true">sí</option>
        <option value="false">no</option>
      </select>
    );
  }
  if (valueType === "temperature") {
    return (
      <select value={String(value)} onChange={(e) => onChange(e.target.value)} className={cls}>
        <option value="cold">frío</option>
        <option value="warm">tibio</option>
        <option value="hot">caliente</option>
      </select>
    );
  }
  if (valueType === "channel") {
    return (
      <select value={String(value)} onChange={(e) => onChange(e.target.value)} className={cls}>
        <option value="">elegí un canal</option>
        {channels.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
      </select>
    );
  }
  if (valueType === "intent") {
    const v = (value ?? {}) as { category_id?: string };
    return <input value={v.category_id ?? ""} onChange={(e) => onChange({ category_id: e.target.value })} placeholder="categoría de intención" className={`${cls} min-w-[12rem]`} />;
  }
  return <input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={cls} />;
}
