import type { CompanyResult } from "@/lib/dart";

type YearColumn = { year: number; metrics: Record<string, number | null> };

function mapMetrics(metrics: CompanyResult["metrics"], period: "당기" | "전기" | "전전기"): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const key of Object.keys(metrics)) out[key] = metrics[key][period] ?? null;
  return out;
}

// 회사 하나의 재무제표를 연도 오름차순(과거→최신)으로 펼친다.
// 기본 3개년(당기/전기/전전기)에 yearsCount>3으로 추가 조회된 extraYears를 합친 것.
// lib/dart.ts를 직접 import하면 corp_codes_listed.json이 클라이언트 번들에 딸려오므로 별도 파일로 분리.
export function getYearColumns(c: Pick<CompanyResult, "years" | "metrics" | "extraYears">): YearColumn[] {
  const extra = (c.extraYears ?? []).slice().sort((a, b) => a.year - b.year);
  const base: YearColumn[] = [
    { year: c.years.전전기, metrics: mapMetrics(c.metrics, "전전기") },
    { year: c.years.전기, metrics: mapMetrics(c.metrics, "전기") },
    { year: c.years.당기, metrics: mapMetrics(c.metrics, "당기") },
  ];
  return [...extra, ...base];
}
