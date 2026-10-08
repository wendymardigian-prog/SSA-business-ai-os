import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { interpolateTemplate } from "@/lib/templates/interpolate";
import { channelAccepts } from "@/lib/channels/media";
import { agentUsable, type TranscriptStatus } from "@/lib/response-assets/list";
import { hasFile, type AssetKind } from "@/lib/response-assets/kind";
import { touchAssetUsage } from "@/lib/response-assets/usage";
import type { AgentToolDefinition } from "./types";

/**
 * listar_recursos y usar_recurso: la banca de recursos (los seis tipos)
 * desde el agente (banca v2, F11).
 *
 * Que un recurso exista no alcanza para que el agente lo use. Tiene que:
 *   - estar habilitado para el agente (el interruptor "Asistente" de la
 *     banca) y activo;
 *   - poder "leerse": un audio, o un video con voz, necesita la
 *     transcripcion LISTA (es lo unico que el agente puede escuchar); un
 *     video sin voz, una imagen, un archivo o un enlace alcanzan con su
 *     descripcion, que es obligatoria;
 *   - poder mandarse por ESTE canal (lib/channels/media.ts: un email no manda
 *     archivos, Instagram no manda documentos ni ciertos audios).
 * Las dos herramientas comparten ese filtro (loadEligibleAssets) para no
 * desalinearse, y es la misma regla que la pantalla (`agentUsable`).
 *
 * usar_recurso se ramifica por tipo:
 *   - texto: no hay nada que mandar aparte. Devuelve el contenido YA
 *     INTERPOLADO para que el modelo lo use como su respuesta -- mandarlo
 *     tambien como mensaje separado seria mandar dos.
 *   - enlace: igual, vuelve como texto (la URL) para que el modelo la incluya.
 *   - audio, video, imagen, archivo: no manda nada ella misma. Lo deja
 *     anotado en turn.memo (maximo UNO por respuesta) y el runner lo manda
 *     DESPUES del texto, por sendChannelMessage (lib/agent/send-asset.ts),
 *     copiando antes el archivo a la conversacion. En modo borrador
 *     (defersInDraftAsync) ni siquiera lo anota: queda como sugerencia y se
 *     manda recien al aprobar.
 */

type Db = SupabaseClient<Database>;

/** Clave en la memoria del turno: el recurso con archivo que usar_recurso dejo listo para mandar. */
export const ASSET_SEND_MEMO_KEY = "response_asset_send";

export type MediaAssetKind = Extract<AssetKind, "audio" | "video" | "image" | "file">;

export interface AssetSendMemo {
  assetId: string;
  /** Sin esto (memos viejos), es un audio. */
  kind?: MediaAssetKind;
  name: string;
  storagePath: string;
  mimeType: string;
  durationSeconds: number | null;
  /** La transcripcion de un audio o un video con voz: va como texto del mensaje. */
  transcript: string | null;
  /** El texto que acompaña a una imagen, un video o un archivo. */
  caption?: string | null;
}

interface EligibleAssetRow {
  id: string;
  kind: AssetKind;
  name: string;
  description: string | null;
  shortcut: string | null;
  tags: string[];
  content: string | null;
  url: string | null;
  caption: string | null;
  storage_path: string | null;
  mime_type: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  transcript_status: string;
}

/** Como se llaman los tipos para el modelo, en castellano. */
const TIPO: Record<AssetKind, string> = {
  text: "texto",
  audio: "audio",
  video: "video",
  image: "imagen",
  file: "archivo",
  link: "enlace",
};

const KIND_FROM_TIPO: Record<string, AssetKind> = Object.fromEntries(
  Object.entries(TIPO).map(([kind, tipo]) => [tipo, kind as AssetKind]),
);

/** El proveedor del canal de la conversacion. Sin canal, null: solo se ofrece lo que es texto. */
async function channelProvider(supabase: Db, channelId: string | null): Promise<string | null> {
  if (!channelId) return null;
  const { data, error } = await supabase.from("channels").select("provider").eq("id", channelId).maybeSingle();
  if (error || !data) return null;
  return data.provider;
}

