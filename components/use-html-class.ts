"use client";

import { useSyncExternalStore } from "react";

/**
 * Las preferencias que viven como clase en el <html>: `dark` (el tema) y
 * `sidebar-collapsed` (el menu lateral angosto).
 *
 * Se leen de ahi y no de un estado propio de React porque el script del <head>
 * (app/layout.tsx) ya las aplico antes del primer pintado, leyendo
 * localStorage. Si el estado viviera en React, al cargar la pagina se veria un
 * parpadeo: claro que se pone oscuro, menu ancho que se achica.
 *
 * Hay varios componentes montados a la vez que miran lo mismo (el menu lateral
 * y el panel del telefono), asi que todos observan la misma clase en vez de
 * pasarse el estado por props.
 */
function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
}

export function useHtmlClass(name: string) {
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains(name),
    // En el servidor no hay <html> que mirar. Devolver false es lo correcto:
    // el HTML del servidor se arma sin la clase, y el script del <head> la
    // aplica en el navegador antes de que se pinte nada.
    () => false,
  );
}

/**
 * Las clases del <html> que empiezan con `prefix`, ordenadas y unidas por espacio (un string: asi el
 * resultado es estable y `useSyncExternalStore` no re-renderiza de mas). Lo usa el menu para saber que
 * secciones estan abiertas (`nav-open-<grupo>`) sin un hook por seccion.
 */
export function useHtmlClassesWithPrefix(prefix: string) {
  return useSyncExternalStore(
    subscribe,
    () =>
      Array.from(document.documentElement.classList)
        .filter((c) => c.startsWith(prefix))
        .sort()
        .join(" "),
    () => "",
  );
}
