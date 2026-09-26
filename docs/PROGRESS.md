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
- [x] **Bloque 2 — Conexiones de redes** (migración 00082 aplicada)
  - [x] F8 · Tablas de conexiones y cuentas sociales (00082 aplicada, publishers validado con Zod, 13 casos nuevos en verify-rls)
  - [x] F9 · Flujo OAuth genérico con `state` firmado (HMAC + nonce en cookie + vencimiento, rutas start/callback)
  - [x] F10 · Conexión con Google (YouTube) (`access_type=offline`, detección de `invalid_grant`, canal por `channels.list`)
  - [x] F11 · Conexión con LinkedIn (`LINKEDIN_API_VERSION`, sin refresh, URN de la persona)
  - [x] F12 · Conexión con Threads (portado: token corto → largo, renovación a los 15 días)
  - [x] F13 · Cuentas sociales y publicadores disponibles (`computeAccounts` puro; conserva lo elegido a mano y avisa al cambiar)
  - [x] F14 · Conexión de Postproxy (cliente según su documentación real; "Probar y guardar" llama a `/profiles` antes de escribir)
  - [x] F15 · Avisos de conexiones (`integration_attention` con ventana por causa y uuid derivado para no tapar un aviso con otro) + cron semanal de renovación
- [x] **Bloque 3a — Modelo de contenido y kanban** (migraciones 00083 y 00084 aplicadas)
  - [x] F16 · Tablas de contenido y bucket (`verify-content.mjs`: 29 casos con dos workspaces, incluido el bucket)
  - [x] F17 · Estados del post (`canTransition` por rol y `aggregatePostStatus` derivado de las redes)
  - [x] F19 · Ideas (aprobar es una sola transacción SQL; los botones dicen por qué están deshabilitados)
  - [x] F20 · Kanban (7 columnas, arrastre validado antes de pedirlo, abre el editor cuando falta la fecha)
- [x] **Bloque 3b — Media, calendario y versiones**
  - [x] F18 · Subida de media (tipo real por magic bytes, TUS sobre 6 MB, `tus-js-client`)
  - [x] F21 · Calendario y lista (una tarjeta por pieza por día, Piezas/Publicaciones, filtros en la URL)
  - [x] F22 · Historial de versiones (el autoguardado no crea versión; comparar y restaurar sin perder nada)
  - [x] F23 · Limpieza de media (cron diario; cuenta desde la última red publicada)
- [x] **Bloque 4a — Editor e IA** (migración 00085 aplicada; la 00084 fue la de aprobar ideas)
  - [x] F24 · Editor del post en una sola página (secciones, autoguardado de 10 s, aviso de edición cruzada)
  - [x] F25 · Fecha por red: tentativa y programado (fila + job juntos; sin job la fila no miente)
  - [x] F26 · Validación por red (límites en un solo lugar; una red con error no frena a las demás)
  - [x] F27 · Palabras clave y automatizaciones (una automatización inactiva no cuenta; link con todo precargado)
  - [x] F28 · Variantes, duplicar y redistribución (lógica pura; el botón del detalle llega en B4b)
  - [x] F29 · Generar guion y caption con IA (salida validada con Zod, tope de gasto ANTES de llamar, versión con autor IA)
- [x] **Bloque 4b — Publicadores y dispatcher** (sin migración: los tipos de job son texto libre)
  - [x] F30 · Interfaz común de publicadores y registro de jobs (caracterización primero: `lib/jobs/dispatch.ts`, 13 tests que fijan el comportamiento de hoy; después `lib/jobs/registry.ts`, donde un tipo desconocido pasa a **fallido** en vez de completado, y `bg_task` conserva su no-op con handler explícito)
  - [x] F31 · Publicador Zernio (Instagram y TikTok) — una red por post, `platformSpecificData` verificado contra el SDK instalado
  - [x] F32 · Publicador Postproxy (YouTube)
  - [x] F33 · Publicador YouTube API oficial — subida reanudable por partes, sin cargar el video en memoria
  - [x] F34 · Publicadores LinkedIn y Threads (LinkedIn solo texto por ahora; con media falla con un mensaje claro en vez de publicar a medias)
  - [x] F35 · Dispatcher, reintentos (1/5/15 min) y avisos de estado — guarda contra publicar dos veces con `UPDATE ... WHERE status='scheduled' RETURNING`, revisión periódica para las que quedan en proceso, `post.platform.*` de Zernio y receptor de Postproxy
  - [x] F36 · Detalle del post (una fila por red, reintentar solo lo que falló)
  - [x] F37 · Aprobación (mandar a revisión, aprobar, devolver con comentario obligatorio, con avisos)
  - [x] F38 · Prueba de publicación directa de YouTube (sube un video de 1 s "no listado", mira cómo quedó y lo borra; **construida, no ejecutada**: escribe en la cuenta real)
  - [x] F39 · Menú de Contenido + completar `triggers.config.postIds` al publicar
