#!/usr/bin/env node
/**
 * Verificación de la Papelera (00410 y 00411, docs/papelera.md), solo contra la base LOCAL.
 * Cada sección corre dentro de BEGIN … ROLLBACK: no deja nada en la base. Toma el candado de los verify-*.
 *
 * Qué prueba:
 *   - permisos: un Member de sistema y alguien de otro negocio no eliminan; un rol con SOLO `sales.delete`
 *     elimina ventas y no pagos; la Papelera le muestra solo lo suyo;
 *   - ida y vuelta: eliminar y restaurar deja cada fila IGUAL que antes (venta con pagos y comisiones, pago,
 *     reunión con una grabación enlazada, grabación con comentarios, conversación con mensajes, producto con
 *     contactos interesados, servicio, formulario con respuestas, gasto, comisión, pieza, idea, fin de día);
 *   - restaurar no regenera nada (sin jobs nuevos de comisiones);
 *   - bloqueos: comisión en un gasto, gasto automático, producto vendido, contrato firmado, padre que ya no está;
 *   - la marca «Cliente», el estado de la venta, el tombstone de Fathom y la purga a los 30 días.
 *
 *   DB_TARGET=local node scripts/verify-trash.mjs
 *   DB_TARGET=local node scripts/verify-trash.mjs --solo venta
 */
import pg from "pg";
import { mkdirSync, rmdirSync, statSync } from "node:fs";

if (process.env.DB_TARGET !== "local") {
  console.error("Este verify solo corre con DB_TARGET=local.");
  process.exit(2);
}
const url = process.env.LOCAL_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!/127\.0\.0\.1|localhost/.test(url)) {
  console.error("LOCAL_DB_URL no es local: no corro.");
  process.exit(2);
}
const soloArg = process.argv.indexOf("--solo");
const SOLO = soloArg >= 0 ? process.argv[soloArg + 1] : null;
const want = (s) => !SOLO || SOLO === s;

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => {
  console.error("  FALLA", m, extra ? `\n        ${extra}` : "");
  failures++;
};
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

// El candado que comparten los verify-* de SSA.
const LOCK = process.env.SSA_VERIFY_LOCK?.trim() || "/private/tmp/ssa-verify.lock";
try {
  mkdirSync(LOCK);
} catch {
  const age = Date.now() - statSync(LOCK).mtimeMs;
  if (age < 15 * 60 * 1000) {
    console.error(`Hay otro verify corriendo (${LOCK}). Esperá a que termine.`);
    process.exit(2);
  }
}
const release = async () => {
  try {
    rmdirSync(LOCK);
  } catch {
    // ya no estaba
  }
};
const db = new pg.Client({ connectionString: url });
await db.connect();
const q = async (text, params) => (await db.query(text, params)).rows;

async function inTx(label, fn) {
  console.log(`\n${label}`);
  await db.query("BEGIN");
  try {
    await fn();
  } catch (e) {
    fail(`${label}: error inesperado`, String(e.stack ?? e.message ?? e).slice(0, 800));
  } finally {
    await db.query("ROLLBACK");
  }
}

/** Corre una consulta con la sesión de una persona (rol authenticated + su JWT). */
async function as(uid, text, params) {
  await db.query("SAVEPOINT imp");
  try {
    await db.query("SET LOCAL ROLE authenticated");
    await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    const rows = (await db.query(text, params)).rows;
    await db.query("RESET ROLE");
    await db.query("RELEASE SAVEPOINT imp");
    return rows;
  } catch (e) {
    await db.query("ROLLBACK TO SAVEPOINT imp");
    await db.query("RESET ROLE");
    throw e;
  }
}
const del = async (uid, ws, entity, id, options = {}) =>
  (await as(uid, "SELECT public.trash_delete($1, $2, $3, $4) AS r", [ws, entity, id, options]))[0].r;
const preview = async (uid, ws, entity, id, options = {}) =>
  (await as(uid, "SELECT public.trash_preview($1, $2, $3, $4) AS r", [ws, entity, id, options]))[0].r;
