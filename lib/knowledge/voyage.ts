/**
 * Cliente de embeddings de Voyage AI.
 *
 * Por que REST directo y no el provider community del Vercel AI SDK: el repo
 * usa `ai` v6 con @ai-sdk/* v3, y voyage-ai-provider@5 depende de
 * @ai-sdk/provider ^4, que es AI SDK 7. Sumarlo obligaria a subir todo el SDK.
 * Ademas embedMany() no expone `input_type`, que aca importa: Voyage indexa
 * distinto un documento que una consulta, y usar el correcto mejora el
 * resultado de la busqueda.
 *
 * La API key nunca se loguea, no se devuelve y no entra en ningun mensaje de
 * error. El contenido de los documentos tampoco: los errores dicen que fallo,
 * no que decia el texto.
 */

/** Endpoint de embeddings de Voyage. */
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

/**
 * Modelo por defecto. voyage-4-lite trae 200M de tokens gratis y su dimension
 * por defecto (1024) es la que tiene anclada la columna knowledge_chunks.embedding.
 * Cambiarlo obliga a reindexar: ver la cabecera de la migracion 00049.
 */
export const DEFAULT_EMBEDDING_MODEL = "voyage-4-lite";

/** Dimension de los embeddings. Tiene que coincidir con vector(N) en la base. */
export const EMBEDDING_DIMENSIONS = 1024;

/** Tope de textos por request que documenta Voyage. */
const MAX_TEXTS_PER_REQUEST = 128;

/**
 * Tope de tokens por request. voyage-4-lite admite 1M, pero se usa un techo
 * mucho mas bajo: un lote gigante que falla se reintenta entero, y con lotes
 * chicos un reintento cuesta poco.
 */
const MAX_TOKENS_PER_REQUEST = 100_000;

const MAX_RETRIES = 3;

/**
 * Por que fallo. La distincion importa: el job de indexacion reintenta los
 * transitorios y da por perdidos los permanentes, en vez de quemar los tres
 * intentos contra una key que no existe.
 */
export type VoyageProblem =
  | "missing_key"
  | "invalid_key"
  | "rate_limited"
  | "transient"
  | "bad_request";

export interface VoyageFailure {
  ok: false;
  problem: VoyageProblem;
  /** Mensaje para mostrarle a un admin. Nunca incluye la key ni el texto. */
  message: string;
}

export interface VoyageSuccess {
  ok: true;
  /** Un embedding por texto, en el mismo orden en que entraron. */
  embeddings: number[][];
  model: string;
  /** Lo que Voyage dice que consumio. Sirve para ver cuanto queda del free tier. */
  totalTokens: number;
}

export type VoyageResult = VoyageSuccess | VoyageFailure;

/** Un problema transitorio se puede reintentar; uno permanente, no. */
export function isRetryable(problem: VoyageProblem): boolean {
  return problem === "rate_limited" || problem === "transient";
}

/**
 * Estimacion de tokens: ~4 caracteres por token.
 *
 * Es a ojo a proposito. Solo se usa para decidir donde cortar los lotes, y
 * pasarse un poco no rompe nada (Voyage trunca o devuelve 400, y el 400 se
 * maneja). Traer un tokenizador de verdad para esto no vale la dependencia.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Parte los textos en lotes que respeten los dos topes de Voyage.
 *
 * Exportada para poder testear el corte sin pegarle a la API. Un texto que solo
 * ya excede el tope de tokens se manda igual en un lote propio: Voyage lo
 * trunca (truncation viene en true por defecto) y es mejor indexarlo truncado
 * que perder el documento entero.
 */
export function batchTexts(texts: string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const text of texts) {
    const tokens = estimateTokens(text);
    const wouldOverflow =
      current.length >= MAX_TEXTS_PER_REQUEST ||
      (current.length > 0 && currentTokens + tokens > MAX_TOKENS_PER_REQUEST);

    if (wouldOverflow) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }

    current.push(text);
    currentTokens += tokens;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

export interface EmbedOptions {
  /** 'document' al indexar, 'query' al buscar. Voyage los trata distinto. */
  inputType: "document" | "query";
  model?: string;
  /** Inyectable para los tests. */
  fetchImpl?: typeof fetch;
  /** Espera entre reintentos. Los tests la ponen en 0. */
  sleepImpl?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Genera los embeddings de una lista de textos.
 *
 * Devuelve un embedding por texto, en el mismo orden. Nunca lanza: los
 * problemas vuelven como VoyageFailure para que quien llama decida.
 */
export async function embedTexts(
  apiKey: string | null | undefined,
  texts: string[],
  options: EmbedOptions,
): Promise<VoyageResult> {
  const model = options.model?.trim() || DEFAULT_EMBEDDING_MODEL;

  if (!apiKey || !apiKey.trim()) {
    return {
      ok: false,
      problem: "missing_key",
      message:
        "Falta la API key de Voyage AI. Se carga en Ajustes > Integraciones y es necesaria para indexar la base de conocimiento.",
    };
  }

  if (texts.length === 0) {
    return { ok: true, embeddings: [], model, totalTokens: 0 };
  }

  const embeddings: number[][] = [];
  let totalTokens = 0;

  for (const batch of batchTexts(texts)) {
    const result = await embedBatch(apiKey, batch, model, options);
    if (!result.ok) return result;
    embeddings.push(...result.embeddings);
    totalTokens += result.totalTokens;
  }

  // Si Voyage devolviera menos vectores que textos, los chunks quedarian
  // apareados con el embedding equivocado y la busqueda mentiria en silencio.
  // Mejor fallar aca.
  if (embeddings.length !== texts.length) {
    return {
      ok: false,
      problem: "transient",
      message: `Voyage devolvio ${embeddings.length} embeddings para ${texts.length} fragmentos.`,
    };
  }

  return { ok: true, embeddings, model, totalTokens };
}

/** Un solo request, con reintentos para lo que se puede reintentar. */
async function embedBatch(
  apiKey: string,
  batch: string[],
  model: string,
  options: EmbedOptions,
): Promise<VoyageResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleepImpl ?? defaultSleep;