/** Los recursos que el agente puede usar en este canal (ver la cabecera). */
async function loadEligibleAssets(
  supabase: Db,
  workspaceId: string,
  channelId: string | null,
  filters: { kind?: AssetKind; tag?: string } = {},
): Promise<EligibleAssetRow[]> {
  const { data, error } = await supabase
    .from("response_assets")
    .select("id, kind, name, description, shortcut, tags, content, url, caption, storage_path, mime_type, duration_seconds, transcript, transcript_status")
    .eq("workspace_id", workspaceId)
    .eq("agent_enabled", true)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("usage_count", { ascending: false })
    .order("name");
  if (error) {
    console.error("[agent-tools/assets] no pude leer la banca:", error.message);
    return [];
  }

  const rows = (data ?? []) as EligibleAssetRow[];
  const provider = rows.some((r) => hasFile(r.kind)) ? await channelProvider(supabase, channelId) : null;
  const tag = filters.tag?.trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.kind && row.kind !== filters.kind) return false;
    if (tag && !(row.tags ?? []).some((t) => t.toLowerCase() === tag)) return false;
    if (!agentUsable({ kind: row.kind, transcriptStatus: row.transcript_status as TranscriptStatus })) return false;
    // Un audio o un video "listo" tiene que tener el texto de verdad.
    if (row.transcript_status === "ready" && !row.transcript) return false;
    if (hasFile(row.kind) && (!row.storage_path || !row.mime_type)) return false;
    return channelAccepts(provider, row.kind, hasFile(row.kind) ? row.mime_type : undefined).ok;
  });
}

const TIPO_VALUES = ["texto", "audio", "video", "imagen", "archivo", "enlace"] as const;

const listInputSchema = z
  .object({
    tipo: z.enum(TIPO_VALUES).optional().describe("Para traer solo un tipo de recurso."),
    etiqueta: z.string().min(1).max(40).optional().describe("Para traer solo los que tienen esta etiqueta (por ejemplo: testimonios)."),
  })
  .strict();
const listConfigSchema = z.object({});

