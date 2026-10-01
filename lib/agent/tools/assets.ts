import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { interpolateTemplate } from "@/lib/templates/interpolate";
import { channelAcceptsMedia } from "@/lib/channels/media";
import type { AgentToolDefinition } from "./types";

/**
 * listar_recursos y usar_recurso: la banca de recursos (textos y audios)
 * desde el agente.
 *
 * Que un recurso exista no alcanza para que el agente lo use: tiene que estar
 * habilitado para el agente (el toggle "Asistente" de /dashboard/settings/recursos),
 * y un audio ademas necesita la transcripcion lista. Las dos herramientas
 * comparten ese filtro (loadEligibleAssets) para no desalinearse.
 *
 * No hay un multiselect de "que recursos puede usar este agente": el toggle
 * de la banca YA es ese interruptor.
 *
 * usar_recurso se ramifica por tipo:
 *   - texto: no hay nada que mandar aparte. Devuelve el contenido YA
 *     INTERPOLADO en forModel para que el modelo lo use como su respuesta —
 *     mandarlo tambien como mensaje separado seria mandar dos.
 *   - audio: no manda nada ella misma. Deja el audio anotado en turn.memo
 *     (mismo patron que generar_link_whatsapp con el link) y el runner lo
 *     manda DESPUES del texto, por sendChannelMessage (lib/agent/send-asset.ts).
 *     En modo borrador (defersInDraftAsync) ni siquiera lo anota: queda como
 *     sugerencia para que la bandeja la muestre con su reproductor y se mande
 *     recien al aprobar.
 *   - un audio solo se ofrece si el canal de la conversacion acepta media
 *     (lib/channels/media.ts): un email no puede mandar un audio, y
 *     sendViaResendChannel lo ignoraria en silencio si se intentara.
 */

type Db = SupabaseClient<Database>;

/** Clave en la memoria del turno: el audio que usar_recurso dejo listo para mandar. */
export const ASSET_SEND_MEMO_KEY = "response_asset_send";

export interface AssetSendMemo {
  assetId: string;
  name: string;
  storagePath: string;
  mimeType: string;
  durationSeconds: number | null;
  transcript: string;
}

interface EligibleAssetRow {
  id: string;
  kind: "text" | "audio";
  name: string;
  description: string | null;
  shortcut: string | null;
  tags: string[];
  content: string | null;
  storage_path: string | null;
  mime_type: string | null;
  duration_seconds: number | null;
  transcript: string | null;
}

/**
 * Si el canal de esta conversacion acepta media. Sin canal conocido (no
 * deberia pasar en un turno de chat de verdad), se asume que no: la
 * consecuencia de no ofrecer un audio de mas es minima; la de ofrecer uno que
 * el canal no puede mandar es el bug que esto evita.
 */
async function channelAccepts(supabase: Db, channelId: string | null): Promise<boolean> {
  if (!channelId) return false;
  const { data, error } = await supabase.from("channels").select("provider").eq("id", channelId).maybeSingle();
  if (error || !data) return false;
  return channelAcceptsMedia(data.provider);
}

/** Los recursos que el agente puede usar: habilitados y activos; un audio ademas con transcripcion lista. */
async function loadEligibleAssets(supabase: Db, workspaceId: string, channelId: string | null): Promise<EligibleAssetRow[]> {
  const { data, error } = await supabase
    .from("response_assets")
    .select("id, kind, name, description, shortcut, tags, content, storage_path, mime_type, duration_seconds, transcript")
    .eq("workspace_id", workspaceId)
    .eq("agent_enabled", true)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("name");
  if (error) {
    console.error("[agent-tools/assets] no pude leer la banca:", error.message);
    return [];
  }

  const rows = data ?? [];
  const texts = rows.filter((r) => r.kind === "text");

  const audioRows = rows.filter(
    (r): r is EligibleAssetRow & { transcript: string } => r.kind === "audio" && typeof r.transcript === "string" && r.transcript.length > 0,
  );
  if (audioRows.length === 0) return texts;

  const acceptsMedia = await channelAccepts(supabase, channelId);
  if (!acceptsMedia) return texts;

  // El filtro de transcripcion lista es ademas una condicion de SQL
  // (idx_response_assets_agent_enabled no la incluye, asi que se resuelve en
  // memoria): un audio todavia transcribiendo o fallido no se ofrece.
  const readyAudios = audioRows.filter((r) => r.transcript !== null);
  return [...texts, ...readyAudios];
}

const listInputSchema = z.object({}).strict();
const listConfigSchema = z.object({});

