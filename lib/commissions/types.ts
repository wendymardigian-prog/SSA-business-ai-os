/**
 * Tipos del motor de comisiones (Extra I, F50 a F52). Puros: no importan nada de la app.
 *
 *   - `CommissionFacts` es la forma EXACTA que devuelve `public.commission_facts(payment_id)` (F51).
 *   - `CommissionRole` es un rol de `workspaces.commission_settings.roles` (F50).
 *   - `CommissionRule` es una fila de `commission_rules` (§8.2), con las condiciones tipadas.
 *
 * La plata de los hechos viene en DÓLARES (numeric de la base); toda decisión de monto se toma en
 * céntimos (`lib/shared/money.ts`). Las fechas son civiles `AAAA-MM-DD`.
 */

/** A quién se le paga un rol (F50). */
export const COMMISSION_PAYEES = ["sale_vendedor", "sale_setter", "content_assignee", "fixed"] as const;
export type CommissionPayee = (typeof COMMISSION_PAYEES)[number];

export interface CommissionRole {
  /** `^[a-z0-9_]{2,40}$`, única y NO cambia nunca (las reglas y las comisiones la guardan). */
  key: string;
  name: string;
  payee: CommissionPayee;
  active: boolean;
  /** Precargado: se renombra y se desactiva, no cambia de `payee`. */
  system: boolean;
  created_at: string;
}

/** `payments.type` (más `refund`, que nunca genera comisión). */
export type CommissionPaymentType = "full" | "reservation" | "installment" | "refund";

/** Canal de un toque (`contact_touches.channel`); sin toque, `direct`. */
export const TOUCH_CHANNELS = ["organic", "paid", "referral", "direct"] as const;
export type TouchChannel = (typeof TOUCH_CHANNELS)[number];

/** Los hechos de un pago (F51). */
export interface CommissionFacts {
  payment: {
    id: string;
    type: CommissionPaymentType | string;
    /** Dólares. */
    amount: number;
    paid_on: string;
    method: string | null;
    /** Dólares; null = el método no tenía fee. */
    fee_amount: number | null;
    /** Posición entre los pagos de la venta (empieza en 1). */
    number: number;
  };
  sale: {
    id: string;
    status: string;
    financing_type: string;
    /** Dólares. */
    final_amount: number;
    product_id: string | null;
    variant_id: string | null;
    setter_id: string | null;
    vendedor_id: string | null;
    contact_id: string | null;
  };
  touch: {
    id: string;
    channel: TouchChannel | string | null;
    source: string | null;
    medium: string | null;
    campaign: string | null;
    content: string | null;
    term: string | null;
    content_post_id: string | null;
    social_post_id: string | null;
    meta_ad_id: string | null;
    meta_adset_id: string | null;
    meta_campaign_id: string | null;
  } | null;
  content_assignee_id: string | null;
}

export const UTM_DIMENSIONS = ["source", "medium", "campaign", "content", "term"] as const;
export type UtmDimension = (typeof UTM_DIMENSIONS)[number];
export type UtmOp = "equals" | "contains";

export interface UtmCondition {
  op: UtmOp;
  values: string[];
}

/**
 * Las condiciones de una regla (§8.2). Cada dimensión vacía o ausente = «cualquiera». Y entre dimensiones,
 * O dentro de cada lista.
 */
export interface RuleConditions {
  /** La persona de la venta según el `payee` del rol (con `fixed` se ignora). */
  user_ids?: string[];
  /** El vendedor de la venta, para cualquier rol. */
  vendedor_ids?: string[];
  /** El setter de la venta, para cualquier rol. */
  setter_ids?: string[];
  product_ids?: string[];
  variant_ids?: string[];
  financing_types?: string[];
  payment_methods?: string[];
  payment_types?: Array<"full" | "reservation" | "installment">;
  channels?: TouchChannel[];
  platforms?: string[];
  content_post_ids?: string[];
  meta_campaign_ids?: string[];
  meta_ad_ids?: string[];
  utm?: Partial<Record<UtmDimension, UtmCondition>>;
  /** Inclusivo. */
  payment_number?: { from?: number | null; to?: number | null };
  /** Inclusivo, en dólares, sobre `sale.final_amount`. */
  sale_amount?: { min?: number | null; max?: number | null };
}

export type CommissionCalcType = "percent" | "fixed";
export type CommissionBase = "gross" | "net_of_fees";

/** Una fila de `commission_rules`. */
export interface CommissionRule {
  id: string;
  name: string;
  /** Clave de un rol de `commission_settings.roles`. */
  role: string;
  position: number;
  conditions: RuleConditions;
  calc_type: CommissionCalcType;
  /** Porcentaje con hasta 3 decimales (`2.125`). */
  rate: number | null;
  /** Dólares. */
  fixed_amount: number | null;
  base: CommissionBase;
  beneficiary_user_id: string | null;
  hold_days: number;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  archived_at: string | null;
}
