# Correcciones de la Etapa 2 + programación en Zernio + agente copywriter (26/9/2026)

Revisé el código de `main` (`281f704`) y la base después de la corrida autónoma. La estructura de la etapa está completa y los tests pasan (237 de 237 en publicación, jobs, contenido y webhooks). Pero hay tres grupos de problemas:

1. **Publicación automática:** tal como quedó, **ningún post programado se publica en ninguna red**. Hay un error bloqueante, y varios más que aparecen apenas se arregla ese.
2. **Selector de dashboards:** Meta Ads y Unificado no aparecen desde Chat ni desde Contenido orgánico, y el selector es una fila de pastillas, no el menú desplegable del prototipo.
3. **Pantallas de contenido:** la lógica está, pero la interfaz de crear y editar piezas no sigue el prototipo, y varios botones no hacen nada.

Y dos decisiones nuevas, tomadas después de revisar cómo publica LateWiz:

4. **Instagram y TikTok se programan del lado de Zernio** (como LateWiz): el sistema crea, edita, cancela y reintenta el post en Zernio, y solo refleja el estado. El despachador propio queda para las APIs directas (YouTube, LinkedIn, Threads).
5. **Agente copywriter de contenido:** un agente nuevo, configurable por workspace desde Agentes, que escribe guion y captions cuando se aprueba una idea. Reemplaza la generación simple de F29 y queda listo para la Etapa 3.

Todo va en una rama nueva, `etapa2-correcciones`, desde `main`. Es brownfield: la suite completa tiene que seguir en verde.

**Orden de ejecución:** A (despachador y arreglos comunes) → D (Zernio programa) → B (selector de dashboards) → E (agente copywriter) → C (pantallas de contenido, que usan el agente de E).

---

## Cómo se corre

Mismo método que la Etapa 2: una sesión nueva, **modo plan**, Prompt 1 → aprobar con **"Yes, and use auto mode"** → `/goal`. Adjuntá este archivo (`Prompt_Correcciones_Etapa2.md`); el prototipo está en `~/Documents/SSA-referencia-etapa2/prototipo/dashboards-de-chat.html` y Claude Code lo abre desde ahí.

---

## PROMPT 1 (modo plan)

---INICIO---

Vamos a corregir lo que quedó mal de la Etapa 2. Te adjunto `Prompt_Correcciones_Etapa2.md`: la lista de abajo sale de una revisión del código de `main` (`281f704`) y de la base, con archivo y línea. Verificá cada punto antes de cambiarlo (puede haber una línea corrida), y si alguno no es como dice, decímelo en el plan.

La referencia de producto es `docs/requerimientos-etapa2.md` (v2.0). La referencia visual es el prototipo: copiá `~/Documents/SSA-referencia-etapa2/prototipo/dashboards-de-chat.html` a `docs/referencia/prototipo/` (en `.gitignore`) y abrilo con tu navegador. Las piezas de contenido del prototipo son: `contentPage3`, `kcard3` e `ideaCard` para el kanban, `cmodal3` e `ideaView` para los modales, `composerPage4` para el editor y `calView4` para el calendario.

**Primeras tareas de la ejecución (van en el plan):** crear la rama `etapa2-correcciones` desde `main`; crear `docs/PROGRESS-correcciones.md` con los grupos A, B, C, D y E de abajo como checklist; guardar este archivo en `docs/correcciones-etapa2.md`. Como referencia de D, copiá `~/Documents/SSA-referencia-etapa2/latewiz/` a `docs/referencia/latewiz/` (sobre todo `src/hooks/use-posts.ts`, `src/hooks/use-media.ts` y `src/app/dashboard/compose/page.tsx`).

**Ahora, sin escribir código:** leé la lista, verificala contra el código, corré el punto de partida (`npx vitest run`, `npm run build`, `npm run lint`, `node scripts/verify-rls.mjs`, `node scripts/verify-content.mjs`) y presentame un plan en el orden A → D → B → E → C. Para cada punto: qué cambiás, qué test escribís primero (en A, **un test que reproduzca el error antes de arreglarlo**) y cómo verificás.

### A. Publicación automática (bloqueante: nada se publica)

> Los puntos de A valen para el despachador propio, que después de D queda para YouTube, LinkedIn y Threads. Los que son solo de Zernio (A7, A12, A15) se resuelven dentro de D; A1, A3 y A6 aplican a los dos caminos.

