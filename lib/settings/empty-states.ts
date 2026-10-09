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
  // Banca v2 (F5): el titulo propio ("Todavia no hay recursos.") lo pone la
  // pantalla, que ademas ofrece los seis tipos como botones de alta directa.
  recursosAdmin:
    "Guardá los textos, audios, videos, imágenes, archivos y enlaces que más mandás, y tu equipo y el asistente van a poder usarlos con un clic.",
  recursosMember: "Cuando alguien con permiso cargue el primero, lo vas a poder usar desde la bandeja con un clic.",
  contentPillars:
    "Un pilar es un gran tema de tu contenido: educativo, casos de éxito, autoridad. Creá el primero y vas a poder elegirlo al cargar una idea.",
  contentProducts:
    "Un producto es lo que vendés: una mentoría, un servicio, un curso. Cargá el primero con su precio y vas a poder ver qué contenido empuja cada uno.",
  integrations: "Ninguna integración está conectada todavía.",
  background: "Cuando el sistema empiece a registrar tareas, las vas a ver acá.",
} as const;
