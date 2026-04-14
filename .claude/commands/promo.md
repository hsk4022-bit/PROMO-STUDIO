# PROMO 생성 커맨드

사용자가 아래 형식으로 요청하면 이 파일의 지침을 따라 실행한다.

```
[PROMO 생성 요청]
노션 URL: ...
Notion Token: ...
Gemini Key: (툴에 입력됨 / AIza...)
```

---

## 절대 원칙

- 텍스트/이미지 누락 = 작업 실패
- 누락 발생 시 즉시 중단하고 사용자에게 보고
- 소스 코드(app.js, index.html 등) 수정 금지
- 툴을 거치지 않고 HTML 직접 생성 금지
- 컨펌 없이 다음 단계 진행 금지

---

## 경로

- promo-editor 툴: https://hsk4022-bit.github.io/PROMO-STUDIO/#post
- notion_parsing_rules.md: https://raw.githubusercontent.com/hsk4022-bit/PROMO-STUDIO/main/promo-editor/notion_parsing_rules.md

---

## Step 1: 노션 파싱 → 툴 입력

1. https://raw.githubusercontent.com/hsk4022-bit/PROMO-STUDIO/main/promo-editor/notion_parsing_rules.md 읽어서 툴 입력 필드 구조 파악 후 매핑 기준 설정
2. Notion API로 노션 페이지 전체 fetch (페이지네이션 끝까지)
3. 모든 블록 재귀적으로 탐색 (bullet, callout, paragraph, toggle 등 중첩 포함)
4. 텍스트 내용 + image 블록 URL + 텍스트 마커(item_01.png 등) 전부 추출
5. notion_parsing_rules.md 기준으로 툴 입력 필드에 매핑
6. 브라우저로 https://hsk4022-bit.github.io/PROMO-STUDIO/#post 열어 각 필드에 직접 입력
7. image 블록 → 위지윅에 삽입
8. 텍스트 마커 → 노션에 명시된 이미지 폴더 경로에서 찾아 삽입
9. 이미지 마커가 본문+팝업 양쪽에 있으면 양쪽 다 삽입

**브라우저에서 사용자 확인 후 컨펌 대기**

---

## Step 2: 히어로 이미지 생성

1. https://hsk4022-bit.github.io/PROMO-STUDIO/#post 에서 히어로 이미지 생성

**사용자 확인 후 컨펌 대기**

---

## Step 3: HTML 생성 및 검증

1. https://hsk4022-bit.github.io/PROMO-STUDIO/#post 에서 HTML 생성
2. 검증: 노션 image 블록 수 + 텍스트 마커 수 = HTML img 태그 수
   - 불일치 시 재작업 (사용자에게 어떤 이미지가 누락됐는지 보고)
3. 검증 통과 후 사용자 확인

**사용자 확인 후 컨펌 대기 → 저장**
