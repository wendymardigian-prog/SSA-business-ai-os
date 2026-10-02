/**
 * Catalogo de integraciones — la unica fuente de verdad de que se puede
 * conectar y como se valida.
 *
 * Sumar una integracion en Etapa 2 (YouTube, LinkedIn, TikTok) es agregar una
 * entrada aca: la pantalla, las server actions y la validacion salen de este
 * archivo. No hace falta tocar la base (integration_configs es generica) ni
 * la UI.
 *
 * Sin dependencias de servidor: lo importan tanto el Client Component de la
 * pantalla como las server actions, para que la validacion sea LA MISMA en los
 * dos lados. El cliente valida para dar feedback rapido; el servidor vuelve a
 * validar siempre, porque el cliente se puede saltear.
 */

import { SECRET_NAMES } from "@/lib/secret-names";
import type { IntegrationType } from "@/lib/types/database";

/** Campo de configuracion que NO es secreto (remitente, modelo, etc.). */
export interface ConfigField {
  key: string;
  label: string;
  /** Ayuda debajo del campo. */
  hint?: string;
  placeholder?: string;
  required: boolean;
  /** Opciones sugeridas. La UI igual deja escribir un valor propio. */
  options?: string[];
  /** Valor con el que arranca el campo si el usuario no elige nada. */
  defaultValue?: string;
  /** Devuelve el mensaje de error, o null si el valor esta bien. */
  validate?: (value: string) => string | null;
}

/**
 * Que sabe hacer un proveedor de IA.
 *
 * No es decorativo: `integration_configs.type` vale 'ai_provider' tanto para el
 * que genera texto como para el que genera embeddings, asi que sin esta marca
 * el nodo AI Response podria elegir a Voyage —que no genera texto— y dejar de
 * contestar. Lo usa getWorkspaceModel() para filtrar. Ver lib/ai/provider.ts.
 */
export type ProviderCapability = "text" | "embeddings" | "transcription";

/**
 * Como se conecta una integracion. Decide que muestra el modal, no como se
 * guarda: todo termina en `integration_configs` + Vault.
 *
 * - `api_key`: se pega una clave (y a veces un secreto de webhook).
 * - `oauth_app`: el negocio crea su propia app en el proveedor, pega Client ID
 *   y Secret, y despues autoriza la cuenta (F9).
 * - `system_token`: un token largo que no vence, pegado a mano (Meta).
 * - `qr`: la conexion se hace escaneando un codigo en otra pantalla (WhatsApp).
 * - `via_zernio`: la red no se conecta aca; llega a traves de Zernio (F13).
 */
export type ConnectionKind = "api_key" | "oauth_app" | "system_token" | "qr" | "via_zernio";

/**
 * Seccion de la pantalla de integraciones, en el orden en que se muestran.
 *
 * Hasta el Bloque G eran seis (mensajeria, publicacion, google, meta, email,
 * ai). Seis encabezados para catorce cards era mas estructura que contenido:
 * la division que importa es conexion externa vs. proveedor de modelo, que
 * son dos decisiones de dos personas distintas. El agrupamiento fino que se
 * pierde lo recuperan los chips de abajo.
 */
export type ProviderSection = "connections" | "ai";

/** Titulos de las secciones, en orden. El orden de esta lista es el de la pantalla. */
export const SECTION_ORDER: readonly ProviderSection[] = ["connections", "ai"];

export const SECTION_LABELS: Record<ProviderSection, string> = {
  connections: "Conexiones",
  ai: "Inteligencia artificial",
};

/**
 * El agrupamiento fino de "Conexiones", como chip y no como seccion: filtran
 * sin partir la grilla, y un chip sin ninguna card se ve deshabilitado en vez
 * de desaparecer (que un tipo exista y este vacio es informacion).
 *
 * Las de IA no llevan chip: ya viven en la otra seccion.
 */
export type IntegrationChip = "mensajeria" | "publicacion" | "anuncios" | "email";

export const CHIP_ORDER: readonly IntegrationChip[] = ["mensajeria", "publicacion", "anuncios", "email"];

export const CHIP_LABELS: Record<IntegrationChip, string> = {
  mensajeria: "Mensajeria",
  publicacion: "Publicacion",
  anuncios: "Anuncios",
  email: "Email",
};