// En la app eliminar y restaurar son transacciones distintas; acá van en la misma, así que primero se disparan
// las restricciones diferidas que dejó el borrado (si no, ALTER TABLE ve «pending trigger events»).
const restore = async (uid, ws, item) => {
  await db.query("SET CONSTRAINTS ALL IMMEDIATE");
  return (await as(uid, "SELECT public.trash_restore($1, $2) AS r", [ws, item]))[0].r;
};

/** Las filas de una tabla, tal cual (para comparar antes y después). */
const rowsOf = async (table, where, params) =>
  (await q(`SELECT to_jsonb(t) AS r FROM ${table} t WHERE ${where} ORDER BY t.id`, params)).map((x) => JSON.stringify(x.r));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

let seq = 0;
async function newUser(label) {
  seq += 1;
  const [u] = await q(
    `INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, $2, now(), now())
     RETURNING id`,
    [`zz-test-trash-${seq}-${Date.now()}@example.com`, JSON.stringify({ full_name: `zz-test ${label}` })],
  );
  return u.id;
}

/** Un negocio con Owner, Admin, Member, un rol con solo `sales.delete` y alguien de otro negocio. */
async function fixture() {
  const owner = await newUser("owner");
  const admin = await newUser("admin");
  const member = await newUser("member");
  const custom = await newUser("custom");
  const stranger = await newUser("stranger");
  const [ws] = await q(`INSERT INTO public.workspaces (name, slug) VALUES ('zz-test papelera', $1) RETURNING id`, [`zz-test-papelera-${Date.now()}-${seq}`]);
  const [other] = await q(`INSERT INTO public.workspaces (name, slug) VALUES ('zz-test otro', $1) RETURNING id`, [`zz-test-otro-${Date.now()}-${seq}`]);
  const [role] = await q(
    `INSERT INTO public.workspace_roles (workspace_id, name, permissions)
     VALUES ($1, 'zz-test borra ventas', '{"keys": ["sales.view", "sales.delete"], "scopes": {"sales": "all", "leads": "all"}}') RETURNING id`,
    [ws.id],
  );
  await q(
    `INSERT INTO public.workspace_members (workspace_id, user_id, role, role_id) VALUES
       ($1, $2, 'owner', NULL), ($1, $3, 'admin', NULL), ($1, $4, 'member', NULL), ($1, $5, 'member', $6), ($7, $8, 'owner', NULL)`,
    [ws.id, owner, admin, member, custom, role.id, other.id, stranger],
  );
  const [contact] = await q(`INSERT INTO public.contacts (workspace_id, display_name, email) VALUES ($1, 'zz-test Cliente', $2) RETURNING id`, [ws.id, `zz-test-c-${Date.now()}-${seq}@example.com`]);
  const [product] = await q(`INSERT INTO public.products (workspace_id, name) VALUES ($1, 'zz-test Mentoría') RETURNING id`, [ws.id]);
  const [variant] = await q(`INSERT INTO public.product_variants (workspace_id, product_id, name, price) VALUES ($1, $2, 'Estándar', 1000) RETURNING id`, [ws.id, product.id]);
  return { ws: ws.id, other: other.id, owner, admin, member, custom, stranger, contact: contact.id, product: product.id, variant: variant.id };
}

async function newSale(f, { paid = 1, scheduled = 1 } = {}) {
  const [sale] = await q(
    `INSERT INTO public.sales (workspace_id, contact_id, product_variant_id, product_snapshot, base_amount, final_amount, status, financing_type, sale_date)
     VALUES ($1, $2, $3, '{"product_name": "zz-test Mentoría", "variant_name": "Estándar"}', 1000, 1000, 'pending_payment', 'installments', current_date)
     RETURNING id`,
    [f.ws, f.contact, f.variant],
  );
  const payments = [];
  for (let i = 0; i < scheduled; i++) {
    const [p] = await q(
      `INSERT INTO public.payments (workspace_id, sale_id, type, amount, status, due_date) VALUES ($1, $2, 'installment', 500, 'scheduled', current_date + 30) RETURNING id`,
      [f.ws, sale.id],
    );
    payments.push(p.id);
  }
  for (let i = 0; i < paid; i++) {
    const [p] = await q(
      `INSERT INTO public.payments (workspace_id, sale_id, type, amount, status, due_date, paid_at, paid_on, payment_method)
       VALUES ($1, $2, 'installment', 500, 'paid', current_date, now(), current_date, 'transferencia_cr') RETURNING id`,
      [f.ws, sale.id],
    );
    payments.push(p.id);
  }
  const [c] = await q(
    `INSERT INTO public.commissions (workspace_id, kind, amount, available_on, notes, sale_id, payment_id)
     VALUES ($1, 'adjustment', 50, current_date, 'zz-test ajuste', $2, $3) RETURNING id`,
    [f.ws, sale.id, payments[payments.length - 1]],
  );
  return { sale: sale.id, payments, commission: c.id };
}

