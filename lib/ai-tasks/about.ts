import { CLASSIFIER_BATCH, MAX_NEW_CATEGORIES } from "@/lib/patterns/classifier";
import { MAX_CONTINUATIONS, SEEDING_MAX_NEW_CATEGORIES, SEEDING_THRESHOLD, TIME_BUDGET_MS } from "@/lib/patterns/classify-run";
import { MAX_CORRECTIONS, MAX_TEXT_CHARS } from "@/lib/patterns/prompt";
import { SUMMARY_MAX_CHARS, SUMMARY_MAX_MESSAGES } from "@/lib/agent/summary";
import { DEFAULT_CHUNK_SIZE, DEFAULT_OVERLAP } from "@/lib/knowledge/chunk";
import { DEFAULT_EMBEDDING_MODEL } from "@/lib/knowledge/voyage";
import { MAX_AUDIO_BYTES } from "@/lib/ai/transcribe";
import { MEDIA_DESCRIPTION_MAX_CHARS } from "@/lib/jobs/handlers/describe-media";
import { MAX_ADS, MAX_ADSETS, MAX_CAMPAIGNS } from "@/lib/meta/ai-analysis";
import type { AiTaskId } from "./catalog";

/**
 * La pestaña "Cómo funciona" de cada tarea de IA: la misma estructura para
 * las siete (cuándo corre, qué lee, qué decide, qué escribe, sus topes y cómo
 * se cobra).
 *
 * Solo para el servidor: los topes salen de las constantes REALES del código
 * que corre cada tarea, no de un texto copiado. Si alguien cambia el tamaño de
 * un lote, la pantalla cambia sola y nunca dice algo distinto de lo que pasa.
 * El catálogo (`catalog.ts`) no puede importarlas porque lo usa también el
 * navegador.
 */
export interface TaskAbout {
  /** Cuándo corre, en una frase. */
  trigger: string;
  /** Qué datos lee. */
  reads: string[];
  /** Qué decide y con qué reglas. */
  decides: string[];
  /** Qué escribe y dónde se ve. */
  writes: string[];
  /** Los topes fijos del código. */
  limits: string[];
  /** Cómo se calcula lo que gasta. */
  cost: string;
}

const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;
const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;
const n = (value: number) => value.toLocaleString("es");

const TOKENS = "Por tokens (lo que lee y lo que escribe el modelo), con los precios cargados en Costos. Cada corrida queda en Corridas con su costo.";

