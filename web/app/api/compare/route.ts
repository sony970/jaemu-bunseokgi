import { NextRequest, NextResponse } from "next/server";
import {
  CompanyNotFoundError,
  DartApiError,
  fetchCompany,
  fetchCompanyOverview,
  fetchAuditInfo,
  fetchFinancialIndicators,
  fetchDividendInfo,
} from "@/lib/dart";
import { fetchRiskEvents } from "@/lib/riskEvents";
import { fetchLatestStockPrice } from "@/lib/stockPrice";

export async function POST(req: NextRequest) {
  const apiKey = process.env.DART_API_KEY;
  const stockApiKey = process.env.STOCK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "서버에 DART_API_KEY가 설정되어 있지 않습니다." }, { status: 500 });
  }

  const body = await req.json();
  const companyNames: string[] = body.companies ?? [];
  const year: number | undefined = body.year ? Number(body.year) : undefined;
  const ratios: string[] = Array.isArray(body.ratios) ? body.ratios : [];
  const yearsCount = Math.min(5, Math.max(3, Number(body.yearsCount) || 3));

  if (!Array.isArray(companyNames) || companyNames.length === 0 || companyNames.length > 3) {
    return NextResponse.json({ error: "1~3개의 회사명을 입력하세요." }, { status: 400 });
  }

  try {
    const validNames = companyNames.filter((name) => name && name.trim());
    const companies = await Promise.all(
      validNames.map(async (name) => {
        const company = await fetchCompany(apiKey, name, year, yearsCount);

        const [overview, audit, indicators, riskEvents, stockPrice, dividend] = await Promise.all([
          fetchCompanyOverview(apiKey, company.corpCode).catch(() => null),
          fetchAuditInfo(apiKey, company.corpCode, company.usedYear).catch(() => []),
          ratios.length > 0
            ? fetchFinancialIndicators(apiKey, company.corpCode, company.usedYear, ratios).catch(() => ({}))
            : Promise.resolve({}),
          fetchRiskEvents(apiKey, company.corpCode).catch(() => []),
          stockApiKey ? fetchLatestStockPrice(stockApiKey, company.stockCode).catch(() => null) : Promise.resolve(null),
          stockApiKey
            ? fetchDividendInfo(apiKey, company.corpCode, company.usedYear).catch(() => null)
            : Promise.resolve(null),
        ]);

        let valuation: (typeof company)["valuation"];
        if (stockPrice) {
          const netIncome = company.metrics["당기순이익"]?.당기 ?? null;
          const equity = company.metrics["자본총계"]?.당기 ?? null;
          const debt = company.metrics["부채총계"]?.당기 ?? null;
          const operatingIncome = company.metrics["영업이익"]?.당기 ?? null;
          valuation = {
            stockDate: stockPrice.date,
            close: stockPrice.close,
            marketCap: stockPrice.marketCap,
            per: netIncome && netIncome > 0 ? stockPrice.marketCap / netIncome : null,
            pbr: equity && equity > 0 ? stockPrice.marketCap / equity : null,
            dividendYield: dividend?.cashDividendYield ?? null,
            evToEbitApprox:
              operatingIncome && operatingIncome > 0 && debt !== null
                ? (stockPrice.marketCap + debt) / operatingIncome
                : null,
          };
        }

        return {
          ...company,
          industryCode: overview?.industryCode ?? "",
          industryName: overview?.industryName ?? "",
          audit,
          indicators,
          riskEvents,
          valuation,
        };
      })
    );
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
