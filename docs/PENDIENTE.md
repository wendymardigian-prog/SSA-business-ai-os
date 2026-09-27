# Pendientes

Lo que quedó sin cerrar, para retomar con Wendy. Formato de cada entrada:

- **Qué quedó:** …
- **Por qué:** …
- **Qué se decidió en su lugar:** …

---

## Etapa 2

### Las pantallas del Bloque 1 no se recorrieron a ojo
- **Qué quedó:** la pantalla de integraciones nueva (grilla, modal, filtro "Requiere atención") y la barra
  superior en las 22 pantallas no se vieron en el navegador, ni en 1440 ni en 390 px.
- **Por qué:** la app pide login y en la corrida autónoma no se ingresan credenciales. Se levantó el servidor
  y toda ruta del dashboard redirige a `/login`.
- **Qué se decidió en su lugar:** la lógica va en funciones puras con tests (`status`, `usage`, `page-actions`)
  y hay dos tests que recorren los archivos: uno verifica que toda pantalla con título dibuje la barra siguiendo
  sus imports, y otro que ningún componente de navegador llegue al módulo de Vault. La recorrida visual queda
  para hacerla con Wendy.

### Migración destructiva escrita y sin aplicar (§9.10)
- **Qué quedó:** `drop_legacy_secret_columns` (`workspaces.late_api_key_encrypted`, `workspaces.webhook_secret`,
  `channels.webhook_secret`) se escribe como archivo y **no se aplica**.
- **Por qué:** borra columnas que hoy tienen los secretos en uso. Aplicarla antes de que todo lea de Vault
  dejaría a Instagram sin API key y al webhook sin secreto.
- **Qué se decidió en su lugar:** se aplica en la verificación en vivo (§18 del plano), después de confirmar con
  cuentas reales que Vault responde, y junto con el borrado de las variables `EVOLUTION_*` de Railway.

### "Migrar a Vault" se construye pero no se aprieta
- **Qué quedó:** el botón de la card de Zernio (F5) queda funcionando, pero durante la corrida no se usa.
- **Por qué:** copiar un secreto es cambiar configuración real, y la regla de la corrida (§0) lo prohíbe.
- **Qué se decidió en su lugar:** mientras Vault esté vacío, `resolveWebhookSecret` y `getZernioApiKey` siguen
  leyendo las columnas de hoy, así que nada cambia de comportamiento. El botón se usa en §18.

---

### La documentación de Postproxy no coincide con el plano
- **Qué quedó:** el plano (F32) suponía campos propios de YouTube (título, privacidad, Short, miniatura) y un
  webhook de estado con firma. La documentación real (postproxy.dev, consultada el 26/9/2026) expone
  `POST /posts` con `{ post: { body, draft, scheduled_at }, profiles, media }`, sin campos por red
  documentados, y su guía de inicio **no documenta webhooks**.
- **Por qué:** gana la documentación (§19 del plano).
- **Qué se decidió en su lugar:** el cliente implementa lo que la API tiene de verdad, y el estado final se
  consulta con `GET /posts/:id` en vez de esperar un webhook. El publicador de F32 agenda ese chequeo. Si
  Postproxy documenta webhooks más adelante, se cambia el camino sin tocar la interfaz común. Al conectar la
  cuenta real hay que confirmar cómo se manda el título del video: puede ir en `platforms[].params`.

### 20 vulnerabilidades de npm, previas a esta etapa
- **Qué quedó:** `npm audit` reporta 20 vulnerabilidades (1 crítica, 10 altas), entre ellas `ws` y otras
  dependencias transitivas.
- **Por qué:** ya estaban antes de la Etapa 2. Se verificó: el conteo es idéntico con y sin `tus-js-client`,
  la única dependencia que suma esta etapa. Arreglarlas implica `npm audit fix --force`, que trae cambios
  incompatibles y no es algo para hacer en medio de una corrida autónoma.
- **Qué se decidió en su lugar:** anotarlo. Conviene revisarlo aparte, con la suite en verde antes y después.

## Heredado de la Fase 3

Sigue pendiente todo esto, salvo la barra superior de 56 px, que esta etapa resuelve en F7.

