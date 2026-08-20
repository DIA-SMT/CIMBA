"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { TIPOS_PROBLEMA } from "@cimba/domain";
import { crearDemandaHcd } from "@/lib/acciones";
import { ETIQUETA_TIPO } from "@/lib/formato";
import { MapaSelector } from "@/components/mapa/mapa-selector";
import { Panel } from "@/components/ui";

export function FormularioHcd() {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [punto, setPunto] = useState<{ lat: number; lon: number } | null>(null);
  const [tipo, setTipo] = useState("bache");
  const [direccion, setDireccion] = useState("");
  const [buscandoDireccion, setBuscandoDireccion] = useState(false);

  const elegirPunto = async (lat: number, lon: number) => {
    setPunto({ lat, lon });
    setBuscandoDireccion(true);
    try {
      const res = await fetch(`/api/georreversa?lat=${lat}&lon=${lon}`);
      const data = (await res.json()) as { direccion: string | null };
      if (data.direccion) setDireccion(data.direccion);
    } finally {
      setBuscandoDireccion(false);
    }
  };
  const [descripcion, setDescripcion] = useState("");
  const [solicitante, setSolicitante] = useState("");
  const [prioridad, setPrioridad] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [creado, setCreado] = useState<number | null>(null);

  const enviar = () => {
    if (!punto) {
      setError("Marcá la ubicación en el mapa");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const r = await crearDemandaHcd({
          lat: punto.lat,
          lon: punto.lon,
          tipo,
          descripcion,
          direccion,
          solicitante,
          prioridad: prioridad ? Number(prioridad) : undefined,
        });
        setCreado(r.id ?? null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo crear el pedido");
      }
    });
  };

  if (creado) {
    return (
      <Panel className="p-6 text-center">
        <p className="text-lg font-bold text-resuelto">Pedido registrado ✓</p>
        <p className="mt-1 text-sm text-texto-2">
          Quedó como demanda <span className="num font-bold">#{creado}</span> con fuente HCD. Atención Ciudadana la
          verá en la bandeja para vincularla al incidente correspondiente.
        </p>
        <button
          onClick={() => {
            setCreado(null);
            setPunto(null);
            setDireccion("");
            setDescripcion("");
          }}
          className="mt-4 rounded-lg bg-azul px-4 py-2 text-sm font-semibold text-white"
        >
          Cargar otro pedido
        </button>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-semibold tracking-wider text-texto-3 uppercase">
          Ubicación — clic en el mapa (la dirección se completa sola)
        </label>
        <MapaSelector punto={punto} alElegir={(lat, lon) => void elegirPunto(lat, lon)} />
        {punto && (
          <p className="num mt-1 text-[11px] text-texto-3">
            {punto.lat.toFixed(6)}, {punto.lon.toFixed(6)}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold tracking-wider text-texto-3 uppercase">
            Dirección {buscandoDireccion && <span className="text-celeste">· buscando…</span>}
          </label>
          <input
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            placeholder="Ej: Av. Mate de Luna 2400"
            className="w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm placeholder:text-texto-3"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold tracking-wider text-texto-3 uppercase">Tipo de problema</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm">
            {TIPOS_PROBLEMA.map((t) => (
              <option key={t} value={t}>{ETIQUETA_TIPO[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold tracking-wider text-texto-3 uppercase">Concejal / bloque solicitante</label>
          <input
            value={solicitante}
            onChange={(e) => setSolicitante(e.target.value)}
            placeholder="Quién lo pide"
            className="w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm placeholder:text-texto-3"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold tracking-wider text-texto-3 uppercase">Prioridad informada</label>
          <select value={prioridad} onChange={(e) => setPrioridad(e.target.value)} className="w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm">
            <option value="">Sin especificar</option>
            <option value="1">1 — Urgente</option>
            <option value="2">2 — Alta</option>
            <option value="3">3 — Media</option>
            <option value="4">4 — Baja</option>
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold tracking-wider text-texto-3 uppercase">Descripción</label>
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={3}
          placeholder="Detalle del pedido…"
          className="w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm placeholder:text-texto-3"
        />
      </div>

      {error && <p className="text-sm text-peligro">{error}</p>}

      <button
        onClick={enviar}
        disabled={pendiente || !punto || direccion.length < 3 || descripcion.length < 5 || solicitante.length < 3}
        className="rounded-lg bg-azul px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
      >
        {pendiente ? "Enviando…" : "Registrar pedido"}
      </button>
    </div>
  );
}
