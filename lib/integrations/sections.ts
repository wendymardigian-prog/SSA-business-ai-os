/**
 * Las tres secciones de Integraciones y qué puede hacer cada persona en ellas (Equipo y roles, F18).
 * Puro: lo usan la página, el detalle y los tests.
 *
 *   Mis conexiones             todos: conectar las cuentas propias (Google Calendar...).
 *   Canales                    `channels.manage` los toca; `integrations.view`/`manage` los ven.
 *   Integraciones del negocio  `integrations.manage` las toca; `integrations.view` ve su estado.
 *
 * Un Member de sistema no tiene ninguna de las tres claves: ve solo «Mis conexiones».
 */

/** Los proveedores del catálogo que son canales de mensajería (el resto es del negocio). */
export const CHANNEL_PROVIDER_IDS: readonly string[] = ["zernio", "evolution", "resend_inbound"];

export type SectionAccess = "edit" | "view" | null;

export interface IntegrationSections {
  /** Siempre disponible: cada persona conecta lo suyo. */
  mine: true;
  channels: SectionAccess;
  business: SectionAccess;
}

export function integrationSections(can: (key: string) => boolean): IntegrationSections {
  const manage = can("integrations.manage");
  const view = can("integrations.view");
  return {
    mine: true,
    channels: can("channels.manage") ? "edit" : view || manage ? "view" : null,
    business: manage ? "edit" : view ? "view" : null,
  };
}

/** A qué sección del catálogo pertenece un proveedor. */
export function sectionOfProvider(providerId: string): "channels" | "business" {
  return CHANNEL_PROVIDER_IDS.includes(providerId) ? "channels" : "business";
}

/**
 * Si esa persona puede abrir el detalle de ese proveedor, y si lo ve en solo lectura.
 * `null` = no puede (la página la manda al listado).
 */
export function providerAccess(can: (key: string) => boolean, providerId: string): "edit" | "view" | null {
  const sections = integrationSections(can);
  return sections[sectionOfProvider(providerId)];
}

/** Si la persona tiene algo más que «Mis conexiones» para ver en esta pantalla. */
export function hasSharedSections(can: (key: string) => boolean): boolean {
  const s = integrationSections(can);
  return s.channels !== null || s.business !== null;
}
