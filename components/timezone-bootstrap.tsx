"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { saveDetectedTimezone } from "@/lib/actions/user-preferences";

/**
 * Detecta la zona horaria del navegador y la guarda, UNA sola vez, la
 * primera vez que alguien entra sin ninguna preferencia guardada todavia.
 *
 * Sin render propio: vive montado en el layout del dashboard. `hasSaved` lo
 * calcula el servidor (`getSavedViewerTimezone`), asi que esto no hace nada
 * en absoluto para quien ya tiene una zona guardada, sea detectada antes o
 * puesta a mano — nunca pisa una preferencia que ya existe.
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

    saveDetectedTimezone(timezone).then((result) => {
      if (result.ok) router.refresh();
    });
  }, [hasSaved, router]);

  return null;
}
