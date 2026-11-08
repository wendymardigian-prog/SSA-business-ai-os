import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { renderSignatureHeader, signRenderBody, verifyRenderSignature } from "./sign.mjs";

const SECRET = "secreto-de-prueba-con-mas-de-32-bytes-0123456789";
const BODY = JSON.stringify({ html: "<p>hola</p>", width: 100, height: 100, format: "png" });
const NOW = 1_800_000_000;

test("signRenderBody es el HMAC-SHA256 hex de `${t}.${body}`", () => {
  const esperado = createHmac("sha256", SECRET).update(`${NOW}.${BODY}`).digest("hex");
  assert.equal(signRenderBody(BODY, SECRET, NOW), esperado);
  assert.match(signRenderBody(BODY, SECRET, NOW), /^[0-9a-f]{64}$/);
});

test("renderSignatureHeader arma `t=<t>,v1=<hex>`", () => {
  assert.equal(renderSignatureHeader(BODY, SECRET, NOW), `t=${NOW},v1=${signRenderBody(BODY, SECRET, NOW)}`);
});

test("una firma correcta y reciente pasa", () => {
  const header = renderSignatureHeader(BODY, SECRET, NOW);
  assert.equal(verifyRenderSignature(header, BODY, SECRET, NOW), true);
  assert.equal(verifyRenderSignature(header, BODY, SECRET, NOW + 60), true);
  assert.equal(verifyRenderSignature(header, BODY, SECRET, NOW - 60), true);
});

test("una firma de mas de 60 segundos se rechaza (vieja o del futuro)", () => {
  const header = renderSignatureHeader(BODY, SECRET, NOW);
  assert.equal(verifyRenderSignature(header, BODY, SECRET, NOW + 61), false);
  assert.equal(verifyRenderSignature(header, BODY, SECRET, NOW - 61), false);
});

test("un cuerpo o un secreto distintos rompen la firma", () => {
  const header = renderSignatureHeader(BODY, SECRET, NOW);
  assert.equal(verifyRenderSignature(header, BODY + " ", SECRET, NOW), false);
  assert.equal(verifyRenderSignature(header, BODY, SECRET + "x", NOW), false);
});

test("cambiar la marca de tiempo sin refirmar rompe la firma", () => {
  const { v1 } = Object.fromEntries(renderSignatureHeader(BODY, SECRET, NOW).split(",").map((p) => p.split("=")));
  assert.equal(verifyRenderSignature(`t=${NOW + 5},v1=${v1}`, BODY, SECRET, NOW + 5), false);
});

test("sin cabecera, vacia o incompleta se rechaza", () => {
  const v1 = signRenderBody(BODY, SECRET, NOW);
  assert.equal(verifyRenderSignature(null, BODY, SECRET, NOW), false);
  assert.equal(verifyRenderSignature("", BODY, SECRET, NOW), false);
  assert.equal(verifyRenderSignature(`v1=${v1}`, BODY, SECRET, NOW), false);
  assert.equal(verifyRenderSignature(`t=${NOW}`, BODY, SECRET, NOW), false);
  assert.equal(verifyRenderSignature("basura", BODY, SECRET, NOW), false);
});

test("una firma con largo distinto o que no es hex no explota y se rechaza", () => {
  assert.equal(verifyRenderSignature(`t=${NOW},v1=abcd`, BODY, SECRET, NOW), false);
  assert.equal(verifyRenderSignature(`t=${NOW},v1=${"a".repeat(65)}`, BODY, SECRET, NOW), false);
  assert.equal(verifyRenderSignature(`t=${NOW},v1=${"z".repeat(64)}`, BODY, SECRET, NOW), false);
  assert.equal(verifyRenderSignature(`t=abc,v1=${"a".repeat(64)}`, BODY, SECRET, NOW), false);
});

test("sin secreto configurado nunca valida, ni siquiera una firma hecha con secreto vacio", () => {
  const header = renderSignatureHeader(BODY, "", NOW);
  assert.equal(verifyRenderSignature(header, BODY, "", NOW), false);
});
