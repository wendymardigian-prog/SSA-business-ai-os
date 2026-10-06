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

### B12: modelo nuevo de la pieza (F89 a F94) — COMPLETO en la rama, 6/10/2026
- [x] **Migraciones** `1d27492`: **00116** (pilares, ofertas, clasificación, `approve_content_idea_v2`) y **00117** (texto único) **aplicadas** con la CLI después de ensayarlas en una transacción que se deshace sola, sembrando filas de prueba (hook+ángulo+notas → `content`; copy → `script`; pilares desde texto; doble aprobación rechazada; segunda corrida idempotente). Verificadas en la base real: 5 + 6 columnas nuevas, 6 policies, función v2 y v1 conviviendo, datos reales intactos (1 idea y 1 pieza, las dos vacías). **00118 escrita y SIN aplicar** (destructiva): lleva en su cabecera las dos consultas que tienen que dar 0 antes de correrla.
- [x] **F89** Pilares y ofertas (Ajustes → Contenido, `settings.manage`): reglas puras (`lib/content/taxonomy.ts`), acciones sin borrar (solo archivar; una prueba falla si aparece una acción o un `.delete()`), la tabla sin policy de DELETE. `ac21ae7`, `3032f26`.
- [x] **F90** Campo único de texto: idea → `content`; pieza → `script` + `recording_notes`. El código ya no lee ni escribe `hook/angle/notes/pillar/copy` (la 00118 los puede borrar sin romper nada). Las versiones viejas del historial (que guardan `copy` dentro del jsonb) se normalizan al leer, comparar y restaurar (`lib/content/legacy.ts`, replica letra por letra el backfill de la 00117; un test fija que no se separen). `migrate-copy.test.ts` con tres mutantes (el job, restaurar y guardar escriben `copy`): los tres quedan en rojo. `3769a3f`.
- [x] **F91** Clasificación de idea y pieza (plataformas, formato, oferta, pilar, etapa del embudo, referencia), autor y fechas visibles en la idea, la pieza, el kanban y la lista. El servidor revisa que el pilar y la oferta sean de este negocio y no estén archivados (el archivado que la fila YA tenía se conserva). Una pieza vinculada a una idea hereda su clasificación sin pisar lo elegido a mano. `c25309c`.
- [x] **F92** Biblioteca de archivos: `media` es la biblioteca; cada archivo tiene `id` (se deduce del path en los de antes, sin migrar), nombre, dimensiones y duración (se leen en el navegador al subir), y se ve qué redes lo usan o "Sin usar" en naranja. Quitar uno avisa y lo saca también de las redes (lo hace el servidor siempre). `b111a06`.
- [x] **F93** Formato y archivos por red: Instagram (Reel, Carrusel, Imagen, Historia), TikTok (Video, Carrusel de fotos), YouTube (Video, Short), LinkedIn (Solo texto, Imagen, Carrusel PDF, Video), Threads (Solo texto, Imagen, Carrusel, Video). El selector se filtra por formato, numera en orden de selección y reordena con ↑ ↓; una línea verde o roja por red. **El servidor valida con la misma función** (F77): un carrusel con un archivo no se programa aunque se salteen el editor. El formato completa las opciones del publicador (tipo de Instagram, video o fotos en TikTok, tipo de LinkedIn) con una sola función que usan el editor, el servidor y el publicador. `savePostDraft` valida las redes con Zod (hallazgo 1) y limpia los ids contra la biblioteca real. Una red sin formato sigue el modelo anterior. `b111a06`.
- [x] **F94** La IA al modelo nuevo: el copywriter recibe el texto de la idea, la clasificación (nombres, no ids; la etapa con su descripción) y el formato de cada red; devuelve `{ script, recording_notes, caption_base, captions }`; con una salida inválida no se guarda nada y el job falla con aviso; regenerar sobre un guion escrito pide confirmación. `9b6c0f5`.
- **Verificación contra la base real:** `verify-rls.mjs` (suma 26 checks: lectura entre workspaces, rol personalizado con `settings.manage`, sin DELETE, índices únicos, CHECKs de color/etapa/plataformas) y `verify-content.mjs` (suma los de herencia de la clasificación y de las redes) en verde.
- **Tests al cierre de B12:** 405 archivos, 5.084 tests en verde. Lint: los mismos 4 errores de la línea base, ninguno nuevo. Dos que encontró el lint y arreglé: un parámetro llamado `use` que se confundía con el hook de React, y un comentario de desactivación que sobraba.
- **Revisión visual** (con la sesión que ya tenía el navegador; no ingresé credenciales): la pantalla de Ajustes → Contenido (creé, archivé y mostré un pilar de prueba `zz-test…` y lo borré yo con SQL: las dos tablas quedaron en 0) — ahí encontré y arreglé "Nombre del oferta nuevo" y "Mostra" sin tilde; el diálogo de nueva idea con los selectores y la descripción de la etapa; el tablero con la autoría ("Wendy · creada el 2 oct"); el editor con Clasificación y Guion.

