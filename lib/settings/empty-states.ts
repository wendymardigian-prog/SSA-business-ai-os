/**
 * Las bajadas de cada estado vacío de Configuración (S5), como datos puros.
 * El título es siempre "Todavía no hay nada acá" (components/settings/
 * settings-empty-state.tsx); acá sólo vive el texto que cambia por pestaña,
 * para poder testearlo sin React.
 */
export const SETTINGS_EMPTY_STATES = {
  generalKeywords: "Todavía no hay palabras clave configuradas.",
  team: "Por ahora sos la única persona en el workspace.",
  roles: "Todavía no hay ningún rol para mostrar.",
  customFields:
    "Creá el primer campo con algo que tu negocio necesite saber de cada contacto y el sistema no traiga: el presupuesto que pidió, de dónde vino, qué plan tiene.",
  recursosAdmin: "Guardá un texto o grabá un audio y tu equipo va a poder mandarlo con un clic.",
  recursosMember: "Cuando un Owner o Admin cree el primero, lo vas a poder usar desde la bandeja.",
  integrations: "Ninguna integración está conectada todavía.",
  background: "Cuando el sistema empiece a registrar tareas, las vas a ver acá.",
} as const;
