import { describe, expect, it } from "vitest";
import { FORMATS } from "../formats";
import {
  DRAG_THRESHOLD_PX,
  guideStyle,
  guideTone,
  handleStyle,
  outlineStyle,
  handlesFor,
  keyboardNudge,
  marqueeBox,
  passedThreshold,
  pointToPct,
  rectCenter,
  rectToBox,
  safeInset,
  startCorner,
  startMove,
  startRotate,
  startSide,
  updateCorner,
  updateMove,
  updateRotate,
  updateSide,
  type PageGeometry,
} from "./canvas-session";

// Un cuadrado de 1000 px de diseño mostrado a la mitad (500 px en pantalla): 10 px de pantalla = 20 px de diseño = 2 %.
const geometry: PageGeometry = { width: 1000, height: 1000, scale: 0.5, safeZone: { top: 6, right: 6, bottom: 6, left: 6 } };
const at = (x: number, y: number) => ({ x, y });

describe("mover (F19)", () => {
  const session = (x: number, y: number, others: Parameters<typeof startMove>[0]["others"] = []) =>
    startMove({ geometry, pointer: at(0, 0), boxes: { el_a: { x, y, w: 20, h: 10 } }, others })!;

  it("convierte píxeles de pantalla en porcentaje de la página con la escala del zoom", () => {
    const moved = updateMove(session(30, 30), at(10, 20), { alt: true })!;
    // 10 px de pantalla = 2 % ; 20 px = 4 %.
    expect(moved.result.patches.el_a).toEqual({ x: 32, y: 34 });
  });

  it("a más zoom, el mismo movimiento en pantalla es menos porcentaje", () => {
    const zoomed = startMove({ geometry: { ...geometry, scale: 2 }, pointer: at(0, 0), boxes: { el_a: { x: 30, y: 30, w: 20, h: 10 } }, others: [] })!;
    expect(updateMove(zoomed, at(10, 0), { alt: true })!.result.patches.el_a).toEqual({ x: 30.5, y: 30 });
  });

  it("sigue siendo un clic hasta pasar el umbral (no hay arrastre por un temblor)", () => {
    const s = session(30, 30);
    expect(updateMove(s, at(DRAG_THRESHOLD_PX, 0), { alt: false })).toBeNull();
    expect(updateMove(s, at(DRAG_THRESHOLD_PX + 1, 0), { alt: false })).not.toBeNull();
    // Una vez que empezó, ya no vuelve a ser clic aunque regrese al origen.
    const started = updateMove(s, at(20, 0), { alt: true })!.session;
    expect(updateMove(started, at(0, 0), { alt: true })).not.toBeNull();
  });

  it("se pega al centro de la página dentro de la tolerancia y no fuera de ella", () => {
    // El centro de x está en 50; el elemento empieza en 49 y se arrastra 1 % (10 px de pantalla = 2 %: 51).
    const near = updateMove(session(48.5, 30), at(10, 0), { alt: false })!;
    expect(near.result.patches.el_a).toMatchObject({ x: 50 });
    expect(near.result.guides).toContainEqual({ axis: "x", at: 50, kind: "center" });
    const far = updateMove(session(30, 30), at(10, 0), { alt: false })!;
    expect(far.result.patches.el_a).toMatchObject({ x: 32 });
    expect(far.result.guides.filter((g) => g.axis === "x")).toEqual([]);
  });

  it("con Alt no hay imanes ni guías", () => {
    const moved = updateMove(session(48.5, 30), at(10, 0), { alt: true })!;
    expect(moved.result.patches.el_a).toMatchObject({ x: 50.5 });
    expect(moved.result.guides).toEqual([]);
  });

  it("se pega a los márgenes de seguridad con la guía celeste y al centro de otro elemento con la rosa", () => {
    // El borde izquierdo (x - w/2 = 6 + 1 después de moverse) cae sobre el margen de 6 %.
    const margin = updateMove(session(17, 30), at(-1 * 11, 0), { alt: false })!;
    expect(margin.result.patches.el_a).toMatchObject({ x: 16 });
    expect(margin.result.guides).toContainEqual({ axis: "x", at: 6, kind: "margin" });
    expect(guideTone({ axis: "x", at: 6, kind: "margin" })).toBe("cyan");
    const other = updateMove(session(70, 30, [{ x: 72, y: 80, w: 20, h: 10 }]), at(7, 0), { alt: false })!;
    expect(other.result.patches.el_a).toMatchObject({ x: 72 });
    expect(guideTone(other.result.guides[0])).toBe("pink");
  });

  it("se pega en x y en y a la vez", () => {
    const moved = updateMove(session(48.5, 48.5), at(10, 10), { alt: false })!;
    expect(moved.result.patches.el_a).toEqual({ x: 50, y: 50 });
    expect(moved.result.guides.map((g) => g.axis).sort()).toEqual(["x", "y"]);
  });

  it("mueve un grupo como una sola pieza y deja el centro dentro de la página", () => {
    const group = startMove({
      geometry,
      pointer: at(0, 0),
      boxes: { el_a: { x: 20, y: 20, w: 10, h: 10 }, el_b: { x: 90, y: 20, w: 10, h: 10 } },
      others: [],
    })!;
    const moved = updateMove(group, at(200, 0), { alt: true })!;
    // 200 px de pantalla = 40 %: el segundo se pasaría de 100 y se queda en el borde.
    expect(moved.result.patches.el_a).toMatchObject({ x: 60 });
    expect(moved.result.patches.el_b).toMatchObject({ x: 100 });
  });

  it("sin nada que mover no hay gesto", () => {
    expect(startMove({ geometry, pointer: at(0, 0), boxes: {}, others: [] })).toBeNull();
  });
});

