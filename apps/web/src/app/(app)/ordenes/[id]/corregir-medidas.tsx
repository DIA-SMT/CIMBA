"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { corregirMedidasItem } from "@/lib/acciones-ordenes";
import {
  CamposMedida,
  medidaAFormData,
  medidaVacia,
  resumenMedida,
  type ValorMedida,
} from "@/components/campos-medida";
import { mensajeDeError } from "@/lib/errores";

/**
 * CORREGIR UN BACHE YA CERRADO.
 *
 * "Todos nos equivocamos, seguro cargan mal" — Dirección de Bacheo, 12/09. La
 * medida entraba una vez, desde un teléfono y con guantes, y quedaba fija:
 * un 2 que salió 20 inflaba los m² de la empresa y las toneladas del acta, y
 * la única salida era dejarlo mal.
 *
 * Arranca con la medida actual puesta —se corrige, no se vuelve a cargar— y
 * pide motivo: cambiar un número después de que la empresa lo firmó es un acto
 * administrativo, no un ajuste de pantalla. El motivo va a la auditoría y se
 * ve en el historial de la fila.
 *
 * Las tres formas de medir son las mismas del portal de empresas: si acá se
 * corrigiera con otro criterio, la certificación recibiría dos.
 */
const OPCIONES_OBRA = [
  { valor: "planificado", etiqueta: "Planificado" },
  { valor: "provisorio", etiqueta: "Provisorio (urgencia)" },
  { valor: "sobre_adoquin", etiqueta: "Sobre adoquín" },
];

export function CorregirMedidas({
  itemId,
  superficieM2,
  espesorCm,
  anchoM,
  largoM,
  medicion,
  tipoObra,
  enActa,
}: {
  itemId: number;
  superficieM2: number | null;
  espesorCm: number | null;
  /** Los lados con los que se cargó, si se cargó así. */
  anchoM?: number | null;
  largoM?: number | null;
  /** Cómo se midió en la calle: el formulario abre igual. */
  medicion?: string | null;
  tipoObra: string | null;
  /** Ya certificado: no se toca (lo rechaza también el servidor). */
  enActa: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  /**
   * ABRE COMO SE CARGÓ, con todo adentro.
   *
   * Abría siempre en modo "superficie" y con los lados en blanco: quien había
   * medido con la cinta y solo quería corregir el espesor tenía que volver a
   * tipear el ancho y el largo, dos números que el sistema ya tenía guardados.
   * Ahora arranca en el modo real del item y con los cuatro valores puestos:
   * se cambia el que está mal y listo.
   */
  const [medida, setMedida] = useState<ValorMedida>(() => ({
    ...medidaVacia(
      medicion === "lados" || medicion === "volumen" || medicion === "superficie"
        ? medicion
        : anchoM != null && largoM != null
          ? "lados"
          : "superficie",
    ),
    ancho: anchoM != null ? String(anchoM) : "",
    largo: largoM != null ? String(largoM) : "",
    superficie: superficieM2 != null ? String(superficieM2) : "",
    espesor: espesorCm != null ? String(espesorCm) : "",
  }));
  /** "extendido" no se elige: lo deriva el servidor de la superficie. */
  const [modalidad, setModalidad] = useState(
    tipoObra === "provisorio" || tipoObra === "sobre_adoquin" ? tipoObra : "planificado",
  );

  if (enActa) {
    return (
      <span
        className="text-[11px] text-texto-3"
        title="Ya está en un acta firmada: la diferencia se salda en el acta siguiente"
      >
        certificado
      </span>
    );
  }

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        title="Corregir las medidas cargadas"
        className="rounded-md border border-borde-2 p-1.5 text-texto-3 transition hover:border-celeste/50 hover:text-celeste"
      >
        <Pencil size={13} />
      </button>
    );
  }

  const { falta } = resumenMedida(medida);

  return (
    <div className="w-72 space-y-2 rounded-xl border border-celeste/40 bg-panel p-3">
      <CamposMedida valor={medida} alCambiar={setMedida} />

      <div className="grid grid-cols-3 gap-1.5">
        {OPCIONES_OBRA.map((op) => (
          <button
            key={op.valor}
            type="button"
            onClick={() => setModalidad(op.valor)}
            className={`rounded-lg border px-2 py-1.5 text-[11px] leading-tight font-semibold transition ${
              modalidad === op.valor
                ? "border-azul bg-azul/15 text-celeste"
                : "border-borde-2 bg-panel-2 text-texto-2"
            }`}
          >
            {op.etiqueta}
          </button>
        ))}
      </div>

      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="¿Por qué se corrige? (queda en el historial)"
        className="w-full rounded-lg border border-borde-2 bg-panel-2 px-2.5 py-2 text-[12px] placeholder:text-texto-3"
      />

      {error && <p className="text-[11px] text-peligro">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          disabled={pendiente || motivo.trim().length < 3 || Boolean(falta)}
          onClick={() => {
            setError(null);
            const fd = new FormData();
            fd.set("itemId", String(itemId));
            medidaAFormData(fd, medida);
            fd.set("tipoObra", modalidad);
            fd.set("motivo", motivo.trim());
            startTransition(async () => {
              try {
                await corregirMedidasItem(fd);
                setAbierto(false);
                setMotivo("");
                router.refresh();
              } catch (e) {
                setError(mensajeDeError(e, "No se pudo corregir"));
              }
            });
          }}
          className="rounded-lg bg-azul px-3 py-2 text-[12px] font-bold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {pendiente ? "Guardando…" : "Guardar corrección"}
        </button>
        <button
          onClick={() => {
            setAbierto(false);
            setError(null);
          }}
          disabled={pendiente}
          className="text-[12px] text-texto-3 hover:text-texto-2"
        >
          Cancelar
        </button>
      </div>
      {falta && <p className="text-[11px] text-texto-3">{falta}</p>}
    </div>
  );
}
