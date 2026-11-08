// @plantilla-quitar(servicios)
/**
 * El responsable del servicio reusa el formato y la logica de la asignacion de Ventas (lib/assignment, F96).
 * La gemela SQL de las condiciones es app_servicio.svc_conditions_match; los casos son compartidos.
 */
import { describe, expect, it } from "vitest";
import { evaluateConditions } from "@/lib/assignment/conditions";
import type { ConditionTree } from "@/lib/conditions/conditions-schema";
import cases from "./conditions.cases.json";

describe("condiciones del responsable (lib/assignment ↔ svc_conditions_match)", () => {
  for (const c of cases.cases) {
    it(c.name, () => expect(evaluateConditions(c.tree as ConditionTree, c.context as Record<string, string>)).toBe(c.expected));
  }
});
