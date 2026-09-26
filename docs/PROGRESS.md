# Progreso — Etapa 2 (Integraciones, Publicación, Contenido, Métricas, Email y Roles)

Corrida autónoma en la rama `etapa2`. Plano: [docs/requerimientos-etapa2.md](requerimientos-etapa2.md) (v2.0).
Este archivo es la memoria de la corrida: se actualiza por funcionalidad, no solo al cerrar cada bloque.

## Punto de partida (26/9/2026, `main` = `origin/main` = `3706c23`)

| Comando | Resultado de hoy |
|---|---|
| `npx vitest run` | 117 archivos, **1258 tests en verde** |
| `npm run build` | OK (exit 0) |
| `npm run lint` | 0 errores, **44 warnings preexistentes** (directivas `eslint-disable` sin uso) |
| `node scripts/verify-rls.mjs` | Todo verde, limpieza OK |
| `node scripts/verify-crm.mjs` | Todo verde, limpieza OK |
| `node scripts/verify-inbox-filters.mjs` | Todo verde, limpieza OK |
| `node scripts/verify-dashboards.mjs` | Todo verde, limpieza OK |

"Sin errores nuevos de lint" = seguir en **0 errores**; los 44 warnings son la línea base.

**Base** (`knrxjnmxnmjavivyuwew`): última migración aplicada `00080_background_tasks` (la base tiene además
`00078_chat_dashboard_trends`, `00079b` y `00079c`, que en el repo viven dentro de 00078/00079).
**La Etapa 2 empieza en `00081`.** La `00072_draft_window_alerts` **no está aplicada** (verificado: no existen
`private.alert_draft_windows` ni su cron); sigue diferida.

**Datos al arrancar:** 1 workspace, 1 solo miembro (Owner, no hay ningún Member real), 1 canal
(Instagram/Zernio, `connection_status = unknown`), sin canal de WhatsApp. Vault tiene solo `anthropic_api_key`
y `voyage_api_key`: la API key de Zernio sigue en `workspaces.late_api_key_encrypted` y el secreto del webhook
en `workspaces.webhook_secret`. `integration_configs`: 2 filas (Anthropic, Voyage), ninguna de Zernio.
Un solo bucket (`knowledge`), 0 policies en `storage.objects`. `scheduled_jobs`: 9 `bg_task` y 1
`index_document`, todos `completed`.

**Diferencias con §3 del plano** encontradas en la exploración: 8 páginas con `requireWorkspaceAdmin` (no 7),
51 acciones con `getAdminContext` (no ~40), lista blanca de `call_app_cron` redefinida en 00036/00063/00077/00080,
`lib/vault.ts` no está protegido como server-only, el filtro de la bandeja no usa `PLATFORMS`, los dos scripts
que leen la key vieja llaman `read_secret` con parámetros equivocados, y `bg_task` se reencola cada 15 minutos.
Detalle completo en el plan de la corrida y en [PENDIENTE.md](PENDIENTE.md).

## Bloques

- [x] **Bloque 0 — Arranque:** rama `etapa2`, plano en `docs/`, `docs/referencia/` ignorada (git, TypeScript, ESLint y Vitest), PROGRESS y PENDIENTE nuevos

### FASE 1 — Integraciones, contenido y publicación

- [x] **Bloque 1 — Integraciones, Vault y barra superior** (migración 00081 aplicada)
  - [x] Caracterización · webhook de Evolution (18 casos) y webhook de Zernio (22 casos), en verde
  - [x] F1 · Catálogo extendido con tipos de conexión (`connection`, `section`, `visible`, `secretFields`, `usage`, `providersBySection()`; entradas zernio, evolution, postproxy, google, linkedin, threads, meta oculta, resend_inbound oculta) + `lib/secret-names.ts` + `lib/vault-boundary.test.ts`
  - [x] F2 · Pantalla en grid con cards compactas (`integrationStatus()`, filtro "Requiere atención" en la barra superior)
  - [x] F3 · Modal de configuración genérico (armado desde el catálogo, varios secretos, "Guardado ✓ · Reemplazar", desconectar con confirmación)
  - [x] F4 · Evolution en Vault con fallback (`lib/evolution-config.ts`, 8 llamadores, webhook por workspace, test que prohíbe leer `process.env.EVOLUTION_` en otro lado)
  - [x] F5 · Secreto del webhook de Zernio en Vault con fallback (Vault → workspace → canal) + "Migrar a Vault" (construido, no apretado)
  - [x] F6 · Cards de las integraciones existentes y barra de uso (`buildUsage`, Zernio 2 cuentas gratis; Zernio sigue guardándose por `test-key`)
  - [x] F7 · Barra superior en todas las pantallas (una sola barra también en el celular; `lib/nav/page-actions.ts` con título, explicación y acciones por rol; 22 pantallas migradas; `MobileTopBar` eliminada)
- [ ] **Bloque 2 — Conexiones de redes** (migración 00082)
  - [x] F8 · Tablas de conexiones y cuentas sociales (00082 aplicada, publishers validado con Zod, 13 casos nuevos en verify-rls)
  - [x] F9 · Flujo OAuth genérico con `state` firmado (HMAC + nonce en cookie + vencimiento, rutas start/callback)
  - [x] F10 · Conexión con Google (YouTube) (`access_type=offline`, detección de `invalid_grant`, canal por `channels.list`)
  - [x] F11 · Conexión con LinkedIn (`LINKEDIN_API_VERSION`, sin refresh, URN de la persona)
  - [x] F12 · Conexión con Threads (portado: token corto → largo, renovación a los 15 días)
  - [x] F13 · Cuentas sociales y publicadores disponibles (`computeAccounts` puro; conserva lo elegido a mano y avisa al cambiar)
  - [ ] F14 · Conexión de Postproxy
  - [ ] F15 · Avisos de conexiones
