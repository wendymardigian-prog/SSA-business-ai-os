/**
 * Los tipos de lo que devuelven las Server Actions de Comisiones. Van acá (y no en el archivo `"use server"`)
 * porque un archivo de acciones solo puede exportar funciones asincrónicas.
 */
import type { ExcludedCode } from "./selection";
import type { RoleIssue } from "./roles";
import type { CommissionPreview } from "./preview";
import type { CommissionFacts, CommissionRole } from "./types";

export type CommissionActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Lo que devuelve `updateCommissionRoles` cuando los roles no son válidos: los motivos, uno por uno. */
export type RolesActionResult = ({ ok: true; roles: CommissionRole[]; changed: boolean }) | { ok: false; error: string; issues?: RoleIssue[] };

export interface PayoutExpense {
  /** El gasto creado. */
  id: string;
  /** La persona a la que se le paga (null en el modo «un solo gasto»). */
  userId: string | null;
  /** Céntimos. */
  amountCents: number;
  count: number;
  commissionIds: string[];
}

export interface PayoutExcluded {
  id: string;
  reason: ExcludedCode | "not_found";
  /** En palabras de una persona. */
  message: string;
}

export interface PayoutResult {
  expenses: PayoutExpense[];
  excluded: PayoutExcluded[];
}

export type PreviewResult = CommissionActionResult<
  CommissionPreview & {
    /** De qué se armó: un cobro que ya pasó, o uno hipotético de una venta. */
    source: "payment" | "hypothetical";
    facts: CommissionFacts;
    /** Cuántas reglas sin guardar se sumaron a las de la base. */
    draftRules: number;
  }
>;

export interface RefundSuggestionRow {
  userId: string;
  userName: string | null;
  /** Las comisiones del cobro original que tiene esta persona. */
  commissions: Array<{ id: string; role: string | null; amountCents: number }>;
  originalCents: number;
  /** Negativa: lo que restaría un ajuste proporcional. 0 = no hay nada que sugerir. */
  suggestedCents: number;
  /** Lo que ya se ajustó por este reembolso (para no cargarlo dos veces). */
  alreadyAdjustedCents: number;
}

export interface RefundSuggestionResult {
  refundPaymentId: string;
  originalPaymentId: string;
  saleId: string;
  /** Lo reembolsado, positivo. */
  refundedCents: number;
  /** Lo cobrado en el pago original. */
  paidCents: number;
  suggestions: RefundSuggestionRow[];
}
