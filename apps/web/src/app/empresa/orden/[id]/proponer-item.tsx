"use client";

import { Camera, LocateFixed, Mic, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { dentroDeSMT } from "@cimba/domain";
import { proponerItem, reportarProblemaCalle } from "@/lib/acciones-ordenes";
import { comprimirFoto } from "@/lib/comprimir-foto";
import { useDictadoVoz } from "@/lib/dictado";
import { BarraConfianza } from "@/components/ui";
import { MiniMapa } from "@/components/mapa/mini-mapa";
import { Achicando } from "./tarjeta-item";
import { mensajeDeError } from "@/lib/errores";
import {
  CamposMedida,
  medidaAFormData,
  medidaVacia,
  resumenMedida,
  type ValorMedida,
} from "@/components/campos-medida";
import { ETIQUETA_FAMILIA, MOTIVOS_CALLE, MOTIVO_POR_VALOR } from "@/lib/problemas-calle";

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
 * LO QUE LA CUADRILLA ENCUENTRA EN LA CALLE Y NO ESTÁ EN LA ORDEN.
 *
 * Dos cosas distintas entran por acá, y terminan en lugares distintos:
 *
 *   bache     → item 'propuesto' de esta orden. Es trabajo que esta empresa
 *               puede hacer; Bacheo lo valida y cuenta.
 *   problema  → demanda nueva. Una pérdida de agua o una tapa rota no son
 *               trabajo de nadie todavía: son un pedido que hay que derivar.
 *               Meterlas como item sería prometer que la contratista las
 *               arregla.
 *
 * El bache admite además cargarse YA TAPADO: la cuadrilla está parada encima
 * con la cinta en la mano, y obligarla a volver otro día a buscarlo en la lista
 * para cerrarlo era pedirle dos viajes por el mismo pozo.
 *
 * El "¿Qué necesita? Bache / Carpeta" que estaba acá se fue: el capataz no
 * tiene por qué decidir si el paño entero entra en el contrato — eso lo
 * resuelve Bacheo al validar, con el dato de la superficie a la vista.
 */
type Modo = "bache" | "problema";

export function ProponerItem({
  ordenId,
  abrirAlEntrar = false,
}: {
  ordenId: number;
  /** Se llega desde "Cargar un bache → esta orden": el panel arranca abierto
   *  y a la vista, sin un toque más. */
  abrirAlEntrar?: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(abrirAlEntrar);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (abrirAlEntrar) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [abrirAlEntrar]);
  const [modo, setModo] = useState<Modo>("bache");
  const [error, setError] = useState<string | null>(null);

  const [obs, setObs] = useState("");

  // "ya lo tapamos": medidas + foto del después en el mismo paso
  const [yaTapado, setYaTapado] = useState(false);
  const [medida, setMedida] = useState<ValorMedida>(() => medidaVacia());
  const [capataz, setCapataz] = useState("");
  const refFotoDespues = useRef<HTMLInputElement>(null);
  const [fotoDespues, setFotoDespues] = useState<File | null>(null);
  const [previewDespues, setPreviewDespues] = useState<string | null>(null);

  // qué problema es, cuando el modo es "problema"
  const [motivo, setMotivo] = useState<string | null>(null);

  // foto (opcional para el bache, obligatoria para el problema)
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

  /** Se achica en el teléfono antes de subir: ver comprimir-foto.ts. */
  const [preparandoFoto, setPreparandoFoto] = useState(false);
  const elegirFotoEn = async (
    archivo: File | undefined,
    previoUrl: string | null,
    setArchivo: (f: File | null) => void,
    setUrl: (u: string | null) => void,
  ) => {
    if (previoUrl) URL.revokeObjectURL(previoUrl);
    if (!archivo) {
      setArchivo(null);
      setUrl(null);
      return;
    }
    setPreparandoFoto(true);
    try {
      const { archivo: listo } = await comprimirFoto(archivo);
      setArchivo(listo);
      setUrl(URL.createObjectURL(listo));
    } finally {
      setPreparandoFoto(false);
    }
  };
  const elegirFoto = (archivo: File | undefined) =>
    elegirFotoEn(archivo, preview, setFoto, setPreview);

  const cerrar = () => {
    setAbierto(false);
    setError(null);
    setErrorGeo(null);
    setCandidato(null);
    dictado.limpiarError();
  };

  /** Deja el formulario como recién abierto (los dos modos lo comparten). */
  const limpiar = () => {
    setAbierto(false);
    setDireccionTexto("");
    setUbicacion(null);
    setCandidato(null);
    setObs("");
    setMotivo(null);
    setYaTapado(false);
    setMedida(medidaVacia());
    setCapataz("");
    void elegirFoto(undefined);
    void elegirFotoEn(undefined, previewDespues, setFotoDespues, setPreviewDespues);
  };

  const enviar = () => {
    setError(null);
    if (direccionTexto.trim().length < 4) {
      setError(
        modo === "bache"
          ? "Cargá la dirección del bache (podés dictarla)."
          : "Cargá la dirección del problema (podés dictarla).",
      );
      return;
    }
    if (!ubicacion) {
      setError("Falta el punto en el mapa: buscá la dirección o usá tu GPS y confirmá el pin.");
      return;
    }

    // ── Un problema para derivar: entra como demanda, no como item ──────────
    if (modo === "problema") {
      if (!motivo) {
        setError("Elegí qué encontraron.");
        return;
      }
      if (!foto) {
        setError("La foto es obligatoria: es la prueba para derivar el reclamo.");
        return;
      }
      const fd = new FormData();
      fd.set("ordenId", String(ordenId));
      fd.set("direccion", direccionTexto.trim());
      fd.set("motivo", motivo);
      fd.set("lat", String(ubicacion.lat));
      fd.set("lon", String(ubicacion.lon));
      if (obs.trim()) fd.set("observaciones", obs.trim());
      fd.set("foto", foto);
      startTransition(async () => {
        try {
          await reportarProblemaCalle(fd);
          limpiar();
          router.refresh();
        } catch (e) {
          setError(mensajeDeError(e, "No se pudo enviar: probá de nuevo."));
        }
      });
      return;
    }

    // ── Un bache: propuesto, con o sin el trabajo ya hecho ──────────────────
    const fd = new FormData();
    fd.set("ordenId", String(ordenId));
    fd.set("direccion", direccionTexto.trim());
    fd.set("tipoTrabajo", "bache");
    fd.set("lat", String(ubicacion.lat));
    fd.set("lon", String(ubicacion.lon));
    if (obs.trim()) fd.set("observaciones", obs.trim());
    if (foto) fd.set("foto", foto);

    if (yaTapado) {
      const { falta } = resumenMedida(medida);
      if (falta) {
        setError(falta);
        return;
      }
      if (!fotoDespues) {
        setError("Falta la foto del trabajo terminado.");
        return;
      }
      medidaAFormData(fd, medida);
      fd.set("fotoDespues", fotoDespues);
      if (capataz.trim()) fd.set("capataz", capataz.trim());
    }

    startTransition(async () => {
      try {
        await proponerItem(fd);
        // Reset completo: el propuesto aparece en la lista al refrescar.
        limpiar();
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo enviar: probá de nuevo."));
      }
    });
  };

  if (!abierto) {
    return (
      <div className="space-y-2">
        <button
          onClick={() => {
            setModo("bache");
            setAbierto(true);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-borde-2 px-4 py-4 text-base font-bold text-texto-2 transition hover:border-celeste/60 hover:text-celeste active:scale-[0.99]"
        >
          <Plus size={20} />
          Encontramos un bache que no está en la orden
        </button>
        {/* La otra mitad de lo que se ve en la calle. Mismo peso visual: una
            pérdida de agua no es un caso raro, es la mitad de los hallazgos. */}
        <button
          onClick={() => {
            setModo("problema");
            setAbierto(true);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-borde-2 px-4 py-4 text-base font-bold text-texto-2 transition hover:border-amarillo/60 hover:text-amarillo active:scale-[0.99]"
        >
          <Plus size={20} />
          Reportar un problema (no es un bache)
        </button>
      </div>
    );
  }

  const esProblema = modo === "problema";

  return (
    <div
      ref={panelRef}
      className={`space-y-4 rounded-xl border bg-panel p-4 ${
        esProblema ? "border-amarillo/40" : "border-celeste/40"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-base font-bold">
          {esProblema ? "Reportar un problema" : "Proponer un bache nuevo"}
        </p>
        <button onClick={cerrar} disabled={pendiente} className="text-sm text-texto-3 hover:text-texto">
          Cancelar
        </button>
      </div>
      <p className="text-sm leading-relaxed text-texto-2">
        {esProblema ? (
          <>
            Entra como <b>pedido nuevo</b>, no como trabajo tuyo: queda registrado con tu foto para que
            Bacheo lo derive a quien corresponda.
          </>
        ) : (
          <>
            Entra como <b>propuesto</b>: la Dirección de Bacheo lo revisa y, si lo valida, aparece en tus
            pendientes para trabajarlo.
          </>
        )}
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

      {/* Qué problema es: solo en modo problema, agrupado por quién se hace cargo */}
      {esProblema && (
        <div className="space-y-3">
          {(["sat", "tratamiento"] as const).map((familia) => (
            <div key={familia}>
              <p className="mb-1.5 text-[11px] font-bold tracking-wider text-texto-3 uppercase">
                {ETIQUETA_FAMILIA[familia]}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {MOTIVOS_CALLE.filter((m) => m.familia === familia).map((m) => (
                  <button
                    key={m.valor}
                    type="button"
                    onClick={() => setMotivo(m.valor)}
                    className={`min-h-14 rounded-xl border-2 px-2.5 py-2 text-[12px] leading-snug font-bold transition active:scale-[0.99] ${
                      motivo === m.valor
                        ? "border-amarillo bg-amarillo/20 text-amarillo"
                        : "border-borde-2 bg-panel-2 text-texto-2 hover:border-amarillo/60"
                    }`}
                  >
                    {m.etiqueta}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {motivo && (
            <p className="text-xs leading-relaxed text-texto-2">
              {MOTIVO_POR_VALOR.get(motivo)?.consecuencia}
            </p>
          )}
        </div>
      )}

      {/* Foto del bache (opcional, pero ayuda a que lo validen rápido) */}
      <input
        ref={refFoto}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void elegirFoto(e.target.files?.[0])}
      />
      <button
        onClick={() => refFoto.current?.click()}
        disabled={preparandoFoto}
        className={`relative h-28 w-full overflow-hidden rounded-xl border-2 transition ${
          foto ? "border-celeste/60" : "border-dashed border-borde-2 hover:border-celeste/60"
        }`}
      >
        <Achicando visible={preparandoFoto} />
        {preview ? (
          <>
            <img src={preview} alt="Foto del bache propuesto" loading="lazy" className="h-full w-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-bold text-white">
              FOTO ✓ — tocá para cambiar
            </span>
          </>
        ) : (
          <span className="flex h-full flex-col items-center justify-center gap-1 text-sm font-bold">
            <Camera size={22} className={esProblema ? "text-amarillo" : "text-celeste"} />
            {esProblema ? "Foto del problema" : "Foto del bache"}
            <span className="text-[10px] font-medium text-texto-3">
              {esProblema ? "obligatoria — es la prueba para derivarlo" : "opcional, ayuda a validarlo"}
            </span>
          </span>
        )}
      </button>

      {/* YA LO TAPAMOS: el bache se propone y se mide en el mismo viaje.
          Antes había que volver otro día a buscarlo en la lista para cerrarlo,
          estando la cuadrilla parada encima con la cinta en la mano. */}
      {!esProblema && (
        <div className="space-y-3 rounded-xl border border-borde-2 bg-panel-2 p-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={yaTapado}
              onChange={(e) => setYaTapado(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-azul)]"
            />
            <span className="text-sm leading-snug">
              <b>Ya lo tapamos</b>
              <span className="block text-xs text-texto-3">
                Cargá las medidas y la foto del terminado ahora y no vuelvas a buscarlo. Cuenta cuando
                Bacheo lo valide.
              </span>
            </span>
          </label>

          {yaTapado && (
            <div className="space-y-3">
              <CamposMedida valor={medida} alCambiar={setMedida} />

              <input
                ref={refFotoDespues}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) =>
                  void elegirFotoEn(e.target.files?.[0], previewDespues, setFotoDespues, setPreviewDespues)
                }
              />
              <button
                onClick={() => refFotoDespues.current?.click()}
                disabled={preparandoFoto}
                className={`relative h-28 w-full overflow-hidden rounded-xl border-2 transition ${
                  fotoDespues ? "border-resuelto/60" : "border-dashed border-borde-2 hover:border-resuelto/60"
                }`}
              >
                <Achicando visible={preparandoFoto} />
                {previewDespues ? (
                  <>
                    <img
                      src={previewDespues}
                      alt="Foto del trabajo terminado"
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-bold text-white">
                      DESPUÉS ✓ — tocá para cambiar
                    </span>
                  </>
                ) : (
                  <span className="flex h-full flex-col items-center justify-center gap-1 text-sm font-bold">
                    <Camera size={22} className="text-resuelto" />
                    Foto del trabajo terminado
                    <span className="text-[10px] font-medium text-texto-3">obligatoria</span>
                  </span>
                )}
              </button>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-texto-2">Capataz</span>
                <input
                  value={capataz}
                  onChange={(e) => setCapataz(e.target.value)}
                  placeholder="Tu nombre"
                  className="w-full rounded-xl border border-borde-2 bg-panel px-3 py-3 text-base placeholder:text-texto-3"
                />
              </label>
            </div>
          )}
        </div>
      )}

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
        disabled={pendiente || preparandoFoto}
        className={`w-full rounded-xl px-4 py-4 text-base font-bold text-white transition active:scale-[0.99] disabled:opacity-50 ${
          esProblema ? "bg-amarillo" : "bg-azul"
        }`}
      >
        {preparandoFoto
          ? "Preparando la foto…"
          : pendiente
            ? "Enviando…"
            : esProblema
              ? "REPORTAR EL PROBLEMA"
              : yaTapado
                ? "ENVIAR: BACHE NUEVO YA TAPADO"
                : "PROPONER A BACHEO"}
      </button>
    </div>
  );
}
