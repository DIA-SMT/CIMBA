import { describe, expect, it } from "vitest";
import { CONFIG_DEDUP_DEFAULT, evaluarDuplicado } from "./dedup";
import type { CandidatoDedup, DemandaAComparar } from "./dedup";

const esquinaMateDeLuna = { lat: -26.8296, lon: -65.2413 };

const demandaBase: DemandaAComparar = {
  punto: esquinaMateDeLuna,
  tipo: "bache",
  direccion: "Av Mate de Luna 2400",
  geocodConfianza: 0.9,
  fecha: new Date("2026-08-01"),
};

const incidenteAbierto: CandidatoDedup = {
  punto: { lat: -26.82962, lon: -65.24135 }, // ~6 m
  tipo: "bache",
  direccion: "Avenida Mate de Luna 2400",
  abierto: true,
  cerradoEn: null,
};

describe("evaluarDuplicado", () => {
  it("mismo pozo, fuentes distintas → auto-vinculable", () => {
    const r = evaluarDuplicado(demandaBase, incidenteAbierto);
    expect(r.distanciaMetros).toBeLessThan(15);
    expect(r.score).toBeGreaterThan(CONFIG_DEDUP_DEFAULT.umbralAutomatico);
    expect(r.autoVinculable).toBe(true);
  });

  it("geocodificación de baja confianza NUNCA auto-vincula, aunque el score sea alto", () => {
    const r = evaluarDuplicado({ ...demandaBase, geocodConfianza: 0.3 }, incidenteAbierto);
    expect(r.score).toBeGreaterThan(CONFIG_DEDUP_DEFAULT.umbralAutomatico);
    expect(r.autoVinculable).toBe(false);
    expect(r.motivoBloqueoAuto).toContain("geocod_confianza");
    expect(r.sugerible).toBe(true); // pero sí va a la bandeja de revisión
  });

  it("fuera del radio → score 0", () => {
    const lejos: CandidatoDedup = { ...incidenteAbierto, punto: { lat: -26.8312, lon: -65.2413 } }; // ~180 m
    const r = evaluarDuplicado(demandaBase, lejos);
    expect(r.score).toBe(0);
    expect(r.sugerible).toBe(false);
  });

  it("incidente cerrado hace poco → reincidencia sugerible", () => {
    const cerrado: CandidatoDedup = {
      ...incidenteAbierto,
      abierto: false,
      cerradoEn: new Date("2026-07-10"),
    };
    const r = evaluarDuplicado(demandaBase, cerrado);
    expect(r.esReincidencia).toBe(true);
    expect(r.sugerible).toBe(true);
  });

  it("incidente cerrado hace mucho → no vigente", () => {
    const viejo: CandidatoDedup = {
      ...incidenteAbierto,
      abierto: false,
      cerradoEn: new Date("2025-01-01"),
    };
    const r = evaluarDuplicado(demandaBase, viejo);
    expect(r.score).toBe(0);
  });

  it("tipos incompatibles bajan el score", () => {
    const otroTipo: CandidatoDedup = { ...incidenteAbierto, tipo: "fisura", direccion: null };
    const conTipo = evaluarDuplicado({ ...demandaBase, direccion: null }, incidenteAbierto);
    const sinTipo = evaluarDuplicado({ ...demandaBase, direccion: null }, otroTipo);
    expect(sinTipo.score).toBeLessThan(conTipo.score);
  });
});