**Bloqueantes**
- **A1 · `social_posts.publisher` queda siempre vacío.** `lib/actions/content-schedule.ts:203` escribe `entry.publisher`, que sale de `networks[].publisher`, y nadie lo completa (ni `createPost`, ni el editor, ni un default en la base). El dispatcher llama `getPublisher("")` → `UnknownPublisherError` → falla permanente. Los tests pasan porque ponen `publisher: "zernio"` a mano. **Arreglo:** en `scheduleNetworks`, resolver `network.publisher ?? social_accounts.default_publisher`; si los dos están vacíos, no programar y decir "Elegí por dónde se publica <red> en Integraciones". Test de la acción con un post creado por `createPost` real (sin publisher).
- **A2 · El token de Google (YouTube API) vence en 1 hora y se renueva una vez por semana.** `lib/social/google.ts:108`, `lib/social/token-refresh.ts:54`, `lib/publishing/credentials.ts:86-98`. **Arreglo:** en `credentialsForPublisher`, si el access token vence en menos de 5 minutos, renovarlo en memoria con el refresh token (F10: "Refresca el access token en memoria"). Revisá lo mismo para los lectores de métricas de YouTube.
- **A3 · "Publicar ahora" siempre falla.** `content-schedule.ts:158` pone la fecha en `now` y `canScheduleNetwork` la rechaza por "ya pasó" o "falta muy poco" (`lib/content/schedule.ts:105-116`). **Arreglo:** un modo `now` que saltee la validación de anticipación.

**Altos**
- **A4 · Reprogramar deja vivo el job viejo.** `content-schedule.ts:195-228` hace upsert y crea un job nuevo sin borrar el pendiente; el viejo sale a la hora vieja. **Arreglo:** borrar los `content_publish` pendientes de ese `social_post_id` antes de crear el nuevo (como ya hace `unscheduleNetwork`).
- **A5 · Cambiar la fecha de una red ya programada en el editor no hace nada.** `savePostDraft` (`lib/actions/content.ts:502+`) solo toca `networks`. **Arreglo:** si la red está programada, cambiar la fecha la reprograma (fila + job), respetando los 5 minutos.
- **A6 · Las automatizaciones "solo este post" nunca reciben el `postId`.** `completePostIds` solo se llama cuando el publicador devuelve `published` en el momento (`lib/publishing/dispatcher.ts:252`). Zernio casi siempre devuelve `processing`, y los caminos de chequeo (`dispatcher.ts:433-436`) y webhook (`lib/.../inbound.ts:146-148`) no lo llaman. **Arreglo:** un único "al publicarse" que usen los tres caminos.
- **A7 · El webhook de Zernio no está suscripto a los eventos de posts.** `SUBSCRIBED_EVENTS` (`lib/zernio-webhook.ts:32-36`) no tiene `post.platform.published` / `post.platform.failed`; el estado solo llega por el chequeo a los 2, 12 y 42 minutos. **Arreglo:** sumarlos (no registres el webhook en Zernio: se hace en la verificación en vivo).
- **A8 · TikTok no manda los campos obligatorios.** `lib/publishing/zernio.ts:45-55` no envía `privacyLevel`, `contentPreviewConfirmed` ni `expressConsentGiven` (F31). No hay interfaz para las opciones de TikTok. **Arreglo:** opciones de TikTok en la fila de la red del editor (privacidad pública o borrador, comentarios, duetos, stitch, y las dos confirmaciones obligatorias), validadas antes de programar.
- **A9 · Instagram Story no se puede elegir.** El tipo sale solo de la media; `options.contentType` no tiene interfaz. **Arreglo:** selector "Tipo" (Feed, Carrusel, Reel, Story) en la fila de Instagram.
- **A10 · Threads:** el carrusel se manda sin los contenedores hijos (`lib/publishing/threads.ts:48`); el video se publica sin esperar a que el contenedor esté `FINISHED` (`threads.ts:76-79`); si falla una parte del hilo después del post principal, se reintenta todo y se duplica el principal. **Arreglo:** hijos del carrusel, espera del contenedor (con límite y reintento como `processing`), y en hilos guardar qué partes salieron para no repetirlas.
- **A11 · Postproxy manda el id del canal de YouTube como perfil.** `lib/publishing/postproxy.ts:68` usa `accountRef`, que con Google conectado es el id del canal (`lib/social/accounts.ts:184`), no el perfil de Postproxy. Y `externalId` guarda el id del post de Postproxy, no el del video (`postproxy.ts:46`). **Arreglo:** el `account_ref` de cada publicador es propio (`publishers[].account_ref` del publicador `postproxy`), y el id y link del video salen de la respuesta de estado.

