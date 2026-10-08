/**
 * Que puede mandar cada canal, por tipo de recurso (banca v2, F10).
 *
 * Es el UNICO lugar que decide esto. Lo consultan el widget de la bandeja
 * (para deshabilitar un tipo con su motivo), la API de envio manual (para
 * rechazar lo que llegue igual) y el agente (para no ofrecerle lo que el
 * canal no puede mandar). Si cada uno chequeara por su cuenta, la bandeja
 * terminaria mintiendo sobre que se puede mandar.
 *
 * La matriz:
 *
 *   | canal                 | texto | enlace | imagen | video | audio          | archivo |
 *   |-----------------------|-------|--------|--------|-------|----------------|---------|
 *   | email (resend)        |  si   |   si   |   no   |  no   |  no            |   no    |
 *   | WhatsApp (evolution)  |  si   |   si   |   si   |  si   |  si            |   si    |
 *   | Instagram (zernio)    |  si   |   si   |   si   |  si   | segun formato  |   no    |
 *
 *  - **Email**: `sendViaResendChannel` (lib/flow-engine/send.ts) manda solo el
 *    texto e IGNORA `message.media` sin avisar. Dejar pasar un archivo manda
 *    un email sin el archivo y deja una fila mintiendo que salio.
 *  - **Instagram, audio**: segun `instagramAcceptsAudio` (rechaza ogg/opus,
 *    webm y mp3).
 *  - **Instagram, archivo**: los tipos de `@zernio/node` 0.2.519 aceptan
 *    `attachmentType: 'file'` sin restriccion por plataforma, pero su JSDoc
 *    dice "varies by platform" y nada confirma que Instagram entregue un PDF
 *    por DM. Ante la duda no se manda: no se intenta y se ve.
 *
 * La rama por proveedor es EXPLICITA, nunca un `else`: un canal nuevo que
 * cayera por default mandaria el recurso al lugar equivocado sin avisar. Un
 * proveedor desconocido acepta solo lo que es texto (texto y enlace).
 */

import { INSTAGRAM_AUDIO_REJECTED_MESSAGE, instagramAcceptsAudio } from "@/lib/audio/recording";
import type { AssetKind } from "@/lib/response-assets/kind";

export type ChannelAcceptance = { ok: true } | { ok: false; reason: string };

const OK: ChannelAcceptance = { ok: true };
const no = (reason: string): ChannelAcceptance => ({ ok: false, reason });

/**
 * Si este canal puede mandar un recurso de este tipo.
 *
 * `mime` afina la respuesta cuando se conoce (un audio en Instagram depende
 * del formato). Sin `mime` (por ejemplo, para habilitar o no el chip de un
 * tipo entero), se responde por el tipo.
 */
export function channelAccepts(
  provider: string | null | undefined,
  kind: AssetKind,
  mime?: string | null,
): ChannelAcceptance {
  // Un texto o un enlace es texto: lo acepta cualquier canal, email incluido.
  if (kind === "text" || kind === "link") return OK;

  switch (provider) {
    case "evolution":
      return OK;

    case "resend":
      return no("El email no admite adjuntos todavía: mandá un texto o un enlace.");

    case "zernio":
      switch (kind) {
        case "image":
        case "video":
          return OK;
        case "audio":
          if (mime === undefined) return OK;
          return instagramAcceptsAudio(mime) ? OK : no(INSTAGRAM_AUDIO_REJECTED_MESSAGE);
        case "file":
          return no("Instagram no acepta archivos. Mandalo por WhatsApp o compartilo como enlace.");
      }
      return no("Instagram no acepta este tipo de recurso.");

    default:
      return no("No sé qué acepta este canal, así que no ofrezco nada con archivo.");
  }
}

/** Si el canal acepta ALGUN archivo. Para lo que antes preguntaba "acepta media". */
export function channelAcceptsAnyFile(provider: string | null | undefined): boolean {
  return (["audio", "video", "image", "file"] as const).some((kind) => channelAccepts(provider, kind).ok);
}

/** El tipo de recurso que corresponde a un adjunto saliente de la bandeja. */
export function assetKindForAttachment(kind: "audio" | "voice" | "image" | "video" | "document"): AssetKind {
  switch (kind) {
    case "audio":
    case "voice":
      return "audio";
    case "image":
      return "image";
    case "video":
      return "video";
    case "document":
      return "file";
  }
}

/** Los tipos que este canal NO acepta, con el motivo: el widget los deshabilita. */
export function rejectedKinds(provider: string | null | undefined): Partial<Record<AssetKind, string>> {
  const out: Partial<Record<AssetKind, string>> = {};
  for (const kind of ["text", "audio", "video", "image", "file", "link"] as const) {
    const result = channelAccepts(provider, kind);
    if (!result.ok) out[kind] = result.reason;
  }
  return out;
}
