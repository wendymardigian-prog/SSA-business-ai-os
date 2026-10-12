/**
 * Topes del módulo (D17). Se ajustan acá, en un solo lugar.
 */
export const FORM_LIMITS = {
  /**
   * Envíos por IP por hora, en total y por formulario. Sin captcha este tope es una defensa
   * importante, pero 5 por hora frenaba a gente legítima: una oficina o un evento comparten el
   * mismo wifi (la misma IP) y la sexta persona quedaba afuera. 30 por formulario y 60 en total
   * dejan pasar a un grupo real y siguen cortando a un bot.
   */
  submitPerIpPerHour: 60,
  submitPerIpPerFormPerHour: 30,
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
