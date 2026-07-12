// 클라이언트(선택 UI)와 서버(lib/dart.ts) 양쪽에서 공유하는 재무비율 목록.
// lib/dart.ts를 그대로 client component에서 import하면 corp_codes_listed.json(약 300KB)까지
// 번들에 딸려오므로, 가벼운 이 파일로 분리해둔다.
export const RATIO_CATEGORIES: { code: string; label: string; ratios: string[] }[] = [
  { code: "M210000", label: "수익성지표", ratios: ["ROE", "순이익률", "매출총이익률", "총자산영업이익률"] },
  { code: "M220000", label: "안정성지표", ratios: ["부채비율", "유동비율", "자기자본비율", "이자보상배율"] },
  {
    code: "M230000",
    label: "성장성지표",
    ratios: ["매출액증가율(YoY)", "영업이익증가율(YoY)", "순이익증가율(YoY)", "총자산증가율"],
  },
  { code: "M240000", label: "활동성지표", ratios: ["총자산회전율", "재고자산회전율"] },
];

export const ALL_RATIO_NAMES = RATIO_CATEGORIES.flatMap((c) => c.ratios);

export const DEFAULT_SELECTED_RATIOS = ["ROE", "부채비율", "유동비율"];