**Medios**
- **A12 · Los errores de Zernio no traen código:** `zernio.ts:136` lee `error.status`, pero el SDK devuelve `{ data, error, response }`. Todo 429/5xx queda como permanente y no se reintenta. Usar `response.status`. Y el motivo del rechazo por red está en `errorMessage`, no en `error` (`zernio.ts:87`).
- **A13 · El estado del post no se actualiza cuando una red falla o queda en proceso**, y un `failed` devuelto (no lanzado) no avisa (`dispatcher.ts:237-239`). Recalcular el estado y avisar en todo final.
- **A14 · Una publicación puede quedar trabada en `publishing` para siempre** si el proceso se corta después de tomarla, o si queda `processing` sin `ref` (`dispatcher.ts:196-199`, `377-379`). Barrido de filas `publishing` viejas que las pase a `failed/temporary` y reintente.
- **A15 · Idempotencia con Zernio:** mandar un id de pedido (`socialPostId` + intento) para que un corte de red después de aceptar no publique dos veces.
- **A16 · Elegir la cuenta activa:** el mapa de cuentas ignora `is_active` (`content-schedule.ts:186-190`).
- **A17 · YouTube API:** la privacidad queda en `private` porque nadie la elige (`lib/publishing/youtube.ts:41-44`): sumar Visibilidad (Pública, No listada, Privada) en la fila de YouTube. La subida entera corre dentro de la corrida compartida del cron de jobs, sin `maxDuration`: pasarla a su propia ruta o subir el límite, para que un video largo no frene los demás jobs.
- **A18 · Redistribución y re-aprobación:** `canRedistribute` y `duplicateAsVariant` existen pero nadie los llama. Conectarlos: "+ Publicar en otra red" pasa por `canRedistribute`; "Duplicar como variante" en el detalle y en el editor; si se cambia el copy o la media base después de aprobar, esa red vuelve a revisión (F28).
- **A19 · Fechas en la zona del workspace:** el editor convierte con la zona del navegador (`components/content/post-editor.tsx:549-561`). Usar `workspaces.timezone` y mostrarla junto al campo.
- **A20 · Programar pregunta `isAdminRole`** en vez del permiso `content.publish` del rol personalizado. Usar el permiso.

**Test de punta a punta obligatorio para cerrar A:** `scripts/verify-publishing.mjs` (nuevo, con la base real y proveedores simulados) que crea un post con `createPost`, lo aprueba, programa Instagram y TikTok con `scheduleNetworks`, corre el handler de la cola como lo haría el cron, simula la respuesta de Zernio (`processing` y después `post.platform.published` por webhook), y verifica: fila `published` con link, estado del post `published`, `postIds` de la automatización completo, y que reprogramar, desprogramar y "Publicar ahora" funcionan. Limpia al terminar.

### B. Selector de dashboards

- **B1 · Meta Ads y Unificado no aparecen.** `components/dashboards/dashboard-switcher.tsx` tiene `available = ["chat", "content"]` por defecto, y Chat (`chat-dashboard.tsx:65`) y Contenido orgánico (`content-dashboard.tsx:206`) lo llaman sin pasar nada. Solo desde Anuncios y Unificado se ven las otras opciones.
- **B2 · Tiene que ser un menú desplegable** como en el prototipo (barra superior: botón con el nombre del dashboard actual y ▾; al abrir, cada opción con título y una línea de descripción: "Chat · Conversaciones, agente y equipo", "Contenido orgánico · Alcance, seguidores y publicaciones por red", "Meta Ads · Gasto, leads y costo por lead", "Unificado · Orgánico y pagado juntos"; check en la actual). Accesible con teclado, y en el celular dentro de la franja de filtros.
- **B3 · Qué se muestra:** que la disponibilidad salga de un solo lugar (función pura con test), no de cada pantalla. Meta Ads y Unificado aparecen siempre para quien tiene el permiso; sin Meta conectado, al entrar se ve el estado vacío "Conectá tu cuenta de Meta Ads" con el link a Integraciones (mejor que esconder la opción: si no se ve, no se sabe que existe). El label es "Meta Ads", no "Anuncios".

