/** El titulo sugerido al crear una tarea desde una conversacion (Extra A, F20). PURO. */

import { TASK_LIMITS } from "./types";

export function suggestedTitle(contactName: string | null | undefined): string {
  const name = (contactName ?? "").replace(/\s+/g, " ").trim();
  if (!name || name === "Sin nombre") return "Dar seguimiento al contacto";
  const title = `Dar seguimiento a ${name}`;
  return title.length > TASK_LIMITS.title ? title.slice(0, TASK_LIMITS.title) : title;
}