Decisiones tomadas en B12 y por qué:
- **El "+ Crear" de los selectores solo aparece con `settings.manage`**: el plano dice que escribir pilares y ofertas pide ese permiso, y un botón que va a fallar es peor que ningún botón.
- **Al aprobar una idea, el guion y las notas de grabación arrancan vacíos.** El texto de la idea es contexto (el copywriter lo lee por `idea_id`; el drawer de B13 lo va a mostrar), no el guion.
- **Una red sin formato sigue como antes** (usa toda la biblioteca, sin chequeo de formato): elegir el formato la pasa al modelo nuevo. Hay un botón "Usar el sugerido" que deduce el formato del que tiene la pieza.
- **En la pieza, las "plataformas" son las filas de Redes**, no un selector aparte; en la idea sí son un selector y pasan a la pieza al aprobar.
- **El aviso de "alguien más editó esto" saltaba de mentira desde el segundo autoguardado** (se comparaba con la fecha de la primera carga). Arreglado en el editor actual con la fecha de la última escritura; el drawer de B13 tiene que conservar esa lógica.

### B13: drawer y pantallas (F95 a F101) — COMPLETO en la rama, 6/10/2026
Se hizo en dos tandas (B13a: drawers y tablero; B13b: Social y atribución en el tablero), con commit por tanda.
- [x] **F95** Drawer de idea con galería (~560 px): todo editable al abrir, con autoguardado (~1 s) y guardado siempre antes de pasar a otra idea o de decidir. "N de M" y flechas. **Descartar** y **Aprobar** abren la siguiente (si era la última de la lista pero quedan otras, la anterior: el drawer no se cierra con ideas por revisar); cuando no queda ninguna, se cierra con aviso. **✦ Aprobar y producir copy** abre LA PIEZA generada en el mismo drawer. Un aviso por acción. Lo que decide vive en `lib/content/idea-gallery.ts` (20 tests). `cfa7e86`.
- [x] **F96** Drawer de la pieza (~900 px; pantalla completa en el celular) que reemplaza al editor y al detalle, en el orden pedido: guion → notas (ancho completo) → clasificación → archivos → caption base → una tarjeta por red → agregar una red → estado por red. El estado es un dropdown con las transiciones permitidas (`canTransition`); las que no se pueden van deshabilitadas con el motivo. Pie con "N de M redes con fecha" y los botones según permiso (los del editor más "reintentar las que fallaron", que vivía en el detalle). **Sin vista previa del teléfono** (decisión de producto). Mientras el copywriter escribe nada se edita y se vuelve a preguntar solo; cuando termina, el borrador adopta el guion nuevo. `cfa7e86`.
- [x] **F97** Historial detrás de un botón de reloj (con el número de versiones), en el mismo drawer, con "← Volver al post". Restaurar crea una versión nueva y vuelve al post. `cfa7e86`.
- [x] **F98** La tarjeta de idea solo abre (formato, redes, pilar, primera línea, oferta y autor). Barra superior única: vistas, conteo (solo calendario), **filtro de Red** (vale para las tres vistas), el ⓘ con lo que puede hacer ESE rol (`contentTooltip`) y las dos altas. Se sacó el filtro de Red de adentro de la lista. `cfa7e86`.
- [x] **F99** `/dashboard/content/<id>` y `/dashboard/content/<id>/edit` redirigen a `?piece=<id>`; una pieza que no existe (o de otro negocio) sigue dando el mismo 404. Probado de punta a punta con las dos páginas reales. `cfa7e86`.
- [x] **F100** Social: el perfil muestra las cifras reales que lee la sincronización (F75: seguidos, publicaciones, videos, vistas, me gusta; una cifra que la red no dio queda en "—", nunca en cero) y **avisa si la última lectura falló** sin esconder lo último que se leyó. Arriba de la grilla, **"Próximas"** con borde punteado (lo programado y lo tentativo de esa red; al tocar abre la pieza). Una pestaña por red, conectada o no: las que no lo están invitan a conectar (el link a Integraciones solo lo ve quien puede entrar ahí). **LinkedIn es una lista** de lo publicado desde el sistema, con su estado y el aviso de que no entrega métricas. Las historias de Instagram quedan afuera (§12). `803cef0`.
- [x] **F101** La tarjeta y la fila de la lista muestran cuántos contactos tienen a la pieza como PRIMER toque, solo si la pieza tiene publicaciones salidas (sin publicaciones no se muestra ni un cero). El conteo se lee con el cliente de quien mira, así que respeta el scope de leads. Incluido en `board.test.ts`. `803cef0`.
- **El drawer vive en la URL** (`?idea=` / `?piece=`): se comparte con un link, "atrás" lo cierra, y pasar de una idea a otra o a la pieza generada reemplaza la entrada del historial (si no, "atrás" recorrería las veinte ideas revisadas). Al cerrar el foco vuelve a la tarjeta que lo abrió (se recuerda al hacer clic, no con `activeElement`, porque Safari no le da foco a un link al clickearlo).
- **Verificación:** `vitest` **411 archivos, 5.199 tests** en verde; `npm run build` sale 0; `verify-content.mjs` en verde; lint: los mismos 4 errores de la línea base. Dos cosas del lint nuevo de React que arreglé en mi código: se actualizaban refs y se leían refs durante el render (ahora van en efectos o en estado derivado de las props).
- **Revisión visual a 1440 y 390 px**, con la sesión que ya tenía el navegador y datos de prueba `zz-test` que sembré y borré yo (quedó 1 idea y 1 pieza, 0 cuentas, 0 publicaciones): el drawer de idea y el de pieza a las dos medidas (a 390 ocupan toda la pantalla y no hay scroll horizontal), Esc que cierra y devuelve el foco a la tarjeta, la biblioteca con archivos y "Se usa en…", el selector de formato con archivos numerados, ↑↓ que reordena en vivo, la línea roja con un solo archivo en un carrusel (y "Programar solo instagram" que se apaga), el historial, la lista, el calendario, Social con cuenta conectada (perfil, aviso, Próximas), LinkedIn, una red sin conectar, y la insignia de contactos solo en la pieza publicada. También probé en vivo que lo escrito se guarda al cerrar con Esc y que el drawer adopta un cambio hecho por otra persona cuando no hay cambios sin guardar.