describe("cambiar el tamaño (F19)", () => {
  const box = { x: 50, y: 50, w: 40, h: 20 };

  it("el lado derecho agranda el ancho y deja quieto el izquierdo", () => {
    const { result } = updateSide(startSide({ geometry, pointer: at(0, 0), id: "el_a", side: "right", box }), at(50, 0));
    // 50 px = 10 %: el ancho pasa de 40 a 50 y el centro se corre 5.
    expect(result.patches.el_a).toEqual({ x: 55, w: 50 });
  });

  it("el lado izquierdo hacia afuera (a la izquierda) agranda y deja quieto el derecho", () => {
    const { result } = updateSide(startSide({ geometry, pointer: at(0, 0), id: "el_a", side: "left", box }), at(-50, 0));
    expect(result.patches.el_a).toEqual({ x: 45, w: 50 });
  });

  it("arriba y abajo cambian el alto (imágenes y formas)", () => {
    const bottom = updateSide(startSide({ geometry, pointer: at(0, 0), id: "el_a", side: "bottom", box }), at(0, 50)).result.patches.el_a;
    expect(bottom).toEqual({ y: 55, h: 30 });
    const top = updateSide(startSide({ geometry, pointer: at(0, 0), id: "el_a", side: "top", box }), at(0, -50)).result.patches.el_a;
    expect(top).toEqual({ y: 45, h: 30 });
  });

  it("el ancho no baja de 1 % ni pasa de 100 %", () => {
    const small = updateSide(startSide({ geometry, pointer: at(0, 0), id: "el_a", side: "right", box }), at(-5000, 0)).result.patches.el_a as { w: number };
    expect(small.w).toBe(1);
    const big = updateSide(startSide({ geometry, pointer: at(0, 0), id: "el_a", side: "right", box }), at(5000, 0)).result.patches.el_a as { w: number };
    expect(big.w).toBe(100);
  });

  it("la esquina de un texto cambia la letra en proporción y deja quieta la esquina de arriba a la izquierda", () => {
    const session = startCorner({ geometry, pointer: at(0, 0), id: "el_t", box: { x: 50, y: 50, w: 40, h: 10 }, fontSize: 60 });
    const { result } = updateCorner(session, at(100, 0)); // +20 % de ancho → x1,5
    const patch = result.patches.el_t as { w: number; size: number; x: number; y: number };
    expect(patch.w).toBe(60);
    expect(patch.size).toBe(90);
    expect(patch.x).toBe(60); // el centro se corre la mitad de lo que creció
    expect(patch.y).toBe(52.5); // y la mitad de lo que creció el alto (10 → 15)
  });

  it("la esquina de una imagen la escala manteniendo la proporción", () => {
    const session = startCorner({ geometry, pointer: at(0, 0), id: "el_i", box: { x: 40, y: 40, w: 20, h: 10 } });
    const patch = updateCorner(session, at(50, 0)).result.patches.el_i as { w: number; h: number };
    expect(patch.w).toBe(30);
    expect(patch.h).toBe(15);
    expect(patch.w / patch.h).toBeCloseTo(2);
  });
});

