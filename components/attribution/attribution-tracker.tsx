"use client";

import { useEffect } from "react";
import { cookieEnv, trackVisit } from "@/lib/attribution/browser";

/**
 * El seguimiento de la atribución en las páginas del propio proyecto (F29): el sitio
 * y `/f/[slug]` cuando NO está embebido. Al cargar, anota la visita en la cookie
 * `ssa_attr` si trae UTM, id de clic o de anuncio, para que el formulario que se
 * llene en OTRA página (o en otra visita) conserve de dónde vino la persona.
 *
 * No muestra nada, no hace pedidos a la red y no carga scripts de terceros. Si el
 * navegador bloquea las cookies, no pasa nada: el formulario usa la URL actual.
 */
export function AttributionTracker() {
  useEffect(() => {
    try {
      trackVisit(cookieEnv(document, window.location));
    } catch {
      // Cookies bloqueadas: se sigue sin guardar.
    }
  }, []);
  return null;
}
