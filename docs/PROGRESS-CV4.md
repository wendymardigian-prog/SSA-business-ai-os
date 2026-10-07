# Progreso: Contenido v4 (B15 a B18, C1 a C10)

Rama `contenido-v4` desde `main` (`cec8daf`). Plano: `docs/requerimientos-contenido-v4.md`.
Referencia visual: prototipo v23 (copia local en `docs/referencia/prototipo-ssa-baios.html`, fuera del repo).
Este archivo es la memoria de la corrida: se actualiza en cada funcionalidad.

## Punto de partida (7/10/2026, antes de tocar código)

| Chequeo | Resultado |
|---|---|
| `npx vitest run` | 424 archivos, **5.329 tests, todos en verde** |
| `npm run build` | **exit 0**, sin cambios en archivos versionados |
| `npm run lint` | **4 errores y 36 warnings que ya existían** (`dashboard-panel.tsx:56`, `spend-chart-tabs.tsx:57` y `:60`, `onboarding-banner.tsx:37`). Línea base: 4 errores |
| `verify-rls.mjs` | exit 0, "Todo verde" (279 checks) |
| `verify-content.mjs` | exit 0 (37 checks) |
| `verify-crm.mjs` | exit 0 (25 checks) |
| `verify-inbox-filters.mjs` | exit 0 (18 checks) |
| `verify-publishing.mjs` | **intermitente ANTES de tocar nada**: 3 corridas seguidas dieron 2 fallas (D3, A4), 0 fallas y 12 fallas (D1, D6, A13, A6…), en casos distintos cada vez. Ver abajo |
| Migración más alta aplicada | **`00124_user_preferences_rls_perf`** (`list_migrations`). El `CLAUDE.md` decía "próxima 00119": desactualizado, se corrige. Próxima libre: **`00125`** |

**Por qué `verify-publishing` es intermitente.** Encola trabajos "para ahora" en la base real, y el cron de trabajos de producción (cada minuto, contra la misma base) puede tomarlos antes que el script. Como el workspace de prueba no tiene clave de Zernio, la corrida del cron deja la fila en `failed` y los checks siguientes fallan en cascada. No es un error del código de publicación: es una carrera entre el script y el cron real. Para esta corrida, el criterio es **una corrida limpia y cualquier falla explicada por esa carrera**. Queda anotado en `docs/PENDIENTE.md`.

Números de la base (solo lectura, 7/10): `content_posts` 1 (en producción, `material_status=pendiente`, `funnel_stage` null, formato "Reel", una red Instagram con `options.contentType='feed'`, `format` null y 0 archivos); `social_posts` 12, todas `external` de Instagram sin pieza; `content_post_versions` 0.

Esquema real que el plano no tenía en cuenta:
- `content_post_versions` **no tiene `updated_at`** y el CHECK de `reason` no admite `edit` ni `approve`.
- `content_posts.copy` y `content_ideas.hook/angle/notes` **ya no existen** (los borró la 00118).
- La 00119 a la 00124 ya están ocupadas (white label).

## Decisiones tomadas con Wendy (7/10, antes de construir)

1. **Migraciones renumeradas**: `00125_social_posts_origin_manual`, `00126_networks_format_backfill`, `00127_content_versions_session` (nueva, aditiva: `updated_at` y los motivos `edit` y `approve`), `00128_drop_material_and_content_type` (escrita, **sin aplicar**; solo `material_status` y `options.contentType`).
2. **Member con dropdown limitado**: elige Borrador / En producción / En revisión en sus piezas, como hoy. Aprobado y los derivados, bloqueados.
3. **"Marcar como publicado" en cualquier estado.** Al deshacer, la pieza vuelve al estado manual que tenía (`status_before_manual` en la red).
4. **El bug de reprogramar en Zernio se arregla en B15** (`lib/publishing/reschedule.ts`).

Decisiones propias (con el porqué en el plan): "El sistema la publica" exige la pieza aprobada; "conectada" = cuenta activa con publicador usable (`lib/content/connection.ts`); el criterio "ninguna referencia a `contentType`" se lee como `networks[].options.contentType` (el body de Zernio tiene su propio campo `contentType`); la pieza de producción con `feed` y 0 archivos queda con `format` null (§17); `networks[].publisher` deja de escribirse; tokens de color del prototipo a `globals.css`; la sync adopta filas `manual` por URL y, sin URL, por candidata única a ±24 h.

## Caracterización (antes de tocar)

- [ ] `lib/publishing/zernio.test.ts` (nuevo): body que recibe Zernio por formato.
- [ ] `lib/content/status.test.ts`: tabla actual de `aggregatePostStatus`.
- [ ] Borrador → En producción sin material.
- [ ] `lib/metrics/sync.test.ts`: el post propio se actualiza (existente).
- [ ] `lib/publishing/reschedule.test.ts`: el bug de reprogramar en Zernio, primero en rojo.

## Bloques

