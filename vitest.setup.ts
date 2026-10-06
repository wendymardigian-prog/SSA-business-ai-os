/**
 * Ningun test habla con la red.
 *
 * Un test que arma un cliente de un proveedor y se olvida de simularlo hace
 * pedidos REALES (a Zernio, a Meta, a un proveedor de IA): ya paso una vez, con
 * una clave falsa que Zernio rechazo. Aca `fetch` falla ruidoso en vez de salir,
 * asi el olvido se ve en el test que lo comete y no en la cuenta de un tercero.
 *
 * Un test que SI necesita `fetch` lo simula como siempre
 * (`vi.stubGlobal("fetch", ...)` o `vi.spyOn(globalThis, "fetch")`) y eso pisa
 * esta funcion solo mientras dura.
 */

globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  throw new Error(
    `[tests] fetch real bloqueado: ${url}. Simulalo en el test con vi.stubGlobal("fetch", ...).`,
  );
}) as typeof fetch;