### API por lote (Bloque 5 de la Fase 3, §21.2)
- **Qué quedó:** el proveedor de IA se llama con pedidos agrupados, no con la API por lote (batch) real.
- **Por qué:** el AI SDK v6 no expone modo batch para ningún proveedor, y los SDK crudos no están instalados.
- **Qué se decidió en su lugar:** interfaz `BatchProvider` lista para sumar el lote real por `fetch`.

### Handler de `bg_task` y recolección (F24/F25 de la Fase 3)
- **Qué quedó:** falta el handler de `scheduled_jobs` tipo `bg_task` que ejecuta el clasificador, y la
  recolección de resultados en `bg-collect` (hoy la ruta es un stub con un TODO).
- **Por qué:** el lote real no existe en el SDK y el pipeline completo era grande.
- **Qué se decidió en su lugar:** quedaron la lógica de ventanas (`planDispatch`), las rutas cron y el
  clasificador. **Hallazgo nuevo de esta corrida:** como el dedupe de `scheduled_jobs` solo cubre las filas
  `pending`, cada `bg_task` que el runner completa se vuelve a encolar 15 minutos después. Al 26/9/2026 hay 9 así,
  y crecen ~96 por día. No se rompe nada (el job no hace nada), pero conviene cerrarlo al construir el handler.
  El registro de jobs del Bloque 4b le deja un handler explícito que conserva ese comportamiento.

### UI de calidad, revisión rápida y versiones del clasificador (F25 de la Fase 3)
- **Qué quedó:** las fórmulas de calidad (`lib/patterns/quality.ts`) están testeadas, falta la pantalla: 4
  indicadores, calibración, revisión rápida de 20 y versiones del clasificador con "volver a esta".
- **Por qué:** volumen del bloque.
- **Qué se decidió en su lugar:** la lógica quedó testeada; la pantalla se hace con Wendy mirando.

### Detalle de tendencias con 4 pestañas (F16 de la Fase 3)
- **Qué quedó:** el dashboard de Chat muestra una serie; la función SQL ya devuelve las tres.
- **Por qué:** las 4 pestañas con leyenda y paso a semanal son presentación; el dato está.
- **Qué se decidió en su lugar:** se completan en la pasada de pantallas con Wendy.

### "Qué le responden" (§11.7) y drilldown de correcciones (F22 de la Fase 3)
- **Qué quedó:** falta la sección "qué le responden" y los controles de corrección enganchados en la UI (las
  Server Actions ya existen en `lib/actions/patterns.ts`).
- **Por qué:** volumen del bloque.
- **Qué se decidió en su lugar:** se completa en la pasada de pantallas con Wendy.

### `declarar_intencion` es opt-in (F26 de la Fase 3)
- **Qué quedó:** la herramienta existe pero no es `required`: se habilita por agente.
- **Por qué:** marcarla `required` cambiaba el set por defecto y rompía los tests de caracterización del runner.
- **Qué se decidió en su lugar:** queda opt-in; al prender el agente, activarla en Herramientas.

### Migración 00072 (avisos de ventana) escrita y sin aplicar
- **Qué quedó:** `00072_draft_window_alerts` está escrita y probada, y **no está aplicada**. Verificado contra la
  base el 26/9/2026: no existen `private.alert_draft_windows` ni el cron `ssa-cron-draft-window-alerts`.
  (La bitácora del Bloque 2c dice en un lugar que se aplicó: es un error, la base manda.)
- **Por qué:** es lo único que notifica a una persona; conviene enchufarlo sabiendo el volumen de la cola.
- **Qué se decidió en su lugar:** se aplica cuando la cola de borradores tenga un par de días.

### Recorrida de pantallas en vivo
- **Qué quedó:** las pantallas no se recorrieron a ojo en las corridas autónomas.
- **Por qué:** la app pide login y no se ingresan credenciales.
- **Qué se decidió en su lugar:** la lógica va en funciones puras con tests y en scripts `verify-*`; la recorrida
  a 1440 y 390 px se hace con Wendy.

