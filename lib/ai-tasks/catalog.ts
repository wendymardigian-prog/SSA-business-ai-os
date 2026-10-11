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
  // Llamadas (Fathom + analizador): tres tareas, dos con configuracion propia.
  "call_classification",
  "call_analysis",
  "call_summary",
] as const;

export type AiTaskId = (typeof AI_TASK_IDS)[number];

/** Nombre de ícono de lucide-react (el mapa a componente vive en la UI, cliente). */
export type AiTaskIcon =
  | "ListFilter"
  | "NotebookText"
  | "Thermometer"
  | "BookOpenCheck"
  | "AudioLines"
  | "ImageIcon"
  | "BarChart3"
  | "Tags"
  | "PhoneCall"
  | "NotebookPen";

/**
 * Donde se prende, se apaga o se ajusta de verdad cada tarea. Es lo que
 * muestra la pestaña Configuración, y una sola fuente: una tarea que se
 * controla desde cada agente no tiene ademas un selector propio que no hace
 * nada (antes Resumen y Clasificación al cierre tenían uno que nadie leía).
 */
export type AiTaskControl =
  /** Modo propio (Inmediato / Económico / Apagado) en la pestaña Configuración. */
  | { kind: "task" }
  /** Lo decide cada agente, en su pestaña Configuración. */
  | { kind: "agent"; flag: "summaryOnClose" | "classifyOnClose" }
  /** Corre siempre que hace falta; el proveedor se elige en Integraciones. */
  | { kind: "integration"; href: string; label: string }
  /** Corre cuando alguien aprieta un botón. */
  | { kind: "on_demand"; where: string };

/** Las instrucciones de la tarea: editables y versionadas, o por qué no las tiene. */
export type AiTaskInstructions =
  | { editable: true; variables: Array<{ name: string; description: string }> }
  | { editable: false; whyNot: string };

export interface AiTaskDef {
  id: AiTaskId;
  name: string;
  description: string;
  icon: AiTaskIcon;
  /** Tiene modo propio editable (fila en `BACKGROUND_TASKS` con selector). Hoy solo la clasificación de mensajes. */
  configurable: boolean;
  /** Se puede apagar o pasar a económico desde su pantalla. */
  canTurnOff: boolean;
  control: AiTaskControl;
  instructions: AiTaskInstructions;
  /** De dónde sale el modelo, en una frase para la pestaña Configuración. */
  modelSource: string;
  /**
   * El negocio puede elegir su modelo (proveedor + modelo) en la pantalla de la
   * tarea (`workspaces.ai_task_models`, 00138). Sin eleccion, usa el modelo por
   * defecto del negocio. Hoy solo el analisis de anuncios.
   */
  hasModelPicker?: boolean;
  /** No corre sola ni por lote: corre cuando alguien aprieta un boton. */
  onDemand?: boolean;
  /** El `agent_runs.source` de sus corridas. */
  source: AgentRunSource;
  /**
   * Solo `close_classification`: no tiene `source` propio (corre adentro del
   * run de `conversation_summary`), así que además filtra por `status_detail`.
   */
  detailLike?: string;
  /** La clave en `BackgroundSettings`, solo cuando `configurable` es true y la tarea tiene modo por lote. */
  backgroundTask?: BackgroundTask;
  /**
   * Las tareas de Llamadas con configuracion propia (reglas, rubrica, categorias…).
   * Viven en `ai_background_settings` pero NO en `BackgroundSettings`: tienen su
   * propio esquema (`lib/calls/task-settings.ts`) y nunca van por lote.
   */
  callTask?: "call_classification" | "call_analysis";
}

/** Atajo: la tarea tiene instrucciones editables (pestaña Instrucciones con editor). */
export function hasEditableInstructions(task: AiTaskDef): boolean {
  return task.instructions.editable;
}

const ESTILO = { name: "estilo", description: "cómo habla la IA en este negocio; por defecto, español neutro, directo y sin relleno" };

type CallTaskId = "call_classification" | "call_analysis" | "call_summary";

