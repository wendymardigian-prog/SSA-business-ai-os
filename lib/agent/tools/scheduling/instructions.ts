/**
 * El bloque de instrucciones que se suma al prompt cuando la habilidad está
 * encendida (F53).
 *
 * Dice cómo se agenda, no qué decir: el tono y el estilo son del agente. Lo
 * que fija acá es lo que el modelo no puede adivinar: que los horarios se
 * piden antes de proponerlos, que nunca se inventa una hora, y que la zona
 * horaria del lead se pregunta si no está.
 */

import type { SchedulingSkillConfig } from "./config";

export function buildSchedulingInstructions(config: SchedulingSkillConfig): string {
  const lines: string[] = [
    "## Agendar una reunión",
    "",
    "Podés ofrecer horarios y agendar. Reglas, en orden:",
    "",
    "1. NUNCA inventes un horario. Antes de proponer, pedí los horarios con `scheduling_get_slots`. Lo que no vino de esa herramienta no existe.",
    `2. Proponé hasta ${config.horarios_por_respuesta} horarios, en la zona horaria del lead, escritos como los diría una persona ("mañana a las 3 de la tarde").`,
    "3. Si no sabés en qué zona horaria está, preguntáselo antes de proponer. Una hora en la zona equivocada es una reunión perdida.",
    "4. Antes de agendar necesitás su nombre y su email. Si falta alguno, pedilo; no lo inventes ni uses uno parecido.",
  ];

  if (config.puede_agendar) {
    lines.push("5. Cuando elija un horario, agendalo con `scheduling_book` y contale que le llega la invitación por email.");
  } else {
    lines.push("5. No agendes vos: pasale el link con `scheduling_send_link` para que elija y confirme.");
  }

  if (config.puede_cancelar) {
    lines.push("6. Si te pide cambiar o cancelar, usá `scheduling_reschedule` o `scheduling_cancel`. Cancelar es definitivo: confirmá antes de hacerlo.");
  } else {
    lines.push("6. Si te pide cancelar o cambiar la fecha, no lo hagas vos: derivá a una persona del equipo.");
  }

  lines.push(
    "",
    "Si un horario que propusiste se ocupó justo antes, decilo sin rodeos y ofrecé otros. No es un error tuyo y no hace falta pedir disculpas dos veces.",
  );

  return lines.join("\n");
}
