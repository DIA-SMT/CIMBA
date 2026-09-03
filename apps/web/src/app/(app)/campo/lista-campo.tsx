"use client";

import { Search, X } from "lucide-react";
import { useState } from "react";
import { TarjetaCampo, type Trabajo } from "./tarjeta-campo";

/**
 * Sin acentos ni mayúsculas, para que "nuñez 2500" encuentre "Núñez 2500" y
 * viceversa: el capataz escribe en el teléfono, con apuro y sin tildes.
 */
const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * La lista de trabajos con un buscador arriba que filtra EN VIVO, del lado del
 * cliente, sobre lo ya cargado. Nació de ver al Director buscar "Baltazar
 * Aguirre 2521" recorriendo las tarjetas a mano: con decenas de intervenciones
 * asignadas, encontrar la propia tiene que ser tipear la calle, no scrollear.
 */
export function ListaCampo({ trabajos }: { trabajos: Trabajo[] }) {
  const [busqueda, setBusqueda] = useState("");
  const q = normalizar(busqueda.trim());
  // Se busca por dirección/número y también por el # de la intervención.
  const visibles = q
    ? trabajos.filter((t) => normalizar(`${t.direccion ?? ""} #${t.id}`).includes(q))
    : trabajos;

  return (
    <div>
      <div className="relative mb-4">
        <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-texto-3" />
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por dirección, ej: Baltazar Aguirre 2521"
          className="w-full rounded-xl border border-borde-2 bg-panel px-10 py-3 text-base placeholder:text-texto-3"
        />
        {busqueda && (
          <button
            onClick={() => setBusqueda("")}
            title="Limpiar la búsqueda"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-texto-3 transition hover:text-texto"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {q && (
        <p className="num mb-3 text-xs text-texto-3">
          {visibles.length} de {trabajos.length} trabajos
        </p>
      )}

      {visibles.length === 0 ? (
        <p className="rounded-xl border border-borde bg-panel px-4 py-10 text-center text-sm text-texto-3">
          Ninguna dirección coincide con “{busqueda.trim()}”. Probá con menos palabras (solo la calle).
        </p>
      ) : (
        <div className="space-y-4">
          {visibles.map((iv) => (
            <TarjetaCampo key={iv.id} intervencion={iv} />
          ))}
        </div>
      )}
    </div>
  );
}
