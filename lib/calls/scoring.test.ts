import { describe, it, expect } from 'vitest';
import { closerScore, leadScore, computeScores, computeScoresWithRubric, setSection, getSection, quoteInTranscript, SECTION_DEPENDENCIES, isAnalysisSection } from './scoring';

describe('closerScore', () => {
  it('rúbrica 1–5 → 0–100', () => {
    expect(closerScore([{ puntaje: 5 }, { puntaje: 1 }])).toBe(50);
    expect(closerScore([{ puntaje: 3 }, { puntaje: 4 }, { puntaje: 4 }, { puntaje: 3 }])).toBe(63);
  });
  it('editar un criterio cambia el puntaje (64 → 68 en vivo)', () => {
    const r = [{ puntaje: 3 }, { puntaje: 4 }, { puntaje: 4 }, { puntaje: 3 }, { puntaje: 4 }];
    const before = closerScore(r)!;
    const after = closerScore(r.map((x, i) => (i === 0 ? { puntaje: 4 } : x)))!;
    expect(after).toBeGreaterThan(before);
  });
  it('sin criterios válidos → null', () => { expect(closerScore([{ puntaje: 0 }])).toBeNull(); });
});

describe('leadScore', () => {
  it('ignora las «No explorado»', () => {
    expect(leadScore([{ estado: 'Firme' }, { estado: 'No explorado' }])).toBe(100);
    expect(leadScore([{ estado: 'Parcial' }, { estado: 'Débil' }])).toBe(25);
  });
});

describe('computeScores', () => {
  it('alertas abiertas', () => {
    expect(computeScores({ alertas: [{ resuelta: true }] }).has_open_alerts).toBe(false);
    expect(computeScores({ alertas: [{ tipo: 'x' }] }).has_open_alerts).toBe(true);
  });
});

describe('secciones', () => {
  it('set/get con ruta de dos niveles sin pisar hermanos', () => {
    const a = setSection({ lead: { perfil: 'p' } }, 'lead.creencias', []);
    expect(getSection(a, 'lead.perfil')).toBe('p');
    expect(getSection(a, 'lead.creencias')).toEqual([]);
  });
  it('dependencias apuntan a secciones válidas y no a sí mismas', () => {
    for (const [k, deps] of Object.entries(SECTION_DEPENDENCIES)) {
      deps.forEach((d) => { expect(isAnalysisSection(d)).toBe(true); expect(d).not.toBe(k); });
    }
  });
});

describe('quoteInTranscript', () => {
  it('normaliza acentos y signos', () => {
    expect(quoteInTranscript('No tengo el DINERO ahora', 'Leo: no tengo el dinero, ahora no.')).toBe(true);
    expect(quoteInTranscript('No tengo el dinero', 'Leo: no tengo el dinero, ahora no.')).toBe(true);
    expect(quoteInTranscript('inventada por la IA', 'nada que ver')).toBe(false);
  });
});

describe('F21: criterios del plano', () => {
  it('un criterio que aplica solo a cierre no cuenta en una llamada de seguimiento', async () => {
    const { computeScoresWithRubric } = await import('./scoring');
    const rubric = { closer: [{ clave: 'a', peso: 50 }, { clave: 'presentacion', peso: 50, aplica_a: ['cierre'] }], lead: [] };
    const an = { rubrica: [{ codigo: 'a', puntaje: 5 }, { codigo: 'presentacion', puntaje: 1 }] };
    expect(computeScoresWithRubric(an, rubric, 'seguimiento').closer_score).toBe(100);
    expect(computeScoresWithRubric(an, rubric, 'cierre').closer_score).toBe(50);
  });
  it('9 citas, 8 estan en la transcripcion', async () => {
    const { quoteInTranscript } = await import('./scoring');
    const transcript = Array.from({ length: 8 }, (_, i) => `frase numero ${i} de la llamada`).join(' ');
    const quotes = [...Array.from({ length: 8 }, (_, i) => `frase numero ${i} de la llamada`), 'esta no aparece en ningun lado'];
    expect(quotes.filter((q) => quoteInTranscript(q, transcript))).toHaveLength(8);
  });
  it('lead 62: creencias firmes y parciales ponderadas', async () => {
    const { computeScoresWithRubric } = await import('./scoring');
    const rubric = { closer: [], lead: [{ clave: 'a', peso: 50 }, { clave: 'b', peso: 50 }] };
    const an = { lead: { creencias: [{ codigo: 'a', estado: 'Firme' }, { codigo: 'b', estado: 'Parcial' }] } };
    expect(computeScoresWithRubric(an, rubric, 'cierre').lead_score).toBe(75);
  });
});

describe("criterios que restan (Servicios A4, F140)", () => {
  const rubric = {
    closer: [
      { clave: "escucha", peso: 1 },
      { clave: "claridad", peso: 1 },
      { clave: "promesa", peso: 1, subtracts: true as const },
    ],
    lead: [],
  };
  const transcript = "El cliente preguntó y yo le dije que le garantizo el triple de ventas en un mes sin falta.";
  const analysis = (promesa: { puntaje: number; cita?: string }) => ({
    rubrica: [
      { codigo: "escucha", puntaje: 5 },
      { codigo: "claridad", puntaje: 3 },
      { codigo: "promesa", ...promesa },
    ],
  });

  it("un criterio que resta, presente y con cita verificada, baja la nota", () => {
    const sin = computeScoresWithRubric(analysis({ puntaje: 1 }), rubric, null, transcript).closer_score;
    const con = computeScoresWithRubric(analysis({ puntaje: 5, cita: "le garantizo el triple de ventas" }), rubric, null, transcript).closer_score;
    expect(sin).toBe(75);
    expect(con).toBe(25); // 75 menos la mitad (peso 1 sobre 2 que suman)
  });
  it("ausente no cambia nada", () => {
    expect(computeScoresWithRubric(analysis({ puntaje: 1, cita: "le garantizo el triple" }), rubric, null, transcript).closer_score).toBe(75);
  });
  it("sin cita verificada no cuenta (ni sin transcripción)", () => {
    expect(computeScoresWithRubric(analysis({ puntaje: 5, cita: "una frase que nadie dijo nunca" }), rubric, null, transcript).closer_score).toBe(75);
    expect(computeScoresWithRubric(analysis({ puntaje: 5, cita: "le garantizo el triple de ventas" }), rubric, null).closer_score).toBe(75);
  });
  it("nunca baja de 0", () => {
    const heavy = { closer: [{ clave: "escucha", peso: 1 }, { clave: "promesa", peso: 5, subtracts: true as const }], lead: [] };
    const a = { rubrica: [{ codigo: "escucha", puntaje: 3 }, { codigo: "promesa", puntaje: 5, cita: "le garantizo el triple de ventas" }] };
    expect(computeScoresWithRubric(a, heavy, null, transcript).closer_score).toBe(0);
  });
  it("una rúbrica sin criterios que restan da la misma nota de siempre", () => {
    const plain = { closer: [{ clave: "escucha", peso: 1 }, { clave: "claridad", peso: 1 }], lead: [] };
    const a = { rubrica: [{ codigo: "escucha", puntaje: 5 }, { codigo: "claridad", puntaje: 3 }] };
    expect(computeScoresWithRubric(a, plain, null, transcript).closer_score).toBe(computeScoresWithRubric(a, plain, null).closer_score);
  });
});
