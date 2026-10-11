import { describe, it, expect } from 'vitest';
import { closerScore, leadScore, computeScores, setSection, getSection, quoteInTranscript, SECTION_DEPENDENCIES, isAnalysisSection } from './scoring';

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
