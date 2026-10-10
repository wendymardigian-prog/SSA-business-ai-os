import type { AiTaskDef } from "./catalog";
import type { BackgroundSettings } from "@/lib/background/settings";
import type { TaskRunInfo } from "@/lib/background/screen";
import type { BackgroundScreenData } from "@/lib/background/screen-data";
import type { TaskPromptVersion } from "./store";
import type { RunsTabData } from "@/lib/agent/screen";
import type { TaskModelChoice } from "./model";

/** Lo que la pantalla de una tarea (Agentes IA) necesita, ya aplanado. */
export interface TaskScreenData {
  task: AiTaskDef;
  lastRun: TaskRunInfo | null;
  /** Solo para las tareas configurables (`task.configurable`). */
  settings: BackgroundSettings | null;
  canTurnOff: boolean;
  canBatch: boolean;
  batchWarning: string | null;
  /** Calidad, revisión rápida y textos de botón. Solo message_classification. */
  quality?: BackgroundScreenData;
  categories?: Array<{ id: string; name: string; direction: string }>;
  /** Solo si `task.hasInstructions`. */
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
  /** Solo cuando la pestaña activa es Corridas. */
  runs?: RunsTabData;
}
