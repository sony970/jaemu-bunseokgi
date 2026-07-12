"use client";

import { useEffect, useState } from "react";
import type { CompanyResult } from "@/lib/dart";
import { RATIO_CATEGORIES, DEFAULT_SELECTED_RATIOS } from "@/lib/ratios";
import { getYearColumns } from "@/lib/yearColumns";
import CompanySearchInput from "@/app/components/CompanySearchInput";
import TrendChart from "@/app/components/TrendChart";

const METRIC_ORDER = ["매출액", "영업이익", "당기순이익", "자산총계", "부채총계", "자본총계"];
const CHART_COLORS = ["#4f46e5", "#059669", "#d97706"];

function formatAmount(v: number | null) {
  if (v === null || v === undefined) return "-";
  return (v / 1_0000_0000).toLocaleString("ko-KR", { maximumFractionDigits: 0 }) + "억";
}

function formatRatio(v: number | null | undefined) {
  if (v === null || v === undefined) return "-";
  return v.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + "%";
}

function opinionBadgeClass(opinion: string) {
  if (opinion.includes("적정")) return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
  if (opinion.includes("의견거절") || opinion.includes("부적정")) return "bg-red-50 text-red-700 ring-red-600/20";
  return "bg-amber-50 text-amber-700 ring-amber-600/20";
}

