#!/usr/bin/env node
// @plantilla-quitar(servicios)
/**
 * Verificacion del tope por sesion del portal (00403): cuenta PANTALLAS (portal_context), no llamadas.
 *  - 80 llamadas a otra funcion del portal (portal_session_get) no suman nada ni dan PO429;
 *  - 60 portal_context en el mismo minuto pasan y la 61 da PO429;
 *  - con el tope pasado, las otras funciones siguen andando (solo cuenta la pantalla);
 *  - una cuenta suspendida da PO402 y una sesion cerrada PO401 antes que el tope;
 *  - los topes de entrar no cambian (el sexto codigo en la hora se rechaza).
 *
 *   node scripts/verify-portal-rate-limit.mjs            # contra la base, con la 00403 ya aplicada
 *   node scripts/verify-portal-rate-limit.mjs --ensayo   # corre la 00403 adentro de la misma transaccion
 *
 * Todo va en UNA transaccion que se deshace sola (BEGIN ... ROLLBACK): no deja nada en la base, ni con --ensayo.
 * Usa el primer negocio con el portal prendido; si no hay ninguno, no prueba nada y lo dice.
 * Se corre de a uno, con el candado de los verify-* (/private/tmp/ssa-verify.lock).
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dbTargetArgs } from "./lib/db-target.mjs";

const ENSAYO = process.argv.includes("--ensayo");
const MIGRATION = "supabase/migrations/00403_portal_rate_limit_per_page.sql";

let failures = 0;
const check = (cond, m, extra) => {
  if (cond) console.log("  ok  ", m);
  else {
    console.error("  FALLA", m, extra ? `\n        ${extra}` : "");
    failures++;
  }
};

const body = `
CREATE TEMP TABLE zz_tope (k text PRIMARY KEY, v text) ON COMMIT DROP;
DO $zz$
DECLARE
  v_ws uuid; v_host text; v_contact uuid; v_acc uuid; v_tok text; v_sid text;
  i int; v_ok int; v_code text; v_first_fail int;
BEGIN
  SELECT w.id, w.portal_settings ->> 'host' INTO v_ws, v_host FROM public.workspaces w
   WHERE NULLIF(w.portal_settings ->> 'host', '') IS NOT NULL AND app_servicio.module_on(w.id)
   ORDER BY w.created_at LIMIT 1;
  IF v_ws IS NULL THEN INSERT INTO zz_tope VALUES ('skip', 'ningun negocio con el portal prendido'); RETURN; END IF;

  INSERT INTO public.contacts (workspace_id, display_name, email)
  VALUES (v_ws, 'zz-test tope del portal', 'zz-test-tope-portal-' || replace(gen_random_uuid()::text, '-', '') || '@example.test')
  RETURNING id INTO v_contact;
  INSERT INTO app_servicio_portal.portal_accounts (workspace_id, contact_id, email, status)
  VALUES (v_ws, v_contact, (SELECT email FROM public.contacts WHERE id = v_contact), 'active') RETURNING id INTO v_acc;
  v_tok := app_servicio_portal.session_new(v_ws, v_acc, 'student', interval '1 day', 'zz-test', 'zz-test');
  SELECT id::text INTO v_sid FROM app_servicio_portal.portal_sessions WHERE token_hash = app_servicio.portal_token_hash(v_tok);

  -- 1. 80 llamadas a una funcion que no es la pantalla.
  v_ok := 0; v_code := NULL;
  FOR i IN 1..80 LOOP
    BEGIN
      PERFORM app_servicio_portal.portal_session_get(v_tok); v_ok := v_ok + 1;
    EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
    END;
  END LOOP;
  INSERT INTO zz_tope VALUES ('otras_ok', v_ok::text), ('otras_error', COALESCE(v_code, '')),
    ('otras_contador', COALESCE((SELECT count::text FROM public.rate_limits WHERE key = 'portal-s:' || v_sid), '0'));

  -- 2. portal_context hasta pasarse.
  v_ok := 0; v_code := NULL; v_first_fail := NULL;
  FOR i IN 1..61 LOOP
    BEGIN
      PERFORM app_servicio_portal.portal_context(v_tok, v_host, NULL); v_ok := v_ok + 1;
    EXCEPTION WHEN OTHERS THEN
      v_code := SQLSTATE; IF v_first_fail IS NULL THEN v_first_fail := i; END IF;
    END;
  END LOOP;
  INSERT INTO zz_tope VALUES ('pantallas_ok', v_ok::text), ('pantallas_error', COALESCE(v_code, '')),
    ('pantallas_primera_falla', COALESCE(v_first_fail::text, ''));

  -- 3. Con el tope pasado, lo demas anda.
  BEGIN
    PERFORM app_servicio_portal.portal_session_get(v_tok); INSERT INTO zz_tope VALUES ('despues_otras', 'ok');
  EXCEPTION WHEN OTHERS THEN INSERT INTO zz_tope VALUES ('despues_otras', SQLSTATE);
  END;

  -- 4. Suspendida y cerrada: su error antes que el tope.
  UPDATE app_servicio_portal.portal_accounts SET status = 'suspended' WHERE id = v_acc;
  BEGIN
    PERFORM app_servicio_portal.portal_context(v_tok, v_host, NULL); INSERT INTO zz_tope VALUES ('suspendida', 'ok');
  EXCEPTION WHEN OTHERS THEN INSERT INTO zz_tope VALUES ('suspendida', SQLSTATE);
  END;
  UPDATE app_servicio_portal.portal_accounts SET status = 'active' WHERE id = v_acc;
  UPDATE app_servicio_portal.portal_sessions SET revoked_at = now() WHERE id = v_sid::uuid;
  BEGIN
    PERFORM app_servicio_portal.portal_context(v_tok, v_host, NULL); INSERT INTO zz_tope VALUES ('cerrada_pantalla', 'ok');
  EXCEPTION WHEN OTHERS THEN INSERT INTO zz_tope VALUES ('cerrada_pantalla', SQLSTATE);
  END;
  BEGIN
    PERFORM app_servicio_portal.portal_session_get(v_tok); INSERT INTO zz_tope VALUES ('cerrada_otras', 'ok');
  EXCEPTION WHEN OTHERS THEN INSERT INTO zz_tope VALUES ('cerrada_otras', SQLSTATE);
  END;

  -- 5. El tope de codigos para entrar no cambio: 5 por hora por email, el sexto no se manda.
  FOR i IN 1..6 LOOP
    INSERT INTO zz_tope VALUES ('codigo_' || i,
      COALESCE(app_servicio.portal_login_code_issue(v_host, (SELECT email FROM app_servicio_portal.portal_accounts WHERE id = v_acc)) ->> 'send', ''));
  END LOOP;
END
$zz$;
SELECT k, v FROM zz_tope ORDER BY k;
`;

const migration = ENSAYO ? readFileSync(MIGRATION, "utf8") : "";
const sqlText = `BEGIN;\n${migration}\n${body}\nROLLBACK;`;

let rows = [];
try {
  const out = execFileSync("supabase", ["db", "query", ...dbTargetArgs(), sqlText], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024, timeout: 180_000,
  });
  rows = JSON.parse(out).rows ?? [];
} catch (e) {
  check(false, "la consulta fallo", e instanceof Error ? (e.stderr?.toString() || e.message).slice(0, 600) : String(e));
}
const r = Object.fromEntries(rows.map((x) => [x.k, x.v]));

console.log(`\nEl tope del portal cuenta pantallas${ENSAYO ? " (ensayo con la 00403 en la transaccion)" : ""}`);
if (r.skip) {
  console.log(`  --    sin probar: ${r.skip}`);
} else if (rows.length) {
  check(r.otras_ok === "80" && r.otras_error === "", "80 llamadas a otra funcion del portal pasan", `ok=${r.otras_ok} error=${r.otras_error}`);
  check(r.otras_contador === "0", "y no suman al contador de la sesion", `contador=${r.otras_contador}${ENSAYO ? "" : " (¿falta aplicar la 00403? probá con --ensayo)"}`);
  check(r.pantallas_ok === "60", "60 pantallas en el mismo minuto pasan", `ok=${r.pantallas_ok}`);
  check(r.pantallas_primera_falla === "61" && r.pantallas_error === "PO429", "la pantalla 61 da PO429", `primera falla=${r.pantallas_primera_falla} error=${r.pantallas_error}`);
  check(r.despues_otras === "ok", "con el tope pasado, las otras funciones siguen andando", r.despues_otras);
  check(r.suspendida === "PO402", "una cuenta suspendida da PO402 antes que el tope", r.suspendida);
  check(r.cerrada_pantalla === "PO401" && r.cerrada_otras === "PO401", "una sesion cerrada da PO401 (pantalla y otras)", `${r.cerrada_pantalla} / ${r.cerrada_otras}`);
  const codes = [1, 2, 3, 4, 5, 6].map((i) => r[`codigo_${i}`]);
  check(codes.slice(0, 5).every((c) => c === "true") && codes[5] === "false", "el tope de codigos para entrar no cambio (5 por hora, el sexto no)", codes.join(","));
}

console.log(failures === 0 ? "\nTodo verde (nada quedo en la base: la transaccion se deshizo)" : `\n${failures} FALLAS`);
process.exit(failures === 0 ? 0 : 1);
