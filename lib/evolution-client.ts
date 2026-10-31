/**
 * Cliente de Evolution API (WhatsApp por Baileys).
 *
 * Evolution corre como servicio aparte (Railway). Este modulo es lo unico que
 * le habla: crear la instancia, pedir el QR, consultar el estado, mandar
 * mensajes y desconectar.
 *
 * Sobre v1 vs v2: los endpoints tienen el mismo nombre pero cambian los cuerpos
 * (sendText, webhook) y algunas respuestas. En vez de pedirle al usuario que
 * sepa que version corre, el cliente lo averigua una vez con GET / y adapta.
 *
 * La instancia de Evolution puede estar compartida con otro sistema, asi que:
 * - Cada instancia que crea este proyecto lleva el prefijo EVOLUTION_INSTANCE_PREFIX.
 * - Nunca se toca configuracion a nivel servidor ni instancias ajenas.
 */

import { toEvolutionNumber } from "@/lib/phone";

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 400;
const REQUEST_TIMEOUT_MS = 20_000;

export class EvolutionError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "EvolutionError";
  }
}

export interface EvolutionConfig {
  baseUrl: string;
  apiKey: string;
  instancePrefix: string;
}

// La configuracion ya no se lee aca: vive en lib/evolution-config.ts, que la
// arma por workspace (Vault + integration_configs) con las variables de entorno
// como respaldo (F4). Este archivo quedo con el transporte y las operaciones,
// que es lo que hace: hablar con el servidor de Evolution.

/** Nombre de instancia propio de este proyecto, para no chocar con otros sistemas. */
export function instanceNameFor(config: EvolutionConfig, workspaceId: string): string {
  return `${config.instancePrefix}-${workspaceId.slice(0, 8)}`;
}

export interface QrCode {
  /** Imagen del QR lista para <img src>. */
  base64: string | null;
  /** Codigo crudo, por si se quiere renderizar el QR del lado del cliente. */
  code: string | null;
  /** Codigo de vinculacion por numero, cuando Evolution lo ofrece. */
  pairingCode: string | null;
}

export type EvolutionState = "open" | "close" | "connecting" | "unknown";

// ── Transporte ───────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 5xx y errores de red se reintentan; 4xx no, porque reintentar no los arregla. */
function isRetriable(status: number | undefined): boolean {
  return status === undefined || status >= 500 || status === 429;
}

/**
 * Lo que dijo Evolution en un error. La v2 lo anida: `{ status, error: "Forbidden", response: { message: [...] } }`;
 * otras versiones lo ponen arriba (`{ message }` o `{ error }`). Primero el texto concreto, despues el generico: si
 * se tomara `error` primero, un "ya existe" se leeria como un "Forbidden" a secas.
 */
function errorDetail(parsed: unknown): unknown {
  if (typeof parsed !== "object" || parsed === null) return parsed;
  const obj = parsed as { message?: unknown; error?: unknown; response?: { message?: unknown } | null };
  const nested = obj.response?.message;
  const pick = (v: unknown) => (Array.isArray(v) ? (v.length ? v.join("; ") : undefined) : v);
  return pick(obj.message) ?? pick(nested) ?? obj.error ?? parsed;
}