export const listarRecursosTool: AgentToolDefinition<z.infer<typeof listInputSchema>, z.infer<typeof listConfigSchema>> = {
  name: "listar_recursos",
  label: "Ver los recursos disponibles",
  description:
    "Lista los recursos de la banca que podes usar: nombre, tipo, para que sirve cada uno y su contenido o transcripcion. Usala antes de usar_recurso para elegir el correcto por su id.",
  inputSchema: listInputSchema,
  configSchema: listConfigSchema,
  configFields: [],
  async execute({ ctx }) {
    const assets = await loadEligibleAssets(ctx.supabase, ctx.workspaceId, ctx.channelId);
    if (assets.length === 0) {
      return { ok: true, forModel: "No hay recursos disponibles para usar." };
    }
    const listado = assets.map((a) => ({
      id: a.id,
      tipo: a.kind === "audio" ? "audio" : "texto",
      nombre: a.name,
      para_que_sirve: a.description,
      etiquetas: a.tags,
      ...(a.kind === "audio" ? { transcripcion: a.transcript } : { texto: a.content }),
    }));
    return { ok: true, forModel: JSON.stringify(listado), detail: { cantidad: assets.length } };
  },
};

const useInputSchema = z
  .object({
    recurso_id: z.string().min(1).describe("El id del recurso a usar, tal como lo devolvio listar_recursos."),
  })
  .strict();
const useConfigSchema = z.object({});

export const usarRecursoTool: AgentToolDefinition<z.infer<typeof useInputSchema>, z.infer<typeof useConfigSchema>> = {
  name: "usar_recurso",
  label: "Usar un recurso de la banca",
  description:
    "Usa un recurso de la banca: un texto te lo devuelve ya listo para que lo digas como tu respuesta; un audio se manda al lead DESPUES de tu respuesta de texto, como un mensaje de audio real -- no describas su contenido como si ya lo hubieras mandado. Usa listar_recursos primero para saber que id pasar.",
  inputSchema: useInputSchema,
  configSchema: useConfigSchema,
  configFields: [],
  auditAction: "agent_asset_sent",
  // No usa `deferInDraft` (sincronico): necesita leer la base para saber si
  // el recurso sigue habilitado y, si es un audio, traer su archivo. Ver
  // `defersInDraftAsync`. La rama de texto no difiere nada: devolver texto es
  // una lectura, y en borrador cae en el texto propuesto como cualquier otra
  // salida del modelo.
  defersInDraftAsync: true,
  async execute({ input, ctx }) {
    const assets = await loadEligibleAssets(ctx.supabase, ctx.workspaceId, ctx.channelId);
    const asset = assets.find((a) => a.id === input.recurso_id);
    if (!asset) {
      return {
        ok: false,
        forModel: "Ese recurso no existe o no esta disponible para vos ahora mismo. Usa listar_recursos para ver los que podes usar.",
      };
    }

    if (asset.kind === "text") {
      // La interpolacion la hace la herramienta, con los datos reales del
      // contacto y del negocio: el modelo no tiene por que adivinar que va
      // en {{contact.display_name}}.
      const contact = ctx.contactId
        ? (await ctx.supabase.from("contacts").select("display_name, email, phone").eq("id", ctx.contactId).maybeSingle()).data
        : null;
      const workspace = (await ctx.supabase.from("workspaces").select("name").eq("id", ctx.workspaceId).maybeSingle()).data;

      const texto = interpolateTemplate(asset.content ?? "", { contact, workspace });
      return {
        ok: true,
        forModel: `Usa este texto como tu respuesta (ya tiene sus variables resueltas): "${texto}"`,
        detail: { recurso_id: asset.id, nombre: asset.name },
      };
    }

    const memoMap = ctx.turn?.memo ?? new Map<string, unknown>();
    const already = memoMap.get(ASSET_SEND_MEMO_KEY) as AssetSendMemo | undefined;
    if (already) {
      return {
        ok: false,
        forModel: `Ya tenes el audio "${already.name}" en cola para este turno. Solo se puede mandar uno por respuesta.`,
      };
    }

    const memo: AssetSendMemo = {
      assetId: asset.id,
      name: asset.name,
      storagePath: asset.storage_path as string,
      mimeType: asset.mime_type as string,
      durationSeconds: asset.duration_seconds,
      transcript: asset.transcript as string,
    };

    if (ctx.mode === "draft") {
      return {
        ok: true,
        forModel: `Anotado como sugerencia: el audio "${asset.name}" se manda si la persona que revisa aprueba tu respuesta. Segui como corresponda.`,
        detail: { recurso_id: asset.id, nombre: asset.name },
        // No se audita en modo borrador: todavia no paso nada de verdad. Se
        // registra recien al aprobar (applySuggestions, lib/agent/drafts/actions.ts).
        suggestion: {
          type: "send_asset",
          assetId: asset.id,
          name: asset.name,
          storagePath: memo.storagePath,
          mimeType: memo.mimeType,
          durationSeconds: memo.durationSeconds,
        },
      };
    }

    memoMap.set(ASSET_SEND_MEMO_KEY, memo);
    return {
      ok: true,
      forModel: `Listo: el audio "${asset.name}" se manda despues de tu respuesta de texto.`,
      detail: { recurso_id: asset.id, nombre: asset.name },
    };
  },
};
