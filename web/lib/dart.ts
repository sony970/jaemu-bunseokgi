import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import listedCorpCodes from "./corp_codes_listed.json";
import { getIndustryName } from "./industry_codes";
import { RATIO_CATEGORIES } from "./ratios";

const BASE_URL = "https://opendart.fss.or.kr/api";
const REPRT_CODE_ANNUAL = "11011";

export type Corp = {
  corp_code: string;
  corp_name: string;
  stock_code: string;
  modify_date: string;
};

export type Account = {
  sj_div?: string;
  sj_nm?: string;
  account_nm?: string;
  thstrm_amount?: string;
  frmtrm_amount?: string;
  bfefrmtrm_amount?: string;
};

export type CompanyResult = {
  corpName: string;
  corpCode: string;
  usedYear: number;
  fsDiv: "CFS" | "OFS";
  years: { 당기: number; 전기: number; 전전기: number };
  metrics: Record<string, { 당기: number | null; 전기: number | null; 전전기: number | null }>;
  rawAccounts: Account[];
  industryCode?: string;
  industryName?: string;
  audit?: AuditYearInfo[];
  indicators?: Record<string, number | null>;
  // 3개년을 넘겨서 조회했을 때 추가로 딸려오는, usedYear-2보다 더 이전 연도들 (내림차순: 가장 최근 것이 0번).
  extraYears?: { year: number; metrics: Record<string, number | null> }[];
};

export type CompanyOverview = {
  corpName: string;
  industryCode: string;
  industryName: string;
};

export type AuditYearInfo = {
  bsnsYear: string;
  adtor: string;
  adtOpinion: string;
  emphsMatter: string;
  coreAdtMatter: string;
};

export class DartApiError extends Error {}
export class CompanyNotFoundError extends Error {
  candidates: string[];
  constructor(name: string, candidates: string[] = []) {
    const msg =
      `'${name}'에 해당하는 회사를 찾을 수 없습니다.` +
      (candidates.length ? ` 혹시 이 중 하나인가요? ${candidates.join(", ")}` : "");
    super(msg);
    this.candidates = candidates;
  }
}

const KEY_METRICS: [string, "BS_ONLY" | "IS_ONLY", string[]][] = [
  ["매출액", "IS_ONLY", ["매출액", "수익(매출액)", "영업수익"]],
  ["영업이익", "IS_ONLY", ["영업이익", "영업이익(손실)"]],
  ["당기순이익", "IS_ONLY", ["당기순이익", "당기순이익(손실)", "분기순이익(손실)", "반기순이익(손실)"]],
  ["자산총계", "BS_ONLY", ["자산총계"]],
  ["부채총계", "BS_ONLY", ["부채총계"]],
  ["자본총계", "BS_ONLY", ["자본총계"]],
];

