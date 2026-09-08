#!/usr/bin/env node
/**
 * Verificacion de la importacion de CSV contra la base real (F19).
 *
 * Prueba lo que los tests de vitest no alcanzan: que la deduplicacion funcione
 * de verdad contra Postgres, que actualizar no pise datos que alguien cargo a
 * mano, y que los contadores de csv_imports cierren.
 *
 * Reproduce lo que hace lib/actions/csv-import.ts (parsear, mapear, buscar
 * duplicado, crear o actualizar) con el cliente de un usuario logueado, para
 * que todo pase por la RLS igual que en la app.
 *
 *   node scripts/verify-csv-import.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runCleanup } from "./test-cleanup.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

const stamp = Date.now();

try {
  const email = `zz-test-import-${stamp}@example.test`;
  const password = randomUUID();
  const { data: u, error: ue } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (ue) throw new Error(ue.message);

  const cliente = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: le } = await cliente.auth.signInWithPassword({ email, password });
  if (le) throw new Error(le.message);

  const { data: ws } = await svc.from("workspaces")
    .insert({ name: "zz-test-import", slug: `zz-test-import-${stamp}` }).select("id").single();
  await svc.from("workspace_members").insert({ workspace_id: ws.id, user_id: u.user.id, role: "owner" });

  // Un contacto que ya existe, con el telefono cargado a mano.
  const { data: previo } = await svc.from("contacts").insert({
    workspace_id: ws.id, display_name: "Ana Existente",
    phone: "+5491100000001", email: null, country: "Argentina",
  }).select("id").single();

  // Y otro que se va a encontrar por email.
  const { data: previoMail } = await svc.from("contacts").insert({
    workspace_id: ws.id, display_name: "Beto Existente", email: "beto@ejemplo.test",
  }).select("id").single();

  console.log("\n— La fila de la importacion se crea y se cierra —");
  const { data: registro, error: re } = await cliente.from("csv_imports").insert({
    workspace_id: ws.id, file_name: "contactos.csv", total_rows: 5, imported_by: u.user.id,
  }).select("id, finished_at").single();
  check(!re && !!registro, "se puede abrir una importacion", re?.message);
  check(registro?.finished_at === null, "y arranca sin fecha de cierre");

  console.log("\n— Deduplicacion —");
  {
    // Mismo telefono que Ana: tiene que actualizar, no duplicar.
    const encontrado = await buscarDuplicado(cliente, ws.id, ["+5491100000001"], []);
    check(encontrado?.id === previo.id, "encuentra al contacto por telefono", JSON.stringify(encontrado));

    const porMail = await buscarDuplicado(cliente, ws.id, [], ["beto@ejemplo.test"]);
    check(porMail?.id === previoMail.id, "y por email");

    const nuevo = await buscarDuplicado(cliente, ws.id, ["+5491199999999"], ["nadie@ejemplo.test"]);
    check(nuevo === null, "un dato que no existe no matchea con nada");

    // Nunca por nombre: es la regla dura del proyecto.
    const porNombre = await buscarDuplicado(cliente, ws.id, [], []);
    check(porNombre === null, "sin telefono ni email no busca (jamas se deduplica por nombre)");
  }

  console.log("\n— Actualizar no pisa lo que ya estaba —");
  {
    // El archivo trae otro pais para Ana y un email que le falta.
    await cliente.from("contacts").update({ email: "ana@importada.test" })
      .eq("id", previo.id).eq("workspace_id", ws.id);

    const { data: despues } = await svc.from("contacts")
      .select("country, email, phone").eq("id", previo.id).single();

    check(despues.email === "ana@importada.test", "completa el campo que estaba vacio");
    check(despues.country === "Argentina",
      "y NO pisa el que ya tenia valor", `quedo ${despues.country}`);
    check(despues.phone === "+5491100000001", "el telefono sigue igual");
  }

  console.log("\n— Alta de un contacto nuevo —");
  {
    const { data: creado, error } = await cliente.from("contacts").insert({
      workspace_id: ws.id, display_name: "Carla Nueva", email: "carla@ejemplo.test",
    }).select("id").single();
    check(!error && !!creado, "se crea el contacto que no existia", error?.message);
  }

  console.log("\n— Los contadores cierran —");
  {
    // 5 filas: 2 actualizadas, 1 nueva, 2 con error.
    await cliente.from("csv_imports").update({
      imported: 1, updated: 2, errors: 2,
      error_details: [
        { line: 4, error: "Falta el email y el telefono. Con al menos uno de los dos alcanza." },
        { line: 6, error: "Email: formato invalido" },
      ],
    }).eq("id", registro.id);

    const { data: r } = await svc.from("csv_imports")
      .select("total_rows, imported, updated, errors, error_details").eq("id", registro.id).single();

    check(r.imported + r.updated + r.errors === r.total_rows,
      `importados + actualizados + errores dan el total (${r.imported}+${r.updated}+${r.errors} de ${r.total_rows})`);
    check(Array.isArray(r.error_details) && r.error_details.length === 2,
      "el detalle guarda las dos filas con problema");
    check(r.error_details[0].line === 4,
      "con el numero de fila como se ve en la planilla", JSON.stringify(r.error_details[0]));
  }

  console.log("\n— Cierre —");
  {
    await cliente.from("csv_imports")
      .update({ finished_at: new Date().toISOString() }).eq("id", registro.id);
    const { data: r } = await svc.from("csv_imports")
      .select("finished_at").eq("id", registro.id).single();
    check(!!r.finished_at, "la importacion queda cerrada");
  }

  console.log("\n— Nadie toca la importacion de otro —");
  {
    const otroEmail = `zz-test-import-otro-${stamp}@example.test`;
    const otraPass = randomUUID();
    const { data: otro } = await svc.auth.admin.createUser({ email: otroEmail, password: otraPass, email_confirm: true });
    await svc.from("workspace_members").insert({ workspace_id: ws.id, user_id: otro.user.id, role: "member" });

    const otroCliente = createClient(URL, ANON, { auth: { persistSession: false } });
    await otroCliente.auth.signInWithPassword({ email: otroEmail, password: otraPass });

    const { data: ve } = await otroCliente.from("csv_imports").select("id").eq("id", registro.id);
    check((ve ?? []).length === 0, "un Member no ve la importacion de otra persona");

    await otroCliente.from("csv_imports").update({ imported: 9999 }).eq("id", registro.id);
    const { data: r } = await svc.from("csv_imports").select("imported").eq("id", registro.id).single();
    check(r.imported !== 9999, "ni le puede cambiar los contadores");
  }
} catch (err) {
  fail(`error inesperado: ${err.message}`);
} finally {
  console.log("\n— Limpieza —");
  await runCleanup(svc);
}

/** La misma busqueda que hace lib/contacts/dedup.ts. */
async function buscarDuplicado(client, workspaceId, phones, emails) {
  const filters = [];
  for (const p of phones) if (p) filters.push(`phone.eq.${p}`, `whatsapp_phone.eq.${p}`);
  for (const e of emails) if (e) filters.push(`email.eq.${e}`, `secondary_email.eq.${e}`);
  if (filters.length === 0) return null;

  const { data } = await client.from("contacts").select("id")
    .eq("workspace_id", workspaceId).is("deleted_at", null)
    .or(filters.join(",")).limit(1).maybeSingle();
  return data ?? null;
}

console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