/**
 * El chip que corresponde a cada `type`, cuando la card no declara los suyos
 * propios con `types`.
 *
 * Meta es `type: 'meta'` pero NO lleva el chip "publicacion": su card dice
 * que solo lee el rendimiento de los anuncios y la audiencia de Instagram, no
 * publica nada. Ponerle "publicacion" haria creer que se puede publicar por
 * ahi.
 */
const CHIP_BY_TYPE: Partial<Record<IntegrationType, IntegrationChip>> = {
  channel: "mensajeria",
  publishing_service: "publicacion",
  social_network: "publicacion",
  google: "publicacion",
  meta: "anuncios",
  email_provider: "email",
};

/**
 * Un secreto de la integracion. Una integracion puede tener varios (Evolution
 * tiene la API key y el token del webhook; una app de OAuth tiene Client ID y
 * Secret), y cada uno sabe con que nombre se guarda en Vault.
 *
 * El valor NUNCA vuelve al cliente: el modal muestra "Guardado ✓ · Reemplazar".
 */
export interface SecretField {
  /** Nombre del campo en el formulario. */
  key: string;
  label: string;
  hint?: string;
  placeholder?: string;
  /** Con que nombre se guarda en Vault. Tiene que existir en SECRET_NAMES. */
  secretName: string;
  /** Un secreto opcional se puede dejar vacio (ej: un webhook sin firma). */
  required: boolean;
  /** Prefijo esperado, cuando el proveedor tiene uno estable. */
  keyPrefix?: string;
  minLength?: number;
}

/**
 * Que se cuenta en la barra de uso de la card. El numero usado lo calcula el
 * servidor (lib/integrations/usage.ts); aca vive solo el tope del plan.
 */
export interface UsageDefinition {
  /** Que se esta contando, en una linea: "cuentas gratis", "publicaciones este mes". */
  label: string;
  /** Tope del plan. null = sin tope conocido (se muestra el numero sin barra). */
  limit: number | null;
  /** Aviso cuando se llega al tope ("la proxima cuenta cuesta $6/mes"). */
  atLimitHint?: string;
}

export interface ProviderDefinition {
  /** Identificador de la integracion. Es la clave en la pantalla y en las acciones. */
  id: string;
  type: IntegrationType;
  /**
   * Valor que se guarda en `integration_configs.provider`. Por defecto es el
   * `id`; existe porque la fila de Zernio se creo con el valor
   * `instagram_zernio` y renombrarla seria migrar datos para nada.
   */
  configProvider?: string;
  /** Como se conecta (decide que muestra el modal). */
  connection: ConnectionKind;
  /** En que seccion de la pantalla aparece. */
  section: ProviderSection;
  /**
   * Los chips de tipo de esta card, cuando sirve para mas de una cosa (Zernio:
   * mensajeria y publicacion). Ausente = se deriva de `type` (ver
   * `CHIP_BY_TYPE`). Solo tiene sentido en la seccion `connections`.
   */
  types?: IntegrationChip[];
  /**
   * false = existe en el catalogo pero todavia no se muestra ni se puede
   * guardar. Meta se prende en el bloque 5 y el email entrante en el 8: tener
   * la entrada desde ahora evita tocar la pantalla dos veces.
   */
  visible: boolean;
  /**
   * Solo para type 'ai_provider'. Ausente = "text", que es lo que eran todos
   * los proveedores de IA antes de que existiera Voyage.
   */
  capability?: ProviderCapability;
  label: string;
  /** Una linea explicando para que sirve, en la card. */
  description: string;
  /**
   * Nombre del secret principal en Vault. Null si la integracion no guarda una
   * sola clave. Se conserva porque lo usan el nodo de IA, el envio de email y
   * la indexacion: para ellos una integracion es "una key".
   */
  secretName: string | null;
  /**
   * Todos los secretos de la integracion, en el orden del formulario. Cuando
   * hay uno solo coincide con `secretName`.
   */
  secretFields?: SecretField[];
  /** Barra de uso de la card, si tiene sentido contar algo. */
  usage?: UsageDefinition;
  /** Prefijo esperado de la key, cuando el proveedor tiene uno estable. */
  keyPrefix?: string;
  minKeyLength: number;
  configFields: ConfigField[];
  /** De donde saca el usuario la key. */
  docsUrl: string;
}

