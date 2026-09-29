/**
 * Pasar un audio a texto (F6).
 *
 * **Es la unica puerta.** Ni el job, ni la bandeja, ni el agente saben quien
 * transcribe: piden `transcribeAudio` y reciben texto o un motivo. Adentro hay
 * un `switch` (`buildTranscriber`), hermano de `buildModel` en
 * `lib/ai/provider.ts`, asi que sumar un proveedor —o un gateway el dia de
 * mañana— es un `case` mas y una fila en el catalogo, sin tocar nada de lo que
 * lo usa.
 *
 * Principal Groq, respaldo OpenAI. El porque, corto: Groq cuesta US$ 0,04 la
 * hora de audio contra US$ 0,36 de OpenAI, y el respaldo usa la clave que el
 * workspace ya tiene, asi que no agrega costo fijo y evita que una caida deje
 * al agente sordo. Solo se cae al respaldo por algo transitorio (429, 5xx,
 * red): una key rechazada no mejora reintentando con otro proveedor.
 *
 * **Nunca lanza.** Devuelve `{ok:true, ...}` o `{ok:false, code, message,
 * retryable}`. Quien llama decide si reintentar; el job usa `retryable` para
 * elegir entre relanzar (y gastar un intento de la cola) o guardar el motivo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { readSecret, SECRET_NAMES, type SecretName } from "@/lib/vault";
import { getProvider } from "@/lib/integrations/providers";
import { openAiRun } from "./run";

type Db = SupabaseClient<Database>;

/** El techo del proveedor. Un archivo mas grande no se manda: devuelve 413. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Idioma fijo. Los leads escriben y hablan en español. */
const LANGUAGE = "es";

const REQUEST_TIMEOUT_MS = 120_000;

export type TranscribeErrorCode =
  | "NO_PROVIDER"
  | "FILE_TOO_LARGE"
  | "EMPTY_AUDIO"
  | "INVALID_AUDIO"
  | "REJECTED_KEY"
  | "RATE_LIMITED"
  | "PROVIDER_DOWN"
  | "NETWORK"
  | "READ_FAILED"
  | "UNKNOWN";

export type TranscribeResult =
  | {
      ok: true;
      text: string;
      /** Duracion que reporto el proveedor. Es lo que cobra. */
      durationSeconds: number | null;
      provider: string;
      model: string;
    }
  | {
      ok: false;
      code: TranscribeErrorCode;
      /** Para mostrar en la bandeja: en castellano, sin jerga ni codigos. */
      message: string;
      /** Si vale la pena reintentar mas tarde. */
      retryable: boolean;
    };

/**
 * El nombre de archivo que se le manda al proveedor, reconstruido DESDE EL MIME.
 *
 * No se usa el nombre original a proposito: WhatsApp manda nombres inventados
 * ("PTT-20260928-WA0003.opus" para un ogg, o directamente ninguno), y el
 * proveedor decide el formato por la extension. Si no coincide con los bytes,
 * responde 400 y la transcripcion falla por algo que no tiene nada que ver con
 * el audio. Es el 400 clasico de este endpoint.
 */
export function audioFilenameForMime(mime: string | null | undefined): string {
  const clean = (mime ?? "").split(";")[0].trim().toLowerCase();
  switch (clean) {
    case "audio/ogg":
    case "audio/opus":
      return "audio.ogg";
    case "audio/mp4":
    case "audio/x-m4a":
    case "audio/m4a":
    case "audio/aac":
      return "audio.m4a";
    case "audio/webm":
      return "audio.webm";
    case "audio/mpeg":
    case "audio/mp3":
      return "audio.mp3";
    case "audio/wav":
    case "audio/x-wav":
      return "audio.wav";
    case "audio/flac":
      return "audio.flac";
    default:
      // m4a como respaldo: es el formato que mas aceptan los proveedores.
      return "audio.m4a";
  }
}

/** Si un kind de adjunto se transcribe. */
export function isTranscribableMime(mime: string | null | undefined): boolean {
  const clean = (mime ?? "").split(";")[0].trim().toLowerCase();
  return clean.startsWith("audio/");
}

interface TranscriberInput {
  bytes: Uint8Array;
  mime: string | null;
  fetchImpl: typeof fetch;
}

interface TranscriberOutput {
  text: string;
  durationSeconds: number | null;
}

/** Lo que devuelve un intento contra un proveedor. */
type AttemptResult =
  | { ok: true; value: TranscriberOutput }
  | { ok: false; code: TranscribeErrorCode; message: string; retryable: boolean };

