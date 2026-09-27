/**
 * La interfaz comun de los publicadores (F30).
 *
 * Todos los caminos de publicacion —Zernio, Postproxy, la API de YouTube,
 * LinkedIn, Threads— cumplen este contrato. El dispatcher no sabe cual esta
 * usando: pide publicar y recibe un resultado.
 *
 * Eso es lo que permite que editar, cancelar y reprogramar funcionen igual en
 * todas las redes, y lo que va a permitir que en la etapa 3 un agente publique
 * llamando a lo mismo.
 */

import type { FetchLike } from "@/lib/oauth/types";
import type { MediaEntry } from "@/lib/content/media";
import type { PublisherId } from "@/lib/social/accounts-schema";
import type { ErrorKind } from "@/lib/jobs/errors";

/** Lo que se publica en UNA red. */
export interface PublishInput {
  platform: string;
  /** El texto: caption, descripcion o el post entero segun la red. */
  text: string;
  /** Solo YouTube. */
  title?: string | null;
  media: MediaEntry[];
  /** URLs firmadas de la media, listas para que el proveedor las baje. */
  mediaUrls: string[];
  /** Lo propio de la red (§9.5). */
  options: Record<string, unknown>;
  /** Con que cuenta se publica. */
  accountRef: string | null;
  /**
   * Que pasos de esta publicacion ya salieron (A10).
   *
   * Una publicacion con varios pasos contra el proveedor —un hilo de
   * Threads, un carrusel— no puede empezar de cero al reintentar: el post
   * principal ya esta en la red y se duplicaria. El publicador lo lee para
   * saltear lo hecho y lo devuelve actualizado.
   */
  progress?: Record<string, unknown>;
}

export interface PublishCredentials {
  /** El secreto principal del publicador (API key o access token). */
  token: string;
  /** Datos extra que necesite ese camino. */
  extra?: Record<string, string>;
}

export interface PublishResult {
  status: "published" | "processing" | "failed";
  /** El id del post en la red, cuando ya se sabe. */
  externalId?: string | null;
  externalUrl?: string | null;
  /** Referencia del proveedor para preguntar despues por el estado. */
  ref?: string | null;
  error?: string | null;
  errorKind?: ErrorKind;
  /** Lo que se pidio contra lo que quedo (YouTube puede dejarlo privado). */
  actualVisibility?: string | null;
  /** Algo que salio distinto de lo pedido pero no es un fallo. */
  warning?: string | null;
  /** Que pasos ya salieron, para que el reintento no los repita (A10). */
  progress?: Record<string, unknown>;
}

/**
 * Programar del lado del proveedor (grupo D).
 *
 * Zernio sabe agendar: se le pasa la fecha y la zona, y publica el. Eso es
 * mejor que guardar la fecha y pedirle "publica ahora" a esa hora, porque
 * saca del medio a nuestro cron: no hay job que sobreviva a un reprogramado,
 * ni fila que quede trabada, ni reintento propio que pueda duplicar.
 *
 * Es opcional: el publicador que no lo declara sigue por el despachador.
 * Un solo lugar decide cual es cual, asi sumar un proveedor que programe de
 * su lado no toca a quien llama.
 */
export interface ScheduleRequest {
  input: PublishInput;
  credentials: PublishCredentials;
  /** Cuando sale, en ISO. Ignorado si `now`. */
  at: string;
  /** La zona del workspace: Zernio interpreta la fecha con ella. */
  timezone: string;
  /**
   * Id de pedido estable.
   *
   * Si la red se corta despues de que el proveedor acepto, el reintento
   * manda el mismo id y recibe el post original en vez de crear otro.
   */
  requestId: string;
  /** Publicar ya, en vez de esperar la fecha. */
  now?: boolean;
  fetchImpl?: FetchLike;
}

export interface ProviderScheduler {
  /** Crea el post agendado. Devuelve la referencia del proveedor. */
  create(request: ScheduleRequest): Promise<{ ref: string }>;
  /** Cambia fecha, texto, media u opciones de uno ya agendado. */
  update(request: ScheduleRequest & { ref: string }): Promise<void>;
  /** Lo saca de la agenda del proveedor. */
  cancel(params: {
    ref: string;
    credentials: PublishCredentials;
    fetchImpl?: FetchLike;
  }): Promise<void>;
  /** Vuelve a intentar uno que fallo, del lado del proveedor. */
  retry(params: {
    ref: string;
    credentials: PublishCredentials;
    fetchImpl?: FetchLike;
  }): Promise<void>;
}

export interface Publisher {
  id: PublisherId;
  /** Las redes que sabe publicar. */
  platforms: string[];
  publish(params: {
    input: PublishInput;
    credentials: PublishCredentials;
    fetchImpl?: FetchLike;
  }): Promise<PublishResult>;
  /**
   * Pregunta como quedo algo que habia quedado en proceso.
   *
   * Solo los publicadores que devuelven "processing" lo necesitan.
   */
  getStatus?(params: {
    ref: string;
    platform: string;
    credentials: PublishCredentials;
    fetchImpl?: FetchLike;
  }): Promise<PublishResult>;
  /**
   * Si lo tiene, este publicador agenda del lado del proveedor y NO usa la
   * cola de publicacion (D). Si no, sigue por el despachador.
   */
  scheduler?: ProviderScheduler;
  /**
   * Si la media tiene que vivir en el proveedor antes de agendar.
   *
   * Un link firmado nuestro vence en 24 horas; un post programado para la
   * semana que viene lo encontraria muerto.
   */
  uploadsMedia?: boolean;
}
