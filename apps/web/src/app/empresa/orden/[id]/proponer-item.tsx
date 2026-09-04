"use client";

import { Camera, LocateFixed, Mic, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { dentroDeSMT } from "@cimba/domain";
import { proponerItem } from "@/lib/acciones-ordenes";
import { useDictadoVoz } from "@/lib/dictado";
import { BarraConfianza } from "@/components/ui";
import { MiniMapa } from "@/components/mapa/mini-mapa";

/** Mismo bounding box laxo que valida la acción (ver tarjeta-item). */
const dentroDeSmt = (lat: number, lon: number) =>
  lat >= -27.2 && lat <= -26.5 && lon >= -65.6 && lon <= -64.9;

interface Candidato {
  lat: number;
  lon: number;
  origen: "geocoder" | "gps";
  resuelta?: string;
  confianza?: number;
  precisionM?: number;
  ajustado?: boolean;
}

interface Ubicacion {
  lat: number;
  lon: number;
  detalle: string;
}

/**
 * "Encontramos un bache que no está en la orden": la cuadrilla lo propone
 * desde la calle y entra como item 'propuesto' — no cuenta para nada hasta
 * que Bacheo lo valide. Mismo patrón de ubicación que el reporte de la
 * tarjeta (dictado / geocoder / GPS + pin afinable en el mini-mapa).
 */
export function ProponerItem({ ordenId }: { ordenId: number }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tipoTrabajo, setTipoTrabajo] = useState<"bache" | "carpeta">("bache");
  const [obs, setObs] = useState("");

  // foto opcional
  const refFoto = useRef<HTMLInputElement>(null);
  const [foto, setFoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // ubicación: acá NO hay punto de la orden — siempre se resuelve de cero
  const [direccionTexto, setDireccionTexto] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [buscandoGps, setBuscandoGps] = useState(false);
  const [errorGeo, setErrorGeo] = useState<string | null>(null);
  const [candidato, setCandidato] = useState<Candidato | null>(null);
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(null);

  const buscarDireccion = async (texto: string) => {
    const q = texto.trim();
    if (q.length < 4) {
      setErrorGeo("Escribí la dirección un poco más completa (calle y altura).");
      return;
    }
    setBuscando(true);
    setErrorGeo(null);
    setCandidato(null);
    try {
      const res = await fetch(`/api/geocodificar?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as {
        resultado: {
          punto: { lat: number; lon: number };
          confianza: number;
          direccionResuelta: string | null;
        } | null;
      };
      if (!data.resultado) {
        setErrorGeo("No se encontró esa dirección: probá con calle y altura, sin barrio.");
        return;
      }
      setCandidato({
        lat: data.resultado.punto.lat,
        lon: data.resultado.punto.lon,
        origen: "geocoder",
        confianza: data.resultado.confianza,
        resuelta: data.resultado.direccionResuelta ?? q,
      });
    } catch {
      setErrorGeo("Falló la búsqueda: fijate la señal y probá de nuevo.");
    } finally {
      setBuscando(false);
    }
  };

  const dictado = useDictadoVoz((frase) => {
    setDireccionTexto(frase);
    void buscarDireccion(frase);
  });

  const usarGps = () => {
    if (!navigator.geolocation) {
      setErrorGeo("Este teléfono no expone el GPS al navegador.");
      return;
    }
    setBuscandoGps(true);
    setErrorGeo(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBuscandoGps(false);
        const { latitude, longitude, accuracy } = pos.coords;
        if (!dentroDeSmt(latitude, longitude)) {
          setErrorGeo("El GPS te ubica fuera de San Miguel de Tucumán: probá de nuevo al lado del bache.");
          return;
        }
        setCandidato({
          lat: latitude,
          lon: longitude,
          origen: "gps",
          precisionM: Math.round(accuracy),
        });
      },
      () => {
        setBuscandoGps(false);
        setErrorGeo("No se pudo leer el GPS: activá la ubicación del teléfono y dale permiso al navegador.");
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  const elegirFoto = (archivo: File | undefined) => {
    if (preview) URL.revokeObjectURL(preview);
    if (!archivo) {
      setFoto(null);
      setPreview(null);
      return;
    }
    setFoto(archivo);
    setPreview(URL.createObjectURL(archivo));
  };

  const cerrar = () => {
    setAbierto(false);
    setError(null);
    setErrorGeo(null);
    setCandidato(null);
    dictado.limpiarError();
  };

  const enviar = () => {
    setError(null);
    if (direccionTexto.trim().length < 4) {
      setError("Cargá la dirección del bache (podés dictarla).");
      return;
    }
    if (!ubicacion) {
      setError("Falta el punto en el mapa: buscá la dirección o usá tu GPS y confirmá el pin.");
      return;
    }
    const fd = new FormData();
    fd.set("ordenId", String(ordenId));
    fd.set("direccion", direccionTexto.trim());
    fd.set("tipoTrabajo", tipoTrabajo);
    fd.set("lat", String(ubicacion.lat));
    fd.set("lon", String(ubicacion.lon));
    if (obs.trim()) fd.set("observaciones", obs.trim());
    if (foto) fd.set("foto", foto);

    startTransition(async () => {
      try {
        await proponerItem(fd);
        // Reset completo: el propuesto aparece en la lista al refrescar.
        setAbierto(false);
        setDireccionTexto("");
        setUbicacion(null);
        setCandidato(null);
        setObs("");
        elegirFoto(undefined);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo enviar: probá de nuevo.");
      }
    });
  };

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-borde-2 px-4 py-4 text-base font-bold text-texto-2 transition hover:border-celeste/60 hover:text-celeste active:scale-[0.99]"
      >
        <Plus size={20} />
        Encontramos un bache que no está en la orden
      </button>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-celeste/40 bg-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-base font-bold">Proponer un bache nuevo</p>
        <button onClick={cerrar} disabled={pendiente} className="text-sm text-texto-3 hover:text-texto">
          Cancelar
        </button>
      </div>
      <p className="text-sm leading-relaxed text-texto-2">
        Entra como <b>propuesto</b>: la Dirección de Bacheo lo revisa y, si lo valida, aparece en tus
        pendientes para trabajarlo.
      </p>

      {/* Dirección: dictado / escrita / GPS, con pin afinable */}
      <div className="space-y-2">
        <input
          value={direccionTexto}
          onChange={(e) => setDireccionTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void buscarDireccion(direccionTexto);
          }}
          placeholder={dictado.escuchando ? "Escuchando… decí la dirección" : "Calle y altura, ej: Las Piedras 1500"}
          className="w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3.5 text-base placeholder:text-texto-3"
        />
        <div className="grid grid-cols-3 gap-2">
          {dictado.hayVoz && (
            <button
              onClick={() => {
                dictado.limpiarError();
                dictado.alternar();
              }}
              className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl border text-xs font-bold transition ${
                dictado.escuchando
                  ? "animate-pulse border-peligro/60 bg-peligro/15 text-peligro"
                  : "border-borde-2 bg-panel-2 hover:border-celeste"
              }`}
            >
              <Mic size={20} className={dictado.escuchando ? "" : "text-celeste"} />
              {dictado.escuchando ? "Escuchando…" : "Dictar"}
            </button>
          )}
          <button
            onClick={() => void buscarDireccion(direccionTexto)}
            disabled={buscando}
            className="flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-borde-2 bg-panel-2 text-xs font-bold transition hover:border-celeste disabled:opacity-50"
          >
            <Search size={20} className="text-celeste" />
            {buscando ? "Buscando…" : "Ubicar"}
          </button>
          <button
            onClick={usarGps}
            disabled={buscandoGps}
            className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-borde-2 bg-panel-2 text-xs font-bold transition hover:border-celeste disabled:opacity-50 ${
              dictado.hayVoz ? "" : "col-span-2"
            }`}
          >
            <LocateFixed size={20} className="text-celeste" />
            {buscandoGps ? "Leyendo GPS…" : "Usar mi GPS"}
          </button>
        </div>

        {(errorGeo || dictado.error) && (
          <p className="text-xs leading-relaxed text-peligro">{errorGeo ?? dictado.error}</p>
        )}

        {candidato && (
          <div className="rounded-lg border border-borde-2 bg-panel-2 p-3">
            <p className="text-sm leading-snug">
              {candidato.origen === "gps" ? `Tu GPS (±${candidato.precisionM ?? "?"} m)` : candidato.resuelta}
            </p>
            <div className="mt-2">
              <MiniMapa
                lat={candidato.lat}
                lon={candidato.lon}
                etiqueta={candidato.resuelta ?? direccionTexto}
                alto={200}
                alMover={({ lat, lon }) =>
                  setCandidato((c) => (c ? { ...c, lat, lon, ajustado: true } : c))
                }
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              {candidato.origen === "geocoder" && candidato.confianza != null ? (
                <BarraConfianza valor={candidato.confianza} />
              ) : (
                <span />
              )}
              <button
                onClick={() => {
                  const c = candidato;
                  // Misma frontera operativa que el server, con mensaje claro acá.
                  if (!dentroDeSMT({ lat: c.lat, lon: c.lon })) {
                    setErrorGeo("El pin quedó fuera de San Miguel de Tucumán: acercalo al bache");
                    return;
                  }
                  setUbicacion({
                    lat: c.lat,
                    lon: c.lon,
                    detalle: c.ajustado
                      ? "Pin ajustado en el mapa"
                      : c.origen === "gps"
                        ? `Tu GPS (±${c.precisionM ?? "?"} m)`
                        : (c.resuelta ?? "Dirección geocodificada"),
                  });
                  setCandidato(null);
                  setErrorGeo(null);
                }}
                className="rounded-lg bg-azul px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
              >
                Usar esta ✓
              </button>
            </div>
          </div>
        )}

        {ubicacion && !candidato && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-resuelto/40 bg-resuelto/10 px-3 py-3">
            <span className="text-sm font-semibold">{ubicacion.detalle} ✓</span>
            <button
              onClick={() => {
                setUbicacion(null);
              }}
              className="shrink-0 rounded-lg border border-borde-2 px-3 py-2 text-xs font-semibold text-texto-2 transition hover:border-amarillo/60 hover:text-amarillo"
            >
              Corregir
            </button>
          </div>
        )}
      </div>

      {/* Qué pide el punto: bache puntual o carpeta del paño */}
      <div>
        <p className="mb-1.5 text-xs font-semibold text-texto-2">¿Qué necesita?</p>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { valor: "bache", etiqueta: "Bache" },
              { valor: "carpeta", etiqueta: "Carpeta (paño entero)" },
            ] as const
          ).map((op) => (
            <button
              key={op.valor}
              type="button"
              onClick={() => setTipoTrabajo(op.valor)}
              className={`min-h-14 rounded-xl border-2 px-3 py-2.5 text-sm leading-snug font-bold transition active:scale-[0.99] ${
                tipoTrabajo === op.valor
                  ? "border-azul bg-azul/15 text-celeste"
                  : "border-borde-2 bg-panel-2 text-texto-2 hover:border-celeste/60"
              }`}
            >
              {op.etiqueta}
            </button>
          ))}
        </div>
      </div>

      {/* Foto del bache (opcional, pero ayuda a que lo validen rápido) */}
      <input
        ref={refFoto}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => elegirFoto(e.target.files?.[0])}
      />
      <button
        onClick={() => refFoto.current?.click()}
        className={`relative h-28 w-full overflow-hidden rounded-xl border-2 transition ${
          foto ? "border-celeste/60" : "border-dashed border-borde-2 hover:border-celeste/60"
        }`}
      >
        {preview ? (
          <>
            <img src={preview} alt="Foto del bache propuesto" loading="lazy" className="h-full w-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-bold text-white">
              FOTO ✓ — tocá para cambiar
            </span>
          </>
        ) : (
          <span className="flex h-full flex-col items-center justify-center gap-1 text-sm font-bold">
            <Camera size={22} className="text-celeste" />
            Foto del bache
            <span className="text-[10px] font-medium text-texto-3">opcional, ayuda a validarlo</span>
          </span>
        )}
      </button>

      <textarea
        value={obs}
        onChange={(e) => setObs(e.target.value)}
        rows={2}
        placeholder="Observaciones (opcional): tamaño, si corta el paso…"
        className="w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3 text-base placeholder:text-texto-3"
      />

      {error && <p className="text-sm font-medium text-peligro">{error}</p>}

      <button
        onClick={enviar}
        disabled={pendiente}
        className="w-full rounded-xl bg-azul px-4 py-4 text-base font-bold text-white transition active:scale-[0.99] disabled:opacity-50"
      >
        {pendiente ? "Enviando…" : "PROPONER A BACHEO"}
      </button>
    </div>
  );
}
