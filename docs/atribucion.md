# Atribución

De dónde llegó cada contacto, y qué pieza de contenido lo trajo. Se construyó
en Contenido v3 (B11, F81 a F88, más F101 a F105 para mostrarlo). El plano está
en [requerimientos-contenido-v3.md](requerimientos-contenido-v3.md).

## La idea en una frase

Cada vez que pasa algo que dice "esta persona nos conoció así", se anota un
**toque**. El **primer toque** es el crédito de quien trajo al lead; el
**último** es lo más reciente. Con los toques se contesta "cuántos contactos
trajo este reel" sin adivinar.

## El vocabulario es cerrado (F81)

Sin una lista cerrada no se puede agrupar: si un contacto entra como
"instagram", otro como "IG" y otro como "Instagram DM", "cuántos leads trae
Instagram" no tiene respuesta. Cinco campos, cada uno con su pregunta
(`lib/contacts/taxonomy.ts`):

| Campo | Pregunta | Ejemplos |
|---|---|---|
| `source` | Dónde pasó | instagram, tiktok, youtube, linkedin, whatsapp, email, web, manual, csv… |
| `medium` | Cómo llegó | dm, comment, story_reply, paid_social, form, booking, import… |
| `campaign` | La campaña u oferta | texto libre |
| `content` | La pieza concreta | el título de la pieza o el inicio del caption |
| `term` | La palabra clave | texto libre |

**Lo que no está en la lista no se descarta:** se guarda crudo (en minúsculas) y
el medio queda marcado `medium_raw`, para que los agrupadores sepan que ese
valor no es uno conocido. Perder un `utm_source` raro es perder justo lo que
alguien se tomó el trabajo de etiquetar. Los alias que no dejan duda (`ig`,
`yt`, `tt`, `wa`…) se normalizan; los ambiguos no.

## Dónde vive (F82, F83)

- **`contact_touches`** (migración 00114): una fila por toque. La lee quien puede
  ver al contacto (el mismo alcance de leads de siempre: un Member ve los
  suyos). **Solo escribe el servidor.** Se borra en cascada con el contacto.
- **`contacts.attribution`**: una **copia derivada** con el primer y el último
  toque (`{ version: 2, first_touch, last_touch }`), para filtrar sin un JOIN. Se
  recalcula **desde la tabla**, nunca se edita a mano. Tiene índices por
  expresión sobre la fuente, el medio y la pieza del primer toque.
- **`record_contact_touch`** (función de la base, solo para el servicio): inserta
  el toque y recalcula primero y último. Es **idempotente** por
  `(workspace, dedupe_key)`: el mismo toque dos veces queda una sola. Como
  recalcula desde la tabla, un toque viejo que llega tarde (una relectura) queda
  en su lugar y el primero sigue siendo el primero.
- **`recordTouch`** (`lib/contacts/touch.ts`) es lo único que usa el código:
  valida con Zod, recorta `raw` a una lista blanca (**nunca** tokens ni
  secretos) y **nunca lanza**.

### Tres formas conviven, y se lee una sola

`contacts.attribution` tiene hoy la forma **canónica** (la de arriba), la de
**clicks** (`first_click`/`last_click`, del alta manual vieja) y la **plana**
del agendamiento (`utm_*`, `source: 'scheduling'`). `readAttribution`
(`lib/contacts/attribution.ts`) entiende las tres y devuelve siempre la
canónica: nadie más tiene que saber que existieron tres. Las viejas **no se
borran** (la base mezcla con `||`).

## Quién anota un toque

