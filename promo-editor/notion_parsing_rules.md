# 노션 기획서 파싱 규칙 (Notion Parsing Rules)

노션 기획서를 HTML/배너 결과물로 변환할 때 반드시 준수해야 하는 파싱 규칙.
promo-editor, banner-studio, banner-l 모든 도구에서 공통으로 사용.

---

## [파싱 대상 블록 타입 — 하나라도 누락하면 FAIL]

| 블록 타입 | 용도 |
|-----------|------|
| `heading_1` / `heading_2` / `heading_3` | 섹션 구분자 |
| `paragraph` | 본문 텍스트 |
| `bulleted_list_item` | 불릿 리스트 |
| `numbered_list_item` | 숫자 리스트 |
| `table` | 테이블 (children으로 table_row 순회) |
| `callout` | ⚠️ 툴팁/팝업/강조 박스 (자주 누락되는 타입. 반드시 처리) |
| `image` | 이미지 블록 |
| `divider` | 구분선 |
| `toggle` | 접기/펼치기 |
| `quote` | 인용 |
| `code` | 코드 블록 |

---

## [콜아웃(callout) 블록 처리 규칙] ⚠️ 최우선 확인

노션에서 툴팁/팝업은 **callout 블록**으로 작성된다. 절대 누락 금지.

### 판별 방법
1. `block.type === "callout"` 인 블록을 **모두** 스캔
2. `callout.rich_text`의 첫 줄이 `[툴팁N]` 또는 `[팝업N]` 형식이면 팝업으로 변환 (N은 숫자)
3. `callout.has_children === true` 이면 `/v1/blocks/{id}/children` API로 내용 가져오기
4. children에는 `bulleted_list_item` / `paragraph` / `table` 등 중첩 블록 포함 가능 → 재귀 파싱

### 중첩(nested) 블록 — 무조건 재귀 파싱 (누락 시 FAIL)
- **bullet 안의 bullet, paragraph 안의 bullet, callout 안의 callout, bullet 안의 image 등 모든 중첩 구조를 재귀적으로 끝까지 따라가야 한다.**
- **본문(CONTENT_SECTION)의 bullet/paragraph/heading 도 모두 `has_children=true` 여부 확인 후 재귀.** 콜아웃만 nested 검사하면 FAIL.
- 한 레벨만 파싱하고 그치면 즉시 FAIL. 예시:
  - 툴팁1 콜아웃이 `랭킹 등록 기준` 하나만 있는 것처럼 보여도, 그 bullet이 `has_children=true`면 그 아래 `1순위/2순위/3순위`가 반드시 존재함.
  - 본문 마도코어 섹션의 `랭킹 등록 기준` bullet 안에도 nested children (1/2/3순위 + 이미지) 가 있을 수 있음. 본문에서도 무조건 재귀해야 함.
- **bullet 안의 image 블록 절대 누락 금지.** image 블록은 어디든 위치할 수 있으며 (페이지 직계, bullet 자식, paragraph 자식, callout 자식 등), 모든 위치에서 다운로드 + HTML 반영 필수.

### 본문 위치 추적 (이미지 위치 정확성)
- 노션 image 블록의 parent_id를 기반으로 본문 내 정확한 위치를 파악해야 한다.
- image 블록이 bullet의 child면 → 해당 bullet 직후에 `<img>` 삽입.
- image 블록이 callout(툴팁)의 child면 → 해당 팝업 데이터 블록 안에 `<img>` 삽입.
- image 블록이 페이지 직계 자식이면 → 노션의 순서 그대로 본문에 삽입.
- 임의 위치(예: 아무 섹션 끝)에 몰아넣기 금지.
- 재귀 파싱 알고리즘:
  ```python
  def walk_recursive(block_id, depth=0):
      children = get_all_children(block_id)
      for child in children:
          extract_content(child, depth)
          if child.get('has_children'):
              walk_recursive(child['id'], depth + 1)
  ```
- 재귀 시 `depth` 정보를 보존하여 HTML 에 들여쓰기/리스트 구조로 반영한다. 예: 2단계 bullet → `padding-left:1rem`.
- 파싱 완료 후 자가 검증:
  ```
  ✅ 노션 콜아웃 N개 전체 재귀 탐색
  ✅ 중첩 bullet/paragraph/table 수 = HTML 대응 요소 수
  ✅ 원고 문장 누락 0건
  ```
- 누락이 발견되면 **컨텐츠 유실(FAIL)** → 즉시 재작업.