function isEmail(value: string): string | null {
  // Validacion deliberadamente laxa: alcanza para atajar errores de tipeo.
  // Quien decide si el remitente sirve es Resend, con su dominio verificado.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    ? null
    : "Tiene que ser un email valido (ej: hola@tudominio.com)";
}

/**
 * Modelos sugeridos por proveedor. Son sugerencias, no una lista cerrada: la
 * UI permite escribir cualquier identificador para que esto no envejezca mal
 * cuando salga un modelo nuevo.
 */
const MODEL_FIELD = (options: string[], defaultValue: string): ConfigField => ({
  key: "default_model",
  label: "Modelo por defecto",
  hint: "Se usa cuando una funcionalidad no pide un modelo especifico. Podes escribir otro identificador.",
  required: true,
  options,
  defaultValue,
});

export const PROVIDERS: ProviderDefinition[] = [
  // ── Mensajeria ───────────────────────────────────────────────────────────
  {
    id: "zernio",
    // La fila existente se creo con type 'channel' y provider 'instagram_zernio'
    // (app/api/v1/channels/test-key). Se respetan los dos para no migrar datos.
    type: "channel",
    configProvider: "instagram_zernio",
    connection: "api_key",
    section: "connections",
    // Tambien publica en Instagram y TikTok (ver su descripcion): el chip por
    // defecto de su `type` ("mensajeria") se quedaria corto.
    types: ["mensajeria", "publicacion"],
    visible: true,
    label: "Zernio",
    description:
      "Instagram: mensajes directos, respuestas a historias y comentarios. Tambien publica en Instagram y TikTok.",
    secretName: SECRET_NAMES.zernioApiKey,
    minKeyLength: 20,
    secretFields: [
      {
        key: "api_key",
        label: "API key de Zernio",
        hint: "La saca del panel de Zernio. Con ella se conectan las cuentas y se manda cada mensaje.",
        secretName: SECRET_NAMES.zernioApiKey,
        required: true,
        minLength: 20,
      },
      {
        key: "webhook_secret",
        label: "Secreto del webhook",
        hint: "Con esto se verifica que cada mensaje entrante viene de Zernio y no de otra persona. Si ya hay uno configurado, se puede migrar a Vault sin volver a pegarlo.",
        secretName: SECRET_NAMES.zernioWebhookSecret,
        required: false,
        minLength: 16,
      },
    ],
    usage: {
      label: "cuentas conectadas",
      limit: 2,
      atLimitHint: "El plan gratis de Zernio llega a 2 cuentas. La siguiente cuesta USD 6 por mes.",
    },
    configFields: [],
    docsUrl: "https://app.zernio.com",
  },
  {
    id: "evolution",
    type: "channel",
    connection: "qr",
    section: "connections",
    visible: true,
    label: "Evolution API (WhatsApp)",
    description:
      "WhatsApp por codigo QR, con tu propio servidor de Evolution. Un numero por workspace.",
    secretName: SECRET_NAMES.evolutionApiKey,
    minKeyLength: 8,
    secretFields: [
      {
        key: "api_key",
        label: "API key del servidor",
        hint: "La clave global que configuraste en tu Evolution (AUTHENTICATION_API_KEY).",
        secretName: SECRET_NAMES.evolutionApiKey,
        required: true,
        minLength: 8,
      },
      {
        key: "webhook_token",
        label: "Token del webhook",
        hint: "Viaja en cada mensaje que Evolution nos manda. La URL es publica, asi que sin token entraria cualquiera.",
        secretName: SECRET_NAMES.evolutionWebhookToken,
        required: true,
        minLength: 16,
      },
    ],
    configFields: [
      {
        key: "api_url",
        label: "Direccion del servidor",
        hint: "El dominio publico de tu Evolution en Railway. La red privada no sirve: son dos proyectos distintos.",
        placeholder: "https://evolution-production.up.railway.app",
        required: true,
        validate: (value) =>
          /^https?:\/\/[^\s]+$/.test(value.trim())
            ? null
            : "Tiene que ser una direccion completa, con https://",
      },
      {
        key: "instance_prefix",
        label: "Prefijo de la instancia",
        hint: "Con que empieza el nombre de la instancia de este sistema en tu servidor.",
        placeholder: "ssa",
        required: false,
        defaultValue: "ssa",
      },
    ],
    docsUrl: "https://doc.evolution-api.com",
  },

  // ── Publicacion y redes ──────────────────────────────────────────────────
  {
    id: "postproxy",
    type: "publishing_service",
    connection: "api_key",
    section: "connections",
    visible: true,
    label: "Postproxy",
    description: "Publica en YouTube sin pasar por la auditoria de Google.",
    secretName: SECRET_NAMES.postproxyApiKey,
    minKeyLength: 16,
    secretFields: [
      {
        key: "api_key",
        label: "API key de Postproxy",
        secretName: SECRET_NAMES.postproxyApiKey,
        required: true,
        minLength: 16,
      },
      {
        key: "webhook_secret",
        label: "Secreto del webhook",
        hint: "Solo si Postproxy lo ofrece. Sirve para confirmar que el aviso de \"ya se publico\" es suyo.",
        secretName: SECRET_NAMES.postproxyWebhookSecret,
        required: false,
        minLength: 12,
      },
    ],
    usage: {
      label: "publicaciones este mes",
      limit: 10,
      atLimitHint: "El plan gratis de Postproxy llega a 10 publicaciones por mes.",
    },
    configFields: [],
    docsUrl: "https://postproxy.dev",
  },
  {
    id: "linkedin",
    type: "social_network",
    connection: "oauth_app",
    section: "connections",
    visible: true,
    label: "LinkedIn",
    description:
      "Publica en tu perfil: texto, imagenes, video y PDF. LinkedIn no da metricas ni comentarios con esta conexion.",
    secretName: null,
    minKeyLength: 0,
    secretFields: [
      {
        key: "client_id",
        label: "Client ID",
        hint: "De tu app en el portal de desarrolladores de LinkedIn.",
        secretName: SECRET_NAMES.linkedinClientId,
        required: true,
        minLength: 8,
      },
      {
        key: "client_secret",
        label: "Client Secret",
        secretName: SECRET_NAMES.linkedinClientSecret,
        required: true,
        minLength: 8,
      },
    ],
    configFields: [],
    docsUrl: "https://www.linkedin.com/developers/apps",
  },
  {
    id: "threads",
    type: "social_network",
    connection: "oauth_app",
    section: "connections",
    visible: true,
    label: "Threads",
    description: "Publica textos, imagenes, video, carruseles e hilos, y lee sus metricas.",
    secretName: null,
    minKeyLength: 0,
    secretFields: [
      {
        key: "app_id",
        label: "App ID",
        hint: "De tu app de Threads en el panel de Meta para desarrolladores.",
        secretName: SECRET_NAMES.threadsAppId,
        required: true,
        minLength: 8,
      },
      {
        key: "app_secret",
        label: "App Secret",
        secretName: SECRET_NAMES.threadsAppSecret,
        required: true,
        minLength: 8,
      },
    ],
    configFields: [],
    docsUrl: "https://developers.facebook.com/docs/threads",
  },

  // ── Google ───────────────────────────────────────────────────────────────
  {
    id: "google",
    type: "google",
    connection: "oauth_app",
    section: "connections",
    visible: true,
    label: "Google (YouTube)",
    description:
      "Sube videos a YouTube y lee sus metricas y comentarios, con tu propio cliente de OAuth.",
    secretName: null,
    minKeyLength: 0,
    secretFields: [
      {
        key: "client_id",
        label: "Client ID",
        hint: "Del cliente OAuth de tipo \"aplicacion web\" que creaste en Google Cloud.",
        secretName: SECRET_NAMES.googleClientId,
        required: true,
        minLength: 12,
      },
      {
        key: "client_secret",
        label: "Client Secret",
        secretName: SECRET_NAMES.googleClientSecret,
        required: true,
        minLength: 12,
      },
    ],
    configFields: [],
    docsUrl: "https://console.cloud.google.com/apis/credentials",
  },

  // ── Meta ─────────────────────────────────────────────────────────────────
  {
    id: "meta",
    type: "meta",
    connection: "system_token",
    section: "connections",
    visible: true,
    label: "Meta (anuncios e Instagram)",
    description:
      "Lee el rendimiento de tus anuncios y los datos de audiencia de Instagram. No crea ni edita anuncios.",
    secretName: SECRET_NAMES.metaSystemUserToken,
    minKeyLength: 40,
    secretFields: [
      {
        key: "system_user_token",
        label: "Token de system user",
        hint: "Un token que no vence, con permiso ads_read. Se genera en el Business Manager.",
        secretName: SECRET_NAMES.metaSystemUserToken,
        required: true,
        minLength: 40,
      },
    ],
    configFields: [],
    docsUrl: "https://business.facebook.com/settings/system-users",
  },

  // ── Email ────────────────────────────────────────────────────────────────
  {
    id: "resend_inbound",
    type: "email_provider",
    connection: "api_key",
    section: "connections",
    visible: true,
    label: "Resend (email entrante)",
    description: "Recibe los emails de una direccion tuya como conversaciones de la bandeja.",
    secretName: SECRET_NAMES.resendInboundWebhookSecret,
    minKeyLength: 16,
    secretFields: [
      {
        key: "webhook_secret",
        label: "Secreto del webhook (Svix)",
        hint: "Lo da Resend al crear el webhook. Con el se verifica que el email entrante es suyo.",
        secretName: SECRET_NAMES.resendInboundWebhookSecret,
        required: true,
        minLength: 16,
      },
    ],
    usage: {
      label: "emails hoy",
      limit: 100,
      atLimitHint:
        "Es el tope del plan gratis de Resend. Pasado eso, los emails no salen hasta mañana.",
    },
    configFields: [
      {
        key: "inbound_address",
        label: "Direccion de entrada",
        hint: "La direccion del subdominio que configuraste en Resend. Las respuestas salen de ahi.",
        placeholder: "hola@mail.tudominio.com",
        required: true,
        validate: isEmail,
      },
    ],
    docsUrl: "https://resend.com/docs/dashboard/emails/receiving",
  },

  {
    id: "resend",
    type: "email_provider",
    connection: "api_key",
    section: "connections",
    visible: true,
    label: "Resend",
    description: "Envio de emails salientes: invitaciones al equipo y avisos del sistema.",
    secretName: SECRET_NAMES.resendApiKey,
    keyPrefix: "re_",
    minKeyLength: 20,
    configFields: [
      {
        key: "from_email",
        label: "Remitente",
        hint: "Tiene que ser de un dominio verificado en Resend.",
        placeholder: "hola@tudominio.com",
        required: true,
        validate: isEmail,
      },
      {
        key: "from_name",
        label: "Nombre del remitente",
        hint: "Como aparece en la bandeja de quien recibe. Opcional.",
        placeholder: "Tu Negocio",
        required: false,
      },
    ],
    docsUrl: "https://resend.com/api-keys",
  },
  {
    id: "openai",
    type: "ai_provider",
    connection: "api_key",
    section: "ai",
    visible: true,
    label: "OpenAI",
    description: "Tu propia cuenta de OpenAI (BYOK). El consumo se factura a tu cuenta.",
    secretName: SECRET_NAMES.openaiApiKey,
    keyPrefix: "sk-",
    minKeyLength: 20,
    configFields: [MODEL_FIELD(["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4o"], "gpt-5")],
    // La lista de arriba es una sugerencia corta. La de verdad la trae el
    // proveedor al verificar la key (ai-key-check.ts) y se guarda en
    // config.models: es lo que evita que esto envejezca.
    docsUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    type: "ai_provider",
    connection: "api_key",
    section: "ai",
    visible: true,
    label: "Anthropic (Claude)",
    description: "Tu propia cuenta de Anthropic (BYOK). El consumo se factura a tu cuenta.",
    secretName: SECRET_NAMES.anthropicApiKey,
    keyPrefix: "sk-ant-",
    minKeyLength: 20,
    configFields: [
      MODEL_FIELD(
        [
          // Los mas usados primero: el de todos los dias, el barato y el potente.
          "claude-sonnet-5",
          "claude-haiku-4-5",
          "claude-opus-5",
          // Los de razonamiento largo. Caros: ver el precio antes de ponerlos
          // en un agente que contesta a cada mensaje.
          "claude-fable-5-1",
          "claude-fable-5",
          // Generacion anterior, por si hace falta volver.
          "claude-opus-4-8",
          "claude-opus-4-7",
          "claude-opus-4-6",
          "claude-sonnet-4-6",
        ],
        "claude-sonnet-5",
      ),
    ],
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google_ai",
    type: "ai_provider",
    connection: "api_key",
    section: "ai",
    visible: true,
    label: "Google (Gemini)",
    description: "Tu propia cuenta de Google AI Studio (BYOK). El consumo se factura a tu cuenta.",
    secretName: SECRET_NAMES.googleAiApiKey,
    // Google no garantiza un prefijo estable, asi que solo se valida longitud.
    minKeyLength: 20,
    configFields: [
      // gemini-2.0-flash salio: Google ya no publica su precio, y un modelo sin
      // precio deja los runs con el costo sin calcular.
      MODEL_FIELD(["gemini-2.5-pro", "gemini-2.5-flash"], "gemini-2.5-flash"),
    ],
    docsUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "voyage",
    type: "ai_provider",
    capability: "embeddings",
    connection: "api_key",
    section: "ai",
    visible: true,
    label: "Voyage AI (embeddings)",
    description:
      "Indexa los documentos de la base de conocimiento para que la IA los pueda buscar. Solo hace eso: no genera respuestas, asi que convive con el proveedor que uses para conversar.",
    secretName: SECRET_NAMES.voyageApiKey,
    // Voyage no documenta un prefijo estable para sus keys, asi que se valida
    // solo el largo. Mismo criterio que Google.
    minKeyLength: 20,
    configFields: [
      {
        key: "embedding_model",
        label: "Modelo de embeddings",
        hint: "Cambiar el modelo obliga a reindexar toda la base de conocimiento: los embeddings de modelos distintos no se pueden comparar entre si.",
        required: true,
        options: ["voyage-4-lite", "voyage-4", "voyage-4-large"],
        defaultValue: "voyage-4-lite",
      },
    ],
    docsUrl: "https://dashboard.voyageai.com/api-keys",
  },
  {
    id: "groq",
    type: "ai_provider",
    capability: "transcription",
    connection: "api_key",
    section: "ai",
    visible: true,
    label: "Groq (transcripción de audio)",
    description:
      "Convierte a texto las notas de voz que llegan por Instagram y WhatsApp, para que el asistente sepa qué le dijeron y pueda contestar. Sin esto, una nota de voz queda sin interpretar y la conversación se deriva a una persona. Se cobra por hora de audio, no por mensaje.",
    secretName: SECRET_NAMES.groqApiKey,
    keyPrefix: "gsk_",
    minKeyLength: 20,
    configFields: [
      {
        key: "transcription_model",
        label: "Modelo de transcripción",
        hint: "whisper-large-v3-turbo es el más barato y alcanza para notas de voz. whisper-large-v3 es más preciso y cuesta casi tres veces más.",
        required: true,
        options: ["whisper-large-v3-turbo", "whisper-large-v3"],
        defaultValue: "whisper-large-v3-turbo",
      },
    ],
    docsUrl: "https://console.groq.com/keys",
  },
];

