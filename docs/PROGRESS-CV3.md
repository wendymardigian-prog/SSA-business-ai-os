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

### B10: desatasque (F73 a F80)
- [x] **F73** Cuentas sociales desde la lista de Zernio. `computeAccounts` acepta `zernioAccounts`; sin lista, respaldo por canales. Commit `0eab9c9`. Tests: `lib/social/accounts-zernio.test.ts` (7), `accounts.test.ts` (13).
- [x] **F74** Disparadores de la sync. Commits `0276f65` y `502bb2b`. Helper `lib/social/sync-hook.ts` (nunca lanza). Cableado en `saveIntegration`, `disconnectIntegration`, `channels/sync`, `channels/test-key` (la clave de Zernio se guarda ahí, no con `saveIntegration`), y la acción `syncSocialAccountsNow`. Botón "Sincronizar cuentas" y avisos en la card. Tests: `lib/actions/integrations-social-sync.test.ts`.
- [~] **F75** Perfil real. Commit `fe27fa4`. Hecho: foto y link desde Zernio, `handle`, sellado solo con lectura buena. **Falta:** guardar el error en la cuenta (necesita la 00113) y la bio (no viene en la lista de Zernio).
- [ ] F76 Adopción de comentarios huérfanos (`external_post_id`, migración 00113).
- [ ] F77 Validación por red en el servidor y tope diario (TikTok 15 videos + 15 fotos).
- [ ] F78 Social y métricas por permiso (`social.view`, `dashboards.content.view`; RLS en 00113; `member-baseline.test.ts`).
- [ ] F79 Regla de frecuencia de métricas y `LINKEDIN_API_VERSION`.
- [ ] F80 **Prueba de punta a punta** `lib/publishing/e2e-zernio.test.ts`. Un caso por plataforma y uno por disparador. Procedimiento de mutación pendiente.

**BLOQUEADO:** la migración `00113_comment_post_and_profile_rls.sql` está escrita pero **no aplicada**. El clasificador de permisos denegó la escritura sobre la base compartida. Ver `docs/PENDIENTE.md`, sección "Corrida Contenido v3". Hasta que se aplique, F76 y el error de perfil no pueden cerrarse.

### B11: atribución (F81 a F88)
- [ ] F81 Taxonomía · [ ] F82 Tabla `contact_touches` (00114) · [ ] F83 `recordTouch` · [ ] F84 Lectura de las tres formas (00115) · [ ] F85 Captura en DMs · [ ] F86 Captura en comentarios · [ ] F87 Otros caminos y backfill · [ ] F88 Atribución en pantalla

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
