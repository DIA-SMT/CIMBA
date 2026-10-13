"use client";

import { Search, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { numero } from "@/lib/formato";

/**
 * UNA LISTA LARGA, DE A TANDAS Y CON BUSCADOR.
 *
 * Una orden cargada desde una planilla trae cientos de baches (la de Ingeco
 * de septiembre, 672 en el centro y 651 en el sur). Dibujarlos todos de una
 * monta dos o tres formularios por bache en el teléfono y la pantalla tarda
 * segundos en responder. Acá se muestran los primeros y se piden más; el
 * buscador encuentra uno por la calle, sin tildes ni mayúsculas.
 *
 * Cada fila ya viene dibujada desde el servidor: esta isla solo decide cuáles
 * se montan.
 */
export function ListaPorTandas({
  filas,
  tanda = 20,
}: {
  filas: Array<{ id: number; texto: string; nodo: ReactNode }>;
  tanda?: number;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [cuantas, setCuantas] = useState(tanda);

  const normalizar = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  const visibles = useMemo(() => {
    const q = normalizar(busqueda);
    return q ? filas.filter((f) => normalizar(f.texto).includes(q)) : filas;
  }, [filas, busqueda]);

  const mostradas = visibles.slice(0, cuantas);
  const quedan = visibles.length - mostradas.length;

  return (
    <div className="space-y-2">
      {filas.length > tanda && (
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-texto-3" />
          <input
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
              setCuantas(tanda);
            }}
            placeholder="Buscar por calle…"
            className="min-h-11 w-full rounded-xl border border-borde-2 bg-panel-2 py-2 pr-10 pl-9 text-sm placeholder:text-texto-3"
          />
          {busqueda && (
            <button
              type="button"
              onClick={() => setBusqueda("")}
              aria-label="Borrar la búsqueda"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1.5 text-texto-3 hover:text-texto"
            >
              <X size={15} />
            </button>
          )}
        </div>
      )}
      {busqueda && visibles.length === 0 && (
        <p className="px-1 py-3 text-sm text-texto-3">Ningún bache coincide con “{busqueda}”.</p>
      )}
      {mostradas.map((f) => (
        <div key={f.id}>{f.nodo}</div>
      ))}
      {quedan > 0 && (
        <button
          type="button"
          onClick={() => setCuantas((n) => n + tanda)}
          className="min-h-11 w-full rounded-xl border border-borde-2 text-sm font-semibold text-celeste transition hover:border-celeste hover:bg-celeste/5"
        >
          Ver {numero(Math.min(tanda, quedan))} más · quedan {numero(quedan)}
        </button>
      )}
    </div>
  );
}
