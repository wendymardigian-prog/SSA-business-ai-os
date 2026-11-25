"use client";

/**
 * El selector «Elegir del ejemplo» del paso «Crear o actualizar contacto»: muestra la copia NORMALIZADA
 * del ejemplo (lib/webhooks/normalize.ts) y devuelve la ruta `webhook.data.…` / `webhook.query_data.…`, la misma que la
 * variable `{{webhook.data.…}}`. Así se elige cualquier campo, venga anidado, en listas, con corchetes, con tildes o
 * dentro de un JSON en texto.
 */
import { useMemo } from "react";
import { JsonTree } from "@/components/webhooks/json-tree";
import { normalizePayload } from "@/lib/webhooks/normalize";

export function WebhookSamplePicker({
  sample,
  onPick,
}: {
  sample: { payload: unknown; query: Record<string, unknown> };
  onPick: (path: string) => void;
}) {
  const data = useMemo(() => normalizePayload(sample.payload), [sample.payload]);
  const queryData = useMemo(() => normalizePayload(sample.query), [sample.query]);
  return (
    <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-background p-2">
      <JsonTree value={data as never} rootPath="webhook.data" onPick={(path) => onPick(path)} />
      {Object.keys(queryData).length > 0 && (
        <>
          <p className="mt-2 text-[11px] font-semibold text-muted-foreground">Parámetros de la URL</p>
          <JsonTree value={queryData as never} rootPath="webhook.query_data" onPick={(path) => onPick(path)} />
        </>
      )}
    </div>
  );
}