/** Los proveedores de IA que generan texto (los que puede usar el nodo AI Response). */
export function isTextProvider(definition: ProviderDefinition): boolean {
  return definition.type === "ai_provider" && (definition.capability ?? "text") === "text";
}

/** Los proveedores de IA que generan embeddings (los que indexan la base de conocimiento). */
export function isEmbeddingProvider(definition: ProviderDefinition): boolean {
  return definition.type === "ai_provider" && definition.capability === "embeddings";
}

/** Los proveedores de IA que transcriben audio (F6). */
export function isTranscriptionProvider(definition: ProviderDefinition): boolean {
  return definition.type === "ai_provider" && definition.capability === "transcription";
}

export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/**
 * El proveedor visible con ese id. Las acciones usan esta y no `getProvider`:
 * una integracion que todavia no se muestra tampoco se puede guardar.
 */
export function getVisibleProvider(id: string): ProviderDefinition | undefined {
  const provider = getProvider(id);
  return provider?.visible ? provider : undefined;
}

/**
 * Las integraciones VISIBLES de un tipo. Lo visible importa: `email_provider`
 * son dos (Resend saliente y Resend entrante) y el entrante recien se muestra
 * en el bloque 8, asi que hasta entonces esta funcion sigue devolviendo lo
 * mismo que antes de la etapa 2.
 */
