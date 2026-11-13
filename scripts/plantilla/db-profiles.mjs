// La base de cada plantilla: de donde sale, que esquemas tiene y adonde se escriben sus
// migraciones consolidadas. Lo leen build-reference.mjs, generate-migrations.mjs,
// snapshot-schema.mjs y scripts/verify-template-schema.mjs con `--perfil=<nombre>`.
// Sin `--perfil`, todos usan "estudiantes" (lo de siempre).
//
//   - estudiantes: todas las migraciones + la poda (saca modulos) + la limpieza de
//     historia. Se regenera entera en cada actualizacion: quien la tenia instala de cero.
//   - clientes: todas las migraciones HASTA EL CORTE, sin poda ni limpieza (es el
//     proyecto completo). La foto queda congelada; las migraciones del proyecto
//     posteriores al corte viajan como estan, encima de ella (ver
//     scripts/plantilla/client-baseline.mjs).

export const DB_PROFILES = {
  estudiantes: {
    schemas: ["public", "private"],
    areas: "./areas.mjs",
    poda: "poda.sql",
    checkResidue: true,
    cleanHistory: true,
    checkHistory: true,
    upTo: null,
    outDir: "plantilla-estudiantes/supabase",
    writeSeedsAndConfig: true,
    projectId: "plantilla-estudiantes",
    ref: { projectId: "ssa-referencia", port: 553, workdir: ".plantilla-work/ref" },
    tpl: { projectId: "plantilla-prueba", port: 556, workdir: ".plantilla-work/plantilla" },
    work: ".plantilla-work",
    apiSchemas: ["public"],
  },
  clientes: {
    schemas: ["public", "private", "app_servicio", "app_servicio_portal"],
    areas: "./areas-clientes.mjs",
    poda: null,
    checkResidue: false,
    cleanHistory: false,
    checkHistory: false,
    // La foto de la plantilla de clientes es la base que arman las migraciones hasta esta
    // (incluida). Ver CLIENT_BASELINE_CUT en client-baseline.mjs: tienen que ser iguales.
    upTo: 363,
    outDir: "plantilla-clientes/supabase",
    writeSeedsAndConfig: false,
    projectId: "plantilla-clientes",
    ref: { projectId: "ssa-referencia-clientes", port: 557, workdir: ".plantilla-work/clientes/ref" },
    tpl: { projectId: "plantilla-clientes-prueba", port: 558, workdir: ".plantilla-work/clientes/plantilla" },
    work: ".plantilla-work/clientes",
    apiSchemas: ["public", "app_servicio"],
  },
};

/** El perfil de `--perfil=<nombre>` (o "estudiantes"), o corta con un mensaje claro. */
export function dbProfileFromArgs(argv = process.argv) {
  const name = argv.find((a) => a.startsWith("--perfil="))?.slice("--perfil=".length) ?? "estudiantes";
  const p = DB_PROFILES[name];
  if (!p) {
    console.error(`Perfil desconocido: ${name}. Opciones: ${Object.keys(DB_PROFILES).join(", ")}.`);
    process.exit(1);
  }
  return { name, ...p };
}

/** La URL de la base local de un stack (ref o tpl) del perfil. */
export const dbUrlOf = (stack) => `postgresql://postgres:postgres@127.0.0.1:${stack.port}22/postgres`;

/** El config.toml de un Supabase local de prueba (sin nada que no haga falta). */
export function localConfigToml(stack, apiSchemas, title) {
  const p = stack.port;
  return `# ${title}
project_id = "${stack.projectId}"

[api]
enabled = true
port = ${p}21
schemas = [${apiSchemas.map((s) => `"${s}"`).join(", ")}]

[db]
port = ${p}22
shadow_port = ${p}20
major_version = 17

[studio]
enabled = false
port = ${p}23

[inbucket]
enabled = true
port = ${p}24

[analytics]
enabled = false
port = ${p}27

[db.pooler]
enabled = false
port = ${p}29

[edge_runtime]
enabled = false

[auth]
enabled = true
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/auth/callback"]
jwt_expiry = 3600
enable_signup = false
`;
}
