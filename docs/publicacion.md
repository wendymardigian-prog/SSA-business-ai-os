# Publicación

Cómo sale a las redes lo que se programa, y qué pasa cuando algo falla.

## Un camino por red

Todas las redes se publican a través de la misma interfaz interna. El
sistema pide "publicá esto" y recibe un resultado; no sabe cuál de los cinco
caminos está usando. Por eso editar, cancelar y reprogramar funcionan igual
en todas.

| Red | Por dónde sale |
|---|---|
| Instagram | Zernio |
| TikTok | Zernio |
| YouTube | Postproxy, o la API oficial de Google |
| LinkedIn | API de LinkedIn |
| Threads | API de Threads |

YouTube es la única con dos caminos. Cuál se usa lo decide la cuenta: la API
oficial es de la cuenta del negocio y no tiene tope mensual, pero requiere
que el proyecto de Google haya pasado la auditoría (ver abajo).

## Los tres resultados posibles

**Publicado.** La red devolvió el id y el link. Se guardan los dos.

**En proceso.** La red aceptó el pedido y va a avisar después. Es lo normal
en Zernio y Postproxy. La publicación queda con una referencia del proveedor,
y hay dos formas de enterarse de cómo terminó:

- El **aviso del proveedor** (webhook), que es el camino rápido.
- Una **revisión** que pregunta a los 2, 10 y 30 minutos, que es la red de
  seguridad para cuando el aviso no llega.

Si después de las tres revisiones sigue sin saberse, la publicación queda
como fallida con un mensaje que dice *"no pude confirmar si salió; fijate en
la red antes de volver a publicar"*. Decir "falló" a secas invitaría a
republicarla y duplicarla.

**Falló.** Con el motivo en castellano, no un código.

## Reintentos

Solo se reintenta lo que tiene sentido reintentar.

| Qué pasó | Se reintenta |
|---|---|
| La red cortó por volumen (429) | Sí, al minuto, a los 5 y a los 15 |
| La red se cayó (5xx) | Sí |
| Se cortó la conexión | Sí |
| La cuenta se desconectó (401) | No |
| La red rechazó el contenido (400) | No |
| Falta un permiso (403) | No |

Las esperas son más largas que las del resto de la cola (10 y 20 segundos) a
propósito: las redes cortan por volumen, y volver a los diez segundos es
pedirle al mismo límite que nos vuelva a cortar.

## No publicar dos veces

Es lo único de este módulo que no se puede deshacer, y por eso tiene tres
protecciones:

1. Al tomar una publicación, la base decide quién se la lleva
   (`UPDATE ... WHERE status = 'scheduled' RETURNING`). Si dos corridas del
   cron llegan juntas, una sola se la lleva y la otra no encuentra nada.
2. Los reintentos los agenda el propio despachador, no la cola. Si lanzara
   una excepción, la cola reintentaría a los diez segundos **encima** del
   reintento propio: dos publicaciones.
3. Reintentar desde la pantalla solo toca las redes que fallaron. Las que
   salieron no se vuelven a intentar nunca.

## La media

Viaja por URL firmada, válida 24 horas. Los proveedores la bajan de ahí.

YouTube es la excepción: el video se sube **por partes**, leyéndolo del
almacenamiento por rangos. Un video de 800 MB cargado entero en memoria en un
contenedor de Railway es un proceso muerto.

## La trampa de YouTube

Si el proyecto de Google no pasó la auditoría de la API, YouTube acepta un
video pedido como público, lo sube, devuelve 200 y **lo deja privado sin
error ni aviso**. La primera vez que se nota es cuando un cliente pregunta
por qué no ve el video.

Dos cosas lo cubren:

- Después de cada subida, el sistema **lee cómo quedó** el video y lo compara
  con lo que se pidió. Si no coincide, la publicación sale con la advertencia
  y deshabilita ese camino.
- En Integraciones hay un botón, **"Probar la subida directa"**, que sube un
  video de un segundo como "no listado", mira cómo quedó y lo borra. Sirve
  para enterarse antes, con un video de prueba y no con uno del cliente.

Mientras el proyecto no pase la auditoría, YouTube publica por Postproxy.

## Lo que cada red permite

**Instagram**: feed, carrusel, reel e historia. Colaboradores.

**TikTok**: video y carrusel de fotos. Se puede publicar como **borrador**,
que lo deja en el Creator Inbox para revisarlo desde el teléfono antes de que
salga.

**YouTube**: video y Short. Visibilidad pública, no listada o privada. Sin
visibilidad elegida, queda **privado**: nunca se publica en público por
omisión.

**LinkedIn**: solo texto por ahora. Con media, falla con un mensaje claro.
Las APIs de imagen, video y documento de LinkedIn son tres flujos de subida
distintos y no había una cuenta conectada contra la cual probarlos.

