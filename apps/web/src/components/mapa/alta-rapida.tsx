"use client";

import { MapPinPlus, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { TIPOS_PROBLEMA } from "@cimba/domain";
import { crearDemandaManual } from "@/lib/acciones-consolidar";
import { ETIQUETA_TIPO } from "@/lib/formato";

/**
 * Alta rápida desde el clic derecho en el mapa comando: el pedido nace con la
 * coordenada exacta del punto elegido (confianza 1.0, sin geocodificador de
 * por medio). La dirección se resuelve sola por georreversa y es editable.
 */
export function AltaRapida({
  punto,
  alCerrar,
  alCreado,
}: {
  punto: { lat: number; lon: number };
  alCerrar: () => void;
  alCreado: (id: number) => void;
}) {
  const [tipo, setTipo] = useState("bache");
  const [direccion, setDireccion] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [buscando, setBuscando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();
  const georevRef = useRef(0);

  useEffect(() => {
    const pedido = ++georevRef.current;
    setBuscando(true);
    fetch(`/api/georreversa?lat=${punto.lat}&lon=${punto.lon}`)
      .then((r) => r.json() as Promise<{ direccion: string | null }>)
      .then((d) => {
        if (pedido === georevRef.current && d.direccion) setDireccion(d.direccion);
      })
      .catch(() => {})
      .finally(() => {
        if (pedido === georevRef.current) setBuscando(false);
      });
  }, [punto.lat, punto.lon]);

  const registrar = () => {
    setError(null);
    startTransition(async () => {
      try {
        const r = await crearDemandaManual({ lat: punto.lat, lon: punto.lon, tipo, descripcion, direccion });
        if (r.id != null) alCreado(r.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo crear el pedido");
      }
    });
  };

  return (
    <div className="panel-vidrio absolute top-1/2 left-1/2 z-40 w-[min(360px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-bold">
          <MapPinPlus size={15} className="text-amarillo" /> Cargar pedido acá
        </p>
        <button onClick={alCerrar} className="text-texto-3 hover:text-texto" title="Cancelar">
          <X size={15} />
        </button>
      </div>
      <p className="num mb-3 text-[11px] text-texto-3">
        {punto.lat.toFixed(6)}, {punto.lon.toFixed(6)} · coordenada exacta, confianza 100%
      </p>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
            Dirección {buscando && <span className="text-celeste">· buscando…</span>}
          </label>
          <input
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            placeholder="Se completa sola (editable)"
            className="w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm placeholder:text-texto-3"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Tipo</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm">
            {TIPOS_PROBLEMA.map((t) => (
              <option key={t} value={t}>{ETIQUETA_TIPO[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Descripción</label>
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={2}
            placeholder="Qué se observó…"
            className="w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm placeholder:text-texto-3"
          />
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-peligro">{error}</p>}
      <button
        onClick={registrar}
        disabled={pendiente || direccion.length < 3 || descripcion.length < 5}
        className="mt-3 w-full rounded-lg bg-azul px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-40"
      >
        {pendiente ? "Registrando…" : "Registrar pedido"}
      </button>
    </div>
  );
}
