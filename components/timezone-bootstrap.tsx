"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { saveDetectedTimezone } from "@/lib/actions/user-preferences";

/** Cuanto espera antes de cada reintento. Sin guardar, la persona veria todo en la zona del negocio. */
const RETRY_MS = [5_000, 30_000] as const;

/**
 * Detecta la zona horaria del navegador y la guarda, UNA sola vez, la
 * primera vez que alguien entra sin ninguna preferencia guardada todavia.
 *
 * Sin render propio: vive montado en el layout del dashboard. `hasSaved` lo
 * calcula el servidor (`getSavedViewerTimezone`), asi que esto no hace nada
 * en absoluto para quien ya tiene una zona guardada, sea detectada antes o
 * puesta a mano — nunca pisa una preferencia que ya existe.
 *
 * Si guardar falla (se corto la red, un error del servidor), reintenta dos veces.
 */
export function TimezoneBootstrap({ hasSaved }: { hasSaved: boolean }) {
  const router = useRouter();
  const tried = useRef(false);

  useEffect(() => {
    if (hasSaved || tried.current) return;
    tried.current = true;

    let timezone: string;
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!timezone) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (index: number) => {
      saveDetectedTimezone(timezone)
        .then((result) => (result.ok ? "saved" : "failed"))
        .catch(() => "failed")
        .then((outcome) => {
          if (outcome === "saved") {
            router.refresh();
            return;
          }
          const wait = RETRY_MS[index];
          if (wait !== undefined) timer = setTimeout(() => attempt(index + 1), wait);
        });
    };
    attempt(0);
    return () => clearTimeout(timer);
  }, [hasSaved, router]);

  return null;
}