### C. Pantallas de contenido (paridad con el prototipo)

**Flujo de crear (alto)**
- **C1 · "✦ Aprobar y producir copy" hace lo mismo que "Aprobar".** Las dos llaman `approveIdea` (`components/content/kanban.tsx`, IdeaCard). Tiene que aprobar, generar guion y caption (`generatePostCopy`) y abrir el editor con el estado "La IA está escribiendo…" en la sección Copy.
- **C2 · Nueva idea y Nuevo post son páginas aparte** (`/dashboard/content/new`); en el prototipo son **modales sobre el kanban** (`cmodal3`). Pasarlos a modal. "Nuevo post" suma el interruptor "Generar guion y caption con IA al crear" (deshabilitado con el motivo si no hay proveedor), Formato y Pilar como selects, redes con los chips de color, y el botón **"Crear y abrir"** que abre el editor (hoy vuelve al kanban).
- **C3 · Detalle de la idea (falta):** modal como `ideaView`: Hook, Ángulo, Formato, Pilar, Referencia, Propuesta por; caja "Qué pasa al aprobar" con el costo estimado; pie con Descartar (rojo, con motivo opcional), Aprobar y ✦ Aprobar y producir copy; para un Member, "Solo Owner y Admin aprueban ideas". La idea se puede editar mientras es `nueva`. Sacar "Descartar" de la tarjeta.
- **C4 · "+ Idea" al pie de la columna Ideas y "+ Post" al pie de Borrador** (faltan).

**Editor (alto)**
- **C5 · Botones que no hacen nada:** `onAction` responde "Eso se hace desde el detalle de la pieza" para enviar a revisión, aprobar, devolver y archivar. Implementarlos (un Member hoy no puede enviar a revisión desde el editor).
- **C6 · Pie fijo** como el prototipo: "X de N redes con fecha · Y sin fecha", "Guardado hace X s", "Guardar versión" y "Programar N redes con fecha" (o "Enviar a revisión" para un Member). Sacar los botones de arriba del formulario.
- **C7 · Estado del material** (Sin grabar, Grabado, Editado, Listo) como control segmentado en la sección Copy. `setMaterialStatus` existe y nadie lo llama; sin esto un post nunca pasa a En producción.
- **C8 · Fila de cada red completa:** tipo de CTA (Comentar, DM, Link, Ninguno) y palabra clave editables, con el chip de automatización con "Ver flow" o "Crear automatización"; media "Igual a la base / Propia de esta red (variante)" con su propio uploader; "Publicar por" con los publicadores disponibles; opciones de la red (las de A8, A9 y A17 y las de §9.5); "Quitar red"; el botón dice "Programar solo Instagram" (con el nombre de la red). Encabezado de la fila con insignia de color, fecha, estado con color (Sin fecha, Fecha tentativa, Programado, Publicado, Falló) y marcas ("Caption propio", "Variante", "⚡ SISTEMA", punto rojo si hay error).
- **C9 · Agregar redes:** pastillas "+ Instagram", "+ TikTok"… con las redes conectadas que el post todavía no tiene.
- **C10 · Vista previa** de la red abierta en la columna derecha, arriba del historial (componentes de LateWiz), como en el prototipo.
- **C11 · Palabras clave detectadas** debajo de "Cierre y CTA" (resaltadas y listadas).
- **C12 · Encabezado y barra superior:** título como encabezado (editable en el lugar), chip "💡 Idea: … · ver" que abre el modal de la idea, chip de formato; en la barra: "‹ Contenido", estado y "✦ Generar guion y caption" / "✦ Regenerar con IA".