- [x] **Fase 1 lista:** suite completa en 0 (26/9/2026)

  | Comando | Resultado al cerrar la Fase 1 |
  |---|---|
  | `npx vitest run` | 159 archivos, 1885 tests, todo en verde |
  | `npm run build` | Compila |
  | `npm run lint` | 0 errores, 44 warnings (la línea base) |
  | `node scripts/verify-rls.mjs` | Todo verde, limpieza OK |
  | `node scripts/verify-content.mjs` | Todo verde, limpieza OK |

### FASE 2 — Métricas, Social y anuncios

- [x] **Bloque 5 — Recolección de métricas y comentarios** (migración **00086**, aplicada)
  - [x] F40 · Card de Meta y cuentas publicitarias (la card se prendió; las cuentas se descubren con el token y se tildan, sin escribir ids a mano)
  - [x] F41 · Tablas de métricas (`social_post_metrics_daily`, `social_account_metrics_daily`, `social_post_comments`, `meta_ads_insights_daily`, con RLS y 20 chequeos nuevos en `verify-rls`)
  - [x] F42 · Lector de Zernio (Instagram y TikTok) — **no existe `/v1/analytics/delta`**: el SDK expone `getAnalytics` con ventana de fechas, y eso es lo que se usa
  - [x] F43 · Lector de Instagram Graph (alcance por tipo de seguidor, audiencia, historias en vivo, perfil)
  - [x] F44 · Lectores de YouTube y Threads (Data API + Analytics API en una sola llamada por canal; Shorts detectados por `creatorContentType` o por vertical ≤ 3 min)
  - [x] F45 · Reglas de recolección y engagement a 7 días (diario hasta 30, semanal hasta 90, nunca después; nunca un cero inventado)
  - [x] F46 · Comentarios (el receptor ahora encuentra cuentas de TikTok, guarda también los propios sin disparar flows, y crea la publicación externa si no existe)
  - [x] F47 · Cron de métricas y actualización manual (cada hora, encola a quien son las 3 en su zona; "Actualizar ahora" con tope de 15 minutos)
- [x] **Bloque 6a — Dashboard orgánico** (sin migración)
  - [x] F48 · Dashboard de contenido orgánico — selector de dashboards en la barra (el de Chat no cambió de ruta ni de datos), KPI con variación, crecimiento de seguidores, actividad, engagement en el tiempo y rendimiento por formato. **La tabla "Tus posts" va en el 6b**, porque su columna "Seguidores ±1 d" es F52 y cada fila abre el análisis, que es F51: escribirla ahora sería escribirla dos veces.
  - [x] F49 · Explorador de tendencias (doble eje por red, atajos, redes por pastilla, configuración en la URL con ida y vuelta probada)
  - [x] F50 · Engagement a 7 días por semana de publicación (la semana en curso se marca)
  - [x] F53 · Datos al día por red, con el último dato bueno cuando la última lectura falló
  - Gráficos en SVG a mano, sin librería nueva: un hueco se dibuja como hueco, nunca como cero.
- [x] **Bloque 6b — Análisis por post y página Social** (sin migración)
  - [x] F51 · Análisis histórico de un post (panel lateral desde la tabla y desde Social, con flechas y Esc; las fotos acumuladas se convierten en "lo nuevo de cada día", un día faltante se reparte y se marca, y un acumulado que baja suma cero en vez de un negativo)
  - [x] F52 · Seguidores alrededor de la publicación — **señal, no atribución**, y el rótulo lo dice. Mediana de 28 días, casos parcial y cuenta chica, y los posts vecinos de esas 48 h.
  - [x] F54 · Página Social (perfil con las cifras que usa cada red, grilla con la proporción de cada red, métricas al pasar el mouse, "A mano" en lo que no salió del sistema)
  - [x] Tabla "Tus posts" del F48, que se difirió del 6a: ordenable por cualquier columna, los sin dato siempre al final, y cada fila abre el análisis.
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
| 00083 | Pipeline de contenido: 4 tablas, bucket `content-media` con policies por workspace, cron de limpieza | ✅ aplicada y verificada |
| 00084 | `approve_content_idea()`: crea la pieza y aprueba la idea en una transacción | ✅ aplicada y verificada |
| 00085 | `agent_runs.source` suma `content_copy` y `ads_analysis`; `workspaces.content_copy_settings` (voz de marca) | ✅ aplicada |

## Deuda que deja el Bloque 1

- `countScheduledUses` (aviso antes de desconectar) devuelve 0 hasta el Bloque 3: la tabla `social_posts`
  todavía no existe. Al crearla en B3a hay que completar el cuerpo; la pantalla ya pregunta.

**Aviso de coordinación:** hay otra sesión trabajando la Etapa 4 en paralelo sobre la misma base
(`.claude/worktrees/etapa4-agendamiento-tanda-a-85d668`). Confirmó que toma la banda desde `00121`
y que no corre scripts `verify-*` en esta tanda. Igual conviene verificar `list_migrations` antes de aplicar.
Verificar `list_migrations` justo antes de aplicar cualquier migración.
