#!/usr/bin/env node
// Busca restos de los modulos que la plantilla de estudiantes no lleva.
//
//   node scripts/plantilla/check-residue.mjs [--db-url=postgresql://...]
//
// Se corre sobre la base de referencia DESPUES de la poda (scripts/plantilla/poda.sql).
// Mira el codigo de las funciones, las restricciones, las politicas, los cron,
// los disparadores, los indices, los nombres de tablas y columnas, los valores
// por defecto, los buckets y la publicacion de realtime, buscando palabras de los
// modulos que se sacaron (ventas, pagos, tareas, formularios, llamadas, Fathom,
// fin de dia, comisiones, gastos, contratos, webhooks entrantes, proveedores).
//
// Ademas busca llamadas a funciones que ya no existen (una funcion que se quedo
// llamando a una que la poda borro solo falla cuando corre).
//
// Lo que se encuentra y NO esta en la lista de permitidos hace salir con 1.
// Los comentarios de la base se informan como aviso, sin hacer fallar.
import pg from "pg";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dbUrl = arg("db-url") ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";

// ---------------------------------------------------------------------------
// Las palabras de los modulos. Un guion bajo o un numero cuentan como separador
// (asi "sale_id" o "p_task" se encuentran), pero una letra no: "platform",
// "format", "salen", "callback" o "vendedor" no son restos.
// ---------------------------------------------------------------------------
const word = (w) => new RegExp(`(?<![a-z])${w}(?![a-z])`, "i");
const TOKENS = {
  venta: word("sales?"),
  pago: word("payments?"),
  tarea: word("tasks?"),
  formulario: word("forms?"),
  llamada: word("calls?"),
  fathom: /fathom/i,
  fin_de_dia: word("eod"),
  comision: word("commissions?"),
  gasto: word("expenses?"),
  contrato: word("contracts?"),
  webhook_entrante: /inbound_webhook|webhook_endpoint|webhook_received/i,
  proveedor: word("vendors?"),
  finanzas: word("finance"),
};

// ---------------------------------------------------------------------------
// Frases que contienen una de esas palabras pero son de lo que SE QUEDA. Se
// borran del texto antes de buscar. Cada una con su motivo.
// ---------------------------------------------------------------------------
// Cada frase se borra junto con el identificador entero que la contiene (por ejemplo
// "uq_ai_task_prompt_versions_workspace_task_version" se va completo).
const ident = (p) => new RegExp(`[a-z0-9_]*(?:${p})[a-z0-9_]*`, "gi");
const SAFE_PHRASES = [
  // "tarea" de IA: las tareas de IA en segundo plano no son el modulo Tareas.
  { re: ident("ai_task"), reason: "tareas de IA (clasificacion, resumen...), no el modulo Tareas" },
  { re: ident("bg_task"), reason: "job de tareas de IA en segundo plano" },
  { re: /background[ _]task/gi, reason: "tareas de IA en segundo plano" },
  // "llamada" que no es una llamada de venta.
  { re: ident("call_app_cron"), reason: "funcion que llama a un cron de la app" },
  { re: ident("tool_call|model_call"), reason: "pasos de una corrida de IA (llamada al modelo o a una herramienta)" },
  { re: ident("whatsapp_call"), reason: "llamadas de WhatsApp (Bandeja), no las de Fathom" },
  // "sale" en castellano (el verbo salir), en los comentarios del codigo SQL.
  { re: /(?<![a-z])sale (de|del|el|la|los|las|por|con|al|a|sola|solo|igual)(?![a-z])/gi, reason: "el verbo salir en un comentario" },
  { re: /(?<=donde )sale(?![a-z])/gi, reason: "el verbo salir en un comentario (\"de donde sale\")" },
];

