"use client";

import { useEffect, useMemo, useState } from "react";
import { getConditionCatalogInputs } from "@/lib/actions/flow-conditions";
import type { ConditionCatalogInputs } from "@/lib/automations/condition-catalog-inputs";
import { availableConditionFields, type ConditionFieldGroup } from "@/lib/flow-engine/condition-catalog";
import type { RawFlowNode } from "@/lib/flow-engine/node-outputs";

/**
 * El catalogo de campos comparables para un punto del flujo.
 *
 * Lo del servidor (disparador, campos personalizados, tags, secuencias) se pide
 * una vez y se vuelve a pedir si cambia el disparador; lo que depende del grafo
 * (los pasos que quedan ANTES) se calcula aca con la funcion pura de siempre.
 */
export function useConditionCatalog(flowId: string, triggerData?: Record<string, unknown>) {
  const [inputs, setInputs] = useState<ConditionCatalogInputs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // El disparador cambia pocas veces: la huella evita pedir de nuevo por cada tecla en otro nodo.
  const triggerKey = triggerData ? JSON.stringify(triggerData) : "";

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      getConditionCatalogInputs({ flowId, ...(triggerKey ? { triggerData: JSON.parse(triggerKey) as Record<string, unknown> } : {}) })
        .then((result) => {
          if (!alive) return;
          if (result.ok) {
            setInputs(result.inputs);
            setError(null);
          } else setError(result.error);
        })
        .catch(() => {
          if (alive) setError("No pude cargar los campos para comparar. Probá de nuevo.");
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [flowId, triggerKey]);

  return { inputs, error, loading };
}

/** Los campos de un punto del flujo: lo del servidor mas lo que dejan los pasos de antes. */
export function useConditionGroups(inputs: ConditionCatalogInputs | null, upstreamNodes: Array<RawFlowNode & { id?: string }>): ConditionFieldGroup[] {
  const key = JSON.stringify(upstreamNodes.map((n) => [n.id, n.type, n.data]));
  return useMemo(
    () => availableConditionFields({ ...(inputs ?? { triggerSchema: [], customFields: [], tags: [], sequences: [] }), upstreamNodes }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` resume `upstreamNodes`
    [inputs, key],
  );
}