**Kanban, calendario, lista y detalle (medio)**
- **C13 · Tarjetas del kanban** como `kcard3` / `ideaCard`: la de idea con etiqueta "Idea", formato · pilar, el hook entre comillas, autor y tiempo, 🔗 si tiene referencia (la consulta de `content/page.tsx` tiene que traer hook, pilar y referencia); la de post con bloque de color con el formato, insignias de redes de color con fecha, chips "✓ Copy ✦", "✓ Caption", "🎬 Grabado" y autor con fecha. Los posts en Borrador y En producción abren el editor; los demás, el detalle.
- **C14 · Calendario:** "Contar" como control segmentado que cambia el número de cada día (piezas o publicaciones), hora en cada tarjeta, insignias de redes de color, estilo por estado (programada, publicada, fallida) además de tentativa, leyenda y hoy resaltado. Arrastrar para reprogramar y vista semanal (F21).
- **C15 · Lista:** incluir ideas, columna Copy (✓ / Falta), filtro de fecha, fila clickeable.
- **C16 · Detalle del post:** "‹ Contenido", "Editar" y "Archivar" en la barra superior (F7); sacar "Volver al tablero".
- **C17 · Un componente `NetworkBadge`** con los colores e íconos de cada red, usado en todo contenido, calendario, lista, detalle y Social, en lugar de los nombres crudos ("instagram").

### D. Instagram y TikTok se programan del lado de Zernio (como LateWiz)

Hoy el sistema guarda la fecha y a esa hora le pide a Zernio "publicá ahora". LateWiz (el cliente de referencia de Zernio) hace otra cosa: le pasa la fecha a Zernio y Zernio publica. Eso elimina la dependencia del cron, el job viejo que sobrevive al reprogramar, las publicaciones trabadas y los reintentos propios. El SDK instalado (`@zernio/node`) ya tiene todo: `createPost` con `scheduledFor` + `timezone` o `publishNow`, `updatePost`, `deletePost`, `retryPost`, `getPost`, `listPosts`, `getMediaPresignedUrl`, `getNextQueueSlot`. Revisá los tipos en `node_modules/@zernio/node` y la documentación de Zernio antes de implementar.

- **D1 · Programar = crear el post en Zernio con fecha.** Para las redes cuyo publicador es `zernio`, `scheduleNetworks` llama `posts.createPost({ content, mediaItems, platforms: [{ platform, accountId, customContent, platformSpecificData }], scheduledFor, timezone })` con `scheduledFor` en ISO y `timezone` = `workspaces.timezone`. **Un post de Zernio por red** (cada red tiene su fecha, su caption y su media), así `social_posts` sigue una fila por red. Se guarda el id de Zernio en `publisher_ref` y la fila queda `scheduled` **sin job `content_publish`**. Si Zernio responde error, no queda ninguna fila `scheduled` y se muestra el motivo.
- **D2 · Publicar ahora** = `createPost` con `publishNow: true`.
- **D3 · Reprogramar o editar** una red programada (fecha, caption, media, opciones) = `posts.updatePost`. Guardar en el editor una red ya programada dispara la actualización en Zernio (esto resuelve A5 para Zernio). Si Zernio rechaza editar porque falta muy poco, se muestra el motivo.
- **D4 · Desprogramar** = `posts.deletePost` + fila `cancelled` + la fecha vuelve a tentativa. **Reintentar** una red fallida = `posts.retryPost`.
- **D5 · Media en Zernio.** Un link firmado de 24 h vence antes de publicar si se programa con días de anticipación. Al programar, el servidor pide `media.getMediaPresignedUrl`, sube el archivo desde Storage a esa URL y usa la dirección pública de Zernio en `mediaItems` (como `use-media.ts` de LateWiz, pero del lado del servidor). Si la media cambia, se vuelve a subir. Se guarda qué archivo corresponde a qué URL de Zernio para no subirlo dos veces.
- **D6 · Estado.** Llega por el webhook de posts de Zernio (`post.platform.published` / `post.platform.failed`, ver A7) y actualiza la fila, el estado del post, las automatizaciones (A6) y los avisos. Como red de seguridad, un job de conciliación consulta con `getPost` las filas `scheduled` cuya hora ya pasó hace más de 15 minutos sin estado final, y un barrido diario con `listPosts` compara lo programado en Zernio con lo que tiene el sistema.
- **D7 · Idempotencia:** mandar un id de pedido estable (`socialPostId`) en `createPost`, para que un corte de red después de que Zernio aceptó no cree dos posts.
- **D8 · Cola (nice-to-have):** opción "Agregar a la cola" en la fila de la red, que pide `getNextQueueSlot` y programa en el próximo horario libre del perfil de Zernio.
- **D9 · Postproxy:** si su API acepta `scheduled_at` (la documentación lo muestra en `POST /posts`), YouTube por Postproxy sigue el mismo patrón (programa del lado de ellos, estado por consulta). Si no, queda en el despachador. Anotá qué encontraste.
- **D10 · El despachador propio queda solo para `youtube_api`, `linkedin_api` y `threads_api`**, con los arreglos de A.
- **D11 · Test de punta a punta:** `verify-publishing.mjs` cubre los dos caminos: Zernio nativo (programar → `createPost` simulado con fecha y zona → webhook simulado → publicado, más reprogramar con `updatePost`, desprogramar con `deletePost` y reintentar con `retryPost`) y el despachador (LinkedIn o Threads simulado).