const BASE_TASKS: Record<Exclude<AiTaskId, CallTaskId>, AiTaskDef> = {
  message_classification: {
    id: "message_classification",
    name: "Clasificación de mensajes",
    description: "Agrupa los mensajes por intención para el dashboard.",
    icon: "ListFilter",
    configurable: true,
    canTurnOff: true,
    control: { kind: "task" },
    instructions: {
      editable: true,
      variables: [
        { name: "direccion", description: "“que escriben los contactos” o “que envía el negocio a sus contactos”, según el lote" },
        { name: "max_nuevas_categorias", description: "cuántas categorías nuevas puede proponer por lote" },
      ],
    },
    modelSource: "El modelo con precio cargado más barato entre los proveedores de IA conectados.",
    source: "message_classification",
    backgroundTask: "message_classification",
  },
  conversation_summary: {
    id: "conversation_summary",
    name: "Resumen de conversación",
    description: "La memoria del agente sobre cada contacto.",
    icon: "NotebookText",
    configurable: false,
    canTurnOff: false,
    control: { kind: "agent", flag: "summaryOnClose" },
    instructions: {
      editable: true,
      variables: [
        ESTILO,
        { name: "largo_maximo", description: "el largo máximo del resumen, en caracteres" },
      ],
    },
    modelSource: "El modelo del agente que atiende el canal de la conversación (y su respaldo si falla).",
    source: "conversation_summary",
  },
  close_classification: {
    id: "close_classification",
    name: "Clasificación al cierre",
    description: "Tags, temperatura y seguimiento al cerrar una conversación.",
    icon: "Thermometer",
    configurable: false,
    canTurnOff: false,
    control: { kind: "agent", flag: "classifyOnClose" },
    instructions: { editable: true, variables: [] },
    modelSource: "El del agente del canal, en la misma llamada que el Resumen de conversación (una sola lectura, un solo costo).",
    source: "conversation_summary",
    detailLike: "%classified%",
  },
  knowledge_indexing: {
    id: "knowledge_indexing",
    name: "Indexación de Conocimiento",
    description: "Prepara los documentos que subís para que el agente los use.",
    icon: "BookOpenCheck",
    configurable: false,
    canTurnOff: false,
    control: { kind: "integration", href: "/dashboard/settings/integrations/voyage", label: "Ajustes → Integraciones → Voyage" },
    instructions: {
      editable: false,
      whyNot: "No le escribe a un modelo de lenguaje: parte cada documento en pedazos y los convierte en vectores (embeddings) para poder buscarlos. No hay texto que interpretar ni criterio que darle.",
    },
    modelSource: "Voyage AI, con el modelo de embeddings elegido en su integración.",
    source: "kb_indexing",
  },
  audio_transcription: {
    id: "audio_transcription",
    name: "Transcripción de audio",
    description: "Pasa a texto las notas de voz para que el agente las entienda.",
    icon: "AudioLines",
    configurable: false,
    canTurnOff: false,
    control: { kind: "integration", href: "/dashboard/settings/integrations", label: "Ajustes → Integraciones" },
    instructions: {
      editable: false,
      whyNot: "Usa un modelo de voz a texto (Whisper), que transcribe lo que se dice tal cual: no recibe instrucciones. Se le pasa solo el idioma (español).",
    },
    modelSource: "Un modelo de voz a texto (Whisper) del proveedor de transcripción conectado en Integraciones; si hay más de uno, el preferido y después el otro. El modelo se puede cambiar en la integración.",
    source: "audio_transcription",
  },
  media_description: {
    id: "media_description",
    name: "Descripción de imágenes",
    description: "Describe en una frase lo que se ve en una foto que llega al chat.",
    icon: "ImageIcon",
    configurable: false,
    canTurnOff: false,
    control: { kind: "integration", href: "/dashboard/settings/integrations", label: "Ajustes → Integraciones (OpenAI, Google o Anthropic)" },
    instructions: { editable: true, variables: [] },
    modelSource: "El primer proveedor con visión conectado, en este orden: OpenAI, Google, Anthropic, con su modelo por defecto.",
    source: "media_description",
  },
  ads_analysis: {
    id: "ads_analysis",
    name: "Análisis de anuncios",
    description: "Lee los números de tu cuenta de Meta Ads y dice qué funciona, qué no y qué conviene hacer.",
    icon: "BarChart3",
    configurable: false,
    canTurnOff: false,
    control: { kind: "on_demand", where: "cuando alguien aprieta “Analizar con IA” en el dashboard de Meta Ads" },
    instructions: { editable: true, variables: [ESTILO] },
    modelSource: "El que elijas acá; sin elección, el modelo por defecto del negocio.",
    hasModelPicker: true,
    onDemand: true,
    source: "ads_analysis",
  },
};

