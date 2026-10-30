# Importar contactos de otro sistema conservando la suscripción a emails

Esta guía es para traer los leads de otra herramienta (por ejemplo, la web wendymardigian.com) **sin perder quién se dio de baja de los emails**. Si importás sin la columna de suscripción, todos quedan como «suscriptos» y a alguien que pidió no recibir más emails le podría volver a llegar uno. Con esta guía eso no pasa.

Regla de oro: **la baja gana**. Una importación nunca vuelve a suscribir a nadie. Si en el sistema ya figura dado de baja (o si su email rebota, o marcó spam), sigue así aunque el archivo diga «suscripto».

## 1. Preparar el archivo

Exportá un CSV con una fila por persona y una fila de encabezados. Lo mínimo es el email o el teléfono (con uno de los dos alcanza). Para conservar la suscripción, el archivo tiene que traer al menos la columna que dice si la persona está suscripta.

Columnas que reconoce solo (no hace falta renombrarlas):

| Para qué | Nombres que reconoce |
|---|---|
| Suscripción a emails | `email_subscribed`, `suscripcion`, `suscripto`, `subscribed`, `estado email`, `email status` |
| Fecha de baja | `unsubscribed_at`, `fecha de baja` |
| Motivo de la baja | `unsubscribe_source`, `motivo baja` |
| Fecha de suscripción | `subscribed_at`, `fecha suscripcion` |
| Fecha del primer contacto | `created_at`, `fecha de alta`, `fecha primer contacto` |

**Qué valores entiende en «Suscripción a emails»** (sin importar mayúsculas ni acentos):

- Suscripto: `true`, `sí`, `si`, `1`, `yes`, `subscribed`, `suscripto`, `suscrito`
- Dado de baja: `false`, `no`, `0`, `unsubscribed`, `dado de baja`
- Rebota: `bounced`, `rebota`
- Marcó spam: `complained`, `spam`

Si una celda de esa columna está **vacía** o dice algo que no entiende (por ejemplo «quizás»), esa fila **no se importa** y aparece en la lista de errores con su número de fila. Es a propósito: importarla como «suscripta» podría re-suscribir a alguien.

**El motivo de la baja** puede decir más que la columna: si dice `bounce` la persona queda como «Rebota», si dice `complaint` como «Marcó spam». Cualquier otro motivo (`email_footer`, `one_click_header`, `admin_manual`…) es una baja común. El valor original queda guardado en el historial de la persona.

## 2. Subir y revisar el mapeo

1. Contactos → **Importar** → elegí el archivo.
2. En «Mapeo de columnas», revisá a qué va cada columna. Las de suscripción, fechas y motivo tienen que aparecer en el grupo **«Suscripción a emails (opcional)»**.
3. **Ojo con `source` y `utm_source`** (pasa con el export de wendymardigian.com): si el archivo trae las dos, la columna `source` (por ejemplo «web») se queda con «Fuente» porque va primero, y `utm_source` queda sin importar. Si lo que querés guardar es la fuente de la campaña, cambiá a mano: `utm_source` → «Fuente (utm_source)» y `source` → «No importar».
4. Las columnas que no reconoce (`id`, `email_normalized`, `negocio`, `canal`, `lead_status`) quedan en «No importar». Podés mandarlas a un campo personalizado si te sirven.

## 3. Opciones

- **Origen de la importación**: escribí de dónde vienen (por ejemplo `wendymardigian`). Queda en el historial de cada contacto («importación (wendymardigian)») y como etiqueta `origen:wendymardigian`. Si lo dejás vacío, se usa el nombre del archivo.
- Setter, vendedor y tags para todos: opcionales, igual que siempre.

## 4. Revisar antes de importar (la prueba en seco)

Tocá **«Revisar antes de importar»**. Recorre todo el archivo con la misma lógica que la importación **sin escribir nada** y te muestra:

- **Se crearían**: personas nuevas.
- **Se vincularían**: filas que caen en un contacto que ya existía, y por qué dato (teléfono, email o usuario de red). Un contacto que existía solo se completa en lo que tenía vacío.
- **Suscripción a emails (por persona)**: cuántos quedarían suscriptos, dados de baja, rebotando y con spam. Se cuenta **por persona**: si alguien aparece en tres filas, cuenta una vez.
- **Siguen dados de baja**: contactos que ya existían dados de baja y que el archivo decía «suscripto». No se re-suscriben.
- **Filas que se juntaron**: filas que repiten un email (sin importar mayúsculas). Si en alguna de esas filas la persona está dada de baja, queda dada de baja; la fecha de baja es la de esa fila y la de suscripción, la más vieja.
- **Errores**: las filas que no se van a importar, con su número tal como lo ves en la planilla (contando la fila de encabezados).

Si algo no te cierra, cambiá el mapeo o el archivo y volvé a revisar. Cambiar el mapeo borra la revisión anterior.

## 5. Importar

Tocá **«Importar»**. Usa exactamente la misma lógica que la revisión, así que los números del reporte final tienen que coincidir con los de la revisión (salvo que alguien del equipo haya cargado o cambiado contactos en el medio).

Qué hace con cada persona:

- La busca por teléfono, email o usuario de red (nunca por el nombre) y la crea o la vincula.
- Le pone el estado de email del archivo **solo si es igual o más grave** que el que tiene. Nunca la re-suscribe.
- Respeta las fechas originales: la de baja, la de suscripción y la del primer contacto.
- **No dispara automatizaciones** de «contacto nuevo», «etiqueta agregada» ni de cambio de estado de email.

## 6. Después

- En la lista de Contactos podés filtrar por **«Estado de email»** y sumar la columna «Estado de email».
- En la ficha de cada persona se ve el estado («Email: Dado de baja») con la fecha y el motivo al pasar el mouse, y en el historial, la entrada de la importación con el valor que traía del otro sistema.
- A quien quedó dado de baja no le llega ningún email de marketing, por ningún camino. Sí le siguen llegando los transaccionales (confirmaciones de agenda, contratos). A quien rebota no le llega nada.

## Si algo sale mal

- **Una fila con error**: corregila en la planilla y subí solo esas filas. Lo que ya entró no se duplica (se vincula).
- **Importaste sin la columna de suscripción**: no pasa nada grave. Los que ya existían no cambiaron; los nuevos quedaron suscriptos. Volvé a importar el mismo archivo **con** la columna: las bajas se aplican igual (la baja gana) y no se duplica nadie.
- **Un contacto quedó dado de baja por error**: desde su ficha, «Volver a suscribir» (si rebotaba o marcó spam, te va a pedir el motivo).
