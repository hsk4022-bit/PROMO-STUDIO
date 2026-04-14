# PROMO 생성 커맨드

사용자가 아래 형식으로 요청하면 이 파일의 지침을 따라 실행한다.

```
[PROMO 생성 요청]
노션 URL: ...
Notion Token: ...
Gemini Key: (생략 가능)
```

---

## 절대 원칙

- 텍스트/이미지 누락 = 작업 실패
- 누락 발생 시 즉시 중단하고 사용자에게 보고
- 소스 코드(app.js, index.html 등) 수정 금지
- 컨펌 없이 다음 단계 진행 금지

---

## 참조 파일 (반드시 읽을 것)

- 파싱 규칙: https://raw.githubusercontent.com/hsk4022-bit/PROMO-STUDIO/main/promo-editor/notion_parsing_rules.md
- HTML 생성 가이드라인: https://raw.githubusercontent.com/hsk4022-bit/PROMO-STUDIO/main/promo-editor/master_guidelines.md

---

## Step 1: 노션 파싱

1. 위 두 파일 읽어서 파싱 규칙 + HTML 생성 기준 파악
2. Notion API로 노션 페이지 전체 fetch (페이지네이션 끝까지)
3. 모든 블록 재귀적으로 탐색 (bullet, callout, paragraph, toggle 등 중첩 포함)
4. 텍스트 + image 블록 URL + 텍스트 마커 전부 추출
5. image 블록 URL → 만료 전 즉시 노션 명시 경로에 다운로드
6. 파싱 결과 사용자에게 요약 보여주기

**사용자 확인 후 컨펌 대기**

---

## Step 2: 히어로 이미지 생성

1. HERO_SECTION 정보 기반으로 히어로 이미지 생성
2. 노션 명시 경로에 저장

**사용자 확인 후 컨펌 대기**

---

## Step 3: HTML 생성 및 검증

1. master_guidelines.md 기준으로 HTML 생성
2. 검증: 노션 image 블록 수 + 텍스트 마커 수 = HTML img 태그 수
   - 불일치 시 재작업 (어떤 이미지가 누락됐는지 보고)
3. 검증 통과 후 노션 명시 저장 경로에 저장

**사용자 확인 후 컨펌 대기 → 저장**
