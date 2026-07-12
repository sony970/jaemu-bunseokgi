import { makeTtlCache } from "./ttlCache";

const BASE_URL = "https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo";
const CACHE_TTL_MS = 3600 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

export type StockPrice = {
  date: string;
  close: number;
  marketCap: number;
  sharesOutstanding: number;
};

const priceCache = makeTtlCache<StockPrice>(CACHE_TTL_MS);

function formatDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

// data.go.kr 금융위원회_주식시세정보(getStockPriceInfo). 서비스키 발급 전 작성해서
// 파라미터명(likeSrtnCd)과 응답 필드명(clpr/mrktTotAmt/lstgStCnt)은 공개 문서 기준 추정치 —
// 실제 키로 첫 호출해보고 다르면 이 함수만 고치면 된다.
export async function fetchLatestStockPrice(apiKey: string, stockCode: string): Promise<StockPrice | null> {
  if (!stockCode) return null;
  const cached = priceCache.get(stockCode);
  if (cached) return cached;

  const end = new Date();
  const begin = new Date(end.getTime() - 10 * 24 * 3600 * 1000);
  const params = new URLSearchParams({
    serviceKey: apiKey,
    resultType: "json",
    numOfRows: "10",
    pageNo: "1",
    likeSrtnCd: stockCode,
    beginBasDt: formatDate(begin),
    endBasDt: formatDate(end),
  });

  let resp: Response;
  try {
    resp = await fetch(`${BASE_URL}?${params}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    return null;
  }
  if (!resp.ok) return null;

  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    return null;
  }

  const items = (data as { response?: { body?: { items?: { item?: unknown } } } })?.response?.body?.items?.item;
  const list = (Array.isArray(items) ? items : items ? [items] : []) as Record<string, string>[];
  if (list.length === 0) return null;

  const latest = list.reduce((a, b) => (a.basDt > b.basDt ? a : b));
  const close = Number(latest.clpr);
  const marketCap = Number(latest.mrktTotAmt);
  const sharesOutstanding = Number(latest.lstgStCnt);
  if (!Number.isFinite(close) || close <= 0) return null;

  const result: StockPrice = { date: latest.basDt, close, marketCap, sharesOutstanding };
  priceCache.set(stockCode, result);
  return result;
}