### 변환 규칙
- `[툴팁1]` 콜아웃 → `<div id="popup-tooltip1">` 팝업 DOM 생성
- `[팝업1]` 콜아웃 → `<div id="popup-1">` 팝업 DOM 생성
- 본문에서 `[툴팁1]` / `[팝업1]` 마커가 발견된 위치 → 해당 팝업을 여는 `?` 아이콘 또는 버튼 삽입
- 콜아웃의 children은 팝업 body에 그대로 변환 삽입 (테이블, 리스트 포함)

### 팝업 구현 방식 (HTML)
CSS `:target` 기반 (JavaScript 불필요):
```html
<!-- 트리거 -->
<a href="#popup-tooltip1">?</a>

<!-- 팝업 본체 (페이지 하단에 배치) -->
<div id="popup-tooltip1" class="popup-overlay">
  <div class="popup-box">
    <div class="popup-header">
      <p class="popup-title">제목</p>
      <a href="#" class="popup-close">✕</a>
    </div>
    <div class="popup-body">
      <!-- 콜아웃 children 내용 -->
    </div>
  </div>
</div>
```

---

## [기획서 섹션 구분자 (heading_3)]

| 섹션명 | 용도 |
|--------|------|
| `# [기본 정보]` | 메타데이터 테이블 (프로모션명, 도구, 경로 등) |
| `# [HERO_SECTION]` | 히어로 이미지 정보 (타이틀, 스타일, 에셋 경로) |
| `# [CONTENT_SECTION]` | 본문 컨텐츠 (paragraph + table + callout 등 혼합) |
| `# [BANNER_SECTION]` | 배너 사이즈 테이블 |
| `# [배너별 번역 데이터]` | 번역 테이블 (banner-l 전용) |

## [기본 정보 테이블 — 무조건 전수 파싱]
**[기본 정보] 테이블의 모든 행을 예외 없이 파싱하여 HTML 생성에 반영해야 한다.** 한 행이라도 무시하면 FAIL.

### 필수 동작
1. 테이블의 모든 row를 순회하며 `{항목명: 값}` 딕셔너리 구성
2. 기획자는 언제든 새 행을 추가할 수 있으므로 **고정 항목만 확인하는 구조 금지**
3. 미지의 항목(새로 추가된 것)도 반드시 해당 의미에 맞는 위치에 반영해야 함
4. 파싱 완료 후 자가 검증 리포트에 "기본 정보 항목 수: N / 반영 수: N" 출력

### 주요 항목 → HTML 반영 위치
| 항목 | 반영 위치 |
|------|-----------|
| 프로모션명 | 대시보드 업데이트 |
| 작업모드 (또는 템플릿 경로) | 생성/템플릿/수정 분기 |
| 게시물 작업 도구 | promo-editor vs 피그마 분기 |
| 배너 작업 도구 | BANNER STUDIO vs 피그마 분기 |
| 이미지 폴더 경로 | content/asset/logo 읽기 기준 |
| 로컬 저장 경로 | 결과물 저장 위치 |
| 테스트 서버 경로 | 테스트 FTP 업로드 |
| 라이브 서버 경로 | 라이브 FTP 업로드 |
| **컨텐츠 영역 너비** | `se-contents`의 `max-width` (px → rem 변환) |
| 이미지 품질 | 이미지 압축 품질 |
| 이미지 포맷 | png / jpg / webp 변환 |
| 최대 용량 | 이미지 압축 목표 |
| 작업 흐름 | 컨펌 포인트 (HERO → CONTENT → 배포) |

### 자가 검증 시 반드시 출력
```
📋 기본 정보 파싱 리포트
- 노션 테이블 행 수: N
- 파싱된 항목 수: N (일치 필수)
- 신규 항목 (이전 작업에서 못 봤던 것): ___
- 미반영 항목: 없음 (반드시 0)
```

---

## [테이블 파싱]

- `table` 블록은 child 블록으로 `table_row`를 가지므로 `/v1/blocks/{table_id}/children` 호출 필수
- 첫 번째 `table_row`는 헤더로 처리 (`table.has_column_header === true` 확인)
- 각 `table_row.cells`는 2차원 배열: `cells[col_index]`는 rich_text 배열
- 셀 내용 추출: `cells[i].map(rt => rt.plain_text).join('')`

