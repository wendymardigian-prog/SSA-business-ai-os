"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Archive, Loader2, Pencil, Plus } from "lucide-react";
import {
  archiveConversationRule,
  createConversationRule,
  reorderConversationRules,
  updateConversationRule,
} from "@/lib/actions/conversation-assignment-rules";
import {
  RULE_MODES,
  RULE_MODE_LABELS,
  SETTER_MODES,
  SETTER_MODE_LABELS,
  simulateAssignment,
  type ConversationRule,
  type RuleMode,
  type SetterMode,
} from "@/lib/inbox/assignment-rules";
import { ActionError } from "@/components/contacts/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { cn } from "@/lib/utils";

export interface RuleAccount {
  id: string;
  platform: string;
  label: string;
}

export interface RuleMember {
  userId: string;
  label: string;
}

const control = "h-9 rounded-lg border border-border bg-background px-2 text-sm";

/**
 * Ajustes > Asignación > Conversaciones (00255): "lo que entra por esta cuenta
 * va a esta persona". Gana la primera regla activa que coincide, en el orden
 * de la lista; las flechas lo cambian. Las reglas se archivan, no se borran.
 * El probador usa `simulateAssignment`, la misma regla que la base.
 */
export function ConversationRulesView({ rules, accounts, members }: { rules: ConversationRule[]; accounts: RuleAccount[]; members: RuleMember[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function move(index: number, delta: -1 | 1) {
    const ids = rules.map((r) => r.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setError(null);
    start(async () => {
      const result = await reorderConversationRules(ids);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function archive(id: string) {
    setError(null);
    start(async () => {
      const result = await archiveConversationRule(id);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.label ?? "Una cuenta desconectada";
  const memberName = (id: string) => members.find((m) => m.userId === id)?.label ?? "Alguien que ya no está";

  return (
    <div className="space-y-3">
      {rules.length === 0 && editing !== "new" && (
        <div className="rounded-xl border border-dashed border-border p-5 text-center">
          <p className="text-sm font-medium">Todavía no hay reglas</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Sin reglas, las conversaciones nuevas entran sin responsable. Creá una para que lo de cada cuenta vaya directo a quien lo atiende.
          </p>
        </div>
      )}

      <ol className="space-y-2">
        {rules.map((rule, index) =>
          editing === rule.id ? (
            <li key={rule.id}>
              <RuleForm
                initial={rule}
                accounts={accounts}
                members={members}
                onCancel={() => setEditing(null)}
                onSaved={() => {
                  setEditing(null);
                  router.refresh();
                }}
              />
            </li>
          ) : (
            <li key={rule.id} className={cn("rounded-xl border border-border p-3", !rule.enabled && "opacity-60")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold">
                    <span className="mr-1.5 text-xs font-normal tabular-nums text-muted-foreground">{index + 1}.</span>
                    {rule.name || "Regla sin nombre"}
                    {!rule.enabled && <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">Pausada</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Cuentas: </span>
                    {rule.channelIds.length === 0 ? "todas" : rule.channelIds.map(accountName).join(", ")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{RULE_MODE_LABELS[rule.mode]}: </span>
                    {rule.memberIds.map(memberName).join(", ")}
                  </p>
                  <p className="text-xs text-muted-foreground">{SETTER_MODE_LABELS[rule.setterMode]}</p>
                </div>
                <div className="flex items-center gap-1">
                  <IconButton label="Subir" disabled={pending || index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </IconButton>
                  <IconButton label="Bajar" disabled={pending || index === rules.length - 1} onClick={() => move(index, 1)}>
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </IconButton>
                  <IconButton label="Editar" disabled={pending} onClick={() => setEditing(rule.id)}>
                    <Pencil className="h-4 w-4" aria-hidden />
                  </IconButton>
                  <IconButton label="Archivar" disabled={pending} onClick={() => archive(rule.id)}>
                    <Archive className="h-4 w-4" aria-hidden />
                  </IconButton>
                </div>
              </div>
            </li>
          ),
        )}
      </ol>

      {editing === "new" ? (
        <RuleForm
          initial={null}
          accounts={accounts}
          members={members}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing("new")}
          disabled={members.length === 0}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Nueva regla
        </button>
      )}
      {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Guardando" />}
      <ActionError message={error} />

      {rules.length > 0 && accounts.length > 0 && <RuleTester rules={rules} accounts={accounts} members={members} />}
    </div>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function RuleForm({
  initial,
  accounts,
  members,
  onCancel,
  onSaved,
}: {
  initial: ConversationRule | null;
  accounts: RuleAccount[];
  members: RuleMember[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [allAccounts, setAllAccounts] = useState((initial?.channelIds.length ?? 0) === 0);
  const [channelIds, setChannelIds] = useState<string[]>(initial?.channelIds ?? []);
  const [mode, setMode] = useState<RuleMode>(initial?.mode ?? "fixed");
  const [memberIds, setMemberIds] = useState<string[]>(initial?.memberIds ?? (members[0] ? [members[0].userId] : []));
  const [setterMode, setSetterMode] = useState<SetterMode>(initial?.setterMode ?? "none");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  function save() {
    setError(null);
    const payload = { name, enabled, channelIds: allAccounts ? [] : channelIds, mode, memberIds: mode === "fixed" ? memberIds.slice(0, 1) : memberIds, setterMode };
    start(async () => {
      const result = initial ? await updateConversationRule(initial.id, payload) : await createConversationRule(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-primary/40 bg-primary/5 p-4">
      <label className="block space-y-1">
        <span className="text-xs font-medium">Nombre (opcional)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ej: Instagram principal" className={cn(control, "w-full")} />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Cuentas</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allAccounts} onChange={(e) => setAllAccounts(e.target.checked)} />
          Todas las cuentas (también las que se conecten después)
        </label>
        {!allAccounts && (
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <label key={a.id} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-xs", channelIds.includes(a.id) ? "border-primary bg-primary/10" : "border-border")}>
                <input type="checkbox" className="sr-only" checked={channelIds.includes(a.id)} onChange={() => setChannelIds((prev) => toggle(prev, a.id))} />
                <PlatformIcon platform={a.platform} className="h-3.5 w-3.5" size={14} />
                {a.label}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">A quién</legend>
        <div role="radiogroup" aria-label="Cómo se reparte" className="inline-flex overflow-hidden rounded-lg border border-border">
          {RULE_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn("px-3 py-1.5 text-xs font-medium", mode === m ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
            >
              {RULE_MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {mode === "fixed" ? (
          <select value={memberIds[0] ?? ""} onChange={(e) => setMemberIds([e.target.value])} aria-label="Persona" className={cn(control, "block w-full max-w-xs")}>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex flex-wrap gap-2">
            {members.map((m) => (
              <label key={m.userId} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-xs", memberIds.includes(m.userId) ? "border-primary bg-primary/10" : "border-border")}>
                <input type="checkbox" className="sr-only" checked={memberIds.includes(m.userId)} onChange={() => setMemberIds((prev) => toggle(prev, m.userId))} />
                {m.label}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <label className="block space-y-1">
        <span className="text-xs font-medium">El setter del contacto</span>
        <select value={setterMode} onChange={(e) => setSetterMode(e.target.value as SetterMode)} className={cn(control, "block w-full max-w-md")}>
          {SETTER_MODES.map((m) => (
            <option key={m} value={m}>
              {SETTER_MODE_LABELS[m]}
            </option>
          ))}
        </select>
        {setterMode === "overwrite" && (
          <span className="block text-xs text-amber-700 dark:text-amber-300">Reemplaza al setter aunque lo haya puesto una persona a mano.</span>
        )}
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Activa
      </label>

      <ActionError message={error} />
      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={pending} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Guardar
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className="h-9 rounded-lg px-3 text-sm hover:bg-accent">
          Cancelar
        </button>
      </div>
    </div>
  );
}

function RuleTester({ rules, accounts, members }: { rules: ConversationRule[]; accounts: RuleAccount[]; members: RuleMember[] }) {
  const [channelId, setChannelId] = useState(accounts[0]?.id ?? "");
  const result = useMemo(() => simulateAssignment(rules, channelId, members.map((m) => m.userId)), [rules, channelId, members]);
  const who = result ? members.find((m) => m.userId === result.userId)?.label ?? "alguien" : null;

  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-xs font-medium">Probar</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Si entra una conversación nueva por</span>
        <select value={channelId} onChange={(e) => setChannelId(e.target.value)} aria-label="Cuenta para probar" className={control}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <span>
          {result ? (
            <>
              → va a <strong>{who}</strong> <span className="text-muted-foreground">(regla «{result.rule.name || "sin nombre"}»)</span>
            </>
          ) : (
            <span className="text-muted-foreground">→ queda sin responsable</span>
          )}
        </span>
      </div>
    </div>
  );
}