export default function Home() {
  const [names, setNames] = useState(["", "", ""]);
  const [year, setYear] = useState("");
  const [yearsCount, setYearsCount] = useState(3);
  const [selectedRatios, setSelectedRatios] = useState<string[]>(DEFAULT_SELECTED_RATIOS);
  const [chartMetric, setChartMetric] = useState(METRIC_ORDER[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<CompanyResult[] | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  function toggleRatio(name: string) {
    setSelectedRatios((prev) => (prev.includes(name) ? prev.filter((r) => r !== name) : [...prev, name]));
  }

  async function runCompare(filled: string[], yearVal: string, yearsCountVal: number, ratiosVal: string[]) {
    setError(null);
    setCompanies(null);
    if (filled.length === 0) {
      setError("회사명을 1개 이상 입력하세요.");
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companies: filled,
          year: yearVal || undefined,
          ratios: ratiosVal,
          yearsCount: yearsCountVal,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error ?? "조회 중 오류가 발생했습니다.");
        return;
      }
      setCompanies(data.companies);

      const params = new URLSearchParams();
      params.set("companies", filled.join(","));
      if (yearVal) params.set("year", yearVal);
      params.set("yearsCount", String(yearsCountVal));
      if (ratiosVal.length > 0) params.set("ratios", ratiosVal.join(","));
      window.history.replaceState(null, "", `?${params.toString()}`);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const filled = names.map((n) => n.trim()).filter(Boolean);
    await runCompare(filled, year, yearsCount, selectedRatios);
  }

  // 공유된 URL(예: ?companies=삼성전자,삼성전기&yearsCount=5)로 들어오면 자동으로 같은 비교를 재현한다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const companiesParam = params.get("companies");
    if (!companiesParam) return;

    const namesFromUrl = companiesParam.split(",").filter(Boolean).slice(0, 3);
    const yearFromUrl = params.get("year") ?? "";
    const yearsCountFromUrl = Math.min(5, Math.max(3, Number(params.get("yearsCount")) || 3));
    const ratiosFromUrl = (params.get("ratios") ?? "").split(",").filter(Boolean);

    setNames([namesFromUrl[0] ?? "", namesFromUrl[1] ?? "", namesFromUrl[2] ?? ""]);
    setYear(yearFromUrl);
    setYearsCount(yearsCountFromUrl);
    if (ratiosFromUrl.length > 0) setSelectedRatios(ratiosFromUrl);

    runCompare(namesFromUrl, yearFromUrl, yearsCountFromUrl, ratiosFromUrl.length > 0 ? ratiosFromUrl : selectedRatios);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDownload() {
    if (!companies) return;
    setDownloading(true);
    try {
      const resp = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies }),
      });
      if (!resp.ok) {
        setError("엑셀 생성에 실패했습니다.");
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "재무비교.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">재무분석기</h1>
          <p className="text-sm text-gray-500 mt-1">
            DART 전자공시 데이터로 최대 3개 회사의 재무제표·재무비율·업종·핵심감사사항을 한눈에 비교합니다.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 mb-6">
          <div className="flex flex-wrap gap-3 items-end">
            {names.map((name, i) => (
              <CompanySearchInput
                key={i}
                value={name}
                placeholder={`회사명 ${i + 1}`}
                onChange={(v) => {
                  const next = [...names];
                  next[i] = v;
                  setNames(next);
                }}
              />
            ))}
            <input
              type="number"
              placeholder="연도(선택)"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 w-28 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
              {[3, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setYearsCount(n)}
                  className={`px-3 py-2 transition-colors ${
                    yearsCount === n ? "bg-indigo-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {n}개년
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="bg-indigo-600 hover:bg-indigo-700 transition-colors text-white rounded-lg px-5 py-2 text-sm font-medium disabled:opacity-50"
            >
              {loading ? "조회 중..." : "비교하기"}
            </button>
          </div>

          <div className="mt-5 pt-4 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-500 mb-2">비교할 재무비율 선택</p>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              {RATIO_CATEGORIES.map((cat) => (
                <div key={cat.code}>
                  <p className="text-xs text-gray-400 mb-1">{cat.label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {cat.ratios.map((ratio) => {
                      const checked = selectedRatios.includes(ratio);
                      return (
                        <label
                          key={ratio}
                          className={`cursor-pointer text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            checked
                              ? "bg-indigo-600 border-indigo-600 text-white"
                              : "bg-white border-gray-300 text-gray-600 hover:border-indigo-300"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleRatio(ratio)}
                            className="hidden"
                          />
                          {ratio}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </form>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 mb-6 text-sm whitespace-pre-wrap">
            {error}
          </div>
        )}

        {companies && companies.length > 0 && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {companies.map((c) => {
                const latestAudit = c.audit?.[0];
                return (
                  <div key={c.corpName} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
                    <h2 className="font-semibold text-gray-900">{c.corpName}</h2>
                    {c.industryName && <p className="text-xs text-gray-500 mt-0.5">{c.industryName}</p>}
                    {latestAudit && (
                      <div className="mt-3">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded-full ring-1 ring-inset ${opinionBadgeClass(
                              latestAudit.adtOpinion
                            )}`}
                          >
                            {latestAudit.adtOpinion || "감사의견 미확인"}
                          </span>
                          {latestAudit.adtor && <span className="text-xs text-gray-400">{latestAudit.adtor}</span>}
                        </div>
                        {latestAudit.coreAdtMatter && (
                          <p className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">
                            <span className="font-medium text-gray-700">핵심감사사항</span>
                            <br />
                            {latestAudit.coreAdtMatter}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 overflow-x-auto">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">재무제표 비교</h3>
              <table className="border-collapse w-full text-sm">
                <thead>
                  <tr>
                    <th
                      rowSpan={2}
                      className="border-b border-gray-200 px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap align-bottom"
                    >
                      지표
                    </th>
                    {companies.map((c, ci) => {
                      const cols = getYearColumns(c);
                      return (
                        <th
                          key={c.corpName}
                          colSpan={cols.length}
                          className={`px-3 py-1.5 text-center text-gray-700 font-semibold whitespace-nowrap bg-gray-50 ${
                            ci > 0 ? "border-l-2 border-gray-200" : ""
                          }`}
                        >
                          {c.corpName}
                        </th>
                      );
                    })}
                  </tr>
                  <tr>
                    {companies.map((c, ci) =>
                      getYearColumns(c).map((col, i) => (
                        <th
                          key={c.corpName + col.year}
                          className={`border-b border-gray-200 px-3 py-2 text-right text-gray-500 font-medium whitespace-nowrap ${
                            ci > 0 && i === 0 ? "border-l-2 border-gray-200" : ""
                          }`}
                        >
                          {col.year}년
                        </th>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {METRIC_ORDER.map((metric) => (
                    <tr key={metric} className="hover:bg-gray-50">
                      <td className="border-b border-gray-100 px-3 py-2 font-medium text-gray-700 whitespace-nowrap">
                        {metric}
                      </td>
                      {companies.map((c, ci) =>
                        getYearColumns(c).map((col, i) => (
                          <td
                            key={c.corpName + col.year}
                            className={`border-b border-gray-100 px-3 py-2 text-right whitespace-nowrap ${
                              ci > 0 && i === 0 ? "border-l-2 border-gray-200" : ""
                            }`}
                          >
                            {formatAmount(col.metrics[metric] ?? null)}
                          </td>
                        ))
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">연도별 추세</h3>
                <select
                  value={chartMetric}
                  onChange={(e) => setChartMetric(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {METRIC_ORDER.map((metric) => (
                    <option key={metric} value={metric}>
                      {metric}
                    </option>
                  ))}
                </select>
              </div>
              {(() => {
                const perCompanyCols = companies.map((c) => getYearColumns(c));
                const allYears = Array.from(new Set(perCompanyCols.flat().map((col) => col.year))).sort(
                  (a, b) => a - b
                );
                return (
                  <TrendChart
                    years={allYears}
                    series={companies.map((c, i) => ({
                      name: c.corpName,
                      color: CHART_COLORS[i % CHART_COLORS.length],
                      values: allYears.map(
                        (y) => perCompanyCols[i].find((col) => col.year === y)?.metrics[chartMetric] ?? null
                      ),
                    }))}
                  />
                );
              })()}
            </div>

            {selectedRatios.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 overflow-x-auto">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">재무비율 비교 (당기 기준)</h3>
                <table className="border-collapse w-full text-sm">
                  <thead>
                    <tr>
                      <th className="border-b border-gray-200 px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">
                        지표
                      </th>
                      {companies.map((c) => (
                        <th
                          key={c.corpName}
                          className="border-b border-gray-200 px-3 py-2 text-right text-gray-500 font-medium whitespace-nowrap"
                        >
                          {c.corpName}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRatios.map((ratio) => (
                      <tr key={ratio} className="hover:bg-gray-50">
                        <td className="border-b border-gray-100 px-3 py-2 font-medium text-gray-700 whitespace-nowrap">
                          {ratio}
                        </td>
                        {companies.map((c) => (
                          <td key={c.corpName} className="border-b border-gray-100 px-3 py-2 text-right whitespace-nowrap">
                            {formatRatio(c.indicators?.[ratio])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="bg-emerald-600 hover:bg-emerald-700 transition-colors text-white rounded-lg px-5 py-2 text-sm font-medium disabled:opacity-50"
              >
                {downloading ? "생성 중..." : "엑셀 다운로드"}
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  setLinkCopied(true);
                  setTimeout(() => setLinkCopied(false), 1500);
                }}
                className="bg-white border border-gray-300 hover:bg-gray-50 transition-colors text-gray-700 rounded-lg px-5 py-2 text-sm font-medium"
              >
                {linkCopied ? "복사됨!" : "링크 복사"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
