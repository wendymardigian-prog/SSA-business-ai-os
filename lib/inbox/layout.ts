/**
 * Cómo se acomodan las columnas de la bandeja (lista, hilo y «Datos del
 * contacto») según el ancho que tiene la bandeja, no la pantalla: con el menú
 * lateral abierto o el asistente al costado, la misma pantalla deja menos lugar.
 *
 * La raíz de la bandeja es el contenedor `@container/inbox`; las clases de acá
 * preguntan por su ancho. Tres columnas recién desde 64rem (1024 px): lista
 * 320 + hilo ≥ 384 + panel 320. Por debajo, el panel arranca cerrado y, si
 * alguien lo abre, la lista se esconde para que el hilo se siga leyendo; con
 * menos de 44rem (704 px) el panel va encima del hilo.
 *
 * Puro: lo usa `inbox-view.tsx` y lo prueba `layout.test.ts`.
 */

/**
 * `auto`: lo decide el ancho (abierto solo si entran las tres columnas).
 * `open` / `closed`: lo eligió la persona con el botón o la X.
 */
export type ContactPanelPref = "auto" | "open" | "closed";

export type InboxLayoutClasses = {
  /** La columna de la lista de chats (además de la regla del teléfono). */
  list: string;
  /** El envoltorio del panel en la computadora (sin la hoja del teléfono). */
  panel: string;
  /** El botón «Datos del contacto» del encabezado del hilo. */
  contactButton: string;
};

/**
 * @param pref lo que eligió la persona (o `auto`).
 * @param hasPanel si la conversación abierta tiene panel (contacto y sin aviso de conocido).
 */
export function inboxLayoutClasses(pref: ContactPanelPref, hasPanel: boolean): InboxLayoutClasses {
  if (!hasPanel) {
    return { list: "", panel: "md:hidden", contactButton: "hidden" };
  }
  if (pref === "open") {
    return {
      // Abierto a pedido sin lugar para tres columnas: se va la lista, no el hilo.
      list: "@max-[64rem]/inbox:hidden",
      panel:
        "md:static md:z-auto md:flex @max-[44rem]/inbox:absolute @max-[44rem]/inbox:inset-y-0 @max-[44rem]/inbox:right-0 @max-[44rem]/inbox:z-30 @max-[44rem]/inbox:shadow-xl",
      // En el teléfono el botón abre la hoja; en la computadora el panel ya se ve.
      contactButton: "flex md:hidden",
    };
  }
  if (pref === "closed") {
    return { list: "", panel: "md:hidden", contactButton: "flex" };
  }
  return {
    list: "",
    panel: "md:hidden @min-[64rem]/inbox:flex",
    contactButton: "flex @min-[64rem]/inbox:hidden",
  };
}
