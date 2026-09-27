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
| 00093 | `zernio_native_scheduling` | D | ⬜ sin escribir |
| 00094 | `copywriter_agent` | E | ⬜ sin escribir |

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
| A7 | `SUBSCRIBED_EVENTS` suma `post.platform.published` / `.failed` | ⬜ |
| ✅ A8 | TikTok manda `privacyLevel` y las dos confirmaciones (falta el control en C8) | listo (backend) |
| ✅ A9 | Instagram: tipo (Feed, Carrusel, Reel, Story) (falta el control en C8) | listo (backend) |
| ✅ A10 | Threads: hijos del carrusel, esperar el contenedor, no duplicar el hilo | listo |
| ✅ A11 | Postproxy: `account_ref` propio; id y link del video del estado | listo |
| A12 | Errores de Zernio: `response.status` y `errorMessage` | ⬜ |
| ✅ A13 | Recalcular el estado y avisar en todo final | listo |
| ✅ A14 | Barrido de filas trabadas en `publishing` | listo |
| A15 | Idempotencia con Zernio (`x-request-id`) | ⬜ |
| ✅ A16 | El mapa de cuentas filtra `is_active` | listo |
| ✅ A17 | YouTube: subida en su propia ruta; visibilidad guardada (falta el control en C8) | listo (backend) |
| ✅ A18 | `canRedistribute` y `duplicateAsVariant` conectados (falta el boton en C) | listo (backend) |
| ✅ A19 | Fechas en la zona del workspace | listo |
| ✅ A20 | Programar pide el permiso `content.publish` | listo |
| — | `scripts/verify-publishing.mjs` de punta a punta | ⬜ |

## D · Zernio programa del lado del proveedor (11 puntos)

| # | Que | Estado |
|---|---|---|
| D1 | Programar = `createPost` con `scheduledFor` + `timezone`, un post por red | ⬜ |
| D2 | Publicar ahora = `createPost` con `publishNow` | ⬜ |
| D3 | Reprogramar o editar = `updatePost` | ⬜ |
| D4 | Desprogramar = `deletePost`; reintentar = `retryPost` | ⬜ |
| D5 | Media a Zernio en un job, con cache en `provider_media` | ⬜ |
| D6 | Estado por webhook + conciliacion con `getPost` y `listPosts` | ⬜ |
| D7 | Id de pedido estable | ⬜ |
| D8 | Cola con `getNextQueueSlot` (nice-to-have) | ⬜ |
| D9 | Postproxy: ver si acepta `scheduled_at` | ⬜ |
| D10 | El despachador queda para YouTube, LinkedIn y Threads | ⬜ |
| D11 | `verify-publishing.mjs` cubre los dos caminos | ⬜ |

## B · Selector de dashboards (3 puntos)

| # | Que | Estado |
|---|---|---|
| B3 | `lib/dashboards/available.ts`: una sola fuente de verdad, con test | ⬜ |
| B2 | Menu desplegable como el prototipo, accesible con teclado | ⬜ |
| B1 | Los cuatro dashboards dejan de pasar `available` a mano | ⬜ |

## E · Agente copywriter (11 puntos)

| # | Que | Estado |
|---|---|---|
| E1 | Tipo `copywriter` en `AGENT_TYPES` | ⬜ |
| E2 | Una fila por workspace (migracion + trigger de alta) | ⬜ |
| E3 | Configuracion: voz, ejemplos, modelo, conocimiento, limites, topes, interruptor | ⬜ |
| E4 | `lib/agent/copywriter.ts`: contexto determinista + una llamada | ⬜ |
| E5 | Version nueva con autor del agente | ⬜ |
| E6 | Job `content_copy` y `content_posts.copy_status` | ⬜ |
| E7 | Los cinco disparadores, con indicaciones | ⬜ |
| E8 | Runs y costos, con topes de agente y de workspace | ⬜ |
| E9 | Permisos `content.ai` y `agents.edit` | ⬜ |
| E10 | Firma lista para la Etapa 3 | ⬜ |
| E11 | Tests con proveedor simulado y dos workspaces | ⬜ |

## C · Pantallas de contenido (17 puntos)

| # | Que | Estado |
|---|---|---|
| C1 | "✦ Aprobar y producir copy" genera de verdad | ⬜ |
| C2 | Nueva idea y Nuevo post como modales; "Crear y abrir" | ⬜ |
| C3 | Detalle de la idea como modal; idea editable mientras es nueva | ⬜ |
| C4 | "+ Idea" y "+ Post" al pie de las columnas | ⬜ |
| C5 | Los botones del editor hacen lo que dicen | ⬜ |
| C6 | Pie fijo con contadores y "Guardado hace X s" | ⬜ |
| C7 | Estado del material como control segmentado | ⬜ |
| C8 | Fila de red completa | ⬜ |
| C9 | Pastillas para agregar redes | ⬜ |
| C10 | Vista previa de la red abierta | ⬜ |
| C11 | Palabras clave detectadas bajo el CTA | ⬜ |
| C12 | Encabezado y barra superior del editor | ⬜ |
| C13 | Tarjetas del kanban como el prototipo | ⬜ |
| C14 | Calendario: contar, hora, colores, estados, leyenda, arrastrar, semana | ⬜ |
| C15 | Lista: ideas, columna Copy, filtro de fecha, fila clickeable | ⬜ |
| C16 | Detalle: barra superior con Editar y Archivar | ⬜ |
| C17 | `NetworkBadge` en todas las pantallas | ⬜ |

## Definicion de listo

Todos los puntos marcados o anotados en `docs/PENDIENTE.md` con la decision tomada; `npx vitest run`,
`npm run build`, `verify-rls`, `verify-content`, `verify-crm`, `verify-inbox-filters` y
`verify-publishing` en 0; lint sin errores nuevos; ningun test previo roto; la revision visual de
B, C y Agentes → Copywriter hecha o anotada.
