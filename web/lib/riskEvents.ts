import { makeTtlCache } from "./ttlCache";

const BASE_URL = "https://opendart.fss.or.kr/api";
const FETCH_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 24 * 3600 * 1000;

export type RiskEvent = {
  type: string;
  label: string;
  date: string;
  summary: string;
  severity: "danger" | "warning" | "positive";
};

// DART 주요사항보고서(DS005) 36종 중 투자자에게 의미 있는 신호 위주로 선정.
// 각 항목: 엔드포인트, 사람이 읽을 라벨, 심각도, 응답에서 날짜/요약을 뽑는 방법.
type EventDef = {
  type: string;
  label: string;
  endpoint: string;
  severity: RiskEvent["severity"];
  dateField: string;
  summarize: (item: Record<string, string>) => string;
};

const EVENT_DEFS: EventDef[] = [
  { type: "부도발생", label: "부도발생", endpoint: "dfOcr", severity: "danger", dateField: "dfd", summarize: (i) => i.df_rs || i.df_cn || "" },
  { type: "영업정지", label: "영업정지", endpoint: "bsnSp", severity: "danger", dateField: "bsnspd", summarize: (i) => i.bsnsp_cn || i.bsnsp_rs || "" },
  {
    type: "회생절차개시신청",
    label: "회생절차 개시신청",
    endpoint: "ctrcvsBgrq",
    severity: "danger",
    dateField: "rqd",
    summarize: (i) => i.rq_rs || "",
  },
  {
    type: "해산사유발생",
    label: "해산사유 발생",
    endpoint: "dsRsOcr",
    severity: "danger",
    dateField: "ds_rsd",
    summarize: (i) => i.ds_rs || "",
  },
  {
    type: "소송제기",
    label: "소송 등의 제기",
    endpoint: "lwstLg",
    severity: "warning",
    dateField: "lgd",
    summarize: (i) => i.icnm || i.rq_cn || "",
  },
  {
    type: "유상증자결정",
    label: "유상증자 결정",
    endpoint: "piicDecsn",
    severity: "warning",
    dateField: "bddd",
    summarize: (i) => (i.nstk_ostk_cnt ? `신주 ${i.nstk_ostk_cnt}주` : ""),
  },
  {
    type: "감자결정",
    label: "감자 결정",
    endpoint: "crDecsn",
    severity: "warning",
    dateField: "bddd",
    summarize: (i) => i.cr_rs || (i.cr_rt_ostk ? `감자비율 ${i.cr_rt_ostk}%` : ""),
  },
  {
    type: "채권은행관리절차",
    label: "채권은행 등의 관리절차 개시",
    endpoint: "bnkMngtPcbg",
    severity: "warning",
    dateField: "mngt_pcbg_dd",
    summarize: (i) => i.mngt_rs || "",
  },
  {
    type: "자기주식취득결정",
    label: "자기주식 취득 결정",
    endpoint: "tsstkAqDecsn",
    severity: "positive",
    dateField: "aq_dd",
    summarize: (i) => (i.aqpln_stk_ostk ? `취득예정 ${i.aqpln_stk_ostk}주` : i.aq_pp || ""),
  },
];

const eventCache = makeTtlCache<RiskEvent[]>(CACHE_TTL_MS);

async function fetchOneEventType(
  apiKey: string,
  corpCode: string,
  bgnDe: string,
  endDe: string,
  def: EventDef
): Promise<RiskEvent[]> {
  const params = new URLSearchParams({
    crtfc_key: apiKey,
    corp_code: corpCode,
    bgn_de: bgnDe,
    end_de: endDe,
  });
  try {
    const resp = await fetch(`${BASE_URL}/${def.endpoint}.json?${params}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    if (data.status !== "000" || !Array.isArray(data.list)) return [];
    return data.list.map((item: Record<string, string>) => ({
      type: def.type,
      label: def.label,
      date: item[def.dateField] ?? "",
      summary: def.summarize(item),
      severity: def.severity,
    }));
  } catch {
    return [];
  }
}

function formatDate(n: number): string {
  const d = new Date(n);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export async function fetchRiskEvents(apiKey: string, corpCode: string): Promise<RiskEvent[]> {
  const now = Date.now();
  const endDe = formatDate(now);
  const bgnDe = formatDate(now - 2 * 365 * 24 * 3600 * 1000);

  const cacheKey = `${corpCode}:${bgnDe}:${endDe}`;
  const cached = eventCache.get(cacheKey);
  if (cached) return cached;

  const results = await Promise.all(EVENT_DEFS.map((def) => fetchOneEventType(apiKey, corpCode, bgnDe, endDe, def)));
  const events = results.flat().sort((a, b) => b.date.localeCompare(a.date));
  eventCache.set(cacheKey, events);
  return events;
}
