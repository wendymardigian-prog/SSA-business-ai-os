# Bloque S — Configuración (S1 a S7)

**Rama:** `feat/ajustes-secciones`, creada desde `main` **después** de
mergear el Bloque N (PR #11) y el Bloque I (PR #12, trae N adentro).
**Migraciones:** ninguna, como pedía el bloque.

## Punto de partida

- `npx vitest run` en `main` actualizado (con N e I mergeados): 345
  archivos, 4274 tests, todo verde.
- `npm run build`: compila sin errores.

Base sana: se construyó encima sin problema. Confirmado además que el
merge de I solo tocó `lib/nav/page-actions.ts` (el título "Inbox" →
"Bandeja"), nada que colisionara con este bloque.

## Qué se hizo

| Paso | Commit | Qué cambia |
|---|---|---|
| 0 (S6) | `82b3130` | `lib/settings/permissions-characterization.test.ts`: fija, antes de tocar una pantalla, qué guard usa cada pestaña y qué pestañas ve cada rol — incluido un Member con rol personalizado y `roles.manage`, que hoy ve Roles pero ninguna otra pestaña de admin porque los guards miran el campo `role` grueso, no los permisos finos. Se commitea primero, en verde, para que S1-S7 no lo rompan sin darse cuenta. |
| 1 (S1) | `1c76a98` | Las pestañas pasan de 4 a 6: se agregan Campos personalizados y Recursos. La lista y la regla de cuál queda activa salen a `lib/settings/tabs.ts` (datos puros, con test). Recursos queda marcada también en `/templates` y `/audios`, que solo redirigen. La fila pasa de `flex-wrap` a `overflow-x-auto` para no partirse en renglones a 390px. Se suma `<SettingsTabs />` en `custom-fields-view` y, solo si `canManage`, en `recursos-view`. |
| 2 (S2) | `5c453e7` | General pasa de 13 bloques apilados a 4 secciones (Workspace, Conversaciones, Archivos, IA) con navegación interna por anclas (`SectionNav`, mismo patrón visual que `config-nav.tsx` de Agenda). Se eliminan las seis tarjetas-link duplicadas. La sección IA suma interfaz para tres columnas de `workspaces` que no la tenían: los topes de gasto (reusan `updateWorkspaceAiLimits`, que ya existía) y el escalado por mensaje sin entender (`updateAgentEscalation`, nueva, mismo patrón que `updateMessagePersistence`). El botón de abajo sigue guardando solo nombre y palabras clave, con una nota que lo aclara. |
| 3 (S3) | `af05224` | Segmented `Miembros \| Roles` debajo de las pestañas, en las dos pantallas (`components/settings/team-roles-switch.tsx`). En Equipo se saca la flecha "Volver a Ajustes" (las pestañas ya cumplen esa función). Se agrega la leyenda sobre los roles de sistema. `roles/page.tsx` lee el rol con `getWorkspace()` (solo lectura, no es un guard nuevo) para ocultar "Miembros" cuando lo ve un rol personalizado con `roles.manage` que no es Owner/Admin. |
| 4 (S4) | `e0f9ed0` | Español parejo en Configuración y Canales: `settings-view`, `team-view` (incluidos los dos diálogos de confirmar), `team/page.tsx`, `channels-view`, `channels/callback`, y los errores de `lib/actions/team.ts` y de las rutas API de canales que llegan a la pantalla. Fechas a `es-AR`. De paso: `team-view` mostraba el rol crudo (`member`) en vez de `ROLE_LABELS`, y descartaba en silencio el error al quitar a alguien o anular una invitación; los dos se arreglaron. `lib/settings/spanish.test.ts` guarda la regresión. |
| 5+7 (S5, S7) | `3c049e8` | Estado vacío compartido (`SettingsEmptyState`, título "Todavía no hay nada acá") en Equipo, Roles, Campos personalizados, Recursos, Integraciones y Tareas, con los textos en `lib/settings/empty-states.ts` y un test con `renderToStaticMarkup`. El link "Ver corridas de IA" (S7) se extrae a `components/settings/ai-runs-link.tsx`, sin `usePathname`/`useRouter`, para poder testear sus dos casos (con `ai_costs.view` aparece, sin ella no) sin levantar toda la pantalla. |

## Verificación

- `npx vitest run` después de cada paso, siempre en verde. Al cierre:
  **351 archivos, 4318 tests**, 0 en rojo, 0 saltados.
- `npx tsc --noEmit` después de cada paso: sin errores.
- `npm run build`: compila sin errores, después de cada paso.
- Los tres tests estructurales (`lib/auth/member-baseline.test.ts`,
  `lib/nav/page-actions.test.ts`, `lib/vault-boundary.test.ts`) se
  corrieron después de cada paso y **no se tocaron**: siguen en verde sin
  una sola línea de cambio.
- El test de caracterización del paso 0 da exactamente lo mismo después de
  S1-S7.
- **Verificación visual real**, con sesión real de Wendy (a diferencia del
  Bloque N, acá sí se pudo completar): se levantó un servidor de desarrollo
  en un worktree fuera del árbol del repo (para no pisar el `next dev` de
  otra sesión activa sobre el mismo checkout, y porque un worktree anidado
  hace que Turbopack encuentre el lockfile del checkout principal al subir
  directorios y use su `.next/dev/lock`). Se navegó Configuración y Canales
  en vivo, a 1440px y a 390px. Capturas en `docs/shots/` (prefijo `1440-` y
  `390-`). Sin errores de consola ni de red propios del código (un único
  403 de una imagen de perfil de Instagram, preexistente y ajeno a este
  bloque).

## Criterios de la sección 6 del documento

**S1 — Las pestañas**
- ✅ `/dashboard/settings/custom-fields` y `/templates` muestran las
  pestañas con la propia marcada (`lib/settings/tabs.test.ts`, verificado
  además en vivo).
- ✅ `/dashboard/settings` marca solo General, por igualdad exacta.
- ✅ A 390px la fila scrollea internamente, confirmado con
  `document.documentElement.scrollWidth === window.innerWidth` (390 = 390)
  en Configuración y en Canales.

**S2 — General dividido en secciones**
- ✅ Las cuatro secciones y la navegación interna se ven (capturas
  `1440-general-workspace.jpg`, `1440-general-ia.jpg`).
- ✅ El ancla activa se marca al hacer clic (`SectionNav`, confirmado en
  vivo: clic en "IA" saltó a la sección y quedó en el hash `#ia`).
- ✅ Las seis tarjetas-link ya no existen (`grep` sobre `settings-view.tsx`
  no encuentra ninguna).
- ✅ Cada ajuste conserva su guardado: el botón de Workspace sigue
  llamando solo a `updateWorkspaceSettings({name, globalKeywords})`: los
  topes llaman a `updateWorkspaceAiLimits` y el escalado a
  `updateAgentEscalation`, cada uno por su cuenta.
- ✅ Guardar un tope acá escribe las mismas columnas que escribía la
  pestaña Costos de un agente (misma acción, `lib/actions/agents.ts`).

**S3 — Equipo y Roles**
- ✅ El segmented está visible y funciona en las dos pantallas (capturas
  `1440-equipo.jpg`, `1440-roles.jpg`, `390-equipo.jpg`, `390-roles.jpg`).
- ✅ Entrar directo a `/dashboard/settings/roles` marca "Roles" activo.
- ✅ "Nuevo rol" sigue en la barra superior y sigue abriendo el formulario
  existente (confirmado visualmente; no se clickeó para no mutar datos
  reales de producción).

**S4 — Español parejo**
- ✅ No queda texto visible en inglés de la lista conocida
  (`lib/settings/spanish.test.ts`, 9 archivos revisados como texto).
- ✅ Confirmado en vivo: "(vos)", "Miembros (1)", "Invitar a alguien",
  "Invitaciones pendientes (1)", "Vence el 8 oct", "Sincronizar",
  "Conectar canal", "Activo", "Conectado el 4 sept" — todo en español.
- ✅ Los nombres técnicos (Owner, Admin, Member, Zernio, nombres de modelo,
  claves de permiso) no se tradujeron.

**S5 — Estados vacíos**
- ✅ Las seis pestañas renderizan su estado vacío
  (`lib/settings/empty-states.test.ts`, render con `renderToStaticMarkup`).
  Confirmado en vivo en dos pestañas que hoy están realmente vacías en el
  workspace de Wendy: Campos personalizados y Recursos (capturas
  `1440-campos-personalizados-vacio.jpg`, `1440-recursos-vacio.jpg`,
  `390-recursos-vacio.jpg`).

**S6 — Permisos por pestaña**
- ✅ No cambió qué puede ver quién: el test de caracterización del paso 0
  sigue dando exactamente lo mismo.
- ✅ `lib/auth/member-baseline.test.ts` no necesitó ni un cambio.

**S7 — Link a Corridas**
- ✅ Aparece con `ai_costs.view` y no aparece sin ella
  (`components/settings/ai-runs-link.test.ts`, los dos casos).
- ✅ Apunta a `/dashboard/agents` hasta que exista la pantalla de Corridas
  (confirmado: `href="/dashboard/agents"` en el HTML renderizado, y en vivo
  en la sección IA de General).

## Decisiones que tomó Wendy (1/10/2026)

- Mergear primero `feat/bandeja-barra` (Bloque I, trae N adentro) y recién
  después crear esta rama desde `main`.
- La pestaña 6 se llama **"Recursos"** (no "Respuestas rápidas" ni "Banca
  de recursos"), apunta a `/dashboard/settings/recursos`.
- **No hay "Zona de peligro"**: no existe nada destructivo en Ajustes hoy
  (no hay transferir la propiedad ni borrar el workspace). General queda
  con 4 secciones.
- Leyenda de Roles ajustada porque no existe un botón "Duplicar": *"Los
  roles Owner, Admin y Member vienen con el sistema y no se editan. Para
  armar el tuyo, usá Nuevo rol."*

## Pendiente / fuera de alcance de este bloque

- No se clickeó ningún botón de guardado real (topes de gasto, escalado,
  invitar, nuevo rol) para no mutar datos de producción de Wendy durante
  la verificación visual. El comportamiento de guardado está cubierto por
  los tests existentes de cada server action (ninguno se tocó salvo
  `updateAgentEscalation`, nueva) y por la revisión de código.
- El link a Corridas sigue apuntando a `/dashboard/agents`: se actualiza a
  `/dashboard/agents/runs` recién en el Bloque A+R, cuando esa pantalla
  exista (tal como pide S7).
- El worktree de preview (fuera del árbol del repo, con su propio
  `next.config.ts` con `turbopack.root` forzado) se descartó por completo
  al cerrar el bloque: no queda nada de eso en esta rama.
