import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import type { CompanyResult } from "@/lib/dart";

export const preferredRegion = "icn1";
export const maxDuration = 60;

const METRIC_ORDER = ["매출액", "영업이익", "당기순이익", "자산총계", "부채총계", "자본총계"];
const PERIODS: ("당기" | "전기" | "전전기")[] = ["당기", "전기", "전전기"];

export async function POST(req: NextRequest) {
  const body = await req.json();
  const companies: CompanyResult[] = body.companies ?? [];

  if (!Array.isArray(companies) || companies.length === 0) {
    return NextResponse.json({ error: "비교 데이터가 없습니다." }, { status: 400 });
  }

  const workbook = new ExcelJS.Workbook();

  const summarySheet = workbook.addWorksheet("비교요약");
  const headerRow1 = ["지표"];
  const headerRow2 = [""];
  for (const c of companies) {
    for (const p of PERIODS) headerRow1.push(c.corpName);
    for (const p of PERIODS) headerRow2.push(`${c.years[p]}년`);
  }
  summarySheet.addRow(headerRow1);
  summarySheet.addRow(headerRow2);
  summarySheet.getRow(1).font = { bold: true };
  summarySheet.getRow(2).font = { bold: true };

  for (const metric of METRIC_ORDER) {
    const row: (string | number | null)[] = [metric];
    for (const c of companies) {
      for (const p of PERIODS) row.push(c.metrics[metric]?.[p] ?? null);
    }
    const addedRow = summarySheet.addRow(row);
    addedRow.eachCell((cell, colNumber) => {
      if (colNumber > 1) cell.numFmt = "#,##0";
    });
  }
  summarySheet.columns.forEach((col) => (col.width = 18));
  summarySheet.getColumn(1).width = 14;

  for (const c of companies) {
    const sheet = workbook.addWorksheet(c.corpName.slice(0, 31));
    sheet.addRow(["구분", "계정명", `당기(${c.years.당기})`, `전기(${c.years.전기})`, `전전기(${c.years.전전기})`]);
    sheet.getRow(1).font = { bold: true };
    for (const acc of c.rawAccounts) {
      sheet.addRow([
        acc.sj_nm ?? "",
        acc.account_nm ?? "",
        acc.thstrm_amount ?? "",
        acc.frmtrm_amount ?? "",
        acc.bfefrmtrm_amount ?? "",
      ]);
    }
    sheet.columns.forEach((col) => (col.width = 20));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `재무비교_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
}
