"use client";

import { useState } from "react";
import type { CompanyResult } from "@/lib/dart";

const METRIC_ORDER = ["매출액", "영업이익", "당기순이익", "자산총계", "부채총계", "자본총계"];
const PERIODS: ("당기" | "전기" | "전전기")[] = ["당기", "전기", "전전기"];

function formatAmount(v: number | null) {
  if (v === null || v === undefined) return "-";
  return (v / 1_0000_0000).toLocaleString("ko-KR", { maximumFractionDigits: 0 }) + "억";
}

export default function Home() {
  const [names, setNames] = useState(["", "", ""]);
  const [year, setYear] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<CompanyResult[] | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCompanies(null);
    const filled = names.map((n) => n.trim()).filter(Boolean);
    if (filled.length === 0) {
      setError("회사명을 1개 이상 입력하세요.");
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies: filled, year: year || undefined }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error ?? "조회 중 오류가 발생했습니다.");
        return;
      }
      setCompanies(data.companies);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

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
    <div className="min-h-screen px-6 py-10 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">재무분석기</h1>
      <p className="text-sm text-gray-500 mb-6">
        DART 전자공시 데이터를 이용해 최대 3개 회사의 최근 3개년 재무제표를 비교합니다.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end mb-6">
        {names.map((name, i) => (
          <input
            key={i}
            type="text"
            placeholder={`회사명 ${i + 1}`}
            value={name}
            onChange={(e) => {
              const next = [...names];
              next[i] = e.target.value;
              setNames(next);
            }}
            className="border rounded px-3 py-2 w-40"
          />
        ))}
        <input
          type="number"
          placeholder="연도(선택)"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className="border rounded px-3 py-2 w-28"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-black text-white rounded px-4 py-2 disabled:opacity-50"
        >
          {loading ? "조회 중..." : "비교하기"}
        </button>
      </form>

      {error && <p className="text-red-600 mb-4 whitespace-pre-wrap">{error}</p>}

      {companies && companies.length > 0 && (
        <div className="overflow-x-auto">
          <table className="border-collapse w-full text-sm mb-4">
            <thead>
              <tr>
                <th className="border px-3 py-2 bg-gray-100">지표</th>
                {companies.map((c) =>
                  PERIODS.map((p) => (
                    <th key={c.corpName + p} className="border px-3 py-2 bg-gray-100">
                      {c.corpName}
                      <br />
                      {c.years[p]}년
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {METRIC_ORDER.map((metric) => (
                <tr key={metric}>
                  <td className="border px-3 py-2 font-medium">{metric}</td>
                  {companies.map((c) =>
                    PERIODS.map((p) => (
                      <td key={c.corpName + p} className="border px-3 py-2 text-right">
                        {formatAmount(c.metrics[metric]?.[p] ?? null)}
                      </td>
                    ))
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          <button
            onClick={handleDownload}
            disabled={downloading}
            className="bg-green-700 text-white rounded px-4 py-2 disabled:opacity-50"
          >
            {downloading ? "생성 중..." : "엑셀 다운로드"}
          </button>
        </div>
      )}
    </div>
  );
}
