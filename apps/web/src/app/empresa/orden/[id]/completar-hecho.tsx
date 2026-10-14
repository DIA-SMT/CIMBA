"use client";

import { Camera, ClipboardPaste, LocateFixed, MapPin, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ClipboardEvent } from "react";
import { dentroDeSMT } from "@cimba/domain";
import { completarItemHecho } from "@/lib/acciones-ordenes";
import { comprimirFoto, pesoCorto } from "@/lib/comprimir-foto";
import { AvisosFotoUsada, useFotosUsadas } from "@/components/aviso-foto-usada";
import { MiniMapa } from "@/components/mapa/mini-mapa";
import { mensajeDeError } from "@/lib/errores";
import { describirPrecision, mejorPosicion } from "@/lib/gps";
import { Achicando } from "./tarjeta-item";

type Momento = "antes" | "despues";

/**
 * COMPLETAR UN BACHE YA HECHO: la foto que faltó y, si no tenía, el lugar.
 *
 * Es la otra mitad de la planilla de Ingeco (13/10/2026): los baches entraron
 * hechos, con su fecha y su volumen, y la empresa los completa después.
 *
 * Las fotos casi siempre ya existen —están en el teléfono del capataz o en un
 * grupo de WhatsApp—, así que acá el cuadro NO abre la cámara directo como en
 * la carga en la calle: deja elegir de la galería o de la computadora. Y en la
 * computadora se puede PEGAR una foto copiada (Ctrl+V) o ARRASTRARLA desde
 * WhatsApp Web o desde una carpeta, que era lo que pedía la inspectora: bajar
 * cada foto para volver a subirla era lo lento. Se pierde la fecha y el GPS de
 * la foto; no importa, la fecha del trabajo ya la tiene el bache.
 */