export const listarRecursosTool: AgentToolDefinition<z.infer<typeof listInputSchema>, z.infer<typeof listConfigSchema>> = {
  name: "listar_recursos",
  label: "Ver los recursos disponibles",
  description:
    "Lista los recursos de la banca que podes usar en esta conversacion: textos, audios, videos, imagenes, archivos y enlaces, con para que sirve cada uno y su contenido, transcripcion o direccion. Podes filtrar por tipo y por etiqueta para no traer de mas. Usala antes de usar_recurso para elegir el correcto por su id.",
  inputSchema: listInputSchema,
  configSchema: listConfigSchema,
  configFields: [],
  async execute({ input, ctx }) {
    const assets = await loadEligibleAssets(ctx.supabase, ctx.workspaceId, ctx.channelId, {
      kind: input.tipo ? KIND_FROM_TIPO[input.tipo] : undefined,
      tag: input.etiqueta,
    });
    if (assets.length === 0) {
      const filtro = input.tipo || input.etiqueta ? " con ese filtro" : "";
      return { ok: true, forModel: `No hay recursos disponibles para usar${filtro}.` };
    }
    const listado = assets.map((a) => ({
      id: a.id,
      tipo: TIPO[a.kind],
      nombre: a.name,
      para_que_sirve: a.description,
      etiquetas: a.tags,
      ...(a.kind === "text" ? { texto: a.content } : {}),
      ...((a.kind === "audio" || a.kind === "video") && a.transcript_status === "ready" ? { transcripcion: a.transcript } : {}),
      ...(a.kind === "video" && a.transcript_status === "none" ? { sin_voz: true } : {}),
      ...(a.kind === "link" ? { url: a.url } : {}),
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

const MEDIA_NOUN: Record<MediaAssetKind, string> = {
  audio: "el audio",
  video: "el video",
  image: "la imagen",
  file: "el archivo",
};

export const usarRecursoTool: AgentToolDefinition<z.infer<typeof useInputSchema>, z.infer<typeof useConfigSchema>> = {
  name: "usar_recurso",
  label: "Usar un recurso de la banca",
  description:
    "Usa un recurso de la banca. Un texto te lo devuelve ya listo para que lo digas como tu respuesta; un enlace te devuelve la direccion para que la incluyas. Un audio, video, imagen o archivo se manda al lead DESPUES de tu respuesta de texto, como un mensaje real (uno solo por respuesta) -- no describas su contenido como si ya lo hubieras mandado. Usa listar_recursos primero para saber que id pasar.",
  inputSchema: useInputSchema,
  configSchema: useConfigSchema,
  configFields: [],
  auditAction: "agent_asset_sent",
  // No usa `deferInDraft` (sincronico): necesita leer la base para saber si
  // el recurso sigue habilitado y traer su archivo. Ver `defersInDraftAsync`.
  // Las ramas de texto y enlace no difieren nada: devolver texto es una
  // lectura, y en borrador cae en el texto propuesto como cualquier otra
  // salida del modelo.
  defersInDraftAsync: true,
  async execute({ input, ctx }) {
    const assets = await loadEligibleAssets(ctx.supabase, ctx.workspaceId, ctx.channelId);
    const asset = assets.find((a) => a.id === input.recurso_id);
    if (!asset) {
      return {
        ok: false,
        forModel: "Ese recurso no existe o no esta disponible para vos en esta conversacion. Usa listar_recursos para ver los que podes usar.",
      };
    }

    if (asset.kind === "text" || asset.kind === "link") {
      let forModel: string;
      if (asset.kind === "text") {
        // La interpolacion la hace la herramienta, con los datos reales del
        // contacto y del negocio: el modelo no tiene por que adivinar que va
        // en {{contact.display_name}}.
        const contact = ctx.contactId
          ? (await ctx.supabase.from("contacts").select("display_name, email, phone").eq("id", ctx.contactId).maybeSingle()).data
          : null;
        const workspace = (await ctx.supabase.from("workspaces").select("name").eq("id", ctx.workspaceId).maybeSingle()).data;
        const texto = interpolateTemplate(asset.content ?? "", { contact, workspace });
        forModel = `Usa este texto como tu respuesta (ya tiene sus variables resueltas): "${texto}"`;
      } else {
        forModel = `Inclui este enlace en tu respuesta, tal cual: ${asset.url}`;
      }
      // En modo envio la respuesta sale en este turno: cuenta como uso. En
      // borrador todavia no salio nada.
      if (ctx.mode !== "draft") await touchAssetUsage(ctx.supabase, asset.id);
      return { ok: true, forModel, detail: { recurso_id: asset.id, nombre: asset.name } };
    }

    const kind = asset.kind as MediaAssetKind;
    const memoMap = ctx.turn?.memo ?? new Map<string, unknown>();
    const already = memoMap.get(ASSET_SEND_MEMO_KEY) as AssetSendMemo | undefined;
    if (already) {
      return {
        ok: false,
        forModel: `Ya tenes ${MEDIA_NOUN[already.kind ?? "audio"]} "${already.name}" en cola para este turno. Solo se puede mandar uno por respuesta.`,
      };
    }

    const memo: AssetSendMemo = {
      assetId: asset.id,
      kind,
      name: asset.name,
      storagePath: asset.storage_path as string,
      mimeType: asset.mime_type as string,
      durationSeconds: asset.duration_seconds,
      transcript: asset.transcript_status === "ready" ? asset.transcript : null,
      caption: asset.caption,
    };

    if (ctx.mode === "draft") {
      return {
        ok: true,
        forModel: `Anotado como sugerencia: ${MEDIA_NOUN[kind]} "${asset.name}" se manda si la persona que revisa aprueba tu respuesta. Segui como corresponda.`,
        detail: { recurso_id: asset.id, nombre: asset.name },
        // No se audita en modo borrador: todavia no paso nada de verdad. Se
        // registra recien al aprobar (applySuggestions, lib/agent/drafts/actions.ts).
        suggestion: {
          type: "send_asset",
          assetId: asset.id,
          kind,
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
      forModel: `Listo: ${MEDIA_NOUN[kind]} "${asset.name}" se manda despues de tu respuesta de texto.`,
      detail: { recurso_id: asset.id, nombre: asset.name },
    };
  },
};
