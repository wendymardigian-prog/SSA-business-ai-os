"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { saveAssignmentRule, searchContactsForRules } from "@/lib/actions/assignment-rules";
import { ASSIGNMENT_FIELDS } from "@/lib/assignment/context";
import { priorityCollisions } from "@/lib/assignment/rules";
import { isDestinationValid } from "@/lib/assignment/resolve";
import { ASSIGNMENT_KINDS, KIND_LABELS, MODE_LABELS, type AssignmentKind, type AssignmentMode, type ConditionRule, type Destination } from "@/lib/assignment/types";
import { EMPTY_CONDITION_TREE } from "@/lib/conditions/conditions-schema";
import { ConditionTreeEditor } from "@/components/conditions/condition-tree-editor";
import { ActionError } from "@/components/contacts/ui";
import { cn } from "@/lib/utils";
import { useContactSearchWith } from "@/components/shared/use-contact-search";

export interface RuleCardData {
  id: string;
  kind: AssignmentKind;
  mode: AssignmentMode;
  enabledMemberIds: string[];
  conditionRules: ConditionRule[];
}

export interface MemberOption {
  userId: string;
  label: string;
}

const KIND_HELP: Record<AssignmentKind, string> = {
  setter: "Quien contacta al lead. Se asigna solo si el contacto no tiene setter, salvo una regla con «puede reasignar».",
  vendedor: "Quien cierra la venta. Se asigna solo si el contacto no tiene vendedor, salvo una regla con «puede reasignar».",
  referral: "Quién refirió a este contacto: una persona del equipo o un contacto (por ejemplo, un cliente).",
};

const control = "h-9 rounded-lg border border-border bg-background px-2 text-sm";
const fields = ASSIGNMENT_FIELDS.map((f) => ({ value: f.value, label: f.label, group: f.group, options: f.options }));

/**
 * Reglas de asignación (plano F13): una tarjeta por tipo — Setter, Vendedor,
 * Referido — con su modo: manual, reparto equitativo o por condiciones. Todas
 * arrancan en manual: no asignan nada hasta que alguien las configure.
 * Estructura de `AssignmentRulesModal` de prevxcrm, sin Triage ni "al cambio de estado".
 */
export function AssignmentRulesView({
  cards,
  members,
  contactNames,
}: {
  cards: RuleCardData[];
  members: MemberOption[];
  contactNames: Record<string, string>;
}) {
  return (
    <div className="space-y-5">
      {ASSIGNMENT_KINDS.map((kind) => {
        const card = cards.find((c) => c.kind === kind);
        return card ? <KindCard key={kind} card={card} members={members} contactNames={contactNames} /> : null;
      })}
    </div>
  );
}