  let last: VoyageFailure = {
    ok: false,
    problem: "transient",
    message: "No se pudo contactar a Voyage AI.",
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;

    try {
      response = await doFetch(VOYAGE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: batch,
          model,
          input_type: options.inputType,
          output_dimension: EMBEDDING_DIMENSIONS,
          truncation: true,
        }),
      });
    } catch (err) {
      // Error de red. El mensaje del error puede traer la URL pero nunca el
      // header, asi que es seguro; igual se recorta a lo minimo.
      last = {
        ok: false,
        problem: "transient",
        message: `No se pudo contactar a Voyage AI: ${err instanceof Error ? err.name : "error de red"}`,
      };
      if (attempt < MAX_RETRIES) await sleep(backoffMs(attempt));
      continue;
    }

    if (response.ok) {
      const parsed = await parseResponse(response, batch.length, model);
      if (parsed.ok || !isRetryable(parsed.problem)) return parsed;
      last = parsed;
      if (attempt < MAX_RETRIES) await sleep(backoffMs(attempt));
      continue;
    }

    const failure = failureFromStatus(response.status, await safeBody(response));
    if (!isRetryable(failure.problem)) return failure;

    last = failure;
    if (attempt < MAX_RETRIES) await sleep(backoffMs(attempt));
  }

  return last;
}

function backoffMs(attempt: number): number {
  return 2 ** attempt * 500;
}

/** El cuerpo del error, si se puede leer. Nunca rompe por esto. */
async function safeBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    // Acotado: un cuerpo de error largo no aporta y ensucia los logs.
    return text.slice(0, 200);
  } catch {
    return "";
  }
}

function failureFromStatus(status: number, body: string): VoyageFailure {
  if (status === 401 || status === 403) {
    return {
      ok: false,
      problem: "invalid_key",
      message:
        "Voyage AI rechazo la API key. Revisa que sea la correcta en Ajustes > Integraciones.",
    };
  }

  if (status === 429) {
    return {
      ok: false,
      problem: "rate_limited",
      message: "Voyage AI esta limitando el ritmo de pedidos. Se reintenta solo.",
    };
  }

  if (status >= 500) {
    return {
      ok: false,
      problem: "transient",
      message: `Voyage AI devolvio un error del servidor (${status}). Se reintenta solo.`,
    };
  }

  // 400 y familia: el pedido esta mal armado. Reintentarlo da lo mismo.
  return {
    ok: false,
    problem: "bad_request",
    message: `Voyage AI rechazo el pedido (${status})${body ? `: ${body}` : ""}`,
  };
}

interface VoyageApiResponse {
  data?: Array<{ embedding?: number[]; index?: number }>;
  usage?: { total_tokens?: number };
}

/**
 * Lee la respuesta y la valida.
 *
 * Se reordena por `index` porque Voyage no garantiza el orden de `data`, y un
 * embedding pegado al chunk equivocado no da error: da una busqueda que
 * devuelve cualquier cosa, que es mucho peor.
 */
async function parseResponse(
  response: Response,
  expected: number,
  model: string,
): Promise<VoyageResult> {
  let payload: VoyageApiResponse;

  try {
    payload = (await response.json()) as VoyageApiResponse;
  } catch {
    return {
      ok: false,
      problem: "transient",
      message: "Voyage AI devolvio una respuesta que no se pudo leer.",
    };
  }

  const rows = payload.data;
  if (!Array.isArray(rows) || rows.length !== expected) {
    return {
      ok: false,
      problem: "transient",
      message: `Voyage AI devolvio ${rows?.length ?? 0} embeddings y se esperaban ${expected}.`,
    };
  }

  const ordered: number[][] = new Array(expected);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const position = typeof row.index === "number" ? row.index : i;
    const embedding = row.embedding;

    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
      return {
        ok: false,
        problem: "bad_request",
        message: `Voyage AI devolvio un embedding de ${embedding?.length ?? 0} dimensiones y la base espera ${EMBEDDING_DIMENSIONS}. Revisa el modelo configurado.`,
      };
    }

    if (position < 0 || position >= expected || ordered[position]) {
      return {
        ok: false,
        problem: "transient",
        message: "Voyage AI devolvio los embeddings desordenados o repetidos.",
      };
    }

    ordered[position] = embedding;
  }

  return {
    ok: true,
    embeddings: ordered,
    model,
    totalTokens: payload.usage?.total_tokens ?? 0,
  };
}

/** Formato que espera pgvector para una columna vector(N). */
export function toPgVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
