// @plantilla-quitar(servicios)
/**
 * Lo puro de las acciones de Servicios en Automatizaciones: los tipos, las etiquetas y lo que dice el paso. Lo usan el
 * lienzo y el simulador (que corren en el navegador); la ejecución vive en `service-actions.ts` (solo servidor).
 */
export const SERVICE_ACTION_TYPES = ["svc_complete_step", "svc_change_phase", "svc_start_challenge", "svc_extend_service", "svc_pause_service", "svc_issue_certificate"] as const;
export type ServiceActionType = (typeof SERVICE_ACTION_TYPES)[number];

export interface ServiceActionData {
  productId?: string | null;
  itemKey?: string | null;
  phaseKey?: string | null;
  reason?: string | null;
  n?: number | null;
  unit?: "days" | "months" | null;
  from?: "current_end" | "today" | null;
  cutAccess?: boolean | null;
  resumeOn?: string | null;
  label?: string;
}

/** Lo que dice el paso del lienzo y la simulacion. */
export function serviceActionDetail(type: ServiceActionType, data: ServiceActionData): string {
  switch (type) {
    case "svc_complete_step":
      return data.itemKey ? `completaría el paso ${data.itemKey}` : "(sin paso elegido)";
    case "svc_change_phase":
      return data.phaseKey ? `pasaría a la fase ${data.phaseKey}` : "(sin fase elegida)";
    case "svc_start_challenge":
      return "empezaría la fase Reto";
    case "svc_extend_service":
      return data.n ? `extendería ${data.n} ${data.unit === "months" ? "meses" : "días"}` : "(sin cuánto)";
    case "svc_pause_service":
      return "pausaría el servicio";
    case "svc_issue_certificate":
      return "emitiría el certificado del servicio";
  }
}

export const SERVICE_ACTION_LABELS: Record<ServiceActionType, string> = {
  svc_complete_step: "Completar un paso del servicio",
  svc_change_phase: "Cambiar de fase",
  svc_start_challenge: "Empezar la fase Reto",
  svc_extend_service: "Extender servicio",
  svc_pause_service: "Pausar servicio",
  svc_issue_certificate: "Emitir certificado",
};