// ---------------------------------------------------------------------------
// Objetos que pueden tener una palabra de los modulos, a proposito. `kind` y
// `key` identifican el objeto (key es exacta o una expresion regular), y
// `tokens` dice que palabras se le permiten.
// ---------------------------------------------------------------------------
const ALLOW = [
  // Asignacion de leads: se queda, pero sus nombres quedaron de cuando vivia en Ventas.
  { kind: "function", key: /^public\.contacts_enqueue_sales_eval\(/, tokens: ["venta"],
    reason: "Asignacion: encola el job 'sales_contact_eval' (nombre historico, la funcion es solo de asignacion)" },
  { kind: "function", key: /^public\.seed_sales_defaults\(/, tokens: ["venta"],
    reason: "Asignacion: crea las reglas de asignacion de un negocio nuevo (nombre historico)" },
  { kind: "trigger", key: "public.contacts.contacts_enqueue_sales_eval", tokens: ["venta"],
    reason: "Asignacion: disparador que se queda (nombre historico)" },
  { kind: "trigger", key: "public.workspaces.seed_sales_defaults", tokens: ["venta"],
    reason: "Asignacion: disparador que se queda (nombre historico)" },

  // Agenda: "venta" como resultado de una reunion (la reunion termino en venta), no el modulo Ventas.
  { kind: "constraint", key: "public.bookings.bookings_status_check", tokens: ["venta"],
    reason: "Agenda: estado 'sale' de una reunion (resultado), no una venta registrada" },
  { kind: "default", key: "public.bookings.status_group", tokens: ["venta"],
    reason: "Agenda: agrupa el estado 'sale' de una reunion" },

  // Atribucion: gemela SQL de lib/attribution (touchMetaInput). Sigue nombrando los origenes
  // 'form' y 'webhook' aunque ya no existan; tocarla romperia la paridad con TypeScript.
  { kind: "function", key: /^private\.meta_touch_utm_counts\(/, tokens: ["formulario"],
    reason: "gemela de lib/attribution: nombra el origen 'form', que en la plantilla ya no aparece (inofensivo)" },

  // Tabla de anuncios: conserva la firma (las columnas de cierres y plata vuelven en NULL).
  { kind: "function", key: /^public\.ads_crm_metrics_v2\(/, tokens: ["venta"],
    reason: "firma conservada para la pantalla; la columna 'sales' siempre vuelve NULL" },

  // Llamadas de WhatsApp (Bandeja): su funcion y sus columnas hablan de "call".
  { kind: "function", key: /^public\.record_whatsapp_call\(/, tokens: ["llamada"],
    reason: "registra llamadas de WhatsApp de Evolution (Bandeja), no de Fathom" },
  { kind: "column", key: /^public\.whatsapp_calls\./, tokens: ["llamada"],
    reason: "columnas de las llamadas de WhatsApp" },
  { kind: "index", key: "public.uq_whatsapp_calls_channel_call", tokens: ["llamada"],
    reason: "indice unico de las llamadas de WhatsApp (por su id en la plataforma)" },

  // Marca Cliente: el origen 'sale' (se marco sola al cobrar) queda en el CHECK aunque la plantilla no tenga
  // Ventas; sin cobros nunca aparece, y sacarlo romperia la paridad con el proyecto.
  { kind: "constraint", key: "public.contacts.contacts_customer_source_check", tokens: ["venta"],
    reason: "Cliente: origen 'sale' de la marca (en la plantilla solo se marca a mano)" },

  // Instrucciones de las tareas de IA: la columna se llama "task".
  { kind: "column", key: "public.ai_task_prompt_versions.task", tokens: ["tarea"],
    reason: "nombre de la tarea de IA, no el modulo Tareas" },
  { kind: "constraint", key: "public.ai_task_prompt_versions.ai_task_prompt_versions_task_check", tokens: ["tarea"],
    reason: "lista de tareas de IA (columna 'task'), no el modulo Tareas" },
  { kind: "index", key: "public.uq_ai_task_prompt_versions_workspace_task_version", tokens: ["tarea"],
    reason: "indice por tarea de IA (columna 'task'), no el modulo Tareas" },
];

const STRIP = (text) => SAFE_PHRASES.reduce((t, p) => t.replace(p.re, " "), text ?? "");

function scan(text) {
  const clean = STRIP(text);
  const hits = [];
  for (const [name, re] of Object.entries(TOKENS)) {
    const m = clean.match(re);
    if (m) {
      const at = m.index ?? 0;
      hits.push({ token: name, snippet: clean.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, " ").trim() });
    }
  }
  return hits;
}

function allowed(kind, key, token) {
  return ALLOW.some(
    (a) => a.kind === kind && (a.key instanceof RegExp ? a.key.test(key) : a.key === key) && a.tokens.includes(token),
  );
}

const SCHEMAS = ["public", "private"];

// Cada consulta devuelve { kind, key, text }: key identifica el objeto y text es lo que se revisa.
const QUERIES = [
  ["function", `
    select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as key,
           n.nspname || '.' || p.proname || ' ' || pg_get_function_identity_arguments(p.oid) || ' ' || p.prosrc as text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = any($1) and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`],
  ["constraint", `
    select n.nspname || '.' || c.relname || '.' || con.conname as key, con.conname || ' ' || pg_get_constraintdef(con.oid) as text
      from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = any($1)`],
  ["policy", `
    select schemaname || '.' || tablename || '.' || policyname as key,
           policyname || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '') as text
      from pg_policies where schemaname = any($1) or (schemaname = 'storage' and tablename = 'objects')`],
  ["cron", `select jobname as key, jobname || ' ' || command as text from cron.job`],
  ["table", `
    select n.nspname || '.' || c.relname as key, c.relname as text
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'f')`],
  ["column", `
    select n.nspname || '.' || c.relname || '.' || a.attname as key, a.attname as text
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped`],
  ["default", `
    select n.nspname || '.' || c.relname || '.' || a.attname as key, pg_get_expr(d.adbin, d.adrelid) as text
      from pg_attrdef d join pg_class c on c.oid = d.adrelid join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
     where n.nspname = any($1)`],
  ["trigger", `
    select n.nspname || '.' || c.relname || '.' || t.tgname as key, pg_get_triggerdef(t.oid) as text
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where not t.tgisinternal and (n.nspname = any($1) or (n.nspname = 'storage' and c.relname in ('objects', 'buckets')))`],
  ["index", `select schemaname || '.' || indexname as key, indexdef as text from pg_indexes where schemaname = any($1)`],
  ["bucket", `select id as key, id as text from storage.buckets`],
  ["realtime", `select schemaname || '.' || tablename as key, tablename as text from pg_publication_tables where pubname = 'supabase_realtime'`],
];

const COMMENTS = `
  select 'tabla/columna ' || n.nspname || '.' || c.relname || coalesce('.' || a.attname, '') as key, d.description as text
    from pg_description d join pg_class c on c.oid = d.objoid and d.classoid = 'pg_class'::regclass
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid and d.objsubid > 0
   where n.nspname = any($1)
  union all
  select 'funcion ' || n.nspname || '.' || p.proname, d.description
    from pg_description d join pg_proc p on p.oid = d.objoid and d.classoid = 'pg_proc'::regclass
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = any($1)`;

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
const findings = [];
const permitted = [];
const warnings = [];
try {
  for (const [kind, sql] of QUERIES) {
    const { rows } = await client.query(sql, sql.includes("$1") ? [SCHEMAS] : []);
    for (const row of rows) {
      for (const hit of scan(row.text)) {
        const item = { kind, key: row.key, ...hit };
        (allowed(kind, row.key, hit.token) ? permitted : findings).push(item);
      }
    }
  }

  // Llamadas a funciones que ya no existen: "public.x(" o "private.x(" en funciones, politicas y cron.
  // (tambien se cuentan las tablas: "INSERT INTO public.x (" tiene la misma forma que una llamada)
  const { rows: procs } = await client.query(`
    select n.nspname || '.' || p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    union all
    select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace`);
  const existing = new Set(procs.map((r) => r.name));
  const { rows: callers } = await client.query(`
    select 'function' as kind, n.nspname || '.' || p.proname as key, p.prosrc as text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = any($1) and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    union all
    select 'policy', schemaname || '.' || tablename || '.' || policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '')
      from pg_policies where schemaname = any($1) or schemaname = 'storage'
    union all
    select 'cron', jobname, command from cron.job`, [SCHEMAS]);
  for (const row of callers) {
    for (const m of row.text.matchAll(/\b(public|private)\.([a-z_][a-z0-9_]*)\s*\(/gi)) {
      const name = `${m[1].toLowerCase()}.${m[2].toLowerCase()}`;
      if (!existing.has(name)) {
        findings.push({ kind: row.kind, key: row.key, token: "funcion_inexistente", snippet: `llama a ${name}()` });
      }
    }
  }

  const { rows: comments } = await client.query(COMMENTS, [SCHEMAS]);
  for (const row of comments) {
    for (const hit of scan(row.text)) warnings.push({ kind: "comentario", key: row.key, ...hit });
  }
} finally {
  await client.end();
}

const line = (f) => `  [${f.kind}] ${f.key}  <${f.token}>  ${f.snippet}`;
console.log(`Permitidos (en la lista, con su motivo): ${permitted.length}`);
for (const f of permitted) console.log(line(f));
if (warnings.length) {
  console.log(`\nAvisos en comentarios (no hacen fallar): ${warnings.length}`);
  for (const f of warnings) console.log(line(f));
}
if (findings.length) {
  console.log(`\nRESTOS SIN PERMISO: ${findings.length}`);
  for (const f of findings) console.log(line(f));
  process.exit(1);
}
console.log("\nSin restos de los modulos.");