### E. Agente copywriter de contenido

Estaba previsto para la Etapa 3 como "agente de Redacción" (`diseno-etapa3-agentes.md`); la Etapa 2 dejó una generación simple (`lib/ai/generate-copy.ts` + `lib/content/ai-copy.ts`) con la interfaz lista para reemplazarla. Ahora se construye el agente, sobre la infraestructura de agentes que ya existe (`agents`, `agent_runs`, `agent_run_steps`, `lib/agent/agent-types.ts`), **sin** conversaciones (esas son de la Etapa 3).

- **E1 · Tipo nuevo `copywriter`** en `AGENT_TYPES` ("Copywriter de contenido": "Escribe el guion y los captions de cada pieza con la voz de tu marca"), `conversational: false`. Pestañas: Configuración, Conocimiento, Runs, Costos. Secciones: identidad, instrucciones, modelo (con respaldo), conocimiento, límites.
- **E2 · Una fila por workspace.** Migración aditiva que crea el agente `copywriter` en cada workspace existente y lo siembra al crear uno nuevo. Lo que hoy está en `workspaces.content_copy_settings` (voz de marca y ejemplos) pasa a la configuración del agente; la columna se sigue leyendo como respaldo y no se borra.
- **E3 · Configuración (en Agentes, por workspace):**
  - Instrucciones y voz de marca, con versiones (`agent_prompt_versions`).
  - Ejemplos de posts buenos (texto).
  - Modelo y proveedor del workspace, con respaldo.
  - Conocimiento por etiquetas (`knowledge_tags`): oferta, casos, cliente ideal.
  - Límites (`guardrails`): frases prohibidas, promesas que no se pueden hacer, largo máximo.
  - Topes de gasto diario y mensual del agente, además de los del workspace.
  - Interruptor **"Producir el copy automáticamente al aprobar una idea"** (por defecto apagado).
- **E4 · Cómo trabaja (`lib/agent/copywriter.ts`).** Primero junta el contexto de forma determinista, y cada lectura queda como un paso en `agent_run_steps`:
  - La idea y el post (formato, redes).
  - Los 5 posts con mejor engagement a 7 días de esa red y formato, de los últimos 90 días.
  - Las automatizaciones activas por palabra clave del workspace, para proponer en el CTA una palabra que dispare algo real.
  - Los fragmentos de la base de conocimiento de sus etiquetas relacionados con la idea.
  - Las indicaciones de la persona, si las hay.
  
  Después hace **una** llamada con salida estructurada, con el mismo esquema y la misma validación de F29. No publica, no cambia estados y no toca nada fuera del borrador.
- **E5 · Guardado:** versión nueva con autor "Agente copywriter" (`author_kind = 'ai'`, id del agente), motivo `ai_generation`; mismas reglas que F29 (no pisa sin versión, confirmación si hay copy escrito a mano, aviso "✦ Generado por el copywriter · revisalo antes de aprobar").
- **E6 · Ejecución en segundo plano:** job `content_copy` en `scheduled_jobs`, con handler registrado en `lib/jobs/registry.ts`. Columna aditiva `content_posts.copy_status` (`idle`, `generating`, `failed`) para que el kanban y el editor muestren "El copywriter está escribiendo…" y se actualicen solos al terminar. Al terminar o fallar, aviso con link al post (y "Reintentar" si falló).
- **E7 · Cuándo corre:**
  - "✦ Aprobar y producir copy" en la idea.
  - Aprobar una idea con el interruptor de E3 prendido.
  - "Nuevo post" con "Generar guion y caption al crear".
  - "✦ Generar guion y caption" o "✦ Regenerar" en el editor.
  - **"Regenerar con indicaciones"**: un campo de texto corto ("más corto, más directo") que se pasa al agente y queda guardado en el run.
