import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { ConditionFieldArgs, NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { FlowExecutionContext } from "../types";
import { matchConditionField } from "../registry/registry";
import {
  MissingFieldError,
  pickPath,
  type BranchCondition,
  type BranchNodeData,
  type CheckResult,
  type FieldResolver,
  type FieldValue,
} from "../condition-eval";
import { BRANCH_ELSE_HANDLE, BRANCH_ELSE_LABEL, pathsOf } from "../branch-paths";

/**
 * "Condiciones": va por el PRIMER camino cuyas condiciones se cumplen, en el
 * orden en que estan dibujados; si ninguno se cumple, por "Si no"
 * (`handle:else`, que siempre existe).
 *
 * Reglas que no se discuten:
 *  - NUNCA lanza. Un campo que no se puede leer (la pregunta ya no existe, la
 *    base no responde) hace que esa condicion no se cumpla, y el flujo sigue.
 *  - Cada campo se resuelve UNA vez, aunque lo miren varias condiciones; el
 *    contacto y la respuesta del formulario se cargan solo si algun campo los
 *    necesita.
 *  - Se compara el valor REAL de la respuesta (un numero, una lista), no su
 *    texto. Ver `condition-eval.ts`.
 *  - Deja `branch_taken` en `analytics_events` (la ficha del contacto muestra
 *    "fue por el camino X"). SIN los valores de las respuestas: pueden ser
 *    datos personales. Solo el camino y, por condicion, que campo y si se cumplio.
 *
 * El motor no sabe de este nodo: sigue `handle:<id>` como con cualquier otro.
 */

/**
 * Los campos que se resuelven sin el contacto. Para estos, si el contacto no
 * existe, igual se puede decidir. Los demas (tags, secuencias, campos
 * personalizados...) no se cumplen sin contacto.
 */
const CONTACT_FREE_PREFIXES = ["answer.", "form.", "submission.", "booking.", "sale.", "payment.", "variable:"];
const CONTACT_FREE_FIELDS = ["platform", "agent_active"];

function isContactFree(condition: BranchCondition): boolean {
  // Una condicion sin tipo es del nodo viejo: se comporta como el: sin contacto, nada se cumple.
  if (!condition.valueType) return false;
  const field = condition.field;
  return CONTACT_FREE_FIELDS.includes(field) || CONTACT_FREE_PREFIXES.some((p) => field.startsWith(p));
}

type Resolution = { ok: true; value: FieldValue } | { ok: false; error: unknown };

const CONTACT_SELECT = "*, contact_tags(tag_id, tags(name)), contact_custom_fields(field_id, value, custom_field_definitions(slug))";

async function loadContact(supabase: SupabaseClient<Database>, contactId: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.from("contacts").select(CONTACT_SELECT).eq("id", contactId).single();
  return (data as unknown as Record<string, unknown> | null) ?? null;
}

/** Un campo personalizado del contacto por su slug (el campo sin prefijo). */
function customFieldValue(contact: Record<string, unknown>, slug: string): FieldValue {
  const fields = contact.contact_custom_fields as Array<{ value: string; custom_field_definitions: { slug: string } | null }> | null;
  return fields?.find((f) => f.custom_field_definitions?.slug === slug)?.value;
}

/**
 * Resuelve de una vez todos los campos que miran los caminos y devuelve una
 * funcion que NO consulta nada (la que usa `pickPath`). Una resolucion fallida
 * se guarda y se lanza recien cuando alguien la pide, para que `pickPath` la
 * cuente como "no se cumple".
 */
export async function resolveBranchFields(
  supabase: SupabaseClient<Database>,
  context: FlowExecutionContext,
  conditions: BranchCondition[],
): Promise<FieldResolver> {
  const byField = new Map<string, BranchCondition[]>();
  for (const condition of conditions) {
    const field = typeof condition?.field === "string" ? condition.field : "";
    byField.set(field, [...(byField.get(field) ?? []), condition]);
  }

  // El contacto, solo si algun campo lo necesita.
  const needsContact = [...byField.values()].some((list) => list.some((c) => !isContactFree(c)));
  let contact: Record<string, unknown> | null = null;
  if (needsContact) {
    try {
      contact = await loadContact(supabase, context.contactId);
    } catch (error) {
      console.error("[branch] no pude cargar el contacto:", error instanceof Error ? error.message : error);
    }
  }

  const memo = new Map<string, Promise<unknown>>();
  const resolutions = new Map<string, Resolution>();

  await Promise.all(
    [...byField.entries()].map(async ([field, list]) => {
      try {
        const match = matchConditionField(field);
        const contactFree = list.every(isContactFree);
        if (!contactFree && !contact) throw new Error("No se encontró el contacto");

        let value: FieldValue;
        if (match) {
          const args: ConditionFieldArgs = { supabase, argument: match.argument, context, contact: contact ?? {}, memo };
          value = match.definition.resolveTyped ? await match.definition.resolveTyped(args) : await match.definition.resolve(args);
        } else {
          // Sin resolver registrado se asume campo personalizado, como el nodo viejo.
          value = customFieldValue(contact as Record<string, unknown>, field);
        }
        resolutions.set(field, { ok: true, value });
      } catch (error) {
        resolutions.set(field, { ok: false, error });
      }
    }),
  );

  return (field: string): FieldValue => {
    const resolution = resolutions.get(field);
    if (!resolution) throw new MissingFieldError(field);
    if (!resolution.ok) throw resolution.error;
    return resolution.value;
  };
}

/** Lo que queda en `analytics_events`: por camino mirado, que campo y si se cumplio. Nunca el valor. */
function checksForLog(evaluated: Array<{ pathId: string; checks: CheckResult[] }>) {
  return evaluated.flatMap(({ pathId, checks }) =>
    checks.map((c) => ({
      pathId,
      field: c.field,
      operator: c.operator,
      ok: c.ok,
      ...(c.missing ? { missing: true } : {}),
      ...(c.error ? { error: true } : {}),
    })),
  );
}

export const branchNode: NodeDefinition<BranchNodeData> = {
  type: "branch",
  label: "Condiciones",
  async execute({ supabase, node, data, context, sessionId }: NodeExecutionArgs<BranchNodeData>) {
    try {
      const paths = pathsOf(data);
      const conditions = paths.flatMap((p) => (Array.isArray(p.conditions) ? p.conditions : []));
      const resolve = await resolveBranchFields(supabase, context, conditions);
      const pick = pickPath(paths, resolve);

      const handle = pick.path?.id ?? BRANCH_ELSE_HANDLE;

      try {
        const { error } = await supabase.from("analytics_events").insert({
          workspace_id: context.workspaceId,
          flow_id: context.flowId,
          contact_id: context.contactId,
          event_type: "branch_taken",
          metadata: {
            nodeId: node.id,
            sessionId,
            pathId: handle,
            pathLabel: pick.path?.label ?? BRANCH_ELSE_LABEL,
            checks: checksForLog(pick.evaluated),
          },
        });
        if (error) console.error("[branch] no pude anotar el camino:", error.message);
      } catch (error) {
        // El registro del camino es un extra: nunca frena el flujo.
        console.error("[branch] no pude anotar el camino:", error instanceof Error ? error.message : error);
      }

      return `handle:${handle}`;
    } catch (error) {
      // Cualquier cosa inesperada: "Si no", el camino que siempre existe.
      console.error("[branch] error inesperado, va por 'Si no':", error instanceof Error ? error.message : error);
      return `handle:${BRANCH_ELSE_HANDLE}`;
    }
  },
};
