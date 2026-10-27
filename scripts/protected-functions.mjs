/**
 * Las funciones SQL protegidas, con su huella (md5 de `pg_get_functiondef`).
 * Los `verify-*` las comparan: si una huella cambia, alguien reescribio una funcion protegida.
 *
 * Si un cambio modifica una de estas a proposito, se actualiza la huella aca en el mismo commit y se
 * explica en la migracion.
 */
export const PROTECTED_FUNCTIONS = [
  // La plantilla arranca con estas funciones sin las ramas de los modulos que no lleva: su huella es otra.
  { name: "record_contact_touch", sig: "public.record_contact_touch(uuid,uuid,jsonb)", md5: "2f51ddbf060e31528b89ce7481b38e3d" }, // @plantilla-quitar(formularios,webhooks)
  // @plantilla-sin(formularios,webhooks): { name: "record_contact_touch", sig: "public.record_contact_touch(uuid,uuid,jsonb)", md5: "2c4111535463a1cc0d1225fa2626d6ca" },
  { name: "find_or_link_contact", sig: "public.find_or_link_contact(uuid,text,text,text,text,text,text,timestamp with time zone,boolean)", md5: "0aee03549e9361626ad4720c4a98254a" }, // @plantilla-quitar(formularios,webhooks)
  // @plantilla-sin(formularios,webhooks): { name: "find_or_link_contact", sig: "public.find_or_link_contact(uuid,text,text,text,text,text,text,timestamp with time zone,boolean)", md5: "fcd61e643b2ad330355d5dad3fc8b0f7" },
  { name: "find_contact_for_form", sig: "public.find_contact_for_form(uuid,text,text,jsonb)", md5: "b7b5605c4a19a27865c7915f57c36fe8" }, // @plantilla-quitar(formularios)
  { name: "find_or_create_contact", sig: "public.find_or_create_contact(uuid,jsonb,jsonb,text,boolean)", md5: "a71d6af701ea4460c5309631205de522" },
  { name: "submit_form_response", sig: "public.submit_form_response(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)", md5: "78a358d5ac8c4dfebd598bb3f5f91e7c" }, // @plantilla-quitar(formularios)
  {
    name: "create_booking",
    sig: "public.create_booking(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,text,text,jsonb,text,jsonb,text,text,uuid,jsonb,text,uuid,uuid,jsonb,text)",
    md5: "dc462c28e99c353bbc9ca26198eddd64", // @plantilla-quitar(formularios,webhooks)
    // @plantilla-sin(formularios,webhooks): md5: "9cea40abb3b027400f1bb2700bafc132",
  },
  { name: "create_sale", sig: "public.create_sale(jsonb,uuid)", md5: "adb766e6d657bf55db42779c7c53bcb3" }, // @plantilla-quitar(ventas)
  { name: "resolve_meta_match", sig: "public.resolve_meta_match(uuid,text,text,text,text,text,text,text)", md5: "78aa59a21a64fa73f7e779a2cd1d911a" },
];

/** Compara las huellas actuales con las esperadas. `sql(query)` devuelve filas; `check(cond, msg, extra)` cuenta. */
export function checkProtectedFunctions(sql, check) {
  const list = PROTECTED_FUNCTIONS.map((f) => `'${f.sig}'::regprocedure`).join(", ");
  const rows = sql(`select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as md5 from pg_proc p where p.oid in (${list})`);
  for (const f of PROTECTED_FUNCTIONS) {
    const norm = (t) => t.replace(/\s/g, "").replace(/^public\./, "");
    const got = rows.find((r) => norm(r.sig) === norm(f.sig))?.md5;
    check(got === f.md5, `la huella de ${f.name} es la del punto de partida`, got === f.md5 ? undefined : `dio ${got}, esperaba ${f.md5}`);
  }
}
