import type { Json } from "@/lib/types/database";
import { listAgentTools } from "./index";
import type { ToolConfigField } from "./types";

/**
 * El puente entre el registro (servidor) y la pestana Herramientas (cliente).
 *
 * El registro importa zod, el cliente de Supabase y node:crypto: no puede
 * viajar a un componente cliente. Lo que viaja es una descripcion plana de
 * cada herramienta (nombre, etiqueta, campos de pantalla, defaults). Y lo que
 * vuelve de la pantalla se normaliza aca, contra el configSchema de cada
 * herramienta, antes de tocar la base.
 */

export interface ScreenTool {
  name: string;
  label: string;
  description: string;
  required: boolean;
  managedFrom: "knowledge" | null;
  configFields: ToolConfigField[];
  /** configSchema.parse({}): lo que vale cada parametro si no se toco. */
  defaults: Record<string, unknown>;
}

export function serializeToolsForScreen(): ScreenTool[] {
  return listAgentTools().map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    required: Boolean(tool.required),
    managedFrom: tool.managedFrom ?? null,
    configFields: tool.configFields,
    defaults: tool.configSchema.parse({}) as Record<string, unknown>,
  }));
}

export type NormalizedTools =
  | { ok: true; allowedTools: string[]; toolsConfig: Record<string, Json> }
  | { ok: false; error: string };

/**
 * Valida lo que manda la pantalla contra el registro. Pura: lo que depende de
 * la base (que los tags existan, que los usuarios sean miembros) lo verifica
 * la Server Action con `options`.
 */
export function normalizeToolsConfig(
  input: { allowedTools: unknown; toolsConfig: unknown },
  options: { existingTagIds: Iterable<string>; memberIds: Iterable<string> },
): NormalizedTools {
  if (!Array.isArray(input.allowedTools) || !input.toolsConfig || typeof input.toolsConfig !== "object" || Array.isArray(input.toolsConfig)) {
    return { ok: false, error: "Pedido invalido." };
  }
  const tools = new Map(listAgentTools().map((t) => [t.name, t]));
  const tagIds = new Set(options.existingTagIds);
  const memberIds = new Set(options.memberIds);

  // Solo herramientas del registro que se puedan prender desde aca: las
  // obligatorias van siempre y las de otra pestana se deciden alla.
  const allowedTools = [...new Set(input.allowedTools.filter((n): n is string => typeof n === "string"))].filter((name) => {
    const tool = tools.get(name);
    return tool && !tool.required && !tool.managedFrom;
  });

  const toolsConfig: Record<string, Json> = {};
  for (const [name, raw] of Object.entries(input.toolsConfig as Record<string, unknown>)) {
    const tool = tools.get(name);
    if (!tool) continue; // una herramienta que ya no existe no se guarda
    const parsed = tool.configSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { ok: false, error: `${tool.label}: ${issue?.path.join(".") ? `${issue.path.join(".")}: ` : ""}${issue?.message ?? "configuracion invalida"}` };
    }
    const config = parsed.data as Record<string, unknown>;

    // Lo que apunta a la base se recorta a lo que existe: un id de un tag
    // borrado o de alguien que dejo el equipo no se guarda.
    for (const field of tool.configFields) {
      const value = config[field.key];
      if (field.kind === "multiselect" && field.optionSource === "tags" && Array.isArray(value)) {
        config[field.key] = value.filter((id) => typeof id === "string" && tagIds.has(id));
      }
      if (field.kind === "multiselect" && field.optionSource === "members" && Array.isArray(value)) {
        config[field.key] = value.filter((id) => typeof id === "string" && memberIds.has(id));
      }
      if (field.kind === "select" && field.optionSource === "members" && typeof value === "string" && !memberIds.has(value)) {
        config[field.key] = null;
      }
    }
    // Segunda pasada por si el recorte rompio una regla cruzada (usuario fijo fuera de la lista).
    const again = tool.configSchema.safeParse(config);
    if (!again.success) {
      return { ok: false, error: `${tool.label}: ${again.error.issues[0]?.message ?? "configuracion invalida"}` };
    }
    toolsConfig[name] = again.data as Json;
  }

  return { ok: true, allowedTools, toolsConfig };
}
