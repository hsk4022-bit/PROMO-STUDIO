# 필독 (MANDATORY)

이 프로젝트에서 작업하는 모든 에이전트는 작업 시작 **전에** 반드시 아래를 수행해야 한다.

## 1. 규칙 파일 전수 로드 (예외 없음)
다음 3개 파일을 **반드시 전부** 읽은 후 작업 시작한다. 하나라도 건너뛰면 즉시 FAIL.

- **`master_guidelines.md`** — HTML 생성·팝업·반응형·컬러·레이아웃 등 모든 결과물 규칙의 원본
- **`notion_parsing_rules.md`** — 노션 기획서 파싱 규칙 (블록 타입, callout 재귀, 이미지, 해시 폴더, 테이블 병합 등)
- **`app.js`** — 결과물 포맷 규칙의 원본. 다음 함수/상수를 반드시 확인:
  - `generateHashString(length)` — 해시 폴더명 규칙 (16자리)
  - `detectExistingHash()` — 수정 시 기존 해시 유지
  - `currentHashFolder` — 해시 상태
  - `IMAGE_MODEL`, `CONTENT_MODEL` — Gemini 모델명 **(확인만 할 것, 절대 수정 금지)**
  - ZIP 구조 (`PROMO_SLICED/`, `PROMO_html/`)

> 에이전트가 수동으로 HTML을 생성하더라도 **promo-editor가 만드는 결과물과 완전히 동일한 포맷**을 따라야 한다. 임의 폴더명·파일 구조·해시 규칙 생성 금지.

## 2. PRE-FLIGHT 선언 출력
파일 로드 후 사용자에게 다음 선언을 출력한 뒤 작업 시작:

```
✅ master_guidelines.md 로드 완료
✅ notion_parsing_rules.md 로드 완료
✅ app.js 포맷 규칙 확인 완료 (해시 폴더 / 모델명 / ZIP 구조)
```

이 선언 없이 작업 시작 시 즉시 FAIL.

## 3. 작업 완료 후
결과물 전달 전에 `master_guidelines.md` 의 **[자가 검증 리포트]** 섹션에 정의된 리포트를 반드시 출력한다.

---

**세부 규칙, FAIL 조건, 금지 항목, 자가 검증 리포트는 모두 `master_guidelines.md` 와 `notion_parsing_rules.md` 참조.**
