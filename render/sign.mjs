// Firma del pedido de render (HMAC-SHA256 con marca de tiempo).
//
// OJO: este archivo se copia LETRA POR LETRA en SSA (`lib/designer/render-sign.ts`)
// y un test compara las dos copias. Mantenerlo chico, puro y sin dependencias
// (solo `node:crypto`), con exactamente estos nombres y firmas.
import { createHmac, timingSafeEqual } from "node:crypto";

// Hex del HMAC-SHA256 de `${t}.${body}`. `t` son segundos desde epoch.
export function signRenderBody(body, secret, t) {
  return createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
}

// Valor de la cabecera `X-Render-Signature`: "t=<t>,v1=<hex>".
export function renderSignatureHeader(body, secret, t) {
  return `t=${t},v1=${signRenderBody(body, secret, t)}`;
}

// true solo si la cabecera trae `t` y `v1`, la marca no tiene mas de 60 s de
// diferencia con `nowSeconds` y la firma coincide (comparacion en tiempo constante).
export function verifyRenderSignature(header, body, secret, nowSeconds) {
  if (typeof header !== "string" || typeof body !== "string" || typeof secret !== "string") return false;
  if (secret === "") return false;
  let t = null;
  let v1 = null;
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === "t") t = value;
    else if (key === "v1") v1 = value;
  }
  if (t === null || v1 === null) return false;
  if (!/^\d{1,12}$/.test(t)) return false;
  if (!/^[0-9a-f]{64}$/i.test(v1)) return false;
  const ts = Number(t);
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - ts) > 60) return false;
  const expected = Buffer.from(signRenderBody(body, secret, ts), "hex");
  const given = Buffer.from(v1, "hex");
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}