| Qué pasó | Toque | Clave para no duplicar |
|---|---|---|
| El contacto escribe por DM (Instagram, WhatsApp) o por email | **Solo los que suman información** (abajo) | id del mensaje |
| Alguien comenta una publicación | Sí, si es (o pasa a ser) contacto (abajo) | `comment:<id del comentario>` |
| Alta a mano | Sí | `manual:<contacto>` |
| Importación de CSV | Solo a los contactos **nuevos** (los que ya existían quedan con una entrada en su historial, no un toque) | `import:<importación>:<contacto>` |
| Reserva desde la página pública o el embed | Sí (lo hace `create_booking`, también para un contacto que ya existía) | `booking:<reserva>` |
| Reserva a mano o por el agente de IA | **No** (Agenda v2, 00129): no hay forma de saber de dónde vino el lead, y un toque inventado `web/booking` pisaría el toque real (el DM o el comentario que lo trajo) | — |
| Los contactos de antes de este bloque | Un toque por su evento de alta, solo donde la atribución estaba vacía (backfill de la 00115) | `event:<evento>` |

### De los mensajes, solo lo que suma

Un contacto activo manda cientos de mensajes y una fila "Instagram · mensaje
directo" por cada uno no dice nada: haría que el "último toque" cambie con cada
"ok". Se registra solo:

1. el **primer** mensaje del contacto,
2. una **respuesta a una historia** (de dónde vino la conversación),
3. un mensaje que trae **datos de un anuncio** (el anuncio es el origen),
4. el que **vuelve después de 7 días** sin escribir.

Lo decide una función pura (`lib/contacts/touch-inbound.ts`). **Anotar el toque
va siempre después de guardar el mensaje y dentro de un `try/catch`:** que no se
pueda anotar de dónde vino no puede ser un error del webhook.

### De los comentarios (F86)

- **Instagram no crea contactos por comentar.** Solo se vincula el comentario si
  la persona ya es contacto, o si la automatización por palabra clave la creó
  (por eso se intenta antes y después de `processComment`, que no se toca).
  Crear un contacto por cada comentarista llenaría el CRM de gente que solo
  opinó y dispararía "contacto nuevo" para cada uno.
- **TikTok sí crea un contacto anónimo** (`Unknown commenter` + su
  `tiktok_username`): no tiene mensajes directos, así que el comentario es la
  única señal que va a haber. Nace anónimo, que el sistema ya sabe ocultar de las
  listas y no cuenta como "contacto nuevo". Si después escribe por otro canal,
  `find_or_link_contact` los unifica.
- Los comentarios propios no crean contacto ni toque.
- El toque lleva `social_post_id` y `content_post_id` cuando la publicación se
  conoce, y por eso después se puede contar por publicación y por pieza.
- YouTube, LinkedIn y Threads **no** vinculan comentarios con contactos.

## Dónde se ve (F88)

- **Ficha del contacto:** el primer y el último toque en una frase que se lee
  sola ("Instagram · comentario · «cómo cobrar en dólares» · 12 sep"); con un solo
  toque se muestra una vez ("Único toque"); el camino completo va plegado. Si el
  toque trae una pieza, su nombre es un link a ella.
- **Panel de la bandeja:** la misma frase.
- **Lista de contactos:** filtros **Fuente** y **Medio** por el **primer** toque
  (`?fuente=` y `?medio=`). La pantalla lo dice: "entraron por un comentario" no
  es "alguna vez comentaron". Los valores vienen de la URL y se validan contra la
  lista cerrada; uno inventado se ignora.

## Atribución en el contenido (F101 a F105)

- **Tablero (F101):** la tarjeta y la fila de la lista muestran cuántos contactos
  tienen a la pieza como **primer toque**, solo si la pieza ya salió (sin
  publicaciones no se muestra ni un cero). El conteo se lee con el cliente de
  quien mira, así que respeta el alcance de leads.
- **Leads por comentario (F104, `lib/dashboards/piece-leads.ts`):** un lead de una
  publicación es un contacto cuyo **primer** toque fue un comentario en esa
  publicación. Reglas:
  - **Primer toque, no cualquiera:** si la persona ya era contacto (llegó por un
    DM el mes pasado), su comentario de hoy no la trajo y no cuenta.
  - **Una persona cuenta una vez por pieza**, aunque haya comentado dos
    publicaciones: se queda con donde llegó primero. Por eso el total de la pieza
    **no** es la suma de las filas.
  - **No se atribuye desde un mensaje directo por palabra clave:** no hay forma
    confiable de saber qué publicación originó un DM, y adivinarlo sería peor que
    no mostrarlo.
  - En una red que no lo mide es un **guion**, no un cero.
  Se ve en la fila de cada red y en el total del drawer de la pieza, y como
  columna **Leads** en la tabla agrupada del dashboard de contenido.

