import { NextRequest, NextResponse } from "next/server";
import { CompanyNotFoundError, DartApiError, fetchCompany } from "@/lib/dart";

export async function POST(req: NextRequest) {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "서버에 DART_API_KEY가 설정되어 있지 않습니다." }, { status: 500 });
  }

  const body = await req.json();
  const companyNames: string[] = body.companies ?? [];
  const year: number | undefined = body.year ? Number(body.year) : undefined;

  if (!Array.isArray(companyNames) || companyNames.length === 0 || companyNames.length > 3) {
    return NextResponse.json({ error: "1~3개의 회사명을 입력하세요." }, { status: 400 });
  }

  try {
    const companies = [];
    for (const name of companyNames) {
      if (!name || !name.trim()) continue;
      companies.push(await fetchCompany(apiKey, name, year));
    }
    return NextResponse.json({ companies });
  } catch (e) {
    if (e instanceof CompanyNotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    if (e instanceof DartApiError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    console.error(e);
    return NextResponse.json({ error: "알 수 없는 오류가 발생했습니다." }, { status: 500 });
  }
}