**Threads**: texto, imagen, video e hilos. Un hilo se publica en orden, cada
parte respondiendo a la anterior; sin eso serían tres posts sueltos y se
leerían al revés.

## Aprobar antes de publicar

Una pieza tiene que estar aprobada para programarse, y **una vez programada
no se edita** sin desprogramar primero. Si se pudiera, se editaría un caption
que ya está en la cola y saldría algo distinto de lo que se aprobó.

## Correcciones de la Etapa 2 (27/9/2026)

### Instagram y TikTok se programan del lado de Zernio

Antes el sistema guardaba la fecha y a esa hora le pedía a Zernio "publicá
ahora". Eso ataba la publicación a que nuestro cron corriera en el momento
justo, y de ahí salían el job huérfano al reprogramar, las filas trabadas y
los reintentos que podían duplicar.

Ahora se le pasa la fecha y la zona y publica Zernio:

| Acción | Qué hace |
|---|---|
| Programar | `createPost` con `scheduledFor` + `timezone`. Un post de Zernio **por red**. El id queda en `publisher_ref` y **no hay job de publicación**. |
| Publicar ahora | `createPost` con `publishNow`. |
| Reprogramar o editar | `updatePost` (siempre con `isDraft: false`: mandar solo la fecha devuelve 200 y el post sigue siendo borrador). |
| Desprogramar | `deletePost` **antes** de cancelar de este lado. Si quedara agendado allá, Zernio lo publicaría igual. |
| Reintentar | `retryPost`. |

**La media vive en Zernio.** Un link firmado nuestro vence en 24 horas y un
post agendado para la semana que viene lo encontraría muerto. Al programar, un
job sube el archivo y la fila espera en `uploading`; `provider_media` recuerda
qué archivo es cuál, así tres redes con el mismo video lo suben una vez.

**El estado llega por webhook** (`post.platform.published` / `.failed`). Como
red de seguridad, una conciliación pregunta con `getPost` por las que
deberían haber salido hace más de 15 minutos.

**Postproxy y las APIs directas** (YouTube, LinkedIn, Threads) siguen por el
despachador propio. Postproxy acepta `scheduled_at` pero no documenta borrar
ni editar: desprogramar dejaría el post saliendo igual. Está anotado en
[docs/etapa2/PENDIENTE.md](etapa2/PENDIENTE.md).

### El SDK de Zernio lanza, no devuelve el error

Su README y sus tipos sugieren `{ data, error }`, pero el cliente convierte
todo HTTP no-2xx en una excepción `ZernioApiError`, que expone `.statusCode` y
no `.status`. El bloque que clasificaba reintentos era código muerto: **ningún
429 ni 5xx se reintentaba**. Ahora `lib/publishing/zernio-errors.ts` mira la
forma del error y clasifica por código.

### La subida a YouTube tiene su propia ruta

Subir un video por trozos puede tardar minutos, y dentro del cron general esos
minutos se los comía la cola entera. `/api/cron/content-upload` corre de a una
subida, cada dos minutos, con cinco de margen.

## Contenido v3 (octubre 2026)

Lo que cambió en publicar y en las cuentas, con el avance completo en
[PROGRESS-CV3.md](PROGRESS-CV3.md). Lo de la pieza y los drawers está en
[contenido.md](contenido.md).

### Las cuentas salen de la lista de Zernio (F73 a F76)

- **Una cuenta social es lo que Zernio dice que está conectado.** Sin clave de
  Zernio, las cuentas que salían por Zernio quedan **"no disponibles"** (conservan
  su identidad y su canal) en vez de usar los canales como respaldo. Una falla de
  Vault al leer la clave **no** cuenta como "desconectado": distingue presente,
  ausente y "no pude leer" (`getZernioKeyState`).
- **Se sincroniza sola** al guardar la clave de Zernio (`channels/test-key`), al
  guardar Postproxy, al desconectar, con "Sincronizar canales" y con "Sincronizar
  cuentas". Todo pasa por `lib/social/sync-hook.ts`, que **nunca lanza**: un
  guardado de integración no puede fallar porque no se pudo sincronizar.
- **El perfil** (foto, link, seguidores y otras cifras) se lee de Zernio. La
  biografía no viene en esa lista y queda vacía. Una lectura que falla guarda el
  motivo (`profile_sync_error`) y **no** sella la cuenta como sincronizada.
- **Los comentarios huérfanos** (de publicaciones que todavía no estaban en el
  sistema) se vinculan cuando la publicación aparece, sin crear publicaciones
  (`adoptOrphanComments`).

### Se valida en el servidor (F77, F93)

`scheduleNetworks` valida cada red con **la misma función que el editor**
(`resolveNetworkContent` + `validateNetwork`): el mensaje es idéntico y saltearse
la pantalla no sirve. Incluye el formato elegido de cada red y que la cantidad y
el tipo de archivos coincidan (un carrusel con un archivo no se programa).

