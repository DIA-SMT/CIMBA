"use client";

import { FileUp, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { TIPOS_PROBLEMA } from "@cimba/domain";
import { crearDemandaManual, importarArchivo } from "@/lib/acciones-consolidar";
import { ETIQUETA_TIPO } from "@/lib/formato";
import { MapaSelector } from "@/components/mapa/mapa-selector";
import { Panel } from "@/components/ui";

export function FormularioCarga() {
  return (
    <div className="space-y-6">
      <CargaArchivo />
      <CargaManual />
    </div>
  );
}

function CargaArchivo() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [resultado, setResultado] = useState<{ formato: string; resultados: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const subir = async (archivo: File | undefined) => {
    if (!archivo) return;
    setSubiendo(true);
    setError(null);
    setResultado(null);
    try {
      const fd = new FormData();
      fd.set("archivo", archivo);
      const r = await importarArchivo(fd);
      setResultado({ formato: r.formato, resultados: r.resultados });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo importar el archivo");
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Panel className="p-5">
      <p className="flex items-center gap-2 text-sm font-bold">
        <FileUp size={16} className="text-celeste" /> Importar archivo de una fuente
      </p>
      <p className="mt-1 mb-4 text-xs leading-relaxed text-texto-2">
        Detecta el formato solo por los encabezados: intimaciones SAT (csv), planillas de bacheo (csv), reclamos de
        Atención Ciudadana (xlsx) y obras SIGOV (xlsx). Los GeoPackage de QGIS por ahora van por la CLI local.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => void subir(e.target.files?.[0])}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={subiendo}
        className="w-full rounded-xl border-2 border-dashed border-borde-2 bg-panel-2/50 px-4 py-8 text-sm font-semibold text-texto-2 transition hover:border-celeste/60 hover:text-texto disabled:opacity-50"
      >
        {subiendo ? "Importando… (puede tardar según el tamaño)" : "Elegir archivo CSV o XLSX"}
      </button>

      {error && <p className="mt-3 text-sm text-peligro">{error}</p>}
      {resultado && (
        <div className="mt-3 rounded-lg border border-resuelto/40 bg-resuelto/10 px-4 py-3 text-sm">
          <p className="font-bold text-resuelto">✓ {resultado.formato}</p>
          {resultado.resultados.map((r, i) => (
            <p key={i} className="mt-1 text-texto-2">{r}</p>
          ))}
        </div>
      )}
    </Panel>
  );
}

function CargaManual() {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [punto, setPunto] = useState<{ lat: number; lon: number } | null>(null);
  const [tipo, setTipo] = useState("bache");
  const [direccion, setDireccion] = useState("");
  const [buscandoDireccion, setBuscandoDireccion] = useState(false);
  const [descripcion, setDescripcion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creado, setCreado] = useState<number | null>(null);

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

  const enviar = () => {
    if (!punto) {
      setError("Marcá la ubicación en el mapa");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const r = await crearDemandaManual({ lat: punto.lat, lon: punto.lon, tipo, descripcion, direccion });
        setCreado(r.id ?? null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo crear la demanda");
      }
    });
  };

  if (creado) {
    return (
      <Panel className="p-6 text-center">
        <p className="text-lg font-bold text-resuelto">Demanda #{creado} registrada ✓</p>
        <p className="mt-1 text-sm text-texto-2">Fuente: carga manual. Ya está en la bandeja para cotejar.</p>
        <button
          onClick={() => {
            setCreado(null);
            setPunto(null);
            setDireccion("");
            setDescripcion("");
          }}
          className="mt-4 rounded-lg bg-azul px-4 py-2 text-sm font-semibold text-white"
        >
          Cargar otra
        </button>
      </Panel>
    );
  }

  return (
    <Panel className="p-5">
      <p className="flex items-center gap-2 text-sm font-bold">
        <MapPin size={16} className="text-amarillo" /> Cargar una demanda puntual
      </p>
      <p className="mt-1 mb-4 text-xs text-texto-2">
        Clic en el mapa: la dirección se completa sola (editable).
      </p>
      <MapaSelector punto={punto} alElegir={(lat, lon) => void elegirPunto(lat, lon)} alto={280} />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold tracking-wider text-texto-3 uppercase">
            Dirección {buscandoDireccion && <span className="text-celeste">· buscando…</span>}
          </label>
          <input
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            placeholder="Se completa al marcar el mapa"
            className="w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm placeholder:text-texto-3"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold tracking-wider text-texto-3 uppercase">Tipo</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm">
            {TIPOS_PROBLEMA.map((t) => (
              <option key={t} value={t}>{ETIQUETA_TIPO[t]}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-3">
        <label className="mb-1 block text-xs font-semibold tracking-wider text-texto-3 uppercase">Descripción</label>
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={2}
          placeholder="Qué se observó…"
          className="w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm placeholder:text-texto-3"
        />
      </div>
      {error && <p className="mt-2 text-sm text-peligro">{error}</p>}
      <button
        onClick={enviar}
        disabled={pendiente || !punto || direccion.length < 3 || descripcion.length < 5}
        className="mt-3 rounded-lg bg-azul px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
      >
        {pendiente ? "Guardando…" : "Registrar demanda"}
      </button>
    </Panel>
  );
}
