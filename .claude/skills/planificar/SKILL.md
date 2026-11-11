---
name: planificar
description: Usar antes de cualquier cambio que modifique archivos, la base de datos o la configuración. Arma las preguntas, los casos borde y el plan en dos partes (resumen para la persona y plan para Claude) para que después se ejecute de corrido, sin interrupciones.
model: opus
effort: high
---

# Planificar antes de tocar nada

Seguí el protocolo de `.claude/rules/00-protocolo-de-trabajo.md`. Esta guía suma la plantilla completa del plan y la lista de casos borde.

## 1. Entender el pedido

1. Leé el código relacionado: qué existe, qué se puede reutilizar y cómo se hace algo parecido hoy.
2. Armá **una sola ronda** de preguntas (`AskUserQuestion`) con lo que es decisión de la persona. Cada pregunta, en lenguaje simple, con tu recomendación primero y por qué.
3. No preguntes nada que se pueda ver en el código ni cosas que la persona no puede juzgar (detalles técnicos): esas las decidís vos y las explicás.

## 2. Casos borde (recorrelos todos, resolvé los que cambian el resultado)

- **Vacío**: ¿qué se ve si todavía no hay datos?
- **Muchos datos**: ¿sigue andando con miles de filas? ¿hay paginación?
- **A la vez**: ¿qué pasa si dos personas hacen lo mismo al mismo tiempo, o si alguien hace doble clic?
- **Falla de un servicio externo**: ¿qué se ve y qué se reintenta si el proveedor no responde?
- **Permisos**: ¿qué pasa si lo intenta alguien que no puede? ¿Se valida en el servidor, no solo en la pantalla?
- **Celular**: ¿se ve y se usa bien en pantalla chica?
- **Datos que ya existen**: ¿cómo quedan los registros viejos? ¿hace falta migrarlos?
- **Fechas y horas**: ¿en qué zona horaria se guarda y se muestra?
- **Repetir**: si se ejecuta dos veces, ¿se duplica algo?
- **Deshacer**: ¿se puede volver atrás? Si no, ¿se avisa antes?
- **Datos sensibles**: ¿se guarda o se muestra algo personal o una clave?

## 3. Plantilla del plan

Escribila en el archivo del plan y mostrala también en el chat.

```
# Plan: <título corto>

> Cómo ejecutarlo
> - Modelo: <modelo> — <por qué>
> - Esfuerzo: <bajo | medio | alto | muy alto>
> - Al aprobar, elegí: <use auto mode | auto-accept edits | manually approve edits> — <por qué>
> - Preguntas pendientes: <ninguna | cuáles>

## PARTE A — Resumen para vos (sin tecnicismos)
- Qué vas a tener cuando termine
- Qué cambia para quien lo usa
- Qué NO cambia
- Riesgos, en palabras simples
- Decisiones que ya tomamos
- Qué te voy a pedir (si algo)

## PARTE B — Plan para Claude
- Contexto: por qué se hace
- Decisiones tomadas
- Fuera de alcance
- Archivos a crear o modificar (y qué existente se reutiliza)
- Pasos, en orden
- Casos borde resueltos
- Criterios de aceptación (cosas que se puedan comprobar mirando)
- Verificación: comandos y pantallas a revisar
```

## 4. Plan corto (cambios mínimos)

```
Cambio: <qué se modifica>. Dónde: <archivo o pantalla>. Riesgo: <qué podría salir mal>.
Modelo y esfuerzo: <ej. Sonnet 5.5, bajo>.
```

## 5. Después de aprobar

Ejecutá de corrido, sin volver a preguntar lo que el plan ya resolvió. Frená solo en los casos que el protocolo enumera (borrar datos, producción, claves, gasto imprevisto, publicar). Al cerrar, resumen simple: qué quedó, qué se probó, qué no se pudo verificar.