**Tope diario de TikTok:** 15 videos y 15 fotos por día, contando lo publicado y
lo ya programado para ese día en la zona del negocio (`lib/content/limits.ts`).
La fila de `social_posts` guarda `media_type` para poder contarlos.

El formato elegido en cada red completa las opciones del publicador (video o
fotos en TikTok, Short en YouTube, tipo de LinkedIn) con una sola función
(`resolveNetworkOptions`) que usan el editor, el servidor y el publicador.
**Desde Contenido v4, Instagram ya no tiene una opción de "tipo" separada**:
el publicador de Zernio decide directo con `format` (ver más abajo).

### Métricas (F79)

La lectura de métricas mira los posts de los últimos 30 días y **estira esa
ventana (hasta 90) solo si a un post ya guardado le toca su lectura semanal**,
con 6 horas de tolerancia para que el retraso del cron no se salte una semana.
Frecuencia por antigüedad: diaria hasta 30 días, semanal hasta 90, nunca después.

`LINKEDIN_API_VERSION` es `202609`, la última según la documentación de
LinkedIn (leída el 5/10/2026). **LinkedIn retira cada versión a los ~12 meses:**
hay que revisarla antes de septiembre de 2027.

### La prueba de punta a punta (F80)

`lib/publishing/e2e-zernio.test.ts` recorre guardar clave → cuentas → pieza →
media → revisar → aprobar → programar → el cron real de subida → el webhook
firmado → `published`, para Instagram y TikTok. Solo se simula el cliente de
Zernio y lo inevitable (sesión, storage, `fetch`). Hay un caso por disparador de
la sincronización: **si alguien quita uno, el test se pone en rojo**.

Se comprobó quitando cada pieza (mutación): tabla en
[PROGRESS-CV3.md](PROGRESS-CV3.md), B10.


## Contenido v4 (octubre 2026)

Lo de planificar sin cuenta conectada y marcar como publicado está en
[contenido.md](contenido.md). Acá, lo que cambió en cómo se publica de
verdad.

### Un solo campo de formato (C9)

`networks[].format` es ahora el **único** campo de formato: "Formato" y
"Tipo" eran el mismo dato duplicado (uno de F93, el otro del plano original
de la Etapa 2), y tenerlos los dos es lo que dejaba publicar un Reel como
post de feed si se desincronizaban. `options.contentType` se eliminó de la
interfaz, de los publicadores y de la validación; la migración `00126`
completó `format` desde el valor viejo donde estaba vacío.

**El publicador de Instagram (Zernio) manda exactamente lo mismo que
mandaba antes**, verificado con un test de caracterización
(`lib/publishing/zernio.test.ts`) escrito ANTES de tocar nada: solo decide
`contentType: "story"` cuando el formato es Historia; Reel, feed y
carrusel no mandan tipo, Zernio lo deduce de los archivos que recibe
(`mediaItems`), exactamente como antes.

### El publicador es de la cuenta, no de la pieza (C10)

"Publicar por" se saca de la tarjeta de cada red: el publicador efectivo es
siempre el `default_publisher` de la cuenta (F13), nunca algo elegido pieza
por pieza. Un `networks[].publisher` que una pieza vieja tuviera guardado se
descarta al guardar (`normalizeNetworks`). Solo se avisa en la tarjeta cuando
la cuenta tiene **más de un** publicador posible (hoy, solo YouTube:
Postproxy o la API oficial), con un link a Integraciones para cambiarlo.

### La sincronización adopta lo marcado a mano, nunca lo duplica

Una publicación marcada a mano (`origin = 'manual'`, ver contenido.md) no
tiene el id que le da la red. Cuando la cuenta se conecta y la
sincronización trae ese post, lo reconoce por el **link** (normalizado: el
mismo Reel con `www.` o con parámetros de rastreo sigue siendo el mismo) o,
sin link, por ser la **única** fila marcada a mano de esa red publicada
dentro de ±24 horas de la fecha real. Con dos candidatas posibles, no
adopta ninguna: nunca se adivina (`lib/metrics/adopt-manual.ts`).

### El bug de reprogramar en Zernio (arreglado de paso)

Cambiar la fecha de una red ya agendada en Zernio encolaba un "publicar
ahora" a la hora nueva **sin tocar el post que ya estaba agendado allá**: se
publicaba dos veces, una a la hora vieja y otra a la nueva. Con el
guardado automático de C6 (la fecha se guarda sola al salir del campo) esto
iba a pasar más seguido. Ahora, para una fila agendada del lado del
proveedor, reprogramar le pide a Zernio que mueva **su propio** post
(`updatePost`), igual que ya hacía "Programar" cuando la fila tenía
referencia (`lib/publishing/reschedule.ts`).
