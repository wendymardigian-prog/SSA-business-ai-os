# Contenido

Del "tendríamos que hacer un reel sobre esto" hasta el post publicado, en un
solo lugar.

## El recorrido

Una **idea** es una anotación: un título y un texto libre (`content`). Sirve
para que lo que se pensó un martes no se pierda. Desde Contenido v3 el gancho,
el ángulo y las notas son **un solo campo de texto**; ver "Contenido v3" al final.

Cuando una idea se aprueba, se convierte en una **pieza**. La pieza es lo que
se produce: el guion, el caption, la media y en qué redes va. Su estado se
mueve por el tablero:

```
Borrador → En producción → En revisión → Aprobada → Programada → Publicada
```

Los últimos tres no se arrastran a mano: los pone el sistema según cómo salió
cada red — **incluida una publicación marcada a mano** (Contenido v4). Una
pieza que salió en Instagram y falló en TikTok queda **"Publicada en
parte"**, que es la verdad, en vez de "publicada" o "falló". El chip de
estado del drawer se tiñe con el color de cada estado; cuando es uno de
estos cuatro, el dropdown se bloquea con el aviso "Lo definen las redes".

## Quién hace qué

| | Member | Owner / Admin |
|---|---|---|
| Crear y editar sus piezas | Sí | Sí |
| Mandar a revisión | Sí | Sí |
| Moverla entre Borrador, En producción y En revisión | Sí, la suya | Sí, cualquiera |
| Aprobar y devolver | No | Sí |
| Programar y publicar | No | Sí |
| Generar con IA | No | Sí |

Desde la Etapa 2 esto se puede cambiar: un rol personalizado le puede dar a
alguien `content.publish` sin darle nada más. Ver [roles.md](roles.md).

**Devolver una pieza siempre lleva un comentario.** Es obligatorio, no una
cortesía: una pieza que vuelve sin motivo obliga a preguntar por otro lado, y
el trabajo se para hasta que alguien conteste.

## Las tres vistas

**Tablero**: las columnas del recorrido. Se arrastra, y si un movimiento no
corresponde la tarjeta vuelve a su lugar diciendo por qué.

**Calendario**: qué sale qué día. Tiene dos modos, *Piezas* y *Publicaciones*:
una pieza que va a tres redes es una tarjeta en el primero y tres en el
segundo. En el celular se ve como agenda, porque una grilla de siete columnas
en una pantalla de teléfono no se lee.

**Lista**: para filtrar y ordenar cuando hay muchas.

## Una pieza, varias redes

El caption y la media son de la pieza. Cada red puede tener **su propia
variante**: otro caption, otra media, otro llamado a la acción. Sigue siendo
una sola pieza con un solo estado; lo que cambia es lo que sale en cada lado.

Cada red tiene además **su propia fecha**. Publicar el reel el martes a las
19 y el carrusel de LinkedIn el miércoles a las 9 es una sola pieza con dos
fechas, no dos piezas.

Las horas se muestran en formato de 24 horas a propósito. "15:00" no se puede
confundir; "03:00 p. m." sí, y programar una publicación doce horas antes es
un error caro.

## Planificar en redes sin conectar (Contenido v4)

Cualquiera de las cinco redes se puede agregar a una idea o a una pieza, esté
conectada o no. Las que no tienen cuenta llevan el chip **"a mano"** y se
configuran completas igual: formato, archivos, caption y fecha. Esa fecha
queda siempre **tentativa**: entra al calendario para planificar, pero nada
se publica solo.

Cada red declara además **cómo se publica**: "La subo yo" (la fecha queda
tentativa) o "El sistema la publica" (programa de verdad, F25 sin cambios).
La segunda opción solo se puede elegir con la cuenta conectada y la pieza
aprobada.

**Estado de cada red**, de un vistazo: Sin fecha, Fecha tentativa, Programado
(resaltado, con barra de color), Publicado y Falló. Distinguir Programado de
Fecha tentativa es lo más importante de toda la pantalla: la diferencia entre
"esto sale solo" y "esto lo tengo que subir yo".

**Marcar como publicado** registra lo que se subió por fuera de la app: crea
una publicación real (no un flag cosmético), que entra al calendario, a
Social y al rendimiento de la pieza igual que una automática. Si después la
cuenta se conecta y la sincronización encuentra el post real, lo completa en
esa misma fila, nunca la duplica. Deshacerlo se rechaza si la fila ya trajo
métricas o comentarios.

## El editor

> Desde Contenido v3 el editor y el detalle son **el drawer de la pieza**
> (`?piece=<id>` en el tablero): ver "Contenido v3" al final. Lo de abajo
> describe cómo se guarda y qué se valida, que sigue valiendo.

