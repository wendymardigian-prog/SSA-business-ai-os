import { describe, expect, it } from "vitest";
import { MAX_TOASTS, dismissToast, pushToast, toastDurationMs, type ToastItem } from "./toast";

const ok = (text: string) => ({ tone: "ok" as const, text });

describe("los avisos (F95)", () => {
  it("un aviso nuevo entra al final", () => {
    const list = pushToast(pushToast([], ok("uno"), 1), ok("dos"), 2);

    expect(list.map((t) => t.text)).toEqual(["uno", "dos"]);
  });

  it("nunca hay mas de tres: se van los mas viejos", () => {
    let list: ToastItem[] = [];
    for (let i = 1; i <= 5; i++) list = pushToast(list, ok(`aviso ${i}`), i);

    expect(list).toHaveLength(MAX_TOASTS);
    expect(list.map((t) => t.text)).toEqual(["aviso 3", "aviso 4", "aviso 5"]);
  });

  it("el mismo aviso dos veces seguidas no se apila (un doble clic)", () => {
    const list = pushToast(pushToast([], ok("Idea descartada"), 1), ok("Idea descartada"), 2);

    expect(list).toHaveLength(1);
  });

  it("pero el mismo texto con otro tono si es otro aviso", () => {
    const list = pushToast(pushToast([], ok("x"), 1), { tone: "error", text: "x" }, 2);

    expect(list).toHaveLength(2);
  });

  it("se descarta por id", () => {
    const list = pushToast(pushToast([], ok("uno"), 1), ok("dos"), 2);

    expect(dismissToast(list, 1).map((t) => t.text)).toEqual(["dos"]);
  });

  it("lo que hay que leer con calma dura mas", () => {
    expect(toastDurationMs("error")).toBeGreaterThan(toastDurationMs("warning"));
    expect(toastDurationMs("warning")).toBeGreaterThan(toastDurationMs("ok"));
  });

  it("no muta la lista que recibe", () => {
    const list: ToastItem[] = [{ id: 1, tone: "ok", text: "uno" }];
    pushToast(list, ok("dos"), 2);

    expect(list).toHaveLength(1);
  });
});
