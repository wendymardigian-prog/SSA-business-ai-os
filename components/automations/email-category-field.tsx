"use client";

import type { EmailCategory } from "@/lib/email/subscription";
import { EMAIL_CATEGORY_HINTS, EMAIL_CATEGORY_LABELS, isEmailCategory } from "@/lib/email/categories";

/**
 * "Tipo de email" de un paso que manda un email (suscripcion a emails, E2).
 *
 * Sin elegir, vale `fallback`: marketing en las automatizaciones que arma una
 * persona, transaccional en las de agenda, formularios y cobranza (lo mismo que
 * decide el motor con `stepEmailCategory`). Elegir guarda el valor en el paso.
 */
export function EmailCategoryField({
  id,
  value,
  fallback,
  onChange,
  disabled,
  labelClassName = "text-xs text-muted-foreground",
  selectClassName,
}: {
  id: string;
  value: unknown;
  fallback: EmailCategory;
  onChange: (category: EmailCategory) => void;
  disabled?: boolean;
  labelClassName?: string;
  selectClassName?: string;
}) {
  const current: EmailCategory = isEmailCategory(value) ? value : fallback;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={labelClassName}>
        Tipo de email
      </label>
      <select
        id={id}
        value={current}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as EmailCategory)}
        className={selectClassName}
      >
        <option value="marketing">{EMAIL_CATEGORY_LABELS.marketing}</option>
        <option value="transactional">{EMAIL_CATEGORY_LABELS.transactional}</option>
      </select>
      <p className="text-xs text-muted-foreground">{EMAIL_CATEGORY_HINTS[current]}</p>
    </div>
  );
}
