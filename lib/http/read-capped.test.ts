import { describe, it, expect } from "vitest";
import { declaresMoreThan, readBytesCapped } from "./read-capped";

/** Un cuerpo que se entrega de a pedazos y cuenta cuántos se leyeron (para probar que se corta). */
function streamingRequest(chunks: number, chunkSize: number) {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks) return controller.close();
      pulled += 1;
      controller.enqueue(new Uint8Array(chunkSize));
    },
  }, { highWaterMark: 0 });
  const request = new Request("https://app.test/x", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  return { request, pulled: () => pulled };
}

describe("readBytesCapped", () => {
  it("lee un cuerpo chico entero", async () => {
    const out = await readBytesCapped(new Request("https://app.test/x", { method: "POST", body: "hola" }), 100);
    expect(out.ok && new TextDecoder().decode(out.bytes)).toBe("hola");
  });

  it("si DECLARA más del tope, 'tooLarge' sin leer nada", async () => {
    const { request, pulled } = streamingRequest(10, 1024);
    request.headers.set("content-length", String(10 * 1024));
    expect(declaresMoreThan(request.headers, 1024)).toBe(true);
    expect(await readBytesCapped(request, 1024)).toEqual({ ok: false, tooLarge: true });
    expect(pulled()).toBe(0);
  });

  it("sin tamaño declarado corta apenas se pasa: no lee el resto", async () => {
    const { request, pulled } = streamingRequest(1000, 1024);
    expect(await readBytesCapped(request, 4 * 1024)).toEqual({ ok: false, tooLarge: true });
    expect(pulled()).toBeLessThan(10);
  });
});