export function providersByType(type: IntegrationType): ProviderDefinition[] {
  return PROVIDERS.filter((p) => p.visible && p.type === type);
}

/** Con que valor se guarda en `integration_configs.provider`. */
export function configProviderOf(provider: ProviderDefinition): string {
  return provider.configProvider ?? provider.id;
}

/** La definicion que corresponde a una fila de `integration_configs`. */
export function providerForConfigRow(type: IntegrationType, configProvider: string) {
  return PROVIDERS.find((p) => p.type === type && configProviderOf(p) === configProvider);
}

/**
 * Los chips de tipo de una card (G1). Las de IA no llevan ninguno: ya viven
 * en la seccion de al lado.
 */
export function chipsOf(provider: ProviderDefinition): IntegrationChip[] {
  if (provider.section === "ai") return [];
  if (provider.types) return provider.types;
  const chip = CHIP_BY_TYPE[provider.type];
  return chip ? [chip] : [];
}

/** Los secretos de una integracion, tenga uno o varios. */
export function secretFieldsOf(provider: ProviderDefinition): SecretField[] {
  if (provider.secretFields?.length) return provider.secretFields;
  if (!provider.secretName) return [];
  return [
    {
      key: "api_key",
      label: `API key de ${provider.label}`,
      secretName: provider.secretName,
      required: true,
      keyPrefix: provider.keyPrefix,
      minLength: provider.minKeyLength,
    },
  ];
}