### Deuda del agente que sigue abierta
- **Qué quedó:** `approveDraft` no mira `agent_enabled`; un Member no ve en Acciones los `tag_effect` del agente;
  las respuestas desde la app de Instagram no llegan por webhook; el eco `fromMe` de WhatsApp no apaga el agente;
  la zona horaria está partida entre la de la app y la del negocio; el backlog de 578 conversaciones sigue abierto;
  la regla de pertenencia de un borrador (setter → vendedor → sin asignar) espera confirmación de Wendy;
  falta la segunda pasada del backfill de Zernio (semana del 1/10/2026); y el Bloque 2d-B completo.
- **Por qué:** son decisiones de producto o necesitan al agente corriendo con datos reales.
- **Qué se decidió en su lugar:** todo documentado en [agente-ia.md](agente-ia.md); no se toca en la Etapa 2.

### Hallazgos de la exploración de la Etapa 2 que no son de su alcance
- **Qué quedó:** (a) `lib/ai/generate-reply.ts` (nodo AI Response y pasos de secuencia) **no chequea los topes de
  gasto**: solo el runner del agente llama a `checkSpendLimits`. (b) `next.config.ts` no configura
  `serverActions.bodySizeLimit`, así que la subida de documentos de la base de conocimiento (que pasa por una
  Server Action) topea en 1 MB por defecto, muy por debajo del límite de 25 MB del bucket. (c) Los broadcasts
  envían solo por Zernio: un destinatario de WhatsApp se saltea en silencio.
- **Por qué:** son zonas declaradas intocables por §4.2 del plano de la Etapa 2.
- **Qué se decidió en su lugar:** quedan anotados. (a) y (c) son arreglos chicos y acotados; (b) es una línea de
  configuración, pero cambiarla toca el límite de todas las Server Actions.

### La prueba de subida directa a YouTube no se corrió (F38)

**Qué quedó.** `probeYouTubeUpload` está construida y probada con el proveedor simulado, con su botón en la card de Google. Nunca se apretó.

**Por qué.** Sube un video a la cuenta real de YouTube del negocio. La regla 2 de la corrida dice que no se publica nada, y la 3, que no se toca configuración real.

**Qué se decidió en su lugar.** El publicador `youtube_api` queda en `unverified`, que es el estado que ya traía: YouTube publica por Postproxy hasta que alguien apriete el botón. La prueba va en la verificación en vivo (§18 del plano), junto con conectar las cuentas.

### El receptor de Postproxy está construido sobre un formato supuesto

**Qué quedó.** `app/api/webhooks/postproxy/route.ts` existe y valida un secreto, pero la documentación pública de Postproxy no documenta webhooks.

**Por qué.** El plano los daba por hechos; la documentación manda. El formato que interpreta `fromPostproxyEvent` es una suposición razonable (`post_id`, `status`, `url`).

**Qué se decidió en su lugar.** El camino real para saber cómo quedó una publicación por Postproxy es el job de revisión `content_publish_check`, que pregunta por el estado a los 2, 10 y 30 minutos. Si Postproxy suma avisos, alcanza con pegar la URL, guardar el secreto y ajustar esa función.

### LinkedIn publica solo texto

**Qué quedó.** `linkedinPublisher` publica un post de texto. Con media, falla con un mensaje claro.

**Por qué.** Las Images, Videos y Documents API de LinkedIn son tres flujos de subida distintos, cada uno con su registro previo. Construirlos a ciegas, sin una cuenta conectada contra la que probar, es escribir código que no se puede verificar.

**Qué se decidió en su lugar.** Fallar con "LinkedIn solo publica texto por ahora" antes de intentarlo. Publicar el texto sin la imagen y no decir nada sería peor: se vería como que salió bien.

### Zernio no tiene `/v1/analytics/delta` ni cursor

**Qué quedó.** El lector de Zernio pide una ventana de fechas con `getAnalytics`, no un delta incremental, y no se guarda ningún `analytics_cursor`.

**Por qué.** El plano daba por hecho un endpoint `delta` con cursor y un evento `analytics.synced`. Revisado el SDK instalado (`@zernio/node` 0.2.x), no existen: lo que hay es `getAnalytics` con `fromDate`, `toDate`, `page` y `source`. Gana la documentación.

