# Progreso: Contenido v3 (B10 a B14, F73 a F105)

Rama `contenido-v3` desde `main` (`c380037`). Plano: `docs/requerimientos-contenido-v3.md`.
Este archivo es la memoria de la corrida: se actualiza en cada funcionalidad.

## Punto de partida (3/10/2026, antes de tocar código)

| Chequeo | Resultado |
|---|---|
| `npx vitest run` | 373 archivos, **4.486 tests, todos en verde** |
| `npm run build` | **exit 0** |
| `npm run lint` | **4 errores y 38 warnings que ya existían** en `main` (`dashboard-panel.tsx:56`, `spend-chart-tabs.tsx:57` y `:60`, `onboarding-banner.tsx:37`). Línea base: 4 errores. |
| `verify-rls.mjs` | 240 checks, "Todo verde", exit 0 |
| `verify-crm.mjs` | 25 checks, exit 0 |
| `verify-content.mjs` | 28 checks, exit 0 |
| `verify-inbox-filters.mjs` | 18 checks, exit 0 |
| Migración más alta aplicada | `00112_ai_spend_by_day`. Próxima libre: **`00113`** |

Números de la base (solo lectura): `social_accounts` 0, `social_posts` 0, `contacts.attribution` 0 de 636, `social_post_comments` 167 con 0 vinculados, `content_posts` 1, `content_ideas` 1.

Decisiones tomadas con Wendy (ver `docs/PENDIENTE.md`, sección "Corrida Contenido v3"):
- Comentarios de Instagram: se vinculan a un contacto solo si ya existe. No se crea contacto por cada comentarista.
- Toques de DM: solo los que suman información (primer mensaje, respuesta a historia, dato de anuncio, vuelta después de 7 días).
- Drawer de la pieza sin vista previa del teléfono (como el prototipo v5).
- `cambios-prototipo-contenido.md` no está en el disco: se sigue sin él.

## Caracterización (antes de tocar)

- `computeAccounts`: `lib/social/accounts.test.ts` (13 casos, pura). Existente.
- Receptor de comentarios: `app/api/webhooks/late/route.test.ts:431-520`. Tercero dispara `processComment`, propio no. Existente.
- `readAttribution` con las tres formas: `lib/contacts/attribution.test.ts`. Existente (sin el caso de la forma plana del agendamiento: se agrega en B11).
- Receptores de mensajes: `route.test.ts` (Zernio, DM y comentarios) y `evolution/route.test.ts`. Existentes.

## Bloques

