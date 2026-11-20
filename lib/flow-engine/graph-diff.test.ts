import { describe, expect, it } from "vitest";
import { diffGraphs } from "./graph-diff";

const label = (n: { type?: string; data?: Record<string, unknown> | null }) => (n.type === "trigger" ? "Disparador" : String(n.data?.label ?? n.type));
const T = { id: "trigger", type: "trigger", data: { triggerType: "sale_created" }, position: { x: 0, y: 0 } };
const A = { id: "a", type: "sendMessage", data: { label: "Bienvenida", text: "Hola" }, position: { x: 0, y: 100 } };
const B = { id: "b", type: "delay", data: { label: "Esperar 1 día", amount: 1 } };
const e = (source: string, target: string) => ({ id: `${source}-${target}`, source, target });

describe("diffGraphs", () => {
  it("sin cambios (mover un paso no cuenta)", () => {
    const d = diffGraphs({ nodes: [T, A], edges: [e("trigger", "a")] }, { nodes: [T, { ...A, position: { x: 99, y: 99 }, selected: true }], edges: [e("trigger", "a")] }, label);
    expect(d.empty).toBe(true);
  });
  it("agregado, cambiado y borrado", () => {
    const d = diffGraphs({ nodes: [T, A, B], edges: [e("trigger", "a"), e("a", "b")] }, { nodes: [T, { ...A, data: { ...A.data, text: "Hola!" } }, { id: "c", type: "sendEmail", data: { label: "Email" } }], edges: [e("trigger", "a"), e("a", "c")] }, label);
    expect(d.marks).toEqual({ a: "changed", c: "added" });
    expect(d.items.map((i) => i.text)).toEqual(["«Bienvenida»: cambió el texto", "Se agregó «Email»", "Se borró «Esperar 1 día»"]);
  });
  it("el disparador y su «Solo si…»", () => {
    const d = diffGraphs({ nodes: [T], edges: [] }, { nodes: [{ ...T, data: { ...T.data, onlyIf: { logic: "and", conditions: [] } } }], edges: [] }, label);
    expect(d.items[0]).toMatchObject({ kind: "changed", nodeId: "trigger", text: "Cambió el disparador (el «Solo si…»)" });
  });
  it("conexiones nuevas y quitadas entre pasos que siguen", () => {
    const d = diffGraphs({ nodes: [T, A, B], edges: [e("trigger", "a")] }, { nodes: [T, A, B], edges: [e("trigger", "b")] }, label);
    expect(d.items.map((i) => i.kind)).toEqual(["connected", "disconnected"]);
    expect(d.marks).toEqual({});
  });
});