### 테이블 셀 병합 규칙 (노션은 머지 기능 없음 → 마크업 문법 사용)
노션 테이블은 셀 병합 기능이 없으므로 셀 내부에 **마크업 문법**을 작성한다.
에이전트는 파싱 시 해당 마크업을 감지하여 HTML `colspan`/`rowspan` 속성으로 변환한다.

#### 마크업 문법
- `[[colspan=N]]` → N개 열 병합 (가로 방향)
- `[[rowspan=N]]` → N개 행 병합 (세로 방향)
- `[[colspan=N,rowspan=M]]` → 행렬 병합 (2차원)
- 병합 대상 셀은 **반드시 비워둘 것**. 빈 셀을 파싱 시 스킵 처리.

#### 예시 1: 가로 병합 (colspan=3)
```
| 품목          | 기존         | 변경         |
| [[colspan=3]] 2025년 12월 24일 ~ 2026년 1월 22일 |    |    |
| 스피먼트 500개 | 용병 300개  | 용병 200개  |
```
HTML 변환:
```html
<tr><td>품목</td><td>기존</td><td>변경</td></tr>
<tr><td colspan="3">2025년 12월 24일 ~ 2026년 1월 22일</td></tr>
<tr><td>스피먼트 500개</td><td>용병 300개</td><td>용병 200개</td></tr>
```

#### 예시 2: 세로 병합 (rowspan=3)
```
| 순위 | 캐릭터        | 보상             |
| 1위  | [[rowspan=3]] 루돌이 | 거래 가능 |
| 2위  |               | 거래 가능 |
| 3위  |               | 거래 가능 |
```
HTML 변환:
```html
<tr><td>1위</td><td rowspan="3">루돌이</td><td>거래 가능</td></tr>
<tr><td>2위</td><td>거래 가능</td></tr>
<tr><td>3위</td><td>거래 가능</td></tr>
```

#### 예시 3: 행렬 병합
```
| [[colspan=2,rowspan=2]] 기간 |    | 상세 |
|                              |    | ...  |
```

#### 파싱 알고리즘
```python
def parse_table_with_merge(rows):
    html_rows = []
    # 행별 skip 셀 위치 추적 (rowspan 대응)
    skip_matrix = {}  # {row_idx: set(col_idx)}

    for r_idx, row in enumerate(rows):
        html_cells = []
        col_idx = 0
        for cell in row.cells:
            # 이전 rowspan에 의해 스킵되는 셀
            while (r_idx, col_idx) in skip_matrix.get(r_idx, set()):
                col_idx += 1

            text = extract_text(cell)
            colspan_match = re.match(r'\[\[colspan=(\d+)(?:,rowspan=(\d+))?\]\]\s*(.*)', text)
            rowspan_match = re.match(r'\[\[rowspan=(\d+)(?:,colspan=(\d+))?\]\]\s*(.*)', text)

            if colspan_match:
                cspan = int(colspan_match.group(1))
                rspan = int(colspan_match.group(2) or 1)
                content = colspan_match.group(3)
                html_cells.append(f'<td colspan="{cspan}" rowspan="{rspan}">{content}</td>')
                # 다음 cspan-1개 셀 스킵 (빈 셀)
                col_idx += cspan
            elif rowspan_match:
                rspan = int(rowspan_match.group(1))
                cspan = int(rowspan_match.group(2) or 1)
                content = rowspan_match.group(3)
                html_cells.append(f'<td rowspan="{rspan}" colspan="{cspan}">{content}</td>')
                # 아래 rspan-1개 행의 동일 col_idx 스킵
                for i in range(1, rspan):
                    skip_matrix.setdefault(r_idx + i, set()).add(col_idx)
                col_idx += cspan
            elif text == '':
                # 병합된 셀의 빈 공간 → 스킵
                col_idx += 1
                continue
            else:
                html_cells.append(f'<td>{text}</td>')
                col_idx += 1

        html_rows.append('<tr>' + ''.join(html_cells) + '</tr>')
    return html_rows
```

### 무조건 규칙
- 마크업 감지 후 병합 대상 셀(빈 칸)은 HTML에 절대 렌더링 금지.
- colspan/rowspan이 실제 테이블 구조와 맞지 않으면(총 셀 수 안 맞음) FAIL 리포트 출력 후 사용자에게 확인 요청.

---

## [이미지 참조 규칙]