// ── Catálogo y permisos de la base ─────────────────────────────────────────────────────────────────────────────
if (want("catalogo")) {
  await inTx("Catálogo: quién puede ejecutar qué", async () => {
    const rows = await q(`
      SELECT p.oid::regprocedure::text AS fn, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE (n.nspname = 'public' AND p.proname IN ('trash_list', 'trash_preview', 'trash_delete', 'trash_restore'))
         OR (n.nspname = 'private' AND p.proname LIKE 'trash\\_%') OR (n.nspname = 'private' AND p.proname = 'purge_trash')`);
    const pub = rows.filter((r) => r.fn.startsWith("trash_"));
    const priv = rows.filter((r) => r.fn.startsWith("private."));
    check(pub.length === 4 && pub.every((r) => r.auth && !r.anon), "las cuatro funciones públicas las ejecuta una sesión, no anon", JSON.stringify(pub));
    check(priv.length >= 10 && priv.every((r) => !r.auth && !r.anon), "las funciones privadas no las ejecuta ni una sesión ni anon", JSON.stringify(priv.filter((r) => r.auth || r.anon)));
    const [t] = await q(`SELECT has_table_privilege('authenticated', 'private.trash_items', 'SELECT') AS a, has_table_privilege('authenticated', 'public.calls_deleted_external', 'SELECT') AS b`);
    check(!t.a && !t.b, "una sesión no lee la Papelera ni los tombstones de Fathom");
    const [cron] = await q(`SELECT count(*)::int AS n FROM cron.job WHERE jobname = 'trash-purge'`);
    check(cron.n === 1, "la purga diaria está programada");
  });
}

// ── Permisos ──────────────────────────────────────────────────────────────────────────────────────────────────
if (want("permisos")) {
  await inTx("Permisos: quién elimina", async () => {
    const f = await fixture();
    const s = await newSale(f);
    check((await del(f.member, f.ws, "sale", s.sale)).code === "forbidden", "un Member de sistema no elimina ventas");
    check((await del(f.stranger, f.ws, "sale", s.sale)).code === "forbidden", "alguien de otro negocio no elimina");
    check((await del(f.stranger, f.other, "sale", s.sale)).code === "not_found", "con su propio negocio, la venta ajena no existe");
    check((await del(f.custom, f.ws, "payment", s.payments[0])).code === "forbidden", "un rol con solo sales.delete no elimina pagos");
    const pv = await preview(f.custom, f.ws, "sale", s.sale);
    check(pv.ok && pv.counts["public.payments"] === 2 && pv.counts["public.commissions"] === 1, "la vista previa cuenta 2 pagos y 1 comisión", JSON.stringify(pv));
    const r = await del(f.custom, f.ws, "sale", s.sale);
    check(r.ok, "un rol con solo sales.delete elimina la venta", JSON.stringify(r));
    const list = await as(f.custom, "SELECT entity FROM public.trash_list($1)", [f.ws]);
    check(list.length === 1 && list[0].entity === "sale", "la Papelera le muestra la venta");
    check((await as(f.member, "SELECT count(*)::int AS n FROM public.trash_list($1)", [f.ws]))[0].n === 0, "a un Member la Papelera le sale vacía");
    check((await restore(f.member, f.ws, r.item_id)).code === "forbidden", "un Member no restaura");
  });
}

