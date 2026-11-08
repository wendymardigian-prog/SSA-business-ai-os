// @plantilla-quitar(servicios)
/**
 * El certificado de un servicio (bloque CE, F66-F69), puro. El certificado es un diseño del Diseñador IA generado
 * desde una plantilla de tipo Certificado, con el servicio como sujeto (`subjectRef`). No hay tabla propia.
 */

/** Es el grupo registrado en el Diseñador: el Diseñador acepta un sujeto solo si su `module` es un grupo registrado. */
export const SERVICE_SUBJECT_MODULE = "service";
export const SERVICE_SUBJECT_TYPE = "service";

/** Las variables que el módulo suma al Diseñador (grupo «Servicio»). */
export const SERVICE_DESIGN_VARS = [
  { key: "service.product", label: "Producto", sample: "Programa de ejemplo" },
  { key: "service.variant", label: "Variante", sample: "Completa" },
  { key: "service.start_on", label: "Fecha de inicio", sample: "1 de octubre de 2026" },
  { key: "service.end_on", label: "Fecha de fin", sample: "31 de diciembre de 2026" },
  { key: "service.completed_on", label: "Fecha en que lo completó", sample: "15 de diciembre de 2026" },
  { key: "service.owner", label: "Responsable", sample: "Nombre del responsable" },
] as const;

export interface ServiceForCertificate {
  id: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  completed_at: string | null;
  /** Lo congela el motor al crear el servicio (`product_name`, `variant_name`, …). */
  product_snapshot: { product_name?: string; variant_name?: string } | null;
}

/** «1 de octubre de 2026», con la fecha civil (sin correr por zona horaria). */
export function longDate(day: string | null): string | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}/.test(day)) return null;
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`);
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

/**
 * Los valores de las variables `service.*` para un servicio. Lo que no se sabe NO se devuelve (el Diseñador decide qué
 * hacer con un dato que falta). `completedOn` es la fecha civil en la zona del negocio en que se completó.
 */
export function serviceDesignValues(s: ServiceForCertificate, extra: { variantName?: string | null; ownerName?: string | null; completedOn?: string | null }): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (k: string, v: string | null | undefined) => {
    if (v && v.trim()) out[k] = v.trim();
  };
  set("service.product", s.product_snapshot?.product_name);
  set("service.variant", extra.variantName ?? s.product_snapshot?.variant_name);
  set("service.start_on", longDate(s.starts_on));
  set("service.end_on", longDate(s.ends_on));
  set("service.completed_on", longDate(extra.completedOn ?? null));
  set("service.owner", extra.ownerName);
  return out;
}

export function serviceSubjectRef(serviceId: string, label: string) {
  return { module: SERVICE_SUBJECT_MODULE, type: SERVICE_SUBJECT_TYPE, id: serviceId, label };
}

export function isServiceSubject(ref: { module?: string; type?: string; id?: string } | null | undefined): ref is { module: string; type: string; id: string } {
  return !!ref && ref.module === SERVICE_SUBJECT_MODULE && ref.type === SERVICE_SUBJECT_TYPE && typeof ref.id === "string";
}

/** Un servicio cancelado o reembolsado no emite certificado (CE001). */
export function canIssueFor(status: string): boolean {
  return !["cancelled", "refunded", "pending_confirmation", "discarded"].includes(status);
}

export interface CertificateDesign {
  id: string;
  code: string;
  status: string;
  created_at: string;
}

const VALID = new Set(["queued", "rendering", "ready"]);

/** El vigente (el más nuevo no anulado ni fallido) y los anteriores. «Uno vigente por servicio» (F67). */
export function certificateState(designs: CertificateDesign[]): { current: CertificateDesign | null; previous: CertificateDesign[] } {
  const sorted = [...designs].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const current = sorted.find((d) => VALID.has(d.status)) ?? null;
  return { current, previous: sorted.filter((d) => d !== current) };
}

export const CERTIFICATE_STATUS_LABEL: Record<string, string> = {
  queued: "Generándose",
  rendering: "Generándose",
  ready: "Válido",
  void: "Anulado",
  failed: "No se pudo generar",
};