- **E8 · Trazabilidad y costos:** cada ejecución es un `agent_run` del agente copywriter (costo, tokens, modelo, duración, estado, post vinculado), visible en sus pestañas Runs y Costos y sumado al gasto del workspace. Se respetan los topes del agente y del workspace antes de llamar.
- **E9 · Permisos:** `content.ai` para correrlo; `agents.edit` para configurarlo.
- **E10 · Listo para la Etapa 3:** la función principal recibe `{ agentId, postId, instructions?, threadId? }` y devuelve el resultado, para que después se registre como herramienta del agente general y las indicaciones pasen a ser una conversación.
- **E11 · Tests:** armado del contexto (qué posts elige, qué palabras clave ofrece), respeto de límites y topes, versión con autor del agente, job y `copy_status`, disparo al aprobar con el interruptor prendido y apagado, y verificación de que corre con la configuración de **su** workspace (dos workspaces con voces distintas). Proveedor de IA siempre simulado.

**Reglas:** rama `etapa2-correcciones`; en A y D, test que reproduce el error o el comportamiento nuevo antes del cambio; en D y E, APIs de Zernio e IA simuladas; APIs e IA simuladas, nada real; migraciones solo aditivas desde la siguiente libre; después de cada punto `npx vitest run`; después de cada grupo, PROGRESS, commit `fix: etapa 2 - <grupo>` y push; cada pantalla de B y C recorrida en 1440 y 390 px comparada con el prototipo (si pide login, anotarlo). No mergees a `main`: lo mergeo yo después de probar.

Presentame el plan y esperá mi aprobación.

---FIN---

## Cómo revisar el plan

1. ¿Verificó los puntos y dijo si alguno no era como está escrito?
2. ¿Sigue el orden A → D → B → E → C, con un test que reproduce cada error de A?
3. ¿En D: un post de Zernio por red, media subida a Zernio al programar, estado por webhook más conciliación?
4. ¿En E: un agente por workspace, que no publica ni cambia estados, con runs y costos visibles?
5. ¿Incluye `verify-publishing.mjs` de punta a punta con los dos caminos?
6. ¿Dice que no mergea a `main`?

Aprobá con **"Yes, and use auto mode"** y pegá el goal.

## PROMPT 2 (`/goal`)

---INICIO---

/goal Completá los grupos A, D, B, E y C de docs/correcciones-etapa2.md en ese orden, en la rama etapa2-correcciones, siguiendo el plan aprobado. En A, escribí primero un test que reproduzca cada error. Después de cada punto corré npx vitest run; después de cada grupo marcá docs/PROGRESS-correcciones.md, hacé commit y git push origin etapa2-correcciones. Está listo cuando todos los puntos están marcados o anotados en docs/PENDIENTE.md con la decisión tomada; npx vitest run, npm run build, node scripts/verify-rls.mjs, node scripts/verify-content.mjs, node scripts/verify-crm.mjs, node scripts/verify-inbox-filters.mjs y node scripts/verify-publishing.mjs (nuevo, de punta a punta) salen 0; lint sin errores nuevos; ningún test previo se rompió; los tests del agente copywriter corren con el proveedor simulado; y la revisión visual de las pantallas de B, C y E (Agentes → Copywriter) contra el prototipo quedó hecha o anotada. Nunca llames a un proveedor real (tampoco de IA), nunca conectes cuentas ni publiques nada, nunca registres webhooks, nunca apliques una migración que borre o modifique datos existentes, nunca muestres ni commitees un secreto, y nunca toques main.

---FIN---

## Después

Probá en el navegador (`npm run dev`): el selector de dashboards; Agentes → Copywriter (cargá la voz de marca); crear una idea y "✦ Aprobar y producir copy" (con tu proveedor de IA real, el copywriter escribe de verdad: es la única llamada real que conviene probar); el editor completo y el calendario. Si está bien, mergeá. La prueba de publicar de verdad se hace en la verificación en vivo: primero registrar el webhook de posts en Zernio, después programar un post de Instagram a 10 minutos y verificar que aparece programado en Zernio, que se publica y que el sistema lo marca publicado.