**Qué se decidió en su lugar.** Se piden los últimos 30 días, que es exactamente la ventana que la regla de frecuencia (F45) dice que todavía cambia. Para una recolección nocturna da el mismo resultado con una pieza menos que mantener. Si Zernio suma el delta, se cambia dentro de `readZernioMetrics` y nada más se entera.

### Historial inicial: qué permitió cada red

**Qué quedó.** La serie de seguidores empieza el día que se conecta la cuenta, salvo en Instagram.

**Por qué.** Es lo que da cada API:

| Red | Historial al conectar |
|---|---|
| Instagram | 30 días de `follower_count` por la Graph de Meta |
| YouTube | La Analytics API da series por día desde el inicio del canal, pero solo con la cuenta conectada por OAuth |
| Zernio (Instagram, TikTok) | Ninguno: da un solo número de seguidores, sin fecha |
| Threads | Ninguno: `followers_count` es un total |

**Qué se decidió en su lugar.** El gráfico dice "Datos desde el …" cuando la serie no llega al principio del período, en vez de dibujar una línea que arranca de la nada.

### LinkedIn no da métricas de publicaciones ni comentarios

**Qué quedó.** El lector de LinkedIn devuelve vacío con un aviso, y sus comentarios no se leen.

**Por qué.** Las dos cosas necesitan el programa de partners de LinkedIn. Con los permisos que da una app común, los endpoints existen pero devuelven vacío o 403.

**Qué se decidió en su lugar.** Decirlo en pantalla: "LinkedIn no deja leer los comentarios desde afuera. Se contestan desde LinkedIn." Es información, no un error que alguien pueda arreglar reconectando.

### La página Social muestra tres cifras vacías

**Qué quedó.** En el perfil, "Seguidos" (Instagram), "Me gusta" (TikTok) y "Vistas" (YouTube) aparecen con una raya.

**Por qué.** Ninguna recolección los trae: el lector de Zernio da seguidores y nada más, y la Data API de YouTube da el total de vistas del canal, que hoy no se guarda en ninguna columna.

**Qué se decidió en su lugar.** Mostrar una raya y no un cero. Un cero diría que la cuenta no sigue a nadie y que el canal no tuvo vistas nunca. Cuando se sumen esas columnas a `social_account_metrics_daily.extra`, la pantalla las toma sin cambios.

### Las historias activas no se muestran todavía

**Qué quedó.** `readActiveStories` existe y está probada, pero la página Social no la llama.

**Por qué.** Necesita una ruta con caché de 15 minutos por workspace, y el bloque 6 ya era el más grande de la fase.

**Qué se decidió en su lugar.** La grilla muestra las publicaciones guardadas, que es lo que contesta la pregunta principal. Las historias van con el bloque 7, donde ya hay una caché en memoria para Meta y se comparte el patrón.

### El detalle de anuncios no muestra las tarjetas de desglose

**Qué quedó.** Las pantallas de campaña, conjunto y anuncio muestran las cifras, la evolución, el embudo, la retención de video, los rankings y el creativo. No muestran las tarjetas de placement, dispositivo, audiencia ni rendimiento por hora.

**Por qué.** Las cuatro salen de consultas en vivo a Meta (`fetchBreakdown`, ya construida y probada), y cada una es una llamada más por pantalla abierta. Con la cuenta real todavía sin conectar, no había forma de ver si el volumen de llamadas es razonable en el nivel Development.

**Qué se decidió en su lugar.** `fetchBreakdown` queda lista con su caché de 15 minutos. Agregar las tarjetas es consumirla desde la pantalla, sin tocar nada más. Se hace en la verificación en vivo, cuando se pueda medir cuánta cuota cuesta abrir un detalle.

### El análisis con IA no guarda los análisis anteriores

**Qué quedó.** Cada análisis se muestra y se pierde al cerrar el panel. El costo sí queda registrado en `agent_runs`.

**Por qué.** Guardarlos necesita una tabla con su RLS, y el plano lo pedía como nice-to-have dentro del último bloque de la fase.

