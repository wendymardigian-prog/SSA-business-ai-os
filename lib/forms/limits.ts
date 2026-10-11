/**
 * Topes del módulo (D17). Se ajustan acá, en un solo lugar.
 */
export const FORM_LIMITS = {
  /** Envíos por IP por hora, en total y por formulario. */
  submitPerIpPerHour: 20,
  submitPerIpPerFormPerHour: 5,
  /** Beacons (vistas e inicios) por IP por hora. */
  beaconPerIpPerHour: 60,
  /** Ventana para contar una vista o un inicio por sesión del navegador y formulario. */
  beaconSessionWindowHours: 24,
  /** Filas máximas de una exportación a CSV. */
  exportMaxRows: 10_000,
  /** Respuestas por página en la tabla. */
  pageSize: 50,
  /** Firma del contrato (PNG en base64). */
  signatureMaxBytes: 200 * 1024,
  /** Días de vigencia de un link firmado por contacto. */
  signedLinkDays: 60,
  /** Tamaño máximo del cuerpo de un envío (3 archivos de 10 MB por campo, con margen). */
  maxBodyMb: 35,
} as const;

export const HOUR_MS = 60 * 60 * 1000;