## Lo que esto NO es

- **No es atribución de seguidores.** Ninguna red informa cuántos seguidores
  trajo un post; el "salto de seguidores" de un post es una señal contra lo
  normal de la cuenta y la pantalla lo rotula así (`follower-bump.ts`).
- **No es multi-toque ponderado.** Hay primer y último toque; no un reparto del
  crédito entre todos.
- **No cubre lo que no pasó por el sistema:** una persona que vio un reel y
  escribió semanas después por WhatsApp sin que nada la una a la pieza tiene
  como primer toque el mensaje.

## Verificación

```
node scripts/verify-attribution.mjs   # 39 checks contra la base real
node scripts/verify-scheduling.mjs    # incluye el toque de la reserva
node scripts/verify-crm.mjs
```

`verify-attribution` prueba la lectura cruzada entre negocios y el alcance de
un Member, la idempotencia por `dedupe_key`, primer y último toque con un toque
fuera de orden, que el `source` que leen los triggers sea el de antes para un
contacto viejo, y que `create_booking` escribe la forma canónica. Crea y limpia
sus datos (prefijo `zz-test-`) y no se corre a la vez que otro `verify-*`.

## Extra L: que no se pierda nada, y el vinculo con los anuncios de Meta

Construido en el Extra L (AT1 a AT3). Avance y decisiones: `docs/PROGRESS-atribucion.md` y `docs/PENDIENTE-atribucion.md`.

### Toques nuevos y datos que ya no se pierden (AT1)

- **Agenda** (`create_booking`, 00190): el toque de una reserva ahora lleva `ad_id`, `adset_id`, `campaign_id` y, en `raw`, `utm_id`,
  `placement`, `fbp`, `fbc`, `ga_client_id` y la primera visita. El navegador manda todas las claves de `lib/attribution/keys.ts` (no solo
  cinco UTMs) y completa la cookie `ssa_attr`; el embed de la agenda hereda la atribución guardada (`attr`, solo si hay).
- **Formularios**: ya no inventan un `utm_content` con el nombre del formulario; la ficha lo muestra desde `raw.source_id`.
- **Chat** (`messages.origin_context`, 00189): la mención en una historia, el mensaje que viene de un anuncio (Instagram y clic a WhatsApp) y la
  respuesta a una historia quedan registrados. `story_mention` es un medio nuevo («Mención en historia»). Los flujos pueden filtrar
  «Solo si vino de un anuncio» / «Solo menciones en historias» y leer `{{message_origin.ad_id}}`, `{{message_origin.ad_title}}` y
  `{{message_origin.is_story_mention}}`. Un comentario en un anuncio genera un toque `paid_social` con el id del anuncio.
- **Webhooks**: un toque `origin = webhook` (ver `docs/webhooks.md`).

### El catalogo de Meta (AT2)

`meta_campaigns`, `meta_adsets` y `meta_ads` (00191) guardan nombre, estado efectivo, creativo y la publicacion que promocionan. El sync de
anuncios trae **primero el catalogo** (incluidos pausados, archivados y borrados), independiente de las metricas; un tope de 50 paginas o el
limite de uso de Meta cortan el sync y lo anotan en la cuenta (`last_error`), nunca en silencio. Las miniaturas se copian al bucket privado
`ad-creatives`. Un anuncio que promociona una publicacion de Instagram se enlaza solo con su `social_posts` y su pieza (el enlace manual no se pisa).

### El vinculo de cada toque con su campaña, conjunto y anuncio (AT3)

