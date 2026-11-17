// @plantilla-quitar(proyectos)
/** Montos de la extensión de proyectos: se guardan en centavos y se muestran sin decimales si son redondos. */
export function formatCents(cents: number, currency = "USD"): string {
  const v = cents / 100;
  const whole = Number.isInteger(v);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(v);
}

/** «1.250,50» o «1250.5» → centavos. NaN si no es un monto. */
export function parseAmountToCents(text: string): number {
  const t = text.trim().replace(/\s/g, "").replace(/^\$/, "");
  if (!t) return NaN;
  const normalized = /,\d{1,2}$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return NaN;
  return Math.round(Number(normalized) * 100);
}
