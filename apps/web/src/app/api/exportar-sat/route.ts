import { NextResponse, type NextRequest } from "next/server";

/**
 * El expediente SAT ya NO es un CSV: es una nota administrativa al Director de
 * la SAT, con previsualización, registro numerado y detalle congelado — ver
 * /expedientes/sat. Esta ruta queda solo para no romper enlaces guardados.
 */
export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL("/expedientes/sat", req.nextUrl.origin), 307);
}
