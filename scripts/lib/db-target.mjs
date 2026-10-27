// A que base apuntan los verify-* cuando corren SQL con la CLI de Supabase.
//
//   (sin nada)          --linked: el proyecto vinculado (lo de siempre)
//   DB_TARGET=local     --local:  el Supabase local de `supabase start`. Con
//                       SUPABASE_WORKDIR, el de esa carpeta (sin eso, el de la
//                       carpeta actual: ojo si hay otro stack local prendido)
//   DB_TARGET=url       --db-url: la conexion de DB_URL (percent-encoded). La
//                       CLI exige TLS, asi que no sirve para un stack local
//
// Las credenciales de la API (URL y claves) siguen saliendo del .env: para
// probar contra la base local, ese .env tiene que apuntar a la local tambien.
export function dbTargetArgs() {
  const target = (process.env.DB_TARGET ?? "linked").toLowerCase();
  if (target === "local") {
    const workdir = process.env.SUPABASE_WORKDIR;
    return workdir ? ["--local", "--workdir", workdir] : ["--local"];
  }
  if (target === "url") {
    if (!process.env.DB_URL) throw new Error("DB_TARGET=url necesita DB_URL");
    return ["--db-url", process.env.DB_URL];
  }
  if (target === "linked") return ["--linked"];
  throw new Error(`DB_TARGET desconocido: ${target} (local, url o linked)`);
}
