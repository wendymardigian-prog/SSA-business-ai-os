import { describe, it, expect } from "vitest";
import { fingerprint, flowFingerprint, sequenceFingerprint } from "./unsaved-changes";

describe("fingerprint", () => {
  it("no depende del orden de las claves", () => {
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
  });

  it("el orden de un array SI importa", () => {
    expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]));
  });
});

describe("sequenceFingerprint", () => {
  const base = {
    name: "Bienvenida",
    description: "para leads nuevos",
    steps: [{ type: "message" as const, content: "hola" }],
  };

  it("cambiar el nombre, la descripcion o el texto de un paso cuenta como edicion", () => {
    const original = sequenceFingerprint(base);
    expect(sequenceFingerprint({ ...base, name: "Otra" })).not.toBe(original);
    expect(sequenceFingerprint({ ...base, description: "otra cosa" })).not.toBe(original);
    expect(
      sequenceFingerprint({ ...base, steps: [{ type: "message", content: "chau" }] })
    ).not.toBe(original);
  });

  it("reordenar los pasos cuenta: en una secuencia el orden es el contenido", () => {
    const dos = {
      ...base,
      steps: [
        { type: "message" as const, content: "uno" },
        { type: "message" as const, content: "dos" },
      ],
    };
    const alReves = { ...dos, steps: [...dos.steps].reverse() };
    expect(sequenceFingerprint(dos)).not.toBe(sequenceFingerprint(alReves));
  });

  it("los espacios de los bordes no son una edicion", () => {
    expect(sequenceFingerprint({ ...base, name: "  Bienvenida  " })).toBe(
      sequenceFingerprint(base)
    );
  });

  it("descripcion vacia y null son lo mismo", () => {
    expect(sequenceFingerprint({ ...base, description: null })).toBe(
      sequenceFingerprint({ ...base, description: "" })
    );
  });
});

describe("flowFingerprint", () => {
  const nodes = [
    { id: "n1", type: "trigger", position: { x: 0, y: 0 }, data: { keyword: "hola" } },
    { id: "n2", type: "action", position: { x: 100, y: 50 }, data: { text: "buenas" } },
  ];
  const edges = [{ id: "e1", source: "n1", target: "n2" }];
  const original = flowFingerprint(nodes, edges, "Mi flow");

  it("seleccionar un nodo NO es una edicion", () => {
    // React Flow escribe `selected` sobre el objeto del array. Sin normalizar,
    // el aviso de cambios sin guardar aparece con el primer click.
    const conSeleccion = nodes.map((n) => ({ ...n, selected: n.id === "n1" }));
    expect(flowFingerprint(conSeleccion, edges, "Mi flow")).toBe(original);
  });

  it("arrastrar sin soltar tampoco: `dragging` es estado del canvas", () => {
    const arrastrando = nodes.map((n) => ({ ...n, dragging: true }));
    expect(flowFingerprint(arrastrando, edges, "Mi flow")).toBe(original);
  });

  it("las medidas que React Flow calcula al montar tampoco", () => {
    const medidos = nodes.map((n) => ({
      ...n,
      measured: { width: 200, height: 80 },
      width: 200,
      height: 80,
    }));
    expect(flowFingerprint(medidos, edges, "Mi flow")).toBe(original);
  });

  it("reordenar el array de nodos tampoco: React Flow lo reordena al seleccionar", () => {
    expect(flowFingerprint([...nodes].reverse(), edges, "Mi flow")).toBe(original);
  });

  it("mover un nodo SI es una edicion, aunque sea medio pixel", () => {
    const movido = [{ ...nodes[0], position: { x: 0.5, y: 0 } }, nodes[1]];
    expect(flowFingerprint(movido, edges, "Mi flow")).not.toBe(original);
  });

  it("editar la configuracion de un nodo es una edicion", () => {
    const editado = [{ ...nodes[0], data: { keyword: "buenas" } }, nodes[1]];
    expect(flowFingerprint(editado, edges, "Mi flow")).not.toBe(original);
  });

  it("agregar o quitar una conexion es una edicion", () => {
    expect(flowFingerprint(nodes, [], "Mi flow")).not.toBe(original);
    expect(
      flowFingerprint(nodes, [...edges, { id: "e2", source: "n2", target: "n1" }], "Mi flow")
    ).not.toBe(original);
  });

  it("cambiar por que salida sale una conexion es una edicion", () => {
    const otraSalida = [{ ...edges[0], sourceHandle: "true" }];
    expect(flowFingerprint(nodes, otraSalida, "Mi flow")).not.toBe(original);
  });

  it("renombrar el flow es una edicion", () => {
    expect(flowFingerprint(nodes, edges, "Otro nombre")).not.toBe(original);
  });

  it("agregar un nodo es una edicion", () => {
    const conNodo = [...nodes, { id: "n3", type: "action", position: { x: 0, y: 0 }, data: {} }];
    expect(flowFingerprint(conNodo, edges, "Mi flow")).not.toBe(original);
  });
});