### B10: desatasque (F73 a F80) — COMPLETO en la rama, 5/10/2026
- [x] **F73** Cuentas sociales desde la lista de Zernio. `0eab9c9`. Sin clave de Zernio, las cuentas que salían por Zernio quedan "no disponibles" (conservan identidad y canal); una falla de Vault NO cuenta como desconectado (`getZernioKeyState`: present / absent / unknown). `a9d1dd3`.
- [x] **F74** Disparadores de la sync. `0276f65`, `502bb2b`. Helper `lib/social/sync-hook.ts` (nunca lanza), en `saveIntegration`, `disconnectIntegration`, `channels/sync`, `channels/test-key` (la clave de Zernio se guarda ahí) y `syncSocialAccountsNow`. Botón y avisos en la card.
- [x] **F75** Perfil real. `fe27fa4`, `3a981c2`. Foto y link desde Zernio, cifras de perfil en `extra.profile` (solo las que la red da), `markAccountSync` guarda el error y no sella con lectura mala. **La bio no viene en la lista de Zernio: queda null.**
- [x] **F76** Adopción de comentarios huérfanos. `2f61155`. `storeComment` guarda `external_post_id` y ya no desvincula; `adoptOrphanComments` (nunca crea publicaciones) corre después de sincronizar cuentas y de cada sincronización de métricas.
- [x] **F77** Validación en el servidor y tope diario. `450d7f0`. Mismo cálculo y mismo mensaje que el editor; TikTok 15 videos + 15 fotos; la fila guarda `media_type`.
- [x] **F78** Social y métricas por permiso. `9c2218d`. Páginas, menú, `loadPostAnalysis` y las acciones de contenido (aprobar, devolver, archivar, programar) por permiso; producir copy exige `content.ai`. "Actualizar ahora" sigue siendo de Owner/Admin. `verify-rls`: 253 checks en verde, incluye un rol personalizado con `social.view` y otro con `dashboards.content.view` contra la base real.
- [x] **F79** Frecuencia de métricas y LinkedIn. `c538d14`. Ventana de 30 días que se estira (hasta 90) solo si a un post guardado le toca su lectura semanal; tolerancia de 6 h para que el jitter del cron no saltee una semana. `LINKEDIN_API_VERSION` 202510 → **202609** (la última según la documentación de LinkedIn, leída el 5/10/2026).
- [x] **F80** Prueba de punta a punta `lib/publishing/e2e-zernio.test.ts` (12 tests). Solo se simula el cliente de Zernio y la infraestructura. Recorre guardar clave → cuentas → pieza → media → revisar → aprobar → programar → cron real (`/api/cron/content-upload`) → webhook firmado con el secreto que el propio sistema generó → `published`, para Instagram y TikTok. Un caso por disparador de F74, más línea base (sin conectar, programar está bloqueado), idempotencia y firma inválida.

**Procedimiento de mutación de F80** (quitar cada pieza y comprobar que el test se pone rojo; el archivo se restauró después de cada una):

| Mutante | Casos en rojo |
|---|---|
| M1 quitar la sync de `saveIntegration` (Postproxy) | guardar Postproxy |
| M2 quitar la sync de guardar Zernio (`test-key`) | 8: guardar Zernio, desconectar y el recorrido completo de las dos redes |
| M3 quitar la sync de `disconnectIntegration` | desconectar Zernio |
| M4 quitar la sync de "Sincronizar canales" | Sincronizar canales |
| M5 vaciar "Sincronizar cuentas" | Sincronizar cuentas |
| M6 `computeAccounts` no crea TikTok | 6: los tres de TikTok y los de guardar/sincronizar que lo verifican |
| M7 se ignora `zernioConnected` (desconectar no se nota) | desconectar Zernio |

**Migración 00113 aplicada** el 5/10/2026 (CLI, con OK de Wendy) y verificada. **No está registrada en el historial** (`supabase_migrations.schema_migrations`): el sistema de permisos denegó el INSERT. Ver `docs/PENDIENTE.md`.

Lo que cambió respecto del plan original de B10 (y por qué): F73 ahora distingue "desconectado" de "no pude leer" (hacía falta para que F80 pudiera probar la desconexión); F78 sumó `loadPostAnalysis` y las acciones de contenido por permiso (sin eso el rol Content Manager veía la pantalla y fallaba al tocar).

**Tests al cierre de B10:** 382 archivos, 4.590 tests en verde (línea base: 373 y 4.486).

