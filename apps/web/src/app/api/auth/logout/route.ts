import { NextResponse, type NextRequest } from "next/server";
import { borrarCookieSesion } from "@/lib/auth";

export async function GET(req: NextRequest) {
  await borrarCookieSesion();
  const portal = process.env.CIMBA_API_CIUDAD_DIGITAL
    ? "https://ciudaddigital.smt.gob.ar/?logout=true"
    : new URL("/acceso", req.nextUrl.origin).toString();
  return NextResponse.redirect(portal);
}