async function request<T>(
  config: EvolutionConfig,
  method: string,
  path: string,
  body?: unknown,
  opts: { attempts?: number } = {},
): Promise<T> {
  let lastError: EvolutionError | null = null;
  const maxAttempts = opts.attempts ?? MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${config.baseUrl}${path}`, {
        method,
        headers: {
          apikey: config.apiKey,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });

      const text = await res.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }

      if (!res.ok) {
        // El mensaje de Evolution se muestra al usuario; la apikey no viaja en
        // el cuerpo asi que no hay riesgo de filtrarla aca.
        const detail = errorDetail(parsed);
        const err = new EvolutionError(
          `Evolution API respondio ${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
          res.status,
          detail,
        );
        if (!isRetriable(res.status) || attempt === maxAttempts) throw err;
        lastError = err;
      } else {
        return parsed as T;
      }
    } catch (err) {
      if (err instanceof EvolutionError) {
        if (!isRetriable(err.status) || attempt === maxAttempts) throw err;
        lastError = err;
      } else {
        const wrapped = new EvolutionError(
          `No se pudo contactar a Evolution API: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (attempt === maxAttempts) throw wrapped;
        lastError = wrapped;
      }
    }

    await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
  }

  throw lastError ?? new EvolutionError("Evolution API no respondio");
}

// ── Version ──────────────────────────────────────────────────────────────────

const versionCache = new Map<string, 1 | 2>();

/**
 * 1 o 2 segun la version mayor que corre el servidor. GET / devuelve
 * { version: "2.1.1" } en v2 y { version: "1.7.4" } en v1. Ante la duda asume
 * v2, que es lo que se instala hoy.
 */
export async function getMajorVersion(config: EvolutionConfig): Promise<1 | 2> {
  const cached = versionCache.get(config.baseUrl);
  if (cached) return cached;

  let major: 1 | 2 = 2;
  try {
    const info = await request<{ version?: string }>(config, "GET", "/");
    const parsedMajor = Number.parseInt(info?.version?.split(".")[0] ?? "", 10);
    if (parsedMajor === 1) major = 1;
  } catch (err) {
    console.error("[evolution] no pude leer la version, asumo v2:", (err as Error).message);
  }

  versionCache.set(config.baseUrl, major);
  return major;
}

/** Solo para tests: olvida la version detectada. */
export function resetVersionCache(): void {
  versionCache.clear();
}

// ── Instancias ───────────────────────────────────────────────────────────────

interface RawInstance {
  instance?: { instanceName?: string; state?: string; status?: string; owner?: string };
  instanceName?: string;
  /** El JID del numero vinculado: v2 lo trae como `ownerJid`, v1 como `instance.owner`. */
  ownerJid?: string;
  owner?: string;
  number?: string;
  name?: string;
  connectionStatus?: string;
  state?: string;
  status?: string;
}

/** Normaliza el estado, que cambia de nombre y de lugar entre versiones. */
function readState(raw: RawInstance | null | undefined): EvolutionState {
  const value =
    raw?.instance?.state ??
    raw?.instance?.status ??
    raw?.connectionStatus ??
    raw?.state ??
    raw?.status;
  if (value === "open" || value === "close" || value === "connecting") return value;
  return "unknown";
}

/** Nombres de las instancias que ya existen en el servidor. Solo lectura. */
export async function listInstanceNames(config: EvolutionConfig): Promise<string[]> {
  const raw = await request<RawInstance[] | { instances?: RawInstance[] }>(
    config,
    "GET",
    "/instance/fetchInstances",
  );
  const list = Array.isArray(raw) ? raw : (raw?.instances ?? []);
  return list
    .map((i) => i.instance?.instanceName ?? i.instanceName ?? i.name)
    .filter((n): n is string => !!n);
}

/**
 * El JID del numero vinculado a una instancia ("5491122334455@s.whatsapp.net"), o null si todavia no escaneo el QR
 * o el servidor no lo informa. Solo lectura. Evolution cambia el lugar del dato entre versiones, asi que se lee en
 * los tres sitios conocidos.
 */
export async function fetchInstanceOwner(config: EvolutionConfig, instanceName: string): Promise<string | null> {
  const raw = await request<RawInstance[] | { instances?: RawInstance[] }>(
    config,
    "GET",
    `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
  );
  const list = Array.isArray(raw) ? raw : (raw?.instances ?? []);
  const item = list.find((i) => (i.instance?.instanceName ?? i.instanceName ?? i.name) === instanceName) ?? list[0];
  const owner = item?.ownerJid ?? item?.instance?.owner ?? item?.owner ?? item?.number ?? null;
  return typeof owner === "string" && owner ? owner : null;
}

/**
 * Si un error de /instance/create es "ese nombre ya esta en uso". La v2 lo dice como un 403 con el texto en
 * `response.message` (y `error: "Forbidden"` arriba): se mira el detalle Y el mensaje, que lo incluye.
 */
function isAlreadyExistsError(err: unknown): boolean {
  return (
    err instanceof EvolutionError &&
    (err.status === 403 || err.status === 409) &&
    /already in use|already exists|ya existe/i.test(`${JSON.stringify(err.detail ?? null)} ${err.message}`)
  );
}

/**
 * Crea la instancia si no existe. Idempotente: si Evolution contesta que ya
 * existe, se toma como exito, porque el estado que importa es "existe y es
 * nuestra", no "la cree yo en esta llamada".
 */
export async function createInstance(
  config: EvolutionConfig,
  instanceName: string,
  webhookUrl: string,
  webhookToken: string,
): Promise<void> {
  const major = await getMajorVersion(config);

  const body =
    major === 2
      ? {
          instanceName,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
        }
      : {
          instanceName,
          qrcode: true,
          token: undefined,
        };

  try {
    await request(config, "POST", "/instance/create", body);
  } catch (err) {
    if (!isAlreadyExistsError(err)) throw err;
  }

  // El webhook se configura aparte a proposito: asi la forma del cuerpo de
  // /instance/create no depende de la version, y reconfigurarlo (cambio de URL
  // al pasar a Railway) es una sola llamada.
  await setWebhook(config, instanceName, webhookUrl, webhookToken);
}

/**
 * Apunta el webhook de ESTA instancia a nuestra URL. No toca configuracion
 * global ni la de otras instancias.
 */
export async function setWebhook(
  config: EvolutionConfig,
  instanceName: string,
  url: string,
  token: string,
): Promise<void> {
  const major = await getMajorVersion(config);
  // CALL (00258): Evolution avisa cada llamada (no puede atenderlas). Una
  // instancia vieja lo recibe recien despues de volver a registrar el webhook.
  const events = ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED", "CALL"];

  // El token va como header porque el webhook queda expuesto en internet: es lo
  // unico que separa un evento real de cualquiera que descubra la URL.
  const headers = { "x-webhook-token": token };

  const body =
    major === 2
      ? { webhook: { enabled: true, url, byEvents: false, base64: false, headers, events } }
      : { enabled: true, url, webhook_by_events: false, webhook_base64: false, events };

  await request(config, "POST", `/webhook/set/${encodeURIComponent(instanceName)}`, body);
}

/**
 * QR para vincular el telefono. Si la instancia ya esta conectada, Evolution
 * no devuelve QR: eso se detecta con getConnectionState antes de llamar aca.
 */
export async function getQrCode(
  config: EvolutionConfig,
  instanceName: string,
): Promise<QrCode> {
  const raw = await request<{
    base64?: string;
    code?: string;
    pairingCode?: string;
    qrcode?: { base64?: string; code?: string; pairingCode?: string };
  }>(config, "GET", `/instance/connect/${encodeURIComponent(instanceName)}`);

  const qr = raw?.qrcode ?? raw ?? {};
  return {
    base64: qr.base64 ?? null,
    code: qr.code ?? null,
    pairingCode: qr.pairingCode ?? null,
  };
}

export async function getConnectionState(
  config: EvolutionConfig,
  instanceName: string,
): Promise<EvolutionState> {
  try {
    const raw = await request<RawInstance>(
      config,
      "GET",
      `/instance/connectionState/${encodeURIComponent(instanceName)}`,
    );
    return readState(raw);
  } catch (err) {
    // 404 = la instancia no existe (la borraron del lado de Evolution).
    if (err instanceof EvolutionError && err.status === 404) return "close";
    throw err;
  }
}

/**
 * Si la instancia existe en el servidor y en que estado esta. A diferencia de `getConnectionState`, un 404 NO se
 * disfraza de "close": reconectar necesita saber si hay algo a que conectarse o si hay que volver a crearla.
 */
export async function getInstanceStatus(
  config: EvolutionConfig,
  instanceName: string,
): Promise<{ exists: boolean; state: EvolutionState }> {
  try {
    const raw = await request<RawInstance>(
      config,
      "GET",
      `/instance/connectionState/${encodeURIComponent(instanceName)}`,
    );
    return { exists: true, state: readState(raw) };
  } catch (err) {
    if (err instanceof EvolutionError && err.status === 404) return { exists: false, state: "close" };
    throw err;
  }
}

/**
 * Reinicia la conexion de la instancia sin borrarla (v2 `POST`, v1 `PUT`). Un solo intento: se usa como paso de
 * mejor esfuerzo al reconectar, y un 500 repetido solo demoraria al siguiente paso.
 */
export async function restartInstance(config: EvolutionConfig, instanceName: string): Promise<void> {
  const major = await getMajorVersion(config);
  await request(
    config,
    major === 2 ? "POST" : "PUT",
    `/instance/restart/${encodeURIComponent(instanceName)}`,
    undefined,
    { attempts: 1 },
  );
}

/** El paso de la reconexion que dejo la instancia lista para escanear (o ya conectada). */
export type ReconnectStep = "created" | "open" | "connect" | "restart" | "logout" | "recreated";

/** Espera entre pedir un reinicio y volver a pedir el QR: Evolution tarda un poco en generar el codigo nuevo. */
const RECONNECT_SETTLE_MS = 2000;

/**
 * Reconecta un numero que ya existe: reusa SU instancia y nunca inventa un nombre nuevo. Solo "Conectar otro numero"
 * crea una instancia distinta.
 *
 * Va de lo mas suave a lo mas fuerte y corta apenas Evolution entrega un QR:
 *  1. Si la instancia no existe (la borraron del servidor) se crea con el MISMO nombre: no hay otra cosa a que conectarse.
 *  2. Si existe, se reconfigura el webhook; si ya esta abierta, listo.
 *  3. Se pide el QR (`/instance/connect`).
 *  4. Sin QR: se reinicia la conexion y se vuelve a pedir.
 *  5. Sin QR: se cierra la sesion (una instancia trabada en "connecting" despues de que vencio el QR) y se vuelve a pedir.
 *  6. Ultimo recurso: se borra y se crea de nuevo con el mismo nombre (el canal y sus conversaciones no cambian).
 *
 * Los pasos 4 y 5 son de mejor esfuerzo: si fallan, se sigue con el proximo. `sleepMs` es solo para los tests.
 */
export async function reconnectInstance(
  config: EvolutionConfig,
  instanceName: string,
  webhookUrl: string,
  webhookToken: string,
  sleepMs: (ms: number) => Promise<void> = sleep,
): Promise<ReconnectStep> {
  const status = await getInstanceStatus(config, instanceName);
  if (!status.exists) {
    await createInstance(config, instanceName, webhookUrl, webhookToken);
    return "created";
  }

  await setWebhook(config, instanceName, webhookUrl, webhookToken);
  if (status.state === "open") return "open";

  const hasQr = async () => {
    try {
      const qr = await getQrCode(config, instanceName);
      return !!(qr.base64 || qr.code || qr.pairingCode);
    } catch (err) {
      console.error("[evolution] reconectar: no pude pedir el QR:", (err as Error).message);
      return false;
    }
  };

  if (await hasQr()) return "connect";

  try {
    await restartInstance(config, instanceName);
    await sleepMs(RECONNECT_SETTLE_MS);
    if (await hasQr()) return "restart";
  } catch (err) {
    console.error("[evolution] reconectar: no pude reiniciar la instancia:", (err as Error).message);
  }

  try {
    await logoutInstance(config, instanceName, { attempts: 1 });
    await sleepMs(RECONNECT_SETTLE_MS);
    if (await hasQr()) return "logout";
  } catch (err) {
    console.error("[evolution] reconectar: no pude cerrar la sesion:", (err as Error).message);
  }

  await deleteInstance(config, instanceName);
  await createInstance(config, instanceName, webhookUrl, webhookToken);
  return "recreated";
}

/** Cierra la sesion de WhatsApp pero conserva la instancia, para reconectar por QR. */
export async function logoutInstance(
  config: EvolutionConfig,
  instanceName: string,
  opts: { attempts?: number } = {},
): Promise<void> {
  try {
    await request(config, "DELETE", `/instance/logout/${encodeURIComponent(instanceName)}`, undefined, opts);
  } catch (err) {
    // Ya estaba desconectada: el resultado buscado igual se cumple.
    if (err instanceof EvolutionError && (err.status === 404 || err.status === 400)) return;
    throw err;
  }
}

/** Borra la instancia del servidor. Solo para instancias con nuestro prefijo. */
export async function deleteInstance(
  config: EvolutionConfig,
  instanceName: string,
): Promise<void> {
  if (!instanceName.startsWith(`${config.instancePrefix}-`)) {
    throw new EvolutionError(
      `Me niego a borrar "${instanceName}": no lleva el prefijo de este proyecto (${config.instancePrefix}-). Puede ser de otro sistema.`,
    );
  }
  try {
    await request(config, "DELETE", `/instance/delete/${encodeURIComponent(instanceName)}`);
  } catch (err) {
    if (err instanceof EvolutionError && err.status === 404) return;
    throw err;
  }
}

// ── Mensajes ─────────────────────────────────────────────────────────────────

export interface SentMessage {
  /** Id del mensaje en WhatsApp, para guardarlo y no duplicarlo con el webhook. */
  id: string | null;
}

/**
 * Manda un texto. `to` puede ser un telefono o un JID entero.
 */
export async function sendText(
  config: EvolutionConfig,
  instanceName: string,
  to: string,
  text: string,
): Promise<SentMessage> {
  const number = toEvolutionNumber(to);
  if (!number) {
    throw new EvolutionError(`Numero de WhatsApp invalido: "${to}"`);
  }

  const major = await getMajorVersion(config);
  const body =
    major === 2
      ? { number, text }
      : { number, textMessage: { text } };

  const raw = await request<{ key?: { id?: string }; messageId?: string }>(
    config,
    "POST",
    `/message/sendText/${encodeURIComponent(instanceName)}`,
    body,
  );

  return { id: raw?.key?.id ?? raw?.messageId ?? null };
}

/**
 * Reacciona a un mensaje de WhatsApp con un emoji (A3). Un `reaction` vacio
 * QUITA la reaccion que habia.
 *
 * `messageId` es el id del mensaje en WhatsApp (el `key.id` que Evolution nos
 * dio en el webhook) y `fromMe` dice de quien es: false cuando se reacciona a
 * un mensaje del contacto. `remoteJid` se arma con el telefono del contacto.
 *
 * Como `sendText`, tiene dos formas segun la version de Evolution: la v2 recibe
 * `{ key, reaction }` y la v1, `{ reactionMessage: { key, reaction } }`.
 */
export async function sendReaction(
  config: EvolutionConfig,
  instanceName: string,
  args: { to: string; messageId: string; fromMe: boolean; reaction: string },
): Promise<void> {
  const number = toEvolutionNumber(args.to);
  if (!number) {
    throw new EvolutionError(`Numero de WhatsApp invalido: "${args.to}"`);
  }
  const key = { remoteJid: `${number}@s.whatsapp.net`, fromMe: args.fromMe, id: args.messageId };

  const major = await getMajorVersion(config);
  const body = major === 2 ? { key, reaction: args.reaction } : { reactionMessage: { key, reaction: args.reaction } };

  await request(config, "POST", `/message/sendReaction/${encodeURIComponent(instanceName)}`, body);
}

// ── Media ────────────────────────────────────────────────────────────────────

/** Lo que devuelve Evolution cuando se le pide el archivo de un mensaje. */
export interface MediaPayload {
  base64: string;
  mimetype: string | null;
  fileName: string | null;
  size: number | null;
}

/**
 * Pide el archivo de un mensaje de WhatsApp (F4).
 *
 * Hace falta porque la `url` que trae el nodo de Baileys es un `.enc` cifrado:
 * sin la `mediaKey` no se puede abrir, y la `mediaKey` no se guarda. Evolution
 * tiene la sesion de WhatsApp, asi que es el unico que puede descifrarlo, y lo
 * devuelve en base64.
 *
 * `convertToMp4: false` a proposito: no queremos que convierta nada. Un audio
 * convertido a mp4 pierde el `ptt` y deja de ser una nota de voz, y lo que
 * necesitamos para transcribir es el archivo tal como llego.
 *
 * Lanza `EvolutionError` como el resto del cliente (con sus tres reintentos y
 * su backoff). Devuelve null cuando Evolution contesta bien pero sin base64,
 * que pasa cuando la media ya se borro del servidor de WhatsApp.
 *
 * **`message` va completo, no `{key:{id}}` solo (F4, verificado en el codigo
 * fuente de la 2.3.7, §14c).** Con el objeto entero Evolution lo usa directo;
 * con la clave sola hace una busqueda en su propia base, que depende de que
 * Evolution haya persistido ese mensaje. Nuestro webhook ya recibe el objeto
 * completo en `data.message`, asi que pasarlo entero es gratis y evita esa
 * dependencia.
 */
export async function getBase64FromMediaMessage(
  config: EvolutionConfig,
  instanceName: string,
  message: Record<string, unknown>,
): Promise<MediaPayload | null> {
  // El contrato es el mismo en las dos versiones mayores (verificado), asi
  // que no hace falta ramificar por `getMajorVersion` como en `sendText`.
  const body = { message, convertToMp4: false };

  const raw = await request<{
    base64?: string;
    mimetype?: string;
    fileName?: string;
    size?: number | { fileLength?: number | string };
  }>(config, "POST", `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`, body);

  const base64 = typeof raw?.base64 === "string" ? raw.base64 : null;
  if (!base64 || base64.length === 0) return null;

  // `size` viene como numero en algunas versiones y como objeto en otras.
  const rawSize = raw?.size;
  const size =
    typeof rawSize === "number"
      ? rawSize
      : typeof rawSize === "object" && rawSize !== null
        ? Number(rawSize.fileLength ?? NaN)
        : NaN;

  return {
    base64,
    mimetype: typeof raw?.mimetype === "string" ? raw.mimetype : null,
    fileName: typeof raw?.fileName === "string" ? raw.fileName : null,
    size: Number.isFinite(size) ? size : null,
  };
}

// ── Envio de media (F19) ───────────────────────────────────────────────────

/**
 * Manda un audio como nota de voz nativa (F19, verificado en la 2.3.7, §14c).
 *
 * `audio` acepta una URL publica, base64 o un archivo multipart; mandamos una
 * URL firmada de nuestro bucket. `encoding: true` (el default) es lo que hace
 * que Evolution CONVIERTA lo que le mandemos a ogg/opus con su propio ffmpeg y
 * lo mande con `ptt: true`: por eso no importa en que formato grabo el
 * navegador, y no transcodificamos nada de nuestro lado.
 */
export async function sendWhatsAppAudio(
  config: EvolutionConfig,
  instanceName: string,
  to: string,
  audio: string,
): Promise<SentMessage> {
  const number = toEvolutionNumber(to);
  if (!number) {
    throw new EvolutionError(`Numero de WhatsApp invalido: "${to}"`);
  }

  const raw = await request<{ key?: { id?: string }; messageId?: string }>(
    config,
    "POST",
    `/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`,
    { number, audio, encoding: true },
  );

  return { id: raw?.key?.id ?? raw?.messageId ?? null };
}

export interface SendMediaArgs {
  /** URL publica (o firmada) del archivo, o base64. */
  media: string;
  mediatype: "image" | "video" | "document";
  mimetype?: string | null;
  caption?: string | null;
  /** Solo documentos: el nombre con el que WhatsApp lo muestra. */
  fileName?: string | null;
}

/**
 * Manda una imagen, video o documento (F19).
 *
 * El cuerpo exacto de `/message/sendMedia` no quedo verificado contra el
 * codigo fuente de la 2.3.7 como el resto de los contratos de esta fase (el
 * plano solo confirma "multipart o URL" para este endpoint, §14c): se usa el
 * contrato publicado de Evolution API v2 (`number`, `mediatype`, `media`,
 * ademas de `mimetype`/`caption`/`fileName` opcionales). Si en la verificacion
 * en vivo algun campo no coincide, es un ajuste de nombres aca adentro, no un
 * cambio de diseño.
 */
export async function sendMedia(
  config: EvolutionConfig,
  instanceName: string,
  to: string,
  args: SendMediaArgs,
): Promise<SentMessage> {
  const number = toEvolutionNumber(to);
  if (!number) {
    throw new EvolutionError(`Numero de WhatsApp invalido: "${to}"`);
  }

  const body: Record<string, unknown> = {
    number,
    mediatype: args.mediatype,
    media: args.media,
  };
  if (args.mimetype) body.mimetype = args.mimetype;
  if (args.caption) body.caption = args.caption;
  if (args.fileName) body.fileName = args.fileName;

  const raw = await request<{ key?: { id?: string }; messageId?: string }>(
    config,
    "POST",
    `/message/sendMedia/${encodeURIComponent(instanceName)}`,
    body,
  );

  return { id: raw?.key?.id ?? raw?.messageId ?? null };
}

/**
 * Manda un sticker (`POST /message/sendSticker/{instancia}`, Evolution v2).
 *
 * `sticker` es una URL o base64; Evolution lo pasa por sharp a webp (animado si
 * el webp ya lo es). Le mandamos el webp de 512 x 512 que ya dejamos listo
 * (lib/stickers/normalize.ts), asi lo que se vio en la biblioteca es lo que
 * llega. Verificado contra el codigo de la 2.3.7 (`mediaSticker`).
 */
export async function sendSticker(
  config: EvolutionConfig,
  instanceName: string,
  to: string,
  sticker: string,
): Promise<SentMessage> {
  const number = toEvolutionNumber(to);
  if (!number) {
    throw new EvolutionError(`Numero de WhatsApp invalido: "${to}"`);
  }

  const raw = await request<{ key?: { id?: string }; messageId?: string }>(
    config,
    "POST",
    `/message/sendSticker/${encodeURIComponent(instanceName)}`,
    { number, sticker },
  );

  return { id: raw?.key?.id ?? raw?.messageId ?? null };
}

// ── Ajustes de la instancia (llamadas) ─────────────────────────────────────

/** Los ajustes de una instancia de Evolution v2 (`/settings/find`). */
export interface InstanceSettings {
  rejectCall: boolean;
  msgCall: string;
  groupsIgnore: boolean;
  alwaysOnline: boolean;
  readMessages: boolean;
  readStatus: boolean;
  syncFullHistory: boolean;
}

function settingsFrom(raw: Record<string, unknown> | null | undefined): InstanceSettings {
  const r = raw ?? {};
  return {
    rejectCall: r.rejectCall === true,
    msgCall: typeof r.msgCall === "string" ? r.msgCall : "",
    groupsIgnore: r.groupsIgnore === true,
    alwaysOnline: r.alwaysOnline === true,
    readMessages: r.readMessages === true,
    readStatus: r.readStatus === true,
    syncFullHistory: r.syncFullHistory === true,
  };
}

/** Lee los ajustes de la instancia (rechazar llamadas, el mensaje, etc). */
export async function findInstanceSettings(config: EvolutionConfig, instanceName: string): Promise<InstanceSettings> {
  const raw = await request<Record<string, unknown> | null>(config, "GET", `/settings/find/${encodeURIComponent(instanceName)}`);
  return settingsFrom(raw);
}

/**
 * Cambia SOLO lo de las llamadas. `/settings/set` pide el objeto entero (los
 * booleanos son obligatorios), asi que se lee primero y se manda todo lo
 * demas como estaba: nunca se pisa otro ajuste de la instancia.
 */
export async function setCallSettings(
  config: EvolutionConfig,
  instanceName: string,
  patch: { rejectCall: boolean; msgCall: string },
): Promise<InstanceSettings> {
  const current = await findInstanceSettings(config, instanceName);
  const next: InstanceSettings = { ...current, rejectCall: patch.rejectCall, msgCall: patch.msgCall };
  await request(config, "POST", `/settings/set/${encodeURIComponent(instanceName)}`, next);
  return next;
}

// ── Avatares ─────────────────────────────────────────────────────────────────

/**
 * La foto de perfil de un contacto de WhatsApp (F16).
 *
 * `POST /chat/fetchProfilePictureUrl/{instance}` con `{ number }`. Se llama
 * SOLO cuando el contacto no tiene avatar o venció (shouldRefreshAvatar lo
 * decide), nunca en cada mensaje: es una consulta de mas por contacto, no por
 * mensaje.
 *
 * Devuelve null cuando Evolution contesta bien pero sin URL, que pasa en
 * algunas versiones de Baileys (perfil privado, sin foto, o simplemente no la
 * tiene cacheada todavia). No es un error: el contacto se queda con la
 * inicial hasta el proximo intento.
 */
export async function fetchProfilePictureUrl(
  config: EvolutionConfig,
  instanceName: string,
  to: string,
): Promise<string | null> {
  const number = toEvolutionNumber(to);
  if (!number) return null;

  const raw = await request<{ profilePictureUrl?: string; wuid?: string }>(
    config,
    "POST",
    `/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`,
    { number },
  );

  return typeof raw?.profilePictureUrl === "string" && raw.profilePictureUrl.length > 0
    ? raw.profilePictureUrl
    : null;
}

// ── Historial guardado en Evolution (revision, solo lectura) ───────────────────

/** Un chat como lo devuelve `POST /chat/findChats` (v2). Solo lo que se usa. */
export interface EvolutionStoredChat {
  remoteJid?: string | null;
  pushName?: string | null;
  updatedAt?: string | null;
  lastMessage?: { messageTimestamp?: number | string | null; key?: { fromMe?: boolean } | null } | null;
}

/**
 * Los chats que Evolution tiene guardados para una instancia, los mas recientes
 * primero. NO le pide nada a WhatsApp: lee la base del propio Evolution. `take`
 * acota cuantos (sin tope, la consulta no tiene limite).
 */
export async function findStoredChats(
  config: EvolutionConfig,
  instanceName: string,
  take: number,
): Promise<EvolutionStoredChat[]> {
  const raw = await request<unknown>(config, "POST", `/chat/findChats/${encodeURIComponent(instanceName)}`, {
    where: {},
    take,
    skip: 0,
  });
  return Array.isArray(raw) ? (raw as EvolutionStoredChat[]) : [];
}

/** Una pagina de `POST /chat/findMessages` (v2): `offset` es el tamaño de pagina; los mas nuevos primero. */
export interface EvolutionStoredMessagesPage {
  total: number;
  pages: number;
  records: Array<{ messageTimestamp?: number | string | null; key?: { remoteJid?: string | null; fromMe?: boolean } | null }>;
}

/**
 * Una pagina de los mensajes que Evolution tiene guardados para una instancia. NO
 * le pide nada a WhatsApp. Con `page` = la ultima y `offset` = 1 trae el mas viejo.
 */
export async function findStoredMessagesPage(
  config: EvolutionConfig,
  instanceName: string,
  page: number,
  offset: number,
): Promise<EvolutionStoredMessagesPage> {
  const raw = await request<{ messages?: { total?: number; pages?: number; records?: unknown[] } }>(
    config,
    "POST",
    `/chat/findMessages/${encodeURIComponent(instanceName)}`,
    { where: {}, page, offset },
  );
  const messages = raw?.messages;
  return {
    total: typeof messages?.total === "number" ? messages.total : 0,
    pages: typeof messages?.pages === "number" ? messages.pages : 0,
    records: Array.isArray(messages?.records) ? (messages!.records as EvolutionStoredMessagesPage["records"]) : [],
  };
}