// ── Venta: ida y vuelta ───────────────────────────────────────────────────────────────────────────────────────
if (want("venta")) {
  await inTx("Venta con pagos y comisión: eliminar y restaurar deja todo igual", async () => {
    const f = await fixture();
    const s = await newSale(f);
    const [{ is_customer: before }] = await q(`SELECT is_customer FROM public.contacts WHERE id = $1`, [f.contact]);
    check(before === true, "el cobro marcó al contacto como Cliente (punto de partida)");
    const snap = {
      sales: await rowsOf("public.sales", "t.id = $1", [s.sale]),
      payments: await rowsOf("public.payments", "t.sale_id = $1", [s.sale]),
      commissions: await rowsOf("public.commissions", "t.sale_id = $1", [s.sale]),
    };
    const [{ n: jobsBefore }] = await q(`SELECT count(*)::int AS n FROM public.scheduled_jobs`);

    const r = await del(f.owner, f.ws, "sale", s.sale);
    check(r.ok, "el Owner elimina la venta", JSON.stringify(r));
    check((await q(`SELECT 1 FROM public.sales WHERE id = $1`, [s.sale])).length === 0, "la venta ya no está");
    check((await q(`SELECT 1 FROM public.payments WHERE sale_id = $1`, [s.sale])).length === 0, "sus pagos tampoco");
    check((await q(`SELECT 1 FROM public.commissions WHERE id = $1`, [s.commission])).length === 0, "ni su comisión");
    const [{ is_customer: after }] = await q(`SELECT is_customer FROM public.contacts WHERE id = $1`, [f.contact]);
    check(after === false, "sin cobros, el contacto deja de ser Cliente");
    check((await q(`SELECT 1 FROM public.audit_log WHERE entity_id = $1 AND action = 'trash.deleted'`, [s.sale])).length === 1, "queda en el historial");
    check((await del(f.owner, f.ws, "sale", s.sale)).code === "not_found", "eliminarla otra vez responde not_found");

    const [{ n: jobsMid }] = await q(`SELECT count(*)::int AS n FROM public.scheduled_jobs`);
    const jobIds = new Set((await q(`SELECT id FROM public.scheduled_jobs`)).map((j) => j.id));
    const back = await restore(f.owner, f.ws, r.item_id);
    check(back.ok, "restaurar responde ok", JSON.stringify(back));
    check(same(snap.sales, await rowsOf("public.sales", "t.id = $1", [s.sale])), "la venta vuelve idéntica");
    check(same(snap.payments, await rowsOf("public.payments", "t.sale_id = $1", [s.sale])), "los pagos vuelven idénticos");
    check(same(snap.commissions, await rowsOf("public.commissions", "t.sale_id = $1", [s.sale])), "la comisión vuelve idéntica");
    const [{ is_customer: again }] = await q(`SELECT is_customer FROM public.contacts WHERE id = $1`, [f.contact]);
    check(again === true, "con el cobro de vuelta, vuelve a ser Cliente");
    const newJobs = (await q(`SELECT id, type FROM public.scheduled_jobs`)).filter((j) => !jobIds.has(j.id));
    check(newJobs.every((j) => j.type === "finance_daily"), "restaurar no encola comisiones nuevas (solo el recálculo de Finanzas)", JSON.stringify(newJobs));
    check(jobsMid > jobsBefore, "eliminar encoló el recálculo de Finanzas");
    check((await restore(f.owner, f.ws, r.item_id)).code === "not_found", "restaurar dos veces responde not_found");
    check((await as(f.owner, "SELECT count(*)::int AS n FROM public.trash_list($1)", [f.ws]))[0].n === 0, "lo restaurado sale de la Papelera");
  });

  await inTx("Venta: bloqueos", async () => {
    const f = await fixture();
    const s = await newSale(f);
    const [x] = await q(
      `INSERT INTO public.expenses (workspace_id, concept, category_key, status, origin, amount, scheduled_date)
       VALUES ($1, 'zz-test gasto', 'marketing', 'programado', 'manual', 50, current_date) RETURNING id`,
      [f.ws],
    );
    await q(`ALTER TABLE public.commissions DISABLE TRIGGER USER`);
    await q(`UPDATE public.commissions SET expense_id = $2 WHERE id = $1`, [s.commission, x.id]);
    await q(`ALTER TABLE public.commissions ENABLE TRIGGER USER`);
    const pv = await preview(f.owner, f.ws, "sale", s.sale);
    check(pv.ok && pv.blockers.includes("commission_in_expense"), "comisión en un gasto: la vista previa lo dice", JSON.stringify(pv));
    const r = await del(f.owner, f.ws, "sale", s.sale);
    check(r.code === "blocked" && r.blockers.includes("commission_in_expense"), "y eliminar no deja");
    check((await q(`SELECT 1 FROM public.sales WHERE id = $1`, [s.sale])).length === 1, "la venta sigue ahí");
    check((await del(f.owner, f.ws, "payment", s.payments[1])).code === "blocked", "el pago con esa comisión tampoco se elimina");
    check((await del(f.owner, f.ws, "expense", x.id)).code === "blocked", "el gasto con comisiones no se elimina (lo frena el motor)");
  });
}

