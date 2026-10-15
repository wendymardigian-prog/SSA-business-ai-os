"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { SaleModal } from "@/components/sales/sale-modal";
import { Switch } from "@/components/ui/switch";
import { updateCommissionRoles } from "@/lib/actions/commission-rules";
import { payeeLabel, ROLE_NAME_MAX } from "@/lib/commissions/roles";
import { PAYEE_CHOICES, addRole, renameRole, rolesChanged, rolesPayload, roleProblems, setRoleActive } from "@/lib/commissions/rules-ui-roles";
import type { CommissionPayee, CommissionRole } from "@/lib/commissions/types";
import { btnPrimary, btnSecondary, inputClass, inputError } from "./ui";

/**
 * Los roles de comisión (F57): cada uno dice A QUIÉN se le paga. Los cuatro precargados se renombran y se
 * desactivan; los del negocio se crean acá. Un rol no se borra, no cambia de clave ni de «a quién se le paga»: si
 * ya no se usa, se desactiva y sus reglas dejan de generar comisiones (sin perderse).
 */
export function RolesDialog({ roles, ruleCounts, onClose, onSaved }: { roles: CommissionRole[]; ruleCounts: Record<string, number>; onClose: () => void; onSaved?: () => void }) {
  const router = useRouter();
  const uid = useId();
  const [draft, setDraft] = useState<CommissionRole[]>(() => roles.map((r) => ({ ...r })));
  const [newName, setNewName] = useState("");
  const [newPayee, setNewPayee] = useState<CommissionPayee>("sale_vendedor");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const changed = rolesChanged(roles, draft);
  const problems = useMemo(() => roleProblems(roles, draft), [roles, draft]);
  const hasProblem = Object.keys(problems).length > 0;
  const choice = PAYEE_CHOICES.find((c) => c.value === newPayee);

  function addNew() {
    if (!newName.trim()) {
      setError("Poné un nombre para el rol nuevo");
      return;
    }
    setDraft((list) => addRole(list, newName, newPayee, new Date().toISOString()));
    setNewName("");
    setError(null);
  }

  function save() {
    if (pending || !changed || hasProblem) return;
    setError(null);
    start(async () => {
      const result = await updateCommissionRoles(rolesPayload(draft));
      if (!result.ok) return setError(result.error);
      router.refresh();
      onSaved?.();
      onClose();
    });
  }

  return (
    <SaleModal
      title="Roles de comisión"
      label="Roles de comisión"
      onClose={onClose}
      footer={
        <>
          {error && <p role="alert" className="mr-auto min-w-0 flex-1 text-xs text-red-700 dark:text-red-400">{error}</p>}
          <button type="button" onClick={onClose} className={`${btnSecondary} ml-auto`}>Cancelar</button>
          <button type="button" onClick={save} disabled={pending || !changed || hasProblem} className={btnPrimary}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {pending ? "Guardando…" : "Guardar roles"}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Cada rol es una forma de cobrar comisión por una venta. Cuando se cobra un pago, el sistema genera una comisión por cada rol activo que tenga una regla que cumpla.
      </p>

      <ul className="space-y-2" aria-label="Roles">
        {draft.map((role) => {
          const count = ruleCounts[role.key] ?? 0;
          const problem = problems[role.key];
          const nameId = `${uid}-name-${role.key}`;
          const stateId = `${uid}-state-${role.key}`;
          return (
            <li key={role.key} className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1 basis-48">
                  <label htmlFor={nameId} className="sr-only">Nombre del rol {role.name}</label>
                  <input
                    id={nameId}
                    value={role.name}
                    maxLength={ROLE_NAME_MAX + 10}
                    onChange={(e) => setDraft((list) => renameRole(list, role.key, e.target.value))}
                    aria-invalid={problem ? true : undefined}
                    className={`${inputClass} ${problem ? inputError : ""}`}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span id={stateId} className="text-xs text-muted-foreground">{role.active ? "Activo" : "Desactivado"}</span>
                  <Switch checked={role.active} onChange={(value) => setDraft((list) => setRoleActive(list, role.key, value))} label={`Rol ${role.name} activo`} describedBy={stateId} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Se le paga a: <span className="font-medium text-foreground">{payeeLabel(role.payee)}</span>
                {role.system && " · Precargado"} · {count === 0 ? "Sin reglas" : `${count} ${count === 1 ? "regla" : "reglas"}`}
              </p>
              {!role.active && (
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  {count > 0 ? `Mientras esté desactivado, sus ${count} ${count === 1 ? "regla no genera" : "reglas no generan"} comisiones. Se conservan.` : "Mientras esté desactivado no genera comisiones ni aparece en la pantalla de reglas."}
                </p>
              )}
              {problem && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{problem}</p>}
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 rounded-xl border border-dashed border-border p-3">
        <h3 className="text-sm font-semibold">Crear un rol</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor={`${uid}-new-name`} className="block text-xs font-medium">Nombre</label>
            <input
              id={`${uid}-new-name`}
              value={newName}
              maxLength={ROLE_NAME_MAX}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addNew();
                }
              }}
              placeholder="Ej.: Marketing"
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${uid}-new-payee`} className="block text-xs font-medium">A quién se le paga</label>
            <select id={`${uid}-new-payee`} value={newPayee} onChange={(e) => setNewPayee(e.target.value as CommissionPayee)} className={inputClass}>
              {PAYEE_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>
        {choice && <p className="text-[11px] text-muted-foreground">{choice.hint} Después no se puede cambiar.</p>}
        <button type="button" onClick={addNew} className={btnSecondary}>
          <Plus className="h-4 w-4" aria-hidden /> Agregar rol
        </button>
      </div>
    </SaleModal>
  );
}
