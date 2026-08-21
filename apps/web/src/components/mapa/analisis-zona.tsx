"use client";

import { Radar, X } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import type { Feature, FeatureCollection, Point } from "geojson";
import { COLOR_MACRO, ETIQUETA_FUENTE, ETIQUETA_TIPO, numero } from "@/lib/formato";
import { distanciaM } from "./geo-cliente";

type FC = FeatureCollection<Point, Record<string, unknown>>;

/**
 * Analizador de zona: estadísticas instantáneas de un radio elegido con un
 * clic, calculadas en el navegador sobre los datos ya cargados — sin esperar
 * al servidor. La lupa territorial del centro de comando.
 */
export function AnalisisZona({
  centro,
  radio,
  setRadio,
  demandas,
  incidentes,
  alCerrar,
}: {
  centro: { lon: number; lat: number };
  radio: number;
  setRadio: (r: number) => void;
  demandas: FC;
  incidentes: FC;
  alCerrar: () => void;
}) {
  const stats = useMemo(() => {
    const dentro = <T extends Feature<Point, Record<string, unknown>>>(f: T) =>
      distanciaM(f.geometry.coordinates[0] ?? 0, f.geometry.coordinates[1] ?? 0, centro.lon, centro.lat) <= radio;

    const d = demandas.features.filter(dentro);
    const i = incidentes.features.filter(dentro);

    const cuenta = (fs: typeof d, clave: string) => {
      const m = new Map<string, number>();
      for (const f of fs) {
        const v = String(f.properties[clave] ?? "—");
        m.set(v, (m.get(v) ?? 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };

    const m2 = i.reduce((acc, f) => acc + (Number(f.properties.m2) || 0), 0);
    const porDireccion = new Map<string, number>();
    for (const f of d) {
      const dir = String(f.properties.direccion ?? "").trim();
      if (dir) porDireccion.set(dir, (porDireccion.get(dir) ?? 0) + 1);
    }

    return {
      demandas: d.length,
      pendientes: d.filter((f) => ["recibida", "en_validacion"].includes(String(f.properties.estado))).length,
      sinAtencion: d.filter((f) => f.properties.brecha === "sin_atencion").length,
      porFuente: cuenta(d, "fuente").slice(0, 3),
      porTipo: cuenta(d, "tipo").slice(0, 3),
      abiertos: i.filter((f) => f.properties.macro === "abierto").length,
      enCurso: i.filter((f) => f.properties.macro === "en_curso").length,
      resueltos: i.filter((f) => f.properties.macro === "resuelto").length,
      m2: Math.round(m2),
      topCalles: [...porDireccion.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    };
  }, [centro, radio, demandas, incidentes]);

  return (
    <aside className="panel-vidrio absolute top-28 right-3 bottom-6 z-20 flex w-80 flex-col rounded-xl">
      <div className="flex items-center justify-between border-b border-borde px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-bold">
          <Radar size={15} className="text-amarillo" /> Análisis de zona
        </span>
        <button onClick={alCerrar} className="text-texto-3 hover:text-texto">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-[13px]">
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Radio</span>
            <span className="num text-xs font-bold text-amarillo">{numero(radio)} m</span>
          </div>
          <input
            type="range"
            min={100}
            max={1000}
            step={50}
            value={radio}
            onChange={(e) => setRadio(Number(e.target.value))}
            className="w-full accent-[#f4dc00]"
          />
          <p className="mt-1 text-[10px] text-texto-3">
            Clic en otro lugar del mapa para mover el centro.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Cifra n={stats.pendientes} etiqueta="pedidos pendientes" color="#f4dc00" />
          <Cifra n={stats.sinAtencion} etiqueta="sin atención (brecha)" color={COLOR_MACRO.en_curso} />
          <Cifra n={stats.enCurso + stats.abiertos} etiqueta="incidentes activos" color={COLOR_MACRO.abierto} />
          <Cifra n={stats.resueltos} etiqueta="reparaciones hechas" color={COLOR_MACRO.resuelto} />
        </div>

        {stats.m2 > 0 && (
          <p className="text-texto-2">
            <span className="num font-bold text-texto">{numero(stats.m2)} m²</span> intervenidos en la zona.
          </p>
        )}

        {stats.porTipo.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Qué se pide acá</p>
            {stats.porTipo.map(([tipo, n]) => (
              <div key={tipo} className="flex items-baseline justify-between">
                <span>{ETIQUETA_TIPO[tipo as keyof typeof ETIQUETA_TIPO] ?? tipo}</span>
                <span className="num text-xs text-texto-2">{numero(n)}</span>
              </div>
            ))}
          </div>
        )}

        {stats.porFuente.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Quién lo pide</p>
            {stats.porFuente.map(([fuente, n]) => (
              <div key={fuente} className="flex items-baseline justify-between">
                <span>{ETIQUETA_FUENTE[fuente as keyof typeof ETIQUETA_FUENTE] ?? fuente}</span>
                <span className="num text-xs text-texto-2">{numero(n)}</span>
              </div>
            ))}
          </div>
        )}

        {stats.topCalles.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Puntos calientes de la zona</p>
            {stats.topCalles.map(([dir, n]) => (
              <div key={dir} className="flex items-baseline justify-between gap-2">
                <span className="truncate" title={dir}>{dir}</span>
                <span className="num shrink-0 text-xs font-bold text-encurso">{numero(n)}</span>
              </div>
            ))}
          </div>
        )}

        {stats.demandas === 0 && stats.resueltos === 0 && (
          <p className="py-4 text-center text-texto-3">Nada registrado en este radio. Probá agrandarlo.</p>
        )}
      </div>

      <div className="border-t border-borde p-3">
        <Link
          href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${centro.lat},${centro.lon}`}
          target="_blank"
          className="block rounded-lg border border-borde-2 px-3 py-2 text-center text-xs font-semibold text-texto-2 transition hover:border-celeste hover:text-celeste"
        >
          Ver la zona en Street View ↗
        </Link>
      </div>
    </aside>
  );
}

function Cifra({ n, etiqueta, color }: { n: number; etiqueta: string; color: string }) {
  return (
    <div className="rounded-lg border border-borde bg-panel-2/60 px-2.5 py-2">
      <div className="num text-lg font-extrabold" style={{ color }}>{numero(n)}</div>
      <div className="text-[10px] leading-tight text-texto-3">{etiqueta}</div>
    </div>
  );
}
