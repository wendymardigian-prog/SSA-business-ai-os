import type { AiTaskDef } from "./catalog";
import type { BackgroundSettings } from "@/lib/background/settings";
import type { TaskRunInfo } from "@/lib/background/screen";
import type { BackgroundScreenData } from "@/lib/background/screen-data";
import type { TaskPromptVersion } from "./store";
import type { RunsTabData } from "@/lib/agent/screen";
import type { TaskModelChoice } from "./model";
import type { TaskAbout } from "./about";
import type { AgentCloseSettings } from "./agent-close-settings";
import type { CallConfigData } from "@/lib/calls/config-data";

/** Lo que la pantalla de una tarea (Agentes IA) necesita, ya aplanado. */
export interface TaskScreenData {
  task: AiTaskDef;
  /** Pestaña "Cómo funciona": la misma estructura para todas (lib/ai-tasks/about.ts). */
  about: TaskAbout;
  /** Corridas y gasto del mes (cabecera y pestaña Costos). */
  lastRun: TaskRunInfo | null;
  /**
   * Las tareas que se controlan desde cada agente (`control.kind === "agent"`):
   * cómo está cada uno. Pestañas Cómo funciona y Configuración.
   */
  agentClose?: AgentCloseSettings[];
  /** Solo para las tareas con modo propio (`task.configurable`). */
  settings: BackgroundSettings | null;
  canTurnOff: boolean;
  canBatch: boolean;
  batchWarning: string | null;
  /** Calidad, revisión rápida y textos de botón. Solo message_classification. */
  quality?: BackgroundScreenData;
  categories?: Array<{ id: string; name: string; direction: string }>;
  /** Solo si la tarea tiene instrucciones editables, en la pestaña Instrucciones. */
  instructions?: {
    activeVersion: number | null;
    activeText: string;
    defaultText: string;
    versions: TaskPromptVersion[];
    technical: string;
  };
  /** Solo si `task.hasModelPicker`: lo guardado y lo que se puede elegir. */
  model?: {
    current: TaskModelChoice | null;
    picker: {
      providers: Array<{ provider: string; label: string; defaultModel: string; models: string[] }>;
      providerLabels: Record<string, string>;
      pricedModels: string[];
    };
  };
  /** Clasificacion y Analisis de llamadas: su configuracion propia (reglas, rubrica, categorias…). */
  callConfig?: CallConfigData;
  /** Solo cuando la pestaña activa es Corridas. */
  runs?: RunsTabData;
}
