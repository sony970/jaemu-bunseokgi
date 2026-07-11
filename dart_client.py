import io
import json
import time
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import requests

BASE_URL = "https://opendart.fss.or.kr/api"
CACHE_PATH = Path(__file__).parent / "cache" / "corp_codes.json"
CACHE_MAX_AGE_SECONDS = 7 * 24 * 3600

REPRT_CODE_ANNUAL = "11011"

# (표시명, 계정명 후보 목록 - 우선순위 순)
KEY_METRICS = [
    ("매출액", ["BS_EXCLUDE", ["매출액", "수익(매출액)", "영업수익"]]),
    ("영업이익", ["BS_EXCLUDE", ["영업이익", "영업이익(손실)"]]),
    ("당기순이익", ["BS_EXCLUDE", ["당기순이익", "당기순이익(손실)", "분기순이익(손실)", "반기순이익(손실)"]]),
    ("자산총계", ["BS_ONLY", ["자산총계"]]),
    ("부채총계", ["BS_ONLY", ["부채총계"]]),
    ("자본총계", ["BS_ONLY", ["자본총계"]]),
]


class DartApiError(Exception):
    pass


class CompanyNotFoundError(Exception):
    def __init__(self, name, candidates=None):
        self.name = name
        self.candidates = candidates or []
        msg = f"'{name}'에 해당하는 회사를 찾을 수 없습니다."
        if self.candidates:
            msg += " 혹시 이 중 하나인가요? " + ", ".join(self.candidates)
        super().__init__(msg)


def _download_corp_codes(api_key):
    resp = requests.get(BASE_URL + "/corpCode.xml", params={"crtfc_key": api_key}, timeout=30)
    resp.raise_for_status()
    content = resp.content
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            xml_bytes = zf.read("CORPCODE.xml")
    except zipfile.BadZipFile:
        # DART returns plain XML/JSON error body (e.g. invalid key) instead of a zip
        raise DartApiError(f"고유번호 목록을 받아오지 못했습니다: {content[:200]!r}")

    root = ET.fromstring(xml_bytes)
    corp_list = []
    for item in root.findall("list"):
        corp_list.append(
            {
                "corp_code": (item.findtext("corp_code") or "").strip(),
                "corp_name": (item.findtext("corp_name") or "").strip(),
                "stock_code": (item.findtext("stock_code") or "").strip(),
                "modify_date": (item.findtext("modify_date") or "").strip(),
            }
        )
    return corp_list


def load_corp_codes(api_key, force_refresh=False):
    if not force_refresh and CACHE_PATH.exists():
        age = time.time() - CACHE_PATH.stat().st_mtime
        if age < CACHE_MAX_AGE_SECONDS:
            with open(CACHE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)

    corp_list = _download_corp_codes(api_key)
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(corp_list, f, ensure_ascii=False)
    return corp_list


def find_corp(corp_codes, name):
    name = name.strip()

    exact = [c for c in corp_codes if c["corp_name"] == name]
    if exact:
        listed = [c for c in exact if c["stock_code"]]
        return (listed or exact)[0]

    partial = [c for c in corp_codes if name in c["corp_name"]]
    if partial:
        listed = [c for c in partial if c["stock_code"]]
        pool = listed or partial
        pool.sort(key=lambda c: len(c["corp_name"]))
        return pool[0]

    # no substring match: suggest closest-looking names for the error message
    candidates = [c["corp_name"] for c in corp_codes if c["corp_name"][:1] == name[:1]][:5]
    raise CompanyNotFoundError(name, candidates)


def _fetch_accounts(api_key, corp_code, bsns_year, fs_div, reprt_code=REPRT_CODE_ANNUAL):
    resp = requests.get(
        BASE_URL + "/fnlttSinglAcntAll.json",
        params={
            "crtfc_key": api_key,
            "corp_code": corp_code,
            "bsns_year": str(bsns_year),
            "reprt_code": reprt_code,
            "fs_div": fs_div,
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    status = data.get("status")
    if status != "000":
        return status, data.get("message", ""), []
    return status, data.get("message", ""), data.get("list", [])


def get_financial_accounts(api_key, corp_code, bsns_year, reprt_code=REPRT_CODE_ANNUAL):
    """연결(CFS) 우선 조회, 데이터 없으면 별도(OFS) 재시도."""
    status, message, accounts = _fetch_accounts(api_key, corp_code, bsns_year, "CFS", reprt_code)
    fs_div_used = "CFS"
    if status != "000" or not accounts:
        status, message, accounts = _fetch_accounts(api_key, corp_code, bsns_year, "OFS", reprt_code)
        fs_div_used = "OFS"
    return status, message, fs_div_used, accounts


def find_latest_available_year(api_key, corp_code, start_year, min_year=None, reprt_code=REPRT_CODE_ANNUAL):
    if min_year is None:
        min_year = start_year - 6
    year = start_year
    while year >= min_year:
        status, _, fs_div_used, accounts = get_financial_accounts(api_key, corp_code, year, reprt_code)
        if status == "000" and accounts:
            return year, fs_div_used, accounts
        year -= 1
    return None, None, []


def _to_int(amount_str):
    if not amount_str:
        return None
    try:
        return int(str(amount_str).replace(",", ""))
    except ValueError:
        return None


def extract_key_metrics(accounts):
    """계정 리스트에서 핵심 지표를 (지표명 -> {당기,전기,전전기}) 형태로 뽑아낸다."""
    is_accounts = [a for a in accounts if a.get("sj_div") in ("IS", "CIS")]
    bs_accounts = [a for a in accounts if a.get("sj_div") == "BS"]

    result = {}
    for label, (scope, candidates) in KEY_METRICS:
        pool = bs_accounts if scope == "BS_ONLY" else is_accounts
        found = None
        for cand in candidates:
            for acc in pool:
                if acc.get("account_nm", "").strip() == cand:
                    found = acc
                    break
            if found:
                break
        if not found:
            for cand in candidates:
                for acc in pool:
                    if cand in acc.get("account_nm", ""):
                        found = acc
                        break
                if found:
                    break

        if found:
            result[label] = {
                "당기": _to_int(found.get("thstrm_amount")),
                "전기": _to_int(found.get("frmtrm_amount")),
                "전전기": _to_int(found.get("bfefrmtrm_amount")),
            }
        else:
            result[label] = {"당기": None, "전기": None, "전전기": None}
    return result
