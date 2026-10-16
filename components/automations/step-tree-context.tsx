"use client";

import { createContext, useContext } from "react";
import type { ConditionCatalogInputs } from "@/lib/automations/condition-catalog-inputs";
import type { EditorScreen } from "@/lib/automations/step-catalog";
import type { ActionStep, StepTree } from "@/lib/automations/step-tree";

/**
 * Lo que comparten todas las piezas del editor de pasos (la lista, las
 * tarjetas, Condiciones): el arbol, como editarlo, y los avisos. Asi ninguna
 * pieza recibe diez props solo para pasarselas a la de abajo.
 */

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
}

export interface StepEditorContextValue {
  screen: EditorScreen;
  tree: StepTree;
  /** Cambia el arbol. La funcion recibe el ultimo (no uno viejo) y devuelve el nuevo. */
  edit: (fn: (tree: StepTree) => StepTree) => void;
  disabled: boolean;
  /** Lo que el servidor sabe para armar Condiciones; `null` mientras carga o si fallo. */
  catalog: ConditionCatalogInputs | null;
  /** "Enviarme este email" de un paso. */
  sendStepTest: (step: ActionStep) => void;
  canSendTest: boolean;
  /** Un aviso corto arriba del editor ("Los pasos que seguian pasaron al primer camino"). */
  announce: (text: string) => void;
  /** Pide confirmacion antes de algo que borra. */
  ask: (request: ConfirmRequest, onConfirm: () => void) => void;
  /** Las personas del equipo (para un email o un aviso a personas elegidas). */
  members: Array<{ userId: string; name: string }>;
  /** Las variables que se pueden usar en esta pantalla (para insertarlas como ficha en el email). */
  variableKeys: string[];
}

const StepEditorContext = createContext<StepEditorContextValue | null>(null);

export const StepEditorProvider = StepEditorContext.Provider;

export function useStepEditor(): StepEditorContextValue {
  const value = useContext(StepEditorContext);
  if (!value) throw new Error("useStepEditor tiene que usarse adentro del editor de pasos");
  return value;
}
