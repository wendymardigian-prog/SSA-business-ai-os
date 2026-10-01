import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { AgentToolDefinition } from "./types";

/**
 * listar_audios y enviar_audio: la banca de audios desde el agente (F22).
 *
 * Que un audio exista no alcanza para que el agente lo use: tiene que estar
 * habilitado para el agente (el toggle "Asistente" de /dashboard/settings/audios)
 * Y con la transcripcion lista. Las dos herramientas comparten ese filtro
 * (audioEligibleQuery) para no desalinearse.
 *
 * No hay un multiselect de "que audios puede usar este agente": el toggle de
 * la banca YA es ese interruptor. Agregar uno segundo en la pestana de
 * Herramientas duplicaria el control sin sumar nada (ver docs/PENDIENTE.md).
 *
 * enviar_audio NO manda nada ella misma: deja el audio anotado en turn.memo
 * (mismo patron que generar_link_whatsapp con el link) y el runner lo manda
 * DESPUES del texto de la respuesta, por sendChannelMessage
 * (lib/agent/send-audio.ts). En modo borrador (deferInDraft) ni siquiera lo
 * anota: queda como sugerencia para que la bandeja la muestre con su
 * reproductor y se mande recien al aprobar.
 */

type Db = SupabaseClient<Database>;

/** Clave en la memoria del turno: el audio que enviar_audio dejo listo para mandar. */
export const AUDIO_SEND_MEMO_KEY = "audio_asset_send";

export interface AudioSendMemo {
  audioAssetId: string;
  name: string;
  storagePath: string;
  mimeType: string;
  durationSeconds: number | null;
  transcript: string;
}

interface EligibleAudioRow {
  id: string;
  name: string;
  description: string;
  shortcut: string | null;
  storage_path: string;
  mime_type: string;
  duration_seconds: number | null;
  transcript: string | null;
}

/** Los audios que el agente puede usar: habilitados, activos, con transcripcion lista. */
async function loadEligibleAudios(supabase: Db, workspaceId: string): Promise<EligibleAudioRow[]> {
  const { data, error } = await supabase
    .from("audio_assets")
    .select("id, name, description, shortcut, storage_path, mime_type, duration_seconds, transcript")
    .eq("workspace_id", workspaceId)
    .eq("agent_enabled", true)
    .eq("is_active", true)
    .eq("transcript_status", "ready")
    .is("deleted_at", null)
    .order("name");
  if (error) {
    console.error("[agent-tools/audio] no pude leer la banca:", error.message);
    return [];
  }
  return (data ?? []).filter((a): a is EligibleAudioRow => typeof a.transcript === "string" && a.transcript.length > 0);
}

const listInputSchema = z.object({}).strict();
const listConfigSchema = z.object({});

export const listarAudiosTool: AgentToolDefinition<z.infer<typeof listInputSchema>, z.infer<typeof listConfigSchema>> = {
  name: "listar_audios",
  label: "Ver los audios disponibles",
  description:
    "Lista los audios de la banca que podes mandar: nombre, para que sirve cada uno y su transcripcion. Usala antes de enviar_audio para elegir el correcto por su id.",
  inputSchema: listInputSchema,
  configSchema: listConfigSchema,
  configFields: [],
  async execute({ ctx }) {
    const audios = await loadEligibleAudios(ctx.supabase, ctx.workspaceId);
    if (audios.length === 0) {
      return { ok: true, forModel: "No hay audios disponibles para mandar." };
    }
    const listado = audios.map((a) => ({
      id: a.id,
      nombre: a.name,
      para_que_sirve: a.description,
      transcripcion: a.transcript,
    }));
    return { ok: true, forModel: JSON.stringify(listado), detail: { cantidad: audios.length } };
  },
};

const sendInputSchema = z
  .object({
    audio_id: z.string().min(1).describe("El id del audio a mandar, tal como lo devolvio listar_audios."),
  })
  .strict();
const sendConfigSchema = z.object({});

export const enviarAudioTool: AgentToolDefinition<z.infer<typeof sendInputSchema>, z.infer<typeof sendConfigSchema>> = {
  name: "enviar_audio",
  label: "Mandar un audio de la banca",
  description:
    "Manda un audio de la banca al lead, DESPUES de tu respuesta de texto. No describas el contenido del audio como si ya lo hubieras mandado: el lead lo recibe aparte, como un mensaje de audio real. Usa listar_audios primero para saber que id pasar.",
  inputSchema: sendInputSchema,
  configSchema: sendConfigSchema,
  configFields: [],
  auditAction: "agent_audio_sent",
  // No usa `deferInDraft` (sincronico): necesita leer la base para saber si
  // el audio sigue habilitado y traer su archivo. Ver `defersInDraftAsync`.
  defersInDraftAsync: true,
  async execute({ input, ctx }) {
    const memoMap = ctx.turn?.memo ?? new Map<string, unknown>();
    const already = memoMap.get(AUDIO_SEND_MEMO_KEY) as AudioSendMemo | undefined;
    if (already) {
      return {
        ok: false,
        forModel: `Ya tenes el audio "${already.name}" en cola para este turno. Solo se puede mandar uno por respuesta.`,
      };
    }

    const audios = await loadEligibleAudios(ctx.supabase, ctx.workspaceId);
    const audio = audios.find((a) => a.id === input.audio_id);
    if (!audio) {
      return {
        ok: false,
        forModel: "Ese audio no existe o no esta disponible para vos ahora mismo. Usa listar_audios para ver los que podes mandar.",
      };
    }

    const memo: AudioSendMemo = {
      audioAssetId: audio.id,
      name: audio.name,
      storagePath: audio.storage_path,
      mimeType: audio.mime_type,
      durationSeconds: audio.duration_seconds,
      transcript: audio.transcript as string,
    };

    if (ctx.mode === "draft") {
      return {
        ok: true,
        forModel: `Anotado como sugerencia: el audio "${audio.name}" se manda si la persona que revisa aprueba tu respuesta. Segui como corresponda.`,
        detail: { audio_id: audio.id, nombre: audio.name },
        // No se audita en modo borrador: todavia no paso nada de verdad. Se
        // registra recien al aprobar (applySuggestions, lib/agent/drafts/actions.ts).
        suggestion: {
          type: "send_audio",
          audioAssetId: audio.id,
          name: audio.name,
          storagePath: audio.storage_path,
          mimeType: audio.mime_type,
          durationSeconds: audio.duration_seconds,
        },
      };
    }

    memoMap.set(AUDIO_SEND_MEMO_KEY, memo);
    return {
      ok: true,
      forModel: `Listo: el audio "${audio.name}" se manda despues de tu respuesta de texto.`,
      detail: { audio_id: audio.id, nombre: audio.name },
    };
  },
};