- [ ] **Bloque 3a — Modelo de contenido y kanban** (migración 00083)
  - [ ] F16 · Tablas de contenido y bucket
  - [ ] F17 · Estados del post
  - [ ] F19 · Ideas
  - [ ] F20 · Kanban
- [ ] **Bloque 3b — Media, calendario y versiones**
  - [ ] F18 · Subida de media
  - [ ] F21 · Calendario y lista
  - [ ] F22 · Historial de versiones
  - [ ] F23 · Limpieza de media
- [ ] **Bloque 4a — Editor e IA** (migración 00084)
  - [ ] F24 · Editor del post en una sola página
  - [ ] F25 · Fecha por red: tentativa y programado
  - [ ] F26 · Validación por red
  - [ ] F27 · Palabras clave y automatizaciones
  - [ ] F28 · Variantes, duplicar y redistribución
  - [ ] F29 · Generar guion y caption con IA
- [ ] **Bloque 4b — Publicadores y dispatcher**
  - [ ] F30 · Interfaz común de publicadores y registro de jobs
  - [ ] F31 · Publicador Zernio (Instagram y TikTok)
  - [ ] F32 · Publicador Postproxy (YouTube)
  - [ ] F33 · Publicador YouTube API oficial
  - [ ] F34 · Publicadores LinkedIn y Threads
  - [ ] F35 · Dispatcher, reintentos y webhooks de estado
  - [ ] F36 · Detalle del post
  - [ ] F37 · Aprobación
  - [ ] F38 · Prueba de publicación directa de YouTube
  - [ ] F39 · Menú de Contenido
- [ ] **Fase 1 lista:** suite completa en 0

### FASE 2 — Métricas, Social y anuncios

- [ ] **Bloque 5 — Recolección de métricas y comentarios** (migración 00085)
  - [ ] F40 · Card de Meta y cuentas publicitarias
  - [ ] F41 · Tablas de métricas
  - [ ] F42 · Lector de Zernio (Instagram y TikTok)
  - [ ] F43 · Lector de Instagram Graph
  - [ ] F44 · Lectores de YouTube y Threads
  - [ ] F45 · Reglas de recolección y engagement a 7 días
  - [ ] F46 · Comentarios
  - [ ] F47 · Cron de métricas y actualización manual
- [ ] **Bloque 6a — Dashboard orgánico**
  - [ ] F48 · Dashboard de contenido orgánico
  - [ ] F49 · Explorador de tendencias (doble eje por red)
  - [ ] F50 · Engagement a 7 días por semana de publicación
  - [ ] F53 · Datos al día
- [ ] **Bloque 6b — Análisis por post y página Social**
  - [ ] F51 · Análisis histórico de un post
  - [ ] F52 · Seguidores alrededor de la publicación
  - [ ] F54 · Página Social
- [ ] **Bloque 7a — Meta Ads (cuenta)**
  - [ ] F55 · Sincronización de insights
  - [ ] F56 · Dashboard de Meta Ads (cuenta)
  - [ ] F58 · Datos en vivo con caché
- [ ] **Bloque 7b — Detalles, unificado e IA**
  - [ ] F57 · Detalles de campaña, ad set y anuncio
  - [ ] F59 · Dashboard unificado
  - [ ] F60 · Leads por campaña (nice-to-have)
  - [ ] F61 · Analizar con IA (nice-to-have)
- [ ] **Fase 2 lista:** suite completa en 0

### FASE 3 — Email entrante y roles

- [ ] **Bloque 8 — Email como canal** (migración 00086)
  - [ ] F62 · Canal Email y cambios de esquema
  - [ ] F63 · Recepción de email
  - [ ] F64 · Email en la bandeja
  - [ ] F65 · Responder email
  - [ ] F66 · Cuota de Resend
  - [ ] F67 · Trigger "email recibido" en flows (nice-to-have)
- [ ] **Bloque 9 — Roles personalizados** (migraciones 00087, 00088 y 00089 sin aplicar)
  - [ ] F68 · Catálogo de permisos (con la caracterización del Member ANTES)
  - [ ] F69 · Tablas y funciones de roles
  - [ ] F70 · Guards y menú por permiso
  - [ ] F71 · Pantalla de roles
  - [ ] F72 · Asignar rol a una persona
- [ ] **Fase 3 lista y cierre:** suite completa en 0, documentación al día, `docs/referencia/` borrada, merge a `main`

## Migraciones creadas

| # | Qué crea | Aplicada |
|---|---|---|
| 00081 | `integration_configs.type` suma `social_network`, `publishing_service`, `google`, `meta` | ✅ aplicada y verificada (acepta los cuatro nuevos, rechaza uno inventado) |
| 00082 | `oauth_connections`, `social_accounts`, cron `social-token-refresh` + lista blanca | ✅ aplicada y verificada (RLS, únicos y CHECK probados con dos workspaces) |

## Deuda que deja el Bloque 1

- `countScheduledUses` (aviso antes de desconectar) devuelve 0 hasta el Bloque 3: la tabla `social_posts`
  todavía no existe. Al crearla en B3a hay que completar el cuerpo; la pantalla ya pregunta.

**Aviso de coordinación:** hay otra sesión trabajando la Etapa 4 en paralelo sobre la misma base
(`.claude/worktrees/etapa4-agendamiento-tanda-a-85d668`). Confirmó que toma la banda desde `00121`
y que no corre scripts `verify-*` en esta tanda. Igual conviene verificar `list_migrations` antes de aplicar.
Verificar `list_migrations` justo antes de aplicar cualquier migración.
