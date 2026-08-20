import type { Punto, TipoProblema } from "@cimba/domain";
import { dentroDeSMT } from "@cimba/domain";

/** Mapeo de categorías/motivos reales (SAT, AC, consolidado) a tipo_problema. */
export function mapearTipo(texto: string | null | undefined): TipoProblema {
  if (!texto) return "otro";
  const t = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (t.includes("bache")) return "bache";
  if (t.includes("hundimiento")) return "hundimiento";
  if (t.includes("tapa")) return "tapa_registro";
  if (t.includes("perdida")) return "perdida_agua";
  if (t.includes("sumidero") || t.includes("imbornal")) return "sumidero";
  if (t.includes("fisura") || t.includes("grieta")) return "fisura";
  if (t.includes("pavimento") || t.includes("calzada") || t.includes("hormigon") || t.includes("asfalto"))
    return "pavimento_deteriorado";
  return "otro";
}

export function puntoValido(lat: unknown, lon: unknown): Punto | null {
  const la = typeof lat === "number" ? lat : Number.parseFloat(String(lat ?? ""));
  const lo = typeof lon === "number" ? lon : Number.parseFloat(String(lon ?? ""));
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la === 0 || lo === 0) return null;
  const p = { lat: la, lon: lo };
  // Coordenadas fuera de un margen amplio de SMT se descartan como inválidas
  // (pero se conserva la demanda sin geometría).
  return dentroDeSMT(p) ? p : null;
}

/** "22/04/2024, 09:37" | "17/3/2025" | "2025-03-17" | "6/1/2026" (M/D/YYYY) */
export function parsearFecha(v: unknown, formato: "dma" | "mda" | "iso" = "dma"): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00-03:00`);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) {
    const [, a, b, anio] = m;
    const dia = formato === "mda" ? Number(b) : Number(a);
    const mes = formato === "mda" ? Number(a) : Number(b);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    return new Date(
      `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}T12:00:00-03:00`,
    );
  }
  return null;
}

/** "Abril 2026" → 2026-04-15 (punto medio del mes como fecha representativa). */
export function fechaDesdeMes(texto: string | null | undefined): Date | null {
  if (!texto) return null;
  const MESES: Record<string, number> = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
    noviembre: 11, diciembre: 12,
  };
  const m = /([a-záé]+)\s+(\d{4})/i.exec(texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
  if (!m || !m[1] || !m[2]) return null;
  const mes = MESES[m[1]];
  if (!mes) return null;
  return new Date(`${m[2]}-${String(mes).padStart(2, "0")}-15T12:00:00-03:00`);
}

export function limpiarTexto(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s.length > 0 ? s : null;
}