### 이미지 폴더 — 무조건 16자리 해시 폴더 (promo-editor 표준)
- **이미지 폴더명은 반드시 16자리 랜덤 해시 (a-z, 0-9).** 임의 이름(`images/`, `assets/`, `img/` 등) 절대 금지.
- promo-editor의 `generateHashString(16)` 와 동일한 규칙: `[a-z0-9]{16}`
- 예: `./nd8a6avllqiz/hero.png`, `./draijpaz3l75/item_01.png`

### 수정 시 동일 해시 유지 (무조건)
- **기존 HTML 을 수정하는 경우 반드시 기존 해시 폴더명 그대로 유지.**
- promo-editor의 `detectExistingHash()` 함수가 기존 파일의 `./{hash}/` 경로에서 해시를 감지하여 재사용한다.
- 에이전트도 동일하게: 기존 HTML이 있으면 경로에서 해시 추출 → 새 해시 생성 금지 → 같은 폴더에 이미지 추가/교체.
- 새로 생성하는 경우에만 새 16자리 해시 생성.

### 해시 폴더 적용 알고리즘
```python
import re, random, string

def get_or_create_hash_folder(existing_html_path=None):
    # 1. 기존 HTML이 있으면 해시 감지
    if existing_html_path and os.path.exists(existing_html_path):
        with open(existing_html_path) as f:
            html = f.read()
        # ./hash/ 패턴 찾기 (16자리 a-z0-9)
        match = re.search(r'\./([a-z0-9]{16})/', html)
        if match:
            return match.group(1)  # 기존 해시 재사용

    # 2. 없으면 새 해시 생성
    chars = string.ascii_lowercase + string.digits
    return ''.join(random.choices(chars, k=12))
```

### 노션에 직접 업로드된 이미지 — 무조건 다운로드 + HTML 반영
- `block.image.file.url` 사용
- ⚠️ **1시간 후 URL 만료** → 파싱 즉시 다운로드 필수
- `block.image.type === "file"` vs `"external"` 구분
- **무조건 규칙**: 노션 CONTENT_SECTION 안의 모든 image 블록은 반드시 로컬 저장 경로(`{출력경로}/images/`)에 다운로드하여 HTML에 포함해야 한다.
- 파일명 규칙: `notion_{블록ID일부}.{확장자}` 또는 원본 확장자 유지. 중복 방지.
- 삽입 위치: 노션 기획서에서 해당 image 블록이 위치한 **정확한 순서**에 HTML `<img>` 태그 배치. 순서 바뀌면 FAIL.
- 이미지 누락(노션에는 있는데 HTML에 없음) 발견 시 즉시 FAIL.

### 이미지 크기 규칙 — 단일 규칙 (무조건 준수)
모든 이미지는 아래 한 가지 스타일만 사용. 브라우저가 알아서 처리:

```
max-width:100%; height:auto
```

### 동작
- **작은 이미지** (원본 ≤ 컨테이너): 브라우저가 원본 크기로 렌더링
- **큰 이미지** (원본 > 컨테이너): 브라우저가 컨테이너 폭에 맞춰 반응형 축소
- **비율**: 항상 유지 (`height:auto`가 보장)

### 금지
- **width·height 고정값 명시 금지** (예: `width:33px; height:29px`).
  - 이유 1: promo-editor 에디터는 사용자 마우스 리사이징으로 고정값을 부여한다. AI가 미리 고정값을 넣으면 충돌.
  - 이유 2: 극단적으로 좁은 컨테이너에서 이미지가 넘침.
- **고정값은 오직 사용자 수동 리사이징 시에만 허용**. AI 생성 단계에서는 절대 금지.

### 스타일 템플릿
- 블록 단독 이미지:
  ```html
  <div class="se-div" style="margin:0;padding:0;line-height:0;font-size:0;text-align:center;">
    <img src="./images/..." style="max-width:100%;height:auto;display:block;margin:0 auto;">
  </div>
  ```
- 인라인 이미지 (테이블 셀, 문단 내):
  ```html
  <img src="./images/..." style="display:inline-block;vertical-align:middle;max-width:100%;height:auto;">
  ```

### 본문 텍스트 내 이미지 참조
- 형식: `(파일명)` — 괄호 안에 파일명만
- 예: `(item_01)` → content 폴더의 `item_01.png` 또는 `item_01.jpg` 매칭
- 확장자 생략 가능 → 에이전트가 폴더 스캔하여 일치하는 파일 찾기

