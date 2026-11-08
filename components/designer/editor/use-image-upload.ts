"use client";

import { useCallback, useState } from "react";
import { uploadDesignImageAction } from "@/lib/actions/designer/designs";
import type { UploadedFile } from "@/lib/designer/designs-types";
import { precheckImage } from "@/lib/designer/screens/uploads";

/**
 * Subir una imagen al negocio (`design-assets`): se revisa rápido acá y el servidor valida los bytes.
 * Devuelve el archivo subido o `null` (el motivo queda en `error`).
 */
export function useImageUpload() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (file: File): Promise<UploadedFile | null> => {
    setError(null);
    const problem = precheckImage(file);
    if (problem) {
      setError(problem);
      return null;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const result = await uploadDesignImageAction(form);
      if (!result.ok) {
        setError(result.error);
        return null;
      }
      return result.data;
    } catch {
      // Una imagen más pesada que el límite del servidor no llega a la acción: se avisa claro.
      setError("No se pudo subir la imagen. Probá con una más liviana o de nuevo en un rato.");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return { upload, busy, error, clearError: () => setError(null) };
}
