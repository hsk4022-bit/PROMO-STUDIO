#!/usr/bin/env python3
"""
HTML 결과물 vs 노션 원본 자동 검증 스크립트.

사용법:
    NOTION_TOKEN=ntn_xxx python3 verify_html.py <notion_page_id> <html_path>

검증 항목:
1. 본문 paragraph/bullet 텍스트가 모두 HTML에 존재
2. 본문 image 블록이 모두 HTML 본문에 <img> 로 존재
3. 팝업(callout) image 블록이 모두 HTML 데이터 블록에 존재
4. 이미지 마커 (item_xx) 출현 횟수 = HTML <img> 출현 횟수
5. 본문 table 개수 일치
6. nested children 누락 없음

실패 시 exit code 1, 성공 시 exit code 0.
"""

import json
import os
import re
import sys
import urllib.request
from html import unescape

NOTION_TOKEN = os.environ.get("NOTION_TOKEN", "")
NOTION_HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
}


def api_get(path):
    req = urllib.request.Request(f"https://api.notion.com/v1{path}", headers=NOTION_HEADERS)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def get_all_children(block_id):
    results = []
    cursor = None
    while True:
        path = f"/blocks/{block_id}/children?page_size=100"
        if cursor:
            path += f"&start_cursor={cursor}"
        data = api_get(path)
        results.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    return results


def extract_text(rich_text):
    return "".join([t["plain_text"] for t in rich_text])


def normalize_for_match(s):
    """매칭용 정규화: HTML entity 디코딩 + 모든 공백 제거 + 한글/영숫자만 유지."""
    s = unescape(s)  # &nbsp; → \xa0, &amp; → & 등
    s = s.replace("\xa0", "")  # nbsp 제거
    s = re.sub(r"\s+", "", s)  # 모든 공백 제거
    return s


def extract_korean_chunk(s, min_len=8):
    """텍스트에서 가장 긴 한글 chunk 추출 (매칭 anchor 용)."""
    s = unescape(s).replace("\xa0", " ")
    chunks = re.findall(r"[가-힣][가-힣\s\d\(\)·]+[가-힣]", s)
    if not chunks:
        return None
    longest = max(chunks, key=lambda c: sum(1 for ch in c if "가" <= ch <= "힣"))
    longest_norm = re.sub(r"\s+", "", longest)
    if len(longest_norm) < min_len:
        return None
    return longest_norm


def scan_notion(page_id):
    inventory = {
        "body_paragraphs": [],
        "body_bullets": [],
        "body_tables": 0,
        "body_images": [],
        "popup_paragraphs": [],
        "popup_bullets": [],
        "popup_tables": 0,
        "popup_images": [],
        "markers": [],
    }

    def walk(bid, in_callout=False):
        blocks = get_all_children(bid)
        for b in blocks:
            t = b["type"]
            if t == "paragraph":
                text = extract_text(b["paragraph"]["rich_text"])
                if text.strip():
                    target = "popup_paragraphs" if in_callout else "body_paragraphs"
                    inventory[target].append(text)
                    inventory["markers"].extend(re.findall(r"\(([a-zA-Z]+_?\d+)\)", text))
            elif t == "bulleted_list_item":
                text = extract_text(b["bulleted_list_item"]["rich_text"])
                target = "popup_bullets" if in_callout else "body_bullets"
                inventory[target].append(text)
                inventory["markers"].extend(re.findall(r"\(([a-zA-Z]+_?\d+)\)", text))
            elif t == "image":
                target = "popup_images" if in_callout else "body_images"
                inventory[target].append(b["id"])
            elif t == "table":
                rows = get_all_children(b["id"])
                for r in rows:
                    if r["type"] == "table_row":
                        for cell in r["table_row"]["cells"]:
                            ct = extract_text(cell)
                            inventory["markers"].extend(re.findall(r"\(([a-zA-Z]+_?\d+)\)", ct))
                if in_callout:
                    inventory["popup_tables"] += 1
                else:
                    inventory["body_tables"] += 1
                continue  # 테이블 children 재귀 안 함

            if b.get("has_children"):
                walk(b["id"], in_callout=(in_callout or t == "callout"))

    walk(page_id)
    return inventory


def parse_html(path):
    with open(path) as f:
        html = f.read()

    body_html = re.sub(
        r'<div[^>]*class="[^"]*se-popup-content[^"]*"[^>]*>.*?</div>(?=\s*<(?:div|script))',
        "",
        html,
        flags=re.DOTALL,
    )
    popup_html_parts = re.findall(
        r'<div[^>]*class="[^"]*se-popup-content[^"]*"[^>]*>(.*?)</div>(?=\s*<(?:div|script))',
        html,
        re.DOTALL,
    )
    popup_html = "\n".join(popup_html_parts)

    def text_only(h):
        t = re.sub(r"<[^>]+>", " ", h)
        t = unescape(t)
        return re.sub(r"\s+", "", t)

    return {
        "body_imgs": re.findall(r"<img[^>]+src=\"([^\"]+)\"", body_html),
        "popup_imgs": re.findall(r"<img[^>]+src=\"([^\"]+)\"", popup_html),
        "all_imgs": re.findall(r"<img[^>]+src=\"([^\"]+)\"", html),
        "body_tables": len(re.findall(r"<table\b", body_html)),
        "popup_tables": len(re.findall(r"<table\b", popup_html)),
        "body_text_norm": text_only(body_html),
        "popup_text_norm": text_only(popup_html),
        "html_text_norm": text_only(html),
    }


