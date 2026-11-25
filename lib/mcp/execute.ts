import "server-only";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createServiceClient } from "@/lib/supabase/server";
import { ACTION_MODULES } from "./action-loaders.generated";
import { findAction, type CatalogAction } from "./catalog";
import { checkConfirmation, issueConfirmation } from "./confirm";
import { toFormData } from "./files";
import { fail, nextNavigationMessage, ok, toJsonText } from "./result";

/**
 * Ejecutar una acción de la app por el conector MCP (docs/mcp.md). Solo servidor.
 *
 * Corre DENTRO de `runWithIdentity`: la acción ve a la persona y su negocio como si hubiera tocado el botón, con sus
 * mismos guards y la misma RLS. Este módulo no decide permisos (eso lo hace la acción); solo agrega la confirmación
 * extra de lo delicado y traduce lo que vuelve.
 */

export interface McpActor {
  userId: string;
  workspaceId: string;
}

export function confirmationPreview(action: { id: string; description: string }, args: unknown[], token: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: [
          `Esta acción es delicada y todavía NO se hizo: ${action.id}.`,
          action.description ? `Qué hace: ${action.description}` : null,
          `Con estos datos: ${toJsonText(args, 4000)}`,
          "",
          "Si la persona está de acuerdo, volvé a llamar con los MISMOS argumentos y este token en «confirmacion» (vence en 5 minutos y sirve una sola vez):",
          token,
        ]
          .filter((l) => l !== null)
          .join("\n"),
      },
    ],
    structuredContent: { confirmacion_requerida: true, accion: action.id, token_confirmacion: token },
  };
}

/** Anota la confirmación como usada; false si ya se había usado. */
async function consumeConfirmation(signature: string, userId: string): Promise<boolean | null> {
  const service = await createServiceClient();
  const { error } = await service.from("mcp_used_confirmations" as never).insert({ signature, user_id: userId } as never);
  if (!error) {
    // Limpieza de paso: lo de más de un día ya no sirve para nada.
    void service
      .from("mcp_used_confirmations" as never)
      .delete()
      .lt("used_at", new Date(Date.now() - 86_400_000).toISOString())
      .then(() => undefined);
    return true;
  }
  if (error.code === "23505") return false;
  console.error("[mcp] no pude anotar la confirmación:", error.code ?? "?");
  return null;
}

/**
 * La confirmación extra (docs/mcp.md): sin token devuelve el resumen y un token; con un token válido y sin usar,
 * null (se puede seguir). La usan las acciones del catálogo y las herramientas guiadas delicadas.
 */
export async function confirmGate(actor: McpActor, action: { id: string; description: string }, args: unknown[], confirmToken: unknown): Promise<CallToolResult | null> {
  const subject = { userId: actor.userId, workspaceId: actor.workspaceId, action: action.id, args };
  if (confirmToken === undefined || confirmToken === null || confirmToken === "") {
    return confirmationPreview(action, args, issueConfirmation(subject));
  }
  const check = checkConfirmation(confirmToken, subject);
  if (!check.ok) {
    const why = check.reason === "expired" ? "venció (dura 5 minutos)" : check.reason === "mismatch" ? "no corresponde a esta acción con estos argumentos" : "no es válido";
    return fail(`El token de confirmación ${why}. Llamá otra vez sin token para pedir uno nuevo.`);
  }
  const fresh = await consumeConfirmation(check.signature, actor.userId);
  if (fresh === false) return fail("Ese token de confirmación ya se usó. Llamá otra vez sin token si hay que repetirlo.");
  if (fresh === null) return fail("No pude registrar la confirmación, así que no hice nada. Probá de nuevo.");
  return null;
}

export async function executeCatalogAction(
  actor: McpActor,
  id: string,
  rawArgs: unknown,
  confirmToken: unknown,
): Promise<CallToolResult> {
  const action = findAction(id);
  if (!action) return fail(`No existe la acción «${id}». Buscá el id con listar_acciones.`);
  const args = rawArgs === undefined || rawArgs === null ? [] : Array.isArray(rawArgs) ? rawArgs : [rawArgs];
  if (args.length > action.params.length) {
    return fail(`«${id}» recibe ${action.params.length} argumento(s) y llegaron ${args.length}. Mirá describir_accion.`);
  }
  const missing = action.params.slice(args.length).find((p) => !p.optional);
  if (missing && args.length < action.params.filter((p) => !p.optional).length) {
    return fail(`Falta el argumento «${missing.name}» de «${id}». Mirá describir_accion.`);
  }

  if (action.kind === "sensitive") {
    const gate = await confirmGate(actor, action, args, confirmToken);
    if (gate) return gate;
  }

  let finalArgs: unknown[];
  try {
    finalArgs = await Promise.all(args.map((a, i) => (action.params[i]?.type === "FormData" ? toFormData(a) : a)));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "No pude armar los datos de la acción.");
  }

  const loader = ACTION_MODULES[action.file];
  if (!loader) return fail(`La acción «${id}» no está disponible (volvé a generar el catálogo).`);
  try {
    const mod = await loader();
    const fn = mod[action.name];
    if (typeof fn !== "function") return fail(`La acción «${id}» no está disponible.`);
    const result = await (fn as (...a: unknown[]) => Promise<unknown>)(...finalArgs);
    const failed = result && typeof result === "object" && (result as { ok?: unknown }).ok === false;
    return failed ? { ...ok(result), isError: true } : ok(result === undefined ? { ok: true } : result);
  } catch (err) {
    const nav = nextNavigationMessage(err);
    if (nav) return fail(nav);
    // En el log solo la acción y el tipo de error: el mensaje puede traer datos de la persona.
    console.error(`[mcp] ${id} falló:`, err instanceof Error ? err.name : "error");
    return fail(`La acción «${id}» falló: ${err instanceof Error ? err.message.slice(0, 300) : "error desconocido"}`);
  }
}