function KindCard({ card, members, contactNames }: { card: RuleCardData; members: MemberOption[]; contactNames: Record<string, string> }) {
  const router = useRouter();
  const [mode, setMode] = useState<AssignmentMode>(card.mode);
  const [enabled, setEnabled] = useState<string[]>(card.enabledMemberIds);
  const [rules, setRules] = useState<ConditionRule[]>(card.conditionRules);
  const [names, setNames] = useState(contactNames);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const memberIds = useMemo(() => new Set(members.map((m) => m.userId)), [members]);
  const contactIds = useMemo(() => new Set(Object.keys(names)), [names]);
  const clashes = mode === "condition_based" ? priorityCollisions(rules) : [];
  const modes: AssignmentMode[] = card.kind === "referral" ? ["manual", "condition_based"] : ["manual", "round_robin", "condition_based"];

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      const result = await saveAssignmentRule({ kind: card.kind, mode, enabledMemberIds: enabled, conditionRules: rules });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  function newRule() {
    const next = rules.reduce((max, r) => Math.max(max, r.priority), 0) + 1;
    setRules([
      ...rules,
      {
        id: crypto.randomUUID(),
        name: `Regla ${rules.length + 1}`,
        priority: next,
        conditions: EMPTY_CONDITION_TREE,
        destination: card.kind === "referral" ? { type: "user", user_id: members[0]?.userId ?? "" } : { type: "user", user_id: members[0]?.userId ?? "" },
        can_reassign: false,
        is_active: true,
      },
    ]);
  }

  const patchRule = (id: string, patch: Partial<ConditionRule>) => setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <section aria-labelledby={`kind-${card.kind}`} className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`kind-${card.kind}`} className="text-sm font-semibold">
            {KIND_LABELS[card.kind]}
          </h3>
          <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">{KIND_HELP[card.kind]}</p>
        </div>
        <div role="radiogroup" aria-label={`Modo de ${KIND_LABELS[card.kind]}`} className="inline-flex overflow-hidden rounded-lg border border-border">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              disabled={pending}
              onClick={() => {
                setMode(m);
                setSaved(false);
              }}
              className={cn("px-3 py-1.5 text-xs font-medium", mode === m ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {mode === "manual" && <p className="mt-3 text-xs text-muted-foreground">En modo manual el sistema no asigna nada: lo hace una persona desde la ficha del contacto.</p>}

      {mode === "round_robin" && (
        <fieldset className="mt-3">
          <legend className="text-xs font-medium">Reparto parejo entre estas personas</legend>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {members.map((m) => (
              <label key={m.userId} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={enabled.includes(m.userId)}
                  disabled={pending}
                  onChange={(e) => setEnabled((prev) => (e.target.checked ? [...prev, m.userId] : prev.filter((id) => id !== m.userId)))}
                  className="h-4 w-4 accent-current"
                />
                {m.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {mode === "condition_based" && (
        <div className="mt-3 space-y-3">
          {rules.length === 0 && <p className="text-xs text-muted-foreground">Todavía no hay reglas. Agregá la primera.</p>}
          {[...rules].sort((a, b) => a.priority - b.priority).map((rule) => {
            const invalid = !isDestinationValid(rule.destination, card.kind, { members: memberIds, contacts: contactIds });
            return (
              <div key={rule.id} className={cn("space-y-3 rounded-lg border p-3", invalid ? "border-amber-500/50" : "border-border")}>
                <div className="flex flex-wrap items-center gap-2">
                  <input aria-label="Nombre de la regla" value={rule.name} maxLength={80} disabled={pending} onChange={(e) => patchRule(rule.id, { name: e.target.value })} className={cn(control, "w-full min-w-0 font-medium sm:w-auto sm:flex-1")} />
                  <label className="flex items-center gap-1.5 text-xs">
                    Prioridad
                    <input type="number" min={0} aria-label="Prioridad" value={rule.priority} disabled={pending} onChange={(e) => patchRule(rule.id, { priority: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className={cn(control, "w-20")} />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={rule.is_active} disabled={pending} onChange={(e) => patchRule(rule.id, { is_active: e.target.checked })} className="h-4 w-4 accent-current" />
                    Activa
                  </label>
                  <button type="button" disabled={pending} onClick={() => setRules((prev) => prev.filter((r) => r.id !== rule.id))} aria-label={`Quitar la regla ${rule.name}`} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>

                <ConditionTreeEditor tree={rule.conditions} onChange={(conditions) => patchRule(rule.id, { conditions })} fields={fields} disabled={pending} />

                <div className="space-y-2 border-t border-border pt-3">
                  <DestinationPicker kind={card.kind} destination={rule.destination} members={members} names={names} onNames={(id, name) => setNames((prev) => ({ ...prev, [id]: name }))} disabled={pending} onChange={(destination) => patchRule(rule.id, { destination })} />
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={rule.can_reassign} disabled={pending} onChange={(e) => patchRule(rule.id, { can_reassign: e.target.checked })} className="h-4 w-4 accent-current" />
                    Puede reasignar (pisa a quien ya está; nunca a un contacto asignado a mano)
                  </label>
                  {invalid && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">Destino inválido: la persona ya no está en el workspace, el contacto no existe o falta elegir a alguien. Esta regla se saltea.</p>}
                </div>
              </div>
            );
          })}
          <button type="button" disabled={pending} onClick={newRule} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent">
            <Plus className="h-4 w-4" aria-hidden />
            Agregar regla
          </button>
          {clashes.map((c) => (
            <p key={c} role="alert" className="text-xs text-red-700 dark:text-red-400">
              {c}. Cambiá una de las dos para poder guardar.
            </p>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={pending || clashes.length > 0} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Guardar
        </button>
        {saved && <span className="text-xs text-green-600">Guardado</span>}
      </div>
      {error && (
        <div className="mt-3">
          <ActionError message={error} />
        </div>
      )}
    </section>
  );
}

function DestinationPicker({
  kind,
  destination,
  members,
  names,
  onNames,
  onChange,
  disabled,
}: {
  kind: AssignmentKind;
  destination: Destination;
  members: MemberOption[];
  names: Record<string, string>;
  onNames: (id: string, name: string) => void;
  onChange: (next: Destination) => void;
  disabled?: boolean;
}) {
  const types: Array<{ value: Destination["type"]; label: string }> =
    kind === "referral"
      ? [{ value: "user", label: "Una persona del equipo" }, { value: "contact", label: "Un contacto" }]
      : [{ value: "user", label: "Una persona" }, { value: "round_robin", label: "Reparto entre varias personas" }];
  const search = useContactSearchWith(searchContactsForRules);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">Asignar a</span>
        <select
          aria-label="Tipo de destino"
          value={destination.type}
          disabled={disabled}
          onChange={(e) => {
            const type = e.target.value as Destination["type"];
            if (type === "user") onChange({ type: "user", user_id: members[0]?.userId ?? "" });
            else if (type === "round_robin") onChange({ type: "round_robin", members: [] });
            else onChange({ type: "contact", contact_id: "" });
          }}
          className={control}
        >
          {types.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        {destination.type === "user" && (
          <select aria-label="Persona" value={destination.user_id} disabled={disabled} onChange={(e) => onChange({ type: "user", user_id: e.target.value })} className={control}>
            {!members.some((m) => m.userId === destination.user_id) && <option value={destination.user_id}>{destination.user_id ? "Persona que ya no está" : "Elegí…"}</option>}
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {destination.type === "round_robin" && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {members.map((m) => (
            <label key={m.userId} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={destination.members.includes(m.userId)}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ ...destination, members: e.target.checked ? [...destination.members, m.userId] : destination.members.filter((id) => id !== m.userId) })
                }
                className="h-4 w-4 accent-current"
              />
              {m.label}
            </label>
          ))}
        </div>
      )}

      {destination.type === "contact" && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{destination.contact_id ? `Contacto elegido: ${names[destination.contact_id] ?? "(contacto)"}` : "Buscá al contacto por nombre o email."}</p>
          <input value={search.query} disabled={disabled} onChange={(e) => search.setQuery(e.target.value)} placeholder="Buscar contacto…" aria-label="Buscar contacto" className={cn(control, "w-full sm:max-w-xs")} />
          {search.searching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
          {search.options.length > 0 && (
            <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border sm:max-w-xs">
              {search.options.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onNames(o.id, o.name);
                      onChange({ type: "contact", contact_id: o.id });
                      search.reset();
                    }}
                    className="w-full px-3 py-1.5 text-left text-xs hover:bg-accent"
                  >
                    {o.name}
                    {o.email ? <span className="text-muted-foreground"> · {o.email}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
