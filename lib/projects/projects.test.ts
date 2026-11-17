// @plantilla-quitar(proyectos)
import { describe, expect, it } from "vitest";
import projectCases from "./student-project.cases.json";
import fameCases from "./fame.cases.json";
import settingsCases from "./settings.cases.json";
import { projectProblems } from "./project";
import { fameRanking, type FameEntry, type FameProject, type FameSettings } from "./fame";
import { fameSettingsProblems, projectsSettingsProblems } from "./settings";

describe("projectProblems (gemela de app_servicio_proyectos.project_problems)", () => {
  for (const c of projectCases.cases) it(c.name, () => expect(projectProblems(c.input)).toEqual(c.expected));
});

describe("fameRanking (gemela de app_servicio_proyectos.fame_plan)", () => {
  for (const c of fameCases.cases) {
    it(c.name, () =>
      expect(fameRanking(c.entries as FameEntry[], c.projects as FameProject[], c.settings as FameSettings, c.period as "all" | "month", "2026-11-17")).toEqual(c.expected),
    );
  }
});

describe("fame y projects del programa (gemelas de *_settings_problems)", () => {
  for (const c of settingsCases.cases) {
    it(`${c.kind}: ${c.name}`, () => expect((c.kind === "fame" ? fameSettingsProblems : projectsSettingsProblems)(c.input)).toEqual(c.expected));
  }
});
