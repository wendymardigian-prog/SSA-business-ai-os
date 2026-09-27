# Correcciones de la Etapa 2 — progreso

Rama: `etapa2-correcciones` (sale de `main` en `d988e32`). **No se mergea a `main`.**
Plano: [docs/correcciones-etapa2.md](correcciones-etapa2.md). Referencia visual: el prototipo en
`docs/referencia/prototipo/dashboards-de-chat.html` (ignorado por git).

Orden: **A → D → B → E → C**.

## Punto de partida (26/9/2026, antes de tocar nada)

| Comando | Resultado |
|---|---|
| `npx vitest run` | 194 archivos, **2408 tests**, verde |
| `npm run build` | exit 0 |
| `npm run lint` | 0 errores, 44 warnings (linea base) |
| `node scripts/verify-rls.mjs` | 214 ok, todo verde |
| `node scripts/verify-content.mjs` | 28 ok, todo verde |
| `node scripts/verify-crm.mjs` | todo verde |
| `node scripts/verify-inbox-filters.mjs` | todo verde |

Base: 1 workspace, 1 pieza, **0 `social_posts`, 0 cuentas sociales, 0 jobs de publicacion**.
Nada programado que romper.

## Migraciones

| # | Nombre | Grupo | Estado |
|---|---|---|---|
| 00091 | `publish_progress` (que paso de la publicacion ya salio) | A | ✅ aplicada, idempotente |
| 00092 | `content_upload_cron` (ruta propia de las subidas largas) | A | ✅ aplicada |
| 00093 | `zernio_native_scheduling` (estado `uploading` + `provider_media`) | D | ✅ aplicada, idempotente |
| 00094 | `copywriter_agent` (CHECK viejo, `copy_status`, siembra) | E | ✅ aplicada, idempotente |

## A · Publicacion automatica (20 puntos)

Regla: **primero el test que reproduce el error, en rojo.**

| # | Que | Estado |
|---|---|---|
| ✅ A1 | `publisher` sale de `social_accounts.default_publisher` | listo |
| ✅ A2 | Refrescar el access token de Google si vence en < 5 min (tambien en metricas) | listo |
| ✅ A3 | Modo `now` que saltea la validacion de anticipacion | listo |
| ✅ A4 | Reprogramar borra el job pendiente viejo | listo |
| ✅ A5 | Cambiar la fecha en el editor reprograma | listo |
| ✅ A6 | Un unico "al publicarse" que usan los tres caminos | listo |
| ✅ A7 | `SUBSCRIBED_EVENTS` suma `post.platform.published` / `.failed` | listo |
| ✅ A8 | TikTok manda `privacyLevel` y las dos confirmaciones (falta el control en C8) | listo (backend) |
| ✅ A9 | Instagram: tipo (Feed, Carrusel, Reel, Story) (falta el control en C8) | listo (backend) |
| ✅ A10 | Threads: hijos del carrusel, esperar el contenedor, no duplicar el hilo | listo |
| ✅ A11 | Postproxy: `account_ref` propio; id y link del video del estado | listo |
| ✅ A12 | Errores de Zernio (el SDK **lanza**: `.statusCode`, no `.status`) y `errorMessage` | listo |
| ✅ A13 | Recalcular el estado y avisar en todo final | listo |
| ✅ A14 | Barrido de filas trabadas en `publishing` | listo |
| ✅ A15 | Idempotencia con Zernio (`x-request-id`; ventana de ~5 min anotada) | listo |
| ✅ A16 | El mapa de cuentas filtra `is_active` | listo |
| ✅ A17 | YouTube: subida en su propia ruta; visibilidad guardada (falta el control en C8) | listo (backend) |
| ✅ A18 | `canRedistribute` y `duplicateAsVariant` conectados (falta el boton en C) | listo (backend) |
| ✅ A19 | Fechas en la zona del workspace | listo |
| ✅ A20 | Programar pide el permiso `content.publish` | listo |
| ✅ — | `scripts/verify-publishing.mjs` de punta a punta: **Todo verde** | listo |

## D · Zernio programa del lado del proveedor (11 puntos)

| # | Que | Estado |
|---|---|---|
| ✅ D1 | Programar = `createPost` con `scheduledFor` + `timezone`, un post por red | listo |
| ✅ D2 | Publicar ahora = `createPost` con `publishNow` | listo |
| ✅ D3 | Reprogramar o editar = `updatePost` (con `isDraft: false`) | listo |
| ✅ D4 | Desprogramar = `deletePost`; reintentar = `retryPost` | listo |
| ✅ D5 | Media a Zernio en un job, con cache en `provider_media` | listo |
| ✅ D6 | Estado por webhook + conciliacion con `getPost` (el barrido diario con `listPosts` no hizo falta: la conciliacion cubre el caso) | listo |
| ✅ D7 | Id de pedido estable (`socialPostId:intento`) | listo |
| ⏭️ D8 | Cola con `getNextQueueSlot` | **anotado en PENDIENTE** (hace falta el id de perfil de Zernio, que no se guarda) |
| ⏭️ D9 | Postproxy: acepta `scheduled_at` pero **no documenta borrar ni editar** | **anotado en PENDIENTE**: queda en el despachador |
| ✅ D10 | El despachador queda para YouTube, LinkedIn y Threads | listo |
| ✅ D11 | `verify-publishing.mjs` cubre los dos caminos | listo |

