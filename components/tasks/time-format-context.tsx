"use client";

import { createContext, useContext } from "react";
import type { TimeFormat } from "@/lib/calendar/time";

/**
 * El formato de hora (12 h / 24 h) de quien mira, para mostrar la hora de las tareas (R6). Sale del perfil de agenda de la
 * persona (`scheduling_profiles.time_format`); sin perfil, 24 h. Un contexto y no una prop para no pasarlo por cada
 * componente de la tabla, el tablero, el drawer y las listas.
 */
const TimeFormatContext = createContext<TimeFormat>("24h");

export const TimeFormatProvider = TimeFormatContext.Provider;

export function useTimeFormat(): TimeFormat {
  return useContext(TimeFormatContext);
}