Cada toque nuevo pasa por el trigger `contact_touches_meta_match` (BEFORE INSERT, **nunca hace fallar el insert**) que llama a
`resolve_meta_match` y deja `meta_campaign_id`, `meta_adset_id`, `meta_ad_id`, `meta_match_status` (`none` · `matched` · `unmatched` · `manual` ·
`ignored`), el metodo y el motivo. El orden: **anuncio** (`ad_id` → `utm_content` igual a un id → `utm_content` como nombre; con varios homonimos se
desempata por la campaña, y si siguen varios NO se vincula) → **conjunto** → **campaña** → coherencia (si el anuncio es de otra campaña, gana el anuncio).

- La funcion SQL tiene una **gemela en TypeScript** (`lib/attribution/meta-match.ts`) y los **mismos casos** (`meta-match.cases.json`) corren contra las dos.
- **Solo cuentan como datos de Meta** los ids y el `fbclid`, y `campaign`/`content_label`/`term` cuando el toque puede traer UTMs de verdad (agenda,
  formulario, webhook, importado, manual) o ya trae un id de anuncio. En un comentario o un DM organico, `content_label` es el titulo de la publicacion.
- Despues de cada sync, `rematch_meta_touches` vuelve a resolver los toques sin vincular de los ultimos 90 dias (si llega el anuncio que faltaba).
  Nunca toca lo `manual` ni lo `ignored`.
- **«Sin vincular»** (`/dashboard/dashboards/ads/sin-vincular`): lista los toques sin vincular con el motivo en palabras; se puede vincular a mano
  (completa conjunto y campaña), ignorar o quitar el vinculo manual. Cada accion queda en el historial del contacto (`attribution.meta_*`).
- **La ficha del contacto** muestra campaña › conjunto › anuncio por nombre, con miniatura, y como se vinculo.
- `contacts.attribution` sigue siendo una copia derivada: `refresh_contact_attribution` la recalcula con el mismo orden que `record_contact_touch`.

### El anuncio de origen, recuperado de la conversación de Zernio (Tirón 2, A1)

Meta manda los datos del anuncio (`referral`) **solo en el primer mensaje** después del clic. Si ese mensaje llegó sin ellos, el toque quedaba
como un mensaje directo orgánico. Ahora, con el **primer mensaje entrante de una conversación de Instagram que no trae anuncio**, el webhook
encola el job `zernio_ad_origin` (clave `zernio-ad-origin:<conversación>`, una vez por conversación, a los 20 s) y:

1. le pregunta a Zernio por la conversación (`getInboxConversation`, `metadata.meta_ad_id`, `meta_ad_title`, `meta_ad_post_id`);
2. si trae un anuncio: lo suma a `messages.origin_context` y completa el toque del mensaje con `enrich_touch_ad_origin` (00221): le pone el
   `ad_id`, el título como `content_label`, el medio `paid_social`, deja en `raw.referral` que salió de `zernio_conversation`, lo vincula con el
   catálogo y recalcula la atribución del contacto. Si el contacto ya existía y no tenía toque de ese mensaje, anota uno con el anuncio;
3. si Zernio no trae nada, no hace nada.

Reglas: **solo Instagram** (WhatsApp va por Evolution y su `ctwa_*` ya viene en el mensaje); nunca pisa un anuncio que el toque ya tenía ni un
vínculo `manual` o `ignored`; nunca lanza (ante un fallo de Zernio reagenda a 1, 5 y 15 minutos; un 401/404 no se reintenta); sin catálogo
todavía el toque queda `unmatched` con su `ad_id` y el re-vínculo lo resuelve después del próximo sync.

### Vínculo anuncio ↔ pieza de Contenido, a mano (Tirón 2, A2)

El vínculo automático (`lib/meta/content-link.ts`) no cambió y **nunca pisa un vínculo manual** (`content_link_manual = true`). El manual vive
**solo en dos menús «⋯»**: en el detalle de un anuncio («Vincular a una pieza de contenido» / «Desvincular») y en el detalle de una pieza
(«Vincular a un anuncio» / «Desvincular»). Permiso: `content.create` **y** `dashboards.ads.view`; cada cambio queda en `audit_log` (entidad
`meta_ad`, acciones `content_link.linked` y `content_link.unlinked`, con el antes y el después). Desvincular vacía los ids y vuelve a
`content_link_manual = false`: el automático lo puede volver a intentar en el próximo sync.

