# Plantilla de estudiantes (SSA-BAIOS): cómo se arma y cómo se actualiza

La plantilla de estudiantes (`Scaling-Systems/SSA-BAIOS`) es este proyecto **sin** Llamadas, Formularios (con fin de día, contratos y `/f`), Ventas (queda el catálogo de productos y la pantalla Asignación), Tareas, Finanzas, Comisiones, Webhooks entrantes ni el sitio público. Se instala desde cero con 17 migraciones limpias, una por área, sin historia.

No se arma a mano: sale de este repo con un comando. Este documento explica las piezas y el procedimiento para actualizarla. La plantilla de clientes B2B (`BAIOS`) es otra cosa: ver [plantilla-clientes.md](plantilla-clientes.md).

## Las piezas

| Pieza | Para qué |
|---|---|
| `scripts/plantilla/perfiles/estudiantes.mjs` | Qué módulos salen, con sus carpetas, archivos, tests y paquetes. `proyecto` es un pseudo-módulo: marca lo que solo tiene sentido acá (historia, herramientas del export). |
| Marcas en el código | `// @plantilla-quitar(ventas)` saca una línea; `@plantilla-desde(x)` … `@plantilla-hasta(x)` saca un bloque; `@plantilla-sin(x): …` reemplaza la línea por otra en la plantilla. Son comentarios: el proyecto funciona igual. |
| `scripts/plantilla/modulos.test.ts` | Falla si un archivo que viaja importa algo de un módulo que no viaja sin una marca. Así el recorte no se desactualiza solo. |
| `scripts/plantilla/poda.sql` | Lo que se le saca a la base para la plantilla (tablas, funciones, columnas, CHECK, cron, buckets). Sin CASCADE: si algo que se queda dependía de un módulo, falla. Decisiones explicadas en [plantilla-estudiantes/decisiones-poda.md](plantilla-estudiantes/decisiones-poda.md). |
| `scripts/plantilla/build-reference.mjs` | Base de referencia en Supabase local (Docker): todas las migraciones del proyecto + la poda. |
| `scripts/plantilla/clean-history.mjs` | Saca la historia de los comentarios de la base de referencia (números de migración, fechas, códigos). Solo comentarios. |
| `scripts/plantilla/generate-migrations.mjs` + `areas.mjs` | Escribe `plantilla-estudiantes/supabase/migrations/` (17 archivos por área) leyendo la base de referencia. |
| `scripts/verify-student-schema.mjs` | Instala esas migraciones en una base vacía y la compara objeto por objeto con la referencia. Tiene que dar 0 diferencias. |
| `scripts/export-template.mjs --perfil=estudiantes` | Arma la copia: borra los módulos, aplica las marcas, limpia la historia de los comentarios del código, pone las migraciones consolidadas y los textos de `scripts/template-files/estudiantes/` (CLAUDE.md, README, `/setup`, `.env.example`). Corre los controles y arma el git solo si todos pasan. |

Los controles del export: tipos (`tsc`), lint, tests, `next build`, nombres propios, historia (en comentarios) y textos visibles que nombren un módulo que no viaja. Cada uno tiene su lista de excepciones con el motivo.

## Requisitos

- Docker Desktop prendido (con unos 8 GB de memoria). El Supabase local de este trabajo usa los puertos **553xx** (referencia) y **556xx** (prueba de la plantilla), para no chocar con otro proyecto local en los 543xx.
- `PATH` con el docker de Docker Desktop: `export PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH`.

## Actualizar la plantilla

1. **Base.** Con el proyecto al día:
   ```bash
   node scripts/verify-student-schema.mjs --generate
   ```
   Reconstruye la referencia, la poda, limpia la historia, regenera las migraciones y las compara. Si una migración nueva del proyecto toca un módulo que no viaja, la poda o el control de restos fallan: ajustar `poda.sql` (y anotar la decisión en `decisiones-poda.md`). Si una tabla o función nueva no tiene área, el generador lo dice: sumarla en `areas.mjs`.
2. **Código.** `npx vitest run scripts/plantilla` (el test de frontera dice qué archivo nuevo necesita una marca). Lo que solo es de un módulo va al perfil; lo que se comparte, a una carpeta neutra (`lib/shared`, `lib/calendar`, `lib/catalog`, `lib/assignment`, `components/shared`).
3. **Textos.** Si cambió algo que el estudiante tiene que saber, actualizar `scripts/template-files/estudiantes/` (CLAUDE.md, README, `/setup`).
4. **Export.**
   ```bash
   node scripts/export-template.mjs --perfil=estudiantes --out=../template-export-estudiantes-nueva
   ```
   Tarda unos 5 minutos. Si algún control falla, la copia queda sin git y el informe está en `<out>-controles/`.
5. **Prueba de instalación** (recomendada si cambió la base): copiar la exportación, poner los puertos de su `supabase/config.toml` en 557xx (solo para la prueba), `supabase start` + `supabase db reset`, `create-owner`, seeds y los `verify-*` con `DB_TARGET=local SUPABASE_WORKDIR=<carpeta>`.
   La CLI 2.95.4 tiene problemas con `db query --local` (texto plano en DDL, varias sentencias en un `-f`, funciones `void`): cuatro verify (ads-attribution, chat-awaiting, contact-merge, organic-attribution) fallan por eso en local y pasan contra un proyecto vinculado.
6. **Publicar** (con el OK de Wendy): desde la primera versión limpia, cada actualización es **un commit nuevo** encima en `Scaling-Systems/SSA-BAIOS` (copiar la exportación sobre el clon local, revisar el diff, commit y push). El reemplazo de cero (force push) fue solo la primera vez.