export function CompletarHecho({
  itemId,
  direccion,
  faltaUbicar,
  puntoSugerido,
  tieneAntes,
  tieneDespues,
}: {
  itemId: number;
  direccion: string | null;
  faltaUbicar: boolean;
  /** Dónde lo ubicó aproximadamente el callejero, si llegó: el pin arranca ahí. */
  puntoSugerido: { lat: number; lon: number } | null;
  tieneAntes: boolean;
  tieneDespues: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Ubicación (solo si el bache no tenía lugar)
  const [punto, setPunto] = useState<{ lat: number; lon: number } | null>(puntoSugerido);
  const [texto, setTexto] = useState(direccion ?? "");
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(
    puntoSugerido ? "El pin está donde lo ubicó el sistema por la dirección: puede estar corrido. Movelo hasta el bache." : null,
  );

  // Fotos
  const [fotos, setFotos] = useState<Partial<Record<Momento, File>>>({});
  const [previews, setPreviews] = useState<Partial<Record<Momento, string>>>({});
  const [preparando, setPreparando] = useState<Partial<Record<Momento, boolean>>>({});
  const [ahorro, setAhorro] = useState<string | null>(null);
  const [destino, setDestino] = useState<Momento>(tieneDespues ? "antes" : "despues");
  const { revisiones, revisar } = useFotosUsadas();
  const refAntes = useRef<HTMLInputElement>(null);
  const refDespues = useRef<HTMLInputElement>(null);

  const cuadros: Momento[] = [...(tieneAntes ? [] : ["antes" as const]), ...(tieneDespues ? [] : ["despues" as const])];

  // Las vistas previas son URLs del navegador: se liberan al cerrar.
  useEffect(
    () => () => {
      for (const u of Object.values(previews)) if (u) URL.revokeObjectURL(u);
    },
    [],
  );

  const ponerFoto = async (momento: Momento, archivo: File | null | undefined) => {
    if (!archivo) return;
    if (!archivo.type.startsWith("image/")) {
      setError("Eso no es una foto: elegí una imagen (JPG, PNG o WEBP).");
      return;
    }
    setError(null);
    setPreparando((v) => ({ ...v, [momento]: true }));
    try {
      const { archivo: listo, antes, despues } = await comprimirFoto(archivo);
      setFotos((v) => ({ ...v, [momento]: listo }));
      setPreviews((v) => {
        if (v[momento]) URL.revokeObjectURL(v[momento]!);
        return { ...v, [momento]: URL.createObjectURL(listo) };
      });
      if (despues < antes) setAhorro(`${pesoCorto(antes)} → ${pesoCorto(despues)}`);
      revisar(momento, listo);
      // La próxima foto pegada va al otro cuadro, si falta.
      const otro: Momento = momento === "despues" ? "antes" : "despues";
      if (cuadros.includes(otro)) setDestino(otro);
    } finally {
      setPreparando((v) => ({ ...v, [momento]: false }));
    }
  };

  /** Ctrl+V con una foto copiada (de WhatsApp Web, del visor, de una captura). */
  const alPegar = (e: ClipboardEvent) => {
    const imagen = Array.from(e.clipboardData.items).find((i) => i.kind === "file" && i.type.startsWith("image/"));
    const archivo = imagen?.getAsFile();
    if (!archivo) return;
    e.preventDefault();
    void ponerFoto(destino, archivo);
  };

  const buscar = async () => {
    const q = texto.trim();
    if (q.length < 4) {
      setAviso("Escribí la dirección un poco más completa (calle y altura).");
      return;
    }
    setBuscando(true);
    setAviso(null);
    try {
      const res = await fetch(`/api/geocodificar?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as { resultado: { punto: { lat: number; lon: number } } | null };
      if (!data.resultado) {
        setAviso("No se encontró esa dirección: probá con calle y altura, sin barrio.");
        return;
      }
      setPunto(data.resultado.punto);
      setAviso("Revisá el pin: arrastralo hasta el bache si quedó corrido.");
    } catch {
      setAviso("Falló la búsqueda: fijate la señal y probá de nuevo.");
    } finally {
      setBuscando(false);
    }
  };

  const usarGps = async () => {
    setBuscando(true);
    setAviso(null);
    try {
      const fix = await mejorPosicion();
      if (!dentroDeSMT({ lat: fix.lat, lon: fix.lon })) {
        setAviso("El GPS te ubica fuera de San Miguel de Tucumán: probá de nuevo al lado del bache.");
        return;
      }
      setPunto({ lat: fix.lat, lon: fix.lon });
      setAviso(`Tu GPS (${describirPrecision(fix.precisionM).texto}): arrastrá el pin hasta el bache si hace falta.`);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "No se pudo leer el GPS.");
    } finally {
      setBuscando(false);
    }
  };

  const ocupado = pendiente || buscando || Object.values(preparando).some(Boolean);
  const hayAlgo = Object.keys(fotos).length > 0 || (faltaUbicar && punto != null);

  const guardar = () => {
    setError(null);
    if (faltaUbicar && !punto) {
      setError("Falta ubicar el bache: buscá la dirección o usá el GPS y ajustá el pin.");
      return;
    }
    if (!hayAlgo) {
      setError("Elegí una foto o marcá el bache en el mapa: no hay nada para guardar.");
      return;
    }
    const fd = new FormData();
    fd.set("itemId", String(itemId));
    if (faltaUbicar && punto) {
      fd.set("lat", String(punto.lat));
      fd.set("lon", String(punto.lon));
      if (texto.trim() && texto.trim() !== (direccion ?? "").trim()) fd.set("direccion", texto.trim());
    }
    if (fotos.despues) fd.set("foto", fotos.despues);
    if (fotos.antes) fd.set("fotoAntes", fotos.antes);
    startTransition(async () => {
      try {
        await completarItemHecho(fd);
        setAbierto(false);
        setFotos({});
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo guardar: probá de nuevo."));
      }
    });
  };

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-azul px-4 text-sm font-semibold text-white transition hover:brightness-110"
      >
        <Camera size={15} /> Completar
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-celeste/40 bg-celeste/5 p-3" onPaste={alPegar}>
      {faltaUbicar && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-bold text-amarillo">
            <MapPin size={15} /> Dónde está el bache
          </p>
          <div className="flex gap-2">
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void buscar();
                }
              }}
              placeholder="Calle y altura, ej: Las Piedras 1500"
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-borde-2 bg-panel-2 px-3 text-sm placeholder:text-texto-3"
            />
            <button
              type="button"
              onClick={() => void buscar()}
              disabled={buscando}
              className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-borde-2 px-3 text-xs font-semibold text-texto-2 hover:border-celeste hover:text-celeste disabled:opacity-40"
            >
              <Search size={14} /> Ubicar
            </button>
            <button
              type="button"
              onClick={() => void usarGps()}
              disabled={buscando}
              className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-borde-2 px-3 text-xs font-semibold text-texto-2 hover:border-celeste hover:text-celeste disabled:opacity-40"
              title="Usar la ubicación de este teléfono"
            >
              <LocateFixed size={14} /> GPS
            </button>
          </div>
          {punto ? (
            <MiniMapa lat={punto.lat} lon={punto.lon} etiqueta={texto || direccion} alMover={setPunto} alto={240} conRedVial />
          ) : (
            <p className="text-xs text-texto-3">Buscá la dirección o usá el GPS: después ajustás el pin en el mapa.</p>
          )}
          {aviso && <p className="text-xs text-amarillo">{aviso}</p>}
        </div>
      )}

      {cuadros.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-bold text-texto">
            <Camera size={15} /> {cuadros.length === 2 ? "Las fotos" : cuadros[0] === "despues" ? "La foto del después" : "La foto del antes"}
          </p>
          <div className={`grid gap-2 ${cuadros.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
            {cuadros.map((m) => {
              const ref = m === "antes" ? refAntes : refDespues;
              const elegida = previews[m];
              return (
                <div key={m}>
                  <input
                    ref={ref}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      void ponerFoto(m, e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setDestino(m);
                      ref.current?.click();
                    }}
                    onFocus={() => setDestino(m)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDestino(m);
                      void ponerFoto(m, e.dataTransfer.files?.[0]);
                    }}
                    className={`relative flex h-32 w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border-2 text-center transition ${
                      elegida
                        ? "border-resuelto/60"
                        : destino === m
                          ? "border-dashed border-celeste"
                          : "border-dashed border-borde-2 hover:border-celeste/60"
                    }`}
                  >
                    <Achicando visible={preparando[m]} />
                    {elegida ? (
                      <>
                        <img src={elegida} alt="" className="absolute inset-0 h-full w-full object-cover" />
                        <span className="relative mt-auto w-full bg-black/60 py-1 text-[11px] font-bold text-white">
                          {m === "antes" ? "ANTES" : "DESPUÉS"} ✓ — tocá para cambiar
                        </span>
                      </>
                    ) : (
                      <>
                        <Camera size={18} className={m === "despues" ? "text-resuelto" : "text-celeste"} />
                        <span className="text-xs font-bold">Foto del {m === "antes" ? "ANTES" : "DESPUÉS"}</span>
                        <span className="text-[10px] text-texto-3">
                          {m === "despues" ? "la que cuenta para el acta" : "opcional"}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-texto-3">
            <ClipboardPaste size={13} className="mt-px shrink-0" />
            En la computadora también podés pegar una foto copiada (Ctrl+V) o arrastrarla desde WhatsApp o una
            carpeta. Va al cuadro marcado en celeste.
          </p>
          <AvisosFotoUsada revisiones={revisiones} nombres={{ antes: "del antes", despues: "del después" }} />
        </div>
      )}

      {error && <p className="text-sm text-peligro">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={guardar}
          disabled={ocupado || !hayAlgo}
          className="min-h-11 rounded-lg bg-resuelto px-5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {pendiente ? "Guardando…" : Object.values(preparando).some(Boolean) ? "Preparando la foto…" : "GUARDAR"}
        </button>
        <button
          type="button"
          onClick={() => {
            setAbierto(false);
            setError(null);
          }}
          className="text-sm text-texto-2 hover:text-texto"
        >
          Cancelar
        </button>
        {ahorro && <span className="text-[11px] text-texto-3">Foto achicada para que suba rápido: {ahorro}</span>}
      </div>
    </div>
  );
}