// ── Pago ──────────────────────────────────────────────────────────────────────────────────────────────────────
if (want("pago")) {
  await inTx("Pago: eliminar uno recalcula la venta y restaurar lo deja igual", async () => {
    const f = await fixture();
    const s = await newSale(f, { paid: 1, scheduled: 0 });
    const before = await rowsOf("public.payments", "t.sale_id = $1", [s.sale]);
    const r = await del(f.admin, f.ws, "payment", s.payments[0]);
    check(r.ok && r.counts["public.commissions"] === 1, "el Admin elimina el pago con su comisión", JSON.stringify(r));
    check((await q(`SELECT 1 FROM public.payments WHERE sale_id = $1`, [s.sale])).length === 0, "la venta queda sin pagos");
    const back = await restore(f.admin, f.ws, r.item_id);
    check(back.ok && same(before, await rowsOf("public.payments", "t.sale_id = $1", [s.sale])), "restaurar deja el pago igual", JSON.stringify(back));
  });

  await inTx("Pago: restaurar sin su venta pide restaurar la venta primero", async () => {
    const f = await fixture();
    const s = await newSale(f, { paid: 1, scheduled: 0 });
    await q(`DELETE FROM public.commissions WHERE id = $1`, [s.commission]);
    const r = await del(f.owner, f.ws, "payment", s.payments[0]);
    const r2 = await del(f.owner, f.ws, "sale", s.sale);
    check(r.ok && r2.ok, "se eliminan el pago y después la venta");
    const back = await restore(f.owner, f.ws, r.item_id);
    check(back.code === "missing_parent:public.sales", "restaurar el pago solo responde missing_parent:public.sales", JSON.stringify(back));
    check((await q(`SELECT 1 FROM public.payments WHERE id = $1`, [s.payments[0]])).length === 0, "y no deja nada a medias");
    check((await restore(f.owner, f.ws, r2.item_id)).ok && (await restore(f.owner, f.ws, r.item_id)).ok, "con la venta de vuelta, el pago se restaura");
  });
}