### 마커 중복 — 무조건 모두 반영 (FAIL 방지)
- **본문, 팝업(콜아웃), 테이블 셀, 어디든 동일한 `(파일명)` 마커가 N번 등장하면 N번 모두 `<img>` 태그로 반영해야 한다.**
- "이미 본문에 같은 이미지가 있으니까 팝업에서는 생략" 절대 금지.
- "동일 마커 = 한 번만 사용" 같은 자체 최적화 절대 금지.
- 노션 원본에서 마커가 등장하는 모든 위치(본문/팝업/테이블/리스트/콜아웃 children 재귀 포함)를 스캔하여 빠짐없이 매칭해야 한다.
- 자가 검증 단계에서 반드시 다음을 확인:
  ```
  ✅ 노션 원본 마커 출현 횟수 = HTML <img> 태그 출현 횟수
  ✅ 본문/팝업 데이터 블록 모두 검사
  ✅ 같은 파일명을 여러 위치에서 참조해도 모두 src 경로 동일하게 지정
  ```
- 누락 발견 시 즉시 재작업.

### 폴더 경로 규칙
- 이미지 폴더 경로는 `[기본 정보]` 테이블의 **"이미지 폴더 경로"** 항목에서 가져옴
- 표준 하위 폴더:
  - `asset/` — 히어로 캐릭터/오브젝트 이미지
  - `logo/` — 브랜드 로고
  - `content/` — 본문 컨텐츠 이미지 (item_01, img_1 등)

---

## [영상(video) 삽입 규칙]

노션 기획서에서 영상은 **`[영상]` 마커 + 바로 아래 URL** 조합으로 작성한다.

### 작성 형식
```
[영상]
https://cdn.example.com/promo_video.mp4

[영상|옵션1|옵션2]
https://cdn.example.com/tutorial.mp4
```

- **마커가 위, URL이 바로 아래 줄** (이미지 마커와 동일 패턴)
- 마커와 URL 사이에 다른 블록이 있으면 안 됨

### 기본값 (옵션 없이 `[영상]`만 쓴 경우)
`autoplay loop muted playsinline` — 소리 끔, 자동 반복 재생, 플레이바 숨김 (배경 영상형)

### 옵션 키워드

| 키워드 | 의미 | 기본 상태 |
|--------|------|-----------|
| `플레이바` | 재생바/볼륨 등 컨트롤 UI 표시 | OFF (숨김) |
| `소리` | 음소거 해제 | OFF (음소거) |
| `정지` | 자동재생 안 함 (사용자가 직접 재생) | OFF (자동재생) |
| `1회` | 반복 안 함 (1회 재생 후 정지) | OFF (무한 반복) |

### 조합 예시

| 마커 | 결과 |
|------|------|
| `[영상]` | 소리끔, 자동반복, 플레이바 숨김 |
| `[영상\|플레이바]` | 소리끔, 자동반복, 플레이바 표시 |
| `[영상\|플레이바\|소리]` | 소리있음, 자동반복, 플레이바 표시 |
| `[영상\|정지\|플레이바]` | 멈춤 상태, 플레이바 표시 (사용자 클릭 재생) |
| `[영상\|1회\|플레이바\|소리]` | 1회 재생, 소리있음, 플레이바 표시 |

### 사이즈 지정

| 마커 | 결과 |
|------|------|
| `[영상]` | 기본값: `width:100%` (컨테이너 폭에 맞춰 반응형) |
| `[영상\|50%]` | 컨테이너의 50% 폭 |
| `[영상\|300px]` | 고정 300px 폭 |
| `[영상\|플레이바\|60%]` | 플레이바 표시 + 60% 폭 |

- 숫자 + `%` 또는 `px` 패턴이 있으면 사이즈로 인식
- 사이즈 미지정 시 기본 `width:100%`
- 높이는 항상 자동 비율 (`height:auto`)

### HTML 변환 규칙

`[영상]` (기본 — 100% 폭):
```html
<video src="./hashfolder/video.mp4" autoplay loop muted playsinline style="width:100%;height:auto;display:block;"></video>
```

`[영상|50%]` (50% 폭):
```html
<video src="./hashfolder/video.mp4" autoplay loop muted playsinline style="width:50%;height:auto;display:block;"></video>
```

`[영상|300px]` (고정 300px):
```html
<video src="./hashfolder/video.mp4" autoplay loop muted playsinline style="width:300px;max-width:100%;height:auto;display:block;"></video>
```

`[영상|정지|플레이바|소리]`:
```html
<video src="./hashfolder/video.mp4" controls playsinline style="width:100%;height:auto;display:block;"></video>
```

