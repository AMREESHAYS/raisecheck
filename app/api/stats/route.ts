import { NextResponse } from "next/server";
import { verifiedCountThisMonth } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ verified_this_month: await verifiedCountThisMonth() });
}
