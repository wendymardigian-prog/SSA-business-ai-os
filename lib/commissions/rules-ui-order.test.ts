import { describe, expect, it, vi } from "vitest";
import { applyDrop, createOrderSaver, isLowerHalf, moveAnnouncement } from "./rules-ui-order";

describe("applyDrop", () => {
  const ids = ["a", "b", "c", "d"];
  it("antes o después de la fila de destino", () => {
    expect(applyDrop(ids, "d", "b", false)).toEqual(["a", "d", "b", "c"]);
    expect(applyDrop(ids, "a", "c", true)).toEqual(["b", "c", "a", "d"]);
    expect(applyDrop(ids, "a", "d", true)).toEqual(["b", "c", "d", "a"]);
    expect(applyDrop(ids, "d", "a", false)).toEqual(["d", "a", "b", "c"]);
  });
  it("soltarla sobre sí misma, o con ids que no existen, no cambia nada", () => {
    expect(applyDrop(ids, "b", "b", true)).toEqual(ids);
    expect(applyDrop(ids, "x", "b", true)).toEqual(ids);
    expect(applyDrop(ids, "a", "x", true)).toEqual(ids);
  });
  it("no muta la lista original", () => {
    const copy = [...ids];
    applyDrop(ids, "a", "d", true);
    expect(ids).toEqual(copy);
  });
});

describe("isLowerHalf y moveAnnouncement", () => {
  it("la mitad de abajo", () => {
    expect(isLowerHalf(30, 40)).toBe(true);
    expect(isLowerHalf(10, 40)).toBe(false);
    expect(isLowerHalf(10, 0)).toBe(false);
  });
  it("el aviso", () => {
    expect(moveAnnouncement("Vendedor 8 %", 2, 5)).toBe("«Vendedor 8 %» movida al lugar 2 de 5");
    expect(moveAnnouncement("  ", 1, 3)).toBe("La regla movida al lugar 1 de 3");
  });
});

describe("createOrderSaver", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("guarda el orden pedido y avisa cuando queda libre", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    const onIdle = vi.fn();
    const saver = createOrderSaver(["a", "b"], { save, onFail: vi.fn(), onIdle });
    saver.request(["b", "a"]);
    await flush();
    expect(save).toHaveBeenCalledWith(["b", "a"]);
    expect(saver.committed()).toEqual(["b", "a"]);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("nunca guarda en paralelo: mientras uno corre, solo queda el último pedido", async () => {
    const releases: Array<() => void> = [];
    let running = 0;
    let maxRunning = 0;
    const save = vi.fn(
      (ids: string[]) =>
        new Promise<{ ok: true }>((resolve) => {
          void ids;
          running++;
          maxRunning = Math.max(maxRunning, running);
          releases.push(() => {
            running--;
            resolve({ ok: true });
          });
        }),
    );
    const saver = createOrderSaver(["a", "b", "c"], { save, onFail: vi.fn() });
    saver.request(["b", "a", "c"]);
    saver.request(["b", "c", "a"]);
    saver.request(["c", "b", "a"]);
    expect(save).toHaveBeenCalledTimes(1);
    releases[0]();
    await flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(["c", "b", "a"]);
    releases[1]();
    await flush();
    expect(maxRunning).toBe(1);
    expect(saver.committed()).toEqual(["c", "b", "a"]);
  });

  it("si uno falla, vuelve al último orden confirmado y descarta lo que quedaba en cola", async () => {
    const results = [{ ok: true as const }, { ok: false as const, error: "Las reglas cambiaron" }];
    const save = vi.fn(async () => results.shift()!);
    const onFail = vi.fn();
    const saver = createOrderSaver(["a", "b", "c"], { save, onFail });
    saver.request(["b", "a", "c"]);
    await flush();
    saver.request(["c", "b", "a"]);
    await flush();
    expect(onFail).toHaveBeenCalledWith(["b", "a", "c"], "Las reglas cambiaron");
    expect(saver.committed()).toEqual(["b", "a", "c"]);
  });

  it("una excepción de la acción también cuenta como falla", async () => {
    const onFail = vi.fn();
    const saver = createOrderSaver(["a", "b"], { save: async () => { throw new Error("red"); }, onFail });
    saver.request(["b", "a"]);
    await flush();
    expect(onFail).toHaveBeenCalledWith(["a", "b"], expect.stringContaining("No pude guardar"));
  });

  it("después de una falla se puede volver a pedir", async () => {
    const results = [{ ok: false as const, error: "x" }, { ok: true as const }];
    const save = vi.fn(async () => results.shift()!);
    const saver = createOrderSaver(["a", "b"], { save, onFail: vi.fn() });
    saver.request(["b", "a"]);
    await flush();
    saver.request(["b", "a"]);
    await flush();
    expect(saver.committed()).toEqual(["b", "a"]);
  });

  it("usa siempre los últimos pasos configurados", async () => {
    const first = vi.fn(async () => ({ ok: true as const }));
    const second = vi.fn(async () => ({ ok: true as const }));
    const saver = createOrderSaver(["a", "b"], { save: first, onFail: vi.fn() });
    saver.configure({ save: second, onFail: vi.fn() });
    saver.request(["b", "a"]);
    await flush();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(["b", "a"]);
  });
});
