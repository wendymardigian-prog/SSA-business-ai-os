import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { listNodes, resolveNodeType, listTriggers } from "./index";

/**
 * Guardia contra la desincronizacion entre la UI y el motor.
 *
 * El bug que originó todo esto no fue que alguien escribiera mal un nodo: fue
 * que la lista de tipos vivia en siete lugares (cinco en la UI, el switch del
 * motor y el del simulador) y se separaron sin que nada avisara. El motor ya no
 * tiene la suya, pero la UI y el simulador siguen con las propias porque corren
 * en el navegador y no pueden importar codigo de servidor.
 *
 * Estos tests leen esos archivos como texto y comparan contra el registro. Si
 * alguien suma un nodo al panel y se olvida de registrarlo —o al reves— falla
 * aca y no en produccion tres semanas despues.
 */

function leer(rutaRelativa: string): string {
  return readFileSync(resolve(__dirname, "../../..", rutaRelativa), "utf8");
}

describe("el panel de nodos y el registro dicen lo mismo", () => {
  const palette = leer("components/flow-builder/node-palette.tsx");

  it("todo actionType del panel esta registrado", () => {
    const actionTypes = [...palette.matchAll(/actionType:\s*"([^"]+)"/g)].map((m) => m[1]);

    expect(actionTypes.length).toBeGreaterThan(0);

    for (const actionType of new Set(actionTypes)) {
      const resuelto = resolveNodeType({ type: "action", data: { actionType } });
      expect(resuelto, `el panel ofrece "${actionType}" y el registro no lo conoce`).toBe(
        actionType
      );
    }
  });

  it("todo nodo del panel con tipo directo esta registrado", () => {
    const tipos = [...palette.matchAll(/^\s*type:\s*"([^"]+)"/gm)].map((m) => m[1]);
    const directos = tipos.filter((t) => t !== "action" && t !== "trigger");

    for (const type of new Set(directos)) {
      expect(
        resolveNodeType({ type: type, data: {} }),
        `el panel ofrece "${type}" y el registro no lo conoce`
      ).toBe(type);
    }
  });
});

describe("el simulador y el registro dicen lo mismo", () => {
  const simulator = leer("lib/flow-engine/simulator.ts");

  it("el simulador conoce todos los nodos registrados", () => {
    // El simulador agrupa los de accion bajo case "action", igual que el canvas.
    const faltantes = listNodes()
      .map((n) => n.type)
      .filter((type) => !simulator.includes(`"${type}"`));

    expect(faltantes, `el simulador no menciona: ${faltantes.join(", ")}`).toEqual([]);
  });
});

describe("el editor de triggers y el registro dicen lo mismo", () => {
  const panel = leer("components/flow-builder/panels/TriggerPanel.tsx");

  it("todo tipo de trigger que ofrece el editor esta registrado", () => {
    // Solo el array triggerTypes: el panel tiene otras listas con la misma
    // forma (los eventos de CRM, los tipos de coincidencia) que no son tipos
    // de trigger.
    const bloque = panel.match(/const triggerTypes[^=]*=\s*\[([\s\S]*?)\n\];/);
    expect(bloque, "no encontre el array triggerTypes en el panel").not.toBeNull();

    const tipos = [...bloque![1].matchAll(/value:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(tipos.length).toBeGreaterThan(0);

    const registrados = new Set(listTriggers().map((t) => t.type));
    const desconocidos = tipos.filter((t) => !registrados.has(t));

    expect(desconocidos, `el editor ofrece triggers sin registrar: ${desconocidos.join(", ")}`).toEqual(
      []
    );
  });

  it("todo trigger registrado se puede configurar desde el editor", () => {
    const bloque = panel.match(/const triggerTypes[^=]*=\s*\[([\s\S]*?)\n\];/);
    const ofrecidos = new Set(
      [...bloque![1].matchAll(/value:\s*"([^"]+)"/g)].map((m) => m[1])
    );

    const faltantes = listTriggers()
      .map((t) => t.type)
      .filter((t) => !ofrecidos.has(t));

    expect(faltantes, `hay triggers que nadie puede configurar: ${faltantes.join(", ")}`).toEqual(
      []
    );
  });
});

describe("las salidas del nodo Condition y las que busca el motor coinciden", () => {
  /**
   * El bug: el nodo dibujaba sus handles como "yes"/"no" y el motor buscaba la
   * arista por "true"/"false". Una condicion armada a mano en el builder no
   * ramificaba nunca — la arista no se encontraba, nextEdge quedaba undefined y
   * el flow se cerraba en silencio. Solo andaban las de template, que ya
   * guardaban "true"/"false".
   */
  const nodo = leer("components/flow-builder/nodes/condition-node.tsx");
  const nodoLogico = leer("lib/flow-engine/nodes/condition.ts");

  it("el nodo visual declara los handles que devuelve el nodo logico", () => {
    const handlesDelCanvas = [...nodo.matchAll(/id="(true|false|yes|no)"/g)].map((m) => m[1]);
    expect(handlesDelCanvas).toEqual(["true", "false"]);

    const handlesDelMotor = [...nodoLogico.matchAll(/handle:(true|false)/g)].map((m) => m[1]);
    expect(new Set(handlesDelMotor)).toEqual(new Set(["true", "false"]));
  });

  it("el motor sigue aceptando los ids viejos, para no romper los flows ya dibujados", () => {
    const engine = leer("lib/flow-engine/engine.ts");
    expect(engine).toContain("HANDLE_ALIASES");
    expect(engine).toMatch(/yes:\s*"true"/);
    expect(engine).toMatch(/no:\s*"false"/);
  });
});
