"use client";

import { useEffect } from "react";
import { openPickerFor } from "@/lib/ui/date-picker-click";

/**
 * Montado una vez en `app/layout.tsx`: un clic en cualquier parte de un campo de fecha (u hora) de cualquier
 * pantalla abre el calendario. La regla vive en `lib/ui/date-picker-click.ts`. No dibuja nada.
 */
export function DatePickerOpener() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target;
      if (target instanceof HTMLInputElement) openPickerFor(target);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