export interface ProviderSectionGroup {
  section: ProviderSection;
  label: string;
  providers: ProviderDefinition[];
}

/**
 * Las integraciones agrupadas para la pantalla: solo las visibles, en el orden
 * de SECTION_ORDER, y sin las secciones que quedan vacias.
 */
export function providersBySection(): ProviderSectionGroup[] {
  return SECTION_ORDER.map((section) => ({
    section,
    label: SECTION_LABELS[section],
    providers: PROVIDERS.filter((p) => p.visible && p.section === section),
  })).filter((group) => group.providers.length > 0);
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Valida el formato de una API key. No verifica contra el proveedor: eso
 * requiere una llamada de red y no esta en el alcance de esta fase.
 */
export function validateApiKey(providerId: string, value: string): ValidationResult {
  const provider = getProvider(providerId);
  if (!provider) return { ok: false, error: `Integracion desconocida: ${providerId}` };
  if (!provider.secretName) {
    return { ok: false, error: `${provider.label} no usa API key` };
  }

  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: "Pega la API key" };

  if (provider.keyPrefix && !trimmed.startsWith(provider.keyPrefix)) {
    return {
      ok: false,
      error: `La key de ${provider.label} empieza con "${provider.keyPrefix}". Revisa que hayas copiado la correcta.`,
    };
  }

  if (trimmed.length < provider.minKeyLength) {
    return {
      ok: false,
      error: `La key parece incompleta: tiene ${trimmed.length} caracteres y se esperan al menos ${provider.minKeyLength}.`,
    };
  }

  // Un espacio en el medio casi siempre es un copiado a medias.
  if (/\s/.test(trimmed)) {
    return { ok: false, error: "La key no puede tener espacios. Copiala de nuevo completa." };
  }

  return { ok: true };
}

/** Valida los campos de config (remitente, modelo). Devuelve el primer error. */
export function validateConfig(
  providerId: string,
  config: Record<string, string>,
): ValidationResult {
  const provider = getProvider(providerId);
  if (!provider) return { ok: false, error: `Integracion desconocida: ${providerId}` };

  for (const field of provider.configFields) {
    const raw = (config[field.key] ?? "").trim();
    if (!raw) {
      if (field.required) return { ok: false, error: `Falta completar "${field.label}"` };
      continue;
    }
    const error = field.validate?.(raw);
    if (error) return { ok: false, error };
  }

  return { ok: true };
}
