"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { DIM_DELAY_MS, NAV_START_EVENT, SAFETY_TIMEOUT_MS, SHOW_DELAY_MS, trickle } from "@/lib/ui/nav-progress";

/**
 * La barra de carga del panel: una línea fina arriba de todo, del color de la marca, mientras llega la pantalla nueva.
 * Arranca con el aviso de `instrumentation-client.ts` (cualquier `<Link>` o `router.push`/`replace`) y termina cuando
 * cambia la URL. Las reglas (cuándo arranca, cuánto espera, cómo avanza) viven en `lib/ui/nav-progress.ts`.
 *
 * - No se ve en lo instantáneo: aparece recién a los `SHOW_DELAY_MS`.
 * - Pasados `DIM_DELAY_MS`, marca `<main data-nav-pending>` y `app/globals.css` aclara el contenido viejo (la barra
 *   de la pantalla, `header[data-topbar]`, queda igual).
 * - Si la navegación nunca termina (falló o se canceló), se va sola a los `SAFETY_TIMEOUT_MS`.
 *
 * Solo la línea, sin ícono (white label: nada que sea de una marca). Es decorativa (`aria-hidden`): la pantalla que
 * carga ya avisa con su esqueleto. Traída de RER-BAIOS (#149, #150 y #151).
 */
export function NavProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlKey = `${pathname}?${searchParams?.toString() ?? ""}`;

  // El avance se pinta directo en el DOM, sin estado de React: el aviso de Next llega DENTRO de la transición de la
  // navegación, y un `setState` ahí recién se veía cuando llegaba la pantalla (la barra quedaba en 0 % hasta el final).
  const barRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const running = useRef(false);
  const timers = useRef<number[]>([]);
  const trickleTimer = useRef<number | null>(null);

  const paint = useCallback((value: number, visible?: boolean) => {
    progress.current = value;
    if (fillRef.current) fillRef.current.style.width = `${Math.round(value * 1000) / 10}%`;
    if (visible !== undefined && barRef.current) barRef.current.style.opacity = visible ? "1" : "0";
  }, []);

  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
    if (trickleTimer.current !== null) window.clearInterval(trickleTimer.current);
    trickleTimer.current = null;
  }, []);

  const setDim = useCallback((on: boolean) => {
    const main = document.querySelector("main");
    if (!main) return;
    if (on) main.setAttribute("data-nav-pending", "");
    else main.removeAttribute("data-nav-pending");
  }, []);

  const finish = useCallback(() => {
    if (!running.current) return;
    running.current = false;
    clearTimers();
    setDim(false);
    paint(1);
    // Que se vea llegar al final y después se apague.
    timers.current.push(
      window.setTimeout(() => {
        paint(1, false);
        timers.current.push(window.setTimeout(() => paint(0), 200));
      }, 220),
    );
  }, [clearTimers, paint, setDim]);

  const start = useCallback(() => {
    clearTimers();
    running.current = true;
    paint(0.08, false);
    timers.current.push(
      window.setTimeout(() => {
        if (!running.current) return;
        paint(progress.current, true);
        trickleTimer.current = window.setInterval(() => paint(trickle(progress.current)), 200);
      }, SHOW_DELAY_MS),
      window.setTimeout(() => running.current && setDim(true), DIM_DELAY_MS),
      window.setTimeout(() => finish(), SAFETY_TIMEOUT_MS),
    );
  }, [clearTimers, finish, paint, setDim]);

  useEffect(() => {
    const onStart = () => start();
    window.addEventListener(NAV_START_EVENT, onStart);
    return () => window.removeEventListener(NAV_START_EVENT, onStart);
  }, [start]);

  // La pantalla nueva llegó (cambió la URL): se completa.
  // Con un temporizador y no `requestAnimationFrame`: en una pestaña oculta el navegador no pinta cuadros y la barra
  // quedaba al 90 % con el contenido atenuado hasta volver a la pestaña.
  useEffect(() => {
    const id = window.setTimeout(finish, 0);
    return () => window.clearTimeout(id);
  }, [urlKey, finish]);

  // Al desmontar, no dejar el contenido atenuado ni timers vivos.
  useEffect(
    () => () => {
      clearTimers();
      setDim(false);
    },
    [clearTimers, setDim],
  );

  return (
    <div
      ref={barRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-[3px] transition-opacity duration-200"
      style={{ opacity: 0 }}
    >
      <div ref={fillRef} className="h-full bg-primary transition-[width] duration-200 ease-out" style={{ width: "0%" }} />
    </div>
  );
}
