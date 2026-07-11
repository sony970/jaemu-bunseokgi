# 재무분석기

DART(전자공시시스템) 데이터를 이용해 국내 상장사 3곳의 최근 3개년 재무제표를 비교하고 엑셀로 저장하는 CLI 도구.

## 설치
```
pip install -r requirements.txt
```

`.env.example`을 `.env`로 복사한 뒤 OpenDART에서 발급받은 API 키를 입력하세요 (무료 발급: https://opendart.fss.or.kr).
```
DART_API_KEY=발급받은키
```

## 사용법
```
python main.py "회사명1" "회사명2" "회사명3"
```

옵션:
- `--year 2024` : 특정 사업연도 기준으로 조회 (생략 시 최신 연도 자동 탐색)
- `--output 파일명.xlsx` : 저장 경로 지정 (기본값: `output/재무비교_YYYYMMDD.xlsx`)

## 예시
```
python main.py "삼성전자" "SK하이닉스" "LG전자"
```

## 산출물
- **비교요약** 시트: 매출액/영업이익/당기순이익/자산총계/부채총계/자본총계를 3개 회사 × 최근 3개년으로 비교
- **회사별 시트**: 각 회사의 전체 계정과목 원본 데이터

자세한 개발 배경과 로드맵은 [PRD.md](PRD.md) 참고.