- En el detalle de una pieza con **al menos un anuncio vinculado** aparece la sección **«Publicidad»** (período elegido, «Histórico» por defecto):
  gasto, impresiones, clics, leads nuevos y totales, CPL nuevo y total, agendas, ventas y la lista de anuncios con enlace. Los leads, agendas y
  ventas salen de `ads_crm_metrics_v2` (la misma función de la tabla Meta vs CRM); si los anuncios son de cuentas con monedas distintas, el gasto y
  el CPL no se calculan y se avisa. Sin anuncio vinculado, el detalle queda exactamente como antes.
- En la lista de Contenido, las piezas con anuncio llevan el indicador **«Pautada»** y hay un filtro «Pautadas / No pautadas» (`?pautada=si|no`).
  Solo lo ve quien puede ver anuncios (la RLS de `meta_ads` pide `dashboards.ads.view`).

### Guia: parametros de URL para los anuncios

Para que un anuncio quede vinculado, la URL de destino tiene que llevar (en el Ads Manager, «Parametros de URL»):

```
utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}
```

`{{campaign.id}}`, `{{ad.id}}` y `{{adset.id}}` los reemplaza Meta por los ids; con ids el vinculo es exacto. Con nombres (`{{campaign.name}}`,
`{{ad.name}}`) tambien funciona, pero un nombre repetido queda ambiguo y va a «Sin vincular».

## La URL de entrada completa (`entry_url`, octubre 2026)

Hasta acá se guardaba solo lo que el vocabulario cerrado reconoce (UTM, ids de clic, ids del anuncio). Lo que el anuncio mandaba y no estaba en la lista (`ad_name`, `campaign_name`, `site_source_name`, un `?ref=podcast` propio) se perdía. Ahora **la dirección completa por la que entró la persona se guarda entera**.

- **Qué se guarda** (`lib/attribution/entry-url.ts`, `entryUrlFrom`): solo `http`/`https`, con todos los parámetros en su orden y su codificación originales. **Se sacan** los que identifican a una persona (`lib/attribution/sensitive-params.ts`: tokens, claves, contraseñas), los internos del sistema (`embed`, `attr`, `preview`, `c`, `referrer`), el `#`, las credenciales y los caracteres de control. Tope de 2000 caracteres (nunca corta un `%` a la mitad).
- **De dónde sale:** de la página de llegada. Si la visita de ahora trae UTM o ids de clic, gana la de esta visita; si no, la de la última visita guardada; si no hay ninguna, la de la página. En un embed, la página que lo contiene manda la URL **entera** dentro de `attr` (su tope subió de 2048 a 4096 bytes) y gana sobre el `referrer`, que llega cortado a 500.
- **Dónde queda:** `form_submissions.attribution.entry_url` (en cada respuesta, ya sanitizada de nuevo en el servidor), `contact_touches.entry_url` (migración 00215; `record_contact_touch` la escribe sin cambiar su firma ni su comportamiento) y, para la Agenda, `bookings.utm.entry_url` (de ahí pasa al toque por `raw.utm`, sin tocar `create_booking`).
- **Dónde se ve:** el detalle de una respuesta ("De dónde vino") y las visitas del contacto, con un bloque monoespaciado que parte líneas y un botón Copiar. El CSV de respuestas **no** suma una columna (queda anotado en PENDIENTE).
- **Lo que NO cambia:** `landing_page` y `page_url` siguen filtradas (solo claves de atribución / sin query); la lista de claves es la de siempre (`lib/attribution/keys.ts`) y `contacts.attribution` sigue siendo una copia derivada que no incluye la URL completa.
- **Nunca se loguea** una URL de entrada: puede traer datos de la campaña que no tienen por qué quedar en los logs.

