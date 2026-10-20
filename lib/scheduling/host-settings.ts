/**
 * Qué parte de la configuración de un evento vale para un anfitrión.
 *
 * El horario, el calendario destino y la lista propia de calendarios de
 * conflicto que se eligen en un evento son de su DUEÑO (`owner_user_id`):
 * apuntan a filas de esa persona. Cuando una reunión se reasignó a otro
 * anfitrión (Agenda v2), al reagendarla hay que mirar la agenda del anfitrión
 * de hoy con SUS valores por defecto (su horario por defecto, los calendarios
 * de su perfil); con los del dueño se ofrecían horarios en los que el
 * anfitrión nuevo estaba ocupado.
 */
export interface EventCalendarSettings {
  schedule_id: string | null;
  destination_calendar_id: string | null;
  conflict_calendar_ids: string[] | null;
}

export function settingsForHost<T extends EventCalendarSettings & { owner_user_id: string }>(
  event: T,
  hostUserId: string,
): EventCalendarSettings {
  if (hostUserId === event.owner_user_id) {
    return {
      schedule_id: event.schedule_id,
      destination_calendar_id: event.destination_calendar_id,
      conflict_calendar_ids: event.conflict_calendar_ids,
    };
  }
  return { schedule_id: null, destination_calendar_id: null, conflict_calendar_ids: [] };
}
