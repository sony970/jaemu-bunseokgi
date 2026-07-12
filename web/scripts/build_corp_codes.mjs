import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import fs from "fs";

const apiKey = process.env.DART_API_KEY;
if (!apiKey) throw new Error("DART_API_KEY env var required");

const resp = await fetch(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${apiKey}`);
if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
const bytes = new Uint8Array(await resp.arrayBuffer());
const unzipped = unzipSync(bytes);
const xml = new TextDecoder("utf-8").decode(unzipped["CORPCODE.xml"]);

const parser = new XMLParser({ parseTagValue: false });
const parsed = parser.parse(xml);
const list = parsed?.result?.list ?? [];
const arr = Array.isArray(list) ? list : [list];

const all = arr.map((item) => ({
  corp_code: String(item.corp_code ?? "").trim(),
  corp_name: String(item.corp_name ?? "").trim(),
  stock_code: String(item.stock_code ?? "").trim(),
}));

const listed = all.filter((c) => c.stock_code);

fs.writeFileSync("lib/corp_codes_listed.json", JSON.stringify(listed));
console.log(`total: ${all.length}, listed: ${listed.length}`);