### 파싱 로직
1. paragraph의 rich_text가 `[영상]` 또는 `[영상|...]` 패턴이면 영상 마커로 판별
2. 바로 다음 블록이 paragraph이고 텍스트가 URL(http로 시작, .mp4/.webm/.mov 확장자)이면 영상 URL로 인식
3. 파이프(`|`)로 분리된 옵션 키워드를 파싱하여 HTML 속성 결정:
   - `플레이바` 있으면 → `controls` 추가
   - `소리` 있으면 → `muted` 제거
   - `정지` 있으면 → `autoplay` 제거
   - `1회` 있으면 → `loop` 제거
   - `숫자+%` (예: `50%`) 있으면 → `width:50%`
   - `숫자+px` (예: `300px`) 있으면 → `width:300px;max-width:100%`
   - 사이즈 옵션 없으면 기본 `width:100%`
4. 영상 파일은 이미지와 동일하게 hashfolder에 다운로드하여 상대경로로 참조

---

## [마크업 참조]

| 마크업 | 변환 결과 |
|--------|-----------|
| `[[대버튼]] 텍스트` | 풀폭 큰 CTA 버튼 |
| `[[중버튼]] 텍스트` | 인라인 중간 버튼 |
| `[[소버튼]] 텍스트` | 작은 버튼 |
| `[툴팁N]` | 해당 콜아웃 팝업으로 링크 (`?` 아이콘) |
| `[팝업N]` | 해당 콜아웃 팝업으로 링크 (트리거 버튼) |
| `[영상]` 또는 `[영상\|옵션...]` | 영상 삽입 (옵션에 따라 속성 결정) |
| `(파일명)` | 이미지 자동 삽입 |
| `■ 제목` | 섹션 소제목 |
| `Tab01. 이름` | 탭 네비게이션 항목 |

---

## [누락 방지 자가 검증] 필수

### 작업 시작 전
```
1. 노션 페이지의 모든 블록을 type별로 집계하여 출력
2. callout 블록이 있으면 → 내용 확인 → 툴팁/팝업 여부 판단
3. 본문에서 [툴팁N] / [팝업N] 참조 횟수와 콜아웃 개수 일치 확인
4. 불일치 시 사용자에게 보고 후 대기
```

### 작업 완료 후
```
✅ callout 블록 전수 파싱 완료
✅ 본문의 [툴팁N]/[팝업N] 참조 모두 팝업 DOM과 연결
✅ 콜아웃 children의 중첩 블록 손실 없음
✅ 테이블 row 개수 = 최종 HTML tbody tr 개수
✅ 이미지 마커 개수 = 최종 HTML img 태그 개수
✅ 영상 마커 개수 = 최종 HTML video 태그 개수 (옵션 속성 일치 확인)
✅ 본문 paragraph 줄 수 = 최종 HTML p 태그 수
```

하나라도 불일치하면 누락이 발생한 것이므로 **즉시 재작업**.

---

## [Notion API 호출 패턴]

### 페이지의 모든 블록 가져오기 (페이지네이션)
```python
def get_all_children(block_id):
    results = []
    cursor = None
    while True:
        path = f"/blocks/{block_id}/children?page_size=100"
        if cursor:
            path += f"&start_cursor={cursor}"
        data = api_get(path)
        results.extend(data["results"])
        if not data.get("has_more"):
            break
        cursor = data["next_cursor"]
    return results
```

### 중첩 블록 재귀 파싱
```python
def parse_block(block):
    if block["has_children"]:
        children = get_all_children(block["id"])
        for child in children:
            parse_block(child)
```

---

## [기획서 작성 템플릿 예시]

```
# [기본 정보]
| 항목 | 값 |
| 프로모션명 | 메이드 카페 이벤트 |
| 게시물 작업 도구 | 프로모 에디터 |
| 이미지 폴더 경로 | /Users/.../promo_assets/ |

# [HERO_SECTION]
| 항목 | 값 |
| 타이틀 | 메이드 카페 이벤트 |
| 디자인 스타일 | 웹툰 스타일... |

[Asset]
📢 (이미지)

[Logo]
📢 (이미지)

# [CONTENT_SECTION]
■ 이벤트 기간
2025.12.24 ~ 2026.01.22

1. 크리스마스 씰 모으기
• 설명 1
• 설명 2[툴팁1]

[[대버튼]] 이벤트 자세히 보기

📢 [툴팁1]
  • 랭킹 등록 기준 1순위
  • 랭킹 등록 기준 2순위
```
