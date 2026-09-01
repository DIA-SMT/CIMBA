"use client";

import { Camera, Check, LocateFixed, MapPin, Mic, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { reportarItemHecho, reportarItemNoEncontrado } from "@/lib/acciones-ordenes";
import { useDictadoVoz } from "@/lib/dictado";
import type { ItemOrden } from "@/lib/ordenes";
import { BarraConfianza, Panel } from "@/components/ui";

const ETIQUETA_TRABAJO: Record<string, string> = {
  bache: "Bache",
  carpeta: "Carpeta",
  tramo: "Tramo",
};

/** El teclado del teléfono mete coma decimal: se normaliza antes de parsear. */
const aNumero = (s: string) => Number(s.trim().replace(",", "."));

/** Mismo bounding box que valida la acción: mejor avisar acá que con un error zod críptico. */
const dentroDeSmt = (lat: number, lon: number) =>
  lat >= -27.2 && lat <= -26.5 && lon >= -65.6 && lon <= -64.9;

interface Ubicacion {
  lat: number;
  lon: number;
  /** Lo que dijo/escribió el capataz: viaja como direccionCorregida. */
  direccion?: string;
  origen: "orden" | "geocoder" | "gps";
  detalle: string;
  precisionM?: number;
}

/**
 * Un bache pendiente de la orden, con el formulario de reporte adentro.
 * Pensado para el capataz con guantes: targets grandes, un solo camino feliz,
 * y la ubicación se resuelve dictando, escribiendo o con el GPS del teléfono.
 */
export function TarjetaItem({ item }: { item: ItemOrden }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // medidas
  const [ancho, setAncho] = useState("");
  const [largo, setLargo] = useState("");
  const [espesor, setEspesor] = useState("");
  const [obs, setObs] = useState("");

  // fotos
  const refDespues = useRef<HTMLInputElement>(null);
  const refAntes = useRef<HTMLInputElement>(null);
  const [fotoDespues, setFotoDespues] = useState<File | null>(null);
  const [fotoAntes, setFotoAntes] = useState<File | null>(null);
  const [previewDespues, setPreviewDespues] = useState<string | null>(null);
  const [previewAntes, setPreviewAntes] = useState<string | null>(null);

  // ubicación
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(
    item.lat != null && item.lon != null
      ? { lat: item.lat, lon: item.lon, origen: "orden", detalle: "Ubicación de la orden" }
      : null,
  );
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [direccionTexto, setDireccionTexto] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [buscandoGps, setBuscandoGps] = useState(false);
  const [errorGeo, setErrorGeo] = useState<string | null>(null);
  const [resultadoGeo, setResultadoGeo] = useState<{
    lat: number;
    lon: number;
    confianza: number;
    /** Lo que devolvió el geocoder, para que el capataz confirme que es SU esquina. */
    resuelta: string;
    /** Lo que dictó/escribió él, que es lo que se guarda. */
    texto: string;
  } | null>(null);

  const buscarDireccion = async (texto: string) => {
    const q = texto.trim();
    if (q.length < 4) {
      setErrorGeo("Escribí la dirección un poco más completa (calle y altura).");
      return;
    }
    setBuscando(true);
    setErrorGeo(null);
    setResultadoGeo(null);
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
      setResultadoGeo({
        lat: data.resultado.punto.lat,
        lon: data.resultado.punto.lon,
        confianza: data.resultado.confianza,
        resuelta: data.resultado.direccionResuelta ?? q,
        texto: q,
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
        setUbicacion({
          lat: latitude,
          lon: longitude,
          origen: "gps",
          detalle: `Tu GPS (±${Math.round(accuracy)} m)`,
          precisionM: Math.round(accuracy),
        });
        setCorrigiendo(false);
        setResultadoGeo(null);
      },
      () => {
        setBuscandoGps(false);
        setErrorGeo("No se pudo leer el GPS: activá la ubicación del teléfono y dale permiso al navegador.");
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  const elegirFoto = (
    archivo: File | undefined,
    setFoto: (f: File | null) => void,
    setPreview: (u: string | null) => void,
    previewAnterior: string | null,
  ) => {
    if (previewAnterior) URL.revokeObjectURL(previewAnterior);
    if (!archivo) {
      setFoto(null);
      setPreview(null);
      return;
    }
    setFoto(archivo);
    setPreview(URL.createObjectURL(archivo));
  };

  const anchoN = aNumero(ancho);
  const largoN = aNumero(largo);
  const superficie = anchoN > 0 && largoN > 0 ? anchoN * largoN : null;

  const enviar = () => {
    setError(null);
    if (!(anchoN > 0) || !(largoN > 0) || !(aNumero(espesor) > 0)) {
      setError("Cargá el ancho, el largo y el espesor.");
      return;
    }
    if (!fotoDespues) {
      setError("Falta la foto del trabajo terminado (es obligatoria).");
      return;
    }
    if (!ubicacion) {
      setError("Falta la ubicación: dictá la dirección, escribila o usá tu GPS.");
      return;
    }

    const fd = new FormData();
    fd.set("itemId", String(item.id));
    fd.set("anchoM", String(anchoN));
    fd.set("largoM", String(largoN));
    fd.set("espesorCm", String(aNumero(espesor)));
    if (obs.trim()) fd.set("observaciones", obs.trim());
    // Solo se manda ubicación si es una corrección: si es la de la orden,
    // la acción ya la toma del propio item.
    if (ubicacion.origen !== "orden") {
      fd.set("lat", String(ubicacion.lat));
      fd.set("lon", String(ubicacion.lon));
      if (ubicacion.direccion) fd.set("direccionCorregida", ubicacion.direccion);
    }
    fd.set("foto", fotoDespues);
    if (fotoAntes) fd.set("fotoAntes", fotoAntes);

    startTransition(async () => {
      try {
        await reportarItemHecho(fd);
        // al refrescar, el server component mueve este item a la lista de hechos
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo reportar: probá de nuevo.");
      }
    });
  };

  const noEncontrado = () => {
    const motivo = window.prompt(
      "¿Por qué no se encontró? (ej.: ya estaba tapado, la dirección no existe)",
    );
    if (!motivo || motivo.trim().length < 3) return;
    setError(null);
    startTransition(async () => {
      try {
        await reportarItemNoEncontrado({ itemId: item.id, motivo: motivo.trim() });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo reportar: probá de nuevo.");
      }
    });
  };

  const mostrarPicker = ubicacion == null || corrigiendo;

  return (
    <Panel className="p-4">
      <p className="text-lg leading-snug font-bold">{item.direccion ?? "Sin dirección"}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="rounded bg-panel-3 px-2 py-1 text-[11px] font-bold text-texto-2 uppercase">
          {ETIQUETA_TRABAJO[item.tipoTrabajo] ?? item.tipoTrabajo}
        </span>
        {item.reclamos > 0 && (
          <span className="rounded bg-amarillo/15 px-2 py-1 text-[11px] font-bold text-amarillo">
            {item.reclamos === 1 ? "1 reclamo detrás" : `${item.reclamos} reclamos detrás`}
          </span>
        )}
      </div>

      {error && <p className="mt-2 text-sm font-medium text-peligro">{error}</p>}

      {!abierto ? (
        <div className="mt-3 space-y-2">
          <button
            onClick={() => setAbierto(true)}
            className="w-full rounded-xl bg-azul px-4 py-4 text-base font-bold text-white transition active:scale-[0.99]"
          >
            REPORTAR HECHO
          </button>
          <button
            onClick={noEncontrado}
            disabled={pendiente}
            className="w-full rounded-lg px-3 py-2 text-sm text-texto-3 transition hover:text-texto-2 disabled:opacity-50"
          >
            No lo encontré
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {/* Medidas reales */}
          <div>
            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-texto-2">Ancho (m)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step={0.1}
                  min={0}
                  value={ancho}
                  onChange={(e) => setAncho(e.target.value)}
                  className="num w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3.5 text-lg"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-texto-2">Largo (m)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step={0.1}
                  min={0}
                  value={largo}
                  onChange={(e) => setLargo(e.target.value)}
                  className="num w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3.5 text-lg"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-texto-2">Espesor (cm)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step={0.1}
                  min={0}
                  value={espesor}
                  onChange={(e) => setEspesor(e.target.value)}
                  className="num w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3.5 text-lg"
                />
              </label>
            </div>
            {superficie != null && (
              <p className="num mt-2 text-xl font-extrabold text-celeste">
                = {superficie.toLocaleString("es-AR", { maximumFractionDigits: 2 })} m²
              </p>
            )}
            <p className="mt-1 text-xs leading-relaxed text-texto-3">
              Medí lo que realmente pavimentaste: a veces es un bache pero se hace el paño entero.
            </p>
          </div>

          {/* Fotos: el después manda */}
          <div className="grid grid-cols-2 gap-2">
            <input
              ref={refDespues}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) =>
                elegirFoto(e.target.files?.[0], setFotoDespues, setPreviewDespues, previewDespues)
              }
            />
            <input
              ref={refAntes}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => elegirFoto(e.target.files?.[0], setFotoAntes, setPreviewAntes, previewAntes)}
            />
            <button
              onClick={() => refDespues.current?.click()}
              className={`relative h-28 overflow-hidden rounded-xl border-2 transition ${
                fotoDespues ? "border-resuelto/60" : "border-dashed border-borde-2 hover:border-resuelto/60"
              }`}
            >
              {previewDespues ? (
                <>
                  <img src={previewDespues} alt="Foto del después" loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-bold text-white">
                    DESPUÉS ✓ — tocá para cambiar
                  </span>
                </>
              ) : (
                <span className="flex h-full flex-col items-center justify-center gap-1 text-sm font-bold">
                  <Camera size={22} className="text-resuelto" />
                  Foto del DESPUÉS
                  <span className="text-[10px] font-medium text-texto-3">obligatoria</span>
                </span>
              )}
            </button>
            <button
              onClick={() => refAntes.current?.click()}
              className={`relative h-28 overflow-hidden rounded-xl border-2 transition ${
                fotoAntes ? "border-celeste/60" : "border-dashed border-borde-2 hover:border-celeste/60"
              }`}
            >
              {previewAntes ? (
                <>
                  <img src={previewAntes} alt="Foto del antes" loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-bold text-white">
                    ANTES ✓ — tocá para cambiar
                  </span>
                </>
              ) : (
                <span className="flex h-full flex-col items-center justify-center gap-1 text-sm font-bold">
                  <Camera size={22} className="text-celeste" />
                  Foto del ANTES
                  <span className="text-[10px] font-medium text-texto-3">opcional</span>
                </span>
              )}
            </button>
          </div>

          {/* Ubicación */}
          {!mostrarPicker && ubicacion && (
            <div>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-resuelto/40 bg-resuelto/10 px-3 py-3">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Check size={16} className="shrink-0 text-resuelto" />
                  {ubicacion.detalle} ✓
                </span>
                <button
                  onClick={() => setCorrigiendo(true)}
                  className="shrink-0 rounded-lg border border-borde-2 px-3 py-2 text-xs font-semibold text-texto-2 transition hover:border-amarillo/60 hover:text-amarillo"
                >
                  Corregir ubicación
                </button>
              </div>
              {ubicacion.precisionM != null && ubicacion.precisionM > 30 && (
                <p className="mt-1 text-xs text-amarillo">
                  La precisión del GPS es baja (±{ubicacion.precisionM} m): si podés, esperá unos
                  segundos al lado del bache y volvé a tomarla.
                </p>
              )}
            </div>
          )}

          {mostrarPicker && (
            <div className="space-y-2 rounded-xl border border-amarillo/40 bg-amarillo/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-bold text-amarillo">
                  <MapPin size={15} />
                  {ubicacion ? "Corregir la ubicación" : "Falta la ubicación del trabajo"}
                </p>
                {ubicacion && (
                  <button
                    onClick={() => {
                      setCorrigiendo(false);
                      setResultadoGeo(null);
                      setErrorGeo(null);
                      dictado.limpiarError();
                    }}
                    className="text-xs text-texto-3 hover:text-texto"
                  >
                    Cancelar
                  </button>
                )}
              </div>

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

              {resultadoGeo && (
                <div className="rounded-lg border border-borde-2 bg-panel-2 p-3">
                  <p className="text-sm leading-snug">{resultadoGeo.resuelta}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <BarraConfianza valor={resultadoGeo.confianza} />
                    <button
                      onClick={() => {
                        setUbicacion({
                          lat: resultadoGeo.lat,
                          lon: resultadoGeo.lon,
                          direccion: resultadoGeo.texto,
                          origen: "geocoder",
                          detalle: resultadoGeo.texto,
                        });
                        setCorrigiendo(false);
                        setResultadoGeo(null);
                        setErrorGeo(null);
                      }}
                      className="rounded-lg bg-azul px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
                    >
                      Usar esta ✓
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Observaciones */}
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            placeholder="Observaciones (opcional)"
            className="w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3 text-base placeholder:text-texto-3"
          />

          <button
            onClick={enviar}
            disabled={pendiente}
            className="w-full rounded-xl bg-resuelto px-4 py-4 text-base font-bold text-white transition active:scale-[0.99] disabled:opacity-50"
          >
            {pendiente ? "Subiendo foto…" : "CONFIRMAR TRABAJO HECHO"}
          </button>
          <button
            onClick={() => setAbierto(false)}
            disabled={pendiente}
            className="w-full rounded-lg px-3 py-2 text-sm text-texto-3 transition hover:text-texto-2 disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      )}
    </Panel>
  );
}
