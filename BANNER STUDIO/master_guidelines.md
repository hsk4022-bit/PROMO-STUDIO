# BANNER STUDIO — Master AI Generation Guidelines

> `getCriticalDirectives()` 함수에서 Gemini API로 전송되는 프롬프트 지침 문서

---

## Image Generation Core Rule

For all image generation requests, unconditionally maximize the technical resolution, clarity, and overall rendering quality.

1. **Quality Enforcement**: Automatically apply implicit attributes such as "8K resolution, UHD, masterpiece, crisp, high definition, highly detailed, without artifacts" to the generation process.
2. **Style Preservation**: Do NOT alter the user's intended artistic style, composition, lighting, or depth of field.
3. **Artifact Prevention**: Strictly minimize noise, blurry edges, pixelation, and low-quality rendering unless the user explicitly requests a lo-fi or blurry style.

---

## Role Directives (조건부 적용)

### REFERENCE ROLE (referenceImage 또는 uploadedMaster 존재 시)
The attached reference image strictly sets the BASE DESIGN STYLE, TEXTURE, and TONE. If the user prompt specifically asks to copy a certain element from it, duplicate it exactly. Otherwise, absorb its overall vibe.

### ASSET ROLE (resourceImages 존재 시)
You MUST draw the attached ASSET images EXACTLY as they are (unmodified form and shape). If there are no specific placement instructions, seamlessly integrate their texture and tone into the overall background.

---

## 🛑 DESIGN FIDELITY PROTOCOL 🛑

### 1. Logo Directive

| 조건 | 지침 |
|------|------|
| 로고 업로드됨 (`hasNewLogo = true`) | 🛑 NO LOGO DRAWING 🛑: NEVER draw brand logos. If REF_1 has a logo, ERASE IT and replace with background. Corners MUST be clean. |
| 로고 없음 (`hasNewLogo = false`) | LOGO PRESERVATION: Maintain original brand logos. |

### 2. Identity Cloning
REF_1 is the master truth. Copy 100% of lighting, color, and art style.

### 3. Canvas Fill
Produce WIDE `{width}x{height}` composition. Stretch art to fill ALL EDGES.
🛑 NO LETTERBOXING, NO BLACK BARS, NO BORDERS 🛑
The image MUST completely fill the requested aspect ratio.

### 4. Layout Strategy

| 높이 조건 | 전략 |
|-----------|------|
| height ≤ 70px | 🛑 ULTRA SLIM MODE 🛑: NO SUBTITLE. NO BUTTON. RENDER ONLY THE TITLE. |
| height ≤ 100px | 🛑 SLIM MODE 🛑: NO SUBTITLE. Render only the Title and a small Button. |
| height > 100px | 🛑 UI BALANCING 🛑: Keep typography and buttons well-proportioned. |
| 버튼 텍스트 없음 | 🛑 NO BUTTON 🛑: NEVER draw any button shape or text for a button. Only draw the title and subtitle. |

### 5. Text Rigidity
Write EXACT Korean strings. Mimic font weight from REF_1.
🛑 NO LABELS 🛑: NEVER write the descriptive label words "타이틀", "서브타이틀", "버튼", "추가텍스트", or "배지" themselves. Only draw the actual content provided inside the quotes.

### 6. No Additions
❌ ZERO RE-INTERPRETATION ❌

---

## Typography Input Format

```
[타이틀] 눈꽃 나무 버프 패스
[서브타이틀] 지금 바로 눈꽃 나무 버프 패스 이벤트를 확인해 보세요
[버튼] 자세히 보기
[추가텍스트] 2026.04.01 ~ 04.30
[배지] HOT
```

| 태그 | 별칭 |
|------|------|
| `[타이틀]` | `[Title]`, `[Main Title]`, `타이틀:`, `Title:` |
| `[서브타이틀]` | `[Sub title]`, `[Subtitle]`, `서브타이틀:`, `Sub title:` |
| `[버튼]` | `[Button]`, `버튼:`, `Button:` |
| `[추가텍스트]` | `[Extra Text]`, `추가텍스트:`, `Extra Text:` |
| `[배지]` | `[Badge]`, `배지:`, `Badge:` |

---

## Master Banner Generation Prompt Structure

```
TASK: 1:1 MASTER BANNER (1024x1024).
TEXT TO RENDER:
- [TITLE]: "{parsedTitle}"
- [SUBTITLE]: "{parsedSubText}"      ← 있을 때만
- [BUTTON]: "{parsedBtnText}"        ← 있을 때만
- [EXTRA TEXT]: "{parsedExtraText}"  ← 있을 때만
- [BADGE]: "{parsedBadge}"           ← 있을 때만

[uploadedMaster 있을 때] Recreate EXACTLY but replace strings.
  SCENE GUIDE (Apply this adjustment): {backgroundPrompt}

[uploadedMaster 없을 때] SCENE: {backgroundPrompt || 'Art.'}

{getCriticalDirectives(...)}
```

---

## Variation Banner Generation Prompt Structure

```
TASK: PRODUCE BANNER {width}x{height} (1X NATIVE RESOLUTION).
REF_1 IS THE SOLE REFERENCE. MIRROR EVERY DETAIL. ASPECT: [{nativeRatioStr}].

[MANUAL OVERRIDE가 있을 때]
🚨 [MANUAL OVERRIDE]: "{customPrompts[pid]}"

TEXT TO RENDER:
- [TITLE]: "{titleText}"
...

{getCriticalDirectives(...)}
```

---

## Supported Aspect Ratios

| 비율 | 값 |
|------|----|
| 1:1 | 1.000 |
| 4:3 | 1.333 |
| 3:2 | 1.500 |
| 5:4 | 1.250 |
| 16:9 | 1.778 |
| 21:9 | 2.333 |
| 32:9 | 3.556 |
| 4:1 | 4.000 |
| 8:1 | 8.000 |
| 9:16 | 0.563 |
| 2:3 | 0.667 |
| 4:5 | 0.800 |
| 1:4 | 0.250 |
| 1:8 | 0.125 |

---

## API

- **Model**: `gemini-3.1-flash-image-preview`
- **Endpoint**: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}`
- **responseModalities**: `["TEXT", "IMAGE"]`
- **Retry delays**: `[1000, 2000, 4000, 8000, 16000]` ms