Decisiones tomadas en B13 y por qué:
- **La galería recorre TODAS las ideas** aunque haya un filtro de Red puesto: si no, cambiar el filtro con un drawer abierto dejaría a la idea sin lugar.
- **"Descartar" pide confirmación** (`window.confirm`): sacar una idea del tablero en un clic dentro de una secuencia rápida se hace sin querer.
- **El calendario conserva su encabezado de mes** (flechas y totales): es la forma de moverse entre meses, no una barra de herramientas. Lo que se movió a la barra superior es el conteo y el filtro de Red.
- **Un borrador con cambios sin guardar nunca se pisa** con lo que llega del servidor; el aviso de "alguien más editó" al guardar es el que lo dice.

### B14: medición de la pieza (F102 a F105) — COMPLETO en la rama, 6/10/2026
- [x] **F103** Índice (`lib/dashboards/piece-index.ts`, 15 tests). Engagement a 7 días contra la **mediana** de la misma red y el mismo formato (`media_type`) de los 90 días **previos a la publicación**; mínimo 3 comparables (si no, "Base insuficiente" con los crudos a la vista); verde desde 1,5×, rojo por debajo de 0,8×; mismo criterio de mediana que `follower-bump.ts` (usa su `median` y su umbral). Sin `engagement_d7` y con menos de 7 días: "En curso", fuera del promedio de la pieza; con más de 7 días: "Sin dato". Mediana cero: no se divide. `8943444`.
- [x] **F104** Leads por comentario (`lib/dashboards/piece-leads.ts`, 12 tests). Contacto cuyo **primer** toque es un comentario en una publicación de la pieza; una persona cuenta una vez por pieza (con el primer comentario); un primer toque anterior (un DM) la deja afuera; nada de DM por palabra clave; una red que no vincula comentarios (YouTube, LinkedIn, Threads) da hueco, no cero. `8943444`.
- [x] **F102** Rendimiento por red (`lib/dashboards/piece-performance.ts`, 13 tests; sección del drawer `components/content/drawer/piece-performance.tsx`, 10 tests; lector `lib/dashboards/piece-load.ts`, 5 tests). Una fila por publicación salida y un total; **Edad** de cada una; la comparación a la misma edad sale de `evolution` (alcance e interacciones al día de la publicación más joven, "A la misma edad (día 3)"); LinkedIn muestra el aviso, nunca ceros; las sumas del total son contexto; el total de leads viene de la pieza, no de sumar filas. Leer la medición **nunca rompe abrir la pieza** (try/catch en el lector). `8943444`, `d97c529`.
- [x] **F105** Dashboard de contenido: tabla "Rendimiento por …" agrupada por pieza, oferta, pilar, etapa del embudo, red o formato (`?agrupar=`) y cinco filtros en la URL (`?oferta=`, `?pilar=`, `?embudo=`, `?formato=`, `?pieza=`) que acotan todo el dashboard, también el periodo anterior contra el que se compara. **Nada se pierde:** toda publicación cae en un grupo, lo que no tiene valor va a "Sin asignar" (siempre al final) y el total de la tabla es la suma de las filas; los totales de una oferta coinciden con la suma de sus piezas (test). Tocar un grupo filtra por él. Columna **Leads**. `content.test.ts` extendido (+15 tests), `content-params.test.ts` (7), `group-table.test.ts` (6). `4b6f5f5`.
- [x] **Documentación**: `docs/atribucion.md` (nuevo), `docs/contenido.md` y `docs/publicacion.md` (secciones de Contenido v3), `CLAUDE.md` (migraciones hasta la 00117 aplicadas, 00118 escrita y sin aplicar, **próxima libre 00119**, corregido lo de la 00105/00106 que figuraba sin aplicar y sí está, sección nueva), `BITACORA.md`, `docs/PENDIENTE.md`. `c76006b`, y el resto.
- **Revisión en vivo** con datos `zz-test` sembrados con la clave de servicio y borrados (después: 1 idea, 1 pieza, 0 cuentas, 0 publicaciones, 0 pilares, 0 ofertas, 0 contactos de prueba): el drawer con Instagram (10 días, índice 1,6× contra 4 comparables), YouTube (3 días, "En curso", sus vistas como alcance) y LinkedIn (el aviso, sin ceros), los leads (2: los dos comentarios; el contacto que ya venía por un DM no cuenta), la comparación "A la misma edad (día 3)", y a 375 px la página no se ensancha (la tabla se desliza sola). En el dashboard, la tabla por oferta (la oferta con 4 publicaciones y 2 piezas, "Sin asignar" con la pieza sin oferta y la publicada a mano, total 6), y filtrar tocando la oferta (la URL trae `?oferta=<id>`, aparecen "Quitar filtros" y el aviso de que los seguidores no se filtran).
- **Tests al cierre de B14:** 418 archivos, **5.282 tests** en verde.