/** Tareas nuevas de Llamadas, al final del objeto para no mover el orden de las anteriores. */
const CALL_TASKS: Record<CallTaskId, AiTaskDef> = {
  call_classification: {
    id: "call_classification",
    name: "Clasificación de llamadas",
    description: "Decide de qué tipo es cada llamada (cierre, seguimiento, equipo…) cuando las reglas no alcanzan.",
    icon: "Tags",
    configurable: false,
    canTurnOff: false,
    control: { kind: "on_demand", where: "cuando entra una llamada y ninguna regla decide su tipo" },
    instructions: { editable: true, variables: [{ name: "tipos", description: "las claves de los tipos de llamada válidos (los del sistema y los propios)" }] },
    modelSource: "El que elijas acá; sin elección, el modelo por defecto del negocio. Conviene uno barato.",
    hasModelPicker: true,
    onDemand: true,
    source: "call_classification",
    callTask: "call_classification",
  },
  call_analysis: {
    id: "call_analysis",
    name: "Análisis de llamadas",
    description: "Analiza las llamadas de cierre y seguimiento con la rúbrica del negocio: puntajes, citas, objeciones y feedback.",
    icon: "PhoneCall",
    configurable: false,
    canTurnOff: false,
    control: { kind: "on_demand", where: "cuando una llamada de un tipo que se analiza se analiza (sola o con el botón Analizar)" },
    instructions: { editable: true, variables: [ESTILO] },
    modelSource: "El que elijas acá; sin elección, el modelo por defecto del negocio.",
    hasModelPicker: true,
    onDemand: true,
    source: "call_analysis",
    callTask: "call_analysis",
  },
  call_summary: {
    id: "call_summary",
    name: "Resumen de llamadas",
    description: "Resume la llamada, saca los próximos pasos e ideas de contenido, y actualiza la memoria del contacto.",
    icon: "NotebookPen",
    configurable: false,
    canTurnOff: false,
    control: { kind: "on_demand", where: "después de analizar una llamada (si el resumen automático está prendido), o con el botón Resumir" },
    instructions: { editable: true, variables: [ESTILO, { name: "largo_maximo", description: "el largo máximo de la memoria del contacto, en caracteres" }] },
    modelSource: "El que elijas acá; sin elección, el modelo por defecto del negocio.",
    hasModelPicker: true,
    onDemand: true,
    source: "call_summary",
  },
};
export const AI_TASKS: Record<AiTaskId, AiTaskDef> = { ...BASE_TASKS, ...CALL_TASKS };

/** La etiqueta corta de cómo corre, para la tarjeta de la lista. */
export function controlLabel(task: AiTaskDef): string {
  switch (task.control.kind) {
    case "task":
      return "Modo propio";
    case "agent":
      return "Según cada agente";
    case "integration":
      return "Siempre inmediata";
    case "on_demand":
      return "Bajo demanda";
  }
}

export function getAiTask(id: string): AiTaskDef | null {
  return (AI_TASKS as Record<string, AiTaskDef>)[id] ?? null;
}

/** Las tareas con modo propio editable, en su orden de siempre. */
export const CONFIGURABLE_AI_TASKS: AiTaskDef[] = AI_TASK_IDS.map((id) => AI_TASKS[id]).filter((t) => t.configurable);

/** Todas, en el orden de la pantalla: primero las configurables, después las de sistema. */
export const ALL_AI_TASKS: AiTaskDef[] = AI_TASK_IDS.map((id) => AI_TASKS[id]);