### Hallazgos fuera de la lista

| Que | Estado |
|---|---|
| **Un `export type { ... }` en un archivo `"use server"` rompe la app entera en tiempo de ejecucion** y ni el typecheck ni el build lo ven: dejo el editor y el tablero en blanco. Lo encontro la recorrida en el navegador. Hay un test nuevo en `lib/vault-boundary.test.ts` que lo reproduce. | ✅ arreglado |
| **El `upsert` de `social_posts` no podia funcionar NUNCA**: el indice unico es parcial y PostgREST no le puede apuntar un `on_conflict`. Ninguna fila de publicacion se creaba jamas. Lo encontro `verify-publishing.mjs`; los tests no lo veian porque la base en memoria no tiene indices. | ✅ arreglado (buscar-y-escribir) |
| **Programar devolvia `ok: true` sin haber programado nada.** | ✅ arreglado |
| `agent_runs` tenia dos CHECK sobre `source` y el viejo rechazaba `content_copy`: los runs de copy no se registraban contra la base real | ✅ arreglado en 00094 |

## B · Selector de dashboards (3 puntos)

| # | Que | Estado |
|---|---|---|
| ✅ B3 | `lib/dashboards/available.ts`: una sola fuente de verdad, con test | listo |
| ✅ B2 | Menu desplegable como el prototipo, accesible con teclado, revisado en 1440 y 390 | listo |
| ✅ B1 | Los cuatro dashboards dejan de pasar `available` a mano | listo |

## E · Agente copywriter (11 puntos)

| # | Que | Estado |
|---|---|---|
| ✅ E1 | Tipo `copywriter` en `AGENT_TYPES`, con sus cuatro pestanas | listo |
| ✅ E2 | Una fila por workspace (migracion + trigger de alta + indice unico) | listo |
| ✅ E3 | Configuracion: voz, ejemplos, modelo, conocimiento, limites, topes, interruptor | listo |
| ✅ E4 | `lib/agent/copywriter.ts`: contexto determinista + una llamada | listo |
| ✅ E5 | Version nueva con autor del agente | listo |
| ✅ E6 | Job `content_copy` y `content_posts.copy_status` (el cartel en pantalla va en C) | listo |
| ✅ E7 | Aprobar con boton, interruptor, editor y regenerar con indicaciones ("al crear" va en C2) | listo |
| ✅ E8 | Runs y costos, con topes de agente y de workspace | listo |
| ✅ E9 | Permisos `content.ai` y `agents.edit` | listo |
| ✅ E10 | Firma `{ agentId, postId, instructions?, threadId? }` | listo |
| ✅ E11 | Tests con proveedor simulado y dos workspaces con voces distintas | listo |

## C · Pantallas de contenido (17 puntos)

| # | Que | Estado |
|---|---|---|
| ✅ C1 | "✦ Aprobar y producir copy" genera de verdad y abre el editor | listo |
| ✅ C2 | Nueva idea y Nuevo post como modales; "Crear y abrir"; interruptor de IA | listo |
| ✅ C3 | Detalle de la idea como modal, con "qué pasa al aprobar"; editable mientras es nueva; Descartar sale de la tarjeta | listo |
| ✅ C4 | "+ Idea" y "+ Post" al pie de las columnas | listo |
| ✅ C5 | Los botones del editor hacen lo que dicen (y `archivePost`, que no existia) | listo |
| ✅ C6 | Pie fijo con contadores y "Guardado hace X s" | listo |
| ✅ C7 | Estado del material como control segmentado (probado: la pieza pasa a En produccion) | listo |
| ✅ C8 | Fila de red completa: CTA, palabra clave, chip de automatizacion, media variante, publicador, opciones de red, quitar | listo (sin recorrer en vivo: no hay ninguna red conectada) |
| ✅ C9 | Pastillas para agregar redes conectadas que faltan | listo |
| ✅ C10 | Vista previa de la red abierta, arriba del historial | listo |
| ✅ C11 | Palabras clave detectadas bajo el CTA, marcando cuales disparan algo | listo |
| ✅ C12 | Titulo editable en el lugar, chip de idea y chip de formato | listo |
| ✅ C13 | Tarjetas como el prototipo; Borrador y En produccion abren el editor | listo |
| C14 | Calendario: contar, hora, colores, estados, leyenda, arrastrar, semana | ⬜ |
| C15 | Lista: ideas, columna Copy, filtro de fecha, fila clickeable | ⬜ |
| C16 | Detalle: barra superior con Editar y Archivar | ⬜ |
| ✅ C17 | `NetworkBadge` en kanban, editor, calendario, lista y detalle | listo |

## Definicion de listo

Todos los puntos marcados o anotados en `docs/PENDIENTE.md` con la decision tomada; `npx vitest run`,
`npm run build`, `verify-rls`, `verify-content`, `verify-crm`, `verify-inbox-filters` y
`verify-publishing` en 0; lint sin errores nuevos; ningun test previo roto; la revision visual de
B, C y Agentes → Copywriter hecha o anotada.
