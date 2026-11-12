// @plantilla-quitar(servicios)
"use client";

import { useEffect, useState } from "react";
import { loadServicePickerOptions } from "@/lib/actions/service-picker";
import type { ServicePickerOptions } from "@/lib/services/service-picker";

/** Una sola lectura por pantalla: los paneles de Servicios del editor comparten las listas. */
let cache: Promise<ServicePickerOptions | null> | null = null;

/** Las listas de Servicios del editor (F122). `undefined` mientras cargan; `null` si no se pudieron leer. */
export function useServicePicker(): ServicePickerOptions | null | undefined {
  const [options, setOptions] = useState<ServicePickerOptions | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    cache ??= loadServicePickerOptions()
      .then((r) => (r.ok ? r.options : null))
      .catch(() => null);
    cache.then((o) => {
      if (alive) setOptions(o);
      // Si fallo, la proxima vez que se abra un panel se vuelve a intentar.
      if (o === null) cache = null;
    });
    return () => {
      alive = false;
    };
  }, []);
  return options;
}
