/**
 * La franja del servicio dentro de una tarea (Servicios A4, F154). PURO: arma lo que se ve con lo que ya se leyó.
 * Sin servicio (o con el módulo apagado), no hay franja.
 */
export interface TaskServiceInput {
  id: string;
  productName: string;
  variantName: string;
  status: string;
  light: string | null;
  phaseName: string | null;
  progressPct: number;
  ownerName: string | null;
}

export interface TaskServiceSummary {
  id: string;
  title: string;
  detail: string;
  light: "green" | "yellow" | "red" | "gray";
}

const STATUS: Record<string, string> = {
  pending_confirmation: "Por confirmar",
  active: "Activo",
  paused: "Pausado",
  completed: "Completado",
  cancelled: "Cancelado",
  renewed: "Renovado",
};

export function taskServiceSummary(s: TaskServiceInput | null): TaskServiceSummary | null {
  if (!s) return null;
  const title = [s.productName, s.variantName].filter(Boolean).join(" › ") || "Servicio";
  const parts = [STATUS[s.status] ?? s.status];
  if (s.phaseName && (s.status === "active" || s.status === "paused")) parts.push(`fase «${s.phaseName}»`);
  parts.push(`${Math.max(0, Math.min(100, Math.round(s.progressPct)))} %`);
  if (s.ownerName) parts.push(`a cargo de ${s.ownerName}`);
  const light = s.light === "green" || s.light === "yellow" || s.light === "red" ? s.light : "gray";
  return { id: s.id, title, detail: parts.join(" · "), light };
}