describe("rotar (F19)", () => {
  const session = startRotate({ id: "el_a", center: at(100, 100) });

  it("el ángulo sale de dónde está el puntero respecto del centro (arriba = 0°)", () => {
    expect(updateRotate(session, at(100, 20), { shift: false }).result.patches.el_a).toEqual({ rotation: undefined });
    expect(updateRotate(session, at(180, 100), { shift: false }).result.patches.el_a).toEqual({ rotation: 90 });
    expect(updateRotate(session, at(100, 180), { shift: false }).result.patches.el_a).toEqual({ rotation: 180 });
    expect(updateRotate(session, at(20, 100), { shift: false }).result.patches.el_a).toEqual({ rotation: -90 });
  });

  it("con Shift va de a 15°", () => {
    const patch = updateRotate(session, at(150, 60), { shift: true }).result.patches.el_a as { rotation: number };
    expect(patch.rotation % 15).toBe(0);
    expect(patch.rotation).toBe(45);
    const free = updateRotate(session, at(130, 40), { shift: false }).result.patches.el_a as { rotation: number };
    expect(free.rotation % 15).not.toBe(0);
  });
});

describe("asas de la selección", () => {
  it("miden lo mismo en pantalla a cualquier zoom (con la escala inversa)", () => {
    expect(handleStyle("corner", 1).width).toBe("16px");
    expect(handleStyle("corner", 2).width).toBe("32px");
    expect(handleStyle("left", 0.5).height).toBe("13px");
    expect(outlineStyle(2).border).toContain("4px");
  });

  it("cada asa tiene su cursor", () => {
    expect(handleStyle("left", 1).cursor).toBe("ew-resize");
    expect(handleStyle("top", 1).cursor).toBe("ns-resize");
    expect(handleStyle("corner", 1).cursor).toBe("nwse-resize");
    expect(handleStyle("rotate", 1).cursor).toBe("grab");
  });
});

describe("del DOM a porcentajes (F18, F19)", () => {
  const page = { left: 100, top: 50, width: 500, height: 500 };

  it("el puntero en la página, en %", () => {
    expect(pointToPct(at(350, 300), page)).toEqual({ x: 50, y: 50 });
    expect(pointToPct(at(100, 50), page)).toEqual({ x: 0, y: 0 });
    expect(pointToPct(at(0, 0), page).x).toBeLessThan(0);
  });

  it("el rectángulo de selección se arrastra desde cualquier esquina y se corta a la página", () => {
    const a = marqueeBox(at(200, 150), at(300, 250), page);
    expect(a).toEqual({ x: 30, y: 30, w: 20, h: 20 });
    expect(marqueeBox(at(300, 250), at(200, 150), page)).toEqual(a);
    const out = marqueeBox(at(0, 0), at(350, 300), page);
    expect(out).toEqual({ x: 25, y: 25, w: 50, h: 50 });
  });

  it("la caja de un elemento del DOM en % de la página (alto real de un texto)", () => {
    expect(rectToBox({ left: 200, top: 100, width: 100, height: 50 }, page)).toEqual({ x: 30, y: 15, w: 20, h: 10 });
    expect(rectCenter({ left: 10, top: 20, width: 100, height: 40 })).toEqual({ x: 60, y: 40 });
  });

  it("el umbral para que un toque deje de ser un clic", () => {
    expect(passedThreshold(at(0, 0), at(2, 1))).toBe(false);
    expect(passedThreshold(at(0, 0), at(4, 1))).toBe(true);
  });
});

describe("teclado y asas (F19)", () => {
  it("las flechas mueven 0,5 % y con Shift 2 %, sin tocar lo bloqueado", () => {
    const els = [
      { id: "el_a", x: 50, y: 50, locked: undefined },
      { id: "el_b", x: 10, y: 10, locked: true },
    ];
    expect(keyboardNudge(els, "right", false)).toEqual({ el_a: { x: 50.5, y: 50 } });
    expect(keyboardNudge(els, "up", true)).toEqual({ el_a: { x: 50, y: 48 } });
  });

  it("cada tipo tiene sus asas; un bloqueado, ninguna", () => {
    expect(handlesFor({ type: "text" })).toEqual(["left", "right", "corner", "rotate"]);
    expect(handlesFor({ type: "image" })).toContain("top");
    expect(handlesFor({ type: "shape", shape: "line" })).toEqual(["left", "right", "rotate"]);
    expect(handlesFor({ type: "shape", shape: "rect" })).toContain("corner");
    expect(handlesFor({ type: "html" })).not.toContain("rotate");
    expect(handlesFor({ type: "text", locked: true })).toEqual([]);
  });

  it("la zona segura y las guías se escriben como CSS", () => {
    expect(safeInset(FORMATS.sq.safeZone)).toBe("6% 6% 6% 6%");
    expect(safeInset(FORMATS.story.safeZone)).toBe("13.02% 6% 17.71% 6%");
    expect(guideStyle({ axis: "x", at: 50, kind: "center" })).toMatchObject({ left: "50%", top: "0" });
    expect(guideStyle({ axis: "y", at: 6, kind: "margin" })).toMatchObject({ top: "6%", left: "0" });
  });
});
