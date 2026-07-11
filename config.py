import os

from dotenv import load_dotenv

load_dotenv()

API_KEY = os.environ.get("DART_API_KEY")

if not API_KEY:
    raise RuntimeError(
        "DART_API_KEY가 설정되지 않았습니다. .env 파일에 DART_API_KEY=발급받은키 형태로 추가하세요."
    )
