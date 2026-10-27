#!/usr/bin/env node
// Foto de la estructura de una base, objeto por objeto, para comparar dos bases.
//
//   node scripts/plantilla/snapshot-schema.mjs --db-url=postgresql://... [--out=archivo.json]
//
// Sirve para probar que las migraciones consolidadas de la plantilla de
// estudiantes crean EXACTAMENTE la misma base que la de referencia (todas las
// migraciones del proyecto + la poda). Cada linea es un objeto con su forma:
// si dos fotos son iguales, las dos bases son iguales en todo lo que importa.
//
// Mira solo lo nuestro: los esquemas public y private, las politicas y los
// buckets de storage, los cron, la publicacion de realtime y las extensiones.
// No mira auth, realtime, vault ni los esquemas internos de Supabase.
import pg from "pg";
import { writeFileSync } from "node:fs";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dbUrl = arg("db-url");
if (!dbUrl) {
  console.error("Falta --db-url=postgresql://...");
  process.exit(1);
}

const SCHEMAS = ["public", "private"];
const ROLES = ["anon", "authenticated", "service_role"];

// Cada consulta devuelve filas con una clave `k` (que identifica el objeto) y
// el resto de las columnas describen su forma.
const QUERIES = {
  extension: `
    select e.extname as k, n.nspname as schema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace`,

  schema_grant: `
    select n.nspname || ' ' || a.grantee::regrole::text as k, string_agg(a.privilege_type, ',' order by a.privilege_type) as privs
    from pg_namespace n, aclexplode(n.nspacl) a
    where n.nspname = any($1::text[]) and a.grantee::regrole::text = any($2::text[])
    group by 1`,

  table: `
    select n.nspname || '.' || c.relname as k, c.relkind::text as kind,
           c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
           md5(coalesce(obj_description(c.oid, 'pg_class'), '')) as comment
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any($1::text[]) and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')`,

  column: `
    select n.nspname || '.' || c.relname || '.' || a.attname as k,
           format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as not_null,
           pg_get_expr(d.adbin, d.adrelid) as default, a.attidentity::text as identity,
           a.attgenerated::text as generated,
           md5(coalesce(col_description(c.oid, a.attnum), '')) as comment
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = any($1::text[]) and c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped`,

  constraint: `
    select n.nspname || '.' || c.relname || '.' || con.conname as k, con.contype::text as type,
           pg_get_constraintdef(con.oid) as def
    from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any($1::text[])`,

  index: `
    select schemaname || '.' || indexname as k, tablename as table, indexdef as def
    from pg_indexes where schemaname = any($1::text[])`,

  view: `
    select n.nspname || '.' || c.relname as k, md5(pg_get_viewdef(c.oid, true)) as def
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any($1::text[]) and c.relkind in ('v', 'm')`,

  type: `
    select n.nspname || '.' || t.typname as k, t.typtype::text as kind,
           (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid) as labels,
           case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) end as base
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = any($1::text[]) and t.typtype in ('e', 'd')`,

  sequence: `
    select schemaname || '.' || sequencename as k, data_type::text as type, increment_by::text as inc
    from pg_sequences where schemaname = any($1::text[])`,

  function: `
    select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as k,
           p.prokind::text as kind, md5(pg_get_functiondef(p.oid)) as def,
           p.prosecdef as security_definer, array_to_string(p.proconfig, ',') as config,
           pg_get_userbyid(p.proowner) as owner,
           md5(coalesce(obj_description(p.oid, 'pg_proc'), '')) as comment
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = any($1::text[]) and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`,

  function_grant: `
    select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' ||
           coalesce(nullif(a.grantee::regrole::text, '-'), 'public') as k, a.privilege_type as priv
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = any($1::text[]) and (a.grantee = 0 or a.grantee::regrole::text = any($2::text[]))
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`,

  trigger: `
    select n.nspname || '.' || c.relname || '.' || t.tgname as k, pg_get_triggerdef(t.oid) as def,
           t.tgenabled::text as enabled
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and (n.nspname = any($1::text[]) or (n.nspname = 'storage' and c.relname in ('objects', 'buckets')))`,

  policy: `
    select schemaname || '.' || tablename || '.' || policyname as k, permissive, array_to_string(roles, ',') as roles,
           cmd, qual, with_check
    from pg_policies where schemaname = any($1::text[]) or (schemaname = 'storage' and tablename = 'objects')`,

  table_grant: `
    select n.nspname || '.' || c.relname || ' ' || a.grantee::regrole::text as k,
           string_agg(a.privilege_type, ',' order by a.privilege_type) as privs
    from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where n.nspname = any($1::text[]) and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') and a.grantee::regrole::text = any($2::text[])
    group by 1`,

  column_grant: `
    select table_schema || '.' || table_name || '.' || column_name || ' ' || grantee as k,
           string_agg(privilege_type, ',' order by privilege_type) as privs
    from information_schema.column_privileges
    where table_schema = any($1::text[]) and grantee = any($2::text[])
      and not exists (
        select 1 from information_schema.role_table_grants g
        where g.table_schema = column_privileges.table_schema and g.table_name = column_privileges.table_name
          and g.grantee = column_privileges.grantee and g.privilege_type = column_privileges.privilege_type)
    group by 1`,

  default_acl: `
    select coalesce(n.nspname, '*') || ' ' || d.defaclobjtype::text || ' ' || pg_get_userbyid(d.defaclrole) || ' ' ||
           a.grantee::regrole::text as k, string_agg(a.privilege_type, ',' order by a.privilege_type) as privs
    from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
    where a.grantee::regrole::text = any($2::text[]) and $1::text[] is not null
    group by 1`,

  cron: `select jobname as k, schedule, command, active from cron.job`,

  bucket: `
    select id as k, public, file_size_limit::text as size_limit,
           array_to_string(allowed_mime_types, ',') as mime
    from storage.buckets`,

  realtime: `
    select schemaname || '.' || tablename as k from pg_publication_tables where pubname = 'supabase_realtime'`,
};

// Filas que dejan las migraciones en una base vacia (datos de sistema, no de
// un negocio): se comparan por su huella.
async function seededRows(client) {
  const { rows: tables } = await client.query(
    `select n.nspname || '.' || c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = any($1::text[]) and c.relkind in ('r', 'p') order by 1`, [SCHEMAS]);
  const out = [];
  for (const { t } of tables) {
    const q = `select count(*)::int as n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from ${t} x`;
    const { rows } = await client.query(q);
    if (rows[0].n > 0) out.push({ k: t, rows: rows[0].n, hash: rows[0].h });
  }
  return out;
}

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
const snapshot = {};
try {
  for (const [kind, sql] of Object.entries(QUERIES)) {
    const params = sql.includes("$2") ? [SCHEMAS, ROLES] : sql.includes("$1") ? [SCHEMAS] : [];
    // Las consultas que usan solo $2 igual nombran $1 (con su tipo) para que pg no se queje.
    const { rows } = await client.query(sql, params);
    snapshot[kind] = rows.sort((a, b) => a.k.localeCompare(b.k));
  }
  snapshot.seeded_rows = await seededRows(client);
} finally {
  await client.end();
}

const lines = [];
for (const [kind, rows] of Object.entries(snapshot)) for (const row of rows) lines.push(`${kind}\t${JSON.stringify(row)}`);
const text = lines.join("\n") + "\n";
const out = arg("out");
if (out) {
  writeFileSync(out, text);
  const counts = Object.entries(snapshot).map(([k, v]) => `${k} ${v.length}`).join(", ");
  console.log(`Foto guardada en ${out}: ${counts}`);
} else {
  process.stdout.write(text);
}
