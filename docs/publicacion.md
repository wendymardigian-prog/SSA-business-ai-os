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
[docs/PENDIENTE.md](PENDIENTE.md).

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
