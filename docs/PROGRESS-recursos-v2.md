# Avance — Banca de recursos ampliada (v2.1)

Plano: `requerimientos-banca-recursos-v2.md` (v2.1, 7/10/2026). Rama `oneshot-recursos-v2`,
corrida one-shot desde el 8/10/2026.

## Correcciones al plano (aprobadas antes de construir)

- Las migraciones son **00131** y **00132** (la 00125-00130 ya estaban ocupadas).
- Los CHECK de forma que se reemplazan son **cuatro** (`kind_check`, `text_shape`,
  `text_no_transcript`, `audio_shape`), y se conservan sus exigencias actuales.
- La 00131 amplia ademas las policies de escritura a
  `is_workspace_admin OR has_permission(ws, 'templates.manage')` (decision de Wendy).
- Magic bytes: `sniffUploadMime` refina a `sniffMime` para Office, HEIC y WebM de video.
- Miniaturas de la lista: lazy, como las imagenes de la bandeja.
- Video: `.mp4` y `.webm` se transcriben; `.mov` y `.3gp` quedan en `failed` sin cobrar.
- Instagram: archivos no (dudoso en el SDK). Video si (decision de Wendy), aunque los
  3 envios de video de produccion fallaron: se investiga aparte.
- Un video "sin voz" lo puede usar el agente con su descripcion (decision de Wendy).

## R1 — El modelo
- [x] F1 Migraciones 00131 y 00132, aplicadas, registradas y verificadas (ensayo en transaccion: 6 tipos validos entran, 10 formas invalidas rechazadas, touch suma desde el servidor y no desde otro workspace)
- [x] F2 Tipos y reglas puras (`kind.ts`, `shape.ts`, `files.ts`, `sniffUploadMime`, `search.ts`)

## R2 — La gestion
- [x] F3 Recursos en el menu lateral (misma ruta, la pestaña se queda; tests de menu y pestaña)
- [x] F4 Permisos (`templates.manage` relabelado, acciones y pagina por permiso, member-baseline actualizado)
- [x] F5 La lista (filtros por tipo y etiqueta, conteos, paginacion, estado vacio) — falta revision visual (necesita sesion)
- [x] F6 Alta y edicion por tipo — falta revision visual (necesita sesion)

## R3 — El chat
- [x] F7 El boton en el composer y el atajo de teclado (⌘/Ctrl + /) — falta revision visual
- [x] F8 El widget (se abre siempre, buscador, chips, teclado; reducer puro con tests) — falta revision visual
- [x] F9 Revisar el recurso antes de mandarlo (preview por tipo, reusa MediaAttachment; copyAssetToChat para los 4 tipos; touch al mandar) — falta revision visual
- [x] F10 Que acepta cada canal (`channelAccepts`, matriz entera en test; la API de envio lo aplica)

## R4 — El agente y la cañeria
- [x] F11 Las herramientas del agente con seis tipos (filtro por tipo y etiqueta, solo lo que el canal acepta, video sin voz por descripcion, uno por respuesta, borrador y aprobacion, touch al usar)
- [x] F12 Transcripcion de video (mp4 y webm por la misma puerta; mov y 3gp quedan en failed sin llamar al proveedor)
- [x] F13 La limpieza (28 dias cubre los 4 tipos + miniatura; test que fija que la del chat nunca toca library/)

## Cierre
- [x] CLAUDE.md, docs/PENDIENTE.md (revision visual y pruebas en vivo anotadas como pendientes)
- [ ] PR contra main