### B11: atribución (F81 a F88) — COMPLETO en la rama, 6/10/2026
- [x] **F81** Taxonomía cerrada (`lib/contacts/taxonomy.ts`): lo desconocido se guarda crudo y el medio queda marcado `medium_raw`. `2995f0b`.
- [x] **F82** Tabla `contact_touches` (**00114, aplicada**): RLS por el scope del contacto, solo el servidor escribe, cascada. `2995f0b`.
- [x] **F83** `recordTouch` (`lib/contacts/touch.ts`): valida con Zod, `raw` con lista blanca (nunca tokens), **nunca lanza**; `record_contact_touch` en la base recalcula primero y último DESDE LA TABLA. `2995f0b`.
- [x] **F84** `readAttribution` entiende las tres formas (canónica, clicks y la plana del agendamiento, antes invisible). **00115 aplicada**: `create_booking` idéntica a la de la 00099 más el toque (verificado con `diff`), triggers con respaldo, backfill de 647 contactos solo donde la atribución estaba vacía. Se ensayó antes en una transacción que se deshace sola. `2995f0b`.
- [x] **F85** Toque de los mensajes entrantes (Zernio y Evolution), solo los que suman información. `2337727`.
- [x] **F86** Atribución de comentarios (`lib/comments/attribution.ts`): Instagram solo vincula a quien ya es contacto (se llama antes y después de `processComment`); TikTok crea un contacto anónimo. `8e203b2`.
- [x] **F87** Alta manual, importación de CSV (solo contactos nuevos) y email. La reserva y el backfill estaban en la 00115. `69bb43f`.
- [x] **F88** Pantalla: ficha (primer y último toque, camino plegado), panel de la bandeja y filtros de la lista por fuente y medio del **primer** toque. `1a46e7d`.
- Verificación contra la base real: `verify-attribution.mjs` (nuevo, **39 checks**), `verify-scheduling.mjs` (**108**, suma 5 del toque de la reserva), `verify-booking-concurrency.mjs` (13) y `verify-crm.mjs`, todos en verde. `00fd73a`.
- Revisión visual (1440 y 390 px, con la sesión que ya tenía el navegador; no ingresé credenciales): la lista de contactos con los filtros nuevos (445 resultados para Instagram · mensaje directo, que son los 647 menos los 202 sin datos ocultos) y la ficha con "Único toque" se ven bien y a 390 px no hay scroll horizontal.
- **Tests al cierre de B11:** 390 archivos, 4.748 tests en verde.

Decisiones tomadas en B11 y por qué:
- **Un toque por DM no:** solo el primero, una respuesta a historia, un mensaje con datos de anuncio, o la vuelta tras 7 días (decisión de Wendy).
- **Instagram no crea contacto por comentar:** solo vincula al que ya existe (decisión de Wendy). TikTok sí, anónimo.
- **Se conservan las formas viejas** (`||` en la base, `readClickAttribution` en el código): nada se borra.
- **El alta manual deja de escribir la forma vieja de clicks.**

### B12: modelo nuevo de la pieza (F89 a F94)
- [ ] F89 Pilares y ofertas (00116) · [ ] F90 Campo único de texto (00117; 00118 **sin aplicar**) · [ ] F91 Clasificación · [ ] F92 Biblioteca de archivos · [ ] F93 Formato y archivos por red · [ ] F94 IA al modelo nuevo

### B13: drawer y pantallas (F95 a F101)
- [ ] F95 Drawer de idea · [ ] F96 Drawer de la pieza (sin vista previa) · [ ] F97 Historial · [ ] F98 Kanban y barra superior · [ ] F99 Rutas viejas · [ ] F100 Social: perfil y "Próximas" · [ ] F101 Atribución en kanban

### B14: medición de la pieza (F102 a F105)
- [ ] F102 Rendimiento de la pieza · [ ] F103 Índice · [ ] F104 Leads por comentario (opcional, puede quedar en PENDIENTE) · [ ] F105 Agrupaciones y documentación

## Verificación final (cuando todo esté marcado)
- [ ] `npx vitest run` · [ ] `npm run build` · [ ] `verify-rls` · [ ] `verify-content` · [ ] `verify-crm` · [ ] `verify-attribution` (nuevo) · [ ] `verify-inbox-filters` · [ ] lint sin errores nuevos sobre la línea base de 4
- [ ] `lib/publishing/e2e-zernio.test.ts` pasa y falla al quitar cada disparador
- [ ] Docs: `docs/contenido.md`, `docs/publicacion.md`, `docs/atribucion.md` (nuevo), `CLAUDE.md`, `BITACORA.md`
- [ ] Merge a `main` y push: **solo si todo lo anterior está en verde**