### B15: planificación sin conexión (C1, C2, C3) — COMPLETO, 7/10/2026
- [x] **C1** Cualquier red, conectada o no. `lib/content/connection.ts`
  (`isNetworkConnected`/`connectedPlatforms`: cuenta activa CON publicador
  usable, no solo `is_active`). Drawer de la pieza y de la idea, y los dos
  diálogos rápidos de creación, ofrecen las cinco redes con chip "a mano" en
  las no conectadas. El estado vacío es informativo (link a Integraciones),
  no bloquea.
- [x] **C2** Cómo se publica cada red. `networks[].auto` (jsonb, sin
  migración de columna). `setNetworkPublishMode` exige cuenta conectada +
  pieza aprobada + fecha futura + F77; desprogramar conserva `planned_at`.
  Desconectar una cuenta (`unscheduleOnDisconnect`) cancela en Zernio ANTES
  de borrar la clave, pasa a `auto:false` conservando la fecha, y avisa
  (notificación `content_networks_unscheduled`).
- [x] **C3** Estado por red y "Marcar como publicado". `networkStateOf`
  (cinco estados, nunca "Programado" sin cuenta conectada).
  `markNetworkPublished`/`unmarkNetworkPublished` crean/borran una fila real
  con `origin='manual'` (migración **00125**, aplicada y registrada).
  Deshacer se rechaza con métricas o comentarios. `derivePieceStatus`
  reemplaza `aggregatePostStatus` en los dos lugares que escriben el estado:
  ahora cuenta TODAS las redes, tengan fila o no.
- [x] Adopción por la sincronización: `lib/metrics/adopt-manual.ts` (por URL
  normalizada o por fecha única en ±24h; con dos candidatas no adopta
  ninguna). `findOrCreatePublication` (comentarios) **no necesitó
  cambios**: converge solo en la próxima sincronización, que es donde hay
  URL/fecha reales para decidir sin adivinar.
- [x] Arreglo: reprogramar una red agendada en Zernio publicaba dos veces
  (`lib/publishing/reschedule.ts`). Test de caracterización que lo muestra
  en rojo antes del arreglo.
- [x] Test de caracterización C9 (antes de B17): `lib/publishing/zernio.test.ts`,
  15 casos, el body exacto que recibe Zernio por formato.
- [x] Adelantado de C8 (mismo modelo de estado): pie del drawer con "N
  programadas · N tentativas · N publicadas" (`networkSummaryText`). Se
  borró `datesSummary`, que quedó sin uso.

Verificación: `npx vitest run` 5430/5430, `npm run build` exit 0, `npm run
lint` 4 errores (línea base), `verify-rls` y `verify-content` en verde.
Commits `3a04e2d`, `1dd1b6f`, `9509061`.

### B16: estados y clasificación (C4, C5, C8) — COMPLETO, 7/10/2026
- [x] **C4** Estado de la pieza como dropdown teñido, sin estado del material.
  Se borran `setMaterialStatus`, `statusAfterMaterialChange` y toda la
  interfaz del campo. El avance Borrador→En producción que antes disparaba
  "Grabado" ahora lo hace la persona con el dropdown (ya lo permitía
  `canTransition`: sin código nuevo, solo un test que lo deja anotado).
  `StatusSelect` usa `STATUS_COLOR` (los mismos colores que el kanban, más
  `--li`/`--zn` nuevos en `globals.css` con los valores del prototipo) y
  bloquea con el tooltip "Lo definen las redes" cuando el estado es
  derivado. Columna de la base marcada "sin uso" en el tipo de lectura (se
  borra en la 00128); sin referencias en `lib/`/`app/` fuera de eso.
- [x] **C5** TOFU/MOFU/BOFU. Etiquetas "TOFU · Descubrimiento" etc. en el
  selector y descripciones al texto exacto del documento. "Sin etapa" ya
  funcionaba.
- [x] **C8** Dónde se ven los programados.
  - Pie del drawer: adelantado en B15 (mismo modelo de estado).
  - Kanban: los íconos de red se resaltan (azul=en cola, verde=publicada,
    rojo=fallida) en vez de verse todos iguales.
  - Calendario: ya mostraba una publicación manual como publicada y una red
    sin conectar como tentativa (el tono depende de `status`, no de
    `origin`); **se encontró y arregló un bug real de paso**: la consulta
    de publicaciones del tablero/calendario no filtraba `deleted_at` ni
    `status='cancelled'`, así que una red desprogramada podía verse "mixed"
    en vez de volver a tentativa. Corregido en
    `app/(dashboard)/dashboard/content/page.tsx`.
  - Social → Próximas: ya distinguía programado de tentativo correctamente
    (depende de la fila real, que una red sin conectar nunca tiene); sin
    cambios.

### B17: limpieza de campos duplicados (C7, C9, C10)
- [ ] **C9** Un solo campo de formato
- [ ] **C7** Archivos filtrados por formato
- [ ] **C10** "Publicar por" fuera de la tarjeta

### B18: guardado automático y versiones (C6)
- [ ] **C6** Todo se guarda solo; versiones por sesión

## Verificación final

(se completa al cerrar)
