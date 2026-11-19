// @plantilla-quitar(servicios)
/**
 * Lo que una ruta `/api/portal/*` le devuelve al portal cuando la base dice que no. Solo pasan los códigos propios
 * del módulo (`PO403`, `SV004`...): un error de Postgres (por ejemplo, un id que no es uuid) sale sin código y con el
 * texto genérico de `svcErrorMessage`, nunca con su detalle interno.
 */
const OWN_CODE = /^(SV|AC|AF|PR|EV|CO|CE|CM|CA|PO)\d{3}$/;

export function portalDenied(error: { code: string | null; message: string }): { ok: false; code: string | null; message: string } {
  const own = !!error.code && OWN_CODE.test(error.code);
  return { ok: false, code: own ? error.code : null, message: own ? error.message : "No se pudo hacer. Probá de nuevo en un rato." };
}
