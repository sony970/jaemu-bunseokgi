import { NextRequest, NextResponse } from "next/server";
import { getListedCorpCodes } from "@/lib/dart";

const MAX_RESULTS = 10;

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ results: [] });

  const corps = getListedCorpCodes();
  const byLengthThenName = (a: { corp_name: string }, b: { corp_name: string }) =>
    a.corp_name.length - b.corp_name.length || a.corp_name.localeCompare(b.corp_name, "ko");

  const prefix = corps.filter((c) => c.corp_name.startsWith(q)).sort(byLengthThenName);
  const partial = corps.filter((c) => !c.corp_name.startsWith(q) && c.corp_name.includes(q)).sort(byLengthThenName);

  const seen = new Set<string>();
  const combined: { corpName: string; stockCode: string }[] = [];
  for (const c of [...prefix, ...partial]) {
    if (seen.has(c.corp_name)) continue;
    seen.add(c.corp_name);
    combined.push({ corpName: c.corp_name, stockCode: c.stock_code });
    if (combined.length >= MAX_RESULTS) break;
  }

  return NextResponse.json({ results: combined });
}