## Atribución orgánica (Extra I, octubre 2026)

Qué **contenido** trajo a cada persona, y por qué canal. Plano: `claude/v11/requerimientos-extra-i.md`; avance y decisiones en `docs/PROGRESS-extra-i.md` y `docs/PENDIENTE-extra-i.md`.

### El canal de un toque (00230)
Cada toque tiene `channel`: **organic**, **paid**, **referral** o **direct**. Lo calcula un trigger (`contact_touches_zz_channel`) con `public.touch_channel(...)`, gemela de `lib/attribution/channel.ts`; los casos compartidos (`channel.cases.json`, 54) corren contra las dos. Orden: pauta (cualquier id de anuncio, `gclid`, `ttclid`, `li_fat_id`, `ctwa_clid` o un medio de pago; `fbclid` SOLO no alcanza porque Meta lo agrega a clics orgánicos) → referido (`medium = referral_person`) → orgánico (hay pieza o publicación, un medio orgánico, o un DM de una red social) → directo. **`record_contact_touch` no escribe el canal** (está protegida): siempre sale del trigger, a partir del `medium` y los ids que traiga el toque. Un link orgánico con UTMs y pieza queda con el vínculo de Meta en `ignored / organic_content`, así no aparece en «Sin vincular».

### El código de la pieza
`content_posts.attribution_code` (`c` + 5 caracteres `[a-z2-9]`, único por workspace, lo completa un trigger). Un toque cuyo `utm_content` es ese código (decodificado, sin importar mayúsculas) queda vinculado a la pieza (y a la publicación si hay UNA sola en esa red). El drawer de la pieza muestra el código con «Copiar» y «Armar un link».

### Comentarios, historias y mensajes con pieza
- **Comentarios que crean contactos:** Ajustes > General > Atribución. Instagram apagado por defecto (solo vincula si ya es contacto), TikTok prendido (contacto discreto). Cuando un contacto gana su usuario de Instagram o TikTok, el job `comment_backfill` vincula sus comentarios viejos (con la fecha del comentario) y puede volverse su primer toque. El trigger que lo encola es la **00234** (después del merge); su función ya está.
- **Respuesta a una historia propia:** el toque lleva la publicación y la pieza si `social_posts.external_post_id` coincide (una sola fila; defensivo, pendiente de confirmar en vivo).
- **Variables de pieza** en los flujos (`{{content.title}}`, `{{content.code}}`) para comentarios, historias propias, anuncios vinculados a una pieza y respuestas a un DM de automatización.
- **Herencia de pieza:** un DM de una automatización que salió de una pieza guarda `origin_context.content`; si la persona responde dentro de `content_inherit_days` (7 por defecto) la respuesta hereda la pieza y deja UN toque (`content-reply:<id del DM>`). Un anuncio en el mensaje gana a la herencia.
- **Chip «Vino de…»** en la bandeja y **línea de tiempo** de toques en la ficha (con las marcas Primer toque, Último toque y Último con origen).

### Links con parámetros y con seguimiento (nodo «Enviar mensaje»)
`attribution: { append, trackClicks }` a nivel nodo. Con `append`, cada link del mensaje ya adaptado a la plataforma (texto, botones URL, carrusel; en WhatsApp los botones ya bajaron a texto) sale con `utm_source` (la red), `utm_medium=dm`, `utm_campaign` (slug del flujo) y `utm_content` (el código de la pieza, o `f-` + 8 del id del flujo); **nunca pisa** un parámetro que el link ya trae, conserva el `#hash` y no toca `wa.me`, `m.me`, `instagram.com`. Con `trackClicks` (y contacto), el link sale como `<app>/l/<token>`: una ruta pública que registra el clic como un toque `link_click` (uno por día, persona y pieza) y redirige. El destino sale **solo del token firmado** (HMAC, secreto `attribution_link_secret` por workspace en Vault, vence a los 180 días): no hay `?to=`, no es un open redirect, un token alterado cae a la app, los previsualizadores (WhatsApp, Facebook, Slack…) redirigen sin registrar y hay un tope de 120 pedidos por minuto y por IP. Con el interruptor apagado el mensaje es **idéntico** al de siempre (`send-message-characterization.test.ts`).

