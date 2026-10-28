# La plantilla de clientes: cómo se publica, se mantiene y se actualiza

Este repo (el de trabajo) tiene la historia interna, los docs y datos del negocio. **A los clientes nunca se les da este repo.** Se les da una plantilla limpia, que vive en otro repositorio.

## Los dos repositorios

| | Repo de trabajo | Plantilla de clientes B2B |
|---|---|---|
| Dónde | `wendymardigian-prog/SSA-business-ai-os` | `Scaling-Systems/BAIOS` (organización "Scaling Systems") |
| Quién lo ve | Solo el equipo interno. **Tiene que ser privado.** | Cada cliente, como colaborador externo con rol **Read** |
| Qué tiene | Todo: `docs/`, `BITACORA.md`, historia completa | Lo mismo que el de trabajo menos lo interno (ver `scripts/export-template.mjs`) |
| Marcado como Template | No hace falta | Sí (botón verde "Use this template") |

Copia local de la plantilla: `~/Documents/BAIOS-b2b`.

**Ojo, hay una tercera cosa que no es esto:** `Scaling-Systems/SSA-BAIOS` es la plantilla de los **estudiantes**, a propósito más chica que el proyecto actual. `sync-template.mjs` no se usa con ella ni se la toca. La de clientes B2B es `BAIOS`, con el proyecto completo (creada el 15/10/2026 con `export-template.mjs`).

## Publicar una actualización de la plantilla

La plantilla **solo crece**: cada actualización es un commit nuevo encima del anterior. Nunca se re-exporta desde cero ni se reescribe la historia, porque los clientes la usan como `upstream` y su `git merge` se rompería.

1. En este repo, con todo mergeado y probado en `main`, al día (`git pull`) y sin cambios sin guardar.
2. En la copia local de la plantilla: `git checkout main && git pull`.
3. Correr, desde este repo:

   ```bash
   node scripts/sync-template.mjs --template=../BAIOS-b2b
   ```

   El script regenera `ALL_MIGRATIONS.sql`, exporta una copia limpia a una carpeta temporal (con el control de nombres y dominios identificables: si encuentra algo, se corta y no toca la plantilla), la espeja encima de la plantilla (agrega, cambia y borra) y muestra el resumen. **No hace commit ni push.**
4. Mirar el resultado en la plantilla (`git status`, `git diff`), commitear con **la lista de qué trae** (los clientes la leen) y subir:

   ```bash
   cd ../BAIOS-b2b
   git add -A && git commit -m "feat: <qué trae, en una línea>"
   git push origin main
   ```

5. Opcional pero recomendado: marcar la versión para poder decirle a un cliente "estás en la v1.2": `git tag -a v1.2.0 -m "..." && git push --tags`.

Las migraciones nuevas viajan dentro de la actualización (`supabase/migrations/`). Cada cliente las aplica en SU base; este repo nunca toca la base de un cliente.

## Cómo actualiza un cliente

Está en la guía de instalación (sección "Más adelante — Cómo recibir actualizaciones") y en el Paso 6 de `/setup`. Resumen:

1. Su copia queda enganchada con `git remote add upstream <link de la plantilla>` (lo ofrece `/setup`). Necesita tener aceptada la invitación como colaborador de la plantilla.
2. Nunca se actualiza sola. Cuando quiere, abre Claude Code en su carpeta y pide traer las actualizaciones de `upstream/main` y mezclarlas con su copia.
3. La primera vez git se queja de "historias no relacionadas" (su copia nació de "Use this template"): se usa `--allow-unrelated-histories`. Desde la segunda vez ya no pasa.
4. Aplica en su Supabase solo las migraciones nuevas (las que aparecen en `supabase/migrations/` después de mezclar). Con la CLI: `supabase db push`. Sin la CLI: las junta en un solo archivo y lo pega en el SQL Editor. Nunca de a una por el conector. Si armó la base pegando `ALL_MIGRATIONS.sql` y nunca usó la CLI, antes de `db push` hay que marcar las anteriores como aplicadas con `supabase migration repair`.
5. Sube los cambios a su GitHub y Railway publica solo.

## Cosas a cuidar

- **Una actualización con una migración que borra** (columnas o tablas) hay que avisarla en el mensaje del commit: el cliente tiene que aplicar la migración DESPUÉS de desplegar el código nuevo, no antes.
- **Los clientes no ven nada de `docs/`** (se excluye en el export). Si una guía tiene que viajar, va en la guía de instalación o en `.claude/commands/`.
- **El export no es lo mismo que el repo de trabajo**: si algo funciona solo con un archivo que el export excluye, no funciona en el clon. Antes de una actualización grande, vale la pena probar `/setup` en un proyecto descartable.
- **Una persona nueva = acceso de lectura a la plantilla**, nunca miembro de la organización.

## El aviso automático después de un merge

Para no olvidarse de actualizar la plantilla, este repo trae un **hook** de Claude Code (`.claude/settings.json` y `.claude/hooks/baios-reminder.mjs`): cada vez que una sesión corre `gh pr merge`, Claude recibe la instrucción de preguntarte si querés sincronizar `BAIOS`, con una recomendación (sí si el cambio lo ve un cliente: app, migraciones, `/setup`, README; no si es solo interno). Nunca sincroniza solo.

Límites a conocer:
- **Solo cubre los merges que hace Claude** con `gh pr merge`. Si mergeás desde la página de GitHub, el hook no se entera: avisale a Claude ("mergeado") y la regla guardada en su memoria hace la misma pregunta.
- **Lo toman las sesiones nuevas.** Una sesión abierta antes de que este archivo llegue a `main` no lo tiene hasta que se actualice su rama.
- El hook y su configuración **no viajan a la plantilla** (`scripts/export-template.mjs` los excluye).
- La herramienta de la plantilla de estudiantes (`scripts/plantilla/`, `plantilla-estudiantes/`, `scripts/template-files/estudiantes/` y `scripts/verify-student-schema.mjs`) **tampoco viaja**: es de quien arma esa plantilla. Su test con perfil vive en `scripts/plantilla/export-perfil.test.ts` para que la copia de los clientes compile sin ella. Un test que lee `docs/` se saltea si la carpeta no está (`it.skipIf`).