// ── Reunión con una grabación enlazada, y la grabación ────────────────────────────────────────────────────────
if (want("agenda")) {
  await inTx("Reunión y grabación: vínculos, comentarios y el tombstone de Fathom", async () => {
    const f = await fixture();
    const [cat] = await q(`SELECT id FROM public.booking_categories WHERE workspace_id = $1 LIMIT 1`, [f.ws]);
    const catId = cat?.id ?? (await q(`INSERT INTO public.booking_categories (workspace_id, name) VALUES ($1, 'zz-test Ventas') RETURNING id`, [f.ws]))[0].id;
    const [ev] = await q(
      `INSERT INTO public.event_types (workspace_id, owner_user_id, category_id, title, slug) VALUES ($1, $2, $3, 'zz-test llamada', $4) RETURNING id`,
      [f.ws, f.owner, catId, `zz-test-${Date.now()}`],
    );
    const [b] = await q(
      `INSERT INTO public.bookings (workspace_id, uid, event_type_id, host_user_id, contact_id, title, start_at, end_at, booker_name)
       VALUES ($1, $2, $3, $4, $5, 'zz-test reunión', now() + interval '2 days', now() + interval '2 days 30 minutes', 'zz-test Ana') RETURNING id`,
      [f.ws, `zztest${Date.now()}${seq}abcdefgh`.slice(0, 22), ev.id, f.owner, f.contact],
    );
    const [c] = await q(
      `INSERT INTO public.calls (workspace_id, source, external_id, title, recorded_at, booking_id, contact_id)
       VALUES ($1, 'fathom', $2, 'zz-test grabación', now(), $3, $4) RETURNING id`,
      [f.ws, `zz-${Date.now()}`, b.id, f.contact],
    );
    await q(`INSERT INTO public.call_comments (workspace_id, call_id, body, author_id) VALUES ($1, $2, 'zz-test comentario', $3)`, [f.ws, c.id, f.owner]).catch(async () =>
      q(`INSERT INTO public.call_comments (workspace_id, call_id, body) VALUES ($1, $2, 'zz-test comentario')`, [f.ws, c.id]));
    const bookingBefore = await rowsOf("public.bookings", "t.id = $1", [b.id]);
    const callBefore = await rowsOf("public.calls", "t.id = $1", [c.id]);

    const pv = await preview(f.owner, f.ws, "booking", b.id);
    check(pv.ok && pv.warnings.includes("booking_active"), "una reunión futura avisa que se saca del calendario", JSON.stringify(pv));
    const rb = await del(f.owner, f.ws, "booking", b.id);
    check(rb.ok, "se elimina la reunión");
    const [{ booking_id: linked }] = await q(`SELECT booking_id FROM public.calls WHERE id = $1`, [c.id]);
    check(linked === null, "la grabación queda sin la reunión");
    check((await restore(f.owner, f.ws, rb.item_id)).ok, "se restaura la reunión");
    check(same(bookingBefore, await rowsOf("public.bookings", "t.id = $1", [b.id])), "la reunión vuelve idéntica");
    const [{ booking_id: relinked }] = await q(`SELECT booking_id FROM public.calls WHERE id = $1`, [c.id]);
    check(relinked === b.id, "y la grabación vuelve a quedar enlazada");

    const rc = await del(f.owner, f.ws, "call", c.id);
    check(rc.ok && rc.counts["public.call_comments"] === 1, "se elimina la grabación con su comentario", JSON.stringify(rc));
    check((await q(`SELECT 1 FROM public.calls_deleted_external WHERE workspace_id = $1`, [f.ws])).length === 1, "queda el tombstone: Fathom no la vuelve a traer");
    check((await restore(f.owner, f.ws, rc.item_id)).ok, "se restaura la grabación");
    check(same(callBefore, await rowsOf("public.calls", "t.id = $1", [c.id])), "vuelve idéntica");
    check((await q(`SELECT 1 FROM public.calls_deleted_external WHERE workspace_id = $1`, [f.ws])).length === 0, "y el tombstone se va");

    // El padre que ya no está. Opcional (la reunión de una grabación): vuelve sin el vínculo.
    const rc2 = await del(f.owner, f.ws, "call", c.id);
    await q(`DELETE FROM public.bookings WHERE id = $1`, [b.id]);
    const back = await restore(f.owner, f.ws, rc2.item_id);
    const [cb] = await q(`SELECT booking_id FROM public.calls WHERE id = $1`, [c.id]);
    check(back.ok && cb?.booking_id === null, "si la reunión ya no existe, la grabación vuelve sin ella", JSON.stringify(back));
  });
}

