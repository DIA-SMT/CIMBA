import "server-only";
import { NextResponse } from "next/server";

/**
 * CSV para Excel argentino, en un solo lugar.
 *
 * Estaba escrito adentro de /api/exportar y hacía falta igual en el portal de
 * empresas: duplicarlo significaba duplicar también la neutralización de
 * fórmulas, que es lo único que no se puede olvidar.
 *
 * Separador ";" porque es lo que espera el Excel con configuración regional
 * argentina (con "," abre todo en una columna), y BOM para que los acentos no
 * salgan rotos.
 */

export function celda(v: unknown): string {
  if (v == null) return "";
  // Los números (ids, coordenadas negativas) pasan tal cual.
  if (typeof v === "number") return String(v);
  let s = String(v);
  /**
   * CSV injection: Excel EVALÚA como fórmula cualquier celda que empiece con
   * = + - @ o tab. Estos textos vienen de vecinos, de capataces y de archivos
   * externos, así que se les antepone una comilla. No es paranoia: una celda
   * con =HYPERLINK(...) en una planilla que circula por mail es un ataque real.
   */
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n']/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function csv(columnas: string[], filas: unknown[][]): string {
  const lineas = [columnas.join(";"), ...filas.map((f) => f.map(celda).join(";"))];
  return "﻿" + lineas.join("\r\n");
}

export function respuestaCsv(nombre: string, contenido: string): NextResponse {
  return new NextResponse(contenido, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${nombre}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