// 서버리스 웜 인스턴스 재사용을 위한 모듈 스코프 캐시 (콜드스타트 시에는 재다운로드)
let corpCodeCache: { data: Corp[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 6 * 3600 * 1000;

const FETCH_TIMEOUT_MS = 20_000;

async function downloadCorpCodes(apiKey: string): Promise<Corp[]> {
  const url = `${BASE_URL}/corpCode.xml?crtfc_key=${apiKey}`;
  let resp: Response;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (e) {
    throw new DartApiError(`고유번호 목록 요청 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!resp.ok) throw new DartApiError(`고유번호 목록 다운로드 실패: HTTP ${resp.status}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());

  let xml: string;
  try {
    const unzipped = unzipSync(bytes);
    xml = new TextDecoder("utf-8").decode(unzipped["CORPCODE.xml"]);
  } catch {
    throw new DartApiError("고유번호 목록을 받아오지 못했습니다 (API 키를 확인하세요).");
  }

  const parser = new XMLParser({ parseTagValue: false });
  const parsed = parser.parse(xml);
  const list = parsed?.result?.list ?? [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.map((item: Record<string, unknown>) => ({
    corp_code: String(item.corp_code ?? "").trim(),
    corp_name: String(item.corp_name ?? "").trim(),
    stock_code: String(item.stock_code ?? "").trim(),
    modify_date: String(item.modify_date ?? "").trim(),
  }));
}

// 상장사 목록은 배포 시 정적 스냅샷으로 번들되어 있어 즉시 조회 가능 (scripts/build_corp_codes.mjs 로 갱신)
export function getListedCorpCodes(): Corp[] {
  return listedCorpCodes as Corp[];
}

// 비상장사 등 정적 스냅샷에 없는 회사를 위한 전체 목록 라이브 다운로드 (느림, 폴백 전용)
export async function loadFullCorpCodes(apiKey: string): Promise<Corp[]> {
  if (corpCodeCache && Date.now() - corpCodeCache.fetchedAt < CACHE_TTL_MS) {
    return corpCodeCache.data;
  }
  const data = await downloadCorpCodes(apiKey);
  corpCodeCache = { data, fetchedAt: Date.now() };
  return data;
}

export function findCorp(corpCodes: Corp[], name: string): Corp {
  const trimmed = name.trim();

  const exact = corpCodes.filter((c) => c.corp_name === trimmed);
  if (exact.length) {
    const listed = exact.filter((c) => c.stock_code);
    return (listed.length ? listed : exact)[0];
  }

  const partial = corpCodes.filter((c) => c.corp_name.includes(trimmed));
  if (partial.length) {
    const listed = partial.filter((c) => c.stock_code);
    const pool = listed.length ? listed : partial;
    pool.sort((a, b) => a.corp_name.length - b.corp_name.length);
    return pool[0];
  }

  const candidates = corpCodes
    .filter((c) => c.corp_name[0] === trimmed[0])
    .slice(0, 5)
    .map((c) => c.corp_name);
  throw new CompanyNotFoundError(trimmed, candidates);
}

async function fetchAccounts(
  apiKey: string,
  corpCode: string,
  bsnsYear: number,
  fsDiv: "CFS" | "OFS",
  reprtCode = REPRT_CODE_ANNUAL
): Promise<{ status: string; message: string; accounts: Account[] }> {
  const params = new URLSearchParams({
    crtfc_key: apiKey,
    corp_code: corpCode,
    bsns_year: String(bsnsYear),
    reprt_code: reprtCode,
    fs_div: fsDiv,
  });
  let resp: Response;
  try {
    resp = await fetch(`${BASE_URL}/fnlttSinglAcntAll.json?${params}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new DartApiError(`재무제표 요청 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!resp.ok) throw new DartApiError(`재무제표 조회 실패: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.status !== "000") {
    return { status: data.status, message: data.message ?? "", accounts: [] };
  }
  return { status: data.status, message: data.message ?? "", accounts: data.list ?? [] };
}

async function getFinancialAccounts(apiKey: string, corpCode: string, bsnsYear: number) {
  let { status, message, accounts } = await fetchAccounts(apiKey, corpCode, bsnsYear, "CFS");
  let fsDivUsed: "CFS" | "OFS" = "CFS";
  if (status !== "000" || accounts.length === 0) {
    ({ status, message, accounts } = await fetchAccounts(apiKey, corpCode, bsnsYear, "OFS"));
    fsDivUsed = "OFS";
  }
  return { status, message, fsDivUsed, accounts };
}

async function findLatestAvailableYear(apiKey: string, corpCode: string, startYear: number) {
  const minYear = startYear - 6;
  for (let year = startYear; year >= minYear; year--) {
    const { status, fsDivUsed, accounts } = await getFinancialAccounts(apiKey, corpCode, year);
    if (status === "000" && accounts.length > 0) {
      return { year, fsDivUsed, accounts };
    }
  }
  return { year: null, fsDivUsed: null, accounts: [] as Account[] };
}

function toInt(amount?: string): number | null {
  if (!amount) return null;
  const n = Number(amount.replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}

function normalizeAccountName(name: string): string {
  return name.replace(/\s+/g, "");
}

function findMetricAccounts(accounts: Account[]): Record<string, Account | undefined> {
  const isAccounts = accounts.filter((a) => a.sj_div === "IS" || a.sj_div === "CIS");
  const bsAccounts = accounts.filter((a) => a.sj_div === "BS");

  const found: Record<string, Account | undefined> = {};
  for (const [label, scope, candidates] of KEY_METRICS) {
    const pool = scope === "BS_ONLY" ? bsAccounts : isAccounts;
    let match: Account | undefined;
    for (const cand of candidates) {
      const normCand = normalizeAccountName(cand);
      match = pool.find((a) => normalizeAccountName(a.account_nm ?? "") === normCand);
      if (match) break;
    }
    if (!match) {
      for (const cand of candidates) {
        const normCand = normalizeAccountName(cand);
        match = pool.find((a) => normalizeAccountName(a.account_nm ?? "").includes(normCand));
        if (match) break;
      }
    }
    found[label] = match;
  }
  return found;
}

export function extractKeyMetrics(accounts: Account[]) {
  const found = findMetricAccounts(accounts);
  const result: CompanyResult["metrics"] = {};
  for (const [label] of KEY_METRICS) {
    const acc = found[label];
    result[label] = {
      당기: toInt(acc?.thstrm_amount),
      전기: toInt(acc?.frmtrm_amount),
      전전기: toInt(acc?.bfefrmtrm_amount),
    };
  }
  return result;
}

// 5개년 이상 비교 시, 3개년치를 담고 있는 최신 보고서 외에 그 이전 개별 연도 보고서를 추가로 조회할 때 사용.
// 해당 보고서의 "당기" 컬럼만 그 연도의 값으로 취급한다.
function extractLatestColumnMetrics(accounts: Account[]): Record<string, number | null> {
  const found = findMetricAccounts(accounts);
  const result: Record<string, number | null> = {};
  for (const [label] of KEY_METRICS) {
    result[label] = toInt(found[label]?.thstrm_amount);
  }
  return result;
}

async function resolveCorp(apiKey: string, name: string): Promise<Corp> {
  try {
    return findCorp(getListedCorpCodes(), name);
  } catch (e) {
    if (!(e instanceof CompanyNotFoundError)) throw e;
    // 상장사 스냅샷에 없으면 (비상장사 등) 전체 목록을 라이브 다운로드해 재시도
    const fullList = await loadFullCorpCodes(apiKey);
    return findCorp(fullList, name);
  }
}

export async function fetchCompany(
  apiKey: string,
  name: string,
  year?: number,
  yearsCount = 3
): Promise<CompanyResult> {
  const corp = await resolveCorp(apiKey, name);

  let usedYear: number;
  let fsDivUsed: "CFS" | "OFS";
  let accounts: Account[];

  if (year) {
    const res = await getFinancialAccounts(apiKey, corp.corp_code, year);
    if (res.status !== "000" || res.accounts.length === 0) {
      throw new DartApiError(`'${corp.corp_name}'의 ${year}년 사업보고서를 찾을 수 없습니다.`);
    }
    usedYear = year;
    fsDivUsed = res.fsDivUsed;
    accounts = res.accounts;
  } else {
    const currentYear = new Date().getFullYear();
    const res = await findLatestAvailableYear(apiKey, corp.corp_code, currentYear - 1);
    if (res.year === null) {
      throw new DartApiError(`'${corp.corp_name}'의 최근 사업보고서를 찾을 수 없습니다.`);
    }
    usedYear = res.year;
    fsDivUsed = res.fsDivUsed!;
    accounts = res.accounts;
  }

  const extraYearCount = Math.max(0, yearsCount - 3);
  let extraYears: { year: number; metrics: Record<string, number | null> }[] | undefined;
  if (extraYearCount > 0) {
    const targetYears = Array.from({ length: extraYearCount }, (_, i) => usedYear - 3 - i);
    const fetched = await Promise.all(
      targetYears.map(async (y) => {
        try {
          const res = await getFinancialAccounts(apiKey, corp.corp_code, y);
          if (res.status !== "000" || res.accounts.length === 0) return { year: y, metrics: {} };
          return { year: y, metrics: extractLatestColumnMetrics(res.accounts) };
        } catch {
          return { year: y, metrics: {} };
        }
      })
    );
    extraYears = fetched;
  }

  return {
    corpName: corp.corp_name,
    corpCode: corp.corp_code,
    usedYear,
    fsDiv: fsDivUsed,
    years: { 당기: usedYear, 전기: usedYear - 1, 전전기: usedYear - 2 },
    metrics: extractKeyMetrics(accounts),
    rawAccounts: accounts,
    extraYears,
  };
}

export async function fetchCompanyOverview(apiKey: string, corpCode: string): Promise<CompanyOverview> {
  const params = new URLSearchParams({ crtfc_key: apiKey, corp_code: corpCode });
  let resp: Response;
  try {
    resp = await fetch(`${BASE_URL}/company.json?${params}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (e) {
    throw new DartApiError(`기업개황 요청 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!resp.ok) throw new DartApiError(`기업개황 조회 실패: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.status !== "000") {
    return { corpName: "", industryCode: "", industryName: "" };
  }
  const industryCode: string = data.induty_code ?? "";
  return { corpName: data.corp_name ?? "", industryCode, industryName: getIndustryName(industryCode) };
}

export async function fetchAuditInfo(apiKey: string, corpCode: string, year: number): Promise<AuditYearInfo[]> {
  const params = new URLSearchParams({
    crtfc_key: apiKey,
    corp_code: corpCode,
    bsns_year: String(year),
    reprt_code: REPRT_CODE_ANNUAL,
  });
  let resp: Response;
  try {
    resp = await fetch(`${BASE_URL}/accnutAdtorNmNdAdtOpinion.json?${params}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new DartApiError(`감사정보 요청 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!resp.ok) throw new DartApiError(`감사정보 조회 실패: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.status !== "000" || !Array.isArray(data.list)) return [];

  const seen = new Set<string>();
  const result: AuditYearInfo[] = [];
  for (const item of data.list) {
    const key = `${item.bsns_year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      bsnsYear: (item.bsns_year ?? "").replace(/\n/g, " "),
      adtor: item.adtor ?? "",
      adtOpinion: item.adt_opinion ?? "",
      emphsMatter: item.emphs_matter ?? "",
      coreAdtMatter: item.core_adt_matter ?? "",
    });
  }
  return result;
}

function parseRatioValue(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function fetchFinancialIndicators(
  apiKey: string,
  corpCode: string,
  year: number,
  ratioNames: string[]
): Promise<Record<string, number | null>> {
  const neededCategories = RATIO_CATEGORIES.filter((cat) => cat.ratios.some((r) => ratioNames.includes(r)));
  const results = await Promise.all(
    neededCategories.map(async (cat) => {
      const params = new URLSearchParams({
        crtfc_key: apiKey,
        corp_code: corpCode,
        bsns_year: String(year),
        reprt_code: REPRT_CODE_ANNUAL,
        idx_cl_code: cat.code,
      });
      try {
        const resp = await fetch(`${BASE_URL}/fnlttSinglIndx.json?${params}`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!resp.ok) return [];
        const data = await resp.json();
        if (data.status !== "000" || !Array.isArray(data.list)) return [];
        return data.list as { idx_nm: string; idx_val?: string }[];
      } catch {
        return [];
      }
    })
  );

  const flat = results.flat();
  const out: Record<string, number | null> = {};
  for (const name of ratioNames) {
    const item = flat.find((i) => i.idx_nm === name);
    out[name] = item ? parseRatioValue(item.idx_val) : null;
  }
  return out;
}