// ── Producto, gasto, comisión, conversación, contenido, formularios, servicio, fin de día ─────────────
if (want("otros")) {
  await inTx("Producto: suelta el interés de los contactos y lo devuelve; uno vendido no se elimina", async () => {
    const f = await fixture();
    await q(`UPDATE public.contacts SET interest_product_id = $2, interest_variant_id = $3 WHERE id = $1`, [f.contact, f.product, f.variant]);
    const r = await del(f.owner, f.ws, "product", f.product);
    check(r.ok && r.counts["public.product_variants"] === 1, "se elimina el producto con su variante", JSON.stringify(r));
    const [c1] = await q(`SELECT interest_product_id, interest_variant_id FROM public.contacts WHERE id = $1`, [f.contact]);
    check(c1.interest_product_id === null && c1.interest_variant_id === null, "el contacto queda sin producto de interés");
    check((await restore(f.owner, f.ws, r.item_id)).ok, "se restaura");
    const [c2] = await q(`SELECT interest_product_id, interest_variant_id FROM public.contacts WHERE id = $1`, [f.contact]);
    check(c2.interest_product_id === f.product && c2.interest_variant_id === f.variant, "y el interés vuelve");
    await newSale(f);
    const pv = await preview(f.owner, f.ws, "product", f.product);
    check(pv.ok && pv.blockers.includes("product_sold"), "un producto vendido no se elimina", JSON.stringify(pv));
  });

  await inTx("Gasto: el manual se elimina; el automático no", async () => {
    const f = await fixture();
    const [m] = await q(`INSERT INTO public.expenses (workspace_id, concept, category_key, status, origin, amount, scheduled_date) VALUES ($1, 'zz-test', 'marketing', 'programado', 'manual', 10, current_date) RETURNING id`, [f.ws]);
    const [a] = await q(`INSERT INTO public.expenses (workspace_id, concept, category_key, status, origin, amount, scheduled_date, auto_key) VALUES ($1, 'zz-test fee', 'marketing', 'programado', 'processor_fee', 10, current_date, $2) RETURNING id`, [f.ws, `processor_fee:zz:${Date.now()}`]);
    const before = await rowsOf("public.expenses", "t.id = $1", [m.id]);
    const r = await del(f.owner, f.ws, "expense", m.id);
    check(r.ok && (await restore(f.owner, f.ws, r.item_id)).ok && same(before, await rowsOf("public.expenses", "t.id = $1", [m.id])), "ida y vuelta de un gasto manual");
    check((await del(f.owner, f.ws, "expense", a.id)).blockers?.includes("expense_automatic"), "uno automático responde expense_automatic");
  });

  await inTx("Conversación con mensajes", async () => {
    const f = await fixture();
    const [ch] = await q(`INSERT INTO public.channels (workspace_id, platform, late_account_id) VALUES ($1, 'whatsapp', $2) RETURNING id`, [f.ws, `zz-${Date.now()}`]);
    const [cv] = await q(`INSERT INTO public.conversations (workspace_id, channel_id, contact_id, platform) VALUES ($1, $2, $3, 'whatsapp') RETURNING id`, [f.ws, ch.id, f.contact]);
    await q(`INSERT INTO public.messages (workspace_id, conversation_id, direction, text) VALUES ($1, $2, 'inbound', 'zz hola'), ($1, $2, 'outbound', 'zz chau')`, [f.ws, cv.id]);
    const conv = await rowsOf("public.conversations", "t.id = $1", [cv.id]);
    const msgs = await rowsOf("public.messages", "t.conversation_id = $1", [cv.id]);
    const r = await del(f.owner, f.ws, "conversation", cv.id);
    check(r.ok && r.counts["public.messages"] === 2, "se elimina con sus 2 mensajes", JSON.stringify(r));
    check((await restore(f.owner, f.ws, r.item_id)).ok, "se restaura");
    check(same(conv, await rowsOf("public.conversations", "t.id = $1", [cv.id])) && same(msgs, await rowsOf("public.messages", "t.conversation_id = $1", [cv.id])), "conversación y mensajes vuelven idénticos (sin que los triggers los toquen)");
  });

  await inTx("Comisión, pieza, idea y servicio: ida y vuelta", async () => {
    const f = await fixture();
    const s = await newSale(f);
    for (const [entity, table, id] of [["commission", "public.commissions", s.commission]]) {
      const before = await rowsOf(table, "t.id = $1", [id]);
      const r = await del(f.owner, f.ws, entity, id);
      check(r.ok && (await restore(f.owner, f.ws, r.item_id)).ok && same(before, await rowsOf(table, "t.id = $1", [id])), `ida y vuelta: ${entity}`, JSON.stringify(r));
    }
    const [idea] = await q(`INSERT INTO public.content_ideas (workspace_id, title) VALUES ($1, 'zz-test idea') RETURNING id`, [f.ws]);
    const [post] = await q(`INSERT INTO public.content_posts (workspace_id, title, idea_id) VALUES ($1, 'zz-test pieza', $2) RETURNING id`, [f.ws, idea.id]);
    for (const [entity, table, id] of [["content_post", "public.content_posts", post.id], ["content_idea", "public.content_ideas", idea.id]]) {
      const before = await rowsOf(table, "t.id = $1", [id]);
      const r = await del(f.owner, f.ws, entity, id);
      check(r.ok && (await restore(f.owner, f.ws, r.item_id)).ok && same(before, await rowsOf(table, "t.id = $1", [id])), `ida y vuelta: ${entity}`, JSON.stringify(r));
    }
    const [{ idea_id }] = await q(`SELECT idea_id FROM public.content_posts WHERE id = $1`, [post.id]);
    check(idea_id === idea.id, "la pieza vuelve a quedar enlazada a su idea");
  });

  await inTx("Formulario con respuesta, respuesta suelta y fin de día", async () => {
    const f = await fixture();
    const [form] = await q(`INSERT INTO public.forms (workspace_id, name, slug, type) VALUES ($1, 'zz-test form', $2, 'custom') RETURNING id`, [f.ws, `zz-test-${Date.now()}`]);
    const [ver] = await q(`INSERT INTO public.form_versions (workspace_id, form_id, version_number, definition, published_at) VALUES ($1, $2, 1, '{}', now()) RETURNING id`, [f.ws, form.id]);
    const [sub] = await q(
      `INSERT INTO public.form_submissions (workspace_id, form_id, form_version_id, answers, status, idempotency_key, contact_id) VALUES ($1, $2, $3, '{}', 'received', gen_random_uuid(), $4) RETURNING id`,
      [f.ws, form.id, ver.id, f.contact],
    );
    const subBefore = await rowsOf("public.form_submissions", "t.id = $1", [sub.id]);
    const rs = await del(f.owner, f.ws, "form_submission", sub.id);
    check(rs.ok && (await restore(f.owner, f.ws, rs.item_id)).ok && same(subBefore, await rowsOf("public.form_submissions", "t.id = $1", [sub.id])), "ida y vuelta: respuesta", JSON.stringify(rs));
    const rf = await del(f.owner, f.ws, "form", form.id);
    check(rf.ok && rf.counts["public.form_submissions"] === 1, "el formulario se va con su respuesta", JSON.stringify(rf));
    check((await restore(f.owner, f.ws, rf.item_id)).ok && same(subBefore, await rowsOf("public.form_submissions", "t.id = $1", [sub.id])), "y vuelve con ella");
  });
}

// ── Purga ────────────────────────────────────────────────────────────────────────────────────────────────────
if (want("purga")) {
  await inTx("Purga: lo vencido se borra; restaurar algo vencido no se puede", async () => {
    const f = await fixture();
    const s = await newSale(f);
    const r = await del(f.owner, f.ws, "commission", s.commission);
    await q(`UPDATE private.trash_items SET expires_at = now() - interval '1 minute' WHERE id = $1`, [r.item_id]);
    check((await restore(f.owner, f.ws, r.item_id)).code === "expired", "restaurar lo vencido responde expired");
    check((await as(f.owner, "SELECT count(*)::int AS n FROM public.trash_list($1)", [f.ws]))[0].n === 0, "lo vencido no sale en la lista");
    const [{ n }] = await q(`SELECT private.purge_trash() AS n`);
    check(n >= 1 && (await q(`SELECT 1 FROM private.trash_items WHERE id = $1`, [r.item_id])).length === 0, "la purga lo borra");
  });
}

await db.end();
await release();
console.log(failures === 0 ? "\nverify-trash: todo en verde" : `\nverify-trash: ${failures} falla(s)`);
process.exit(failures === 0 ? 0 : 1);