Una pieza se escribe con **guion**, **caption** y **redes**. Cada red es una
tarjeta que se abre; cerrada muestra su estado, su fecha y si le falta algo.

Se guarda solo: un dropdown o un chip al elegir, un campo de texto al salir
(blur), y siempre antes de cerrar (Contenido v4, C6 — ver "Guardado
automático y versiones" más abajo). No hay botón de guardar.

### Palabras clave

Si el caption dice *"comentá SISTEMA y te mando la guía"*, eso solo funciona
si hay una automatización escuchando esa palabra en esa red. El editor lo
comprueba mientras se escribe y lo dice.

Es una **advertencia, nunca un bloqueo**: puede haber un motivo para poner la
palabra antes de armar el flow. Cuando falta, el aviso trae un botón que abre
el editor de flows con la palabra, el tipo y la red ya puestos.

Y al publicar, el sistema **completa solo** el id del post en esa
automatización. Antes había que volver a entrar al flow y pegarlo a mano.

### Generar con IA

El botón escribe el guion y los captions a partir del título, el formato y
las redes elegidas. Usa el proveedor de IA del negocio (tu cuenta, tu
factura) y respeta los topes de gasto: si el workspace llegó al tope, no
llama al modelo.

Lo generado queda marcado como **sin revisar** hasta que alguien lo apruebe.
Aprobar es justamente esa revisión.

La **voz de marca** (cómo escribe el negocio, a quién le habla, ejemplos y
qué evitar) se configura una vez en Ajustes → Tareas en segundo plano, y se
usa en todas las generaciones.

## Guardado automático y versiones (Contenido v4, C6)

Todo se guarda solo, sin ningún botón: un dropdown, un chip o un toggle
guardan al elegir; un campo de texto, al salir (blur), nunca por tecla. El
drawer también guarda antes de cerrar (✕, Esc, clic afuera) y antes de abrir
el historial. **Guardar el dato no es guardar una versión**: son dos cosas
distintas, y confundirlas es lo que hacía que el historial de una tarde de
edición tuviera treinta entradas en vez de tres.

**Una versión no es por cada cambio, es por sesión de edición.** El primer
cambio después de 10 minutos sin tocar esa pieza abre una versión nueva, con
motivo "edición". Cada cambio siguiente, de la misma persona y dentro de esa
ventana, **actualiza esa misma fila** (el contenido se reemplaza, el número
de versión no cambia). La sesión es por autor: si otra persona edita, su
primer cambio abre la suya, aunque hayan pasado solo dos minutos.

Cuatro eventos siempre cortan la sesión y dejan su propia versión, con su
motivo: cambiar el estado, aprobar (separado de un cambio de estado
cualquiera), generar con IA y restaurar.

Restaurar **no borra nada**: guarda lo actual como una versión más y después
escribe lo viejo. El camino de vuelta siempre existe.

Se conservan hasta 50 por pieza.

## Media

Se sube directo al almacenamiento, sin pasar por el servidor. Los archivos de
más de 6 MB van por partes, así que un video de 800 MB no se corta si la
conexión falla un segundo.

El tipo de archivo se verifica **por su contenido**, no por su extensión: un
`.exe` renombrado a `.mp4` no entra.

La media de las piezas ya publicadas se borra a los 30 días (configurable, y
0 significa nunca). El post ya está en la red; la copia local es peso.

## Publicar

Programar una red crea una publicación agendada. A su hora, el sistema
publica y anota cómo salió.

Si algo falla, **reintenta al minuto, a los 5 y a los 15**, pero solo si tiene
sentido: un corte de red se reintenta, una cuenta desconectada no. Reintentar
tres veces contra una cuenta desconectada solo retrasa el aviso.

Mientras quede un reintento, la pieza sigue diciendo "programada", que es la
verdad. "No salió" aparece recién cuando ya no se intenta más, y llega un
aviso a la campana.

Hay una guarda contra publicar dos veces: la base decide qué corrida se lleva
la publicación. Publicar dos veces no se puede deshacer.

Ver [publicacion.md](publicacion.md) para el detalle de cada red.

## Correcciones de la Etapa 2 (27/9/2026)

Lo que cambió en contenido después de la revisión, con el detalle en
[docs/correcciones-etapa2.md](correcciones-etapa2.md) y el avance en
[docs/etapa2/PROGRESS-correcciones.md](etapa2/PROGRESS-correcciones.md).

### Crear

Anotar una idea y crear un post son **modales sobre el tablero**, no páginas
aparte. "Crear y abrir" lleva al editor, que es a donde se iba a ir igual.
"+ Idea" y "+ Post" están también al pie de sus columnas, donde termina lo
que ya hay.

La idea tiene **detalle**: hook, ángulo, formato, pilar, referencia, quién la
propuso, y una caja que explica qué pasa al aprobar. Los dos botones se veían
iguales y nadie sabía en qué se diferenciaban. Se puede editar mientras está
en la columna Ideas. Descartar vive ahí, con su motivo, y no en la tarjeta.

### El editor

- **Enviar a revisión, aprobar, devolver y archivar** funcionan. Antes
  contestaban "eso se hace desde el detalle" y el detalle mandaba al editor.
- **Pie fijo** con "X de N redes con fecha", "Guardado hace X s" y los
  botones. Antes estaban arriba y en una pieza larga quedaban fuera de
  pantalla.
- **Estado del material** (Sin grabar, Grabado, Editado, Listo). Sin esto una
  pieza nunca pasaba a "En producción".
- **La fila de cada red** tiene ahora CTA y palabra clave, el chip de la
  automatización con "Ver flow" o "Crear automatización", media propia
  (variante), "Publicar por", y las opciones que cada red exige: el tipo en
  Instagram, la privacidad y las dos confirmaciones en TikTok, la visibilidad
  en YouTube. Sin esas opciones TikTok no publicaba y YouTube salía privado.
- **Vista previa** de la red abierta, con el caption recortado donde lo
  recorta la red.
- **Palabras clave detectadas** bajo el CTA, marcando cuáles disparan una
  automatización de verdad.

### Las fechas son de la zona del negocio

El editor convertía con la zona del navegador: alguien que viaja programaba a
una hora distinta de la que veía. Ahora usa `workspaces.timezone` y la muestra
al lado del campo.

### El copy lo escribe un agente

La generación simple se reemplazó por el **copywriter** (ver
[docs/agente-ia.md](agente-ia.md)). Corre en segundo plano: el botón contesta
al instante y la pieza dice "el copywriter está escribiendo" hasta que
termina.

## Contenido v3 (octubre 2026)

Cinco bloques (B10 a B14, F73 a F105) con el plano en
[requerimientos-contenido-v3.md](requerimientos-contenido-v3.md) y el avance en
[PROGRESS-CV3.md](PROGRESS-CV3.md). La parte de publicar está en
[publicacion.md](publicacion.md) y la de atribución en [atribucion.md](atribucion.md).

### El modelo de la pieza

- **La idea tiene un solo texto** (`content_ideas.content`): lo que antes eran
  gancho, ángulo y notas. Las columnas viejas las borró la migración `00118`
  (aplicada el 6/10/2026).
- **La pieza tiene `script` (el guion para grabar) y `recording_notes`** en vez
  de `copy`. Aprobar una idea (`approve_content_idea_v2`) copia la clasificación
  y las plataformas; el guion y las notas arrancan **vacíos**: el texto de la
  idea es contexto, no el guion.
- **Las versiones viejas** del historial guardan `copy` dentro del jsonb. Se
  normalizan al leer, comparar y restaurar (`lib/content/legacy.ts`), así que no
  hace falta migrarlas.
- **Clasificación** de idea y pieza: formato, oferta, pilar, etapa del embudo
  (Descubrimiento, Consideración, Decisión) y referencia. La oferta y el pilar
  se eligen de una lista que se administra en **Ajustes → Contenido**
  (`settings.manage`): se crean, se renombran y se **archivan**; no se borran,
  porque una pieza vieja seguiría siendo de esa oferta.
- **Autor y fechas** visibles en la idea, la pieza, el kanban y la lista.

### Archivos y formato por red

`media` es la **biblioteca** de la pieza. Cada archivo tiene `id`, nombre,
dimensiones y duración, y se ve qué redes lo usan (o "Sin usar"). Cada red
elige su **formato** (Instagram: Reel, Carrusel, Imagen, Historia; TikTok: Video,
Carrusel de fotos; YouTube: Video, Short; LinkedIn: Solo texto, Imagen, Carrusel
PDF, Video; Threads: Solo texto, Imagen, Carrusel, Video) y **qué archivos usa,
en orden** (↑ ↓ para mover; no se arrastra, para que se pueda con teclado).

La misma función valida en el editor y en el servidor: un carrusel con un solo
archivo no se programa aunque alguien se saltee la pantalla. Una red sin formato
sigue el modelo anterior (usa toda la biblioteca, sin chequeo de formato).

### Los drawers

El tablero abre **drawers** en la URL: `?idea=<id>` y `?piece=<id>`. Se comparte
con un link y "atrás" lo cierra. Al cerrar, el foco vuelve a la tarjeta de origen.

- **Idea** (~560 px, galería con "N de M"): todo editable al abrir, con
  autoguardado. Descartar y Aprobar pasan a la siguiente idea; **✦ Aprobar y
  producir copy** abre la pieza generada en el mismo drawer.
- **Pieza** (~900 px; pantalla completa en el celular): guion, notas de grabación,
  clasificación, archivos, caption base, una tarjeta por red, estado por red y,
  si ya salió algo, el **rendimiento** (abajo). El estado es un desplegable con
  las transiciones permitidas. **Sin vista previa del teléfono**, a propósito.
- **Historial** detrás del botón de reloj, en el mismo drawer.
- `/dashboard/content/<id>` y `/dashboard/content/<id>/edit` redirigen a
  `?piece=<id>`; una pieza que no existe sigue dando el 404 de siempre.

La barra superior es una sola: vistas, conteo (solo calendario), filtro de Red
(vale para las tres vistas), el ⓘ con lo que puede hacer **ese** rol y las dos
altas. Lo que se ve y se puede tocar sale de **permisos** (`content.approve`,
`content.publish`, `content.ai`), no del cargo.

### Social

El perfil muestra las cifras reales que lee la sincronización (una cifra que la
red no dio es un guion, nunca un cero) y **avisa si la última lectura falló**,
sin esconder lo último que se leyó. Arriba de la grilla, **"Próximas"**: lo
programado y lo tentativo de esa red; al tocar, abre la pieza. LinkedIn es una
lista de lo publicado desde el sistema, con el aviso de que no entrega métricas.

### Medir una pieza (B14)

El drawer de una pieza publicada muestra **una fila por red** y un total
(`lib/dashboards/piece-performance.ts`, todo puro y con test):

| Columna | Qué es |
|---|---|
| Edad | Días desde que salió **esa** publicación. |
| Alcance | El alcance acumulado; si la red no da alcance, las vistas (lo dice). |
| Interacciones | Me gusta + comentarios + compartidos + guardados, los que la red dé. |
| Engag. 7 días | Interacciones sobre alcance, congelado a los 7 días (`engagement_d7`). |
| Índice | Contra lo normal de esa red y ese formato (abajo). |
| Leads | Contactos que llegaron por un comentario (abajo). |

Reglas que atraviesan la tabla:

1. **Se compara por edad, nunca por fecha.** Un Reel de 10 días y un Short de 3
   no se ponen lado a lado con los números de hoy. Debajo de la tabla van los
   dos **al día de la más joven** ("A la misma edad (día 3)").
2. **Nunca se inventan ceros.** Lo que la red no entrega es un guion. LinkedIn
   no entrega ninguna métrica con esta conexión: su fila muestra el aviso.
3. **Las sumas del total son contexto, no ranking.** Sumar el alcance de un Reel
   con las vistas de un Short no mide nada. El ranking es el índice.

**El índice** (`lib/dashboards/piece-index.ts`): el engagement a 7 días de la
publicación dividido por la **mediana** del de las publicaciones de la misma red
y el mismo formato (`social_posts.media_type`) de los **90 días anteriores** a
ella. `1,8×` es casi el doble de lo normal; verde desde `1,5×`, rojo por debajo
de `0,8×`. Es el mismo criterio de mediana que el salto de seguidores
(`follower-bump.ts`). Con **menos de 3** publicaciones comparables no hay índice:
"Base insuficiente", con los números crudos a la vista. Una publicación sin
`engagement_d7` y con menos de 7 días está **"En curso"** y queda fuera del
promedio; con más de 7 días y sin dato dice "Sin dato" (no "en curso" para
siempre). El índice de la pieza es el promedio de los de sus publicaciones que lo
tienen. La ventana termina el día de la publicación, no hoy: así el índice no
cambia cada día que pasa.

### El dashboard de contenido agrupa y filtra por la pieza

`/dashboard/dashboards/content` suma una tabla **"Rendimiento por …"** que se
agrupa por pieza, oferta, pilar, etapa del embudo, red o formato (`?agrupar=`), y
cinco filtros (`?oferta=`, `?pilar=`, `?embudo=`, `?formato=`, `?pieza=`) que
acotan **todo** el dashboard, también el periodo anterior contra el que se
compara. Tocar un grupo de la tabla filtra por él.

- **Nada se pierde:** toda publicación cae en exactamente un grupo, y la suma de
  las filas es el total. Una pieza sin oferta, o lo publicado a mano, va a **"Sin
  asignar"** (siempre al final). Los totales de una oferta son la suma de sus
  piezas.
- **Red y formato son los de cada publicación**, no los de la pieza: una pieza
  que fue Reel en Instagram y video en TikTok agrupa en las dos filas.
- **Los seguidores no se filtran:** son de la cuenta, no de una pieza.
- **Leads:** contactos cuyo **primer** contacto fue un comentario en esas
  publicaciones. Solo Instagram y TikTok lo miden; en otra red es un guion, no un
  cero.