export function taskAbout(id: AiTaskId): TaskAbout {
  switch (id) {
    case "message_classification":
      return {
        trigger: "Por lote, según su modo: una vez por día (por defecto a las 03:00), cada 6 horas, cada hora o una vez por semana. También se puede dejar en Inmediato o apagar.",
        reads: [
          "Los mensajes de texto que todavía no tienen categoría, por separado los que escriben los contactos y los que envía el negocio.",
          "Las categorías que ya existen, con su descripción y ejemplos.",
          `Las últimas ${n(MAX_CORRECTIONS)} correcciones que hizo alguien del equipo en la revisión rápida, para aprender de ellas.`,
        ],
        decides: [
          "Para cada mensaje elige la categoría existente que mejor le queda. Prefiere siempre una existente antes que inventar una nueva.",
          "Si ninguna le queda bien y el mensaje es una intención clara y repetible, propone una categoría nueva (nombre corto y una línea de descripción).",
          "Lo ambiguo o sin intención clara va a la categoría de descarte. Un mensaje vacío (solo emojis, por ejemplo) se manda a su categoría por regla, sin pasar por el modelo.",
          "Le pone una confianza de 0 a 1 a cada decisión.",
        ],
        writes: [
          "La categoría de cada mensaje, que es lo que agrupa el dashboard de Chat (patrones de mensajes).",
          "Las categorías nuevas que propone, marcadas como creadas por el modelo para que se puedan revisar.",
        ],
        limits: [
          `Lotes de hasta ${n(CLASSIFIER_BATCH)} mensajes, recortados a ${n(MAX_TEXT_CHARS)} caracteres cada uno.`,
          `Hasta ${n(MAX_NEW_CATEGORIES)} categorías nuevas por lote (${n(SEEDING_MAX_NEW_CATEGORIES)} mientras haya menos de ${n(SEEDING_THRESHOLD)} propias, para armar el catálogo inicial).`,
          `Cada corrida dura como máximo ${seconds(TIME_BUDGET_MS)}; si quedan mensajes, sigue en otra corrida (hasta ${n(MAX_CONTINUATIONS)} seguidas).`,
          "Frena si se llegó a un tope de gasto de IA del negocio.",
        ],
        cost: TOKENS,
      };
    case "conversation_summary":
      return {
        trigger: "Cuando se cierra una conversación: a mano o por inactividad (las horas las define cada agente). Solo si el agente del canal está encendido y tiene el resumen activado.",
        reads: [
          `Los mensajes nuevos desde el último resumen (hasta ${n(SUMMARY_MAX_MESSAGES)}), incluidas las transcripciones de audio y las descripciones de imágenes.`,
          "El resumen anterior del contacto, si existe.",
        ],
        decides: [
          "Escribe un resumen integrado en tercera persona: temas, decisiones, preferencias, problemas, compromisos y próximo paso sugerido.",
          "Si un dato nuevo contradice uno del resumen anterior, se queda con el nuevo: nunca acumula versiones contradictorias.",
          "No inventa: lo que no está en los mensajes o en el resumen anterior no se escribe.",
          "Sin mensajes nuevos desde el último resumen, no llama al modelo ni gasta.",
        ],
        writes: [
          "El resumen del contacto (la memoria que el agente lee en la próxima conversación). Se ve en la ficha del contacto.",
          "Una entrada en el historial de Acciones del agente, con el resumen anterior y el nuevo.",
        ],
        limits: [
          `Largo máximo ${n(SUMMARY_MAX_CHARS)} caracteres (unos 2000 tokens). Si se pasa, una segunda llamada condensa lo más viejo; si igual se pasa, se recorta.`,
          `Hasta ${n(SUMMARY_MAX_MESSAGES)} mensajes nuevos por cierre.`,
        ],
        cost: `${TOKENS} Comparte la llamada con la Clasificación al cierre: es un solo costo para las dos.`,
      };
    case "close_classification":
      return {
        trigger: "En la misma llamada que el Resumen de conversación, al cerrar una conversación. Solo si el agente del canal tiene la clasificación al cierre activada.",
        reads: [
          "La misma conversación que lee el resumen (los mensajes nuevos y el resumen anterior).",
          "La lista de etiquetas permitidas de la herramienta “Etiquetar contacto” del agente. Las etiquetas con efecto (las que apagan al agente o asignan a alguien) nunca se ofrecen.",
          "Tus criterios de la pestaña Instrucciones: cuándo poner o quitar una etiqueta, qué es frío, tibio o caliente, y cuándo agendar seguimiento.",
        ],
        decides: [
          "Etiquetas: cuáles agregar y cuáles quitar, solo de la lista permitida. Nunca crea etiquetas nuevas; un nombre que no está en la lista se descarta y queda anotado.",
          "Temperatura del lead: frío, tibio o caliente, o no cambiarla.",
          "Seguimiento: en cuántos días volver a contactar, o ninguno.",
          "Cada parte se aplica solo si su herramienta está encendida en el agente, y con los límites de esa herramienta (abajo, agente por agente).",
        ],
        writes: [
          "Las etiquetas del contacto, su temperatura y su próxima fecha de seguimiento.",
          "Cada cambio queda en el historial de Acciones del agente y se puede revertir desde ahí.",
        ],
        limits: [
          "Quitar etiquetas: solo si la herramienta “Etiquetar contacto” lo permite.",
          "Bajar la temperatura: solo si la herramienta “Cambiar temperatura” lo permite; si no, solo puede subirla.",
          "Seguimiento: hasta los días máximos de la herramienta “Programar seguimiento”, y sin pisar una fecha que puso una persona (salvo que la herramienta lo permita).",
        ],
        cost: "No tiene costo propio: es parte de la llamada del Resumen de conversación. El gasto que se muestra es el de esas llamadas completas (resumen y clasificación juntos).",
      };
    case "knowledge_indexing":
      return {
        trigger: "Apenas subís o reemplazás un documento en Conocimiento.",
        reads: ["El archivo que subiste, convertido a texto."],
        decides: [
          "Lo parte en pedazos que se superponen un poco, para que una idea no quede cortada entre dos.",
          "Convierte cada pedazo en un vector (embedding), que es lo que permite al agente buscar por significado y no solo por palabras exactas.",
        ],
        writes: ["Los pedazos del documento y su estado (Indexado, con cuántos pedazos). Recién ahí el agente lo puede usar."],
        limits: [
          `Pedazos de unos ${n(DEFAULT_CHUNK_SIZE)} caracteres, con ${n(DEFAULT_OVERLAP)} de superposición.`,
          `Modelo por defecto: ${DEFAULT_EMBEDDING_MODEL}.`,
          "No se puede apagar: sin indexar, el agente no encuentra nada en la base.",
        ],
        cost: "Por tokens de embeddings, mucho más barato que una respuesta del agente.",
      };
    case "audio_transcription":
      return {
        trigger: "Apenas llega una nota de voz (o un video con voz a la banca de recursos). Si falla, se reintenta sola.",
        reads: ["El audio, copiado a nuestro almacenamiento."],
        decides: ["Nada: pasa a texto lo que se dice, en español, tal cual."],
        writes: [
          "La transcripción del mensaje, que el agente lee como si fuera texto y que se ve debajo del audio en la bandeja.",
          "Si no se pudo transcribir, el agente no contesta a ciegas: espera o deriva a una persona (según su configuración).",
        ],
        limits: [`Archivos de hasta ${mb(MAX_AUDIO_BYTES)}.`, "La transcripción nunca se borra, aunque el audio sí a los 180 días."],
        cost: "Por hora de audio (no por tokens), con el precio cargado para el modelo de transcripción.",
      };
    case "media_description":
      return {
        trigger: "Apenas llega una imagen al chat. Los stickers y GIFs no se describen.",
        reads: ["La imagen, y tus instrucciones de la pestaña Instrucciones."],
        decides: ["Qué se ve en la imagen y, si tiene texto (una captura, por ejemplo), qué dice."],
        writes: ["La descripción del mensaje, que el agente lee para entender la imagen y que se ve en la bandeja."],
        limits: [`Una frase de hasta ${n(MEDIA_DESCRIPTION_MAX_CHARS)} caracteres.`],
        cost: TOKENS,
      };
    case "ads_analysis":
      return {
        trigger: "Cuando alguien aprieta “Analizar con IA” en el dashboard de Meta Ads. Nunca corre sola.",
        reads: [
          "Los números del período elegido: totales de la cuenta y las campañas, conjuntos y anuncios con más gasto.",
          "Tus instrucciones de la pestaña Instrucciones.",
        ],
        decides: ["Qué está funcionando, qué no y tres o cuatro cosas concretas para hacer, cada una con el número que la justifica."],
        writes: ["Nada en la base: el análisis se muestra en el panel del dashboard."],
        limits: [
          `Lee hasta ${n(MAX_CAMPAIGNS)} campañas, ${n(MAX_ADSETS)} conjuntos y ${n(MAX_ADS)} anuncios (los de más gasto).`,
          "Frena si se llegó a un tope de gasto de IA del negocio.",
        ],
        cost: TOKENS,
      };
    case "call_classification":
      return {
        trigger: "Cuando entra una llamada de Fathom (o una importada) y las reglas del negocio no alcanzan para decidir su tipo. También cuando alguien pide reclasificarla.",
        reads: [
          "El título, los invitados y las personas que hablaron, y el comienzo y el final de la transcripción.",
          "Los tipos válidos (los del sistema y los propios) y tus criterios de la pestaña Instrucciones.",
        ],
        decides: [
          "De qué tipo es la llamada, con una confianza de 0 a 1 y una alternativa.",
          "Si ninguno encaja, propone el nombre corto de un tipo nuevo; nunca lo crea sola.",
          "Si la confianza queda bajo tu umbral, la llamada queda “Por revisar” para que alguien la confirme.",
        ],
        writes: [
          "El tipo de la llamada, su confianza y el motivo. Un tipo que cambió una persona a mano nunca se pisa.",
        ],
        limits: [
          "Lee hasta 60.000 caracteres: los primeros 40.000 y los últimos 20.000.",
          "Antes de llamar al modelo corren las reglas fijas del negocio; si una decide, no se gasta nada.",
          "Frena si se llegó a un tope de gasto de IA del negocio.",
        ],
        cost: TOKENS,
      };
    case "call_analysis":
      return {
        trigger: "Cuando una llamada de cierre o seguimiento se clasifica (si el modo es automático), o cuando alguien aprieta Analizar. Con el modo apagado, nunca corre sola.",
        reads: [
          "La transcripción completa, el título, los invitados y lo que ya se sabe del contacto.",
          "Tu rúbrica (criterios y pesos), tus categorías de objeciones y el contexto del negocio.",
          "Tus instrucciones de la pestaña Instrucciones (por ejemplo, el método de ventas del negocio).",
        ],
        decides: [
          "Un puntaje de 1 a 5 por cada criterio, con la justificación y la cita textual que lo respalda.",
          "Las objeciones, el dolor, la situación deseada y las creencias del lead, cada una con su cita.",
          "El feedback para el closer. Los puntajes finales los calcula el código con la rúbrica, no el modelo.",
        ],
        writes: [
          "El análisis de la llamada, con la versión de las instrucciones y de la rúbrica usadas. Lo que corrige una persona se guarda aparte; lo que dijo la IA nunca se pierde.",
          "El puntaje del closer y la calificación del lead.",
        ],
        limits: [
          "Una cita que no está en la transcripción se descarta.",
          "El modelo puede escribir hasta 32.000 tokens por análisis.",
          "Frena si se llegó a un tope de gasto de IA del negocio, y avisa al equipo con permiso de configurar.",
        ],
        cost: TOKENS,
      };
    case "call_summary":
      return {
        trigger: "Después de analizar una llamada, o cuando alguien aprieta Resumir.",
        reads: [
          "El análisis y la transcripción de la llamada.",
          "La memoria que el contacto ya tenía, si existe.",
        ],
        decides: [
          "El resumen de la llamada, los próximos pasos y hasta unas pocas ideas de contenido que nacen de lo que dijo el lead.",
          "La memoria integrada del contacto: si un dato nuevo contradice uno viejo, se queda con el nuevo.",
        ],
        writes: [
          "El resumen de la llamada y la memoria del contacto (la ve el agente en la próxima conversación).",
          "Ideas nuevas en Contenido, solo la primera vez que se resume esa llamada.",
          "La llamada como documento interno de Conocimiento.",
        ],
        limits: [
          "Si la memoria cambió mientras tanto, reintenta una vez; si vuelve a chocar, queda marcada en conflicto sin pisar nada.",
          "Frena si se llegó a un tope de gasto de IA del negocio.",
        ],
        cost: TOKENS,
      };
  }
}
