"use client";

import { Camera, CheckCircle2, LocateFixed, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { finalizarIntervencion, iniciarIntervencion, subirFoto } from "@/lib/acciones";
import { Panel } from "@/components/ui";

interface Trabajo {
  id: number;
  incidenteId: number;
  estado: string;
  direccion: string | null;
  cuadrilla: string | null;
  fotos: number;
}

function obtenerGps(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolver) => {
    if (!navigator.geolocation) return resolver(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolver({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolver(null),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  });
}

export function TarjetaCampo({ intervencion }: { intervencion: Trabajo }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [m2, setM2] = useState("");
  const [obs, setObs] = useState("");
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const refAntes = useRef<HTMLInputElement>(null);
  const refDespues = useRef<HTMLInputElement>(null);

  const ejecutar = (fn: () => Promise<unknown>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      }
    });
  };

  const iniciar = async () => {
    const gps = await obtenerGps();
    ejecutar(() => iniciarIntervencion({ intervencionId: intervencion.id, ...(gps ?? {}) }));
  };

  const foto = async (momento: "antes" | "despues", archivo: File | undefined) => {
    if (!archivo) return;
    setSubiendo(momento);
    setError(null);
    try {
      const gps = await obtenerGps();
      const fd = new FormData();
      fd.set("intervencionId", String(intervencion.id));
      fd.set("momento", momento);
      fd.set("archivo", archivo);
      if (gps) {
        fd.set("lat", String(gps.lat));
        fd.set("lon", String(gps.lon));
      }
      await subirFoto(fd);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo subir la foto");
    } finally {
      setSubiendo(null);
    }
  };

  const enCurso = intervencion.estado === "en_curso";

  return (
    <Panel className="p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="num text-sm font-bold">#{intervencion.id}</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                enCurso ? "bg-encurso/15 text-encurso" : "bg-abierto/15 text-abierto"
              }`}
            >
              {enCurso ? "En curso" : "Asignada"}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium">{intervencion.direccion ?? "Sin dirección"}</p>
          {intervencion.cuadrilla && <p className="text-xs text-texto-3">{intervencion.cuadrilla}</p>}
        </div>
        <span className="num text-xs text-texto-3">📷 {intervencion.fotos}</span>
      </div>

      {error && <p className="mb-2 text-xs text-peligro">{error}</p>}

      {!enCurso ? (
        <button
          disabled={pendiente}
          onClick={() => void iniciar()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-azul px-4 py-3.5 font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
        >
          <Play size={16} /> Iniciar trabajo
          <span className="flex items-center gap-1 text-xs font-normal opacity-80">
            <LocateFixed size={12} /> toma GPS
          </span>
        </button>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              ref={refAntes}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void foto("antes", e.target.files?.[0])}
            />
            <input
              ref={refDespues}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void foto("despues", e.target.files?.[0])}
            />
            <button
              onClick={() => refAntes.current?.click()}
              disabled={subiendo !== null}
              className="flex items-center justify-center gap-2 rounded-xl border border-borde-2 bg-panel-2 px-3 py-3 text-sm font-semibold transition hover:border-celeste disabled:opacity-50"
            >
              <Camera size={15} className="text-celeste" />
              {subiendo === "antes" ? "Subiendo…" : "Foto ANTES"}
            </button>
            <button
              onClick={() => refDespues.current?.click()}
              disabled={subiendo !== null}
              className="flex items-center justify-center gap-2 rounded-xl border border-borde-2 bg-panel-2 px-3 py-3 text-sm font-semibold transition hover:border-resuelto disabled:opacity-50"
            >
              <Camera size={15} className="text-resuelto" />
              {subiendo === "despues" ? "Subiendo…" : "Foto DESPUÉS"}
            </button>
          </div>

          <div className="flex gap-2">
            <input
              value={m2}
              onChange={(e) => setM2(e.target.value)}
              inputMode="decimal"
              placeholder="m²"
              className="num w-20 rounded-lg border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm placeholder:text-texto-3"
            />
            <input
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Observaciones (opcional)"
              className="flex-1 rounded-lg border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm placeholder:text-texto-3"
            />
          </div>

          <button
            disabled={pendiente}
            onClick={() =>
              ejecutar(() =>
                finalizarIntervencion({
                  intervencionId: intervencion.id,
                  superficieM2: m2 ? Number(m2.replace(",", ".")) : undefined,
                  observaciones: obs || undefined,
                }),
              )
            }
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-resuelto px-4 py-3.5 font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
          >
            <CheckCircle2 size={16} /> Finalizar — incidente reparado
          </button>
          <p className="text-center text-[10px] text-texto-3">
            Para finalizar hacen falta la foto de antes y la de después.
          </p>
        </div>
      )}
    </Panel>
  );
}