**Procedimiento de mutación de B14** (cambiar la regla y comprobar que el test se pone rojo; el archivo se restauró después de cada una):

| Mutante | Resultado |
|---|---|
| M1 base mínima 3 → 2 | rojo |
| M2 ventana de 90 días inclusiva → exclusiva | rojo |
| M3 una publicación "en curso" entra al promedio de la pieza | rojo |
| M4 umbral verde 1,5 → 2 | rojo |
| M5 leads: toma el último toque en vez del primero | rojo |
| M6 leads: un DM también cuenta | rojo |
| M7 leads: sin dedupe por contacto | rojo |
| M8 edad común = la de la publicación más vieja | rojo |
| M9 LinkedIn sin su aviso | rojo |
| M10 total de leads = suma de las filas | **verde la primera vez** → se agregó el test que distingue ("el total viene de la pieza…") → rojo |
| M11 agrupar: "Sin asignar" desaparece | rojo |
| M12 agrupar: "Sin asignar" no va al final | rojo |
| M13 el filtro `none` no elige lo sin asignar | rojo |
| M14 leads de una red que no los mide = 0 | rojo |

Decisiones tomadas en B14 y por qué:
- **La ventana del índice termina el día de la publicación**, no hoy: así el índice no cambia cada día y una publicación vieja se compara con lo normal de entonces.
- **El filtro de clasificación se aplica en memoria** sobre las publicaciones del periodo (la clasificación vive en la pieza, no en la publicación), con las piezas leídas de a tandas de 100 ids.
- **Las opciones de los filtros salen de todas las publicaciones del periodo**, no de las que sobreviven al filtro: si no, al elegir una oferta las demás desaparecerían de la lista.
- **Los seguidores no se filtran**: son de la cuenta, y la pantalla lo avisa.

