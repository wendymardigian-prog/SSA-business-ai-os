import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkValues } from "@/lib/test-utils/migrations";
import { listNodes, resolveNodeType, listTriggers } from "./index";
import { CONTACT_FREE_NODE_TYPES, MEMBER_TRIGGER_TYPES, SYSTEM_TRIGGER_TYPES } from "../contact-free";
import { AUTOMATION_SOURCE_TYPES } from "./types";
import { NODE_REQUIREMENTS } from "../node-requirements";
import { TRIGGER_CATALOG, TRIGGER_GROUPS } from "../trigger-catalog";

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

describe("el catalogo de disparadores, el registro y la base dicen lo mismo", () => {
  // Antes se leia con una expresion regular el array `triggerTypes` del panel. Desde la auditoria de automatizaciones
  // el catalogo es un modulo propio (lib/flow-engine/trigger-catalog.ts) que usan el selector, el panel y el nodo.
  const ofrecidos = TRIGGER_CATALOG.map((t) => t.type as string);

  it("todo tipo que ofrece el catalogo esta registrado", () => {
    const registrados = new Set(listTriggers().map((t) => t.type));
    const desconocidos = ofrecidos.filter((t) => !registrados.has(t));
    expect(desconocidos, `el catalogo ofrece triggers sin registrar: ${desconocidos.join(", ")}`).toEqual([]);
  });

  it("todo trigger registrado esta en el catalogo (nadie queda sin poder configurarse)", () => {
    const set = new Set(ofrecidos);
    const faltantes = listTriggers()
      .map((t) => t.type)
      .filter((t) => !set.has(t));
    expect(faltantes, `hay triggers que nadie puede configurar: ${faltantes.join(", ")}`).toEqual([]);
  });

  it("el catalogo no repite tipos y cada uno es de un grupo que existe", () => {
    expect(new Set(ofrecidos).size).toBe(ofrecidos.length);
    const grupos = new Set(TRIGGER_GROUPS.map((g) => g.key));
    for (const entry of TRIGGER_CATALOG) expect(grupos.has(entry.group), entry.type).toBe(true);
  });

  it("el CHECK vigente de triggers.type en la base acepta exactamente los tipos del catalogo", () => {
    // La ultima definicion (sin comentarios: las cabeceras copian la vieja para poder volver atras).
    const ultimo = checkValues("triggers_type_check");
    expect(ultimo, "no encontre el CHECK de triggers.type en las migraciones").not.toBeNull();
    expect([...ultimo!.values].sort()).toEqual([...ofrecidos].sort());
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

describe("cada nodo declara si necesita un contacto (EOD, E15)", () => {
  // Un flujo sin contacto (sobre una persona del equipo) saltea los pasos que lo
  // necesitan. Un nodo nuevo que no lo declare no podría decidirse: se exige.
  it("todos los nodos registrados declaran needsContact", () => {
    const sinDeclarar = listNodes()
      .filter((n) => typeof (n as { needsContact?: unknown }).needsContact !== "boolean")
      .map((n) => n.type);
    expect(sinDeclarar).toEqual([]);
  });

  it("los que sirven sin contacto son exactamente los de la lista del navegador", () => {
    const libres = listNodes()
      .filter((n) => !n.needsContact)
      .map((n) => n.type)
      .sort();
    expect(libres).toEqual(["abSplit", "branch", "complete_task", "create_task", "delay", "goToFlow", "httpRequest", "notify_team", "send_email", "send_whatsapp_number", "upsert_contact"]); // @plantilla-quitar(tareas,webhooks)
    // @plantilla-sin(tareas,webhooks): expect(libres).toEqual(["abSplit", "branch", "delay", "goToFlow", "httpRequest", "notify_team", "send_email", "send_whatsapp_number"]);
    expect([...CONTACT_FREE_NODE_TYPES].sort()).toEqual(libres);
  });

  it("los disparadores sin contacto son los de la lista del navegador", () => {
    expect(listTriggers().filter((t) => t.subject === "member").map((t) => t.type)).toEqual([...MEMBER_TRIGGER_TYPES]);
  });
});

describe("que conexion necesita cada accion (G1)", () => {
  // El navegador pinta una accion como bloqueada y el servidor frena la publicacion con la MISMA lista: si el registro
  // y la copia del navegador se separan, la pantalla diria una cosa y el servidor haria otra.
  it("la lista del navegador dice lo mismo que `requires` de cada nodo del registro", () => {
    const delRegistro = Object.fromEntries(
      listNodes()
        .filter((n) => (n.requires ?? []).length > 0)
        .map((n) => [n.type, [...(n.requires ?? [])].sort()]),
    );
    const delNavegador = Object.fromEntries(Object.entries(NODE_REQUIREMENTS).map(([type, req]) => [type, [...req].sort()]));
    expect(delNavegador).toEqual(delRegistro);
  });

  it("toda accion con requisitos esta registrada (no hay un nombre inventado en la lista)", () => {
    const tipos = new Set(listNodes().map((n) => n.type));
    expect(Object.keys(NODE_REQUIREMENTS).filter((t) => !tipos.has(t))).toEqual([]);
  });
});

describe("cada disparador declara el origen de sus sesiones (Tirón 2, D1)", () => {
  // `flow_sessions.source_type` dice QUE disparo el flujo y la base exige contacto u origen. Un disparador nuevo que
  // no lo declare no podria arrancar sin contacto: se exige, y tiene que ser un valor que la base admite.
  it("todos los disparadores registrados declaran sourceType, y es un valor que admite la base", () => {
    const sinDeclarar = listTriggers().filter((t) => !t.sourceType).map((t) => t.type);
    expect(sinDeclarar).toEqual([]);
    for (const t of listTriggers()) expect(AUTOMATION_SOURCE_TYPES).toContain(t.sourceType);
  });

  it("el origen coincide con el sujeto del flujo: persona = member, webhook = webhook, sistema = system", () => {
    for (const t of listTriggers()) {
      if (t.subject === "member") expect(t.sourceType, t.type).toBe("member");
      if (t.subject === "webhook") expect(t.sourceType, t.type).toBe("webhook");
      if (t.subject === "system") expect(t.sourceType, t.type).toBe("system");
    }
  });

  it("los disparadores de sistema son los de la lista del navegador", () => {
    expect(listTriggers().filter((t) => t.subject === "system").map((t) => t.type)).toEqual([...SYSTEM_TRIGGER_TYPES]);
  });

  it("la lista de origenes del codigo es exactamente la del CHECK de la migracion", () => {
    for (const name of ["flow_sessions_source_type_check", "automation_events_source_type_check"]) {
      const check = checkValues(name);
      expect(check, `no encontre el CHECK ${name} en las migraciones`).not.toBeNull();
      expect([...check!.values].sort(), name).toEqual([...AUTOMATION_SOURCE_TYPES].sort());
    }
  });
});
