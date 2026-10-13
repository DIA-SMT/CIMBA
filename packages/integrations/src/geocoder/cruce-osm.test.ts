import { describe, expect, it } from "vitest";
import { normalizarCalle, patronesCalle } from "./cruce-osm";

/**
 * Cómo se busca una calle por su nombre. Lo que protegen: "Piedras",
 * "Las Piedras" y "Combate de Las Piedras" tienen que llegar a la misma calle,
 * y "Eudoro Araoz" tiene que encontrar "Eudoro Aráoz" (13/10).
 */
describe("los nombres de calle para buscar el cruce", () => {
  // Así se compara en la base: el patrón contra el nombre ya normalizado.
  const encuentra = (escrito: string, enOsm: string) =>
    patronesCalle(escrito).some((p) => new RegExp(p).test(normalizarCalle(enOsm)));

  it("las tildes no importan, ni de un lado ni del otro", () => {
    expect(encuentra("Eudoro Araoz", "Eudoro Aráoz")).toBe(true);
    expect(encuentra("Eudoro Aráoz", "Eudoro Araoz")).toBe(true);
    // La eñe también: mucha gente escribe "Munecas".
    expect(encuentra("Munecas", "Ildefonso de las Muñecas")).toBe(true);
    expect(encuentra("Muñecas", "Ildefonso de las Muñecas")).toBe(true);
  });

  it("el nombre largo encuentra el corto por la palabra que lo identifica", () => {
    expect(encuentra("Combate de Las Piedras", "Las Piedras")).toBe(true);
    expect(encuentra("Piedras", "Las Piedras")).toBe(true);
  });

  it("saca el tipo de calle, que OSM escribe a su manera", () => {
    expect(encuentra("Av. Mate de Luna", "Avenida Mate de Luna")).toBe(true);
    expect(encuentra("Pje. Santos Dumont", "Pasaje Santos Dumont")).toBe(true);
  });

  it("primero prueba el nombre completo, que es el más estricto", () => {
    const [primero] = patronesCalle("San Martín");
    expect(new RegExp(primero!).test(normalizarCalle("San Martín"))).toBe(true);
    expect(new RegExp(primero!).test(normalizarCalle("Martín Rodríguez"))).toBe(false);
  });

  it("un nombre vacío no busca nada", () => {
    expect(patronesCalle("  ")).toEqual([]);
  });
});
