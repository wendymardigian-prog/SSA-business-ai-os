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

import { SECRET_NAMES } from "@/lib/vault";
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

export interface ProviderDefinition {
  /** Valor de integration_configs.provider. */
  id: string;
  type: IntegrationType;
  label: string;
  /** Una linea explicando para que sirve, en la card. */
  description: string;
  /** Nombre limpio del secret en Vault. Null si la integracion no usa API key. */
  secretName: string | null;
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
  {
    id: "resend",
    type: "email_provider",
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
    label: "OpenAI",
    description: "Tu propia cuenta de OpenAI (BYOK). El consumo se factura a tu cuenta.",
    secretName: SECRET_NAMES.openaiApiKey,
    keyPrefix: "sk-",
    minKeyLength: 20,
    configFields: [MODEL_FIELD(["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4o"], "gpt-5")],
    docsUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    type: "ai_provider",
    label: "Anthropic (Claude)",
    description: "Tu propia cuenta de Anthropic (BYOK). El consumo se factura a tu cuenta.",
    secretName: SECRET_NAMES.anthropicApiKey,
    keyPrefix: "sk-ant-",
    minKeyLength: 20,
    configFields: [
      MODEL_FIELD(
        ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"],
        "claude-sonnet-5",
      ),
    ],
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google_ai",
    type: "ai_provider",
    label: "Google (Gemini)",
    description: "Tu propia cuenta de Google AI Studio (BYOK). El consumo se factura a tu cuenta.",
    secretName: SECRET_NAMES.googleAiApiKey,
    // Google no garantiza un prefijo estable, asi que solo se valida longitud.
    minKeyLength: 20,
    configFields: [
      MODEL_FIELD(["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"], "gemini-2.5-flash"),
    ],
    docsUrl: "https://aistudio.google.com/app/apikey",
  },
];

export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function providersByType(type: IntegrationType): ProviderDefinition[] {
  return PROVIDERS.filter((p) => p.type === type);
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
