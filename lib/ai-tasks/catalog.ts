import type { BackgroundTask } from "@/lib/background/settings";
import type { AgentRunSource } from "@/lib/types/database";

/**
 * El catálogo único de tareas de IA del sistema (no conversacionales): las
 * cuatro de "Tareas en segundo plano" (F23), las dos que ya gastan IA pero
 * nunca tuvieron pantalla propia (transcripción, descripción de imagen) y el
 * análisis de anuncios, que corre bajo demanda al apretar un botón.
 *
 * Vive en Agentes IA, agrupadas debajo de los agentes (D-agentes-ia). Puro:
 * sin dependencias de servidor, lo importan tanto el servidor como la UI.
 */
export const AI_TASK_IDS = [
  "message_classification",
  "conversation_summary",
  "close_classification",
  "knowledge_indexing",
  "audio_transcription",
  "media_description",
  "ads_analysis",
] as const;

export type AiTaskId = (typeof AI_TASK_IDS)[number];

/** Nombre de ícono de lucide-react (el mapa a componente vive en la UI, cliente). */
export type AiTaskIcon = "ListFilter" | "NotebookText" | "Thermometer" | "BookOpenCheck" | "AudioLines" | "ImageIcon" | "BarChart3";

export interface AiTaskDef {
  id: AiTaskId;
  name: string;
  description: string;
  icon: AiTaskIcon;
  /** Tiene fila en `BACKGROUND_TASKS`: modo, frecuencia y hora configurables. */
  configurable: boolean;
  /** Se puede apagar o pasar a económico. La indexación y las dos de sistema no. */
  canTurnOff: boolean;
  /** Tiene instrucciones versionables (la parte editable de su prompt). */
  hasInstructions: boolean;
  /**
   * El negocio puede elegir su modelo (proveedor + modelo) en la pantalla de la
   * tarea (`workspaces.ai_task_models`, 00138). Sin eleccion, usa el modelo por
   * defecto del negocio. Hoy solo el analisis de anuncios.
   */
  hasModelPicker?: boolean;
  /** Las `{{variables}}` que se pueden usar en sus instrucciones (se muestran de ayuda). */
  variables?: Array<{ name: string; description: string }>;
  /** No corre sola ni por lote: corre cuando alguien aprieta un boton. */
  onDemand?: boolean;
  /** El `agent_runs.source` de sus corridas. */
  source: AgentRunSource;
  /**
   * Solo `close_classification`: no tiene `source` propio (corre adentro del
   * run de `conversation_summary`), así que además filtra por `status_detail`.
   */
  detailLike?: string;
  /** La clave en `BackgroundSettings`, cuando `configurable` es true. */
  backgroundTask?: BackgroundTask;
}

export const AI_TASKS: Record<AiTaskId, AiTaskDef> = {
  message_classification: {
    id: "message_classification",
    name: "Clasificación de mensajes",
    description: "Agrupa los mensajes por intención para el dashboard.",
    icon: "ListFilter",
    configurable: true,
    canTurnOff: true,
    hasInstructions: true,
    source: "message_classification",
    backgroundTask: "message_classification",
  },
  conversation_summary: {
    id: "conversation_summary",
    name: "Resumen de conversación",
    description: "La memoria del agente sobre cada contacto.",
    icon: "NotebookText",
    configurable: true,
    canTurnOff: true,
    hasInstructions: true,
    source: "conversation_summary",
    backgroundTask: "conversation_summary",
  },
  close_classification: {
    id: "close_classification",
    name: "Clasificación al cierre",
    description: "Tags, temperatura y seguimiento al cerrar una conversación.",
    icon: "Thermometer",
    configurable: true,
    canTurnOff: true,
    hasInstructions: false,
    source: "conversation_summary",
    detailLike: "%classified%",
    backgroundTask: "close_classification",
  },
  knowledge_indexing: {
    id: "knowledge_indexing",
    name: "Indexación de Conocimiento",
    description: "Prepara los documentos que subís para que el agente los use.",
    icon: "BookOpenCheck",
    configurable: true,
    canTurnOff: false,
    hasInstructions: false,
    source: "kb_indexing",
    backgroundTask: "knowledge_indexing",
  },
  audio_transcription: {
    id: "audio_transcription",
    name: "Transcripción de audio",
    description: "Pasa a texto las notas de voz para que el agente las entienda.",
    icon: "AudioLines",
    configurable: false,
    canTurnOff: false,
    hasInstructions: false,
    source: "audio_transcription",
  },
  media_description: {
    id: "media_description",
    name: "Descripción de imágenes",
    description: "Describe en una frase lo que se ve en una foto que llega al chat.",
    icon: "ImageIcon",
    configurable: false,
    canTurnOff: false,
    hasInstructions: true,
    source: "media_description",
  },
  ads_analysis: {
    id: "ads_analysis",
    name: "Análisis de anuncios",
    description: "Lee los números de tu cuenta de Meta Ads y dice qué funciona, qué no y qué conviene hacer.",
    icon: "BarChart3",
    configurable: false,
    canTurnOff: false,
    hasInstructions: true,
    hasModelPicker: true,
    onDemand: true,
    variables: [{ name: "estilo", description: "cómo habla la IA en este negocio; por defecto, español neutro, directo y sin relleno" }],
    source: "ads_analysis",
  },
};

export function getAiTask(id: string): AiTaskDef | null {
  return (AI_TASKS as Record<string, AiTaskDef>)[id] ?? null;
}

/** Las tareas con fila propia en `BACKGROUND_TASKS` (F23), en su orden de siempre. */
export const CONFIGURABLE_AI_TASKS: AiTaskDef[] = AI_TASK_IDS.map((id) => AI_TASKS[id]).filter((t) => t.configurable);

/** Todas, en el orden de la pantalla: primero las configurables, después las de sistema. */
export const ALL_AI_TASKS: AiTaskDef[] = AI_TASK_IDS.map((id) => AI_TASKS[id]);