### La venta
La atribución de la venta sugiere el último toque **con origen** cuando el último fue directo; «Cargar a mano» es un selector de canal (contenido orgánico con buscador de piezas, anuncio del catálogo de Meta, referido, evento, otro) que crea un toque `manual` (con `create_sale` en modo `touch`, que no se tocó); la ficha tiene «De dónde vino» (con el responsable de la pieza leído en vivo) y la lista de ventas una columna «Origen» y filtros por canal y por pieza.

### Varias cuentas de la misma red (16/10/2026)
Zernio permite conectar más de una cuenta por red (dos Instagram, por ejemplo); cada una es una fila de `channels` y cada conversación guarda su `channel_id`. Lo que se sumó para diferenciarlas, **sin migración**:

- **Bandeja:** el menú **Canal** (`InboxChannelMenu`) lista una opción por cuenta, agrupadas por red y con selección múltiple (`?cuenta=<id>,<id>`; el `?canal=` viejo sigue funcionando). La lista de conversaciones y el encabezado del hilo dicen la cuenta ("@marca_academia", "Vía @marca_academia") y el panel del contacto dice "· vía @cuenta" — **solo cuando esa red tiene más de una cuenta**: con una sola no hay nada que diferenciar. Las reglas son puras (`lib/inbox/accounts.ts`).
- **Atribución:** cada toque que entra por una cuenta nuestra guarda en `contact_touches.raw` `account_id` (la clave de la cuenta en el proveedor: `channels.late_account_id`) y `account_label` (el nombre al momento del toque). Lo guardan los mensajes directos de los tres receptores (Zernio, Evolution y email), los comentarios y el toque del anuncio de origen. Se ve en la ficha y en la línea de tiempo ("Instagram · Mensaje directo · @marca_academia"). Los toques anteriores no la tienen, y el vínculo retroactivo de comentarios (`comment_backfill`) tampoco la conoce.
- `contact_touches.raw` ya tenía lista blanca (`RAW_KEYS`): las dos claves nuevas están ahí. `record_contact_touch` no se tocó. Si más adelante hace falta filtrar o agrupar métricas por cuenta, el paso siguiente es una columna propia (`channel_id`) con su migración.

### Verificación
```
node scripts/verify-organic-attribution.mjs                   # paridad del canal, códigos, triggers, errores forzados, relleno
node scripts/verify-organic-attribution.mjs --despues-de-00234
```

## Contactos importados (CSV)

- **Un contacto nuevo** queda con un toque de origen **"Importación"** (`origin = 'import'`). Si la planilla no trae datos de
  atribución, la fuente es `csv`, el medio `import`, la fecha es la de la importación y el canal sale **Directo**. En la ficha se ve
  "Importación · importación · fecha"; filtrando la lista por fuente `csv` aparecen todos los importados. No cuenta como lead de ningún
  anuncio ni pieza de contenido. Si después escribe por un canal, el primer toque sigue siendo la importación.
- **Columnas de atribución opcionales**: fuente, medio, campaña y "fecha del primer contacto" (`ATTRIBUTION_TARGETS`, `lib/csv/map.ts`).
  Si vienen, el toque las lleva (`importTouch`) y el canal se calcula con ellas (un medio `cpc` es Pauta); el origen sigue siendo
  "Importación". La fecha queda al mediodía UTC de ese día (ninguna zona horaria la corre al día de al lado) y no puede ser futura.
- **Un contacto que ya existía** no recibe un toque (la importación no fue su origen) ni cambia su atribución: queda una entrada en su
  historial ("lo encontró en la importación «archivo.csv»") con los datos que se completaron.
- No hay un canal "Importación": el canal es una clasificación de cuatro valores con gemela SQL/TS y reglas de comisiones; el origen ya
  distingue a un importado.