**Qué se decidió en su lugar.** El análisis se puede copiar del panel. Si resulta que se relee, la tabla es una migración chica y el panel ya tiene dónde listarlos.

### La migración del email quedó en 00087, no en 00086

**Qué quedó.** La numeración planificada daba 00086 al email. Quedó 00086 para las tablas de métricas (bloque 5) y 00087 para el email.

**Por qué.** El bloque 5 llegó antes en el orden real de ejecución, y saltear un número o reordenarlos después de aplicar el primero habría dejado el repositorio y la base en desacuerdo.

**Qué se decidió en su lugar.** Se siguió el orden de ejecución. La tabla de migraciones de PROGRESS tiene la numeración real.

### Un segundo módulo que no puede llegar al navegador

**Qué quedó.** `lib/email/buckets.ts` existe solo para tener el nombre del bucket sin dependencias, y `lib/vault-boundary.test.ts` ahora vigila también `lib/supabase/server.ts`.

**Por qué.** La bandeja es un Client Component y necesitaba el nombre del bucket. Importarlo de `lib/email/inbound.ts` arrastró todo el procesamiento del correo y con él `next/headers`, y el build falló señalando un archivo que nadie había tocado.

**Qué se decidió en su lugar.** El mismo patrón que `lib/secret-names.ts`: un archivo hoja con la constante. Y el test de frontera ahora cubre los dos módulos, así el próximo caso sale nombrando la cadena de imports en vez de un error de Turbopack.

### La migración 00090 está escrita y NO aplicada

**Qué quedó.** `00090_drop_legacy_secret_columns.sql` borra `workspaces.late_api_key_encrypted`, `workspaces.webhook_secret` y `channels.webhook_secret`. Está escrita y no se aplicó.

**Por qué.** La API key de Zernio de este negocio **todavía vive en `late_api_key_encrypted`**. Es de donde la lee el respaldo de `getZernioApiKey`, o sea de donde la lee el sistema cada vez que manda un mensaje por Instagram. Aplicarla hoy deja la bandeja sin poder responder, en el momento.

**Qué se decidió en su lugar.** El archivo tiene el orden para hacerlo bien, en cinco pasos: apretar "Migrar a Vault" en la tarjeta de Zernio, comprobar que desaparece el aviso, mandar un mensaje de prueba, aplicar la migración, mandar otro. Además la migración se niega a correr si queda algún secreto en las columnas: aplicarla con una clave adentro sería perderla.

### `has_permission` no conoce los permisos del rol Member de sistema

**Qué quedó.** La función de la base devuelve `true` para Owner y Admin, y para un rol personalizado consulta su jsonb. Para el rol Member de sistema devuelve `false` en todo, porque su fila tiene los permisos vacíos.

**Por qué.** La fuente de los permisos de los tres roles de sistema es `lib/auth/permissions.ts`. Copiarlos a SQL daría dos listas que se separan, y mandaría la que alguien mire primero.

**Qué se decidió en su lugar.** Hoy ninguna policy usa `has_permission`: el alcance de leads lo resuelve `permission_scope`, que sí contempla los tres casos. Queda documentado en el cuerpo de la función y en `docs/roles.md`. Si algún día una policy necesita preguntar por un permiso que un Member tiene, hay que sincronizar la lista o hacer que la función lea la tabla de TypeScript por otra vía.

### Dos errores que encontró `verify-rls.mjs` en el bloque 9

Los dos se arreglaron, y valen como anotación porque el script es la única razón por la que se encontraron:

1. **El trigger que protege los roles de sistema frenaba el borrado en cascada de un workspace.** Faltaba distinguir "alguien borra un rol de sistema a mano" de "el workspace se va y sus roles con él". Se arregló mirando si el workspace todavía existe.
2. **El primer intento de la 00089 copió la lógica de leads dentro de `can_see_conversation`** en vez de delegar en `can_see_contact`, deshaciendo lo que la 00028 había hecho a propósito, y perdiendo la exclusión de contactos borrados. El Member volvía a ver la conversación sin asignar de un lead que no puede ver. Se volvió a delegar, y el alcance `conversations: all` quedó como un camino más, antes de delegar: solo ensancha.