## Verificación final — 6/10/2026

| Chequeo | Resultado |
|---|---|
| `npx vitest run` | **418 archivos, 5.282 tests, todos en verde** (punto de partida: 373 y 4.486; ninguno de los que pasaban se rompió) |
| `npm run build` | **exit 0** |
| `npm run lint` | **los mismos 4 errores de la línea base** (`dashboard-panel.tsx:56`, `spend-chart-tabs.tsx:57` y `:60`, `onboarding-banner.tsx:37`), ninguno nuevo; 39 warnings (la línea base tenía 38: el que suma es de `drawer.tsx`, de B13) |
| `verify-rls.mjs` | **279 checks**, exit 0 |
| `verify-content.mjs` | **36 checks**, exit 0 |
| `verify-crm.mjs` | **25 checks**, exit 0 |
| `verify-attribution.mjs` (nuevo en B11) | **39 checks**, exit 0 |
| `verify-inbox-filters.mjs` | **18 checks**, exit 0 |
| `verify-scheduling.mjs` | **108 checks**, exit 0 |
| `lib/publishing/e2e-zernio.test.ts` (F80) | **12 tests en verde**; la tabla M1 a M7 de B10 muestra que se pone en rojo al quitar cada disparador |
| Migraciones en la base (solo lectura) | 00113 a 00117 **aplicadas** (columnas, tablas y funciones presentes); **00118 sin aplicar**, con sus columnas viejas todavía en la base. No están en el historial de Supabase (ver `docs/PENDIENTE.md`) |
| Datos de la base después de todo | 1 idea, 1 pieza, 0 cuentas, 0 publicaciones, 0 pilares, 0 ofertas, 647 contactos con 647 toques, 0 datos `zz-test` |
| Docs | `contenido.md`, `publicacion.md`, `atribucion.md` (nuevo), `CLAUDE.md`, `BITACORA.md`, `PENDIENTE.md` al día |

- [x] Todo lo anterior en verde → se puede mergear `contenido-v3` a `main` (`--no-ff`) y pushear.

## Cierre posterior (6/10/2026, a pedido de Wendy)

Después del merge a `main` se terminó lo que había quedado anotado en `docs/PENDIENTE.md`:

- [x] **00118 aplicada.** Antes: el deploy `e555e54` estaba en producción (SUCCESS desde las 08:07 UTC; el anterior, retirado), ningún archivo del código leía las columnas (solo los tipos), las dos consultas de la cabecera dieron 0 (1 idea y 1 pieza, vacías; 0 ideas con pilar de texto) y se guardó un respaldo de las filas y de la función vieja. Después: 0 columnas viejas, 0 funciones viejas, `approve_content_idea_v2` presente, la app sigue leyendo y escribiendo el modelo nuevo.
- [x] **Historial de migraciones al día:** 00113 a 00118 registradas en `supabase_migrations.schema_migrations` (versiones `20261006173244` a `...49`, fecha del registro) con el mismo formato que las anteriores. `supabase migration list --linked` las muestra.
- [x] **00115 no hizo falta volver a correrla:** 650 contactos vivos, 650 con primer toque, 650 toques; los 3 que entraron después del backfill ya los anotó el código nuevo.
- [x] **Código:** `lib/types/database.ts` sin las columnas y la función borradas; la campana, la ficha del contacto y el panel de análisis abren la pieza directo en `?piece=<id>` (con test); sacada la entrada muerta `/dashboard/content/new`; el warning de lint de `drawer.tsx` documentado (el ref se lee al desmontar a propósito); `platformLabel` ahora dice TikTok, YouTube, LinkedIn y Threads (cambié a propósito el test que fijaba "Tiktok"); y `vitest.setup.ts` bloquea `fetch` real en todos los tests (418 archivos siguieron en verde, así que ninguno dependía de uno).
- Lo que sigue abierto está en `docs/PENDIENTE.md`, "Cierre de la corrida": verificar con cuentas reales, el pie del drawer a 390 px (decisión de diseño) y la carrera de TikTok (pide una migración).