/**
 * Los endpoints de cada proveedor.
 *
 * Los dos hablan la misma API (la de OpenAI), asi que comparten el armado del
 * cuerpo. Se dejan como dos `case` igual: el dia que uno cambie, cambia solo
 * ese.
 */
function endpointFor(provider: string): string | null {
  switch (provider) {
    case "groq":
      return "https://api.groq.com/openai/v1/audio/transcriptions";
    case "openai":
      return "https://api.openai.com/v1/audio/transcriptions";
    default:
      return null;
  }
}

/** El transcriptor de un proveedor. `buildModel` de `provider.ts`, en audio. */
export function buildTranscriber(
  provider: string,
  apiKey: string,
  model: string,
): ((input: TranscriberInput) => Promise<AttemptResult>) | null {
  const url = endpointFor(provider);
  if (!url) return null;

  return async ({ bytes, mime, fetchImpl }) => {
    const form = new FormData();
    // La extension se reconstruye del mime: ver audioFilenameForMime.
    form.append(
      "file",
      new Blob([bytes as unknown as BlobPart], { type: mime ?? "application/octet-stream" }),
      audioFilenameForMime(mime),
    );
    form.append("model", model);
    form.append("language", LANGUAGE);
    // verbose_json trae la duracion, que es lo que cobra el proveedor.
    form.append("response_format", "verbose_json");

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // La key nunca se loguea, y el mensaje del error de red tampoco aporta.
      return {
        ok: false,
        code: "NETWORK",
        message: "No pudimos contactar al servicio de transcripción.",
        retryable: true,
      };
    }

    if (!response.ok) return classifyStatus(response.status);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        ok: false,
        code: "UNKNOWN",
        message: "El servicio de transcripción respondió algo que no pudimos leer.",
        retryable: true,
      };
    }

    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const text = typeof record.text === "string" ? record.text.trim() : "";
    const duration = typeof record.duration === "number" && Number.isFinite(record.duration) ? record.duration : null;

    if (text.length === 0) {
      // Un audio sin palabras (ruido, un toque sin querer) no es un fallo del
      // sistema, pero tampoco hay nada que el agente pueda leer.
      return {
        ok: false,
        code: "EMPTY_AUDIO",
        message: "El audio no tiene nada que se pueda transcribir.",
        retryable: false,
      };
    }

    return { ok: true, value: { text, durationSeconds: duration } };
  };
}

/** Que significa cada estado del proveedor. */
function classifyStatus(status: number): AttemptResult {
  if (status === 401 || status === 403) {
    return {
      ok: false,
      code: "REJECTED_KEY",
      // Reintentar no arregla una key rechazada: hay que cargar otra.
      message: "El servicio de transcripción rechazó la clave. Revisá la integración en Ajustes.",
      retryable: false,
    };
  }
  if (status === 413) {
    return { ok: false, code: "FILE_TOO_LARGE", message: "El audio es demasiado grande.", retryable: false };
  }
  if (status === 400 || status === 415 || status === 422) {
    return {
      ok: false,
      code: "INVALID_AUDIO",
      message: "El servicio de transcripción no pudo abrir este audio.",
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      message: "El servicio de transcripción está saturado.",
      retryable: true,
    };
  }
  return {
    ok: false,
    code: "PROVIDER_DOWN",
    message: "El servicio de transcripción no está disponible en este momento.",
    retryable: true,
  };
}

/** Un proveedor conectado, listo para usar. */
interface ConnectedProvider {
  provider: string;
  model: string;
  apiKey: string;
}

const DEFAULT_MODELS: Record<string, string> = {
  groq: "whisper-large-v3-turbo",
  openai: "whisper-1",
};

/**
 * Los proveedores de transcripcion conectados, en orden de preferencia.
 *
 * Groq primero por precio. OpenAI despues, con la clave que el workspace ya
 * tiene para el agente: es el respaldo mas barato posible, porque no agrega
 * ninguna cuenta nueva.
 */
async function connectedProviders(supabase: Db, workspaceId: string): Promise<ConnectedProvider[]> {
  const { data, error } = await supabase
    .from("integration_configs")
    .select("provider, vault_secret_name, config")
    .eq("workspace_id", workspaceId)
    .eq("type", "ai_provider")
    .eq("is_active", true)
    .in("provider", ["groq", "openai"]);

  if (error) {
    console.error("[transcribe] no pude leer las integraciones de IA:", error.message);
    return [];
  }

  const rows = data ?? [];
  const found: ConnectedProvider[] = [];

  for (const provider of ["groq", "openai"]) {
    const row = rows.find((r) => r.provider === provider);
    if (!row) continue;

    const definition = getProvider(provider);
    const secretName = (row.vault_secret_name ??
      definition?.secretName ??
      (provider === "groq" ? SECRET_NAMES.groqApiKey : SECRET_NAMES.openaiApiKey)) as SecretName;

    let apiKey: string | null = null;
    try {
      apiKey = await readSecret(supabase, workspaceId, secretName);
    } catch {
      // readSecret ya logueo el motivo, sin el valor.
      continue;
    }
    if (!apiKey) continue;

    const config = (row.config ?? {}) as Record<string, unknown>;
    const configured = typeof config.transcription_model === "string" ? config.transcription_model : null;

    found.push({ provider, model: configured || DEFAULT_MODELS[provider], apiKey });
  }

  return found;
}

