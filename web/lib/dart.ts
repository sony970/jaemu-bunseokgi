import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";

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
  usedYear: number;
  fsDiv: "CFS" | "OFS";
  years: { 당기: number; 전기: number; 전전기: number };
  metrics: Record<string, { 당기: number | null; 전기: number | null; 전전기: number | null }>;
  rawAccounts: Account[];
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
  } catch {
    throw new DartApiError("DART 서버 응답이 지연되어 고유번호 목록을 받아오지 못했습니다.");
  }
  if (!resp.ok) throw new DartApiError(`고유번호 목록 다운로드 실패: HTTP ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());

  let xml: string;
  try {
    const zip = new AdmZip(buffer);
    xml = zip.readAsText("CORPCODE.xml");
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

export async function loadCorpCodes(apiKey: string): Promise<Corp[]> {
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
  } catch {
    throw new DartApiError("DART 서버 응답이 지연되어 재무제표를 받아오지 못했습니다.");
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

export function extractKeyMetrics(accounts: Account[]) {
  const isAccounts = accounts.filter((a) => a.sj_div === "IS" || a.sj_div === "CIS");
  const bsAccounts = accounts.filter((a) => a.sj_div === "BS");

  const result: CompanyResult["metrics"] = {};
  for (const [label, scope, candidates] of KEY_METRICS) {
    const pool = scope === "BS_ONLY" ? bsAccounts : isAccounts;
    let found: Account | undefined;
    for (const cand of candidates) {
      found = pool.find((a) => (a.account_nm ?? "").trim() === cand);
      if (found) break;
    }
    if (!found) {
      for (const cand of candidates) {
        found = pool.find((a) => (a.account_nm ?? "").includes(cand));
        if (found) break;
      }
    }
    result[label] = found
      ? {
          당기: toInt(found.thstrm_amount),
          전기: toInt(found.frmtrm_amount),
          전전기: toInt(found.bfefrmtrm_amount),
        }
      : { 당기: null, 전기: null, 전전기: null };
  }
  return result;
}

export async function fetchCompany(apiKey: string, corpCodes: Corp[], name: string, year?: number): Promise<CompanyResult> {
  const corp = findCorp(corpCodes, name);

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

  return {
    corpName: corp.corp_name,
    usedYear,
    fsDiv: fsDivUsed,
    years: { 당기: usedYear, 전기: usedYear - 1, 전전기: usedYear - 2 },
    metrics: extractKeyMetrics(accounts),
    rawAccounts: accounts,
  };
}
