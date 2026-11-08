// @plantilla-quitar(comisiones)
/**
 * Editar una comisión a mano (F107). Puro: valida lo que escribió la persona antes de llamar a `commission_edit`
 * (00343), que vuelve a validar y deja la nueva con `edited_manually` (la generación y la reversión no la pisan).
 *
 * Solo se edita una comisión pendiente y sin gasto. Se cambia el monto, la persona (del equipo o un contacto) o el
 * rol, o se anula; siempre con motivo.
 */

export interface CommissionEditForm {
  void: boolean;
  /** El monto en dólares, como lo escribió la persona ("150", "150,50", "150.5"). */
  amount: string;
  role: string;
  person: { type: "user" | "contact"; id: string } | null;
  reason: string;
}

export interface EditableCommission {
  expenseId: string | null;
  voidedAt: string | null;
  amount: number;
  role: string | null;
  userId: string | null;
  contactId: string | null;
}

export type CommissionEditPatch = { void: true } | { void: false; amount: number; role?: string; user_id?: string | null; contact_id?: string | null };

export function canEditCommission(c: Pick<EditableCommission, "expenseId" | "voidedAt">): boolean {
  return c.expenseId === null && c.voidedAt === null;
}

/** "150,50" o "150.50" → 150.5. null si no es un monto válido (mayor a cero, hasta 2 decimales). */
export function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "");
  if (!/^\d{1,9}([.,]\d{1,2})?$/.test(s)) return null;
  const n = Number(s.replace(",", "."));
  return n > 0 ? n : null;
}

export function buildCommissionEdit(current: EditableCommission, form: CommissionEditForm): { ok: true; patch: CommissionEditPatch; reason: string } | { ok: false; error: string } {
  if (!canEditCommission(current)) return { ok: false, error: "Una comisión que ya está en un gasto (o anulada) no se edita: se corrige con un ajuste." };
  const reason = form.reason.trim();
  if (!reason) return { ok: false, error: "Escribí el motivo" };
  if (form.void) return { ok: true, patch: { void: true }, reason };
  const amount = parseAmount(form.amount);
  if (amount === null) return { ok: false, error: "El monto tiene que ser mayor a cero" };
  const patch: CommissionEditPatch = { void: false, amount };
  if (form.role && form.role !== (current.role ?? "")) patch.role = form.role;
  const personChanged =
    (form.person?.type === "user" ? form.person.id : null) !== current.userId || (form.person?.type === "contact" ? form.person.id : null) !== current.contactId;
  if (personChanged) {
    patch.user_id = form.person?.type === "user" ? form.person.id : null;
    patch.contact_id = form.person?.type === "contact" ? form.person.id : null;
  }
  const nothing = amount === Number(current.amount) && patch.role === undefined && !personChanged;
  if (nothing) return { ok: false, error: "No cambiaste nada" };
  return { ok: true, patch, reason };
}