export interface TranscribeAudioArgs {
  supabase: Db;
  workspaceId: string;
  bytes: Uint8Array;
  mime: string | null;
  /** Para atar el run a algo: el id del mensaje o del audio de la banca. */
  threadId?: string | null;
  conversationId?: string | null;
  fetchImpl?: typeof fetch;
}

/**
 * Transcribe un audio. Nunca lanza.
 *
 * Registra el consumo con un run (`source: "audio_transcription"`), que congela
 * el costo por SEGUNDOS de audio, que es como cobra el proveedor. Si registrar
 * falla, se loguea y se sigue: nunca se tira una transcripcion que ya se pago.
 */
export async function transcribeAudio(args: TranscribeAudioArgs): Promise<TranscribeResult> {
  const fetchImpl = args.fetchImpl ?? fetch;

  if (args.bytes.byteLength === 0) {
    return { ok: false, code: "EMPTY_AUDIO", message: "El archivo de audio está vacío.", retryable: false };
  }

  // El tamano se chequea ANTES de llamar: mandar 30 MB para que el proveedor
  // devuelva 413 es pagar el ancho de banda de un error conocido.
  if (args.bytes.byteLength > MAX_AUDIO_BYTES) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: "El audio supera el máximo de 25 MB que acepta la transcripción.",
      retryable: false,
    };
  }

  const providers = await connectedProviders(args.supabase, args.workspaceId);

  if (providers.length === 0) {
    return {
      ok: false,
      code: "NO_PROVIDER",
      message:
        "No hay ningún servicio de transcripción conectado. Se conecta en Ajustes > Integraciones (Groq).",
      retryable: false,
    };
  }

  let last: Extract<AttemptResult, { ok: false }> | null = null;

  for (const [index, candidate] of providers.entries()) {
    const transcriber = buildTranscriber(candidate.provider, candidate.apiKey, candidate.model);
    if (!transcriber) continue;

    const attempt = await transcriber({ bytes: args.bytes, mime: args.mime, fetchImpl });

    if (attempt.ok) {
      await recordUsage(args, candidate, attempt.value, index > 0);
      return {
        ok: true,
        text: attempt.value.text,
        durationSeconds: attempt.value.durationSeconds,
        provider: candidate.provider,
        model: candidate.model,
      };
    }

    last = attempt;

    // Solo se cae al respaldo por algo transitorio. Una key rechazada o un
    // audio que no se puede abrir no mejoran con otro proveedor: probar seria
    // gastar una llamada para recibir el mismo error.
    if (!attempt.retryable) break;
  }

  return {
    ok: false,
    code: last?.code ?? "UNKNOWN",
    message: last?.message ?? "No pudimos transcribir el audio.",
    retryable: last?.retryable ?? true,
  };
}

/** El run con el consumo. Un fallo al registrar no tira la transcripcion. */
async function recordUsage(
  args: TranscribeAudioArgs,
  candidate: ConnectedProvider,
  output: TranscriberOutput,
  usedFallback: boolean,
): Promise<void> {
  try {
    const run = await openAiRun(args.supabase, {
      workspaceId: args.workspaceId,
      source: "audio_transcription",
      trigger: "job",
      threadId: args.threadId ?? null,
      conversationId: args.conversationId ?? null,
      provider: candidate.provider,
      model: candidate.model,
    });

    run.setModel(candidate.provider, candidate.model);
    if (output.durationSeconds !== null) {
      run.addAudioUsage({
        provider: candidate.provider,
        model: candidate.model,
        seconds: output.durationSeconds,
      });
    }

    // NUNCA el texto: es contenido del lead y no se loguea ni se guarda en el
    // run. El run mide consumo, no contenido.
    await run.close({
      status: "responded",
      statusDetail: usedFallback ? "fallback" : null,
    });
  } catch (err) {
    console.error(
      "[transcribe] no pude registrar el consumo:",
      err instanceof Error ? err.message : "error desconocido",
    );
  }
}
