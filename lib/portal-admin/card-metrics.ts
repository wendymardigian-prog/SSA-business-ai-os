// @plantilla-quitar(servicios)
/**
 * Los 8 números de cada card de Portal › Programas (F108), puro: qué dice cada uno, si se resalta y a dónde lleva. Los
 * números salen de `app_servicio.program_card_metrics` (una consulta para todas las cards). Una sección apagada llega
 * como null y se ve «—».
 */
export interface CardMetrics {
  new_students: number | null;
  lessons_completed: number | null;
  to_review: number | null;
  to_grade: number | null;
  certificates: number | null;
  community_posts: number | null;
  attendance_pct: number | null;
  inactive_14d: number | null;
  days?: number;
}

export interface MetricView {
  key: keyof Omit<CardMetrics, "days">;
  label: string;
  value: string;
  highlight: boolean;
  href: string | null;
}

export const METRIC_DAYS = [7, 30] as const;

export function parseMetricDays(raw: string | undefined): 7 | 30 {
  return raw === "7" ? 7 : 30;
}

export function cardMetricViews(productId: string, m: Partial<CardMetrics> | null | undefined, opts: { certificatesAvailable?: boolean } = {}): MetricView[] {
  const num = (v: number | null | undefined) => (typeof v === "number" ? v.toLocaleString("es") : "—");
  const review = `/dashboard/portal?tab=revisar&programa=${productId}`;
  return [
    { key: "new_students", label: "Estudiantes nuevos", value: num(m?.new_students), highlight: false, href: null },
    { key: "lessons_completed", label: "Clases completadas", value: num(m?.lessons_completed), highlight: false, href: null },
    { key: "to_review", label: "Actividades por revisar", value: num(m?.to_review), highlight: (m?.to_review ?? 0) > 0, href: review },
    { key: "to_grade", label: "Evaluaciones por corregir", value: num(m?.to_grade), highlight: (m?.to_grade ?? 0) > 0, href: review },
    { key: "certificates", label: "Certificados emitidos", value: opts.certificatesAvailable === false ? "—" : num(m?.certificates), highlight: false, href: null },
    { key: "community_posts", label: "Posts en la comunidad", value: num(m?.community_posts), highlight: false, href: null },
    { key: "attendance_pct", label: "Asistencia en vivo", value: typeof m?.attendance_pct === "number" ? `${m.attendance_pct} %` : "—", highlight: false, href: null },
    { key: "inactive_14d", label: "Sin entrar hace +14 días", value: num(m?.inactive_14d), highlight: (m?.inactive_14d ?? 0) > 0, href: null },
  ];
}
