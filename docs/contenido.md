# Contenido

Del "tendríamos que hacer un reel sobre esto" hasta el post publicado, en un
solo lugar.

## El recorrido

Una **idea** es una anotación: un título y, si hay, el gancho y el ángulo.
Sirve para que lo que se pensó un martes no se pierda.

Cuando una idea se aprueba, se convierte en una **pieza**. La pieza es lo que
se produce: el guion, el caption, la media y en qué redes va. Su estado se
mueve por el tablero:

```
Borrador → En producción → En revisión → Aprobada → Programada → Publicada
```

Los últimos tres no se arrastran a mano: los pone el sistema según cómo salió
cada red. Una pieza que salió en Instagram y falló en TikTok queda
**"Publicada en parte"**, que es la verdad, en vez de "publicada" o "falló".

## Quién hace qué

| | Member | Owner / Admin |
|---|---|---|
| Crear y editar sus piezas | Sí | Sí |
| Mandar a revisión | Sí | Sí |
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

## El editor

Una sola pantalla, en cuatro secciones: **Copy**, **Caption**, **Media** y
**Redes**. Cada red es una fila que se abre; cerrada muestra su estado, su
fecha y si le falta algo.

Se guarda solo cada diez segundos. Al salir con cambios sin guardar, avisa.

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

## Versiones

Cada cambio de estado, cada "Guardar versión" y cada generación con IA dejan
una versión. Se pueden comparar contra lo que hay ahora y restaurar.

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