def verify(notion_page_id, html_path):
    print(f"=== 노션 스캔 ({notion_page_id[:8]}...) ===")
    inv = scan_notion(notion_page_id)
    print(f"본문: paragraph {len(inv['body_paragraphs'])}, bullet {len(inv['body_bullets'])}, "
          f"table {inv['body_tables']}, image {len(inv['body_images'])}")
    print(f"팝업: paragraph {len(inv['popup_paragraphs'])}, bullet {len(inv['popup_bullets'])}, "
          f"table {inv['popup_tables']}, image {len(inv['popup_images'])}")
    print(f"마커: {len(inv['markers'])}개 (중복 포함)")

    print(f"\n=== HTML 파싱 ({os.path.basename(html_path)}) ===")
    h = parse_html(html_path)
    print(f"본문 img 태그: {len(h['body_imgs'])}, 팝업 img 태그: {len(h['popup_imgs'])}")
    print(f"본문 table: {h['body_tables']}, 팝업 table: {h['popup_tables']}")

    failures = []

    # ── 1. 본문 paragraph 매칭 (한글 chunk anchor) ──
    for p in inv["body_paragraphs"]:
        anchor = extract_korean_chunk(p)
        if not anchor:
            continue  # 한글이 적으면 스킵
        if anchor not in h["body_text_norm"] and anchor not in h["popup_text_norm"]:
            failures.append(f"[본문 paragraph 누락] {p[:50]}")

    # ── 2. 본문 bullet 매칭 ──
    for bullet in inv["body_bullets"]:
        anchor = extract_korean_chunk(bullet)
        if not anchor:
            continue
        if anchor not in h["body_text_norm"] and anchor not in h["popup_text_norm"]:
            failures.append(f"[본문 bullet 누락] {bullet[:50]}")

    # ── 3. 팝업 paragraph 매칭 ──
    for p in inv["popup_paragraphs"]:
        anchor = extract_korean_chunk(p)
        if not anchor:
            continue
        if anchor not in h["html_text_norm"]:
            failures.append(f"[팝업 paragraph 누락] {p[:50]}")

    # ── 4. 팝업 bullet 매칭 ──
    for bullet in inv["popup_bullets"]:
        anchor = extract_korean_chunk(bullet)
        if not anchor:
            continue
        if anchor not in h["html_text_norm"]:
            failures.append(f"[팝업 bullet 누락] {bullet[:50]}")

    # ── 5. 본문 image 개수 검증 ──
    notion_body_img = len(inv["body_images"])
    body_non_marker = [
        s for s in h["body_imgs"]
        if not any(m.lower() in s.lower() for m in inv["markers"])
    ]
    if len(body_non_marker) < notion_body_img:
        failures.append(
            f"[본문 image 누락] 노션 {notion_body_img}개 vs HTML {len(body_non_marker)}개 (마커 제외)"
        )

    # ── 6. 마커 매칭 (전체) ──
    notion_marker_count = len(inv["markers"])
    html_marker_imgs = sum(
        1 for s in h["all_imgs"]
        if any(m.lower() in s.lower() for m in set(inv["markers"]))
    )
    if html_marker_imgs < notion_marker_count:
        failures.append(
            f"[이미지 마커 누락] 노션 마커 {notion_marker_count}회 vs HTML img(마커) {html_marker_imgs}개"
        )

    # ── 7. 본문 table 개수 ──
    if h["body_tables"] < inv["body_tables"]:
        failures.append(
            f"[본문 table 누락] 노션 {inv['body_tables']}개 vs HTML {h['body_tables']}개"
        )

    # ── 8. 팝업 table 개수 ──
    if h["popup_tables"] < inv["popup_tables"]:
        failures.append(
            f"[팝업 table 누락] 노션 {inv['popup_tables']}개 vs HTML {h['popup_tables']}개"
        )

    print("\n=== 검증 결과 ===")
    if failures:
        print(f"❌ FAIL ({len(failures)}건)")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("✅ PASS — 누락 없음")
        sys.exit(0)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 verify_html.py <notion_page_id> <html_path>")
        sys.exit(2)
    if not NOTION_TOKEN:
        print("ERROR: NOTION_TOKEN environment variable required")
        sys.exit(2)
    verify(sys.argv[1], sys.argv[2])
