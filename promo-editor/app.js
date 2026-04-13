
        const getById = (id) => document.getElementById(id);
        const apiKey = ""; 
        const CONTENT_MODEL = "gemini-3-flash-preview"; 
        const IMAGE_MODEL = "gemini-3-pro-image-preview";
        
        function generateHashString(length) {
            const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
            let result = '';
            for (let i = 0; i < length; i++) {
                result += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return result;
        }

        function isImageFile(f) {
            return f.type.match(/^image\//i) || f.name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
        }

        function downscaleCanvas(sourceCanvas, targetWidth) {
            if (sourceCanvas.width <= targetWidth + 1) { 
                return sourceCanvas; 
            }
            
            let current = sourceCanvas;
            let targetHeight = Math.round(sourceCanvas.height * (targetWidth / sourceCanvas.width));
            
            while (current.width / 2 >= targetWidth) {
                let temp = document.createElement('canvas');
                temp.width = current.width / 2;
                temp.height = current.height / 2;
                let ctx = temp.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(current, 0, 0, temp.width, temp.height);
                current = temp;
            }
            
            let finalCanvas = document.createElement('canvas');
            finalCanvas.width = targetWidth;
            finalCanvas.height = targetHeight;
            let ctx = finalCanvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(current, 0, 0, finalCanvas.width, finalCanvas.height);
            
            return finalCanvas;
        }

        let activeLayer = null;
        let lastActiveCell = null;
        let currentHashFolder = ''; // HTML저장/슬라이서 공통 해시폴더
        const videoObjectUrlMap = new Map(); // blob URL → data:video base64 (재생용 blob URL ↔ 내보내기용 data URL 매핑)
        let logoBase64 = null;      // 로고 이미지 base64
        let logoPos = 'right';      // 로고 위치 (left/right)
        let logoSize = 14;          // 로고 크기 (% of hero width)
        // 팝업 트리거 버튼 공통 스타일 — 모든 팝업 버튼은 이 스타일 사용
        const POPUP_BTN_STYLE = 'display:inline-flex;align-items:center;justify-content:center;width:1.375rem;height:1.375rem;border-radius:50%;background-color:var(--popup-btn-color,#7c3aed);color:#ffffff;font-size:0.75rem;font-weight:900;border:none;cursor:pointer;vertical-align:middle;margin:0 0.25rem;line-height:1;';
        function getPopupBtnStyle() {
            const ac = getById('accentPicker')?.value;
            // accent가 없거나 기본값이면 DOM에서 가장 자주 쓰인 포인트 색 추출 시도
            let color = (ac && ac !== '#888888') ? ac : null;
            if (!color) {
                const area = getById('contentArea');
                if (area) {
                    const freq = {};
                    area.querySelectorAll('[style*="color"]').forEach(el => {
                        const m = el.getAttribute('style').match(/(?<![a-z-])color\s*:\s*(#[0-9a-fA-F]{6})/g);
                        if (m) m.forEach(match => {
                            const hex = match.replace(/.*:\s*/, '').toLowerCase();
                            if (hex !== '#ffffff' && hex !== '#000000' && hex !== '#1e293b' && hex !== '#2d2d2d') {
                                freq[hex] = (freq[hex] || 0) + 1;
                            }
                        });
                    });
                    const top = Object.entries(freq).sort((a,b) => b[1]-a[1])[0];
                    if (top) color = top[0];
                }
            }
            if (!color) color = getById('bgPicker')?.dataset?.accent || '#888888';
            return `display:inline-flex;align-items:center;justify-content:center;width:1.375rem;height:1.375rem;border-radius:50%;background-color:${color};color:#ffffff;font-size:0.75rem;font-weight:900;border:none;cursor:pointer;vertical-align:middle;margin:0 0.25rem;line-height:1;`;
        }
        // 에디터 DOM 안 popup-trigger 버튼의 style attribute를 hex로 강제 재설정
        // 브라우저 contenteditable이 hex → rgb() 변환하므로 setAttribute로 덮어씀
        function fixPopupTriggerStyles() {
            const style = getPopupBtnStyle();
            document.querySelectorAll('#contentArea .popup-trigger[data-popup]').forEach(el => {
                const extra = el.tagName === 'A' ? 'text-decoration:none;' : '';
                el.setAttribute('style', style + extra);
            });
        }

        // 섹션 카드의 border-radius가 편집 중 손상되지 않도록 overflow:hidden 보장
        function protectSectionCards() {
            document.querySelectorAll('#contentArea .se-div').forEach(div => {
                const style = div.getAttribute('style') || '';
                // border-radius가 있는 카드형 se-div에 overflow:hidden 보장
                if (style.includes('border-radius') && !style.includes('overflow')) {
                    div.style.overflow = 'hidden';
                }
            });
        }

        // 섹션 상단 accent bar가 contenteditable에서 확장되지 않도록 보호
        function protectAccentBars() {
            document.querySelectorAll('#contentArea .se-div').forEach(div => {
                const h = div.style.height;
                const bg = div.style.backgroundColor;
                // height가 매우 작고(0.1875rem/3px 이하) 배경색이 있는 accent bar 감지
                if (bg && h && (h === '0.1875rem' || h === '3px' || h === '0.125rem' || h === '2px')) {
                    div.style.maxHeight = h;
                    div.style.overflow = 'hidden';
                    div.style.fontSize = '0';
                    div.style.lineHeight = '0';
                    // 편집 시 내용 삽입으로 높이 변경 방지
                    div.innerHTML = '';
                }
            });
        }

        let uploadedAssets = [];
        let contentAssetLibrary = {};
        let referenceImageBase64 = null;
        let masterGuidelineText = "";

        let isSelecting = false;
        let selectionStartCell = null;
        let selectedCells = [];

        let historyStack = [];
        let historyIdx = -1;
        
        let savedRange = null;
        let typingTimer = null;

        // ── 공통 유틸리티 ──────────────────────────────────────────────────
        function getLuminance(hex) {
            const r = parseInt(hex.slice(1,3),16)||0;
            const g = parseInt(hex.slice(3,5),16)||0;
            const b = parseInt(hex.slice(5,7),16)||0;
            return (r*299 + g*587 + b*114) / 1000;
        }
        function isDarkColor(hex) { return getLuminance(hex) < 128; }

        // rgba() 없이 배경색 + 오버레이를 alpha 블렌딩해 6자리 hex 반환
        function blendHex(bgHex, overlayHex, alpha) {
            const clamp = v => Math.min(255, Math.max(0, Math.round(v)));
            const br=parseInt(bgHex.slice(1,3),16), bg_=parseInt(bgHex.slice(3,5),16), bb=parseInt(bgHex.slice(5,7),16);
            const or=parseInt(overlayHex.slice(1,3),16), og=parseInt(overlayHex.slice(3,5),16), ob=parseInt(overlayHex.slice(5,7),16);
            return '#' + [br*(1-alpha)+or*alpha, bg_*(1-alpha)+og*alpha, bb*(1-alpha)+ob*alpha]
                .map(v => clamp(v).toString(16).padStart(2,'0')).join('');
        }

        // base64 데이터URI에서 mimeType 추출
        function getMimeType(base64) {
            return base64.split(';')[0].split(':')[1] || 'image/png';
        }

        // 모든 편집 툴 패널 숨기기
        function hideAllTools() {
            getById('tableTools').style.display = 'none';
            getById('imgTools').style.display = 'none';
            getById('divTools').style.display = 'none';
            const btn = getById('addLineBtn');
            if (btn) btn.style.display = 'none';
        }

        // addLineBtn을 activeLayer 바로 아래에 위치시키기
        function positionAddLineBtn() {
            const btn = getById('addLineBtn');
            if (!btn || !activeLayer) return;
            const sheet = getById('documentSheet');
            if (!sheet) return;
            const sheetRect = sheet.getBoundingClientRect();
            const layerRect = activeLayer.getBoundingClientRect();
            // accent 색상 기반 배경 + 명도 기반 자동 텍스트 색상
            const ac = getById('accentPicker')?.value || '#7c3aed';
            const tc = getLuminance(ac) < 128 ? '#ffffff' : '#1e293b';
            btn.style.backgroundColor = ac;
            btn.style.color = tc;
            btn.style.top = (layerRect.bottom - sheetRect.top) + 'px';
            btn.style.bottom = 'auto';
            btn.style.display = 'block';
        }

        // activeLayer 선택 해제 + 툴 숨기기
        function clearActiveLayer() {
            if (activeLayer) { activeLayer.classList.remove('active-layer'); activeLayer = null; }
            document.querySelectorAll('.img-selected').forEach(el => el.classList.remove('img-selected'));
            hideAllTools();
            hideImgFloatToolbar();
            hideTableFloatToolbar();
        }

        // 테이블 셀 복제 (빈 셀)
        function cloneEmptyCell(source) {
            const nc = document.createElement(source.tagName);
            nc.style.cssText = source.style.cssText;
            nc.className = source.className.replace('selected-cell','').trim();
            nc.setAttribute('contenteditable','true');
            nc.innerHTML = '&nbsp;';
            return nc;
        }

        // resizer 핸들 4개 생성
        function addResizerHandles(wrap) {
            ['nw','ne','sw','se'].forEach(pos => {
                const h = document.createElement('div');
                h.className = `resizer-handle resizer-${pos}`;
                h.dataset.pos = pos;
                wrap.appendChild(h);
            });
        }

        // 이미지 클립보드 복사 (copy/cut 공통)
        function cloneToClipboard() {
            const clone = activeLayer.cloneNode(true);
            clone.classList.remove('active-layer');
            clone.querySelectorAll('.resizer-handle').forEach(h => h.remove());
            imgClipboard = { outerHTML: clone.outerHTML, styleWidth: activeLayer.style.width };
            refreshPasteBtn();
        }

        // HTML 파일 로드 공통 처리 (drag-drop / file-input 통합)
        function loadHtmlFile(htmlFile, imgMap) {
            imgMap = imgMap || {};
            const reader = new FileReader();
            reader.onload = (ev) => {
                recordState();
                // BOM(U+FEFF) 제거 + 인코딩 보정
                let rawHtml = ev.target.result || '';
                if (rawHtml.charCodeAt(0) === 0xFEFF) rawHtml = rawHtml.slice(1);
                const parser = new DOMParser();
                const doc = parser.parseFromString(rawHtml, 'text/html');
                const seContents = doc.querySelector('.se-contents');

                let htmlStr = '';
                let heroRawSrc = '';

                if (seContents) {
                    const heroSeDiv = seContents.querySelector('.se-div:first-child');
                    const heroImgNode = heroSeDiv ? heroSeDiv.querySelector('img') : null;
                    if (heroImgNode) {
                        heroRawSrc = heroImgNode.getAttribute('src') || '';
                        // 전체 제거 대신 display:none으로 숨김 (내보내기 시 위치 참조용으로 유지)
                        heroSeDiv.style.display = 'none';
                        heroSeDiv.innerHTML = '';
                    }
                    htmlStr = seContents.outerHTML;
                } else {
                    const loadedArea = doc.querySelector('.se-div:last-child') || doc.body;
                    htmlStr = loadedArea.innerHTML;
                }

                // HTML 문자열 단계에서 이미지 src 교체 (DOM 파싱 전에 처리)
                if (Object.keys(imgMap).length > 0) {
                    Object.entries(imgMap).forEach(([fname, b64]) => {
                        const escaped = fname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        htmlStr = htmlStr.replace(
                            new RegExp('src="[^"]*' + escaped + '"', 'gi'),
                            `src="${b64}"`
                        );
                    });
                }

                getById('contentArea').innerHTML = htmlStr;
                // se-popup-content 블록을 DOM에서 제거 (이중 렌더링 방지 — 팝업 복원은 doc에서 처리)
                getById('contentArea').querySelectorAll('.se-popup-content').forEach(el => el.remove());
                // 에디터 로드 시 popup-trigger의 onclick/href 제거
                getById('contentArea').querySelectorAll('[data-popup][onclick]').forEach(el => el.removeAttribute('onclick'));
                getById('contentArea').querySelectorAll('a.popup-trigger[data-popup]').forEach(a => {
                    if (a.getAttribute('href')?.startsWith('javascript:')) a.setAttribute('href', 'javascript:void(0)');
                });
                // popup-trigger 스타일을 hex로 강제 재설정 (브라우저 rgb() 변환 방지)
                fixPopupTriggerStyles(); protectAccentBars(); protectSectionCards();

                // 히어로 이미지 처리
                if (heroRawSrc) {
                    const heroFname = heroRawSrc.split('/').pop().split('\\').pop();
                    applyHeroImage(imgMap[heroFname] || heroRawSrc, false, null, true); // skipColorExtract=true: 불러오기 시 배경색 자동 추출 비활성화
                }

                // se-contents → 첫 번째 se-div → body 순으로 배경색 감지
                const _bgEl = doc.querySelector('.se-contents[style*="background-color"]')
                           || doc.querySelector('.se-div[style*="background-color"]')
                           || doc.querySelector('div[style*="background-color"]');
                const loadedBg = _bgEl?.style.backgroundColor || doc.body.style.backgroundColor;
                // noColorAdjust=true: 불러온 HTML의 텍스트 색상을 그대로 유지 (자동 교체 비활성화)
                if (loadedBg) changeBg(loadedBg, true);

                // 로드된 HTML의 해시 폴더명 감지 (img src에서)
                // 지원 형식: hashFolder/file.jpg  또는  ./hashFolder/file.jpg
                const allImgs = doc.querySelectorAll('img[src]');
                for (const img of allImgs) {
                    const src = img.getAttribute('src') || '';
                    if (src.startsWith('data:') || src.startsWith('http') || src.startsWith('blob:')) continue;
                    const parts = src.split('/');
                    // ./hashFolder/file → parts[0]='.' parts[1]='hashFolder'
                    // hashFolder/file   → parts[0]='hashFolder'
                    const candidate = (parts[0] === '.' || parts[0] === '') ? parts[1] : parts[0];
                    if (candidate && candidate.length >= 8 && /^[a-z0-9]+$/i.test(candidate)) {
                        currentHashFolder = candidate;
                        break;
                    }
                }

                // 팝업 복원: class 제거 환경 대비 — data-popup 속성 기반으로 감지
                const restoredIds = new Set();
                // 1차: 팝업 내용 블록
                // - 새 포맷: <script type="application/json" data-popup="...">JSON</script>
                // - 구 포맷: <div data-popup="..." style="display:none;">HTML</div>
                doc.querySelectorAll('[data-popup]').forEach(block => {
                    const id = block.getAttribute('data-popup');
                    if (!id || restoredIds.has(id)) return;
                    let content = null;
                    if (block.tagName === 'SCRIPT') {
                        // 새 포맷: JSON 디코딩
                        try { content = JSON.parse(block.textContent.trim()); } catch(e) { content = block.textContent.trim(); }
                    } else if (block.tagName === 'DIV') {
                        // 구 포맷: display:none div
                        const st = block.getAttribute('style') || '';
                        if (!st.includes('display:none') && !st.includes('display: none')) return;
                        content = block.innerHTML;
                    } else {
                        return; // button 등은 2차에서 처리
                    }
                    restoredIds.add(id);
                    const m = id.match(/\d+$/);
                    if (m && parseInt(m[0]) >= nextPopupId) nextPopupId = parseInt(m[0]) + 1;
                    addChildPanel(id, content);
                });
                // 2차 fallback: button[data-popup] — class 무관하게 감지
                doc.querySelectorAll('button[data-popup]').forEach(btn => {
                    const id = btn.getAttribute('data-popup');
                    if (!id || restoredIds.has(id)) return;
                    restoredIds.add(id);
                    const m = id.match(/\d+$/);
                    if (m && parseInt(m[0]) >= nextPopupId) nextPopupId = parseInt(m[0]) + 1;
                    addChildPanel(id, null);
                });

                // 이미지 재매칭 — 에셋 라이브러리에 파일이 있으면 자동으로 마커 교체
                if (Object.keys(contentAssetLibrary).length > 0) {
                    setTimeout(() => runImageMatching(true), 200);
                }

                // th → td 강제 변환 (로드된 HTML에도 적용)
                if (typeof fixTableThs === 'function') fixTableThs(getById('contentArea'));
                // 스마트 업데이트용 섹션 ID 태깅
                tagSectionsWithId(getById('contentArea'));

                // 로드된 HTML에서 accent 감지 → accentPicker 동기화
                setTimeout(function() {
                    const _loadArea = getById('contentArea');
                    if (!_loadArea) return;
                    const _freq = {};
                    _loadArea.querySelectorAll('[style]').forEach(el => {
                        const _m = el.getAttribute('style').match(/#[0-9a-fA-F]{6}/g);
                        if (_m) _m.forEach(c => { _freq[c.toLowerCase()] = (_freq[c.toLowerCase()] || 0) + 1; });
                    });
                    const _bg = (getById('bgPicker').value || '').toLowerCase();
                    const _isNeutral = c => { const r=parseInt(c.slice(1,3),16),g=parseInt(c.slice(3,5),16),b=parseInt(c.slice(5,7),16); return (Math.max(r,g,b)-Math.min(r,g,b))<30||Math.max(r,g,b)>230||(r<25&&g<25&&b<25); };
                    const _colorDist = (a,b2) => { const ar=parseInt(a.slice(1,3),16),ag=parseInt(a.slice(3,5),16),ab=parseInt(a.slice(5,7),16),br=parseInt(b2.slice(1,3),16),bg_=parseInt(b2.slice(3,5),16),bb=parseInt(b2.slice(5,7),16); return Math.abs(ar-br)+Math.abs(ag-bg_)+Math.abs(ab-bb); };
                    const _det = Object.entries(_freq)
                        .filter(([c]) => c !== _bg && _colorDist(c, _bg) > 60 && !_isNeutral(c))
                        .sort((a,b2) => b2[1]-a[1])[0];
                    if (_det) {
                        const _p = getById('accentPicker');
                        if (_p) { _p.value = _det[0]; _p.style.opacity = '1'; }
                        const _s = getById('accentSlash');
                        if (_s) _s.style.display = 'none';
                        getById('bgPicker').dataset.accent = _det[0];
                        getById('bgPicker').dataset.prevAccent = _det[0];
                        // accentPicker 값 확정 후 popup-trigger 전체 스타일 재적용
                        fixPopupTriggerStyles();
                    }
                }, 300);

                recordState();
                showToast('HTML 로드 완료!' + (restoredIds.size > 0 ? ` (팝업 ${restoredIds.size}개 복원됨)` : ''));
            };
            reader.readAsText(htmlFile, 'UTF-8');
        }

        // canvas 캡처 전 sheet 준비 (Slicer/JPG 공통)
        async function prepareSheetForCapture() {
            const sheet = getById('documentSheet');

            // 캡처 전 모든 선택/활성 상태 완전 초기화
            clearSelection();
            clearActiveLayer();
            if (activeLayer) { activeLayer.classList.remove('active-layer'); activeLayer = null; }
            hideAllTools();
            hideImgFloatToolbar();

            const mw = parseInt(getById('pageWidthInput').value) || 840;
            const originalWidth = sheet.style.width, originalMaxWidth = sheet.style.maxWidth;
            const scrollArea = getById('canvasScroll');
            const originalOverflow = scrollArea.style.overflow, originalScrollTop = scrollArea.scrollTop;

            sheet.style.width = mw + 'px'; sheet.style.maxWidth = mw + 'px';
            scrollArea.style.overflow = 'visible'; scrollArea.scrollTop = 0; window.scrollTo(0, 0);

            await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2000))]);
            // 원본 DOM에서 상대경로 이미지 → base64 (compositeHeroWithLogo 등 원본 참조용)
            await convertImagesToBase64(sheet);
            await new Promise(r => setTimeout(r, 100));

            // ── 렌더링용 오프스크린 클론 생성 ──
            // htmlToImage는 computed style을 그대로 복사하므로, 클론 자체에 position:fixed + 음수 left를
            // 설정하면 foreignObject 안에서도 콘텐츠가 화면 밖으로 밀려나 빈 캔버스가 된다.
            // 해결: 클론 자체에는 위치 지정 없이, 오프스크린 wrapper container만 화면 밖으로 이동.
            const _clipWrap = document.createElement('div');
            _clipWrap.style.cssText = `position:fixed;top:0;left:-${mw + 300}px;width:${mw}px;overflow:hidden;pointer-events:none;z-index:-9999;`;
            document.body.appendChild(_clipWrap);

            const renderClone = sheet.cloneNode(true);
            renderClone.removeAttribute('id');
            renderClone.style.width = mw + 'px';
            renderClone.style.maxWidth = mw + 'px';
            _clipWrap.appendChild(renderClone);

            // 테이블 border 강화 — htmlToImage foreignObject 렌더링에서 1px border 손실 방지
            // 클론은 #contentArea 밖이므로 CSS 셀렉터(#contentArea td) 미적용 → 인라인으로 모든 border 강제
            renderClone.querySelectorAll('table').forEach(tbl => {
                tbl.style.borderCollapse = 'collapse';
                tbl.style.width = '100%';
                tbl.style.tableLayout = 'fixed';
                tbl.querySelectorAll('td, th').forEach(cell => {
                    // 인라인 border가 없거나 1px이면 1.5px로 강화
                    const inlineBorder = cell.style.border || cell.style.borderWidth || '';
                    if (!inlineBorder || inlineBorder.includes('1px') || inlineBorder === '0') {
                        cell.style.border = '1.5px solid #d9d9d9';
                    }
                    // padding도 보장
                    if (!cell.style.padding) cell.style.padding = '0.875rem 1rem';
                    cell.style.boxSizing = 'border-box';
                });
                // thead 하단 구분선 강화
                const ac = getById('accentPicker')?.value;
                const headBorderColor = (ac && ac !== '#888888') ? ac : '#8b7355';
                tbl.querySelectorAll('thead th, thead td').forEach(cell => {
                    cell.style.borderBottom = '1px solid ' + headBorderColor;
                    cell.style.fontWeight = '700';
                    cell.style.textAlign = 'center';
                });
            });

            // Chrome 실질 canvas 높이 한계는 16384px. 초과 시 내부적으로 클리핑되어
            // 하단 콘텐츠가 잘리는 버그 발생. 16000 여유로 설정 — 대부분 페이지에서
            // pixelRatio 2~3 보장, 매우 긴 페이지도 콘텐츠 손실 없이 캡처.
            const MAX_CANVAS_PX = 16000;
            let targetScale = 3;
            if (sheet.scrollHeight * targetScale > MAX_CANVAS_PX) {
                targetScale = Math.max(MAX_CANVAS_PX / sheet.scrollHeight, 1.5);
            }

            return {
                sheet: renderClone,     // htmlToImage 호출 시 이 클론 사용
                originalSheet: sheet,   // getBoundingClientRect 위치 계산 전용
                mw, targetScale,
                bgColor: getById('bgPicker').value || '#ffffff',
                restore() {
                    // 원본 크기·스크롤 복원 + 오프스크린 wrapper 제거
                    sheet.style.width = originalWidth; sheet.style.maxWidth = originalMaxWidth;
                    scrollArea.style.overflow = originalOverflow; scrollArea.scrollTop = originalScrollTop;
                    if (_clipWrap.isConnected) _clipWrap.remove();
                }
            };
        }
        // ───────────────────────────────────────────────────────────────────

        document.addEventListener('selectionchange', () => {
            const sel = window.getSelection();
            if (sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                const area = getById('contentArea');
                // contentArea 또는 childArea_* 팝업 패널 내부 선택 모두 처리
                const inMain = area && area.contains(range.commonAncestorContainer);
                const inChild = !inMain && !!range.commonAncestorContainer.closest?.('[id^="childArea_"]');
                if (inMain || inChild) {
                    savedRange = range.cloneRange(); // live range 대신 clone 저장 (prompt 등 포커스 이탈 대비)
                    // 선택된 텍스트의 color를 TXT 피커에 반영
                    const anchor = range.startContainer;
                    const el = anchor.nodeType === 3 ? anchor.parentElement : anchor;
                    const rootArea = inChild ? anchor.closest?.('[id^="childArea_"]') : area;
                    if (el && el !== rootArea) {
                        const computed = window.getComputedStyle(el);
                        const col = computed.color;
                        if (col) {
                            const m = col.match(/\d+/g);
                            if (m && m.length >= 3) {
                                const hex = '#' + m.slice(0,3).map(n => parseInt(n).toString(16).padStart(2,'0')).join('');
                                const picker = getById('textColorPicker');
                                if (picker) picker.value = hex;
                            }
                        }
                    }
                }
            }
        });


        // master_guidelines.md 내용 인라인 (file:// 환경 CORS 오류 방지)
        const MASTER_GUIDELINES_INLINE = "[System Prompt: High-End HTML Render Engine v4.0]\n\n# Role\n너는 세계 최고 수준의 게임 프로모션 디자이너다. 단순·밀도없는 레이아웃은 FAIL.\n\n---\n\n# [제0원칙 — 원고 텍스트 절대 우선]\n- 원고의 모든 문장·단어·숫자·특수문자를 단 한 글자도 바꾸지 말고 그대로 출력.\n- 요약·압축·윤문·재해석 절대 금지. 원고에 10줄이면 HTML에도 10줄.\n- 없는 내용(버튼·메뉴·푸터·저작권·임의설명·영문 부제목·슬로건) 절대 추가 금지.\n- AI가 임의로 만든 영문 텍스트(\"Legend of Darkness\", \"28th Anniversary\" 등) 삽입 즉시 FAIL.\n- placeholder 절대 금지. 마지막 문장 누락 여부 반드시 확인.\n\n---\n\n# [절대 금지]\n- <!DOCTYPE> <html> <head> <body> <style> 태그 생성 금지. (예외: 팝업 기능 있을 때만 <script> 허용)\n- class 없는 <div> 절대 금지. 모든 div는 반드시 class=\"se-div\" 또는 class=\"se-para-div\" 필수.\n- 모든 스타일은 인라인 style=\"\" 만 사용.\n- display:flex · display:grid · gap 금지.\n- ul / ol / li 금지. 목록은 <p> 또는 <br> 사용.\n- box-shadow 금지. background 단축 금지 → background-color 사용.\n- rgba() 절대 금지. 색상은 반드시 6자리 hex(#rrggbb)만 사용.\n- #fff #000 등 3자리 색상 금지 → #ffffff #000000.\n- !important 금지.\n- max-width에 px 단위 금지 → rem 사용.\n- 마크다운 볼드(**텍스트**) 금지 → <p style=\"font-weight:900;\"> 사용.\n- 외부 URL <img> 절대 금지.\n- 이미지 마커 (item1) (item2) 등이 원고에 명시되지 않으면 <img> 태그 생성 절대 금지.\n- AI가 임의로 이미지 플레이스홀더 생성 금지. 원고에 없는 이미지 삽입 즉시 FAIL.\n\n---\n\n# [HTML 구조 — 절대 준수]\n\n<div class=\"se-contents\" style=\"font-size:clamp(0.875rem,1.702vw,1rem);font-family:'Pretendard',sans-serif;line-height:1.8;max-width:52.5rem;width:100%;margin:0 auto;background-color:transparent;display:block;word-break:keep-all;overflow-wrap:break-word;color:${textColor};letter-spacing:-0.05rem;\">\n\n  <!-- 1번 블록: 히어로 이미지 (이미지 있을 때만 생성) -->\n  <div class=\"se-div\" style=\"margin:0;padding:0;line-height:0;font-size:0;display:block;width:100%;\"></div>\n\n  <!-- 2번 블록: 컨텐츠 전체 래퍼 -->\n  <div class=\"se-div\" style=\"background-color:${bgColor};margin:0;padding:0;display:block;width:100%;box-sizing:border-box;\">\n    <!-- 섹션 se-div들이 형제로 수직 적층. 각 섹션에 좌우 패딩: padding-left:clamp(16px,3.472vw,50px);padding-right:clamp(16px,3.472vw,50px) 적용 -->\n  </div>\n\n</div>\n\n규칙:\n- se-contents 배경은 transparent. 배경색은 2번 블록에만 적용.\n- 1번(이미지)·2번(컨텐츠) 블록만 se-contents 직계 자식으로 존재. 추가 감싸기 금지.\n- 배경색 ${bgColor}는 지정된 값 그대로. 임의 변경 금지.\n\n---\n\n# [컬러 시스템]\n- 60:30:10 법칙: 배경(60%) ${bgColor} / 서피스(30%) ${surfaceColor} / 포인트(10%) ${accentColor}.\n- 카드·컨테이너 구분: 배경색 명도 3~5% 조절한 hex 또는 1px border만 사용.\n- 포인트색 ${accentColor}: 번호아이콘·CTA버튼·핵심키워드에만 한정.\n- 모든 텍스트 요소(p span td th h1~h6 등)에 color 속성 반드시 명시.\n- ${textColor} 기본 텍스트 / ${subColor} 서브 / ${accentColor} 강조 / ${surfaceColor} 카드배경 / ${borderColor} 테두리.\n\n---\n\n# [타이포그래피]\n- 섹션 제목: font-size:clamp(1.25rem,2.5vw,1.375rem); font-weight:900; color:${accentColor}\n- 소제목: font-size:0.8125rem; font-weight:700; text-transform:uppercase; color:${subColor}\n- 본문: font-size:clamp(0.875rem,1.5vw,1rem); font-weight:400; line-height:1.8; color:${textColor}\n- 모든 <p> 태그: margin:0; line-height:1.8;\n- 수치/날짜 강조: font-size:clamp(1.5rem,3vw,2rem); font-weight:900; color:${accentColor}\n- 카드 상단 바: height:0.1875rem; background-color:${accentColor}; border-radius:0.1875rem 0.1875rem 0 0\n\n---\n\n# [간격 처리 규칙 — 단일 기준]\n- 요소 사이 간격: 반드시 <p style=\"height:Npx;margin:0;\"></p> 태그로만 처리.\n  - 작은 간격: height:8px / 중간: height:16px / 큰 간격: height:24px\n- margin 사용 금지. <br> 단독 사용 금지. <p>&nbsp;</p> 금지.\n- 모든 <p> 태그: margin:0; line-height:1.8;\n\n---\n\n# [섹션 구조 — 모든 섹션 동일]\n\n<div class=\"se-div\" style=\"background-color:${surfaceColor};border:1px solid ${borderColor};border-radius:0.875rem;padding:1.75rem clamp(16px,3.472vw,50px);\">\n  <!-- 모든 섹션 좌우 패딩: clamp(16px,3.472vw,50px) — PC 50px, 모바일 16px -->\n  <!-- 섹션 타이틀 -->\n  <div class=\"se-div\" style=\"margin-bottom:1rem;\">\n    <span style=\"display:inline-block;width:1.75rem;height:1.75rem;background-color:${accentColor};border-radius:50%;text-align:center;line-height:1.75rem;font-weight:900;color:#000000;font-size:0.875rem;margin-right:0.625rem;vertical-align:middle;\">N</span>\n    <span style=\"font-size:clamp(1.25rem,2.5vw,1.375rem);font-weight:700;color:${textColor};vertical-align:middle;\">섹션제목</span>\n  </div>\n  <!-- 섹션 내용 -->\n  <div class=\"se-div\" style=\"padding:0.75rem 0;border-top:1px solid ${borderColor};\">\n    <p style=\"color:${textColor};margin:0;line-height:1.8;\">내용</p>\n  </div>\n</div>\n<p style=\"height:24px;margin:0;\"></p>\n\n규칙:\n- **모든 내부 div에 class=\"se-div\" 필수.** class 없는 div 절대 금지.\n- 섹션 사이 간격: <p style=\"height:24px;margin:0;\"></p> 로만 처리.\n- 테이블은 섹션 se-div 안에 직접 배치. **추가 래퍼 div 금지.**\n- 이 구조를 섹션마다 다르게 바꾸면 FAIL.\n\n---\n\n# [이미지 규칙]\n- <img> 필수 style: max-width:100%;height:auto;display:block;margin:0 auto;\n- width · height 고정값 금지. object-fit · object-position 금지.\n- img를 div·span으로 감싸지 말 것. 단독 사용.\n- position:absolute/fixed/relative · float · z-index 금지.\n- 이미지 블록 se-div: style=\"margin:0;padding:0;display:block;line-height:0;font-size:0;\"\n\n---\n\n# [테이블 규칙]\n- 표 데이터는 반드시 <table>. div 대체 절대 금지.\n- 테이블은 섹션 se-div 안에 직접 배치. **별도 래퍼 div 추가 금지.**\n- table: style=\"width:100%;border-collapse:collapse;table-layout:fixed;margin:0;\"\n- th: style=\"padding:0.875rem 1rem;border:1px solid ${borderColor};border-bottom:1px solid ${accentColor};font-weight:700;color:${accentColor};text-align:center;background-color:${surfaceColor};word-break:keep-all;overflow-wrap:break-word;vertical-align:middle;line-height:1.4;box-sizing:border-box;min-width:2.5rem;font-size:inherit;\"\n- td: style=\"padding:0.875rem 1rem;border:1px solid ${borderColor};border-bottom:1px solid ${borderColor};color:${textColor};text-align:center;vertical-align:middle;word-break:keep-all;overflow-wrap:break-word;line-height:1.4;box-sizing:border-box;min-width:2.5rem;font-size:inherit;\"\n- 짝수 행: background-color:${surfaceColor}\n- 모든 th·td에 width% 명시. colspan/rowspan 적극 활용.\n- 이미지 마커 (item1) 있을 때만 이미지 셀 생성. 마커 없으면 이미지 셀 생성 금지.\n- 데이터 없는 빈 행 생성 금지.\n\n---\n\n# [버튼 — 키워드 없으면 생성 금지]\n- [대버튼]: width:100%;padding:1.5rem 0;font-weight:800;border-radius:0.75rem;background-color:${accentColor};color:#000000;\n- [중버튼]: display:inline-block;padding:1rem 3.25rem;font-weight:700;border-radius:2rem;border:2px solid ${accentColor};color:${accentColor};\n- [소버튼]: display:inline-block;padding:0.625rem 1.5rem;font-size:inherit;border-radius:0.5rem;\n\n---\n\n# [탭 시스템]\n- 탭 버튼 텍스트에 \"tab01\" 등 지시어 노출 금지. 원고의 실제 탭 제목만.\n- <a href=\"#tab01\"> ↔ <div class=\"se-div\" id=\"tab01\"> 1:1 매칭 필수.\n- 탭 바 컨테이너: display:block;width:100%;text-align:center;padding:0.5rem 0;\n- 탭 버튼(a 태그): display:inline-block;padding:0.625rem 1.5rem;margin:0.25rem;border-radius:2rem;font-weight:700;text-decoration:none;word-break:keep-all;white-space:nowrap;\n- 활성 탭: background-color:${accentColor};color:${accentTextColor};\n- 비활성 탭: background-color:${surfaceColor};color:${subColor};\n- 탭 버튼은 반드시 면(fill) 방식. underline/border-bottom 방식 절대 금지.\n- 각 탭 섹션 se-div에 id=\"tab01\" 부여. 각 섹션 상단에 탭 바 반복.\n- Tab01. / Tab02. 텍스트는 HTML에 절대 노출 금지.\n\n---\n\n# [팝업 트리거]\n- 원고에 [팝업1] [팝업2] 마커 있으면 해당 위치에 트리거 버튼 삽입.\n- 버튼: <button class=\"popup-trigger\" data-popup=\"popup_N\" style=\"display:inline-block;width:1.375rem;height:1.375rem;line-height:1;border-radius:50%;background-color:${accentColor};color:#ffffff;font-size:0.75rem;font-weight:900;border:none;cursor:pointer;vertical-align:middle;margin:0 0.25rem;text-align:center;\">+</button>\n- <script> 태그: 슬라이드(갤러리)·팝업 기능 있을 때만 허용. 그 외 절대 금지.\n- [툴팁N] 마커 사용 금지. 반드시 [팝업N]으로 대체.\n\n---\n\n# [레이아웃 패턴 — 섹션마다 선택 적용]\nA: 풀와이드 + border-left:0.3125rem solid ${accentColor} + padding space-24\nB: 2단 배치 — <div class=\"se-para-div\"> 안에 <div class=\"se-div\" style=\"display:inline-block;vertical-align:top;width:48%;\"> × 2 + margin-left:4% (⚠️ 비교형/좌우 대칭 콘텐츠는 반드시 <table> 사용)\nC: 원형 번호 타임라인 (circle: 2rem, bg:${accentColor}, inline-block, vertical-align:top)\nD: pill 배지 (border-radius:1.25rem;padding:0.25rem 0.875rem) + 점선 본문\nE: 강조 띠 (background-color 명도 조절 hex, border-radius:1rem, padding space-32)\nF: 이모지 아이콘 리스트 (border-bottom:1px solid ${borderColor}, padding space-16)\nG: 카드 스택 (border-radius:0.875rem, bg:${surfaceColor}, border:1px solid ${borderColor})\nH: 교차 배경 (홀수·짝수 행 명도 미세 조절)\nI: 오버레이 배지 (position:relative, pill 제목 position:absolute;top:-0.875rem)\nJ: 3열 배치 — <div class=\"se-div\" style=\"display:inline-block;vertical-align:top;width:30%;margin:0 1.5% 1rem;\"> × 3\n\n---\n\n# [에디터 파서 우회 — 절대 준수]\n- class 없는 <div> 절대 금지. 에디터가 삭제함.\n- 컨테이너·그룹 필요 시: <div class=\"se-div\"> 또는 <div class=\"se-para-div\"> 만 허용.\n- 가로 정렬: <div class=\"se-para-div\"> 부모 + 내부 <div class=\"se-div\" style=\"display:inline-block;vertical-align:middle;\"> 조합.\n- display:flex · display:grid 금지. <table>은 데이터·비교 레이아웃에 허용 (레이아웃 전용 남용 금지).\n\n---\n\n# [섹션 분리 — 계층 구조]\n- 논리적으로 같은 주제 → 하나의 카드(se-div) 안에 묶기.\n- 다른 성격(기간 vs 참여방법 vs 보상목록)일 때만 별도 카드로 분리.\n- 소제목(■·▶·번호)이 하나의 주제 아래 있으면 카드 안에서 소제목으로 처리. 별도 카드 금지.\n- 계층: se-contents > 대카드(se-div) > 소섹션(내부 se-div) — 과도한 분리 FAIL.\n- 모든 섹션은 반드시 형제(Sibling)로 수직 적층. 중첩(Nesting) 금지.\n\n---\n\n# [메타 클리닝]\n- tab01 tab02 [대버튼] [중버튼] [소버튼] [팝업N] 등 지시어는 최종 HTML에서 삭제.\n";

        async function loadMasterGuideline() {
            masterGuidelineText = MASTER_GUIDELINES_INLINE;
            if (window.location.protocol.startsWith('http')) {
                try {
                    const response = await fetch('./master_guidelines.md');
                    if (response.ok) masterGuidelineText = await response.text();
                } catch (e) {}
            }
        }
        function toggleCdnInput(type) {
            if (type === 'html') {
                const isAbsolute = document.querySelector('input[name="exportPathType"]:checked').value === 'absolute';
                getById('htmlCdnInputArea').style.display = isAbsolute ? 'block' : 'none';
            } else if (type === 'slicer') {
                const isAbsolute = document.querySelector('input[name="slicerPathType"]:checked').value === 'absolute';
                const urlInput = getById('slicerCdnUrl');
                if (isAbsolute) {
                    urlInput.classList.remove('hidden');
                    urlInput.classList.add('block');
                } else {
                    urlInput.classList.add('hidden');
                    urlInput.classList.remove('block');
                }
            }
        }

        function openExportHtmlModal() {
            const area = getById('contentArea');
            if (!area || area.innerText.includes('DESIGN ENGINE IDLE')) return showToast("\uc800\uc7a5\ud560 \ucee8\ud150\uce20\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.");
            getById('exportHtmlModal').classList.remove('hidden');
        }
        
        function closeExportHtmlModal() {
            getById('exportHtmlModal').classList.add('hidden');
        }

        async function convertImagesToBase64(rootEl) {
            const imgs = Array.from(rootEl.querySelectorAll('img'));
            await Promise.all(imgs.map(img => new Promise(resolve => {
                const src = img.getAttribute('src') || '';
                if (!src || src.startsWith('data:') || src.startsWith('http')) return resolve();
                const tempImg = new Image();
                tempImg.crossOrigin = 'anonymous';
                tempImg.onload = () => {
                    try {
                        const c = document.createElement('canvas');
                        c.width  = tempImg.naturalWidth  || tempImg.width  || 1;
                        c.height = tempImg.naturalHeight || tempImg.height || 1;
                        c.getContext('2d').drawImage(tempImg, 0, 0);
                        img.src = c.toDataURL('image/png');
                    } catch(e) { }
                    resolve();
                };
                tempImg.onerror = () => resolve();
                tempImg.src = src;
            })));
        }

        let slicerImg = null;
        let slicerLinks = [];
        let slicerPopups = []; // 팝업 트리거 버튼 위치 목록
        let autoSliceCount = 1;

        async function openSlicerModal() {
            const sheet = getById('documentSheet');
            if (!sheet || sheet.innerText.includes('DESIGN ENGINE IDLE')) return showToast("\ubd84\ud560\ud560 \ucee8\ud150\uce20\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.");
            if (activeLayer) activeLayer.classList.remove('active-layer');
            getById('slicerModal').classList.remove('hidden');
            getById('slicerLoading').classList.remove('hidden');
            getById('slicerCanvas').classList.add('hidden');
            getById('autoSliceCountBadge').innerText = "\ub80c\ub354\ub9c1 \ubc0f \ubd84\uc11d \uc911...";

            setTimeout(async () => {
                let capture;
                try {
                    capture = await prepareSheetForCapture();
                    const { targetScale, bgColor } = capture;

                    const sheetRect = sheet.getBoundingClientRect();

                    // id 속성 있는 엘리먼트의 Y좌표 수집 (탭 타겟 섹션 위치)
                    const anchorTargetMap = {};
                    sheet.querySelectorAll('[id]').forEach(el => {
                        const rect = el.getBoundingClientRect();
                        anchorTargetMap[el.id] = (rect.top - sheetRect.top) * targetScale;
                    });
                    // slicerLinks에 anchorTargetMap 포함해서 저장
                    // a.href 대신 getAttribute('href') 사용 → 절대URL 변환 방지
                    slicerLinks = Array.from(sheet.querySelectorAll('a')).map(a => {
                        const rect = a.getBoundingClientRect();
                        const rawHref = a.getAttribute('href') || '';
                        const hash = rawHref.startsWith('#') ? rawHref.slice(1) : '';
                        return {
                            url: rawHref,
                            x: (rect.left - sheetRect.left) * targetScale,
                            y: (rect.top - sheetRect.top) * targetScale,
                            w: rect.width * targetScale,
                            h: rect.height * targetScale,
                            targetY: hash && anchorTargetMap[hash] !== undefined ? anchorTargetMap[hash] : null
                        };
                    }).filter(l => l.w > 0 && l.h > 0);

                    // 팝업 트리거 버튼 위치 수집 (슬라이스 HTML에 onclick 오버레이로 삽입)
                    slicerPopups = Array.from(sheet.querySelectorAll('.popup-trigger[data-popup]')).map(btn => {
                        const rect = btn.getBoundingClientRect();
                        const id = btn.getAttribute('data-popup');
                        const btnStyle = btn.getAttribute('style') || '';
                        return {
                            id,
                            x: (rect.left - sheetRect.left) * targetScale,
                            y: (rect.top - sheetRect.top) * targetScale,
                            w: Math.max(rect.width * targetScale, 28),
                            h: Math.max(rect.height * targetScale, 28),
                            style: btnStyle
                        };
                    }).filter(p => p.id && p.w > 0 && p.h > 0);

                    // 로고 합성: 클론의 히어로 이미지에만 합성 (원본 DOM 불변)
                    if (logoBase64) {
                        const composited = await compositeHeroWithLogo();
                        if (composited) {
                            const cloneHero = capture.sheet.querySelector('#mainHeroImg');
                            if (cloneHero) cloneHero.src = composited;
                        }
                    }

                    const toCanvasOpts = {
                        pixelRatio: targetScale,
                        backgroundColor: bgColor,
                        skipFonts: true,
                        useCORS: true,
                        allowTaint: false,
                        cacheBust: false,
                        style: { transform: 'none', margin: '0', padding: '0' },
                        filter: node => {
                            if (!node.classList) return true;
                            if (node.classList.contains('resizer-handle')) return false;
                            if (node.id === 'heroLogoOverlay') return false;
                            return true;
                        }
                    };
                    // 렌더링 헬퍼: 타임아웃 포함 (hang 방지) — 클론에 적용
                    const RENDER_TIMEOUT = 50000;
                    const renderWithTimeout = (opts) => Promise.race([
                        htmlToImage.toCanvas(capture.sheet, opts),
                        new Promise((_, rej) => setTimeout(() => rej(new Error('렌더링 시간 초과(50s)')), RENDER_TIMEOUT))
                    ]);
                    const fallbackFilter = node => {
                        if (!node.classList) return true;
                        if (node.classList.contains('resizer-handle')) return false;
                        if (node.id === 'heroLogoOverlay') return false;
                        // popup-trigger 버튼은 이미지에 포함
                        if (node.tagName === 'IMG') {
                            const s = node.getAttribute('src') || '';
                            if (s.startsWith('http')) return false;
                        }
                        return true;
                    };
                    let canvas;
                    try {
                        canvas = await renderWithTimeout(toCanvasOpts);
                    } catch(renderErr) {
                        console.warn('1차 렌더링 실패, 저해상도 재시도:', renderErr.message);
                        getById('slicerLoading').innerHTML = `<div style="color:#fbbf24;font-size:13px;padding:20px;text-align:center;line-height:2;">⚠️ 고해상도 렌더링 실패<br><span style="color:#94a3b8;font-size:11px;">저해상도로 재시도 중...</span></div>`;
                        const retryScale = Math.max(targetScale * 0.55, 0.5);
                        try {
                            canvas = await renderWithTimeout({ ...toCanvasOpts, pixelRatio: retryScale, filter: fallbackFilter });
                        } catch(retryErr) {
                            throw new Error('렌더링 완전 실패: ' + retryErr.message);
                        }
                    }

                    // 클론 방식이므로 원본 heroImg 복원 불필요 (원본은 건드리지 않음)
                    const BASE_SLICE_HEIGHT = 4000;
                    autoSliceCount = Math.max(1, Math.ceil(canvas.height / BASE_SLICE_HEIGHT));
                    getById('autoSliceCountBadge').innerText = `\uc790\ub3d9 \ubd84\ud560: ${autoSliceCount}\uc7a5`;
                    slicerImg = new Image();
                    slicerImg.onload = () => {
                        getById('slicerLoading').classList.add('hidden');
                        const sCanvas = getById('slicerCanvas');
                        sCanvas.classList.remove('hidden');
                        drawSlicer();
                        // CSS 높이를 비율에 맞게 명시적으로 설정 (height:auto가 canvas에서 미동작 방지)
                        const container = getById('slicerCanvasContainer');
                        const displayW = Math.min(840, (container ? container.offsetWidth : 840) - 64);
                        const displayH = Math.round(slicerImg.height * (displayW / slicerImg.width));
                        sCanvas.style.width = displayW + 'px';
                        sCanvas.style.height = displayH + 'px';
                        sCanvas.style.maxWidth = '100%';
                    };
                    slicerImg.src = canvas.toDataURL('image/jpeg', 1.0);
                } catch (e) {
                    console.error("Dynamic Slicer Rendering Failed", e);
                    getById('slicerLoading').innerHTML = `<div style="color:#f87171;font-size:13px;padding:20px;text-align:center;line-height:2;">\u274c \ub80c\ub354\ub9c1 \uc2e4\ud328<br><span style="color:#94a3b8;font-size:11px;">${e.message || '\uc54c \uc218 \uc5c6\ub294 \uc624\ub958'}</span></div>`;
                } finally {
                    if (capture) capture.restore();
                }
            }, 100);
        }
        
        function closeSlicerModal() {
            getById('slicerModal').classList.add('hidden');
            getById('slicerLoading').classList.remove('hidden');
            getById('slicerCanvas').classList.add('hidden');
        }

        function drawSlicer() {
            if (!slicerImg) return;
            const sCanvas = getById('slicerCanvas');
            const sCtx = sCanvas.getContext('2d');
            
            sCanvas.width = slicerImg.width;
            sCanvas.height = slicerImg.height;

            sCtx.clearRect(0, 0, sCanvas.width, sCanvas.height);
            sCtx.drawImage(slicerImg, 0, 0);

            sCtx.lineWidth = 4;
            slicerLinks.forEach(link => {
                sCtx.fillStyle = 'rgba(59, 130, 246, 0.4)';
                sCtx.fillRect(link.x, link.y, link.w, link.h);
                sCtx.strokeStyle = '#2563eb';
                sCtx.strokeRect(link.x, link.y, link.w, link.h);
                
                sCtx.fillStyle = 'white';
                sCtx.font = 'bold 36px Pretendard';
                sCtx.shadowColor = 'black';
                sCtx.shadowBlur = 6;
                sCtx.fillText("\ud83d\udd17 \ub9c1\ud06c \uc601\uc5ed", link.x + 15, link.y + 40);
                sCtx.shadowBlur = 0;
                sCtx.shadowColor = 'transparent';
            });

            const lines = calculateVerticalSliceLines(slicerImg.height, autoSliceCount, slicerLinks);
            
            sCtx.strokeStyle = '#ef4444';
            sCtx.lineWidth = 4;
            sCtx.setLineDash([20, 20]);
            lines.forEach(y => {
                sCtx.beginPath();
                sCtx.moveTo(0, y);
                sCtx.lineTo(sCanvas.width, y);
                sCtx.stroke();
            });
            sCtx.setLineDash([]);
        }

        function calculateVerticalSliceLines(height, count, links) {
            let lines = [];
            let idealH = height / count;
            for (let i = 1; i < count; i++) {
                let y = idealH * i;
                for (let link of links) {
                    if (y >= link.y - 20 && y <= link.y + link.h + 20) {
                        y = link.y + link.h + 30;
                    }
                }
                lines.push(y);
            }
            return [...new Set(lines)].sort((a,b) => a-b).filter(y => y > 0 && y < height);
        }

        async function executeSliceAndExport() {
            if (!slicerImg) return;

            const pathType = document.querySelector('input[name="slicerPathType"]:checked').value;
            if (!currentHashFolder) currentHashFolder = generateHashString(16);
            const hashFolder = currentHashFolder;
            // 항상 상대경로로 빌드 — CDN URL 입력 시 사후 치환으로 절대경로 버전 추가 생성
            const baseUrl = `./${hashFolder}/`;

            let slicerCdnUrl = null;
            if (pathType === 'absolute') {
                const rawCdn = (getById('slicerCdnUrl')?.value || '').trim();
                if (!rawCdn) { showToast("절대경로(CDN) 이미지 서버 URL을 입력해주세요."); return; }
                slicerCdnUrl = rawCdn.endsWith('/') ? rawCdn : rawCdn + '/';
            }

            const btn = getById('exportSpinner');
            btn.classList.remove('hidden');
            showToast('팝업 캡처 및 슬라이스 중...');

            const bgColor  = getById('bgPicker').value   || '#ffffff';
            const acColor  = (getById('accentPicker')?.value || '#7c3aed');
            const mw       = parseInt(getById('pageWidthInput').value) || 840;

            const zip = new JSZip();
            // 이미지 데이터 수집기 — 폴더별로 분리
            // sliceImgRegistry: 슬라이스 이미지 + 팝업 캡처 → PROMO_SLICED/hashFolder/
            // contentImgRegistry: 콘텐츠 이미지(generateLocalHtml) → PROMO_html/hashFolder/
            const sliceImgRegistry = [];  // {name, data, opts}
            const contentImgRegistry = []; // {name, data, opts}
            // 슬라이스 루프 + 팝업 캡처에서 사용하는 imgFolder
            const imgFolder = { file: function(name, data, opts) { sliceImgRegistry.push({name, data, opts: opts||{}}); } };
            // generateLocalHtml에서 사용하는 contentImgFolder
            const contentImgFolder = { file: function(name, data, opts) { contentImgRegistry.push({name, data, opts: opts||{}}); } };

            // ── 1단계: 팝업 패널 이미지 캡처 (childSheet 전체 — 위지윅과 동일한 디자인) ──
            const popupImagePaths = {};
            if (childPanels.length > 0) {
                const bgColPopup = getById('bgPicker')?.value || '#1e293b';
                for (const panel of childPanels) {
                    const childSheet = getById('childSheet_' + panel.id);
                    const childArea  = getById('childArea_' + panel.id);
                    if (!childArea) continue;
                    const text = childArea.innerText.trim().replace(/\[툴팁\d*\]/g, '').replace(/\[팝업\d*\]/g, '').trim();
                    if (!text || text.includes('팝업') && text.length < 10) continue;
                    // 팝업도 클론 방식 — 원본 childArea DOM 불변
                    // position:fixed+left:negative를 클론에 직접 주면 htmlToImage가 빈 캔버스를 생성하므로
                    // wrapper(_popupWrap)만 off-screen으로 두고 caClone은 자연 CSS 유지
                    const caCloneW = childArea.offsetWidth || 640;
                    const _popupWrap = document.createElement('div');
                    _popupWrap.style.cssText = `position:fixed;top:0;left:-${caCloneW + 300}px;width:${caCloneW}px;overflow:hidden;pointer-events:none;z-index:-9999;`;
                    const caClone = childArea.cloneNode(true);
                    caClone.style.width = caCloneW + 'px';
                    caClone.style.background = '#ffffff';
                    // AI가 생성한 닫기 버튼 제거 (슬라이스 이미지에 × 중복 노출 방지)
                    caClone.querySelectorAll('button, [role="button"], a').forEach(el => {
                        const txt = (el.textContent || '').trim();
                        if (['×', '✕', '✗', 'X', '닫기', 'Close', 'CLOSE'].includes(txt)) el.remove();
                    });
                    _popupWrap.appendChild(caClone);
                    document.body.appendChild(_popupWrap);
                    await convertImagesToBase64(caClone);
                    try {
                        const popupCanvas = await htmlToImage.toCanvas(caClone, {
                            pixelRatio: 2, backgroundColor: '#ffffff',
                            skipFonts: true, useCORS: true
                        });
                        const fname = panel.id + '.png';
                        imgFolder.file(fname, popupCanvas.toDataURL('image/png').split(',')[1], { base64: true });
                        popupImagePaths[panel.id] = './' + hashFolder + '/' + fname;
                    } catch(e) { console.warn('팝업 캡처 실패:', panel.id, e); }
                    if (_popupWrap.isConnected) _popupWrap.remove();
                }
            }

            // ── 2단계: 슬라이스 루프 ──
            const lines = calculateVerticalSliceLines(slicerImg.height, autoSliceCount, slicerLinks);
            lines.push(slicerImg.height);

            let htmlResult = `<meta charset="UTF-8">\n<div style="max-width:${mw}px;width:100%;margin:0 auto;background-color:${bgColor};position:relative;text-align:center;font-size:0;line-height:0;">`;

            let startY = 0;
            const tempCanvas = document.createElement('canvas');
            const tCtx = tempCanvas.getContext('2d');

            for (let i = 0; i < lines.length; i++) {
                const endY  = lines[i];
                const sliceH = endY - startY;

                tempCanvas.width  = slicerImg.width;
                tempCanvas.height = sliceH;
                tCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
                tCtx.drawImage(slicerImg, 0, startY, slicerImg.width, sliceH, 0, 0, tempCanvas.width, tempCanvas.height);

                const fileName = `slice_${i + 1}.jpg`;
                imgFolder.file(fileName, tempCanvas.toDataURL('image/jpeg', 1.0).split(',')[1], { base64: true });

                // 링크 오버레이
                let anchorsHtml = '';
                slicerLinks.forEach(link => {
                    const cy = link.y + link.h / 2;
                    if (cy >= startY && cy <= endY) {
                        const relY = link.y - startY;
                        // 클릭 영역을 상하 4px 확장해 위치 오차 보정
                        const expandPx = 4;
                        const adjY = Math.max(0, relY - expandPx);
                        const adjH = link.h + expandPx * 2;
                        anchorsHtml += `\n        <a href="${link.url}" target="_blank" style="position:absolute;display:block;z-index:10;left:${(link.x/tempCanvas.width*100).toFixed(3)}%;top:${(adjY/sliceH*100).toFixed(3)}%;width:${(link.w/tempCanvas.width*100).toFixed(3)}%;height:${(adjH/sliceH*100).toFixed(3)}%;background-color:transparent;text-decoration:none;border:none;outline:none;cursor:pointer;"></a>`;
                    }
                });

                // ── 팝업 버튼: 이미지에 자연 렌더링 + 이미지맵 <area>로 클릭 처리 ──
                // popup-trigger 버튼은 filter에서 제외하지 않으므로 이미지에 그대로 박제됨
                // 이미지맵으로 해당 위치를 클릭 가능하게 처리 (반응형 스케일 JS 포함)
                const mapName = `slcmap${i + 1}`;
                let mapAreasHtml = '';
                slicerPopups.forEach(popup => {
                    const pcy = popup.y + popup.h / 2;
                    if (pcy < startY || pcy > endY) return;
                    const imgPath = popupImagePaths[popup.id];

                    const relY = popup.y - startY;
                    const bx   = popup.x + popup.w / 2;
                    const by   = relY    + popup.h / 2;
                    const r    = Math.min(popup.w, popup.h) / 2 + 4; // 클릭 여유 +4px

                    const ax = Math.round(bx), ay = Math.round(by), ar = Math.round(r);
                    const layerId = '__popup_' + popup.id + '__';
                    let onclickCode = '';

                    // 게시물 컨테이너를 기준으로 딤드 범위 한정
                    const _slicerOverlayJs = [
                        `var _cont=document.querySelector('div[style*=max-width]')||document.documentElement;`,
                        `var _cr=_cont.getBoundingClientRect();`,
                        `d.style='position:fixed;top:0;left:'+Math.round(_cr.left)+'px;width:'+Math.round(_cr.width)+'px;height:100%;background:#000000B8;z-index:99999;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:2rem 1rem;box-sizing:border-box;';`,
                    ].join('');
                    if (imgPath) {
                        // 이미지 캡처 성공 → 이미지 오버레이 팝업
                        onclickCode = [
                            `var ex=document.getElementById('${layerId}');if(ex){ex.remove();return;}`,
                            `var d=document.createElement('div');d.id='${layerId}';`,
                            _slicerOverlayJs,
                            `var wrap=document.createElement('div');wrap.style='position:relative;width:100%;max-width:740px;margin:0 auto;';`,
                            `var img=document.createElement('img');img.src='${imgPath}';img.style='display:block;width:100%;height:auto;border-radius:0.75rem;';`,
                            `var close=document.createElement('button');close.innerHTML='✕';`,
                            `close.style='position:absolute;top:-0.875rem;right:-0.875rem;background:${acColor};color:#ffffff;border:none;border-radius:50%;width:1.75rem;height:1.75rem;font-size:0.875rem;font-weight:900;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;line-height:1;';`,
                            `close.onclick=function(e){e.stopPropagation();d.remove();};`,
                            `wrap.appendChild(img);wrap.appendChild(close);d.appendChild(wrap);`,
                            `d.addEventListener('touchstart',function(e){if(e.target===d)d.remove();},{passive:true});`,
                            `d.onclick=function(e){if(e.target===d)d.remove();};document.body.appendChild(d);`
                        ].join('');
                    } else {
                        // 이미지 캡처 실패 → HTML 인라인 팝업 폴백
                        const childAreaEl = getById('childArea_' + popup.id);
                        if (!childAreaEl) return;
                        const cloneEl = childAreaEl.cloneNode(true);
                        cloneEl.querySelectorAll('.active-layer').forEach(el => el.classList.remove('active-layer'));
                        cloneEl.querySelectorAll('.resizer-handle').forEach(el => el.remove());
                        cloneEl.querySelectorAll('button,[role="button"],a').forEach(el => {
                            if (['×','✕','✗','X','닫기','Close','CLOSE'].includes((el.textContent||'').trim())) el.remove();
                        });
                        const escaped = cloneEl.innerHTML.trim()
                            .replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;').replace(/\n/g,'');
                        if (!escaped) return;
                        onclickCode = [
                            `var ex=document.getElementById('${layerId}');if(ex){ex.remove();return;}`,
                            `var d=document.createElement('div');d.id='${layerId}';`,
                            _slicerOverlayJs,
                            `var wrap=document.createElement('div');wrap.style='position:relative;width:100%;max-width:740px;margin:0 auto;';`,
                            `var box=document.createElement('div');`,
                            `box.style='background:#ffffff;border-radius:0.75rem;overflow-y:auto;padding:1.5rem;max-height:80vh;font-family:Pretendard,sans-serif;line-height:1.8;box-sizing:border-box;-webkit-overflow-scrolling:touch;color:#1e293b;box-shadow:0 4px 32px #0000002e;';`,
                            `box.innerHTML='${escaped}';`,
                            `var close=document.createElement('button');close.innerHTML='✕';`,
                            `close.style='position:absolute;top:-0.875rem;right:-0.875rem;background:${acColor};color:#ffffff;border:none;border-radius:50%;width:1.75rem;height:1.75rem;font-size:0.875rem;font-weight:900;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;line-height:1;';`,
                            `close.onclick=function(e){e.stopPropagation();d.remove();};`,
                            `wrap.appendChild(box);wrap.appendChild(close);d.appendChild(wrap);`,
                            `d.addEventListener('touchstart',function(e){if(e.target===d)d.remove();},{passive:true});`,
                            `d.onclick=function(e){if(e.target===d)d.remove();};document.body.appendChild(d);`
                        ].join('');
                    }
                    mapAreasHtml += `\n        <area shape="circle" coords="${ax},${ay},${ar}" data-orig="${ax},${ay},${ar}" href="javascript:void(0)" onclick="(function(event){event.preventDefault();event.stopPropagation();${onclickCode}})(event);" alt="팝업 열기" title="팝업 열기">`;
                });

                const useMapAttr = mapAreasHtml ? ` usemap="#${mapName}"` : '';
                const mapTag     = mapAreasHtml ? `\n        <map name="${mapName}">${mapAreasHtml}\n        </map>` : '';

                htmlResult += `\n    <div style="position:relative;width:100%;line-height:0;font-size:0;margin:0;padding:0;">\n        <img src="${baseUrl}${fileName}" alt="slice_${i+1}" style="width:100%;display:block;margin:0;padding:0;"${useMapAttr}>${anchorsHtml}${mapTag}\n    </div>`;
                startY = endY;
            }
            htmlResult += `\n</div>`;

            // ── 3단계: 앵커 스크롤 JS ──
            const anchorTargets = {};
            slicerLinks.forEach(link => {
                if (link.url && link.url.includes('#')) {
                    const hash = link.url.split('#')[1];
                    if (hash && !(hash in anchorTargets)) anchorTargets[hash] = link.targetY !== null ? link.targetY : link.y;
                }
            });
            if (Object.keys(anchorTargets).length > 0) {
                const imgW = slicerImg.width;
                let scrollJs = '<script>\n(function(){\nvar anchors=' + JSON.stringify(anchorTargets) + ';\nvar imgW=' + imgW + ';\n';
                scrollJs += 'document.addEventListener("click",function(e){var a=e.target.closest("a")||(e.target.tagName==="AREA"?e.target:null);if(!a)return;var href=a.getAttribute("href")||"";if(!href.startsWith("#"))return;var hash=href.slice(1);if(anchors[hash]===undefined)return;e.preventDefault();var container=document.querySelector("div[style*=\'max-width\']");if(!container)return;var scale=container.offsetWidth/imgW;window.scrollTo({top:anchors[hash]*scale,behavior:"smooth"});});\n})();\n<\/script>';
                htmlResult += '\n' + scrollJs;
            }

            // ── 4단계: 반응형 이미지맵 스케일 JS ──
            // 뷰포트 크기 변화 시 area coords를 이미지 표시 크기에 맞게 재계산
            if (slicerPopups.length > 0) {
                const mapScaleJs = '<script>(function(){' +
                    'function _rm(img){' +
                    '  var mn=(img.getAttribute("usemap")||"").replace(/^#/,"");' +
                    '  if(!mn)return;' +
                    '  var map=document.querySelector("map[name=\\""+mn+"\\"]");' +
                    '  if(!map||!img.naturalWidth)return;' +
                    '  var sx=img.offsetWidth/img.naturalWidth;' +
                    '  map.querySelectorAll("area[data-orig]").forEach(function(a){' +
                    '    var c=a.getAttribute("data-orig").split(",").map(Number);' +
                    '    a.setAttribute("coords",[Math.round(c[0]*sx),Math.round(c[1]*sx),Math.round(c[2]*sx)].join(","));' +
                    '  });' +
                    '}' +
                    'function _ra(){document.querySelectorAll("img[usemap]").forEach(function(img){' +
                    '  if(img.complete&&img.naturalWidth>0){_rm(img);}' +
                    '  else{img.addEventListener("load",function(){_rm(img);},{once:true});}' +
                    '});}' +
                    'window.addEventListener("load",_ra);' +
                    'window.addEventListener("resize",function(){setTimeout(_ra,50);});' +
                    'document.addEventListener("DOMContentLoaded",_ra);' +
                    '})();<\/script>';
                htmlResult += '\n' + mapScaleJs;
            }

            // ── 5단계: ZIP 저장 ──
            // CDN URL 입력 시 절대경로 버전 추가 생성 (CDN URL + hashFolder/ 포함)
            let cdnHtmlResult = null;
            if (slicerCdnUrl) {
                const _escapedHash = hashFolder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const cdnBaseUrl = slicerCdnUrl + hashFolder + '/';
                cdnHtmlResult = htmlResult.replace(new RegExp('\\.\\/'+_escapedHash+'\\/', 'g'), cdnBaseUrl);
            }

            // ── index_불러오기용.html: HTML 코드 저장과 동일한 구조 (프로모에디터 재불러오기 전용) ──
            // contentArea HTML + 이미지 파일 추출(상대경로) → 에디터 없이 바로 열람 가능
            // HTML 문자열을 반환 (ZIP 저장은 아래 구조 확정 후 수행)
            const localHtmlResult = (function generateLocalHtml() {
                const _ca = getById('contentArea');
                const _hi = getById('mainHeroImg');
                if (!_ca) return null;

                // 1) 클린 복사
                const _d = document.createElement('div');
                _d.innerHTML = _ca.innerHTML;
                _d.querySelectorAll('.active-layer').forEach(el => el.classList.remove('active-layer'));
                _d.querySelectorAll('.resizer-handle').forEach(el => el.remove());
                _d.querySelectorAll('.se-popup-content').forEach(el => el.remove());
                _d.querySelectorAll('.tbl-scroll-wrap').forEach(wrap => { wrap.style.overflowX = 'auto'; });

                // 2) 이미지 스캔 → contentImgRegistry에 수집 (PROMO_html/hashFolder/ 전용)
                const _imgMap = new Map();
                let _imgIdx = 1;
                _d.querySelectorAll('img').forEach(img => {
                    const src = img.getAttribute('src') || '';
                    if (src.startsWith('data:image') && !_imgMap.has(src)) {
                        const ext = src.substring('data:image/'.length, src.indexOf(';base64'));
                        const fn = `content_img_${_imgIdx++}.${ext}`;
                        _imgMap.set(src, fn);
                        contentImgFolder.file(fn, src.split(',')[1], { base64: true });
                    }
                });
                childPanels.forEach(panel => {
                    const _pca = getById('childArea_' + panel.id);
                    if (!_pca) return;
                    _pca.querySelectorAll('img[src]').forEach(img => {
                        const src = img.getAttribute('src') || '';
                        if (src.startsWith('data:image') && !_imgMap.has(src)) {
                            const ext = src.substring('data:image/'.length, src.indexOf(';base64'));
                            const fn = `content_img_${_imgIdx++}.${ext}`;
                            _imgMap.set(src, fn);
                            contentImgFolder.file(fn, src.split(',')[1], { base64: true });
                        }
                    });
                });

                // 2-b) 영상 스캔 — blob URL(videoObjectUrlMap) + data URL 모두 처리
                const _videoMap = new Map();
                let _videoIdx = 1;
                const _scanForVideo = [_d];
                childPanels.forEach(panel => { const ca = getById('childArea_' + panel.id); if (ca) _scanForVideo.push(ca); });
                _scanForVideo.forEach(root => {
                    root.querySelectorAll('video[src]').forEach(vid => {
                        const src = vid.getAttribute('src') || '';
                        const resolvedSrc = src.startsWith('blob:') ? (videoObjectUrlMap.get(src) || src) : src;
                        if (resolvedSrc.startsWith('data:video') && !_videoMap.has(src)) {
                            const mime = resolvedSrc.substring('data:video/'.length, resolvedSrc.indexOf(';base64'));
                            const ext = mime.split('+')[0] || 'mp4';
                            const fn = `content_video_${_videoIdx++}.${ext}`;
                            _videoMap.set(src, fn);
                            contentImgFolder.file(fn, resolvedSrc.split(',')[1], { base64: true });
                        }
                    });
                });

                // 3) src 치환 (이미지 + 영상)
                _d.querySelectorAll('img').forEach(img => {
                    const src = img.getAttribute('src') || '';
                    if (_imgMap.has(src)) img.setAttribute('src', baseUrl + _imgMap.get(src));
                });
                _d.querySelectorAll('video[src]').forEach(vid => {
                    const src = vid.getAttribute('src') || '';
                    if (_videoMap.has(src)) vid.setAttribute('src', baseUrl + _videoMap.get(src));
                });

                // 4) 히어로 이미지 삽입
                const _heroSrc = _hi?.getAttribute('src') || '';
                let _heroFn = '';
                if (_heroSrc && _heroSrc.startsWith('data:image')) {
                    if (_imgMap.has(_heroSrc)) {
                        _heroFn = _imgMap.get(_heroSrc);
                    } else {
                        const ext = _heroSrc.substring('data:image/'.length, _heroSrc.indexOf(';base64'));
                        _heroFn = `hero.${ext}`;
                        contentImgFolder.file(_heroFn, _heroSrc.split(',')[1], { base64: true });
                    }
                }
                const _heroFinal = _heroFn ? baseUrl + _heroFn : _heroSrc;
                if (_heroFinal) {
                    const heroTag = `<img src="${_heroFinal}" style="width:100%;display:block;margin:0;padding:0;border:none;">`;
                    const _sc = _d.querySelector('.se-contents');
                    if (_sc) {
                        const _fd = _sc.querySelector(':scope > .se-div:first-child');
                        if (_fd && (_fd.style.fontSize === '0' || !_fd.innerHTML.trim())) {
                            _fd.innerHTML = heroTag;
                            _fd.style.fontSize = '0'; _fd.style.lineHeight = '0';
                        } else {
                            const _hd = document.createElement('div');
                            _hd.className = 'se-div';
                            _hd.style.cssText = 'margin:0;padding:0;font-size:0;line-height:0;display:block;width:100%;box-sizing:border-box;';
                            _hd.innerHTML = heroTag;
                            _sc.insertBefore(_hd, _sc.firstChild);
                        }
                    }
                }

                // 5) 버튼 링크 target="_blank" 적용 후 팝업 인라인 변환
                applyTargetBlankToLinks(_d);
                let _rawHtml = _d.innerHTML;
                _rawHtml = convertRgbToHex(_rawHtml);
                _rawHtml = expandHexColors(_rawHtml);
                let _localHtml = '<meta charset="UTF-8">\n' + _rawHtml;
                // ── 불러오기용: se-popup-content만, onclick 없음 ──
                childPanels.forEach(panel => {
                    const ca = getById('childArea_' + panel.id);
                    if (!ca) return;
                    const txt = ca.innerText.trim();
                    if (!txt || (txt.includes('팝업') && txt.length < 10)) return;
                    const clone = ca.cloneNode(true);
                    clone.querySelectorAll('.active-layer').forEach(el => el.classList.remove('active-layer'));
                    clone.querySelectorAll('.resizer-handle').forEach(el => el.remove());
                    _localHtml += `\n<div class="se-div se-popup-content" data-popup="${panel.id}" style="display:none;overflow:hidden;width:0;height:0;margin:0;padding:0;border:none;">${clone.innerHTML}</div>`;
                });
                // popup-trigger 버튼에서 onclick 제거 (script가 처리)
                _localHtml = _localHtml.replace(/(<(?:button|a)[^>]*class="popup-trigger"[^>]*)\s+onclick="[^"]*"/gi, '$1');
                // 이벤트 위임 script 추가 (se-popup-content를 데이터 소스로 사용)
                if (childPanels.length > 0) {
                    const _slAc = (getById('accentPicker')?.value || '#7c3aed');
                    _localHtml += `\n<script>
(function(){
var ac='${_slAc}';
document.addEventListener('click',function(e){
var btn=e.target.closest?e.target.closest('.popup-trigger[data-popup]'):null;
if(!btn){var el=e.target;while(el&&el!==document){if(el.classList&&el.classList.contains('popup-trigger')&&el.getAttribute('data-popup')){btn=el;break;}el=el.parentNode;}}
if(!btn)return;
e.preventDefault();e.stopPropagation();
var pid=btn.getAttribute('data-popup');
var lid='__popup_'+pid+'__';
var ex=document.getElementById(lid);
if(ex){ex.remove();return;}
var src=document.querySelector('.se-popup-content[data-popup="'+pid+'"]');
if(!src)return;
var _cont=document.querySelector('.se-contents')||document.querySelector('div[style*="max-width"]')||document.documentElement;
var _cr=_cont.getBoundingClientRect();
var _br=btn.getBoundingClientRect();
var d=document.createElement('div');d.id=lid;
d.style='position:fixed;top:0;left:'+Math.round(_cr.left)+'px;width:'+Math.round(_cr.width)+'px;height:100%;background:#000000B8;z-index:99999;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:1rem;box-sizing:border-box;';
var wrap=document.createElement('div');
wrap.style='position:relative;width:100%;max-width:740px;margin:0 auto;';
var box=document.createElement('div');
box.style='background:#ffffff;border-radius:0.75rem;overflow-y:auto;padding:1.5rem;max-height:80vh;font-family:Pretendard,sans-serif;line-height:1.8;box-sizing:border-box;-webkit-overflow-scrolling:touch;color:#1e293b;box-shadow:0 4px 32px #0000002e;';
box.innerHTML=src.innerHTML;
wrap.appendChild(box);
var close=document.createElement('button');close.innerHTML='\\u2715';
close.style='position:absolute;top:-0.875rem;right:-0.875rem;background:'+ac+';color:#ffffff;border:none;border-radius:50%;width:1.75rem;height:1.75rem;font-size:0.875rem;font-weight:900;cursor:pointer;z-index:10;display:inline-flex;align-items:center;justify-content:center;line-height:1;';
close.onclick=function(ev){ev.stopPropagation();d.remove();};
wrap.appendChild(close);d.appendChild(wrap);
d.addEventListener('touchstart',function(ev){if(ev.target===d)d.remove();},{passive:true});
d.onclick=function(ev){if(ev.target===d)d.remove();};
document.body.appendChild(d);
setTimeout(function(){var sy=Math.max(0,_br.top-_cr.top-60);d.scrollTop=sy;},50);
});
})();
<\/script>`;
                }
                return '\uFEFF' + _localHtml;
            })();

            // ── 5단계: ZIP 폴더 구조 확정 및 저장 ──
            // ZIP 구조:
            //   PROMO_SLICED/ ← 슬라이스 이미지 기반 HTML
            //     ├── index.html        (상대경로, 항상)
            //     ├── index_cdn.html    (CDN 입력 시에만)
            //     └── {hashFolder}/     (슬라이스 이미지 + 팝업 캡처)
            //   PROMO_html/ ← 콘텐츠 HTML 코드 저장
            //     ├── index_불러오기용.html  (상대경로, 항상 — 프로모에디터 재불러오기 전용)
            //     ├── index_cdn.html    (CDN 입력 시에만)
            //     └── {hashFolder}/     (콘텐츠 이미지)

            // PROMO_SLICED 폴더
            const slicedFolder = zip.folder('PROMO_SLICED');
            const slicedImgF = slicedFolder.folder(hashFolder);
            sliceImgRegistry.forEach(({name, data, opts}) => { slicedImgF.file(name, data, opts); });
            slicedFolder.file('index.html', '\uFEFF' + htmlResult);
            if (slicerCdnUrl && cdnHtmlResult) {
                slicedFolder.file('index_cdn.html', '\uFEFF' + cdnHtmlResult);
            }

            // PROMO_html 폴더
            const htmlFolder = zip.folder('PROMO_html');
            const htmlImgF = htmlFolder.folder(hashFolder);
            contentImgRegistry.forEach(({name, data, opts}) => { htmlImgF.file(name, data, opts); });
            if (localHtmlResult) {
                // 불러오기용 (onclick 없음, se-popup-content 포함)
                htmlFolder.file('index_불러오기용.html', localHtmlResult);
                // 게시용 CDN: onclick 포함, se-popup-content 제거
                if (slicerCdnUrl) {
                    const _escapedHash2 = hashFolder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const contentCdnUrl = slicerCdnUrl + hashFolder + '/';
                    let contentCdnHtml = localHtmlResult.replace(
                        new RegExp('\\.\\/'+_escapedHash2+'\\/', 'g'), contentCdnUrl
                    );
                    // 게시용: onclick 추가 + se-popup-content 제거
                    if (childPanels.length > 0) contentCdnHtml = buildInlinePopupHtml(contentCdnHtml);
                    contentCdnHtml = contentCdnHtml.replace(/<div[^>]*class="[^"]*se-popup-content[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
                    htmlFolder.file('index_cdn.html', contentCdnHtml);
                }
            }

            zip.generateAsync({ type: 'blob' }).then(content => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(content);
                a.download = `PROMO_SLICED_${Date.now()}.zip`;
                a.click();
                URL.revokeObjectURL(a.href);
                btn.classList.add('hidden');
                closeSlicerModal();
                const toastMsg = slicerCdnUrl
                    ? 'PROMO_SLICED/ + PROMO_html/ (CDN 포함) ZIP 저장 완료!'
                    : 'PROMO_SLICED/ + PROMO_html/ ZIP 저장 완료!';
                showToast(toastMsg);
            });
        }

        async function exportToJPG() {
            const sheet = getById('documentSheet'); if (!sheet) return;
            showToast('JPG 렌더링 중... 잠시만 기다려주세요.');

            setTimeout(async () => {
                let capture;
                try {
                    capture = await prepareSheetForCapture();
                    const { mw, targetScale, bgColor } = capture;

                    const toCanvasOpts2 = {
                        pixelRatio: targetScale,
                        backgroundColor: bgColor,
                        skipFonts: true,
                        useCORS: true,
                        cacheBust: false,
                        style: { transform: 'none', margin: '0', padding: '0' },
                        filter: node => {
                            if (!node.classList) return true;
                            if (node.classList.contains('resizer-handle')) return false;
                            // popup-trigger 버튼은 이미지에 자연 렌더링
                            return true;
                        }
                    };

                    // 타임아웃 포함 렌더링
                    const JPG_RENDER_TIMEOUT = 50000;
                    let rawCanvas;
                    try {
                        rawCanvas = await Promise.race([
                            htmlToImage.toCanvas(capture.sheet, toCanvasOpts2),
                            new Promise((_, rej) => setTimeout(() => rej(new Error('렌더링 시간 초과(50s)')), JPG_RENDER_TIMEOUT))
                        ]);
                    } catch(renderErr) {
                        console.warn('JPG 1차 실패, 저해상도 재시도:', renderErr.message);
                        rawCanvas = await htmlToImage.toCanvas(capture.sheet, {
                            ...toCanvasOpts2,
                            pixelRatio: Math.max((toCanvasOpts2.pixelRatio || 2) * 0.55, 0.5),
                            filter: node => {
                                if (!node.classList) return true;
                                if (node.classList.contains('resizer-handle')) return false;
                                if (node.tagName === 'IMG') { const s = node.getAttribute('src') || ''; if (s.startsWith('http')) return false; }
                                return true;
                            }
                        });
                    }
                    // 해상도 유지: 2x 이상 scale이면 그대로 사용 (다운스케일 금지)
                    // 원본 canvas가 mw보다 클 때만 목표 너비 = mw*targetScale (2x 보장)
                    const keepWidth = Math.round(mw * Math.max(targetScale, 3));
                    const finalCanvas = downscaleCanvas(rawCanvas, keepWidth);
                    const totalH = finalCanvas.height;
                    const maxH = 8000; // 분할 기준 높이
                    const ts = Date.now();

                    if (totalH <= maxH) {
                        // 짧으면 단일 파일
                        const a = document.createElement('a');
                        a.download = `PROMO_${ts}.jpg`;
                        a.href = finalCanvas.toDataURL('image/jpeg', 0.95);
                        a.click();
                        showToast('JPG 저장 완료!');
                    } else {
                        // 길면 끊어서 분할 저장
                        const parts = Math.ceil(totalH / maxH);
                        showToast(`긴 이미지 감지 — ${parts}개 파일로 분할 저장 중...`);
                        for (let i = 0; i < parts; i++) {
                            const partCanvas = document.createElement('canvas');
                            const startY = i * maxH;
                            const partH = Math.min(maxH, totalH - startY);
                            partCanvas.width = finalCanvas.width;
                            partCanvas.height = partH;
                            partCanvas.getContext('2d').drawImage(finalCanvas, 0, startY, finalCanvas.width, partH, 0, 0, finalCanvas.width, partH);
                            const a = document.createElement('a');
                            a.download = `PROMO_${ts}_${i+1}of${parts}.jpg`;
                            a.href = partCanvas.toDataURL('image/jpeg', 0.93);
                            a.click();
                            await new Promise(r => setTimeout(r, 400));
                        }
                        showToast(`JPG ${parts}개 파일 분할 저장 완료!`);
                    }

                    // 팝업 패널 이미지도 별도 JPG로 저장
                    if (childPanels && childPanels.length > 0) {
                        for (const panel of childPanels) {
                            const childArea = getById('childArea_' + panel.id);
                            if (!childArea) continue;
                            const txt = childArea.innerText.trim();
                            if (!txt || txt.includes('내용 입력')) continue;
                            // 팝업 JPG도 클론 방식 — 원본 childArea DOM 불변
                            const jpgClone = childArea.cloneNode(true);
                            jpgClone.style.cssText = 'position:fixed;top:0;left:-2000px;z-index:-9999;pointer-events:none;width:' + (childArea.offsetWidth || 640) + 'px;background:#1e2a4a;';
                            document.body.appendChild(jpgClone);
                            await convertImagesToBase64(jpgClone);
                            try {
                                const popupCanvas = await htmlToImage.toCanvas(jpgClone, {
                                    pixelRatio: 2, backgroundColor: '#1e2a4a',
                                    skipFonts: true, useCORS: true
                                });
                                const pa = document.createElement('a');
                                pa.download = `POPUP_${panel.id}_${ts}.jpg`;
                                pa.href = popupCanvas.toDataURL('image/jpeg', 0.93);
                                pa.click();
                                await new Promise(r => setTimeout(r, 300));
                            } catch(pe) { console.warn('팝업 JPG 캡처 실패:', panel.id, pe); }
                            if (jpgClone.isConnected) jpgClone.remove();
                        }
                        showToast('팝업 이미지도 저장 완료!');
                    }
                } catch (e) {
                    console.error('JPG 렌더링 실패', e);
                    showToast('렌더링 실패: ' + (e.message || '알 수 없는 오류'));
                } finally {
                    if (capture) capture.restore();
                }
            }, 100);
        }

        // 내보내기 HTML의 버튼 링크에 target="_blank" 일괄 적용
        // 팝업 트리거, 탭 버튼, 앵커(#) 링크는 제외
        function applyTargetBlankToLinks(rootEl) {
            rootEl.querySelectorAll('a[href]').forEach(a => {
                const href = a.getAttribute('href') || '';
                if (!href || href.startsWith('#') || href === 'javascript:void(0)' || href.startsWith('javascript:')) return;
                if (a.classList.contains('popup-trigger')) return;
                if (a.closest('.se-tab-nav, .se-tabs, [class*="tab-nav"], [class*="tabs"]')) return;
                if (a.getAttribute('target')) return; // 이미 target 있으면 유지
                a.setAttribute('target', '_blank');
                a.setAttribute('rel', 'noopener');
            });
        }

        // ── 미리보기 (내보내기 HTML을 레이어 팝업 iframe으로 표시) ──
        function openPreviewPopup() {
            const area = getById('contentArea');
            if (!area || !area.innerHTML.trim()) return showToast('미리볼 컨텐츠가 없습니다.');
            const hi = getById('mainHeroImg');

            // 클린 HTML 생성 (buildCleanDiv 로직 인라인)
            const d = document.createElement('div');
            d.innerHTML = area.innerHTML;
            d.querySelectorAll('.active-layer').forEach(el => el.classList.remove('active-layer'));
            d.querySelectorAll('[class=""]').forEach(el => el.removeAttribute('class'));
            d.querySelectorAll('.custom-resizer').forEach(r => {
                r.style.border = 'none'; r.style.resize = 'none'; r.style.outline = 'none';
                r.classList.remove('active-layer');
                r.querySelectorAll('.resizer-handle').forEach(h => h.remove());
                const media = r.querySelector('img, video');
                if (media) media.style.pointerEvents = 'auto';
            });
            // 영상 처리: 속성 동기화 + 포스터 생성
            d.querySelectorAll('video').forEach(v => {
                const src = v.getAttribute('src') || '';
                const origVideo = area.querySelector(`video[src="${src}"]`);
                if (origVideo) {
                    ['autoplay','loop','muted','controls','playsinline'].forEach(attr => {
                        if (origVideo.hasAttribute(attr)) v.setAttribute(attr, '');
                        else v.removeAttribute(attr);
                    });
                }
                // 포스터 이미지 생성 — 원본 video에서 현재 프레임 캡처
                if (origVideo && origVideo.videoWidth > 0 && !v.hasAttribute('poster')) {
                    try {
                        const cvs = document.createElement('canvas');
                        cvs.width = origVideo.videoWidth;
                        cvs.height = origVideo.videoHeight;
                        cvs.getContext('2d').drawImage(origVideo, 0, 0);
                        v.setAttribute('poster', cvs.toDataURL('image/jpeg', 0.85));
                    } catch(e) {}
                }
                // custom-resizer 안의 video: pointerEvents 복원
                if (v.style.pointerEvents === 'none') v.style.pointerEvents = 'auto';
            });
            d.querySelectorAll('.se-popup-content').forEach(el => el.remove());
            // 대버튼 래퍼: div에 세로 padding이 있고 자식 버튼에도 세로 padding이 있을 때만 div padding 제거
            d.querySelectorAll('.se-div').forEach(div => {
                const child = div.querySelector('a[style*="width:100%"], a[style*="width: 100%"], button[style*="width:100%"], button[style*="width: 100%"]');
                if (!child) return;
                const divPT = parseFloat(window.getComputedStyle(div).paddingTop) || 0;
                const divPB = parseFloat(window.getComputedStyle(div).paddingBottom) || 0;
                const childHasPad = child.getAttribute('style')?.match(/padding\s*:/);
                // 래퍼 div에 세로 여백이 있고 + 자식도 padding이 있을 때만 래퍼 세로 여백 제거
                if ((divPT > 8 || divPB > 8) && childHasPad) {
                    div.style.paddingTop = '0'; div.style.paddingBottom = '0';
                }
            });

            // (hero.png) 텍스트 마커 + 깨진 hero img 제거
            d.querySelectorAll('p, span, div').forEach(el => {
                const t = el.textContent.trim();
                if (/^\(hero[^)]*\)$/i.test(t)) el.remove();
            });
            d.querySelectorAll('img').forEach(img => {
                const src = img.getAttribute('src') || '';
                const alt = img.getAttribute('alt') || '';
                if ((/hero/i.test(src) || /hero/i.test(alt)) && !src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('./')) {
                    const parent = img.closest('.se-div');
                    if (parent) { parent.style.display = 'none'; parent.innerHTML = ''; }
                    else img.remove();
                }
            });
            // popup-trigger ? → +
            d.querySelectorAll('.popup-trigger[data-popup]').forEach(btn => {
                const t = btn.textContent.trim();
                if (t === '?' || t === '❓' || t === '＋') btn.textContent = '+';
            });

            // 히어로 이미지 삽입
            const heroSrc = hi?.getAttribute('src') || '';
            if (heroSrc && !heroSrc.endsWith('undefined')) {
                const heroTag = `<img src="${heroSrc}" style="width:100%;display:block;margin:0;padding:0;border:none;">`;
                const sc = d.querySelector('.se-contents');
                if (sc) {
                    const firstSeDiv = sc.querySelector(':scope > .se-div:first-child');
                    if (firstSeDiv && (parseFloat(firstSeDiv.style.fontSize) === 0 || !firstSeDiv.innerHTML.trim())) {
                        firstSeDiv.innerHTML = heroTag;
                        firstSeDiv.style.fontSize = '0'; firstSeDiv.style.lineHeight = '0';
                        firstSeDiv.style.display = 'block'; // display:none 복원
                    }
                }
            }

            // 팝업 콘텐츠 블록 추가
            let htmlStr = d.innerHTML;
            if (childPanels.length > 0) {
                childPanels.forEach(panel => {
                    const ca = getById('childArea_' + panel.id);
                    if (!ca) return;
                    const txt = ca.innerText.trim();
                    if (!txt || (txt.includes('팝업') && txt.length < 10)) return;
                    const clone = ca.cloneNode(true);
                    clone.querySelectorAll('.active-layer').forEach(el => el.classList.remove('active-layer'));
                    clone.querySelectorAll('.resizer-handle').forEach(el => el.remove());
                    htmlStr += `\n<div class="se-div se-popup-content" data-popup="${panel.id}" style="display:none;overflow:hidden;width:0;height:0;margin:0;padding:0;border:none;">${clone.innerHTML}</div>`;
                });
                htmlStr = buildInlinePopupHtml(htmlStr, {}, true); // forPreview=true: onclick 방식
            }

            // rgb() → hex 변환
            htmlStr = convertRgbToHex(htmlStr);
            htmlStr = expandHexColors(htmlStr);

            const previewScript = `<script>
document.addEventListener('click',function(e){
var a=e.target.closest('a[href]');
if(!a)return;
var h=a.getAttribute('href')||'';
// 앵커 링크(#tab01 등): iframe 내 스크롤, 외부 이동 방지
if(h.startsWith('#')){e.preventDefault();var t=document.querySelector(h);if(t)t.scrollIntoView({behavior:'smooth'});}
// javascript: href(팝업): 그대로 실행
else if(h.startsWith('javascript:')){}
// 외부 링크: 새 탭으로 열기 (iframe 탈출 방지)
else{e.preventDefault();window.open(h,'_blank');}
});
<\/script>`;
            const fullHtml = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><style>@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');body{margin:0;padding:0;display:flex;justify-content:center;background:#f1f5f9;font-family:'Pretendard',sans-serif;}img{max-width:100%;height:auto;}</style></head><body>${htmlStr}${previewScript}</body></html>`;

            // 레이어 팝업 오버레이 생성
            const overlay = document.createElement('div');
            overlay.id = '__preview_overlay__';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:700000;display:flex;align-items:center;justify-content:center;';
            overlay.addEventListener('mousedown', e => { if (e.target === overlay) overlay.remove(); });

            const container = document.createElement('div');
            container.style.cssText = 'position:relative;width:90%;max-width:900px;height:90vh;background:#ffffff;border-radius:1rem;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.5);display:flex;flex-direction:column;';

            // 헤더
            const header = document.createElement('div');
            header.style.cssText = 'padding:0.5rem 1rem;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:0.75rem;flex-shrink:0;';

            const titleSpan = document.createElement('span');
            titleSpan.style.cssText = 'font-size:0.8rem;font-weight:900;color:#4f46e5;';
            titleSpan.textContent = '미리보기';
            header.appendChild(titleSpan);

            // PC / Mobile 전환 버튼
            const viewToggle = document.createElement('div');
            viewToggle.style.cssText = 'display:flex;border:1px solid #e2e8f0;border-radius:0.5rem;overflow:hidden;';
            const btnPC = document.createElement('button');
            btnPC.textContent = '🖥 PC';
            btnPC.style.cssText = 'padding:0.25rem 0.75rem;font-size:10px;font-weight:900;border:none;cursor:pointer;background:#4f46e5;color:#ffffff;';
            const btnMobile = document.createElement('button');
            btnMobile.textContent = '📱 Mobile';
            btnMobile.style.cssText = 'padding:0.25rem 0.75rem;font-size:10px;font-weight:900;border:none;cursor:pointer;background:#ffffff;color:#64748b;';
            viewToggle.appendChild(btnPC);
            viewToggle.appendChild(btnMobile);
            header.appendChild(viewToggle);

            // 우측 여백 채우기 + 닫기 버튼
            const spacer = document.createElement('div');
            spacer.style.cssText = 'flex:1;';
            header.appendChild(spacer);

            const closeBtn = document.createElement('button');
            closeBtn.textContent = '✕';
            closeBtn.style.cssText = 'background:#f1f5f9;border:1px solid #e2e8f0;border-radius:50%;width:2rem;height:2rem;font-size:1rem;font-weight:900;color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
            closeBtn.onclick = () => overlay.remove();
            header.appendChild(closeBtn);

            // iframe
            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'flex:1;border:none;width:100%;';
            iframe.sandbox = 'allow-scripts allow-same-origin';

            // PC/Mobile 전환 로직
            const mw = parseInt(getById('pageWidthInput')?.value) || 840;
            btnPC.onclick = () => {
                container.style.maxWidth = '900px';
                container.style.width = '90%';
                iframe.style.maxWidth = '';
                btnPC.style.background = '#4f46e5'; btnPC.style.color = '#ffffff';
                btnMobile.style.background = '#ffffff'; btnMobile.style.color = '#64748b';
            };
            btnMobile.onclick = () => {
                container.style.maxWidth = '375px';
                container.style.width = '375px';
                iframe.style.maxWidth = '375px';
                btnMobile.style.background = '#4f46e5'; btnMobile.style.color = '#ffffff';
                btnPC.style.background = '#ffffff'; btnPC.style.color = '#64748b';
            };

            container.appendChild(header);
            container.appendChild(iframe);
            overlay.appendChild(container);
            document.body.appendChild(overlay);

            // iframe에 HTML 로드 — blob URL document로 생성 (영상 blob URL 접근 보장)
            const htmlBlob = new Blob([fullHtml], { type: 'text/html' });
            const htmlBlobUrl = URL.createObjectURL(htmlBlob);
            iframe.src = htmlBlobUrl;
            // overlay 제거 시 blob URL 해제
            const origRemove = overlay.remove.bind(overlay);
            overlay.remove = function() { URL.revokeObjectURL(htmlBlobUrl); origRemove(); };

            showToast('미리보기 — PC/Mobile 전환 가능');
        }

        function executeDownloadHtml() {
            const area = getById('contentArea'); if (!area) return;
            const hi   = getById('mainHeroImg');
            const cdnInput = (getById('htmlCdnUrl')?.value || '').trim();
            const cdnUrl   = cdnInput ? (cdnInput.endsWith('/') ? cdnInput : cdnInput + '/') : null;

            const spinner = getById('htmlExportSpinner');
            if (spinner) spinner.classList.remove('hidden');
            showToast('ZIP 패키징 중...');

            try {

            const zip = new JSZip();

            // 기존 HTML에서 해시 폴더명 감지 (재로드 시 동일 폴더명 유지)
            function detectExistingHash() {
                const imgs = area.querySelectorAll('img[src]');
                for (const img of imgs) {
                    const src = img.getAttribute('src') || '';
                    if (src.startsWith('data:') || src.startsWith('http') || src.startsWith('blob:')) continue;
                    const parts = src.split('/');
                    if (parts.length >= 2 && parts[0].length >= 8) return parts[0];
                }
                return null;
            }
            // currentHashFolder 없으면 감지 or 새 생성, 있으면 재사용
            if (!currentHashFolder) currentHashFolder = detectExistingHash() || generateHashString(16);
            const hashFolder = currentHashFolder;
            const imgFolder  = zip.folder(hashFolder);

            function buildCleanDiv() {
                const d = document.createElement('div');
                d.innerHTML = area.innerHTML;
                d.querySelectorAll('.active-layer').forEach(el => el.classList.remove('active-layer'));
                d.querySelectorAll('[class=""]').forEach(el => el.removeAttribute('class'));
                d.querySelectorAll('.custom-resizer').forEach(r => {
                    r.style.border  = 'none';
                    r.style.resize  = 'none';
                    r.style.outline = 'none';
                    r.classList.remove('active-layer');
                    r.querySelectorAll('.resizer-handle').forEach(h => h.remove());
                    const media = r.querySelector('img, video');
                    if (media) media.style.pointerEvents = 'auto';
                });
                // 영상: 속성 동기화 + blob→data 변환 + 포스터
                d.querySelectorAll('video').forEach(v => {
                    const src = v.getAttribute('src') || '';
                    const origVideo = area.querySelector(`video[src="${src}"]`);
                    if (origVideo) {
                        ['autoplay','loop','muted','controls','playsinline'].forEach(attr => {
                            if (origVideo.hasAttribute(attr)) v.setAttribute(attr, '');
                            else v.removeAttribute(attr);
                        });
                    }
                    if (src.startsWith('blob:')) {
                        const dataUrl = videoObjectUrlMap.get(src);
                        if (dataUrl) v.setAttribute('src', dataUrl);
                    }
                    if (origVideo && origVideo.videoWidth > 0 && !v.hasAttribute('poster')) {
                        try {
                            const cvs = document.createElement('canvas');
                            cvs.width = origVideo.videoWidth;
                            cvs.height = origVideo.videoHeight;
                            cvs.getContext('2d').drawImage(origVideo, 0, 0);
                            v.setAttribute('poster', cvs.toDataURL('image/jpeg', 0.85));
                        } catch(e) {}
                    }
                });
                // float 이미지가 컨텐츠와 섞이지 않도록 float 제거
                d.querySelectorAll('img[style*="float"]').forEach(img => {
                    img.style.float = '';
                    img.style.cssFloat = '';
                });
                // 로고 오버레이는 HTML 내보내기에 포함하지 않음
                const logoEl = d.querySelector('#heroLogoOverlay');
                if (logoEl) logoEl.remove();
                // (hero.png) 등 이미지 마커 텍스트 + 깨진 hero img 제거
                d.querySelectorAll('p, span, div').forEach(el => {
                    const t = el.textContent.trim();
                    if (/^\(hero[^)]*\)$/i.test(t)) el.remove();
                });
                d.querySelectorAll('img').forEach(img => {
                    const src = img.getAttribute('src') || '';
                    const alt = img.getAttribute('alt') || '';
                    if ((/hero/i.test(src) || /hero/i.test(alt)) && !src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('./')) {
                        const parent = img.closest('.se-div');
                        if (parent) { parent.style.display = 'none'; parent.innerHTML = ''; }
                        else img.remove();
                    }
                });
                // popup-trigger 버튼 텍스트 ? → + 통일
                d.querySelectorAll('.popup-trigger[data-popup]').forEach(btn => {
                    const t = btn.textContent.trim();
                    if (t === '?' || t === '❓' || t === '＋') btn.textContent = '+';
                });
                // se-popup-content 블록 제거 (HTML 내보내기 하단에 노출되는 문제 방지)
                d.querySelectorAll('.se-popup-content').forEach(el => el.remove());
                // popup-trigger 버튼은 유지 (buildInlinePopupHtml에서 onclick으로 변환)
                // tbl-scroll-wrap: overflow-x:auto 인라인으로 변환 (내보내기 CSS 없음)
                d.querySelectorAll('.tbl-scroll-wrap').forEach(wrap => {
                    wrap.style.overflowX = 'auto';
                    wrap.style.webkitOverflowScrolling = 'touch';
                    wrap.style.width = '100%';
                    wrap.style.display = 'block';
                });
                // tbl-fixed: min-width 인라인 보장
                d.querySelectorAll('.tbl-fixed').forEach(tbl => {
                    if (!tbl.style.minWidth) tbl.style.minWidth = '400px';
                    tbl.style.width = '100%';
                    tbl.style.borderCollapse = 'collapse';
                    tbl.style.tableLayout = 'fixed';
                });
                // tbl-responsive: width:100% 인라인 보장
                d.querySelectorAll('.tbl-responsive').forEach(tbl => {
                    tbl.style.width = '100%';
                    tbl.style.borderCollapse = 'collapse';
                });
                return d;
            }

            const heroSrc = hi?.getAttribute('src') || '';
            const imageFiles = [];

            let heroFileName = '';
            if (heroSrc && heroSrc.startsWith('data:image')) {
                const ext = heroSrc.substring('data:image/'.length, heroSrc.indexOf(';base64'));
                heroFileName = `hero.${ext}`;
                imageFiles.push({ fileName: heroFileName, b64: heroSrc.split(',')[1] });
            }

            const scanDiv = buildCleanDiv();
            let imgIdx = 1;
            const imgMap = new Map();
            scanDiv.querySelectorAll('img').forEach(img => {
                const src = img.getAttribute('src') || '';
                if (src.startsWith('data:image') && !imgMap.has(src)) {
                    const ext = src.substring('data:image/'.length, src.indexOf(';base64'));
                    const fn  = `content_img_${imgIdx++}.${ext}`;
                    imgMap.set(src, fn);
                    imageFiles.push({ fileName: fn, b64: src.split(',')[1] });
                }
            });
            // 영상(video) 스캔 — data URL + blob URL(videoObjectUrlMap) 모두 처리
            const videoMap = new Map();
            let videoIdx = 1;
            const videoFiles = [];
            const scanAllForVideo = [scanDiv];
            childPanels.forEach(panel => { const ca = getById('childArea_' + panel.id); if (ca) scanAllForVideo.push(ca); });
            scanAllForVideo.forEach(root => {
                root.querySelectorAll('video[src]').forEach(vid => {
                    const src = vid.getAttribute('src') || '';
                    // blob URL → videoObjectUrlMap에서 data URL 조회
                    const resolvedSrc = src.startsWith('blob:') ? (videoObjectUrlMap.get(src) || src) : src;
                    if (resolvedSrc.startsWith('data:video') && !videoMap.has(src)) {
                        const mime = resolvedSrc.substring('data:video/'.length, resolvedSrc.indexOf(';base64'));
                        const ext  = mime.split('+')[0] || 'mp4';
                        const fn   = `content_video_${videoIdx++}.${ext}`;
                        videoMap.set(src, fn);
                        videoFiles.push({ fileName: fn, b64: resolvedSrc.split(',')[1] });
                    }
                });
            });
            // childArea 이미지도 스캔 (팝업 내부 이미지 포함 — GIF 포함 모든 포맷)
            childPanels.forEach(panel => {
                const ca = getById('childArea_' + panel.id);
                if (!ca) return;
                ca.querySelectorAll('img[src]').forEach(img => {
                    const src = img.getAttribute('src') || '';
                    if (src.startsWith('data:image') && !imgMap.has(src)) {
                        const ext = src.substring('data:image/'.length, src.indexOf(';base64'));
                        const fn  = `content_img_${imgIdx++}.${ext}`;
                        imgMap.set(src, fn);
                        imageFiles.push({ fileName: fn, b64: src.split(',')[1] });
                    }
                });
            });

            imageFiles.forEach(f => imgFolder.file(f.fileName, f.b64, { base64: true }));
            videoFiles.forEach(f => imgFolder.file(f.fileName, f.b64, { base64: true }));

            function buildHtml(baseUrl) {
                const d = buildCleanDiv();

                d.querySelectorAll('img').forEach(img => {
                    const src = img.getAttribute('src') || '';
                    if (imgMap.has(src)) img.setAttribute('src', baseUrl + imgMap.get(src));
                });
                d.querySelectorAll('video[src]').forEach(vid => {
                    const src = vid.getAttribute('src') || '';
                    if (videoMap.has(src)) vid.setAttribute('src', baseUrl + videoMap.get(src));
                });

                let heroFinalSrc = '';
                if (heroFileName) {
                    heroFinalSrc = baseUrl + heroFileName;
                } else if (heroSrc && heroSrc !== '' && !heroSrc.endsWith('undefined')) {
                    heroFinalSrc = heroSrc;
                }
                if (heroFinalSrc) {
                    const heroTag = `<img src="${heroFinalSrc}" style="width:100%;display:block;margin:0;padding:0;border:none;">`;
                    const sc = d.querySelector('.se-contents');
                    if (sc) {
                        // 첫번째 se-div가 이미지 블록(font-size:0)인지 확인
                        const firstSeDiv = sc.querySelector(':scope > .se-div:first-child');
                        if (firstSeDiv && (firstSeDiv.style.fontSize === '0' || firstSeDiv.innerHTML.trim() === '')) {
                            firstSeDiv.innerHTML = heroTag;
                            firstSeDiv.style.fontSize = '0';
                            firstSeDiv.style.lineHeight = '0';
                        } else {
                            // 없으면 맨 앞에 새로 삽입
                            const heroDiv = document.createElement('div');
                            heroDiv.className = 'se-div';
                            heroDiv.style.cssText = 'margin:0;padding:0;font-size:0;line-height:0;display:block;width:100%;box-sizing:border-box;';
                            heroDiv.innerHTML = heroTag;
                            sc.insertBefore(heroDiv, sc.firstChild);
                        }
                    }
                }
                applyTargetBlankToLinks(d);
                // 브라우저가 변환한 rgb() → hex 복원 + 3자리 hex → 6자리 확장
                let finalHtml = d.innerHTML;
                finalHtml = convertRgbToHex(finalHtml);
                finalHtml = expandHexColors(finalHtml);
                return '<meta charset="UTF-8">\n' + finalHtml;
            }

            // 팝업 내용을 se-popup-content 블록으로 append (불러오기 시 복원용)
            // <div class="se-div"> 사용: 사이냅에디터가 class 있는 div는 보존함
            function appendPopupBlocks(html) {
                if (!childPanels.length) return html;
                let blocks = '';
                childPanels.forEach(panel => {
                    const ca = getById('childArea_' + panel.id);
                    if (!ca) return;
                    const txt = ca.innerText.trim();
                    if (!txt || (txt.includes('팝업') && txt.length < 10)) return;
                    const clone = ca.cloneNode(true);
                    clone.querySelectorAll('.active-layer').forEach(el => el.classList.remove('active-layer'));
                    clone.querySelectorAll('.resizer-handle').forEach(el => el.remove());
                    blocks += `\n<div class="se-div se-popup-content" data-popup="${panel.id}" style="display:none;overflow:hidden;width:0;height:0;margin:0;padding:0;border:none;">${clone.innerHTML}</div>`;
                });
                return html + blocks;
            }

            // ── 불러오기용 + 브라우저 확인용 (index_불러오기용.html) ──
            // se-popup-content div(데이터) + 이벤트 위임 script(팝업 기능) — 코드 중복 없음
            // 에디터 불러오기 시: script는 무시, se-popup-content에서 팝업 복원
            let localHtml = buildHtml(`./${hashFolder}/`);
            localHtml = appendPopupBlocks(localHtml);
            // popup-trigger 버튼에서 onclick 제거 (script가 처리)
            localHtml = localHtml.replace(/(<(?:button|a)[^>]*class="popup-trigger"[^>]*)\s+onclick="[^"]*"/gi, '$1');
            // 이벤트 위임 script: se-popup-content div를 데이터 소스로 팝업 표시
            if (childPanels.length > 0) {
                const _ac = (getById('accentPicker')?.value || '#7c3aed');
                localHtml += `\n<script>
(function(){
var ac='${_ac}';
document.addEventListener('click',function(e){
var btn=e.target.closest?e.target.closest('.popup-trigger[data-popup]'):null;
if(!btn){var el=e.target;while(el&&el!==document){if(el.classList&&el.classList.contains('popup-trigger')&&el.getAttribute('data-popup')){btn=el;break;}el=el.parentNode;}}
if(!btn)return;
e.preventDefault();e.stopPropagation();
var pid=btn.getAttribute('data-popup');
var lid='__popup_'+pid+'__';
var ex=document.getElementById(lid);
if(ex){ex.remove();return;}
var src=document.querySelector('.se-popup-content[data-popup="'+pid+'"]');
if(!src)return;
var _cont=document.querySelector('.se-contents')||document.querySelector('div[style*="max-width"]')||document.documentElement;
var _cr=_cont.getBoundingClientRect();
var _br=btn.getBoundingClientRect();
var d=document.createElement('div');d.id=lid;
d.style='position:fixed;top:0;left:'+Math.round(_cr.left)+'px;width:'+Math.round(_cr.width)+'px;height:100%;background:#000000B8;z-index:99999;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:1rem;box-sizing:border-box;';
var wrap=document.createElement('div');
wrap.style='position:relative;width:100%;max-width:740px;margin:0 auto;';
var box=document.createElement('div');
box.style='background:#ffffff;border-radius:0.75rem;overflow-y:auto;padding:1.5rem;max-height:80vh;font-family:Pretendard,sans-serif;line-height:1.8;box-sizing:border-box;-webkit-overflow-scrolling:touch;color:#1e293b;box-shadow:0 4px 32px #0000002e;';
box.innerHTML=src.innerHTML;
wrap.appendChild(box);
var close=document.createElement('button');close.innerHTML='\\u2715';
close.style='position:absolute;top:-0.875rem;right:-0.875rem;background:'+ac+';color:#ffffff;border:none;border-radius:50%;width:1.75rem;height:1.75rem;font-size:0.875rem;font-weight:900;cursor:pointer;z-index:10;display:inline-flex;align-items:center;justify-content:center;line-height:1;';
close.onclick=function(ev){ev.stopPropagation();d.remove();};
wrap.appendChild(close);d.appendChild(wrap);
d.addEventListener('touchstart',function(ev){if(ev.target===d)d.remove();},{passive:true});
d.onclick=function(ev){if(ev.target===d)d.remove();};
document.body.appendChild(d);
setTimeout(function(){var sy=Math.max(0,_br.top-_cr.top-60);d.scrollTop=sy;},50);
});
})();
<\/script>`;
            }
            zip.file('index_불러오기용.html', '\uFEFF' + localHtml);

            // ── 게시용 (index_cdn.html) ──
            // onclick 포함, se-popup-content 없음 → 사이냅에디터에 바로 붙이는 용도
            if (cdnUrl) {
                const cdnBaseUrl = (cdnUrl.endsWith('/') ? cdnUrl : cdnUrl + '/') + hashFolder + '/';
                let cdnHtml = buildHtml(cdnBaseUrl);
                if (childPanels.length > 0) cdnHtml = buildInlinePopupHtml(cdnHtml);
                // se-popup-content 제거 (게시용에는 불필요 — onclick에 이미 인코딩됨)
                cdnHtml = cdnHtml.replace(/<div[^>]*class="[^"]*se-popup-content[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
                zip.file('index_cdn.html', '\uFEFF' + cdnHtml);
            }

            zip.generateAsync({ type: 'blob' }).then(blob => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `PROMO_${Date.now()}.zip`;
                a.click();
                URL.revokeObjectURL(a.href);
                if (spinner) spinner.classList.add('hidden');
                closeExportHtmlModal();
                const msg = cdnUrl
                    ? 'index_불러오기용.html + index_cdn.html 두 파일이 ZIP으로 저장됐습니다!'
                    : 'index_불러오기용.html 이 ZIP으로 저장됐습니다!';
                showToast(msg);
            }).catch(err => {
                console.error('ZIP 생성 실패:', err);
                if (spinner) spinner.classList.add('hidden');
                showToast('ZIP 생성 실패: ' + (err.message || '알 수 없는 오류'));
            });
            } catch(err) {
                console.error('HTML 내보내기 오류:', err);
                if (spinner) spinner.classList.add('hidden');
                showToast('내보내기 실패: ' + (err.message || '알 수 없는 오류'));
            }
        }

        function applyDivStyle(type, value) {
            if (!activeLayer || activeLayer.tagName !== 'DIV') return;
            
            if (type === 'radius') {
                if (value == 0 || value === '') {
                    activeLayer.style.borderRadius = '';
                    activeLayer.style.borderTopLeftRadius = '';
                    activeLayer.style.borderTopRightRadius = '';
                    activeLayer.style.borderBottomLeftRadius = '';
                    activeLayer.style.borderBottomRightRadius = '';
                    activeLayer.style.overflow = '';
                } else {
                    const rv = value + 'px';
                    activeLayer.style.borderRadius = rv;
                    activeLayer.style.borderTopLeftRadius = rv;
                    activeLayer.style.borderTopRightRadius = rv;
                    activeLayer.style.borderBottomLeftRadius = rv;
                    activeLayer.style.borderBottomRightRadius = rv;
                    activeLayer.style.overflow = 'hidden';
                }
            } 
            else if (type === 'padding') {
                const pv = (value == 0 || value === '') ? '' : value + 'px';
                activeLayer.style.paddingTop    = pv;
                activeLayer.style.paddingBottom = pv;
                activeLayer.style.paddingLeft   = pv;
                activeLayer.style.paddingRight  = pv;
            } 
            else if (type === 'shadow') {
                if (value) {
                    activeLayer.style.boxShadow = '0 10px 25px #00000026';
                } else {
                    activeLayer.style.boxShadow = '';
                }
            }
            else if (type === 'bgColor') {
                if (value) {
                    activeLayer.style.backgroundColor = value;
                } else {
                    activeLayer.style.removeProperty('background-color');
                }
                const picker = getById('divBgColorInput');
                if (picker && value) picker.value = value;
            }
            recordState();
        }

        function toggleTableLayout() {
            if (!activeLayer || activeLayer.tagName !== 'TABLE') return showToast('\ud45c\ub97c \uc120\ud0dd\ud558\uc138\uc694.');
            recordState();
            const tbl = activeLayer;
            const wrap = tbl.closest('.tbl-scroll-wrap');
            const isFixed = tbl.classList.contains('tbl-fixed');
            const btn = getById('tblLayoutBtn');

            if (isFixed) {
                tbl.classList.remove('tbl-fixed');
                tbl.classList.add('tbl-responsive');
                tbl.style.removeProperty('min-width');
                if (wrap) {
                    const parent = wrap.parentNode;
                    parent.insertBefore(tbl, wrap);
                    parent.removeChild(wrap);
                }
                if (btn) btn.textContent = '\ud83d\udcf1 \ubc18\uc751\ud615';
                showToast('\ubc18\uc751\ud615 \ubaa8\ub4dc\ub85c \uc804\ud658\ub410\uc2b5\ub2c8\ub2e4.');
            } else {
                tbl.classList.remove('tbl-responsive');
                tbl.classList.add('tbl-fixed');
                tbl.style.minWidth = '400px';
                if (!tbl.closest('.tbl-scroll-wrap')) {
                    const newWrap = document.createElement('div');
                    newWrap.className = 'tbl-scroll-wrap';
                    newWrap.style.cssText = 'width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;display:block;';
                    tbl.parentNode.insertBefore(newWrap, tbl);
                    newWrap.appendChild(tbl);
                }
                if (btn) btn.textContent = '\ud83d\udda5 \uace0\uc815\ud3ed';
                showToast('\uace0\uc815\ud3ed \ubaa8\ub4dc\ub85c \uc804\ud658\ub410\uc2b5\ub2c8\ub2e4 (\uac00\ub85c \uc2a4\ud06c\ub864 \uc790\ub3d9).');
            }
            recordState();
        }

        function showTableFloatToolbar(tableEl, cellEl) {
            const tb = getById('tableFloatToolbar');
            if (!tb || !tableEl) return;

            const infoEl = getById('tableSelInfo');
            if (infoEl) {
                const rows = tableEl.rows.length;
                const cols = tableEl.rows[0] ? tableEl.rows[0].cells.length : 0;
                const selCount = selectedCells.length;
                infoEl.textContent = selCount > 1 ? `${selCount}\uc140` : `${rows}\u00d7${cols}`;
            }
            // 나누기 버튼: 병합된 셀 선택 시만 표시
            const splitBtn = getById('tblSplitBtn');
            if (splitBtn) {
                const hasColspan = cellEl && parseInt(cellEl.getAttribute('colspan') || '1') > 1;
                const hasRowspan = cellEl && parseInt(cellEl.getAttribute('rowspan') || '1') > 1;
                splitBtn.style.display = (hasColspan || hasRowspan) ? 'inline-block' : 'none';
            }
            const layoutBtn = getById('tblLayoutBtn');
            if (layoutBtn) {
                layoutBtn.textContent = tableEl.classList.contains('tbl-fixed') ? '\ud83d\udda5 \uace0\uc815\ud3ed' : '\ud83d\udcf1 \ubc18\uc751\ud615';
            }

            tb.style.display = 'flex';
            tb.style.left = '-9999px';
            tb.style.top  = '-9999px';

            requestAnimationFrame(() => {
                const targets = selectedCells.length > 0 ? selectedCells : (cellEl ? [cellEl] : []);
                let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;

                if (targets.length > 0) {
                    targets.forEach(cell => {
                        const r = cell.getBoundingClientRect();
                        if (r.left   < minLeft)   minLeft   = r.left;
                        if (r.top    < minTop)     minTop    = r.top;
                        if (r.right  > maxRight)   maxRight  = r.right;
                        if (r.bottom > maxBottom)  maxBottom = r.bottom;
                    });
                } else {
                    const r = tableEl.getBoundingClientRect();
                    minLeft = r.left; minTop = r.top; maxRight = r.right; maxBottom = r.bottom;
                }

                const centerX = (minLeft + maxRight)  / 2;
                const tbW = tb.offsetWidth  || 340;
                const tbH = tb.offsetHeight || 42;

                let left = centerX - tbW / 2;
                let top  = minTop - tbH - 10;

                if (left < 6) left = 6;
                if (left + tbW > window.innerWidth - 6) left = window.innerWidth - tbW - 6;
                if (top  < 6) top  = maxBottom + 10;

                tb.style.left = left + 'px';
                tb.style.top  = top  + 'px';
            });
        }

        function hideTableFloatToolbar() {
            const tb = getById('tableFloatToolbar');
            if (tb) tb.style.display = 'none';
        }

        function updateTableSelInfo() {
            const infoEl = getById('tableSelInfo');
            if (!infoEl) return;
            if (selectedCells.length > 1) {
                infoEl.textContent = selectedCells.length + '\uc140';
            } else if (activeLayer && activeLayer.tagName === 'TABLE') {
                const rows = activeLayer.rows.length;
                const cols = activeLayer.rows[0] ? activeLayer.rows[0].cells.length : 0;
                infoEl.textContent = rows + '\u00d7' + cols;
            }
        }

        let currentImgMode = 'resize';

        function showImgFloatToolbar(el) {
            const tb = getById('imgFloatToolbar');
            if (!tb || !el) return;

            const isResizer = el.classList && el.classList.contains('custom-resizer');
            const isBareImg = el.tagName === 'IMG' || el.tagName === 'VIDEO'; // 래퍼 없는 bare img/video
            const computed = window.getComputedStyle(el);
            const display = computed.display;
            const w = parseInt(computed.width) || 0;
            const pageW = parseInt(getById('pageWidthInput')?.value || 840);

            if (display === 'block' && w >= pageW * 0.92) {
                currentImgMode = 'block';
            } else if (isResizer) {
                currentImgMode = 'resize';
            } else if (isBareImg) {
                // 래퍼 없는 img: display:block → block, 나머지 → inline
                currentImgMode = (display === 'block') ? 'block' : 'inline';
            } else if (display === 'inline-block' || display === 'inline') {
                currentImgMode = 'inline';
            } else {
                currentImgMode = 'resize';
            }

            updateImgModeButtons();

            tb.style.display = 'flex';
            tb.style.left = '-9999px';
            tb.style.top = '-9999px';

            requestAnimationFrame(() => {
                const rect = el.getBoundingClientRect();
                const tbW = tb.offsetWidth || 300;
                const tbH = tb.offsetHeight || 38;

                const imgCenterX = rect.left + rect.width / 2;
                let left = imgCenterX - tbW / 2;
                let top = rect.top - tbH - 10;

                if (left < 6) left = 6;
                if (left + tbW > window.innerWidth - 6) left = window.innerWidth - tbW - 6;
                if (top < 6) top = rect.bottom + 10;

                tb.style.left = left + 'px';
                tb.style.top  = top  + 'px';

                updateImgSizeLabel(el);
                // 너비 입력 인풋 동기화
                const wInp = getById('imgWidthInput');
                if (wInp) wInp.value = Math.round(rect.width) || '';
                // 영상이면 옵션 툴바 표시
                const _videoEl = el.tagName === 'VIDEO' ? el : el.querySelector?.('video');
                if (_videoEl) showVideoOptToolbar(el);
                else hideVideoOptToolbar();
            });
        }

        function hideImgFloatToolbar() {
            const tb = getById('imgFloatToolbar');
            if (tb) tb.style.display = 'none';
            hideVideoOptToolbar();
        }

        // ── 영상 옵션 툴바 ──
        let _lastVideoRef = null; // 영상 옵션 바용 — activeLayer 해제 시에도 참조 유지
        function getActiveVideo() {
            if (activeLayer) {
                if (activeLayer.tagName === 'VIDEO') { _lastVideoRef = activeLayer; return activeLayer; }
                const v = activeLayer.querySelector?.('video');
                if (v) { _lastVideoRef = v; return v; }
            }
            // fallback: activeLayer가 풀렸어도 마지막 참조된 video가 DOM에 있으면 사용
            if (_lastVideoRef && _lastVideoRef.isConnected) return _lastVideoRef;
            return null;
        }
        function showVideoOptToolbar(el) {
            const tb = getById('videoOptToolbar');
            if (!tb) return;
            const video = el.tagName === 'VIDEO' ? el : el.querySelector?.('video');
            if (!video) { tb.style.display = 'none'; return; }
            _lastVideoRef = video; // fallback 참조 저장
            // 상태 동기화
            ['autoplay','loop','muted','controls'].forEach(attr => {
                const btn = getById('vOpt' + attr.charAt(0).toUpperCase() + attr.slice(1));
                if (btn) btn.classList.toggle('vopt-on', video.hasAttribute(attr));
            });
            tb.style.display = 'flex';
            // 위치: imgFloatToolbar 바로 아래
            requestAnimationFrame(() => {
                const imgTb = getById('imgFloatToolbar');
                if (imgTb && imgTb.style.display !== 'none') {
                    const r = imgTb.getBoundingClientRect();
                    tb.style.left = r.left + 'px';
                    tb.style.top = (r.bottom + 4) + 'px';
                } else {
                    const r2 = el.getBoundingClientRect();
                    tb.style.left = r2.left + 'px';
                    tb.style.top = (r2.bottom + 4) + 'px';
                }
            });
        }
        function hideVideoOptToolbar() {
            const tb = getById('videoOptToolbar');
            if (tb) tb.style.display = 'none';
        }
        function toggleVideoAttr(attr) {
            const video = getActiveVideo();
            if (!video) return;
            // 속성 토글
            if (video.hasAttribute(attr)) {
                video.removeAttribute(attr);
                if (attr === 'muted') video.muted = false;
                if (attr === 'autoplay') { video.pause(); }
                if (attr === 'loop') video.loop = false;
                if (attr === 'controls') video.controls = false;
            } else {
                video.setAttribute(attr, '');
                if (attr === 'muted') video.muted = true;
                if (attr === 'autoplay') { video.autoplay = true; video.play().catch(()=>{}); }
                if (attr === 'loop') video.loop = true;
                if (attr === 'controls') video.controls = true;
            }
            // 버튼 상태 갱신
            const btn = getById('vOpt' + attr.charAt(0).toUpperCase() + attr.slice(1));
            if (btn) btn.classList.toggle('vopt-on', video.hasAttribute(attr));
            // 툴바 유지 — activeLayer가 살아있으면 위치 재조정
            if (activeLayer) {
                showImgFloatToolbar(activeLayer);
            }
        }

        // 영상 옵션 버튼 이벤트 바인딩 (app.js 로드 후 실행되므로 toggleVideoAttr 사용 가능)
        ['autoplay','loop','muted','controls'].forEach(attr => {
            const id = 'vOpt' + attr.charAt(0).toUpperCase() + attr.slice(1);
            const btn = getById(id);
            if (!btn) return;
            btn.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); });
            btn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); toggleVideoAttr(attr); });
        });

        function updateImgModeButtons() {
            ['inline','block','resize'].forEach(mode => {
                const btn = getById(`imgBtn${mode.charAt(0).toUpperCase() + mode.slice(1)}`);
                if (btn) btn.classList.toggle('img-mode-active', mode === currentImgMode);
            });
        }

        function updateImgSizeLabel(el) {
            const label = getById('imgSizeLabel');
            if (!label) return;
            const rect = el.getBoundingClientRect();
            label.textContent = `${Math.round(rect.width)} \u00d7 ${Math.round(rect.height)}`;
        }

        function wrapImgInResizer(img, force = false) {
            if (img.closest('.custom-resizer')) return img.closest('.custom-resizer');
            // td/th 셀 또는 childArea 안 이미지는 기본적으로 래퍼 없이 반환 (inline 취급)
            // 단, force=true이면 사용자가 명시적으로 리사이즈 핸들을 요청한 것 → 래퍼 허용
            if (!force && (img.closest('td, th') || img.closest('[id^="childArea_"]'))) return img;
            const wrap = document.createElement('div');
            wrap.className = 'custom-resizer';
            wrap.style.cssText = 'display: inline-block; position: relative; max-width: 100%; vertical-align: middle; min-width: 50px; min-height: 50px; user-select: none;';

            const containerW = img.closest('#contentArea')?.offsetWidth || 840;
            const isVideo = img.tagName === 'VIDEO';
            const natW = isVideo ? (img.videoWidth || 0) : (img.naturalWidth || 0);
            const natH = isVideo ? (img.videoHeight || 0) : (img.naturalHeight || 0);
            // getBoundingClientRect()로 실제 렌더링된 크기 사용 (CSS 제약 포함)
            const rect = img.getBoundingClientRect();
            const rendW = Math.round(rect.width) || img.offsetWidth || 0;
            const rendH = Math.round(rect.height) || img.offsetHeight || 0;
            // 렌더링 크기가 자연 크기보다 작거나 같으면 렌더링 크기 사용 (이미지 확대 방지)
            const useW = (rendW > 0 && (natW === 0 || rendW <= natW)) ? rendW : (natW || 300);
            const useH = (rendH > 0 && (natH === 0 || rendH <= natH)) ? rendH : natH;

            if (useW > 0 && useW <= containerW) {
                wrap.style.width = useW + 'px';
                if (useH > 0) wrap.style.height = useH + 'px';
                img.style.width  = '100%';
                img.style.height = '100%';
                img.style.maxWidth = '100%';
            } else {
                wrap.style.width = '100%';
                img.style.width = '100%';
                img.style.height = 'auto';
                img.style.maxWidth = '100%';
            }
            if (!isVideo) { img.style.objectFit = ''; img.style.imageRendering = ''; }
            img.style.pointerEvents = 'none';
            if (!isVideo) img.classList.remove('img-selected');

            img.parentNode.insertBefore(wrap, img);
            wrap.appendChild(img);
            addResizerHandles(wrap);
            return wrap;
        }

        // 플로팅 툴바 너비 입력 → 비율 유지하며 크기 적용
        function applyImgWidth() {
            const input = getById('imgWidthInput');
            if (!input || !activeLayer) return;
            const newW = parseInt(input.value);
            if (!newW || newW < 10) return;
            recordState();
            const isResizer = activeLayer.classList && activeLayer.classList.contains('custom-resizer');
            const targetImg = activeLayer.tagName === 'IMG' ? activeLayer : activeLayer.tagName === 'VIDEO' ? activeLayer : activeLayer.querySelector('img, video');
            if (isResizer) {
                // 자연 이미지/영상 비율 우선
                const _n = targetImg;
                const _natW = _n ? (_n.naturalWidth || _n.videoWidth || 0) : 0;
                const _natH = _n ? (_n.naturalHeight || _n.videoHeight || 0) : 0;
                const ratio = (_natW > 0) ? _natH / _natW
                            : (activeLayer.offsetHeight / Math.max(activeLayer.offsetWidth, 1));
                const newH = Math.round(newW * ratio);
                activeLayer.style.width  = newW + 'px';
                activeLayer.style.height = newH + 'px';
                if (targetImg) { targetImg.style.width = '100%'; targetImg.style.height = '100%'; }
            } else if (targetImg) {
                const ratio = targetImg.naturalHeight / Math.max(targetImg.naturalWidth, 1);
                const newH  = Math.round(newW * ratio);
                targetImg.style.width  = newW + 'px';
                targetImg.style.height = newH > 0 ? newH + 'px' : 'auto';
            }
            updateImgSizeLabel(activeLayer);
            recordState();
        }

        function setImgStyle(type) {
            if(!activeLayer) return;
            const isResizer = activeLayer.classList && activeLayer.classList.contains('custom-resizer');
            let targetImg = activeLayer.tagName === 'IMG' ? activeLayer : activeLayer.tagName === 'VIDEO' ? activeLayer : activeLayer.querySelector('img, video');
            if (!targetImg) return;
            const _isVid = targetImg.tagName === 'VIDEO';

            recordState();
            currentImgMode = type;
            updateImgModeButtons();

            if (type === 'inline') {
                if (isResizer) {
                    activeLayer.style.display = 'inline-block';
                    activeLayer.style.width = activeLayer.style.width || (targetImg.offsetWidth + 'px');
                } else {
                    targetImg.style.display = 'inline-block';
                    targetImg.style.width = 'auto';
                    targetImg.style.maxWidth = '100%';
                }
                showToast(_isVid ? "영상을 글자처럼 인라인 배치합니다." : "이미지를 글자처럼 인라인 배치합니다.");
            }
            else if (type === 'block') {
                if (isResizer) {
                    // resizer에서 반응형: 고정 너비/높이 초기화 후 100% 설정
                    activeLayer.style.display = 'block';
                    activeLayer.style.width = '100%';
                    activeLayer.style.height = '';      // 고정 높이 완전 제거
                    activeLayer.style.maxWidth = '100%';
                    activeLayer.style.minWidth = '';
                    targetImg.style.display = 'block';
                    targetImg.style.width = '100%';
                    targetImg.style.height = 'auto';
                    targetImg.style.maxWidth = '100%';
                    if (!_isVid) targetImg.style.objectFit = '';
                } else {
                    targetImg.style.display = 'block';
                    targetImg.style.width = '100%';
                    targetImg.style.height = 'auto';
                    targetImg.style.maxWidth = '100%';
                    targetImg.style.margin = '0 auto';
                }
                showToast(_isVid ? "영상을 100% 반응형으로 배치합니다." : "이미지를 100% 반응형으로 배치합니다.");
            }
            else if (type === 'resize') {
                if (!isResizer) {
                    // force=true: td/th·childArea 이미지도 사용자 요청 시 핸들 래퍼 적용
                    const wrap = wrapImgInResizer(targetImg, true);
                    if (wrap !== targetImg) {
                        // 실제로 래퍼가 생성된 경우 — activeLayer 교체
                        wrap.classList.add('active-layer');
                        if (activeLayer !== wrap) activeLayer.classList.remove('active-layer');
                        activeLayer = wrap;
                    } else {
                        // 래퍼 생성 불가(예외 케이스) — 현재 img 유지
                        targetImg.classList.add('active-layer');
                        activeLayer = targetImg;
                    }
                } else {
                    activeLayer.style.display = 'inline-block';
                }
                showToast("모서리 핸들을 드래그해 크기를 조절하세요.");
            }

            updateImgSizeLabel(activeLayer);
            recordState();
        }

        function copyActiveLayer() {
            // 텍스트 선택 상태면 시스템 복사
            const sel = window.getSelection();
            const selText = sel ? sel.toString().trim() : '';
            if (selText) {
                try { document.execCommand('copy'); } catch(e) {}
                showToast('텍스트 복사됨');
                return;
            }
            if (!activeLayer) return showToast("복사할 블록을 에디터에서 클릭하세요.");
            // HTML 클립보드에 저장 (div 전체 구조 보존)
            const clone = activeLayer.cloneNode(true);
            clone.classList.remove('active-layer');
            clone.querySelectorAll('.resizer-handle').forEach(h => h.remove());
            setBlockClipboard(clone.outerHTML); // blockPasteBtn도 같이 활성화
            refreshPasteBtn();
            // 시스템 클립보드에도 텍스트 복사 (fallback)
            try {
                activeLayer.classList.remove('active-layer');
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNode(activeLayer);
                sel.removeAllRanges();
                sel.addRange(range);
                document.execCommand('copy');
                activeLayer.classList.add('active-layer');
            } catch(e) {}
            showToast("블록 복사됨 — 붙여넣기 버튼으로 삽입하세요");
        }

        function deleteActiveLayer() {
            // 텍스트 선택 상태면 선택 텍스트 삭제
            const sel = window.getSelection();
            const selText = sel ? sel.toString().trim() : '';
            if (selText) {
                recordState();
                document.execCommand('delete');
                recordState();
                showToast('텍스트 삭제됨');
                return;
            }
            if (!activeLayer) return showToast("삭제할 요소를 에디터에서 클릭하세요.");
            // se-contents 또는 contentArea 직계 최상위는 삭제 금지
            const area = getById('contentArea');
            if (activeLayer.classList.contains('se-contents')) return showToast("최상위 컨테이너는 삭제할 수 없습니다.");
            if (activeLayer.parentElement === area && area.querySelectorAll(':scope > *').length <= 1) {
                return showToast("마지막 섹션은 삭제할 수 없습니다.");
            }
            recordState();
            if (activeLayer.tagName === 'IMG' && activeLayer.closest('td, th')) {
                const parentTd = activeLayer.closest('td, th');
                activeLayer.remove();
                activeLayer = null;
                hideAllTools();
                hideImgFloatToolbar();
                lastActiveCell = parentTd;
                recordState();
                showToast("이미지가 삭제되었습니다.");
                return;
            }
            activeLayer.remove();
            activeLayer = null;
            hideAllTools();
            recordState();
            showToast("선택된 요소가 삭제되었습니다.");
        }

        let imgClipboard = null;

        function refreshPasteBtn() {
            const btn = getById('imgBtnPaste');
            if (!btn) return;
            if (imgClipboard) {
                btn.style.opacity = '1';
                btn.style.pointerEvents = 'auto';
            } else {
                btn.style.opacity = '0.35';
                btn.style.pointerEvents = 'none';
            }
        }

        function imgCopyAction() {
            if (!activeLayer) return showToast("\uc774\ubbf8\uc9c0\ub97c \uba3c\uc800 \uc120\ud0dd\ud558\uc138\uc694.");
            const isResizer = activeLayer.classList.contains('custom-resizer');
            if (!isResizer && activeLayer.tagName !== 'IMG') return showToast("\uc774\ubbf8\uc9c0\ub97c \uba3c\uc800 \uc120\ud0dd\ud558\uc138\uc694.");
            cloneToClipboard();
            showToast("\uc774\ubbf8\uc9c0\uac00 \ubcf5\uc0ac\ub418\uc5c8\uc2b5\ub2c8\ub2e4. (Ctrl+V \ub610\ub294 \ubd99\uc5ec\ub123\uae30 \ubc84\ud2bc\uc73c\ub85c \ubd99\uc5ec\ub123\uc73c\uc138\uc694)");
        }

        function imgCutAction() {
            if (!activeLayer) return showToast("\uc774\ubbf8\uc9c0\ub97c \uba3c\uc800 \uc120\ud0dd\ud558\uc138\uc694.");
            const isResizer = activeLayer.classList.contains('custom-resizer');
            if (!isResizer && activeLayer.tagName !== 'IMG') return showToast("\uc774\ubbf8\uc9c0\ub97c \uba3c\uc800 \uc120\ud0dd\ud558\uc138\uc694.");
            cloneToClipboard();
            recordState();
            activeLayer.remove();
            activeLayer = null;
            hideImgFloatToolbar();
            getById('imgTools').style.display = 'none';
            recordState();
            showToast("\uc774\ubbf8\uc9c0\ub97c \uc798\ub77c\ub0c8\uc2b5\ub2c8\ub2e4. \ubd99\uc5ec\ub123\uc744 \uc704\uce58\ub97c \ud074\ub9ad \ud6c4 Ctrl+V \ud558\uc138\uc694.");
        }

        function imgPasteAction() {
            if (!imgClipboard) return showToast("복사하거나 잘라낸 이미지가 없습니다.");
            const area = getById('contentArea');
            if (!area) return;

            recordState();
            area.focus();

            if (savedRange && area.contains(savedRange.commonAncestorContainer)) {
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(savedRange);
                document.execCommand('insertHTML', false, imgClipboard.outerHTML);
            } else {
                area.insertAdjacentHTML('beforeend', imgClipboard.outerHTML);
            }

            const allResizers = area.querySelectorAll('.custom-resizer');
            const lastResizer = allResizers[allResizers.length - 1];
            if (lastResizer && lastResizer.querySelectorAll('.resizer-handle').length === 0) {
                addResizerHandles(lastResizer);
                if (activeLayer) activeLayer.classList.remove('active-layer');
                activeLayer = lastResizer;
                activeLayer.classList.add('active-layer');
                getById('imgTools').style.display = 'flex';
                showImgFloatToolbar(activeLayer);
            }

            recordState();
            showToast("\uc774\ubbf8\uc9c0\ub97c \ubd99\uc5ec\ub123\uc5c8\uc2b5\ub2c8\ub2e4.");
        }

        function recordState() {
            const area = getById('contentArea');
            if(!area) return;
            const currentState = area.innerHTML;
            if (historyIdx < historyStack.length - 1) {
                historyStack = historyStack.slice(0, historyIdx + 1);
            }
            historyStack.push(currentState);
            if (historyStack.length > 20) {
                historyStack.shift();
            }
            historyIdx = historyStack.length - 1;
        }

        function undoAction() {
            // 타이핑 타이머가 pending 중이면 flush: 현재 상태를 스택에 먼저 기록
            if (typingTimer) {
                clearTimeout(typingTimer);
                typingTimer = null;
                const _area = getById('contentArea');
                if (_area) {
                    const cur = _area.innerHTML;
                    if (historyStack.length === 0 || historyStack[historyIdx] !== cur) {
                        if (historyIdx < historyStack.length - 1) historyStack = historyStack.slice(0, historyIdx + 1);
                        historyStack.push(cur);
                        if (historyStack.length > 20) historyStack.shift();
                        historyIdx = historyStack.length - 1;
                    }
                }
            }
            if (historyIdx > 0) {
                historyIdx--;
                const area = getById('contentArea');
                area.innerHTML = historyStack[historyIdx];
                clearActiveLayer();
                hideAllTools();
                showToast('↩ 되돌리기 (' + historyIdx + '/' + (historyStack.length-1) + ')');
            } else {
                showToast('↩ 더 이상 되돌릴 수 없습니다.');
            }
        }

        function redoAction() {
            // 타이핑 타이머가 pending 중이면 flush: 현재 상태를 스택에 먼저 기록
            if (typingTimer) {
                clearTimeout(typingTimer);
                typingTimer = null;
                const _area = getById('contentArea');
                if (_area) {
                    const cur = _area.innerHTML;
                    if (historyStack.length === 0 || historyStack[historyIdx] !== cur) {
                        if (historyIdx < historyStack.length - 1) historyStack = historyStack.slice(0, historyIdx + 1);
                        historyStack.push(cur);
                        if (historyStack.length > 20) historyStack.shift();
                        historyIdx = historyStack.length - 1;
                    }
                }
            }
            if (historyIdx < historyStack.length - 1) {
                historyIdx++;
                const area = getById('contentArea');
                area.innerHTML = historyStack[historyIdx];
                hideAllTools();
                showToast('↪ 다시 실행 (' + historyIdx + '/' + (historyStack.length-1) + ')');
            }
        }

        function showTableInsertMenu(e) {
            e.stopPropagation();
            const menu = getById('tableInsertMenu');
            if (!menu) return;
            const btn = e.currentTarget;
            const rect = btn.getBoundingClientRect();
            menu.style.position = 'fixed';
            menu.style.top  = (rect.bottom + 4) + 'px';
            menu.style.left = rect.left + 'px';
            menu.classList.toggle('hidden');
            const close = () => { menu.classList.add('hidden'); document.removeEventListener('click', close); };
            setTimeout(() => document.addEventListener('click', close), 0);
        }

        function insertTable(mode) {
            const menu = getById('tableInsertMenu');
            if (menu) menu.classList.add('hidden');

            recordState();
            const bg = getById('bgPicker')?.value || '#1e293b';
            const rv=parseInt(bg.slice(1,3),16)||30, gv=parseInt(bg.slice(3,5),16)||41, bv=parseInt(bg.slice(5,7),16)||59;
            const isDark = isDarkColor(bg);
            // AI가 결정한 accent 색 우선 사용, 없으면 bgColor 기반 자동 계산
            const accent = getById('accentPicker')?.value ||
                ((bv>rv&&bv>gv&&isDark) ? '#00d4ff' : (isDark ? '#ffd700' : '#4f46e5'));
            const headerBg = blendHex(bg, accent, 0.12);
            const borderClr = blendHex(bg, accent, 0.25);
            const textClr = isDark ? '#f0f0f0' : '#1a1a2e';

            const cellStyle = `border:1px solid ${borderClr}; padding:0.875rem 1rem; color:${textClr}; font-size:clamp(0.875rem,1.5vw,1rem); line-height:1.8; word-break:keep-all;`;
            const thStyle   = `border:1px solid ${borderClr}; padding:0.875rem 1rem; background-color:${headerBg}; color:${accent}; font-weight:700; font-size:clamp(0.8125rem,1.4vw,0.9375rem); line-height:1.6; letter-spacing:0.03em; word-break:keep-all;`;

            const tableClass = mode === 'fixed' ? 'tbl-fixed' : 'tbl-responsive';
            const tableStyle = mode === 'fixed'
                ? `width:100%; border-collapse:collapse; table-layout:fixed; min-width:400px;`
                : `width:100%; border-collapse:collapse;`;

            const tableHTML = `<table class="${tableClass}" style="${tableStyle}">
                <thead><tr>
                    <th contenteditable="true" style="${thStyle}">\ud5e4\ub3541</th>
                    <th contenteditable="true" style="${thStyle}">\ud5e4\ub3542</th>
                    <th contenteditable="true" style="${thStyle}">\ud5e4\ub3543</th>
                </tr></thead>
                <tbody>
                    <tr>
                        <td contenteditable="true" style="${cellStyle}">\ub0b4\uc6a9</td>
                        <td contenteditable="true" style="${cellStyle}">\ub0b4\uc6a9</td>
                        <td contenteditable="true" style="${cellStyle}">\ub0b4\uc6a9</td>
                    </tr>
                    <tr>
                        <td contenteditable="true" style="${cellStyle}">\ub0b4\uc6a9</td>
                        <td contenteditable="true" style="${cellStyle}">\ub0b4\uc6a9</td>
                        <td contenteditable="true" style="${cellStyle}">\ub0b4\uc6a9</td>
                    </tr>
                </tbody>
            </table>`;

            const wrapped = mode === 'fixed'
                ? `<div class="tbl-scroll-wrap" style="width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;display:block;">${tableHTML}</div>`
                : tableHTML;

            document.execCommand('insertHTML', false, wrapped);
            recordState();
            showToast(mode === 'fixed' ? '\uace0\uc815\ud3ed \ud14c\uc774\ube14 \uc0bd\uc785 (\uac00\ub85c \uc2a4\ud06c\ub864 \uc790\ub3d9)' : '\ubc18\uc751\ud615 \ud14c\uc774\ube14 \uc0bd\uc785');
        }

        function insertLink() {
            const area = getById('contentArea');
            const selection = window.getSelection();
            const selectedText = selection ? selection.toString().trim() : '';

            // prompt 전에 range clone — prompt가 포커스를 빼앗으면 range가 사라짐
            const savedRangeClone = savedRange ? savedRange.cloneRange() : null;

            const url = prompt("\uc5f0\uacb0\ud560 URL\uc744 \uc785\ub825\ud558\uc138\uc694:", "https://");
            if (!url || url === "https://") return;

            recordState();
            area.focus();

            if (savedRangeClone) {
                try {
                    selection.removeAllRanges();
                    selection.addRange(savedRangeClone);
                } catch(e) {}
            }

            if (selectedText) {
                document.execCommand('createLink', false, url);
                const links = area.querySelectorAll(`a[href="${CSS.escape ? CSS.escape(url) : url}"]`);
                links.forEach(a => { a.target = '_blank'; a.style.color = 'inherit'; a.style.textDecoration = 'underline'; a.style.cursor = 'pointer'; });
            } else {
                const displayText = prompt("\ub9c1\ud06c\ub85c \ud45c\uc2dc\ud560 \ud14d\uc2a4\ud2b8\ub97c \uc785\ub825\ud558\uc138\uc694:", url) || url;
                const safe = displayText.replace(/</g,'&lt;').replace(/>/g,'&gt;');
                const linkHTML = `<a href="${url.replace(/"/g,'&quot;')}" target="_blank" style="color:inherit;text-decoration:underline;cursor:pointer;">${safe}</a>`;
                document.execCommand('insertHTML', false, linkHTML);
            }

            recordState();
            showToast("\ub9c1\ud06c\uac00 \uc124\uc815\ub418\uc5c8\uc2b5\ub2c8\ub2e4.");
        }

        function addTableRow() {
            const c = lastActiveCell || (selectedCells.length > 0 ? selectedCells[0] : null);
            if (!c) return showToast("\ud45c \ub0b4\ubd80\ub97c \uc120\ud0dd\ud558\uc138\uc694.");
            recordState();
            const r = c.parentElement;
            const nr = document.createElement('tr');
            Array.from(r.cells).forEach(old => nr.appendChild(cloneEmptyCell(old)));
            r.after(nr);
            recordState();
        }

        function deleteTableRow() {
            const cells = selectedCells.length > 0 ? selectedCells : [lastActiveCell];
            const rowsToDelete = new Set();
            cells.forEach(c => { if(c && c.parentElement) rowsToDelete.add(c.parentElement); });
            rowsToDelete.forEach(r => { if(r.parentElement && r.parentElement.rows.length > 1) r.remove(); });
            clearSelection();
        }

        function addTableCol() {
            const c = lastActiveCell || (selectedCells.length > 0 ? selectedCells[0] : null);
            if (!c) return showToast("\ud45c \ub0b4\ubd80\ub97c \uc120\ud0dd\ud558\uc138\uc694.");
            recordState();
            const t = c.closest('table'); const idx = c.cellIndex;
            Array.from(t.rows).forEach(r => {
                const old = r.cells[idx];
                if (old) {
                    const nc = cloneEmptyCell(old);
                    old.nextSibling ? r.insertBefore(nc, old.nextSibling) : r.appendChild(nc);
                }
            });
            recordState();
        }

        function deleteTableCol() {
            const cells = selectedCells.length > 0 ? selectedCells : [lastActiveCell];
            const colIndices = new Set();
            let table = null;
            cells.forEach(c => { if(c) { colIndices.add(c.cellIndex); table = c.closest('table'); } });
            if (!table) return;
            const sortedIndices = Array.from(colIndices).sort((a, b) => b - a);
            sortedIndices.forEach(idx => {
                if (table.rows[0].cells.length > 1) {
                    Array.from(table.rows).forEach(r => { if(r.cells[idx]) r.deleteCell(idx); });
                }
            });
            clearSelection();
        }

        function smartDeleteAction(type = 'row') {
            if (selectedCells.length === 0) return showToast("\ucc98\ub9ac\ud560 \uc601\uc5ed\uc744 \ub4dc\ub798\uadf8\ud558\uc5ec \uc120\ud0dd\ud558\uc138\uc694.");
            recordState();
            let hasText = false;
            selectedCells.forEach(td => { if(td.innerText.trim().length > 0) hasText = true; });

            if (hasText) {
                selectedCells.forEach(td => td.innerHTML = '&nbsp;');
                showToast("\ud14d\uc2a4\ud2b8\uac00 \uc81c\uac70\ub418\uc5c8\uc2b5\ub2c8\ub2e4.");
            } else {
                if (type === 'row') deleteTableRow();
                else deleteTableCol();
                showToast(type === 'row' ? "\ud589\uc774 \uc0ad\uc81c\ub418\uc5c8\uc2b5\ub2c8\ub2e4." : "\uc5f4\uc774 \uc0ad\uc81c\ub418\uc5c8\uc2b5\ub2c8\ub2e4.");
            }
            recordState();
        }

        function mergeSelectedCells() {
            if (selectedCells.length < 2) return showToast("\uc601\uc5ed\uc744 \ub4dc\ub798\uadf8\ud558\uc138\uc694.");
            recordState();
            const table = selectedCells[0].closest('table'); const rows = Array.from(table.rows);
            let minR = 999, maxR = -1, minC = 999, maxC = -1;
            selectedCells.forEach(td => {
                const r = td.parentElement.rowIndex; const c = td.cellIndex;
                minR = Math.min(minR, r); maxR = Math.max(maxR, r);
                minC = Math.min(minC, c); maxC = Math.max(maxC, c);
            });
            const main = rows[minR].cells[minC];
            main.setAttribute('rowspan', (maxR - minR) + 1);
            main.setAttribute('colspan', (maxC - minC) + 1);
            selectedCells.forEach(td => { if (td !== main) td.remove(); });
            clearSelection();
            recordState();
        }

        // 병합된 셀 나누기 (colspan/rowspan 해제 → 빈 셀 채우기)
        function splitMergedCell() {
            const cell = lastActiveCell;
            if (!cell) return showToast('나누기할 셀을 클릭하세요.');
            const colspan = parseInt(cell.getAttribute('colspan') || '1');
            const rowspan = parseInt(cell.getAttribute('rowspan') || '1');
            if (colspan <= 1 && rowspan <= 1) return showToast('병합된 셀이 아닙니다.');
            recordState();
            const table = cell.closest('table');
            const rows  = Array.from(table.rows);
            const rowIdx = cell.parentElement.rowIndex;
            const colIdx = cell.cellIndex;
            const baseStyle = cell.style.cssText || '';

            // colspan 해제: 같은 행에 빈 셀 추가
            cell.removeAttribute('colspan');
            cell.removeAttribute('rowspan');
            for (let c = 1; c < colspan; c++) {
                const nd = document.createElement('td');
                nd.style.cssText = baseStyle;
                cell.after(nd);
            }
            // rowspan 해제: 아래 행에 colspan만큼 빈 셀 추가
            for (let r = 1; r < rowspan; r++) {
                const targetRow = rows[rowIdx + r];
                if (!targetRow) continue;
                for (let c = 0; c < colspan; c++) {
                    const nd = document.createElement('td');
                    nd.style.cssText = baseStyle;
                    const ref = targetRow.cells[colIdx + c] || null;
                    targetRow.insertBefore(nd, ref);
                }
            }
            clearSelection();
            recordState();
            showToast('셀이 나누어졌습니다.');
        }

        function clearSelection() { document.querySelectorAll('.selected-cell').forEach(el => el.classList.remove('selected-cell')); selectedCells = []; }

        function applyHeroImage(src, isAiGenerated = false, aspectCss = null, skipColorExtract = false) {
            const img     = getById('mainHeroImg');
            const heroDiv = getById('heroDiv');
            if (!img || !heroDiv) return;

            img.src = src;
            img.onload = () => {
                const natW = img.naturalWidth  || 1;
                const natH = img.naturalHeight || 1;

                heroDiv.style.minHeight   = '0';
                heroDiv.style.height      = 'auto';
                heroDiv.style.aspectRatio = natW + ' / ' + natH;

                img.style.position   = 'relative';
                img.style.inset      = '';
                img.style.display    = 'block';
                img.style.width      = '100%';
                img.style.height     = 'auto';
                img.style.objectFit  = '';
                img.classList.remove('hidden');

                getById('heroPlaceholder').style.display = 'none';
                getById('deleteHeroBtn').classList.remove('hidden');

                if (!skipColorExtract && getById('extractColorCheck')?.checked) {
                    const { bg, accent } = extractColorsFromImage(img);
                    // 유효한 6자리 hex 색상인지 확인 후 적용
                    if (bg && /^#[0-9a-fA-F]{6}$/.test(bg)) {
                        changeBg(bg);
                        // documentSheet 배경도 즉시 동기화
                        const sheet = getById('documentSheet');
                        if (sheet) sheet.style.backgroundColor = bg;
                        showToast(`🎨 배경색 자동 추출: ${bg.toUpperCase()}`);
                    }
                    const acPicker = getById('accentPicker');
                    const acSlash = getById('accentSlash');
                    if (acPicker && accent && /^#[0-9a-fA-F]{6}$/.test(accent)) {
                        acPicker.value = accent;
                        acPicker.style.opacity = '1';
                        if (acSlash) acSlash.style.display = 'none';
                        getById('bgPicker').dataset.accent = accent;
                        getById('bgPicker').dataset.prevAccent = accent;
                    }
                }
                // 로고 오버레이 재렌더링
                renderLogoOverlay();
            };
        }

        // 히어로 이미지에서 BG(배경색)와 AC(키컬러)를 동시 추출
        // 밝은 이미지(파스텔/애니/일러스트)와 어두운 이미지 모두 지원
        function extractColorsFromImage(img) {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const w = img.naturalWidth, h = img.naturalHeight;

                canvas.width = 200; canvas.height = 200;
                ctx.drawImage(img, 0, 0, w, h, 0, 0, 200, 200);
                const data = ctx.getImageData(0, 0, 200, 200).data;

                // RGB → HSL 변환 (h: 0~360, s/l: 0~1)
                function rgbToHsl(r, g, b) {
                    r /= 255; g /= 255; b /= 255;
                    const max = Math.max(r,g,b), min = Math.min(r,g,b);
                    let h2 = 0, s = 0, l = (max + min) / 2;
                    if (max !== min) {
                        const d = max - min;
                        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                        switch (max) {
                            case r: h2 = (g - b) / d + (g < b ? 6 : 0); break;
                            case g: h2 = (b - r) / d + 2; break;
                            default: h2 = (r - g) / d + 4;
                        }
                        h2 /= 6;
                    }
                    return [h2 * 360, s, l];
                }

                // HSL → RGB 변환
                function hslToRgb(h, s, l) {
                    h /= 360;
                    const hue2rgb = (p, q, t) => {
                        if (t < 0) t += 1;
                        if (t > 1) t -= 1;
                        if (t < 1/6) return p + (q - p) * 6 * t;
                        if (t < 1/2) return q;
                        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                        return p;
                    };
                    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
                    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                    const p = 2 * l - q;
                    return [
                        Math.round(hue2rgb(p, q, h + 1/3) * 255),
                        Math.round(hue2rgb(p, q, h) * 255),
                        Math.round(hue2rgb(p, q, h - 1/3) * 255)
                    ];
                }

                function toHex(r, g, b) {
                    return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
                }

                // ── 1단계: 전체 픽셀 파싱 + 평균 밝기 계산 ──
                // 가장자리 픽셀(이미지 외곽 25%) 여부도 함께 기록 — BG 샘플링에 활용
                const CW = 200, CH = 200;
                const allPixels = [];
                let totalLig = 0;
                for (let py = 0; py < CH; py++) {
                    for (let px = 0; px < CW; px++) {
                        const i = (py * CW + px) * 4;
                        const r = data[i], g = data[i+1], b = data[i+2];
                        const [hue, sat, lig] = rgbToHsl(r, g, b);
                        totalLig += lig;
                        // 외곽 25% 영역이면 isEdge=true (실제 배경색이 집중된 구역)
                        const isEdge = px < CW * 0.25 || px > CW * 0.75 || py < CH * 0.25 || py > CH * 0.75;
                        allPixels.push({ r, g, b, hue, sat, lig, isEdge });
                    }
                }
                const avgLig = totalLig / allPixels.length;
                // 평균 밝기 > 0.55 이면 밝은 이미지
                const isBrightImage = avgLig > 0.55;

                // ── 2단계: BG / AC 버킷 분류 ──
                // QSTEP=12: QSTEP=24보다 2배 세밀 → 크림/베이지/회색을 구별 가능
                // 가장자리 픽셀은 BG 가중치 3배 (캐릭터 등 중앙 오브젝트 오염 방지)
                const bgFreq = {};
                const acFreq = {};
                const QSTEP = 12;

                for (const { r, g, b, hue, sat, lig, isEdge } of allPixels) {
                    const qr = Math.round(r / QSTEP) * QSTEP;
                    const qg = Math.round(g / QSTEP) * QSTEP;
                    const qb = Math.round(b / QSTEP) * QSTEP;
                    const key = toHex(qr, qg, qb);
                    const edgeMult = isEdge ? 3 : 1; // 외곽 픽셀 BG 가중 3배

                    if (isBrightImage) {
                        if (lig > 0.97) continue; // 순백색 제외
                        // BG 후보: 채도 낮~중간 (파스텔/크림/베이지)
                        if (lig >= 0.40 && sat <= 0.75) {
                            const w2 = (1 + (1 - sat) * 3 + Math.max(0, lig - 0.45) * 1.5) * edgeMult;
                            bgFreq[key] = (bgFreq[key] || 0) + w2;
                        }
                        // AC 후보: 채도 높고 중간 밝기 (위치 무관)
                        if (sat >= 0.28 && lig >= 0.22 && lig <= 0.88) {
                            acFreq[key] = (acFreq[key] || 0) + sat * 5;
                        }
                    } else {
                        if (lig > 0.92) continue; // 흰색 스킵
                        // BG 후보: 유채색 + 가장자리 우선
                        if (sat >= 0.08 && lig < 0.72) {
                            const w2 = (1 + Math.max(0, 0.72 - lig) * 4 + sat * 2) * edgeMult;
                            bgFreq[key] = (bgFreq[key] || 0) + w2;
                        }
                        // AC 후보: 선명하고 채도 높은 중간 밝기
                        if (sat >= 0.30 && lig >= 0.28 && lig <= 0.85) {
                            acFreq[key] = (acFreq[key] || 0) + sat * 3;
                        }
                    }
                }

                // ── 3단계: BG 결정 — 우세 색조의 짙은 대표값으로 ──
                const bgEntries = Object.entries(bgFreq).sort((a, b) => b[1] - a[1]);
                let bgColor;

                if (bgEntries.length > 0) {
                    const rawBg = bgEntries[0][0];
                    const br = parseInt(rawBg.slice(1,3), 16);
                    const bg2 = parseInt(rawBg.slice(3,5), 16);
                    const bb = parseInt(rawBg.slice(5,7), 16);
                    const [bh, bs, bl] = rgbToHsl(br, bg2, bb);

                    if (isBrightImage) {
                        // 밝은 이미지: 채도 높여 선명하게 + 밝기 올려 화사하게
                        const adjS = Math.min(Math.max(bs, 0.35) * 1.4, 0.92);
                        const adjL = Math.min(Math.max(bl, 0.84), 0.94);
                        const [nr, ng, nb] = hslToRgb(bh, adjS, adjL);
                        bgColor = toHex(nr, ng, nb);
                    } else {
                        // 어두운/중간 이미지: 원본 톤 유지 + 채도 최소한만 보정
                        const adjS = Math.min(bs * 1.05, 0.70); // 채도 거의 안 올림, 최대 0.70
                        const adjL = Math.max(bl * 0.95, 0.12);
                        const [nr, ng, nb] = hslToRgb(bh, adjS, adjL);
                        bgColor = toHex(nr, ng, nb);
                    }
                } else {
                    bgColor = isBrightImage ? '#f5f0ec' : '#1e293b';
                }

                // ── 4단계: AC 결정 ──
                const bgR2 = parseInt(bgColor.slice(1,3), 16);
                const bgG2 = parseInt(bgColor.slice(3,5), 16);
                const bgB2 = parseInt(bgColor.slice(5,7), 16);
                const [bgHue] = rgbToHsl(bgR2, bgG2, bgB2);

                let accentColor = null;
                let bestScore = 0;
                const acEntries = Object.entries(acFreq).sort((a, b) => b[1] - a[1]);
                const topAcCount = acEntries.length > 0 ? acEntries[0][1] : 1;

                for (const [hex, cnt] of acEntries) {
                    const r2 = parseInt(hex.slice(1,3), 16);
                    const g2 = parseInt(hex.slice(3,5), 16);
                    const b2 = parseInt(hex.slice(5,7), 16);
                    const [hue, sat, lig] = rgbToHsl(r2, g2, b2);
                    let hueDiff = Math.abs(hue - bgHue);
                    if (hueDiff > 180) hueDiff = 360 - hueDiff;
                    // 채도 높고, BG와 색조 다르고, 빈도 높을수록 좋은 AC
                    const score = sat * (0.4 + hueDiff / 180 * 0.6) * (cnt / topAcCount);
                    if (score > bestScore) { bestScore = score; accentColor = hex; }
                }

                // AC가 없으면 전체 픽셀에서 가장 채도 높은 색 강제 추출
                if (!accentColor) {
                    let maxSat = 0;
                    for (const { r, g, b, sat, lig } of allPixels) {
                        if (sat > maxSat && lig > 0.25 && lig < 0.88) {
                            maxSat = sat;
                            accentColor = toHex(Math.round(r/16)*16, Math.round(g/16)*16, Math.round(b/16)*16);
                        }
                    }
                }

                // 그래도 없으면 BG 색조의 보색으로 생성
                if (!accentColor) {
                    const compHue = (bgHue + 150) % 360;
                    const [cr, cg, cb] = hslToRgb(compHue, 0.65, 0.55);
                    accentColor = toHex(cr, cg, cb);
                }

                // ── 5단계: WCAG 대비 보정 (최소 4.5:1 확보) ──
                // WCAG 2.1 상대 명도 계산 — sRGB 선형화 후 0~1 범위
                function wcagLum(hex) {
                    const rr = parseInt(hex.slice(1,3),16)/255;
                    const gg = parseInt(hex.slice(3,5),16)/255;
                    const bb = parseInt(hex.slice(5,7),16)/255;
                    const lin = c => c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
                    return 0.2126*lin(rr) + 0.7152*lin(gg) + 0.0722*lin(bb);
                }
                function contrastRatio(h1, h2) {
                    const l1 = wcagLum(h1), l2 = wcagLum(h2);
                    return (Math.max(l1,l2) + 0.05) / (Math.min(l1,l2) + 0.05);
                }
                const acRaw = parseInt(accentColor.slice(1,3),16);
                const acGrn = parseInt(accentColor.slice(3,5),16);
                const acBlu = parseInt(accentColor.slice(5,7),16);
                const [acH, acS, acL] = rgbToHsl(acRaw, acGrn, acBlu);
                let finalAccent = accentColor;

                // 채도 부스트: 원본 채도 최대한 올려서 선명하게 (최소 0.72)
                const boostedS = Math.min(Math.max(acS, 0.85) * 1.18, 0.99);

                const MIN_CONTRAST = 4.5;
                let curContrast = contrastRatio(bgColor, accentColor);
                if (curContrast < MIN_CONTRAST) {
                    const bgIsLight = wcagLum(bgColor) > 0.18;
                    const step = bgIsLight ? -0.03 : 0.03;
                    let bestL = acL, bestContrast = curContrast;
                    for (let trial = acL + step; trial >= 0.04 && trial <= 0.96; trial += step) {
                        const [tr2, tg2, tb2] = hslToRgb(acH, boostedS, trial);
                        const trialHex = toHex(tr2, tg2, tb2);
                        const trialContrast = contrastRatio(bgColor, trialHex);
                        if (trialContrast > bestContrast) { bestContrast = trialContrast; bestL = trial; }
                        if (trialContrast >= MIN_CONTRAST) break;
                    }
                    const [fr, fg, fb] = hslToRgb(acH, boostedS, bestL);
                    finalAccent = toHex(fr, fg, fb);
                } else {
                    // 대비는 충분해도 채도 부스트 적용
                    const [fr, fg, fb] = hslToRgb(acH, boostedS, acL);
                    finalAccent = toHex(fr, fg, fb);
                }

                return { bg: bgColor, accent: finalAccent };
            } catch (e) {
                console.warn('extractColorsFromImage error:', e);
                return { bg: '#f5f0ec', accent: '#e07060' };
            }
        }

        // 구버전 단일 색상 추출 (폴백용으로 유지)
        function extractDominantColor(img) {
            return extractColorsFromImage(img).bg;
        }

        function deleteHeroImage() {
            const img     = getById('mainHeroImg');
            const heroDiv = getById('heroDiv');
            if (!img || !heroDiv) return;

            img.src          = '';
            img.style.cssText = '';
            img.classList.add('hidden');
            img.style.display = 'none';

            heroDiv.style.aspectRatio = '';
            heroDiv.style.minHeight   = '400px';
            heroDiv.style.height      = 'auto';

            getById('heroPlaceholder').style.display = 'flex';
            getById('deleteHeroBtn').classList.add('hidden');
            showToast("메인 히어로 이미지가 삭제되었습니다.");
        }

        // noColorAdjust=true: 불러오기 시 텍스트 색 자동교체 비활성화 (저장된 색 그대로 유지)
        function changeBg(color, noColorAdjust = false) {
            // rgb() 형태로 오면 hex로 변환
            if (color && color.startsWith('rgb')) {
                const m = color.match(/\d+/g);
                if (m && m.length >= 3) {
                    color = '#' + m.slice(0,3).map(n => parseInt(n).toString(16).padStart(2,'0')).join('');
                }
            }
            if (!color || !color.startsWith('#')) return;
            const area = getById('contentArea'); const sheet = getById('documentSheet');
            if (!area || !sheet) return;
            area.style.backgroundColor = color;
            sheet.style.backgroundColor = color;

            const wrappers = area.querySelectorAll('.se-contents, .se-div');
            wrappers.forEach(w => w.style.backgroundColor = color);

            const finalTextColor = isDarkColor(color) ? '#ffffff' : '#1e293b';
            area.style.color = finalTextColor;
            // se-contents에도 color 명시 — innerHTML로 저장 시 상속 텍스트 색상이 보존되도록
            const seContents = area.querySelector('.se-contents');
            if (seContents) seContents.style.color = finalTextColor;

            // 불러오기 시에는 텍스트 색 자동교체 비활성화 — 저장된 색상 그대로 유지
            if (!noColorAdjust) {
                const textNodes = area.querySelectorAll('*');
                textNodes.forEach(node => {
                    if (node.style.color) {
                        const c = node.style.color.replace(/\s/g, '').toLowerCase();
                        if (isDarkColor(color)) {
                             if (c === 'rgb(30,41,59)' || c === '#1e293b' || c === 'black' || c === '#000' || c === '#000000') node.style.color = '#ffffff';
                        } else {
                             if (c === 'rgb(255,255,255)' || c === 'white' || c === '#fff' || c === '#ffffff') node.style.color = '#1e293b';
                        }
                    }
                });
            }

            getById('bgPicker').value = color;
        }

        function changeAccent(color) {
            const area = getById('contentArea');
            if (!area) return;
            // accentPicker 값 저장
            const picker = getById('accentPicker');
            if (picker) picker.value = color;
            getById('bgPicker').dataset.accent = color;

            recordState();
            // contentArea + 모든 팝업 childArea 대상으로 accent 색 교체
            const allAreas = [area];
            childPanels.forEach(panel => {
                const ca = getById('childArea_' + panel.id);
                if (ca) allAreas.push(ca);
            });

            const oldAccent = getById('bgPicker').dataset.prevAccent || null;
            if (oldAccent && oldAccent !== color) {
                allAreas.forEach(targetArea => replaceColorInContent(targetArea, oldAccent, color));
            } else {
                // 이전 색 없으면 전체 스타일 속성 분석 후 가장 많은 색(BG 제외) 교체
                const freq = {};
                const bgColor = getById('bgPicker').value.toLowerCase();
                allAreas.forEach(targetArea => {
                    targetArea.querySelectorAll('[style]').forEach(el => {
                        const m = el.getAttribute('style').match(/#[0-9a-fA-F]{6}/g);
                        if (m) m.forEach(c => { freq[c.toLowerCase()] = (freq[c.toLowerCase()] || 0) + 1; });
                    });
                });
                const detected = Object.entries(freq)
                    .filter(([c]) => c !== bgColor)
                    .sort((a, b) => b[1] - a[1])[0];
                if (detected) allAreas.forEach(targetArea => replaceColorInContent(targetArea, detected[0], color));
            }
            getById('bgPicker').dataset.prevAccent = color;

            // 팝업 트리거 버튼(.popup-trigger) 스타일 전체를 hex로 재설정
            fixPopupTriggerStyles(); protectAccentBars(); protectSectionCards();

            // childPanelHeader 내 레이블 색상 + 삭제 버튼 색상 동기화
            childPanels.forEach(panel => {
                const lbl = getById('childPanelLabel_' + panel.id);
                if (lbl) lbl.style.color = color;
                const hdr = getById('childPanelHeader_' + panel.id);
                if (hdr) {
                    const delBtn = hdr.querySelector('button');
                    if (delBtn) delBtn.style.backgroundColor = color;
                }
            });

            recordState();
            showToast('포인트 컬러가 변경되었습니다.');
        }

        function replaceColorInContent(area, oldColor, newColor) {
            const old = oldColor.toLowerCase();
            area.querySelectorAll('[style]').forEach(el => {
                const s = el.getAttribute('style');
                if (s.toLowerCase().includes(old)) {
                    el.setAttribute('style', s.replace(new RegExp(old.replace('#', '#'), 'gi'), newColor));
                }
            });
        }

        async function apiFetch(url, options) {
            const authKey = getById('apiKeyInput').value || apiKey;
            const fullUrl = `${url}${url.includes('?') ? '&' : '?'}key=${authKey}`;
            const response = await fetch(fullUrl, options);
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error?.message || "API \uc694\uccad \uc2e4\ud328");
            }
            return await response.json();
        }

        window._heroAspectRatio = '1:1'; // 기본값

        function applyTextColor(color) {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed || sel.toString().trim() === '') {
                showToast('색상을 적용할 텍스트를 먼저 선택하세요.');
                return;
            }
            recordState();
            // 선택 범위를 span으로 감싸서 인라인 color 적용
            const range = sel.getRangeAt(0);
            const span = document.createElement('span');
            span.style.color = color;
            try {
                range.surroundContents(span);
            } catch(e) {
                // 범위가 여러 노드에 걸쳐 있을 때 execCommand 사용
                document.execCommand('foreColor', false, color);
                // execCommand가 font 태그를 만들 수 있으므로 span으로 교체
                const area = getById('contentArea');
                area.querySelectorAll('font[color]').forEach(font => {
                    const s = document.createElement('span');
                    s.style.color = font.getAttribute('color');
                    s.innerHTML = font.innerHTML;
                    font.replaceWith(s);
                });
            }
            recordState();
        }

        // 미디어 드롭다운 메뉴 토글
        function toggleMediaMenu(id, e) {
            e.stopPropagation();
            const menu = getById(id);
            if (!menu) return;
            const isHidden = menu.classList.contains('hidden');
            // 다른 메뉴 닫기
            ['imgMenu','videoMenu','tableInsertMenu'].forEach(m => {
                const el = getById(m);
                if (el && m !== id) el.classList.add('hidden');
            });
            menu.classList.toggle('hidden', !isHidden);
        }
        function closeMediaMenu(id) {
            const menu = getById(id);
            if (menu) setTimeout(() => menu.classList.add('hidden'), 100);
        }
        // 외부 클릭 시 모든 미디어 메뉴 닫기
        document.addEventListener('click', () => {
            ['imgMenu','videoMenu'].forEach(id => {
                const el = getById(id);
                if (el) el.classList.add('hidden');
            });
        });

        // URL로 이미지/영상 삽입
        function insertMediaByUrl(type) {
            const url = prompt(type === 'image' ? '이미지 URL을 입력하세요:' : '영상 URL을 입력하세요 (mp4 등):');
            if (!url || !url.trim()) return;
            const area = getById('contentArea');
            area.focus();
            if (savedRange && area.contains(savedRange.startContainer)) {
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(savedRange);
            }
            recordState();
            let html = '';
            if (type === 'image') {
                html = `<img src="${url.trim()}" style="max-width:100%;height:auto;display:block;margin:0 auto;">`;
            } else {
                html = `<div class="se-div" style="margin:0;padding:0;"><video src="${url.trim()}" autoplay loop muted playsinline style="max-width:100%;width:100%;height:auto;display:block;margin:0 auto;" preload="metadata"></video></div>`;
            }
            document.execCommand('insertHTML', false, html);
            recordState();
        }

        // 블록 클립보드
        let blockClipboard = null;

        function blockPasteAction() {
            if (!blockClipboard) return showToast('붙여넣을 내용이 없습니다. 먼저 복사 또는 잘라내기를 하세요.');
            const area = getById('contentArea');
            area.focus();
            if (savedRange && area.contains(savedRange.startContainer)) {
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(savedRange);
            }
            recordState();
            document.execCommand('insertHTML', false, blockClipboard);
            recordState();
            showToast('붙여넣기 완료');
        }

        function setBlockClipboard(html) {
            blockClipboard = html;
            const btn = getById('blockPasteBtn');
            if (btn) { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
        }

        function blockCopyAction() {
            if (!activeLayer) return showToast('선택된 블록이 없습니다.');
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNode(activeLayer);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('copy');
            setBlockClipboard(activeLayer.outerHTML);
            showToast('블록이 복사되었습니다.');
        }

        function blockCutAction() {
            // 텍스트 선택 상태면 시스템 잘라내기
            const sel = window.getSelection();
            const selText = sel ? sel.toString().trim() : '';
            if (selText) {
                try { document.execCommand('cut'); } catch(e) {}
                showToast('텍스트 잘라내기됨');
                return;
            }
            if (!activeLayer) return showToast('선택된 블록이 없습니다.');
            const range = document.createRange();
            range.selectNode(activeLayer);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('copy');
            setBlockClipboard(activeLayer.outerHTML);
            recordState();
            activeLayer.remove();
            activeLayer = null;
            hideAllTools();
            recordState();
            showToast('블록이 잘라내기 되었습니다.');
        }

        function blockDeleteAction() {
            if (!activeLayer) return showToast('선택된 블록이 없습니다.');
            recordState();
            activeLayer.remove();
            activeLayer = null;
            hideAllTools();
            recordState();
            showToast('블록이 삭제되었습니다.');
        }

        // 드롭존 래퍼 함수들 (인라인 ondrop에서 호출)
        function onDropRef(e) {
            e.preventDefault(); e.stopPropagation();
            e.currentTarget.classList.remove('active');
            const files = Array.from(e.dataTransfer.files || []);
            const f = files.find(x => isImageFile(x));
            if (!f) return;
            const r = new FileReader();
            r.onload = ev => {
                referenceImageBase64 = ev.target.result;
                getById('refPreview').innerHTML = `<div class="relative inline-block w-12 h-12 group pointer-events-auto shadow-sm rounded-lg border border-indigo-100 overflow-hidden shrink-0"><img src="${ev.target.result}" class="w-full h-full object-cover bg-slate-50"><button onclick="referenceImageBase64=null;getById('refPreview').innerHTML='';" class="absolute top-0 right-0 bg-red-500/80 text-white w-4 h-4 flex items-center justify-center text-[8px] font-bold opacity-0 group-hover:opacity-100 cursor-pointer rounded-bl-sm">✕</button></div>`;
                showToast('레퍼런스 이미지가 등록되었습니다.');
            };
            r.readAsDataURL(f);
        }
        function onDropAsset(e) {
            e.preventDefault(); e.stopPropagation();
            e.currentTarget.classList.remove('active');
            let added = 0;
            Array.from(e.dataTransfer.files || []).forEach(f => {
                if (!isImageFile(f)) return;
                added++;
                const r = new FileReader();
                r.onload = ev => { uploadedAssets.push({b64: ev.target.result, name: f.name || 'asset.png'}); renderHeroAssets(); };
                r.readAsDataURL(f);
            });
            if (added > 0) showToast(added + '개의 에셋이 등록되었습니다.');
        }
        function onDropLogo(e) {
            e.preventDefault(); e.stopPropagation();
            e.currentTarget.classList.remove('active');
            const f = Array.from(e.dataTransfer.files || []).find(x => isImageFile(x));
            if (f) loadLogoFile(f);
        }
        function onDropContentAsset(e) {
            e.preventDefault(); e.stopPropagation();
            e.currentTarget.classList.remove('active');
            let added = 0;
            Array.from(e.dataTransfer.files || []).forEach(f => {
                if (!isImageFile(f)) return;
                added++;
                const r = new FileReader();
                r.onload = ev => { contentAssetLibrary[f.name || `img_${Date.now()}`] = ev.target.result; renderContentAssets(); setTimeout(() => runImageMatching(true), 100); };
                r.readAsDataURL(f);
            });
            if (added > 0) showToast(added + '개의 컨텐츠 이미지가 등록되었습니다.');
        }
        function onDragOver(e) { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('active'); }
        function onDragLeave(e) { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('active'); }

        function setAspectRatio(ratio) {
            window._heroAspectRatio = ratio;
            const btnMap = { '1:1': 'ratioBtn11', '3:4': 'ratioBtn34', '4:3': 'ratioBtn43' };
            Object.entries(btnMap).forEach(([r, id]) => {
                const btn = getById(id);
                if (!btn) return;
                if (r === ratio) {
                    btn.className = 'px-3 py-1 text-[10px] font-black rounded-lg border border-indigo-400 bg-indigo-500 text-white transition-colors';
                } else {
                    btn.className = 'px-3 py-1 text-[10px] font-black rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors';
                }
            });
        }

        // ── 팝업 패널 시스템 ───────────────────────────────────────────────
        let childPanels = []; // [{id, title}]
        let nextPopupId = 1;

        function addChildPanel(id, initialHTML) {
            if (!id) id = 'popup_' + (nextPopupId++);
            if (childPanels.find(p => p.id === id)) return id;
            childPanels.push({ id });

            const container = getById('childPanelsContainer');
            if (!container) return id;

            const pageW = parseInt(getById('pageWidthInput')?.value) || 840;
            const childW = Math.min(Math.round(pageW * 0.88), 740);
            const _bgCol  = getById('bgPicker')?.value     || '#1e293b';
            const _acCol  = getById('accentPicker')?.value || '#7c3aed';
            const _isDark = getLuminance(_bgCol) < 128;
            const _headerBg  = blendHex(_bgCol, _isDark ? '#ffffff' : '#000000', 0.06);
            const _borderCol = blendHex(_bgCol, _isDark ? '#ffffff' : '#000000', 0.15);
            const _textCol   = _isDark ? '#e2e8f0' : '#1e293b';
            const num = id.replace('popup_', '');
            const sheet = document.createElement('div');
            sheet.id = 'childSheet_' + id;
            sheet.style.cssText = `width:${childW}px;border-radius:0.75rem;overflow:hidden;`;
            sheet.innerHTML = `
                <div id="childPanelHeader_${id}" class="childPanelHeader" style="padding:0.5rem 0.75rem;background:#ffffff;display:flex;align-items:center;justify-content:space-between;">
                    <span id="childPanelLabel_${id}" contenteditable="plaintext-only" spellcheck="false" style="font-size:0.7rem;font-weight:700;color:${_acCol};letter-spacing:0.05em;outline:none;min-width:2rem;cursor:text;" title="클릭하여 이름 편집">팝업 ${num}</span>
                    <button onclick="deleteChildPanel('${id}')" style="width:1.25rem;height:1.25rem;border-radius:50%;background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;cursor:pointer;font-size:0.65rem;font-weight:900;display:flex;align-items:center;justify-content:center;line-height:1;flex-shrink:0;" title="팝업 삭제">🗑</button>
                </div>
                <div id="childArea_${id}" contenteditable="true" style="outline:none;min-height:5rem;padding:1.25rem 1.5rem;background:#ffffff;font-family:'Pretendard',sans-serif;font-size:clamp(0.875rem,1.702vw,1rem);line-height:1.8;color:#1e293b;word-break:keep-all;overflow-wrap:break-word;width:100%;box-sizing:border-box;"></div>`;
            container.appendChild(sheet);

            const wrapper = getById('childPanelsWrapper');
            if (wrapper) {
                wrapper.style.display = 'flex';
                wrapper.style.width = childW + 'px';
            }

            const childArea = getById('childArea_' + id);
            if (initialHTML) {
                childArea.innerHTML = initialHTML;
            } else {
                childArea.innerHTML = `<p id="childPlaceholder_${id}" style="color:#475569;text-align:center;padding:2rem;margin:0;font-size:0.75rem;">팝업 ${num} 내용 입력</p>`;
            }

            // [툴팁N] 레이블 추출 → 패널 헤더에 반영, 컨텐츠에서 제거
            (function extractTooltipLabel() {
                if (!childArea.innerHTML) return;
                // [툴팁N] 또는 [팝업N] 형식 감지 — 공백·추가 문자 허용
                const labelMatch = childArea.innerHTML.match(/\[(툴팁|팝업)\s*(\d+)[^\]]*\]/i);
                if (labelMatch) {
                    const typeStr = labelMatch[1] === '팝업' ? '팝업' : '툴팁';
                    const numStr  = labelMatch[2] || num;
                    const labelEl = getById('childPanelLabel_' + id);
                    if (labelEl) labelEl.textContent = typeStr + ' ' + numStr;
                    childArea.innerHTML = childArea.innerHTML.replace(/\[(툴팁|팝업)\s*\d+[^\]]*\]/gi, '');
                }
                // 재귀적 "실질적 빈 요소" 판별 (빈 span/b/strong 등 포함)
                function isEffEmpty(el) {
                    if (el.textContent.replace(/[\s\u00a0\u200b]/g, '') !== '') return false;
                    return !Array.from(el.childNodes).some(n => {
                        if (n.nodeType !== 1) return false;
                        if (['BR','WBR'].includes(n.tagName)) return false;
                        if (['SPAN','B','STRONG','I','EM','U','S','A','SMALL','MARK'].includes(n.tagName)) return !isEffEmpty(n);
                        return true; // IMG, TABLE 등 실체 요소는 비어있지 않음
                    });
                }
                // 빈 p/div 정리 (재귀 체크 적용)
                childArea.querySelectorAll('p,div').forEach(el => {
                    if (isEffEmpty(el) && !el.querySelector('img,table,video')) el.remove();
                });
                // 테이블 셀 안 빈 인라인 잔여 요소 제거 (span/b 등)
                childArea.querySelectorAll('td,th').forEach(cell => {
                    Array.from(cell.childNodes).forEach(n => {
                        if (n.nodeType === 1 && ['SPAN','B','STRONG','I','EM','U','S'].includes(n.tagName) && isEffEmpty(n)) n.remove();
                    });
                });
            })();

            // 팝업 내 테이블 th → td 정규화 (fixTableThs 적용)
            if (typeof fixTableThs === 'function') fixTableThs(childArea);

            setTimeout(() => sheet.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);

            let childTimer = null;
            childArea.addEventListener('focus', () => { const ph = getById('childPlaceholder_' + id); if (ph) ph.remove(); }, { once: true });
            childArea.addEventListener('paste', e => {
                // 1) HTML 표 붙여넣기 우선 처리 (셀 외부 붙여넣기)
                const htmlDataFirst = e.clipboardData.getData('text/html');
                if (htmlDataFirst && /<table/i.test(htmlDataFirst) && !e.target.closest('td, th')) {
                    e.preventDefault();
                    const ph = getById('childPlaceholder_' + id); if (ph) ph.remove();
                    recordState();
                    const doc2 = new DOMParser().parseFromString(htmlDataFirst, 'text/html');
                    const tbl = doc2.querySelector('table');
                    if (tbl) {
                        tbl.style.cssText = 'width:100%;border-collapse:collapse;table-layout:fixed;';
                        tbl.querySelectorAll('th, td').forEach(cell => {
                            const bgAttr = cell.getAttribute('bgcolor');
                            if (bgAttr) {
                                if (!(cell.getAttribute('style') || '').includes('background-color')) cell.style.backgroundColor = bgAttr;
                                cell.removeAttribute('bgcolor');
                            }
                            cell.removeAttribute('width');
                        });
                        childArea.focus();
                        const sel3 = window.getSelection();
                        const r3 = document.createRange();
                        r3.selectNodeContents(childArea); r3.collapse(false);
                        sel3.removeAllRanges(); sel3.addRange(r3);
                        document.execCommand('insertHTML', false, tbl.outerHTML);
                        setTimeout(() => fixTableThs(childArea), 0);
                        recordState();
                        showToast('표가 팝업에 삽입되었습니다.');
                    }
                    return;
                }
                // 2) 셀 내부 붙여넣기
                const tdTarget = e.target.closest('td, th');
                if (tdTarget && childArea.contains(tdTarget)) {
                    e.preventDefault();
                    const tdHtml = e.clipboardData.getData('text/html');
                    if (tdHtml) {
                        const tmpDoc = new DOMParser().parseFromString(tdHtml, 'text/html');
                        const srcRows = tmpDoc.querySelectorAll('tr');
                        if (srcRows.length > 1) {
                            const table = tdTarget.closest('table');
                            const tbody = table.querySelector('tbody') || table;
                            const allRows = Array.from(tbody.querySelectorAll('tr'));
                            const startRowIdx = allRows.indexOf(tdTarget.closest('tr'));
                            const startColIdx = Array.from(tdTarget.closest('tr').cells).indexOf(tdTarget);
                            recordState();
                            srcRows.forEach((srcRow, ri) => {
                                let targetRow = allRows[startRowIdx + ri];
                                if (!targetRow) {
                                    targetRow = allRows[allRows.length - 1].cloneNode(true);
                                    targetRow.querySelectorAll('td, th').forEach(c => { c.textContent = ''; });
                                    tbody.appendChild(targetRow); allRows.push(targetRow);
                                }
                                Array.from(srcRow.cells).forEach((srcCell, ci) => {
                                    const cell = Array.from(targetRow.cells)[startColIdx + ci];
                                    if (cell) cell.innerHTML = srcCell.innerHTML;
                                });
                            });
                            recordState(); return;
                        } else if (srcRows.length === 1) {
                            const srcTd = tmpDoc.querySelector('td, th');
                            if (srcTd) {
                                if (srcTd.getAttribute('style')) tdTarget.setAttribute('style', srcTd.getAttribute('style'));
                                tdTarget.innerHTML = srcTd.innerHTML;
                                recordState(); return;
                            }
                        }
                    }
                    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
                    const rows = text.split(/\r?\n/).filter(r => r.trim() !== '');
                    if (rows.length > 1 || rows[0]?.includes('\t')) {
                        const table = tdTarget.closest('table');
                        const tbody = table.querySelector('tbody') || table;
                        const allRows = Array.from(tbody.querySelectorAll('tr'));
                        const startRowIdx = allRows.indexOf(tdTarget.closest('tr'));
                        const startColIdx = Array.from(tdTarget.closest('tr').cells).indexOf(tdTarget);
                        recordState();
                        rows.forEach((row, ri) => {
                            const cols = row.split('\t');
                            let targetRow = allRows[startRowIdx + ri];
                            if (!targetRow) {
                                targetRow = allRows[allRows.length - 1].cloneNode(true);
                                targetRow.querySelectorAll('td, th').forEach(c => { c.textContent = ''; });
                                tbody.appendChild(targetRow); allRows.push(targetRow);
                            }
                            const cells = Array.from(targetRow.cells);
                            cols.forEach((col, ci) => { const cell = cells[startColIdx + ci]; if (cell) cell.textContent = col; });
                        });
                        recordState();
                    } else {
                        const sel = window.getSelection();
                        if (sel.rangeCount) { sel.deleteFromDocument(); sel.getRangeAt(0).insertNode(document.createTextNode(text)); sel.collapseToEnd(); recordState(); }
                    }
                    return;
                }
                // 3) blockClipboard 있으면 HTML로 붙여넣기
                if (blockClipboard) {
                    e.preventDefault();
                    const ph = getById('childPlaceholder_' + id); if (ph) ph.remove();
                    document.execCommand('insertHTML', false, blockClipboard);
                    clearTimeout(childTimer); childTimer = setTimeout(() => recordState(), 800);
                }
            });
            childArea.addEventListener('input', () => {
                const ph = getById('childPlaceholder_' + id); if (ph) ph.remove();
                clearTimeout(childTimer); childTimer = setTimeout(() => recordState(), 800);
            });

            // ── 팝업 패널 이미지 드래그&드롭 (엄마 위지윅과 동일) ──
            // dragstart 차단: contenteditable 내 텍스트/콘텐츠의 네이티브 드래그 방지
            // → 마우스 드래그 중 mousemove 대신 dragstart/drag로 전환되는 문제 해결
            childArea.addEventListener('dragstart', e => { e.preventDefault(); });
            childArea.addEventListener('dragenter', e => { e.preventDefault(); e.stopPropagation(); childArea.style.outline = '3px dashed ' + (_acCol || '#7c3aed'); });
            childArea.addEventListener('dragover',  e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; });
            childArea.addEventListener('dragleave', e => {
                // relatedTarget이 childArea 안에 있는 자식 요소면 dragleave 무시 (false firing 방지)
                if (childArea.contains(e.relatedTarget)) return;
                e.preventDefault(); e.stopPropagation(); childArea.style.outline = '';
            });
            // ── 팝업 패널 테이블 클릭 + 드래그 다중 셀 선택 (contentArea와 동일 방식) ──
            childArea.addEventListener('mousedown', e => {
                const td = e.target.closest('td, th');
                if (!td || !childArea.contains(td)) return;
                const table = td.closest('table');
                if (!table) return;

                // td 안 이미지 클릭 → 테이블 툴바 미표시 (click 핸들러에서 이미지 툴바만 표시)
                if (e.target.tagName === 'IMG') return;

                // preventDefault 없음 → 브라우저 커서 자연 배치 허용
                if (activeLayer) activeLayer.classList.remove('active-layer');
                activeLayer = table;
                table.classList.add('active-layer');
                lastActiveCell = td;
                isSelecting = true;
                selectionStartCell = td;
                clearSelection();
                td.classList.add('selected-cell');
                selectedCells = [td];
                hideImgFloatToolbar();
                setTimeout(() => showTableFloatToolbar(table, td), 0);
            });

            // mouseover 드래그 선택 (contentArea와 동일)
            childArea.addEventListener('mouseover', e => {
                if (!isSelecting || !selectionStartCell) return;
                const td = e.target.closest('td, th');
                if (!td || !childArea.contains(td)) return;
                if (td.closest('table') !== selectionStartCell.closest('table')) return;
                const tbl    = selectionStartCell.closest('table');
                const rows   = Array.from(tbl.rows);
                const startR = selectionStartCell.parentElement.rowIndex;
                const startC = selectionStartCell.cellIndex;
                const endR   = td.parentElement.rowIndex;
                const endC   = td.cellIndex;
                const minR = Math.min(startR, endR), maxR = Math.max(startR, endR);
                const minC = Math.min(startC, endC), maxC = Math.max(startC, endC);
                clearSelection();
                for (let r = minR; r <= maxR; r++) {
                    for (let c = minC; c <= maxC; c++) {
                        const cell = rows[r]?.cells[c];
                        if (cell) { cell.classList.add('selected-cell'); selectedCells.push(cell); }
                    }
                }
                updateTableSelInfo();
                showTableFloatToolbar(tbl, null);
            });

            // ── 팝업 패널 이미지 클릭 → 플로팅 툴바 표시 ──
            childArea.addEventListener('click', e => {
                const img = e.target.closest('img');
                if (!img || !childArea.contains(img)) return;
                // 기존 선택 모두 해제
                document.querySelectorAll('.img-selected').forEach(i => i.classList.remove('img-selected'));
                if (activeLayer) activeLayer.classList.remove('active-layer');
                // 새 이미지 선택
                img.classList.add('img-selected');
                activeLayer = img;
                const imgToolsEl = getById('imgTools');
                if (imgToolsEl) imgToolsEl.style.display = 'flex';
                showImgFloatToolbar(img);
            });

            childArea.addEventListener('drop', e => {
                e.preventDefault(); e.stopPropagation();
                childArea.style.outline = '';
                const files = Array.from(e.dataTransfer.files || []).filter(f => isImageFile(f));
                if (!files.length) return;
                const ph = getById('childPlaceholder_' + id); if (ph) ph.remove();

                // 테이블 셀에 드롭 → 셀에 삽입
                const targetCell = e.target.closest('td, th');
                if (targetCell) {
                    files.forEach(file => {
                        const reader = new FileReader();
                        reader.onload = ev => {
                            const img = document.createElement('img');
                            img.src = ev.target.result;
                            img.style.cssText = 'max-width:100%;height:auto;display:block;margin:0 auto;';
                            targetCell.appendChild(img);
                            clearTimeout(childTimer);
                            childTimer = setTimeout(() => recordState(), 800);
                        };
                        reader.readAsDataURL(file);
                    });
                    showToast('셀에 이미지가 삽입되었습니다.');
                    return;
                }

                // 텍스트 마커 매칭 여부 확인 ((파일명) 또는 [파일명] 패턴)
                const hasMarker = files.some(file => {
                    const base = file.name.replace(/\.[^.]+$/, '');
                    const txt = childArea.innerText || '';
                    return txt.includes(`(${base})`) || txt.includes(`[${base}]`) ||
                           txt.includes(`(${file.name})`) || txt.includes(`[${file.name}]`);
                });

                // 깨진 이미지(상대경로) 존재 여부
                const brokenImgs = Array.from(childArea.querySelectorAll('img[src]')).filter(img => {
                    const s = img.getAttribute('src') || '';
                    return !s.startsWith('data:') && !s.startsWith('http') && !s.startsWith('blob:');
                });

                if (hasMarker || brokenImgs.length > 0) {
                    // 파일명 매칭 모드
                    Promise.all(files.map(file => new Promise(resolve => {
                        const reader = new FileReader();
                        reader.onload = ev => {
                            // 깨진 이미지 src 복원
                            brokenImgs.forEach(img => {
                                const srcFname = (img.getAttribute('src') || '').split('/').pop().split('\\').pop();
                                if (srcFname === file.name) img.src = ev.target.result;
                            });
                            resolve({ fname: file.name, b64: ev.target.result });
                        };
                        reader.onerror = () => resolve(null);
                        reader.readAsDataURL(file);
                    }))).then(results => {
                        const fileMap = {};
                        results.forEach(r => { if (r) fileMap[r.fname] = r.b64; });
                        const matched = runMatchWithFiles(fileMap);
                        recordState();
                        showToast(matched > 0 ? `이미지 ${matched}개 매칭 완료!` : '매칭되는 파일명이 없습니다.');
                    });
                    return;
                }

                // 일반 삽입 모드: 커서 위치에 이미지 삽입
                files.forEach(file => {
                    const reader = new FileReader();
                    reader.onload = ev => {
                        const img = document.createElement('img');
                        img.src = ev.target.result;
                        img.style.cssText = 'max-width:100%;height:auto;display:block;margin:0 auto;';
                        let inserted = false;
                        if (document.caretRangeFromPoint) {
                            const r = document.caretRangeFromPoint(e.clientX, e.clientY);
                            if (r && childArea.contains(r.startContainer)) {
                                r.insertNode(img); inserted = true;
                            }
                        }
                        if (!inserted) childArea.appendChild(img);
                        clearTimeout(childTimer);
                        childTimer = setTimeout(() => recordState(), 800);
                    };
                    reader.readAsDataURL(file);
                });
                showToast('이미지가 팝업 패널에 추가되었습니다.');
            });

            showToast('💬 팝업 ' + num + ' 패널 생성됨');
            return id;
        }

        function deleteChildPanel(id) {
            const sheet = getById('childSheet_' + id);
            if (sheet) sheet.remove();
            childPanels = childPanels.filter(p => p.id !== id);
            const area = getById('contentArea');
            if (area) area.querySelectorAll('.popup-trigger[data-popup="' + id + '"]').forEach(btn => btn.remove());
            if (childPanels.length === 0) {
                const wrapper = getById('childPanelsWrapper');
                if (wrapper) wrapper.style.display = 'none';
            }
            recordState();
            showToast('팝업 패널 ' + id + ' 삭제됨');
        }

        function insertPopupTrigger(panelId) {
            const area = getById('contentArea');
            if (!panelId) {
                panelId = 'popup_' + nextPopupId;
                nextPopupId++;
            }
            addChildPanel(panelId);
            const triggerHTML = `<button class="popup-trigger" data-popup="${panelId}" style="${getPopupBtnStyle()}" title="${panelId} 팝업 열기">+</button>`;
            area.focus();
            const sel = window.getSelection();
            if (savedRange && area.contains(savedRange.startContainer)) {
                sel.removeAllRanges();
                sel.addRange(savedRange);
            }
            document.execCommand('insertHTML', false, triggerHTML);
            recordState();
        }

        // [팝업N] 마커 → 트리거 버튼, se-popup-content 블록 → 자식 패널에 자동 삽입
        function processPopupMarkers(html) {
            // 1. se-popup-content 블록이 있을 때만 DOM 추출 (없으면 스킵)
            const popupContentMap = {};
            if (html.includes('se-popup-content')) {
                try {
                    const tmp = document.createElement('div');
                    tmp.innerHTML = html;
                    tmp.querySelectorAll('[data-popup]').forEach(el => {
                        if (el.classList.contains('se-popup-content') || el.getAttribute('class')?.includes('se-popup-content')) {
                            const id = el.getAttribute('data-popup');
                            if (id) {
                                let content = '';
                                if (el.tagName === 'SCRIPT') {
                                    // <script type="application/json"> 형식: JSON 디코딩
                                    try { content = JSON.parse(el.textContent.trim()); } catch(e) { content = el.textContent.trim(); }
                                } else {
                                    content = el.innerHTML.trim();
                                }
                                popupContentMap[id] = content;
                                el.remove();
                            }
                        }
                    });
                    // DOM 파싱 결과가 원본보다 크게 달라지면 DOM 버전 사용, 아니면 원본 유지
                    const domResult = tmp.innerHTML;
                    if (Object.keys(popupContentMap).length > 0) {
                        html = domResult; // 팝업 블록 제거된 버전 사용
                    }
                    // 팝업 블록 없으면 원본 html 그대로 유지
                } catch(e) { console.warn('popup extract err:', e); }
            }

            // 2. [팝업N] 텍스트 마커 → 트리거 버튼으로 교체
            const pendingPanels = [];
            html = html.replace(/\[팝업(\d+)\]/g, (m, n) => {
                const id = 'popup_' + n;
                if (parseInt(n) >= nextPopupId) nextPopupId = parseInt(n) + 1;
                if (!pendingPanels.includes(id)) pendingPanels.push(id);
                return `<button class="popup-trigger" data-popup="${id}" style="${getPopupBtnStyle()}" title="${id} 팝업 열기">+</button>`;
            });

            // 3. popupContentMap에서 감지된 ID도 추가
            Object.keys(popupContentMap).forEach(id => {
                if (!pendingPanels.includes(id)) pendingPanels.push(id);
                const n = parseInt(id.replace('popup_', ''));
                if (!isNaN(n) && n >= nextPopupId) nextPopupId = n + 1;
            });

            // 4. 자식 패널 생성 + 내용 채우기
            if (pendingPanels.length > 0) {
                setTimeout(() => {
                    pendingPanels.forEach(id => {
                        const content = popupContentMap[id] || null;
                        if (!childPanels.find(p => p.id === id)) {
                            addChildPanel(id, content);
                        } else if (content) {
                            const area = getById('childArea_' + id);
                            if (area) {
                                area.innerHTML = content;
                                if (typeof fixTableThs === 'function') fixTableThs(area);
                            }
                        }
                    });
                }, 100);
            }
            return html;
        }

        // 에디터 내 팝업 미리보기 시스템
        let activeEditorPopup = null;

        function showEditorPopup(btn, id) {
            closeEditorPopup();
            const childArea = getById('childArea_' + id);
            if (!childArea) return;

            const sheet = getById('documentSheet');
            const sheetRect = sheet.getBoundingClientRect();
            const btnRect = btn.getBoundingClientRect();
            const acCol = getById('accentPicker')?.value || '#7c3aed';
            const bgCol = getById('bgPicker')?.value || '#1e293b';

            // 딤드 오버레이 — documentSheet 내부에 absolute로 붙임 (콘텐츠 영역만 딤)
            const overlay = document.createElement('div');
            overlay.id = '__editor_popup_overlay__';
            overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.62);z-index:50000;';
            // mousedown으로 닫기 — click보다 빠르고 드래그 조작과 충돌 없음
            overlay.addEventListener('mousedown', e => {
                if (e.target === overlay) closeEditorPopup();
            });

            // 팝업 박스
            const box = document.createElement('div');
            const boxW = Math.min(480, sheetRect.width * 0.82);
            const boxMaxH = sheetRect.height * 0.72;
            box.style.cssText = `position:absolute;width:${boxW}px;max-height:${boxMaxH}px;border-radius:0.75rem;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.45),0 0 0 1px rgba(0,0,0,0.06);z-index:1;`;

            // 버튼 위치 기준으로 팝업 위치 계산 (documentSheet 내 절대 좌표 기준 scroll 포함)
            const scrollTop = sheet.scrollTop || 0;
            let popTop = (btnRect.bottom - sheetRect.top) + scrollTop + 8;
            let popLeft = (btnRect.left - sheetRect.left) - boxW / 2 + btnRect.width / 2;
            // 경계 보정
            popLeft = Math.max(8, Math.min(popLeft, sheetRect.width - boxW - 8));
            if (popTop + boxMaxH > sheetRect.height + scrollTop - 8) {
                popTop = (btnRect.top - sheetRect.top) + scrollTop - boxMaxH - 8;
            }
            popTop = Math.max(scrollTop + 8, popTop);
            box.style.top = popTop + 'px';
            box.style.left = popLeft + 'px';

            // 헤더 (X 닫기)
            const _textCol = '#1e293b';
            const head = document.createElement('div');
            head.style.cssText = `padding:0.5rem 0.75rem;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;`;
            const title = document.createElement('span');
            title.style.cssText = `font-size:0.75rem;font-weight:700;color:${acCol};`;
            // [툴팁N] → 팝업 레이블로 변환
            const labelEl2 = getById('childPanelLabel_' + id);
            title.textContent = '💬 ' + (labelEl2?.textContent || id);
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '✕';
            closeBtn.style.cssText = `background:none;border:none;font-size:0.9rem;font-weight:900;color:#64748b;cursor:pointer;padding:0;width:1.5rem;height:1.5rem;display:flex;align-items:center;justify-content:center;line-height:1;opacity:0.7;flex-shrink:0;`;
            closeBtn.onclick = e => { e.stopPropagation(); closeEditorPopup(); };
            head.appendChild(title);
            head.appendChild(closeBtn);

            // 내용 — 폰트·색상 엄마 위지윅과 동일
            const body = document.createElement('div');
            body.style.cssText = `padding:1.5rem;overflow-y:auto;flex:1;font-family:Pretendard,sans-serif;line-height:1.8;font-size:clamp(14px,1.702vw,16px);color:#1e293b;word-break:keep-all;`;
            // childArea 내용 복사 (placeholder 및 [툴팁N] 레이블 제외)
            const clone = childArea.cloneNode(true);
            const ph = clone.querySelector('[id^="childPlaceholder_"]');
            if (ph) ph.remove();
            clone.innerHTML = clone.innerHTML.replace(/\[툴팁\d*\]/gi, '');
            body.innerHTML = clone.innerHTML;

            // 박스 내부 클릭은 overlay로 버블링되지 않도록 차단
            box.addEventListener('mousedown', e => e.stopPropagation());

            box.appendChild(head);
            box.appendChild(body);
            overlay.appendChild(box);
            sheet.appendChild(overlay);
            activeEditorPopup = overlay;
        }

        function closeEditorPopup() {
            if (activeEditorPopup) {
                activeEditorPopup.remove();
                activeEditorPopup = null;
            }
        }

        // 팝업 트리거 클릭 — 에디터에서는 콘텐츠 영역 내에 팝업 미리보기 (딤드)
        document.addEventListener('click', e => {
            const btn = e.target.closest('.popup-trigger');
            if (!btn) return;
            const id = btn.dataset.popup;
            const area = getById('contentArea');
            if (area && area.contains(btn)) {
                e.preventDefault();
                e.stopPropagation();
                // 자식 패널이 없으면 생성
                if (!childPanels.find(p => p.id === id)) addChildPanel(id);
                // 콘텐츠 영역 내 팝업 미리보기 (documentSheet 딤드)
                showEditorPopup(btn, id);
            }
        });

        // 팝업 패널 이미지 렌더링 (내보내기용)
        async function renderChildPanelAsImage(id) {
            const sheet = getById('childSheet_' + id);
            if (!sheet) return null;
            const area = getById('childArea_' + id);
            const bgCol = getById('bgPicker')?.value || area.style.backgroundColor || '#ffffff';
            try {
                const canvas = await htmlToImage.toCanvas(sheet, {
                    pixelRatio: 2, backgroundColor: bgCol,
                    skipFonts: true, useCORS: true,
                    filter: node => {
                        if (node.id && node.id.startsWith('childSheet_') && node.id !== 'childSheet_' + id) return false;
                        return true;
                    }
                });
                return canvas.toDataURL('image/jpeg', 0.92);
            } catch(e) { console.error('popup render failed', e); return null; }
        }

        // 자식 패널 HTML → 인라인 onclick 팝업으로 변환 (사이냅에디터 호환)
        // 사이냅에디터는 <script> 블록을 strip하므로 반드시 onclick 인라인 방식 사용
        // 팝업 콘텐츠는 se-popup-content div에서 읽지 않고 onclick에 직접 인코딩
        function buildInlinePopupHtml(exportHtml, popupImagePaths, forPreview) {
            if (!childPanels.length) return exportHtml;
            popupImagePaths = popupImagePaths || {};
            // accentPicker가 기본값(#888888)일 경우 생성된 HTML에서 accent 색상 직접 추출
            let _acColor = getById('accentPicker')?.value || '#7c3aed';
            if (!_acColor || _acColor === '#888888') {
                const _acMatch = exportHtml.match(/background-color:\s*(#[0-9a-fA-F]{6})/);
                if (_acMatch) _acColor = _acMatch[1];
            }

            let result = exportHtml;

            childPanels.forEach(panel => {
                const id = panel.id;
                const imgPath = popupImagePaths[id];

                const layerId = '__popup_' + id + '__';
                // 오버레이: se-contents 기준 fixed 딤드
                const _overlayJs = [
                    `var _cont=document.querySelector('.se-contents')||document.querySelector('div[style*=max-width]')||document.documentElement;`,
                    `var _cr=_cont.getBoundingClientRect();`,
                    `d.style='position:fixed;top:0;left:'+Math.round(_cr.left)+'px;width:'+Math.round(_cr.width)+'px;height:100%;background:#000000B8;z-index:99999;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:1rem;box-sizing:border-box;display:flex;align-items:flex-start;justify-content:center;';`,
                ].join('');

                let onclickCode = '';
                if (imgPath) {
                    onclickCode = [
                        `var ex=document.getElementById('${layerId}');if(ex){ex.remove();return;}`,
                        `var d=document.createElement('div');d.id='${layerId}';`,
                        _overlayJs,
                        `var wrap=document.createElement('div');wrap.style='position:relative;width:100%;max-width:740px;margin:0 auto;';`,
                        `var img=document.createElement('img');img.src='${imgPath}';img.style='display:block;width:100%;height:auto;border-radius:0.75rem;';`,
                        `var close=document.createElement('button');close.innerHTML='\\u2715';`,
                        `close.style='position:absolute;top:-0.875rem;right:-0.875rem;background:${_acColor};color:#ffffff;border:none;border-radius:50%;width:1.75rem;height:1.75rem;font-size:0.875rem;font-weight:900;cursor:pointer;z-index:10;display:inline-flex;align-items:center;justify-content:center;line-height:1;';`,
                        `close.onclick=function(e){e.stopPropagation();d.remove();};`,
                        `wrap.appendChild(img);wrap.appendChild(close);d.appendChild(wrap);`,
                        `d.addEventListener('touchstart',function(e){if(e.target===d)d.remove();},{passive:true});`,
                        `d.onclick=function(e){if(e.target===d)d.remove();};document.body.appendChild(d);`,
                    ].join('');
                } else {
                    const area = getById('childArea_' + id);
                    if (!area) return;
                    const text = area.innerText.trim();
                    if (!text || text.includes('내용을 여기에 입력하세요')) return;
                    const clone = area.cloneNode(true);
                    clone.querySelectorAll('.active-layer').forEach(el => el.classList.remove('active-layer'));
                    clone.querySelectorAll('.resizer-handle').forEach(el => el.remove());
                    clone.querySelectorAll('button, [role="button"], a').forEach(el => {
                        const txt = (el.textContent || '').trim();
                        if (['×', '✕', '✗', 'X', '닫기', 'Close', 'CLOSE'].includes(txt)) el.remove();
                    });
                    const content = clone.innerHTML.trim();
                    const escaped = content
                        .replace(/\\/g, '\\\\')
                        .replace(/'/g, "\\'")
                        .replace(/"/g, '&quot;')
                        .replace(/\n/g, '');

                    onclickCode = [
                        `var ex=document.getElementById('${layerId}');if(ex){ex.remove();return;}`,
                        `var d=document.createElement('div');d.id='${layerId}';`,
                        _overlayJs,
                        `var wrap=document.createElement('div');wrap.style='position:relative;width:100%;max-width:740px;margin:0 auto;';`,
                        `var box=document.createElement('div');`,
                        `box.style='background:#ffffff;border-radius:0.75rem;overflow-y:auto;padding:1.5rem;max-height:80vh;font-family:Pretendard,sans-serif;line-height:1.8;box-sizing:border-box;-webkit-overflow-scrolling:touch;color:#1e293b;box-shadow:0 4px 32px #0000002e;';`,
                        `box.innerHTML='${escaped}';`,
                        `var close=document.createElement('button');close.innerHTML='\\u2715';`,
                        `close.style='position:absolute;top:-0.875rem;right:-0.875rem;background:${_acColor};color:#ffffff;border:none;border-radius:50%;width:1.75rem;height:1.75rem;font-size:0.875rem;font-weight:900;cursor:pointer;z-index:10;display:inline-flex;align-items:center;justify-content:center;line-height:1;';`,
                        `close.onclick=function(e){e.stopPropagation();d.remove();};`,
                        `wrap.appendChild(box);wrap.appendChild(close);d.appendChild(wrap);`,
                        `d.addEventListener('touchstart',function(e){if(e.target===d)d.remove();},{passive:true});`,
                        `d.onclick=function(e){if(e.target===d)d.remove();};`,
                        `document.body.appendChild(d);`,
                    ].join('');
                }

                // button + a 태그 모두 매칭 (에디터에서 button, 내보내기에서 a로 변환)
                const triggerRe = new RegExp(
                    `<(?:button|a)[^>]*data-popup="${id}"[^>]*>[\\s\\S]*?<\\/(?:button|a)>`,
                    'g'
                );
                result = result.replace(triggerRe, () => {
                    const btnStyle = `display:inline-flex;align-items:center;justify-content:center;width:1.375rem;height:1.375rem;border-radius:50%;background-color:${_acColor};color:#ffffff;font-size:0.75rem;font-weight:900;border:none;cursor:pointer;vertical-align:middle;margin:0 0.25rem;line-height:1;text-decoration:none;`;
                    if (forPreview) {
                        // 미리보기 iframe: onclick 방식 (sandbox에서 javascript: href 실행 안 됨)
                        const safeOnclick = onclickCode.replace(/"/g, '&quot;');
                        return `<button class="popup-trigger" data-popup="${id}" onclick="${safeOnclick}" style="${btnStyle}">+</button>`;
                    }
                    // 게시용: <a href="javascript:..."> — 사이냅에디터가 onclick을 strip해도 href는 보존
                    const hrefCode = `javascript:void((function(){${onclickCode}})())`;
                    return `<a class="popup-trigger" data-popup="${id}" href="${hrefCode}" style="${btnStyle}">+</a>`;
                });
            });

            return result;
        }
        // ── 팝업 패널 시스템 끝 ─────────────────────────────────────────────

        function insertVideoToEditor(file) {
            const reader = new FileReader();
            reader.onload = function(ev) {
                const dataUrl = ev.target.result;
                // 재생: blob URL 사용 (data URL은 대용량 영상에서 재생 안 됨)
                const blobUrl = URL.createObjectURL(file);
                videoObjectUrlMap.set(blobUrl, dataUrl); // 내보내기용 매핑 저장

                const area = getById('contentArea');
                // wrapper에서 font-size:0;line-height:0 제거 — 영상 높이 정상 표시
                const videoHTML = `<div class="se-div" style="margin:0;padding:0;"><video src="${blobUrl}" autoplay loop muted playsinline style="display:block;margin:0 auto;" preload="metadata"></video></div>`;
                recordState();
                area.focus();
                if (savedRange) {
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(savedRange);
                    document.execCommand('insertHTML', false, videoHTML);
                } else {
                    area.insertAdjacentHTML('beforeend', videoHTML);
                }
                // 원본 사이즈 적용: 메타데이터 로드 후 videoWidth/Height로 크기 설정
                const insertedVideo = area.querySelector(`video[src="${blobUrl}"]`);
                if (insertedVideo) {
                    insertedVideo.addEventListener('loadedmetadata', function() {
                        if (this.videoWidth > 0) {
                            const containerW = area.offsetWidth || 840;
                            const useW = Math.min(this.videoWidth, containerW);
                            const ratio = this.videoHeight / this.videoWidth;
                            this.style.width = useW + 'px';
                            this.style.height = Math.round(useW * ratio) + 'px';
                            this.style.maxWidth = '100%';
                        }
                    }, { once: true });
                }
                // 사이드바 미리보기
                const preview = getById('videoPreview');
                if (preview) {
                    preview.innerHTML = `<div class="flex items-center gap-2 p-2 bg-violet-50 rounded-lg border border-violet-100">
                        <span class="text-[10px] font-bold text-violet-600">🎬 ${file.name}</span>
                        <button onclick="getById('videoPreview').innerHTML=''" class="ml-auto text-[9px] text-red-400 font-bold">✕</button>
                    </div>`;
                }
                recordState();
                showToast('영상이 에디터에 삽입되었습니다.');
            };
            reader.readAsDataURL(file);
        }

        function setLogoPos(pos) {
            logoPos = pos;
            const btnL = getById('logoPosLeft');
            const btnR = getById('logoPosRight');
            if (btnL) btnL.className = pos === 'left'
                ? 'px-3 py-1 text-[10px] font-black rounded-lg border border-indigo-400 bg-indigo-500 text-white transition-colors'
                : 'px-3 py-1 text-[10px] font-black rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors';
            if (btnR) btnR.className = pos === 'right'
                ? 'px-3 py-1 text-[10px] font-black rounded-lg border border-indigo-400 bg-indigo-500 text-white transition-colors'
                : 'px-3 py-1 text-[10px] font-black rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors';
            updateLogoOverlay();
        }

        function updateLogoOverlay() {
            const slider = getById('logoSizeSlider');
            const label  = getById('logoSizeLabel');
            if (slider) { logoSize = parseInt(slider.value); }
            if (label)  { label.textContent = logoSize + '%'; }
            renderLogoOverlay();
        }

        // 히어로 이미지 + 로고 캔버스 합성
        async function compositeHeroWithLogo() {
            const heroImg = getById('mainHeroImg');
            if (!heroImg || !heroImg.src || heroImg.classList.contains('hidden')) return null;
            if (!logoBase64) return heroImg.src; // 로고 없으면 히어로만

            return new Promise(resolve => {
                const canvas = document.createElement('canvas');
                const hw = heroImg.naturalWidth || heroImg.offsetWidth;
                const hh = heroImg.naturalHeight || heroImg.offsetHeight;
                canvas.width = hw;
                canvas.height = hh;
                const ctx = canvas.getContext('2d');

                // 히어로 이미지 그리기
                const hi = new Image();
                hi.crossOrigin = 'anonymous';
                hi.onload = () => {
                    ctx.drawImage(hi, 0, 0, hw, hh);

                    // 로고 그리기
                    const li = new Image();
                    li.onload = () => {
                        const lw = Math.round(hw * logoSize / 100);
                        const lh = Math.round(li.naturalHeight * (lw / li.naturalWidth));
                        const lx = logoPos === 'left' ? Math.round(hw * 0.03) : Math.round(hw * 0.97) - lw;
                        const ly = Math.round(hh * 0.03);
                        ctx.drawImage(li, lx, ly, lw, lh);
                        resolve(canvas.toDataURL('image/jpeg', 0.95));
                    };
                    li.onerror = () => resolve(canvas.toDataURL('image/jpeg', 0.95));
                    li.src = logoBase64;
                };
                hi.onerror = () => resolve(heroImg.src);
                hi.src = heroImg.src.startsWith('data:') ? heroImg.src : heroImg.src;
            });
        }

        function renderLogoOverlay() {
            const heroDiv = getById('heroDiv');
            if (!heroDiv) return;
            // 기존 로고 오버레이 제거
            const old = heroDiv.querySelector('#heroLogoOverlay');
            if (old) old.remove();
            if (!logoBase64) return;
            const overlay = document.createElement('img');
            overlay.id = 'heroLogoOverlay';
            overlay.src = logoBase64;
            overlay.style.cssText = `position:absolute;top:3%;${logoPos === 'left' ? 'left:3%' : 'right:3%'};width:${logoSize}%;height:auto;pointer-events:none;z-index:10;`;
            heroDiv.appendChild(overlay);
        }

        function loadLogoFile(file) {
            if (!file || !isImageFile(file)) return;
            const r = new FileReader();
            r.onload = ev => {
                logoBase64 = ev.target.result;
                // 미리보기
                const preview = getById('logoPreview');
                if (preview) preview.innerHTML = `
                    <div class="relative w-full h-full group">
                        <img src="${logoBase64}" class="w-full h-full object-contain p-1.5">
                        <button onclick="logoBase64=null;getById('logoPreview').innerHTML='';getById('logoControls').classList.add('hidden');renderLogoOverlay();"
                            class="absolute top-0 right-0 bg-red-500/80 text-white w-4 h-4 flex items-center justify-center text-[8px] font-bold opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-bl-sm rounded-tr-xl">✕</button>
                    </div>`;
                getById('logoControls').classList.remove('hidden');
                renderLogoOverlay();
                showToast('로고가 등록되었습니다.');
            };
            r.readAsDataURL(file);
        }

        async function generateHeroImage() {
            const rawData = getById('heroInputForm').value;
            const style = (getById('heroStyle').value || '').replace(/\*\*/g, '').trim();
            if (!rawData) return showToast("정보를 입력하세요.");
            // API 키 없으면 포커스 이동
            const apiKeyEl = getById('apiKeyInput');
            if (!apiKeyEl.value.trim() && !apiKey) {
                showToast('⚠️ API 키를 먼저 입력하세요.');
                apiKeyEl.focus();
                apiKeyEl.style.outline = '2px solid #ef4444';
                setTimeout(() => apiKeyEl.style.outline = '', 2000);
                return;
            }

            const loaderEl  = getById('heroLoader');
            const spinnerEl = getById('heroSpinner');
            const loaderMsg = loaderEl.querySelector('p');
            loaderEl.style.display = 'flex';
            spinnerEl.style.display = 'block';

            try {
                const titleMatch = rawData.match(/\ud0c0\uc774\ud2c0:\s*(.*)/);
                const subMatch   = rawData.match(/\uc11c\ube0c\ud0c0\uc774\ud2c0:\s*(.*)/);
                const btnMatch   = rawData.match(/\ubc84\ud2bc:\s*(.*)/);
                const finalTitle = titleMatch ? titleMatch[1].trim() : rawData;
                const finalSub   = subMatch   ? subMatch[1].trim()   : "";
                const finalBtn   = (btnMatch && btnMatch[1].trim().length > 0) ? btnMatch[1].trim() : "";

                const injectedGuideline = masterGuidelineText ? `\n[MASTER GUIDELINES]\n${masterGuidelineText}` : '';
                const hasAssets = uploadedAssets.length > 0;
                const hasRef    = !!referenceImageBase64;

                if (hasRef) showToast('🖼 Style Guide REF 이미지 적용됨');

                const buttonCmd = finalBtn
                    ? `Include a stylized CTA button with exact text "${finalBtn}" (gradient fill, rounded, bottom-center).`
                    : `Do NOT draw any buttons, UI chrome, or labeled rectangles.`;

                let finalImagePrompt = '';
                let genTemperature  = 1.0;

                if (hasAssets) {
                    if (loaderMsg) loaderMsg.textContent = 'Compositing Assets \u2014 Strict Fidelity Mode...';
                    genTemperature = 0.4;

                    finalImagePrompt = [
                        style ? `[USER STYLE REQUEST \u2014 HIGHEST PRIORITY]: ${style}.` : '',
                        `[ASSET FIDELITY \u2014 ABSOLUTE]:`,
                        `The uploaded image(s) are the SOLE visual source for characters/objects.`,
                        `Copy every detail with zero artistic reinterpretation:`,
                        `  - Face structure, eye color, pupil shape, skin tone \u2014 exact copy.`,
                        `  - Hair color, style, strands \u2014 exact copy.`,
                        `  - Clothing design, colors, accessories, weapons \u2014 exact copy.`,
                        `  - Body proportions \u2014 do NOT alter.`,
                        `  - Art style of the original (chibi / realistic / etc.) \u2014 preserve exactly.`,
                        `DO NOT "improve", "enhance", or "reinterpret" ANY feature of uploaded assets.`,
                        `[BACKGROUND]:`,
                        `If the uploaded image already contains a background, use THAT background faithfully.`,
                        `Do NOT add, replace, or invent any new background elements.`,
                        `If the uploaded asset has a transparent/plain background, create a backdrop that is FULLY CONSISTENT with the asset's art style, color palette, and visual tone — the background and character must feel like they belong to the same world. Do NOT mix art styles (e.g. no photorealistic background behind a chibi/game-style character).`,
                        `[TEXT OVERLAY \u2014 VERBATIM]:`,
                        `Render the exact title text: "${finalTitle}"${finalSub ? ` and subtitle: "${finalSub}"` : ''}.`,
                        `Typography must match the style/mood of the uploaded asset. Do not invent other text.`,
                        buttonCmd,
                        `[PROHIBITIONS]: No brand logos. No watermarks. No invented characters. No AI-style "improvements" to the original asset.`,
                        injectedGuideline,
                    ].filter(Boolean).join('\n');

                } else {
                    if (loaderMsg) loaderMsg.textContent = 'PASS 1 / 2 \u2014 AI Prompt Engineering...';
                    genTemperature = 1.0;

                    let enrichedPrompt = '';
                    const enhanceSys = `You are a game promotional banner art director.
Transform user inputs into ONE precise Gemini image generation prompt (English only, no preamble).
Rules:
- STRICTLY follow the user's style directive. It is the #1 priority \u2014 do not override it.
- Add lighting/atmosphere descriptors that COMPLEMENT (not replace) the style directive.
- ${hasRef ? 'A Style Guide reference image is provided. Extract ONLY its color palette, mood, lighting style, and visual atmosphere. Do NOT replicate characters or specific assets from this image — treat it as a style reference only.' : 'No characters, humans, or avatars (no assets provided).'}
- Banner must prominently display title text: "${finalTitle}"${finalSub ? ` and subtitle: "${finalSub}"` : ''}.
- ${buttonCmd}
- No logos, no watermarks.`;

                    const enhanceUser = `Title: ${finalTitle}
Subtitle: ${finalSub || '(none)'}
Style directive: ${style || 'premium game promotional banner, cinematic, high-contrast'}
Reference image provided: ${hasRef ? 'YES \u2014 replicate character, visual style, and color palette from this reference image exactly' : 'NO'}`;

                    try {
                        const enhRes = await apiFetch(
                            `https://generativelanguage.googleapis.com/v1beta/models/${CONTENT_MODEL}:generateContent`,
                            { method: 'POST', body: JSON.stringify({
                                contents: [{ parts: [{ text: enhanceUser }] }],
                                systemInstruction: { parts: [{ text: enhanceSys }] },
                                generationConfig: { temperature: 0.8, maxOutputTokens: 600 }
                            })}
                        );
                        enrichedPrompt = enhRes.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
                    } catch(e) { console.warn('PASS 1 failed:', e.message); }

                    if (loaderMsg) loaderMsg.textContent = 'PASS 2 / 2 \u2014 Rendering Image...';

                    const noCharConstraint = hasRef ? '' : 'No characters. ';
                    finalImagePrompt = enrichedPrompt.length > 40
                        ? `${enrichedPrompt}\n[HARD CONSTRAINTS] No logos. No watermarks. ${noCharConstraint}Title verbatim: "${finalTitle}". ${finalSub ? `Subtitle verbatim: "${finalSub}".` : ''} ${buttonCmd}${hasRef ? '\n[STYLE GUIDE ATTACHED: match its color palette and mood only — do NOT copy characters]' : ''}${injectedGuideline}`
                        : [
                            style ? `Style: ${style}.` : 'Style: premium cinematic game promotional banner.',
                            hasRef ? `Match the color palette and visual atmosphere from the style guide image.` : `Background only — no characters.`,
                            `Title text verbatim: "${finalTitle}".`,
                            finalSub ? `Subtitle text verbatim: "${finalSub}".` : '',
                            buttonCmd,
                            `High-contrast, vivid color palette. No logos. No watermarks.`,
                            injectedGuideline,
                          ].filter(Boolean).join(' ');
                }

                if (!hasAssets && loaderMsg) loaderMsg.textContent = 'Rendering High-Fidelity Image...';

                // 현재 선택된 비율 버튼 확인
                const activeRatioBtn = document.querySelector('#ratioBtn11.bg-indigo-500, #ratioBtn34.bg-indigo-500, #ratioBtn43.bg-indigo-500');
                const ratioText = activeRatioBtn ? (activeRatioBtn.id === 'ratioBtn11' ? '1:1' : activeRatioBtn.id === 'ratioBtn34' ? '3:4' : '4:3') : (window._heroAspectRatio || '1:1');
                const ratioInstruction = `\n[IMAGE ASPECT RATIO: ${ratioText} — compose the image strictly for this ratio]`;

                const imgUrl = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`;

                // 레퍼런스 이미지가 있으면 이미지를 먼저 배치해 모델이 우선 인식하도록
                const parts = [];
                if (referenceImageBase64) {
                    const refMime = getMimeType(referenceImageBase64);
                    parts.push({ inlineData: { mimeType: refMime, data: referenceImageBase64.split(',')[1] } });
                }
                parts.push({ text: finalImagePrompt + ratioInstruction });
                uploadedAssets.forEach(asset => {
                    const mimeType = getMimeType(asset.b64);
                    parts.push({ inlineData: { mimeType, data: asset.b64.split(',')[1] } });
                });

                const res = await apiFetch(imgUrl, {
                    method: 'POST',
                    body: JSON.stringify({
                        contents: [{ parts }],
                        generationConfig: {
                            responseModalities: ["IMAGE", "TEXT"],
                            temperature: genTemperature,
                        }
                    })
                });

                const b64 = res.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
                if (b64) {
                    applyHeroImage("data:image/png;base64," + b64, true);
                } else {
                    throw new Error("\uc774\ubbf8\uc9c0 \ub370\uc774\ud130\ub97c \ubc1b\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4. API \uc751\ub2f5\uc744 \ud655\uc778\ud558\uc138\uc694.");
                }

            } catch (e) {
                console.error(e);
                showToast("\ud788\uc5b4\ub85c \uc0dd\uc131 \uc2e4\ud328: " + e.message);
            } finally {
                loaderEl.style.display = 'none';
                spinnerEl.style.display = 'none';
                const loaderMsgEl = loaderEl.querySelector('p');
                if (loaderMsgEl) loaderMsgEl.textContent = 'Rendering Fidelity Banner...';
            }
        }

        function extractStyleFingerprint() {
            const area = getById('contentArea');
            if (!area || !area.innerHTML.trim()) return null;

            const html = area.innerHTML;

            const colorSet = new Set();
            const colorPattern = /#[0-9a-fA-F]{6}/g;
            let m;
            while ((m = colorPattern.exec(html)) !== null) colorSet.add(m[0]);
            const rgbaPattern = /rgba?\([^)]+\)/g;
            while ((m = rgbaPattern.exec(html)) !== null) colorSet.add(m[0]);
            const colors = [...colorSet].slice(0, 20);

            const radiusSet = new Set();
            const radiusPattern = /border-radius\s*:\s*([^;]+)/g;
            while ((m = radiusPattern.exec(html)) !== null) radiusSet.add(m[1].trim());

            const paddingSet = new Set();
            const paddingPattern = /padding\s*:\s*([^;]+)/g;
            while ((m = paddingPattern.exec(html)) !== null) paddingSet.add(m[1].trim());

            const fontSet = new Set();
            const fontPattern = /font-size\s*:\s*([^;]+)/g;
            while ((m = fontPattern.exec(html)) !== null) fontSet.add(m[1].trim());

            const weightSet = new Set();
            const weightPattern = /font-weight\s*:\s*([^;]+)/g;
            while ((m = weightPattern.exec(html)) !== null) weightSet.add(m[1].trim());

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const seDivs = doc.querySelectorAll('.se-div');
            const sectionStyles = [];
            seDivs.forEach((div, i) => {
                if (i > 0 && i < 8 && div.getAttribute('style')) {
                    sectionStyles.push(div.getAttribute('style').slice(0, 200));
                }
            });

            return {
                colors: colors.join(', '),
                radii: [...radiusSet].slice(0,8).join(' | '),
                paddings: [...paddingSet].slice(0,6).join(' | '),
                fontSizes: [...fontSet].slice(0,8).join(' | '),
                fontWeights: [...weightSet].slice(0,6).join(' | '),
                sectionCount: seDivs.length,
                sectionStyles: sectionStyles.join('\n'),
            };
        }

        function expandHexColors(html) {
            return html.replace(/([:;"'\s,>])(#[0-9a-fA-F]{3})(?![0-9a-fA-F])/g, function(match, pre, hex) {
                const r = hex[1], g = hex[2], b = hex[3];
                return pre + '#' + r+r + g+g + b+b;
            });
        }

        // 브라우저가 인라인 스타일에서 hex → rgb() 변환한 것을 다시 hex로 복원
        // 사이냅에디터 규칙: rgba() / rgb() 금지, 6자리 hex만 허용
        function convertRgbToHex(html) {
            return html.replace(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gi, function(m, r, g, b) {
                return '#' + [r, g, b].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
            });
        }

        function processTooltips(html, bgColor) {
            // 툴팁 마커([툴팁N])를 완전 제거 (CSS 값 파괴 방지)
            return html.replace(/\[툴팁\d+\][^\[\]]*?(?=\[툴팁|$)/gi, '')
                       .replace(/\[툴팁\d+\]/gi, '');
        }

        
        function setPreviewMode(mode) {
            const sheet = getById('documentSheet');
            const btnPC = getById('btnViewPC');
            const btnMob = getById('btnViewMobile');
            if (!sheet) return;
            const mw = parseInt(getById('pageWidthInput')?.value)||840;
            if (mode === 'mobile') {
                sheet.style.width = '375px';
                sheet.style.maxWidth = '375px';
                sheet.style.minWidth = '320px';
                // 팝업 패널도 모바일 크기로 동기화
                document.querySelectorAll('[id^="childSheet_"]').forEach(el => {
                    el.style.width = '375px';
                    el.style.maxWidth = '100%';
                });
                const wrapper = getById('childPanelsWrapper');
                if (wrapper) { wrapper.style.width = '375px'; wrapper.style.maxWidth = '100%'; }
                if (btnPC)  btnPC.style.cssText  = 'font-size:11px;font-weight:700;padding:8px 12px;background:#f8fafc;color:#475569;';
                if (btnMob) btnMob.style.cssText = 'font-size:11px;font-weight:700;padding:8px 12px;background:#4f46e5;color:#fff;';
                showToast('\ud83d\udcf1 \ubaa8\ubc14\uc77c \ubdf0 (375px)');
            } else {
                sheet.style.width = mw + 'px';
                sheet.style.maxWidth = mw + 'px';
                // 팝업 패널도 PC 크기로 복원 (childSheet는 엄마보다 약간 작게)
                const childW = Math.min(Math.round(mw * 0.88), 740);
                document.querySelectorAll('[id^="childSheet_"]').forEach(el => {
                    el.style.width = childW + 'px';
                    el.style.maxWidth = '100%';
                });
                const wrapper = getById('childPanelsWrapper');
                if (wrapper) { wrapper.style.width = childW + 'px'; wrapper.style.maxWidth = '100%'; }
                if (btnPC)  btnPC.style.cssText  = 'font-size:11px;font-weight:700;padding:8px 12px;background:#4f46e5;color:#fff;';
                if (btnMob) btnMob.style.cssText = 'font-size:11px;font-weight:700;padding:8px 12px;background:#f8fafc;color:#475569;';
                showToast('\ud83d\udda5 PC \ubdf0 (' + mw + 'px)');
            }
        }

        function alignContent(dir) {
            recordState();
            if (activeLayer) {
                activeLayer.style.textAlign = dir;
                if (activeLayer.tagName === 'IMG' || activeLayer.classList.contains('custom-resizer')) {
                    activeLayer.style.display = 'block';
                    if (dir === 'center') { activeLayer.style.marginLeft='auto'; activeLayer.style.marginRight='auto'; }
                    else if (dir === 'right') { activeLayer.style.marginLeft='auto'; activeLayer.style.marginRight='0'; }
                    else { activeLayer.style.marginLeft='0'; activeLayer.style.marginRight='auto'; }
                }
            } else {
                const cmds = {left:'justifyLeft', center:'justifyCenter', right:'justifyRight'};
                document.execCommand(cmds[dir]||'justifyLeft', false, null);
            }
            recordState();
        }

        // ── 스마트 업데이트 헬퍼 ────────────────────────────────────────────
        function normSectionText(el) {
            return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        }
        function sectionSimilarity(a, b) {
            const at = normSectionText(a), bt = normSectionText(b);
            if (!at && !bt) return 1;
            if (!at || !bt) return 0;
            const aw = at.split(' ').filter(w => w.length > 1);
            const bSet = new Set(bt.split(' ').filter(w => w.length > 1));
            if (!aw.length || !bSet.size) return 0;
            const hits = aw.filter(w => bSet.has(w)).length;
            return hits / Math.max(aw.length, bSet.size);
        }
        function tagSectionsWithId(area) {
            if (!area) return;
            Array.from(area.querySelectorAll(':scope > *')).forEach((el, i) => {
                if (!el.dataset.sectionId) el.dataset.sectionId = 'sec-' + i;
            });
        }
        function hasExistingContent(area) {
            if (!area) return false;
            return Array.from(area.children).some(
                el => el.id !== 'initialNotice' && (el.textContent || '').trim().length > 20
            );
        }
        // 새 HTML과 기존 DOM을 섹션 단위 비교 — 유사 섹션은 유지, 변경 섹션만 교체
        function applySmartUpdate(newHtml, area) {
            const tmp = document.createElement('div');
            tmp.innerHTML = newHtml;
            const oldSecs = Array.from(area.querySelectorAll(':scope > *'))
                .filter(el => el.id !== 'initialNotice');
            const newSecs = Array.from(tmp.children);
            newSecs.forEach((el, i) => { el.dataset.sectionId = 'sec-' + i; });

            let kept = 0, replaced = 0;
            newSecs.forEach((newSec, i) => {
                const oldSec = oldSecs[i];
                if (!oldSec) {
                    // 새로 추가된 섹션
                    area.appendChild(newSec.cloneNode(true));
                    replaced++;
                    return;
                }
                const sim = sectionSimilarity(oldSec, newSec);
                if (sim >= 0.62) {
                    // 내용 유사 → 기존 섹션 유지 (사용자 이미지·편집 보존)
                    if (!oldSec.dataset.sectionId) oldSec.dataset.sectionId = 'sec-' + i;
                    kept++;
                } else {
                    // 내용 변경 → 새 섹션으로 교체
                    newSec.dataset.sectionId = 'sec-' + i;
                    oldSec.replaceWith(newSec.cloneNode(true));
                    replaced++;
                }
            });
            // 초과 기존 섹션 제거 (새 섹션 수보다 많을 때)
            oldSecs.slice(newSecs.length).forEach(el => el.remove());
            return { kept, replaced };
        }


        async function generateContent() {
            const data = getById('contentData').value.trim();
            const style = getById('contentStyle').value.trim();
            if (!data) return showToast('데이터를 입력하세요.');
            // API 키 없으면 포커스 이동
            const apiKeyEl = getById('apiKeyInput');
            if (!apiKeyEl.value.trim() && !apiKey) {
                showToast('⚠️ API 키를 먼저 입력하세요.');
                apiKeyEl.focus();
                apiKeyEl.style.outline = '2px solid #ef4444';
                setTimeout(() => apiKeyEl.style.outline = '', 2000);
                return;
            }

            recordState();
            getById('contentSpinner').style.display = 'block';
            try {
                const bgColor = getById('bgPicker').value || '#0e0b48';
                const mw = getById('pageWidthInput')?.value || 840;
                const injectedGuideline = masterGuidelineText ? ('\n' + masterGuidelineText) : '';
                const hasRef = !!referenceImageBase64;

                const rv = parseInt(bgColor.slice(1,3),16)||14;
                const gv = parseInt(bgColor.slice(3,5),16)||11;
                const bv = parseInt(bgColor.slice(5,7),16)||72;
                const isDark = isDarkColor(bgColor);
                const textColor   = isDark ? '#f0f0f0' : '#2d2d2d';
                // bgPicker에 textColor 저장 (버튼 등 UI에서 활용)
                const bgPickerEl = getById('bgPicker');
                if (bgPickerEl) bgPickerEl.dataset.text = textColor;
                const subColor    = isDark ? '#a0aec0' : '#4a5568';
                const accentPickerVal = getById('accentPicker')?.value || '';
                let accentColor = (accentPickerVal && accentPickerVal !== '#888888') ? accentPickerVal : '';
                // 밝은 배경에서 accent가 매우 밝아 가독성 문제가 될 때만 살짝 조정 (짙어짐 방지)
                if (!isDark && accentColor) {
                    const acLum = getLuminance(accentColor);
                    if (acLum > 0.72) {
                        // 지나치게 밝은 색(파스텔 계열)만 중간 톤으로 조정: 최대 밝기 0.52까지만
                        const ar=parseInt(accentColor.slice(1,3),16), ag=parseInt(accentColor.slice(3,5),16), ab2=parseInt(accentColor.slice(5,7),16);
                        const r2=ar/255,g2=ag/255,b2=ab2/255;
                        const mx=Math.max(r2,g2,b2),mn=Math.min(r2,g2,b2);
                        let hh=0,ss=0,ll=(mx+mn)/2;
                        if(mx!==mn){const d=mx-mn;ss=ll>0.5?d/(2-mx-mn):d/(mx+mn);switch(mx){case r2:hh=(g2-b2)/d+(g2<b2?6:0);break;case g2:hh=(b2-r2)/d+2;break;default:hh=(r2-g2)/d+4;}hh/=6;}
                        const newL=Math.min(ll,0.52);
                        const q2=newL<0.5?newL*(1+ss):newL+ss-newL*ss;
                        const p2=2*newL-q2;
                        const h2r=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
                        const crr=Math.round(h2r(p2,q2,hh+1/3)*255),crg=Math.round(h2r(p2,q2,hh)*255),crb=Math.round(h2r(p2,q2,hh-1/3)*255);
                        accentColor='#'+[crr,crg,crb].map(x=>Math.max(0,Math.min(255,x)).toString(16).padStart(2,'0')).join('');
                    }
                }
                // accent 미설정이면 배경 기반 자동 선택
                if (!accentColor) accentColor = isDark ? (bv>rv&&bv>gv ? '#00c8ff' : '#ffd700') : '#2563eb';

                // accent 채도 부스트 — 탁한 파스텔 방지 (최소 채도 0.72, 최대 0.95)
                (function boostAccentSat() {
                    const ar=parseInt(accentColor.slice(1,3),16),ag=parseInt(accentColor.slice(3,5),16),ab=parseInt(accentColor.slice(5,7),16);
                    const r=ar/255,g=ag/255,b=ab/255;
                    const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
                    if(mx===mn) return; // 무채색은 건드리지 않음
                    let hh=0,ss=0,ll=(mx+mn)/2;
                    const d=mx-mn; ss=ll>0.5?d/(2-mx-mn):d/(mx+mn);
                    switch(mx){case r:hh=(g-b)/d+(g<b?6:0);break;case g:hh=(b-r)/d+2;break;default:hh=(r-g)/d+4;}hh/=6;
                    // 항상 부스트 적용 (0.72 이상도 더 선명하게)
                    const newS=Math.min(Math.max(ss,0.85)*1.15,0.99);
                    const q=ll<0.5?ll*(1+newS):ll+newS-ll*newS,p=2*ll-q;
                    const h2r=(pt,qt,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return pt+(qt-pt)*6*t;if(t<1/2)return qt;if(t<2/3)return pt+(qt-pt)*(2/3-t)*6;return pt;};
                    const nr=Math.round(h2r(p,q,hh+1/3)*255),ng=Math.round(h2r(p,q,hh)*255),nb=Math.round(h2r(p,q,hh-1/3)*255);
                    accentColor='#'+[nr,ng,nb].map(x=>Math.max(0,Math.min(255,x)).toString(16).padStart(2,'0')).join('');
                })();
                // boostAccentSat 결과를 accentPicker UI에도 반영
                (function syncPickerAfterBoost() {
                    const p = getById('accentPicker');
                    if (p && /^#[0-9a-fA-F]{6}$/.test(accentColor)) {
                        p.value = accentColor;
                        p.style.opacity = '1';
                        const sl = getById('accentSlash');
                        if (sl) sl.style.display = 'none';
                    }
                })();

                const surfaceColor = isDark ? blendHex(bgColor,'#ffffff',0.13) : blendHex(bgColor,'#000000',0.06);
                const borderColor = isDark ? blendHex(bgColor,'#ffffff',0.18) : blendHex(bgColor,'#000000',0.14);
                // accent 배경 위 텍스트 색: accent 명도 기반으로 흰/검정 자동 선택
                const accentTextColor = getLuminance(accentColor) > 140 ? '#1a1a1a' : '#ffffff';

                const systemPrompt = `[System Prompt: High-End HTML Render Engine v4.0]

# Role
너는 세계 최고 수준의 게임 프로모션 디자이너다. 단순·밀도없는 레이아웃은 FAIL.

---

# [제0원칙 — 원고 텍스트 절대 우선]
- 원고의 모든 문장·단어·숫자·특수문자를 단 한 글자도 바꾸지 말고 그대로 출력.
- 요약·압축·윤문·재해석 절대 금지. 원고에 10줄이면 HTML에도 10줄.
- 없는 내용(버튼·메뉴·푸터·저작권·임의설명·영문 부제목·슬로건) 절대 추가 금지.
- AI가 임의로 만든 영문 텍스트("Legend of Darkness", "28th Anniversary" 등) 삽입 즉시 FAIL.
- placeholder 절대 금지. 마지막 문장 누락 여부 반드시 확인.

---

# [절대 금지]
- <!DOCTYPE> <html> <head> <body> <style> 태그 생성 금지. (예외: 팝업 기능 있을 때만 <script> 허용)
- class 없는 <div> 절대 금지. 모든 div는 반드시 class="se-div" 또는 class="se-para-div" 필수.
- 모든 스타일은 인라인 style="" 만 사용.
- display:flex · display:grid · gap 금지.
- ul / ol / li 금지. 목록은 <p> 또는 <br> 사용.
- box-shadow 금지. background 단축 금지 → background-color 사용.
- rgba() 절대 금지. 색상은 반드시 6자리 hex(#rrggbb)만 사용.
- #fff #000 등 3자리 색상 금지 → #ffffff #000000.
- !important 금지.
- max-width에 px 단위 금지 → rem 사용.
- 마크다운 볼드(**텍스트**) 금지 → <p style="font-weight:900;"> 사용.
- 외부 URL <img> 절대 금지.
- 이미지 마커 (item1) (item2) 등이 원고에 명시되지 않으면 <img> 태그 생성 절대 금지.
- AI가 임의로 이미지 플레이스홀더 생성 금지. 원고에 없는 이미지 삽입 즉시 FAIL.

---



# [텍스트 인라인 스타일 — 절대 준수]
- 모든 <p> 태그에 반드시 color, font-size, line-height 인라인 속성 명시.
- 예시: <p style="color:${textColor};font-size:clamp(0.875rem,1.5vw,1rem);line-height:1.8;margin:0;">
- <span> 태그도 color 속성 필수.
- font-size 없으면 FAIL. line-height 없으면 FAIL. color 없으면 FAIL.
- rem 단위 필수. px 고정값 금지.

# [여백 시스템 — 두 가지 패턴 선택]

## 패턴 A — 박스형 섹션 (기본)
섹션이 카드 형태이고 화면 양쪽 여백이 필요할 때:
- 컨텐츠 래퍼 se-div: padding-left:clamp(16px,3.472vw,50px);padding-right:clamp(16px,3.472vw,50px);padding-top:clamp(24px,3vw,48px);padding-bottom:clamp(24px,3vw,48px);
- 섹션 se-div: 좌우 패딩 없음(이미 래퍼에서 처리), 상하 패딩만 사용

<div class="se-div" style="background-color:${bgColor};padding-top:clamp(24px,3vw,48px);padding-bottom:clamp(24px,3vw,48px);padding-left:clamp(16px,3.472vw,50px);padding-right:clamp(16px,3.472vw,50px);display:block;width:100%;box-sizing:border-box;">
  <div class="se-div" style="background-color:${surfaceColor};border:1px solid ${borderColor};border-radius:0.875rem;overflow:hidden;padding:1.75rem 2rem;margin-bottom:1.5rem;">섹션내용</div>
  <div class="se-div" style="background-color:${surfaceColor};border:1px solid ${borderColor};border-radius:0.875rem;overflow:hidden;padding:1.75rem 2rem;margin-bottom:1.5rem;">섹션내용</div>
</div>

## 패턴 B — 풀폭형 섹션
섹션 배경색이 화면 전체 폭으로 채워져야 할 때 (톤온톤 배경색 구분):
- 컨텐츠 래퍼 se-div: padding 없음(0)
- 섹션 se-div: width:100%, 좌우 내부 여백은 padding-left:clamp(16px,3.472vw,50px);padding-right:clamp(16px,3.472vw,50px); 직접 보유

<div class="se-div" style="background-color:${bgColor};margin:0;padding:0;display:block;width:100%;box-sizing:border-box;">
  <div class="se-div" style="background-color:${surfaceColor};width:100%;padding-top:2rem;padding-bottom:2rem;padding-left:clamp(16px,3.472vw,50px);padding-right:clamp(16px,3.472vw,50px);border-top:1px solid ${borderColor};">섹션내용</div>
  <div class="se-div" style="background-color:${bgColor};width:100%;padding-top:2rem;padding-bottom:2rem;padding-left:clamp(16px,3.472vw,50px);padding-right:clamp(16px,3.472vw,50px);border-top:1px solid ${borderColor};">섹션내용</div>
</div>

## 선택 기준
- 섹션이 카드/박스 형태 → 패턴 A
- 섹션 배경이 풀폭으로 채워지고 상단 라인으로 구분 → 패턴 B
- 두 패턴을 한 페이지에 혼용 가능


# [2단 배치 — display:flex/grid 금지 대신 이 방법만 사용]
- 좌우 2단 배치: inline-block + vertical-align 방식만 허용.
- 반드시 부모를 <div class="se-para-div" style="font-size:0;"> 로 감싸고
  각 칸을 <div class="se-div" style="display:inline-block;vertical-align:top;width:49%;font-size:clamp(0.875rem,1.5vw,1rem);"> 로 작성.
- 예시 (2단):
  <div class="se-para-div" style="font-size:0;width:100%;">
    <div class="se-div" style="display:inline-block;vertical-align:top;width:49%;padding:1.5rem;background-color:${surfaceColor};border-radius:0.5rem;">왼쪽</div>
    <div class="se-div" style="display:inline-block;vertical-align:top;width:49%;padding:1.5rem;background-color:${accentColor};border-radius:0.5rem;margin-left:2%;">오른쪽</div>
  </div>
- display:flex, display:grid, gap 사용 시 즉시 FAIL.

# [HTML 구조 — 절대 준수]

<div class="se-contents" style="font-size:clamp(0.875rem,1.702vw,1rem);font-family:'Pretendard',sans-serif;line-height:1.8;max-width:52.5rem;width:100%;margin:0 auto;background-color:transparent;display:block;word-break:keep-all;overflow-wrap:break-word;color:${textColor};letter-spacing:-0.05rem;">

  <!-- 1번 블록: 히어로 이미지 (이미지 있을 때만 생성) -->
  <div class="se-div" style="margin:0;padding:0;line-height:0;font-size:0;display:block;width:100%;"></div>

  <!-- 2번 블록: 컨텐츠 전체 래퍼 -->
  <div class="se-div" style="background-color:${bgColor};margin:0;padding:0;display:block;width:100%;box-sizing:border-box;">
    <!-- 모든 섹션 se-div: padding-left:clamp(16px,3.472vw,50px);padding-right:clamp(16px,3.472vw,50px) 필수 -->
  </div>

</div>

규칙:
- se-contents 배경은 transparent. 배경색은 2번 블록에만 적용.
- 1번(이미지)·2번(컨텐츠) 블록만 se-contents 직계 자식으로 존재. 추가 감싸기 금지.
- 배경색 ${bgColor}는 지정된 값 그대로. 임의 변경 금지.

---

# [컬러 시스템 — 5단계 팔레트]
제공 변수: ${bgColor}(배경) / ${surfaceColor}(서피스 기준) / ${accentColor}(포인트) / ${textColor}(본문) / ${subColor}(서브) / ${borderColor}(테두리)

**섹션 배경 3단계 변주** — 단조로운 동일 배경 반복 절대 금지. 아래 3종을 교차 사용:
- BG-0 (베이스): ${bgColor} — 전체 래퍼·가장 넓은 영역
- BG-1 (서피스): ${surfaceColor} — 일반 카드·기본 섹션
- BG-2 (액센트 틴트): accent+bg 혼합 hex — 중요 섹션·CTA 영역에 사용. 계산법: accentColor의 R·G·B 각각 20% + bgColor의 R·G·B 80% 혼합한 6자리 hex. 예) accent=#5b21b6, bg=#0f172a → tint=#1c1539

**액센트 포인트 규칙**:
- ${accentColor}: 번호아이콘·CTA버튼·헤더 밑줄·섹션 제목에만 한정
- 강조 border: border-left:0.25rem solid ${accentColor} 또는 border-top:0.1875rem solid ${accentColor}
- 모든 텍스트 요소(p span td th h1~h6)에 color 속성 반드시 명시

---

# [타이포그래피 — 5단계 계층]
- **대제목** (이벤트명·페이지 타이틀): font-size:clamp(1.5rem,3vw,2rem);font-weight:900;line-height:1.3;color:${accentColor};letter-spacing:-0.03em;
- **섹션 제목** (■ ▶ 번호 달린 소제목): font-size:clamp(1.125rem,2.2vw,1.375rem);font-weight:900;line-height:1.4;color:${accentColor};
- **서브 레이블** (기간·태그·배지 텍스트): font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${subColor};
- **본문**: font-size:clamp(0.875rem,1.5vw,1rem);font-weight:400;line-height:1.8;color:${textColor};
- **수치·날짜 강조**: font-size:clamp(1.5rem,3vw,2.25rem);font-weight:900;line-height:1.2;color:${accentColor};
- 모든 <p> 태그: margin:0; line-height:1.8;

---

# [고밀도 디자인 원칙 — 반드시 준수]
1. **정보 밀도**: 빈 공간 낭비 금지. 텍스트가 3줄 이하인 단독 섹션은 인접 섹션과 합치거나 2단 배치.
2. **시각 계층**: 모든 섹션에 ① 배경색 변주 ② 상단/좌측 accent 라인 ③ 타이포 대비 중 최소 1개 적용.
3. **리듬감**: BG-0 → BG-1 → BG-2 → BG-1 순으로 교차. 같은 배경 3회 연속 금지.
4. **강조 포인트**: 각 섹션에서 핵심 수치·날짜·보상 아이템은 반드시 ${accentColor}로 시각적 강조.
5. **구분 처리**: 카드 최상단에 height:0.1875rem;background-color:${accentColor};border-radius:0.1875rem 0.1875rem 0 0; 바 삽입 권장.

---

# [간격 처리 규칙 — 단일 기준]
- 요소 사이 간격: 반드시 <p style="height:Npx;margin:0;"></p> 태그로만 처리.
  - 극소: height:6px / 소: height:12px / 중: height:20px / 대: height:32px
- margin 사용 금지. <br> 단독 사용 금지. <p>&nbsp;</p> 금지.
- 모든 <p> 태그: margin:0; line-height:1.8;

---

# [섹션 구조 — 고밀도 패턴]
- 모든 내부 div에 class="se-div" 필수. class 없는 div 절대 금지.
- 테이블은 섹션 se-div 안에 직접 배치. 추가 래퍼 div 금지.
- 위 [여백 시스템] 패턴 A 또는 B 중 하나를 선택해서 사용.
- 패턴 A 카드: border-radius:0.875rem; border:1px solid ${borderColor}; 상단 accent 바 필수.
- 패턴 B 풀폭: border-top:2px solid ${accentColor} 으로 강한 구분선 처리.
- **⚠️ 절대 규칙: 하나의 콘텐츠 내에서 모든 섹션은 반드시 동일한 디자인 패턴(A 또는 B)만 사용. 섹션마다 다른 패턴(예: 어떤 섹션은 카드형, 다른 섹션은 border-left 액센트)을 혼합하면 FAIL.**
- border-left 액센트 라인은 단독 사용 금지. 패턴 A의 카드 border 안에서만 사용 가능.
- **카드 상단 accent 바 필수 패턴**:
  <div class="se-div" style="height:0.1875rem;max-height:0.1875rem;overflow:hidden;font-size:0;line-height:0;background-color:${accentColor};border-radius:0.1875rem 0.1875rem 0 0;margin:0;"></div>

---

# [이미지 규칙]
- <img> 필수 style: max-width:100%;height:auto;display:block;margin:0 auto;
- width · height 고정값 금지. object-fit · object-position 금지.
- img를 div·span으로 감싸지 말 것. 단독 사용.
- position:absolute/fixed/relative · float · z-index 금지.
- 이미지 블록 se-div: style="margin:0;padding:0;display:block;line-height:0;font-size:0;"
- 원고에 (item_01) (img1) 등 이미지 마커가 있으면 반드시 그 위치에 텍스트 그대로 보존. 예: <p style="...">(item_01)</p> — img 태그로 바꾸지 말 것. 시스템이 자동 매칭함.
- 이미지 마커를 설명 텍스트로 바꾸거나 삭제하면 즉시 FAIL.

---

# [테이블 규칙 — 절대 준수]
- 테이블 최상단에 빈 행 생성 절대 금지. 즉시 FAIL.
- <thead>나 <tbody> 시작 전에 빈 행 삽입 금지.
- 데이터가 없는 행 생성 금지.
- 이미지 마커가 있는 경우에만 이미지 셀 생성. 없으면 텍스트 셀만.
- **테이블 구조 필수 패턴** (반드시 이 순서):

<table style="width:100%;border-collapse:collapse;table-layout:fixed;margin:0;">
  <thead>
    <tr style="background-color:${surfaceColor};border-bottom:1px solid ${accentColor};">
      <th style="padding:0.875rem 1rem;border:1px solid ${borderColor};border-bottom:1px solid ${accentColor};font-weight:700;color:${accentColor};text-align:center;background-color:${surfaceColor};word-break:keep-all;overflow-wrap:break-word;vertical-align:middle;line-height:1.4;box-sizing:border-box;min-width:2.5rem;font-size:clamp(0.8125rem,1.5vw,0.9375rem);">헤더1</th>
      <th style="padding:0.875rem 1rem;border:1px solid ${borderColor};border-bottom:1px solid ${accentColor};font-weight:700;color:${accentColor};text-align:center;background-color:${surfaceColor};word-break:keep-all;overflow-wrap:break-word;vertical-align:middle;line-height:1.4;box-sizing:border-box;min-width:2.5rem;font-size:clamp(0.8125rem,1.5vw,0.9375rem);">헤더2</th>
    </tr>
  </thead>
  <tbody>
    <tr style="border-bottom:1px solid ${borderColor};">
      <td style="padding:0.875rem 1rem;border:1px solid ${borderColor};border-bottom:1px solid ${borderColor};color:${textColor};text-align:center;vertical-align:middle;word-break:keep-all;overflow-wrap:break-word;line-height:1.4;box-sizing:border-box;min-width:2.5rem;font-size:clamp(0.8125rem,1.5vw,0.9375rem);">값1</td>
      <td style="padding:0.875rem 1rem;border:1px solid ${borderColor};border-bottom:1px solid ${borderColor};color:${textColor};text-align:center;vertical-align:middle;word-break:keep-all;overflow-wrap:break-word;line-height:1.4;box-sizing:border-box;min-width:2.5rem;font-size:clamp(0.8125rem,1.5vw,0.9375rem);">값2</td>
    </tr>
  </tbody>
</table>

- <thead> 첫 번째 <tr>은 반드시 헤더 텍스트가 있어야 함. 빈 <tr> 절대 금지.
- <tbody>에는 데이터 행만 포함. 빈 행 절대 금지.
- 표 데이터는 반드시 <table>. div 대체 절대 금지.
- 테이블은 섹션 se-div 안에 직접 배치. **별도 래퍼 div 추가 금지.**
- table: style="width:100%;border-collapse:collapse;table-layout:fixed;margin:0;"
- th: style="padding:0.875rem 1rem;border:1px solid ${borderColor};border-bottom:1px solid ${accentColor};font-weight:700;color:${accentColor};text-align:center;background-color:${surfaceColor};word-break:keep-all;overflow-wrap:break-word;vertical-align:middle;line-height:1.4;box-sizing:border-box;min-width:2.5rem;font-size:inherit;"
- td: style="padding:0.875rem 1rem;border:1px solid ${borderColor};border-bottom:1px solid ${borderColor};color:${textColor};text-align:center;vertical-align:middle;word-break:keep-all;overflow-wrap:break-word;line-height:1.4;box-sizing:border-box;min-width:2.5rem;font-size:inherit;"
- 짝수 행: background-color:${surfaceColor}
- 모든 th·td에 width% 명시. colspan/rowspan 적극 활용.
- 이미지 마커 (item1) 있을 때만 이미지 셀 생성. 마커 없으면 이미지 셀 생성 금지.
- 데이터 없는 빈 행 생성 금지.

---

# [버튼 — 키워드 없으면 생성 금지]

## 괄호 개수에 따른 배치 구분 — 반드시 준수
- [대버튼] (대괄호 1쌍): 현재 섹션 카드 내부에 배치. <div class="se-div" style="padding:0;margin:0;text-align:center;"> 래퍼 안에 삽입.
- [[대버튼]] (대괄호 2쌍): 섹션 카드 외부에 독립 배치. 어떤 se-div에도 속하지 않으며, 섹션과 섹션 사이 또는 전체 콘텐츠 끝에 단독 블록으로 위치. 래퍼 div 사용 동일.
- [[중버튼]] / [[소버튼]]도 동일 규칙: 괄호 2쌍이면 섹션 외부 독립 배치.

## 버튼 스타일
- [대버튼]: <div class="se-div" style="padding:0;margin:0;text-align:center;"> 래퍼 안에 <a> 또는 <button> 배치. 래퍼 div에는 반드시 padding:0 — 패딩은 버튼 요소에만 적용.
  버튼 스타일: display:block;width:100%;padding:1.5rem 0;font-weight:800;border-radius:0.75rem;background-color:${accentColor};color:${accentTextColor};text-align:center;text-decoration:none;font-size:inherit;border:none;cursor:pointer;box-sizing:border-box;
- [중버튼]: display:inline-block;padding:1rem 3.25rem;font-weight:700;border-radius:2rem;border:2px solid ${accentColor};color:${accentColor};text-decoration:none;
- [소버튼]: display:inline-block;padding:0.625rem 1.5rem;font-size:inherit;border-radius:0.5rem;text-decoration:none;

---

# [탭 시스템]
- 탭 버튼 텍스트에 "tab01" 등 지시어 노출 금지. 원고의 실제 탭 제목만.
- <a href="#tab01"> ↔ <div class="se-div" id="tab01"> 1:1 매칭 필수.
- 탭 바 컨테이너: display:block;width:100%;text-align:center;padding:0.5rem 0;
- 탭 버튼(a 태그): display:inline-block;padding:0.625rem 1.5rem;margin:0.25rem;border-radius:2rem;font-weight:700;text-decoration:none;word-break:keep-all;white-space:nowrap;
- 활성 탭: background-color:${accentColor};color:${accentTextColor};
- 비활성 탭: background-color:${surfaceColor};color:${subColor};
- 탭 버튼은 반드시 면(fill) 방식. underline/border-bottom 방식 절대 금지.
- 각 탭 섹션 se-div에 id="tab01" 부여. 각 섹션 상단에 탭 바 반복.
- Tab01. / Tab02. 텍스트는 HTML에 절대 노출 금지.

---

# [팝업 시스템 — 반드시 준수]
원고에 [팝업1], [팝업2] 등 마커가 있으면 아래 두 가지를 반드시 함께 생성한다.

## 1. 트리거 버튼 (본문 안에 삽입)
마커 위치에 아래 버튼을 삽입:
<button class="popup-trigger" data-popup="popup_N" style="display:inline-block;width:1.375rem;height:1.375rem;line-height:1;border-radius:50%;background-color:#7c3aed;color:#ffffff;font-size:0.75rem;font-weight:900;border:none;cursor:pointer;vertical-align:middle;margin:0 0.25rem;text-align:center;">+</button>

## 2. 팝업 내용 블록 (HTML 최하단에 모아서 출력)
팝업 트리거에 대응하는 내용을 원고에서 파악해서 아래 형식으로 HTML 최하단에 출력:
<div class="se-popup-content" data-popup="popup_N" style="display:none;">
  [해당 팝업에 들어갈 원고 내용을 HTML로 작성]
</div>

규칙:
- 팝업 내용 블록은 반드시 class="se-popup-content" data-popup="popup_N" 속성 필수.
- style="display:none;" 필수.
- 내용은 원고에서 해당 팝업에 속하는 텍스트/표/목록을 그대로 HTML로 작성.
- [팝업N] 마커 자체는 최종 HTML에서 삭제.
- [툴팁N] 마커 사용 금지. 반드시 [팝업N]으로 대체.
- 팝업 내용 블록 안에 닫기 버튼(×, ✕, 닫기, Close 등) 절대 금지. 닫기 기능은 시스템이 자동 추가.
- <script> 태그: 슬라이드·팝업 기능 있을 때만 허용.

---

# [레이아웃 패턴 — 섹션마다 선택 적용]
A: **액센트 스트라이프** — border-left:0.3125rem solid ${accentColor};padding-left:1.25rem; + 본문 블록
B: **2단 텍스트** — <div class="se-para-div" style="font-size:0;"> 안에 width:48% × 2, margin-left:4%
   ⚠️ B패턴은 단순 텍스트 2단에만 사용. 비교형(기존/변경·전/후)은 반드시 <table> 2열로.
C: **원형 번호 타임라인** — circle 2rem, background-color:${accentColor}, color:${accentTextColor}, font-weight:900; display:inline-block;vertical-align:top;margin-right:0.875rem;
D: **pill 배지 + 본문** — <p style="display:inline-block;background-color:${accentColor};color:${accentTextColor};border-radius:1.25rem;padding:0.1875rem 0.875rem;font-size:0.75rem;font-weight:900;"> 배지 텍스트 </p>
E: **하이라이트 띠** — BG-2(액센트틴트) 배경, border-left:0.25rem solid ${accentColor}, border-radius:0.75rem, padding:1.25rem 1.5rem
F: **아이콘 리스트** — border-bottom:1px solid ${borderColor};padding:0.875rem 0; 반복 구조
G: **카드 스택** — border-radius:0.875rem;border:1px solid ${borderColor};상단 accent 바 0.1875rem 포함
H: **교차 배경 행** — 홀/짝 행 background-color: ${surfaceColor} / ${bgColor} 교차
I: **플로팅 배지 카드** — border-radius:0.875rem;border-top:0.25rem solid ${accentColor};padding:1.5rem;
J: **3열 카드** — display:inline-block;vertical-align:top;width:30%;margin:0 1.5% 1rem;border-radius:0.75rem;
K: **번호 강조 표** — 좌측 첫 열 background-color:BG-2(액센트틴트), font-weight:900, color:${accentColor}
L: **구분선 리스트** — <p style="border-bottom:1px solid ${borderColor};padding:0.75rem 0;color:${textColor};"> 반복

---

# [에디터 파서 우회 — 절대 준수]
- class 없는 <div> 절대 금지. 에디터가 삭제함.
- 컨테이너·그룹 필요 시: <div class="se-div"> 또는 <div class="se-para-div"> 만 허용.
- 가로 정렬: <div class="se-para-div"> 부모 + 내부 <div class="se-div" style="display:inline-block;vertical-align:middle;"> 조합.
- display:flex · display:grid 금지. <table>은 데이터·비교 레이아웃에 허용 (레이아웃 전용 남용 금지).

---

# [섹션 분리 — 계층 구조]
- 논리적으로 같은 주제 → 하나의 카드(se-div) 안에 묶기.
- 다른 성격(기간 vs 참여방법 vs 보상목록)일 때만 별도 카드로 분리.
- 소제목(■·▶·번호)이 하나의 주제 아래 있으면 카드 안에서 소제목으로 처리. 별도 카드 금지.
- 계층: se-contents > 대카드(se-div) > 소섹션(내부 se-div) — 과도한 분리 FAIL.
- 모든 섹션은 반드시 형제(Sibling)로 수직 적층. 중첩(Nesting) 금지.

---

# [메타 클리닝]
- tab01 tab02 [대버튼] [중버튼] [소버튼] 등 지시어는 최종 HTML에서 삭제.
- [팝업N] 마커는 삭제 금지 — 반드시 위 [팝업 시스템] 규칙에 따라 트리거 버튼으로 변환하고 se-popup-content 블록을 생성해야 함.

${injectedGuideline}`;

                const stylePreserve = getById('stylePreserveCheck')?.checked;
                let fixedGuide;

                if (stylePreserve) {
                    const fp = extractStyleFingerprint();
                    if (fp) {
                        fixedGuide = '[\uc2a4\ud0c0\uc77c \uc720\uc9c0 \ubaa8\ub4dc] \uc544\ub798 \uae30\uc874 \ub514\uc790\uc778 \uc2a4\ud0c0\uc77c\uc744 100% \ub3d9\uc77c\ud558\uac8c \uc720\uc9c0\ud558\uba74\uc11c \ub0b4\uc6a9\ub9cc \uc0c8\ub85c \uc791\uc131\ud558\ub77c. \ub808\uc774\uc544\uc6c3 \uad6c\uc870, \uc0c9\uc0c1, \ud3f0\ud2b8 \ud06c\uae30, \uc5ec\ubc31, \uce74\ub4dc \ud615\ud0dc\ub97c \uadf8\ub300\ub85c \ubcf5\uc81c\ud574\ub77c.\n'
                            + '\uae30\uc874 \uc0c9\uc0c1 \ud314\ub808\ud2b8: ' + fp.colors + '\n'
                            + '\uae30\uc874 border-radius \ud328\ud134: ' + fp.radii + '\n'
                            + '\uae30\uc874 padding \ud328\ud134: ' + fp.paddings + '\n'
                            + '\uae30\uc874 font-size \ud328\ud134: ' + fp.fontSizes + '\n'
                            + '\uae30\uc874 font-weight \ud328\ud134: ' + fp.fontWeights + '\n'
                            + '\uae30\uc874 \uc139\uc158 \uc218: ' + fp.sectionCount + '\n'
                            + '\uae30\uc874 \uc139\uc158 \uc2a4\ud0c0\uc77c \uc0d8\ud50c:\n' + fp.sectionStyles + '\n'
                            + (style ? '\ucd94\uac00 \uc2a4\ud0c0\uc77c \uc694\uccad: ' + style + '\n' : '')
                            + '\ucf58\ud150\uce20 \uc720\uc2e4 \uc808\ub300 \uae08\uc9c0.';
                        showToast('\uc2a4\ud0c0\uc77c \uc9c0\ubb38 \ucd94\ucd9c \uc644\ub8cc \u2014 \uc2a4\ud0c0\uc77c \uc720\uc9c0 \ubaa8\ub4dc\ub85c \uc0dd\uc131\ud569\ub2c8\ub2e4.');
                    } else {
                        fixedGuide = '[\ub514\uc790\uc778 \uc9c0\uc2dc] \ubc00\ub3c4\uc788\ub294 \uace0\ud004\ub9ac\ud2f0 CSS. \ub2e4\uc591\ud55c \ub808\uc774\uc544\uc6c3(A~K \ud328\ud134 \ub85c\ud14c\uc774\uc158). \ub3d9\uc77c \uc131\uaca9 \uc139\uc158 \uc77c\uad00\uc131 \uc720\uc9c0. \ucf58\ud150\uce20 \uc720\uc2e4 \uc808\ub300 \uae08\uc9c0.'
                            + (style ? ' \ucd94\uac00\uc2a4\ud0c0\uc77c: ' + style : '');
                        showToast('\uae30\uc874 HTML\uc774 \uc5c6\uc5b4 \uc77c\ubc18 \ubaa8\ub4dc\ub85c \uc0dd\uc131\ud569\ub2c8\ub2e4.');
                    }
                } else {
                    fixedGuide = '【디자인 지시】 밀도있는 고퀄리티 CSS. 다양한 레이아웃(A~K 패턴 로테이션). 동일 성격 섹션 일관성 유지. 콘텐츠 유실 절대 금지.'
                        + (style ? ' 추가스타일: ' + style : '')
                        + (hasRef ? '\n\n★ Style Guide 이미지가 첨부되었습니다. 이 이미지의 색상 팔레트, 폰트 스타일, 디자인 분위기, 레이아웃 패턴을 최우선으로 반영하세요. 이미지에서 추출한 accent 색상을 ${accentColor} 대신 사용하세요.' : '');
                }

                const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONTENT_MODEL}:generateContent`;

                // Style Guide 이미지가 있으면 컨텐츠 생성에도 함께 전달
                const contentParts = [{ text:
                    '[HTML 변환 요청]\n\n' +
                    (style ? '【사용자 디자인 스타일 요청 — 최우선 반영】\n' + style + '\n\n' : '') +
                    '★ 필수 준수 ★\n' +
                    '1. 배경색 ' + bgColor + ' 는 이미 지정된 값. 절대 바꾸지 말 것.\n' +
                    '2. 인라인 style 속성만, display:flex/grid 절대 금지\n' +
                    '3. 원고 텍스트 100% 보존 — 원고에 없는 내용 절대 생성 금지\n' +
                    '4. <img> 태그에 외부 URL(http://, https://) 절대 금지. 이미지 마커 (item1) 등이 없으면 img 태그 생성 금지.\n\n' +
                    '=== 원고 시작 ===\n' + data + '\n=== 원고 끝 ===\n\n' + fixedGuide
                }];
                if (referenceImageBase64) {
                    const refMime = getMimeType(referenceImageBase64);
                    contentParts.push({ inlineData: { mimeType: refMime, data: referenceImageBase64.split(',')[1] } });
                }

                const res = await apiFetch(url, {
                    method: 'POST',
                    body: JSON.stringify({
                        contents: [{ parts: contentParts }],
                        systemInstruction: { parts: [{ text: systemPrompt }] },
                        generationConfig: { temperature: 1.0, maxOutputTokens: 65536 }
                    })
                });

                const fr = res.candidates?.[0]?.finishReason || '';
                let raw = res.candidates?.[0]?.content?.parts?.[0]?.text || '';
                console.log('[CG] finishReason:', fr, 'len:', raw.length);
                if (!raw) throw new Error('\uc751\ub2f5 \uc5c6\uc74c');

                if (fr === 'MAX_TOKENS') {
                    showToast('\uc774\uc5b4\uc11c \uc0dd\uc131 \uc911...');
                    const r2 = await apiFetch(url, {
                        method: 'POST',
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: '\uc774 HTML\uc744 \uc798\ub9b0 \ubd80\ubd84\ubd80\ud130 \uc774\uc5b4\uc11c \uc644\uc131\ud574\uc918. HTML \ucf54\ub4dc\ub9cc:\n\n' + raw.slice(-1200) }] }],
                            systemInstruction: { parts: [{ text: 'HTML \ucf54\ub4dc\ub9cc \ucd9c\ub825. \uc774\uc5b4\uc11c \uc644\uc131.' }] },
                            generationConfig: { temperature: 0.3 }
                        })
                    });
                    const raw2 = r2.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    console.log('[CG] 2nd len:', raw2.length);
                    if (raw2) raw += raw2;
                }

                let out = raw.replace(/```html|```/g, '');
                // 마크다운 이미지 참조 완전 제거 (![text](url), attachment: 형식 모두)
                out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
                out = out.replace(/\(attachment:[^)]*\)/g, '');
                // 외부 URL img 태그 완전 제거 (CORS 오류 및 렌더링 실패 방지)
                // placeholder, 존재하지 않는 도메인 이미지 등
                out = out.replace(/<img[^>]+src\s*=\s*["']https?:\/\/[^"']*["'][^>]*>/gi, '');
                out = out.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (m, css) => {
                    const s = document.createElement('style'); s.textContent = css;
                    document.head.appendChild(s); return '';
                });
                out = out.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*\*/g, '');
                out = out.replace(/Tab\d+\.\s*/gi, '');
                // STEP 01, STEP02 등 제거
                out = out.replace(/STEP\s*\d+/gi, '');
                out = out.replace(/<ul[^>]*>/gi,'<div>').replace(/<\/ul>/gi,'</div>');
                out = out.replace(/<ol[^>]*>/gi,'<div>').replace(/<\/ol>/gi,'</div>');
                out = out.replace(/<li[^>]*>/gi,'<div style="padding:0.3rem 0;">').replace(/<\/li>/gi,'</div>');
                // div/span으로 감싼 img 제거 (custom-resizer 제외, 반복 적용)
                for (let i = 0; i < 3; i++) {
                    out = out.replace(/<(?:div|span)(?![^>]*custom-resizer)[^>]*>\s*(<img[^>]*>)\s*<\/(?:div|span)>/gi, '$1');
                }
                // div/span으로 감싼 table 제거 (반복 적용)
                for (let i = 0; i < 3; i++) {
                    out = out.replace(/<(?:div|span)[^>]*>\s*(<table[\s\S]*?<\/table>)\s*<\/(?:div|span)>/gi, '$1');
                }
                // padding-top% 빈 div 제거
                out = out.replace(/<div[^>]*padding-top\s*:\s*\d+%[^>]*>\s*<\/div>/gi, '');
                // 이미지 래퍼 div의 고정 height 제거 (이미지 겹침 원인)
                out = out.replace(/(<div[^>]*style\s*=\s*["'][^"']*)\bheight\s*:\s*[\d.]+(?:rem|px|em|vh|%)[^;]*;?/gi, '$1');
                out = out.replace(/<img([^>]*?)>/gi, (m, a) => {
                    // position/float/z-index 항상 제거
                    a = a.replace(/(?:position|float|z-index)\s*:[^;'"]+;?/gi, '');
                    // width/height 속성 제거
                    a = a.replace(/\s*(?:width|height)\s*=\s*["'][^"']*["']/gi, '');
                    if (/max-width\s*:\s*100%/.test(a) && /display\s*:\s*block/.test(a)) return '<img' + a + '>';
                    return /style\s*=\s*["']/.test(a)
                        ? '<img' + a.replace(/(style\s*=\s*["'])/, '$1max-width:100%;height:auto;display:block;margin:0 auto;') + '>'
                        : '<img' + a + ' style="max-width:100%;height:auto;display:block;margin:0 auto;">';
                });
                // 테이블 margin 강제 0
                out = out.replace(/(<table[^>]*style\s*=\s*["'][^"']*)margin\s*:[^;'"]+;?/gi, '$1');
                out = out.replace(/<table([^>]*)>/gi, (m, a) => {
                    const br = 'margin:0;';
                    let tag;
                    if (a.includes('width:100%')) {
                        tag = a.includes('border-radius') ? m : '<table' + a.replace(/(style=['"])/, '$1' + br) + '>';
                    } else {
                        tag = a.includes('style=')
                            ? '<table' + a.replace(/(style=['"])/, '$1width:100%;border-collapse:collapse;table-layout:fixed;' + br) + '>'
                            : '<table' + a + ' style="width:100%;border-collapse:collapse;table-layout:fixed;' + br + '">';
                    }
                    // 이미 tbl-scroll-wrap 안에 있는 테이블은 래핑 스킵
                    if (a.includes('tbl-fixed') || a.includes('tbl-responsive')) return tag;
                    // 반응형 스크롤 래퍼로 감싸기
                    return '<div style="width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;display:block;">' + tag;
                });
                // 닫는 </table> 뒤에 래퍼 닫기 (table 1개당 1개 대응)
                // 버튼(a태그) 안 중복 div 제거
                out = out.replace(/(<a[^>]*>)\s*<div[^>]*>\s*([\s\S]*?)\s*<\/div>\s*(<\/a>)/gi, '$1$2$3');
                // 테이블 태그 오류 수정 (<th ead> → <thead> 등)
                out = out.replace(/<th\s+ead([^>]*)>/gi, '<thead$1>');
                out = out.replace(/<\/th\s+ead>/gi, '</thead>');
                out = out.replace(/<t\s+body([^>]*)>/gi, '<tbody$1>');
                out = out.replace(/<\/t\s+body>/gi, '</tbody>');
                // 빈 tr/td DOM 기반 제거 — 철저하게
                (function removeEmptyTableRows() {
                    const tmp = document.createElement('div');
                    tmp.innerHTML = out;
                    // thead 외 모든 th → td 강제 변환 (한 번만 실행)
                    fixTableThs(tmp);
                    tmp.querySelectorAll('table').forEach(table => {
                        table.querySelectorAll('tr').forEach(tr => {
                            const cells = tr.querySelectorAll('td, th');
                            if (cells.length === 0) { tr.remove(); return; }
                            const allEmpty = Array.from(cells).every(cell => {
                                const t = cell.textContent.replace(/[\s\u00a0]/g, '');
                                const innerClean = cell.innerHTML.replace(/<br\s*\/?>/gi, '').trim();
                                const hasImg = Array.from(cell.querySelectorAll('img')).some(i => {
                                    const s = i.getAttribute('src') || '';
                                    return s && s !== '#' && s.length > 1;
                                });
                                return t === '' && !hasImg && (innerClean === '' || innerClean === '&nbsp;');
                            });
                            if (allEmpty) { tr.remove(); return; }
                        });
                        // 빈 thead/tbody 제거
                        table.querySelectorAll('thead, tbody').forEach(tb => {
                            if (tb.querySelectorAll('tr').length === 0) tb.remove();
                        });
                        // 첫 번째 tr이 헤더인데 내용 없으면 제거 (추가 보호)
                        const firstTr = table.querySelector('tr');
                        if (firstTr) {
                            const cells = firstTr.querySelectorAll('th, td');
                            const isEmpty = Array.from(cells).every(c => c.textContent.replace(/[\s\u00a0]/g,'') === '');
                            if (isEmpty) firstTr.remove();
                        }
                        // ※ 빈 선두 th 제거 로직 제거됨 — tbody와 컬럼 수 불일치 유발 방지
                        //   (fixTableThs의 컬럼 정규화가 대신 처리)
                    });
                    out = tmp.innerHTML;
                })();
                out = out.replace(/<\/table>/gi, '</table></div>');
                out = out.replace(/<(td|th)([^>]*)>/gi, (m, tag, a) => {
                    let style = '';
                    const styleMatch = a.match(/style\s*=\s*["']([^"']*)["']/i);
                    if (styleMatch) style = styleMatch[1];
                    // word-break 보장
                    if (!style.includes('word-break')) style = 'word-break:break-all;overflow-wrap:anywhere;' + style;
                    // color 없으면 textColor 추가 (background-color 오탐 방지: color: 패턴만 검사)
                    if (!/(?<![a-z-])color\s*:/.test(style)) style += `;color:${textColor};`;
                    // font-size 없으면 clamp 적용 (14px 고정값 제거)
                    if (!style.includes('font-size')) style += ';font-size:clamp(0.875rem,1.5vw,1rem);';
                    // line-height 보장
                    if (!style.includes('line-height')) style += ';line-height:1.8;';
                    const restA = a.replace(/style\s*=\s*["'][^"']*["']/i, '').trim();
                    return '<' + tag + (restA ? ' ' + restA : '') + ' style="' + style.replace(/^;+|;+$/g,'').replace(/;;+/g,';') + '">';
                });
                const fd = out.indexOf('<div'); if (fd > 0) out = out.slice(fd);
                const oc = (out.match(/<div[^>]*>/gi)||[]).length;
                const cc = (out.match(/<\/div>/gi)||[]).length;
                for (let d=0; d<oc-cc; d++) out += '</div>';
                // [팝업N] 마커 → 트리거 버튼 + 자식 패널 (se-popup-content 제거 전에 실행)
                out = processPopupMarkers(out);
                // se-popup-content 블록 DOM 기반 안전 제거 (processPopupMarkers 이후)
                if (out.includes('se-popup-content')) {
                    const tmpClean = document.createElement('div');
                    tmpClean.innerHTML = out;
                    tmpClean.querySelectorAll('.se-popup-content').forEach(el => el.remove());
                    out = tmpClean.innerHTML;
                }
                // <script> 태그 제거
                out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
                out = out.replace(/\s*!important/gi, '');
                // 인라인 style에 font-size:14px 고정값 → clamp로 교체 (모바일 최소 14px 보장)
                out = out.replace(/font-size\s*:\s*14px/gi, 'font-size:clamp(0.875rem,1.5vw,1rem)');
                out = out.replace(/font-size\s*:\s*13px/gi, 'font-size:clamp(0.8125rem,1.4vw,0.9375rem)');
                // 임의 영문 텍스트 제거 (text-transform:uppercase 이면서 영문만 있는 것)
                out = out.replace(/<p([^>]*)>\s*([A-Z][A-Z0-9\s\-\·\.&;]{3,})\s*<\/p>/g, (m, attrs, text) => {
                    if (/text-transform\s*:\s*uppercase/i.test(attrs)) return '';
                    return m;
                });
                // 모든 popup-trigger 버튼 스타일 강제 통일 (크기/색상)
                out = out.replace(/<button([^>]*class="popup-trigger"[^>]*)>/gi, (m, attrs) => {
                    return `<button${attrs.replace(/style="[^"]*"/i, '')} style="${getPopupBtnStyle()}">`;
                });
                // 모든 <a href> 링크에 cursor:pointer 보장
                out = out.replace(/<a(\s[^>]*href=[^>]*)>/gi, (m, a) => {
                    if (a.includes('cursor:pointer')) return m;
                    if (/style\s*=\s*["']/.test(a)) {
                        return '<a' + a.replace(/(style\s*=\s*["'])/, '$1cursor:pointer;') + '>';
                    }
                    return '<a' + a + ' style="cursor:pointer;">';
                });
                if (!out || out.length < 50) throw new Error('HTML \uc0dd\uc131 \uc2e4\ud328');

                out = expandHexColors(out);
                out = processTooltips(out, getById('bgPicker')?.value || '#0e0b48');

                const notice = getById('initialNotice'); if (notice) notice.remove();
                const _area = getById('contentArea');
                // checkbox ON = 스타일 유지 + 컨텐츠만 변경 (smart update)
                // checkbox OFF = 전체 새로 생성
                const _isSmartUpdate = stylePreserve && hasExistingContent(_area);
                if (_isSmartUpdate) {
                    const _result = applySmartUpdate(out, _area);
                    tagSectionsWithId(_area);
                    recordState();
                    showToast(`스타일 유지 업데이트 — ${_result.kept}개 유지 / ${_result.replaced}개 교체`);
                } else {
                    currentHashFolder = '';
                    const accentSlashEl = getById('accentSlash');
                    if (accentSlashEl) accentSlashEl.style.display = 'block';
                    const accentPickerEl = getById('accentPicker');
                    if (accentPickerEl) { accentPickerEl.value = '#888888'; accentPickerEl.style.opacity = '0.4'; }
                    _area.innerHTML = out;
                    tagSectionsWithId(_area);
                    recordState();
                }
                // AI 생성 HTML에서 히어로 이미지 추출 → 사이드바로 이동 + contentArea에서 숨김
                (function extractHeroFromContent() {
                    const sc = _area.querySelector('.se-contents');
                    if (!sc) return;
                    const firstSeDiv = sc.querySelector(':scope > .se-div:first-child');
                    if (!firstSeDiv) return;
                    const heroImg = firstSeDiv.querySelector('img');
                    if (heroImg) {
                        const heroSrc = heroImg.getAttribute('src') || '';
                        if (heroSrc) {
                            firstSeDiv.style.display = 'none';
                            firstSeDiv.innerHTML = '';
                            applyHeroImage(heroSrc, false, null, true);
                            return;
                        }
                    }
                    // img 없이 텍스트 마커만 남은 경우 (hero.png) 등 제거
                    const txt = firstSeDiv.textContent.trim();
                    if (/^\(.*hero.*\)$/i.test(txt) || /^\(.*\.png\)$/i.test(txt) || /^\(.*\.jpg\)$/i.test(txt)) {
                        firstSeDiv.style.display = 'none';
                        firstSeDiv.innerHTML = '';
                    }
                })();
                // 본문 전체에서 (hero.png) 등 이미지 마커 텍스트 노드 제거
                (function removeHeroTextMarkers() {
                    _area.querySelectorAll('p, span, div').forEach(el => {
                        const t = el.textContent.trim();
                        if (/^\(hero[^)]*\)$/i.test(t)) {
                            el.remove();
                        }
                    });
                    // 깨진 히어로 img (alt="hero" 또는 src에 hero 포함 + 로드 실패) 제거
                    _area.querySelectorAll('img').forEach(img => {
                        const src = img.getAttribute('src') || '';
                        const alt = img.getAttribute('alt') || '';
                        if (/hero/i.test(src) || /hero/i.test(alt)) {
                            // 첫 번째 se-div 안이면 숨김, 아니면 제거
                            const parent = img.closest('.se-div');
                            if (parent) { parent.style.display = 'none'; parent.innerHTML = ''; }
                            else img.remove();
                        }
                    });
                })();
                // popup-trigger 버튼 텍스트 통일: ? → +
                _area.querySelectorAll('.popup-trigger[data-popup]').forEach(btn => {
                    const t = btn.textContent.trim();
                    if (t === '?' || t === '❓' || t === '＋') btn.textContent = '+';
                });
                // popup-trigger 스타일을 hex로 강제 재설정 (브라우저 rgb() 변환 방지)
                fixPopupTriggerStyles(); protectAccentBars(); protectSectionCards();

                // 이미지 매칭: innerHTML 세팅 직후 즉시 실행 (타이밍 문제 방지)
                if (Object.keys(contentAssetLibrary).length > 0) {
                    setTimeout(() => runImageMatching(true), 100);
                }

                // accentPicker 자동 동기화: DOM 렌더링 후 실행
                setTimeout(function syncAccentPicker() {
                    const area = getById('contentArea');
                    const freq = {};
                    area.querySelectorAll('[style]').forEach(el => {
                        const m = el.getAttribute('style').match(/#[0-9a-fA-F]{6}/g);
                        if (m) m.forEach(c => { freq[c.toLowerCase()] = (freq[c.toLowerCase()] || 0) + 1; });
                    });
                    const bg = (getById('bgPicker').value || bgColor).toLowerCase();
                    function colorDist(a, b) {
                        const ar=parseInt(a.slice(1,3),16), ag=parseInt(a.slice(3,5),16), ab=parseInt(a.slice(5,7),16);
                        const br=parseInt(b.slice(1,3),16), bg_=parseInt(b.slice(3,5),16), bb=parseInt(b.slice(5,7),16);
                        return Math.abs(ar-br)+Math.abs(ag-bg_)+Math.abs(ab-bb);
                    }
                    function isNeutral(c) {
                        const r=parseInt(c.slice(1,3),16), g=parseInt(c.slice(3,5),16), b=parseInt(c.slice(5,7),16);
                        return (Math.max(r,g,b)-Math.min(r,g,b)) < 30 || Math.max(r,g,b) > 230 || (r<25&&g<25&&b<25);
                    }
                    const detected = Object.entries(freq)
                        .filter(([c]) => c !== bg && colorDist(c, bg) > 60 && !isNeutral(c))
                        .sort((a, b) => b[1] - a[1])[0];
                    if (detected) {
                        const p = getById('accentPicker');
                        if (p) { p.value = detected[0]; p.style.opacity = '1'; }
                        const slash = getById('accentSlash');
                        if (slash) slash.style.display = 'none';
                        getById('bgPicker').dataset.accent = detected[0];
                        getById('bgPicker').dataset.prevAccent = detected[0];
                        // accent 감지 후 popup-trigger 버튼 색상 동기화
                        fixPopupTriggerStyles(); protectAccentBars(); protectSectionCards();
                    }
                    // 이미지 매칭은 위에서 이미 실행됨 (accent 감지 여부 무관)
                    showToast(detected ? '디자인 완료! 키컬러 ' + detected[0] + ' 감지됨' : '디자인 완료!');
                }, 200);
            } catch(e) {
                console.error('[CG]', e);
                showToast('\uc2e4\ud328: ' + (e.message || '\uc624\ub958'));
            } finally {
                getById('contentSpinner').style.display = 'none';
            }
        }


        // 드래그 파일로 텍스트 마커 매칭 (contentArea + 모든 팝업 childArea 공통)
        function runMatchWithFiles(fileMap) {
            const area = getById('contentArea'); if (!area) return 0;
            const matchPairs = [];
            Object.entries(fileMap).forEach(([fname, b64]) => {
                const baseName = fname.includes('.') ? fname.substring(0, fname.lastIndexOf('.')) : fname;
                const addPair = (n) => {
                    matchPairs.push({ searchStr: `(${n})`.toLowerCase(), url: b64 });
                    matchPairs.push({ searchStr: `[${n}]`.toLowerCase(), url: b64 });
                };
                addPair(baseName); addPair(fname);
                const baseNoSpace = baseName.replace(/\s+/g, '_');
                if (baseNoSpace !== baseName) addPair(baseNoSpace);
                const noUnder = baseName.replace(/_/g, '');
                if (noUnder !== baseName) addPair(noUnder);
            });
            matchPairs.sort((a, b) => b.searchStr.length - a.searchStr.length);

            // 매칭 대상: contentArea + 모든 팝업 childArea
            const allAreas = [area];
            childPanels.forEach(panel => {
                const ca = getById('childArea_' + panel.id);
                if (ca) allAreas.push(ca);
            });

            let count = 0, replacedAny = true, iterations = 0;
            while (replacedAny && iterations < 50) {
                replacedAny = false; iterations++;
                const textNodes = [];
                allAreas.forEach(targetArea => {
                    const walk = document.createTreeWalker(targetArea, NodeFilter.SHOW_TEXT, null, false);
                    let node;
                    while (node = walk.nextNode()) textNodes.push(node);
                });
                for (let i = 0; i < textNodes.length; i++) {
                    const textNode = textNodes[i];
                    const text = textNode.nodeValue;
                    const lowerText = text.toLowerCase();
                    const parent = textNode.parentNode;
                    if (!parent || parent.nodeName === 'SCRIPT' || parent.nodeName === 'STYLE') continue;
                    let foundMatch = null;
                    for (let pair of matchPairs) {
                        const idx = lowerText.indexOf(pair.searchStr);
                        if (idx !== -1) { foundMatch = { pair, index: idx, length: pair.searchStr.length }; break; }
                    }
                    if (foundMatch) {
                        const before = text.substring(0, foundMatch.index);
                        const after = text.substring(foundMatch.index + foundMatch.length);
                        const frag = document.createDocumentFragment();
                        if (before) frag.appendChild(document.createTextNode(before));
                        const imgEl = document.createElement('img');
                        imgEl.src = foundMatch.pair.url;
                        imgEl.style.cssText = 'display:inline-block;vertical-align:middle;max-width:100%;height:auto;image-rendering:high-quality;';
                        imgEl.onload = function() {
                            const containerEl = imgEl.closest('[id^="childArea_"]') || getById('contentArea');
                            const cw = containerEl?.offsetWidth || 840;
                            if (imgEl.naturalWidth > cw) { imgEl.style.width = '100%'; imgEl.style.height = 'auto'; }
                            else { imgEl.style.width = imgEl.naturalWidth + 'px'; imgEl.style.height = imgEl.naturalHeight + 'px'; }
                        };
                        frag.appendChild(imgEl);
                        count++;
                        if (after) frag.appendChild(document.createTextNode(after));
                        parent.replaceChild(frag, textNode);
                        replacedAny = true;
                        break;
                    }
                }
            }
            return count;
        }
        function runImageMatching(silent = false) {
            const area = getById('contentArea'); if (!area) return;

            const assetKeys = Object.keys(contentAssetLibrary);
            if(assetKeys.length === 0) return showToast("\ub9e4\uce6d\ud560 \uc5d0\uc14b\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.");

            recordState();
            let count = 0;
            
            const matchPairs = [];
            assetKeys.forEach(key => {
                const baseName = key.includes('.') ? key.substring(0, key.lastIndexOf('.')) : key;
                const addPair = (str) => {
                    const s = str.toLowerCase();
                    matchPairs.push({ searchStr: `(${s})`, url: contentAssetLibrary[key] });
                    matchPairs.push({ searchStr: `[${s}]`, url: contentAssetLibrary[key] });
                };
                // 원본
                addPair(baseName);
                // 확장자 포함
                addPair(key);
                // 공백→언더스코어
                const noSpace = baseName.replace(/\s+/g, '_');
                if (noSpace !== baseName) addPair(noSpace);
                // 언더스코어 제거 (item_01 → item01)
                const noUnder = baseName.replace(/_/g, '');
                if (noUnder !== baseName) addPair(noUnder);
                // 숫자 앞 0 제거 (item_01 → item_1, item01 → item1)
                const noLeadingZero = baseName.replace(/_0+(\d)/g, '_$1').replace(/(\D)0+(\d)/g, '$1$2');
                if (noLeadingZero !== baseName) addPair(noLeadingZero);
            });

            matchPairs.sort((a, b) => b.searchStr.length - a.searchStr.length); 

            let replacedAny = true;
            let iterations = 0;

            // 매칭 대상: contentArea + 모든 팝업 childArea
            const allAreas = [area];
            childPanels.forEach(panel => {
                const ca = getById('childArea_' + panel.id);
                if (ca) allAreas.push(ca);
            });

            while (replacedAny && iterations < 50) {
                replacedAny = false;
                iterations++;

                const textNodes = [];
                allAreas.forEach(targetArea => {
                    const walk = document.createTreeWalker(targetArea, NodeFilter.SHOW_TEXT, null, false);
                    let node;
                    while(node = walk.nextNode()) textNodes.push(node);
                });

                for (let i = 0; i < textNodes.length; i++) {
                    let textNode = textNodes[i];
                    let text = textNode.nodeValue;
                    let lowerText = text.toLowerCase();
                    let parent = textNode.parentNode;
                    if (!parent || parent.nodeName === 'SCRIPT' || parent.nodeName === 'STYLE') continue;

                    let foundMatch = null;
                    for (let pair of matchPairs) {
                        const index = lowerText.indexOf(pair.searchStr);
                        if (index !== -1) {
                            foundMatch = { pair: pair, index: index, length: pair.searchStr.length };
                            break;
                        }
                    }

                    if (foundMatch) {
                        const before = text.substring(0, foundMatch.index);
                        const after = text.substring(foundMatch.index + foundMatch.length);
                        
                        const frag = document.createDocumentFragment();
                        if (before.length > 0) frag.appendChild(document.createTextNode(before));
                        
                        const imgEl = document.createElement('img');
                        imgEl.src = foundMatch.pair.url;
                        imgEl.style.cssText = 'display:inline-block;vertical-align:middle;max-width:100%;height:auto;image-rendering:high-quality;';
                        imgEl.onload = function() {
                            const containerEl = imgEl.closest('[id^="childArea_"]') || getById('contentArea');
                            const containerW = containerEl?.offsetWidth || 840;
                            if (imgEl.naturalWidth > containerW) {
                                imgEl.style.width = '100%';
                                imgEl.style.height = 'auto';
                            } else {
                                imgEl.style.width = imgEl.naturalWidth + 'px';
                                imgEl.style.height = imgEl.naturalHeight + 'px';
                            }
                        };
                        frag.appendChild(imgEl);
                        count++;
                        
                        if (after.length > 0) frag.appendChild(document.createTextNode(after));
                        
                        parent.replaceChild(frag, textNode);
                        replacedAny = true;
                        break; 
                    }
                }
            }

            // 깨진 img[src] 상대경로도 자산 라이브러리로 교체 (contentArea + childArea 모두)
            allAreas.forEach(targetArea => {
                targetArea.querySelectorAll('img[src]').forEach(img => {
                    const src = img.getAttribute('src') || '';
                    if (src.startsWith('data:') || src.startsWith('http') || src.startsWith('blob:')) return;
                    const srcFname = src.split('/').pop().split('\\').pop();
                    if (contentAssetLibrary[srcFname]) {
                        img.src = contentAssetLibrary[srcFname];
                        count++;
                    }
                });
            });

            if (count > 0) {
                if (!silent) showToast(`${count}개 이미지 매칭 완료.`);
                recordState();
            } else {
                if (!silent) showToast("위치표에서 매칭되는 텍스트(예: (파일명) 또는 [파일명])를 찾을 수 없습니다.");
            }
            return count;
        }

        function renderHeroAssets() {
            const preview = getById('assetPreview');
            if (!preview) return;
            preview.innerHTML = '';
            uploadedAssets.forEach((asset, idx) => {
                const wrapper = document.createElement('div');
                wrapper.className = 'relative inline-block w-12 h-12 group pointer-events-auto shadow-sm rounded-lg border border-indigo-100 overflow-hidden shrink-0';
                wrapper.innerHTML = `
                    <img src="${asset.b64}" class="w-full h-full object-cover bg-slate-50" title="${asset.name}">
                    <button class="absolute top-0 right-0 bg-red-500/80 hover:bg-red-500 text-white w-4 h-4 flex items-center justify-center text-[8px] font-bold opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer backdrop-blur-sm rounded-bl-sm" data-idx="${idx}">\u2715</button>
                `;
                wrapper.querySelector('button').addEventListener('click', (e) => {
                    uploadedAssets.splice(parseInt(e.currentTarget.dataset.idx), 1);
                    renderHeroAssets();
                });
                preview.appendChild(wrapper);
            });
        }

        function renderContentAssets() {
            const grid = getById('assetLibraryGrid');
            if (!grid) return;
            grid.innerHTML = '';
            Object.entries(contentAssetLibrary).forEach(([name, src]) => {
                const card = document.createElement('div');
                card.className = 'relative group bg-white rounded-xl overflow-hidden border border-slate-200 shadow-sm cursor-pointer';
                card.innerHTML = `
                    <img src="${src}" class="w-full h-24 object-cover bg-slate-100" title="${name}">
                    <p class="text-[9px] font-bold text-slate-500 truncate px-2 py-1">${name}</p>
                    <button class="absolute top-1 right-1 bg-red-500/80 hover:bg-red-500 text-white w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" data-name="${name}" title="\uc0ad\uc81c">\u2715</button>
                `;
                card.querySelector('button').addEventListener('click', (e) => {
                    e.stopPropagation();
                    delete contentAssetLibrary[e.currentTarget.dataset.name];
                    renderContentAssets();
                });
                grid.appendChild(card);
            });
        }

        function clearLibrary() {
            if (Object.keys(contentAssetLibrary).length === 0) return showToast("\ub77c\uc774\ube0c\ub7ec\ub9ac\uac00 \uc774\ubbf8 \ube44\uc5b4\uc788\uc2b5\ub2c8\ub2e4.");
            if (!confirm("\ub77c\uc774\ube0c\ub7ec\ub9ac\uc758 \ubaa8\ub4e0 \uc774\ubbf8\uc9c0\ub97c \uc0ad\uc81c\ud558\uc2dc\uaca0\uc2b5\ub2c8\uae4c?")) return;
            contentAssetLibrary = {};
            renderContentAssets();
            showToast("\ub77c\uc774\ube0c\ub7ec\ub9ac\uac00 \ucd08\uae30\ud654\ub418\uc5c8\uc2b5\ub2c8\ub2e4.");
        }

        let isImgResizing = false;
        let currentImgResizer = null;
        let startImgX = 0;
        let startImgY = 0;
        let startImgWidth = 0;
        let startImgHeight = 0;
        let startAspectRatio = 1; // 드래그 시작 시 비율 고정용
        let imgResizePos = '';

        document.addEventListener('mousedown', function(e) {
            if (e.target.classList.contains('resizer-handle')) {
                isImgResizing = true;
                currentImgResizer = e.target.closest('.custom-resizer');
                startImgX = e.clientX;
                startImgY = e.clientY;
                startImgWidth = parseInt(document.defaultView.getComputedStyle(currentImgResizer).width, 10);
                startImgHeight = parseInt(document.defaultView.getComputedStyle(currentImgResizer).height, 10) || currentImgResizer.offsetHeight;
                imgResizePos = e.target.dataset.pos;
                // 비율 고정: 자연 이미지/영상 비율 우선, 없으면 현재 wrapper 비율 사용
                const _imgEl = currentImgResizer.querySelector('img, video');
                const _elNatW = _imgEl ? (_imgEl.naturalWidth || _imgEl.videoWidth || 0) : 0;
                const _elNatH = _imgEl ? (_imgEl.naturalHeight || _imgEl.videoHeight || 0) : 0;
                if (_elNatW > 0 && _elNatH > 0) {
                    startAspectRatio = _elNatH / _elNatW;
                } else {
                    startAspectRatio = startImgWidth > 0 ? startImgHeight / startImgWidth : 1;
                }
                e.preventDefault();
                e.stopPropagation();
            }
        });

        document.addEventListener('mousemove', function(e) {
            if (!isImgResizing || !currentImgResizer) return;
            let dx = e.clientX - startImgX;
            // X축 기준 너비 계산 (핸들 방향에 따라 증감 방향 결정)
            let newWidth = startImgWidth;
            if (imgResizePos === 'se' || imgResizePos === 'ne') newWidth = startImgWidth + dx;
            else if (imgResizePos === 'sw' || imgResizePos === 'nw') newWidth = startImgWidth - dx;
            newWidth = Math.max(20, newWidth);
            // 비율 고정: 너비 기준으로 높이 자동 산출
            const newHeight = Math.round(newWidth * startAspectRatio);

            currentImgResizer.style.width  = newWidth  + 'px';
            currentImgResizer.style.height = newHeight + 'px';
            // 내부 img/video도 동기화
            const _imgEl = currentImgResizer.querySelector('img, video');
            if (_imgEl) { _imgEl.style.width = '100%'; _imgEl.style.height = '100%'; }

            const label = getById('imgSizeLabel');
            if (label) label.textContent = `${Math.round(newWidth)} × ${Math.round(newHeight)}`;
            const inp = getById('imgWidthInput');
            if (inp && document.activeElement !== inp) inp.value = Math.round(newWidth);
        });

        document.addEventListener('mouseup', function(e) {
            // 테이블 셀 드래그 선택 종료 — 반드시 isSelecting 초기화
            if (isSelecting) {
                isSelecting = false;
                selectionStartCell = null;
            }
            if (isImgResizing) {
                isImgResizing = false;
                if (currentImgResizer) {
                    showImgFloatToolbar(currentImgResizer);
                }
                currentImgResizer = null;
                if (typeof recordState === 'function') recordState();
            }
        });

        document.addEventListener('mousedown', function(e) {
            const tb = getById('imgFloatToolbar');
            if (!tb || tb.contains(e.target)) return; // 툴바 자신 클릭 시 무시
            const tblTb = getById('tableFloatToolbar');
            if (tblTb && tblTb.contains(e.target)) return;
            const area = getById('contentArea');
            if (area && !area.contains(e.target)) {
                hideImgFloatToolbar();
            }
        }, true);

        document.addEventListener('DOMContentLoaded', () => {
            // window dragover: 브라우저 기본 "파일 열기" 동작 차단
            window.addEventListener('dragover', e => e.preventDefault(), false);
            // window drop: HTML 파일 드롭 시 새 탭으로 열리는 것 방지 + 로드
            window.addEventListener('drop', function(e) {
                e.preventDefault(); // 브라우저 기본 동작 차단
                // capture로 등록된 각 영역 핸들러(heroDiv, contentArea, initDragDrop)가
                // stopPropagation 하므로 여기까지 오는 건 해당 영역 밖 드롭
                const dtFiles = Array.from(e.dataTransfer.files || []);
                const htmlFile = dtFiles.find(f => f.name && f.name.endsWith('.html'));
                if (htmlFile) {
                    showToast('HTML 불러오는 중...');
                    loadHtmlFile(htmlFile, {});
                }
            }, false); // bubble phase - 각 영역 핸들러가 stopPropagation하면 여기 안 옴

            // heroDiv: 히어로 이미지 드롭
            const heroDiv = getById('heroDiv');
            heroDiv.addEventListener('dragenter', e => { e.preventDefault(); e.stopPropagation(); });
            heroDiv.addEventListener('dragover', e => {
                e.preventDefault(); e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
                heroDiv.style.outline = '4px dashed #4f46e5';
                heroDiv.style.outlineOffset = '-4px';
            });
            heroDiv.addEventListener('dragleave', e => {
                e.preventDefault(); e.stopPropagation();
                heroDiv.style.outline = 'none';
            });
            heroDiv.addEventListener('drop', e => {
                e.preventDefault(); e.stopPropagation();
                heroDiv.style.outline = 'none';
                let files = Array.from(e.dataTransfer.files || []);
                if (!files.length && e.dataTransfer.items) {
                    files = Array.from(e.dataTransfer.items).filter(i => i.kind === 'file').map(i => i.getAsFile());
                }
                if (files.length > 0 && isImageFile(files[0])) {
                    const reader = new FileReader();
                    reader.onload = ev => { applyHeroImage(ev.target.result, false); recordState(); showToast("메인 히어로 이미지가 등록되었습니다."); };
                    reader.readAsDataURL(files[0]);
                }
            });

            // contentArea: 이미지 드롭 (매칭 or 삽입)
            const area = getById('contentArea');
            area.addEventListener('dragenter', e => { e.preventDefault(); e.stopPropagation(); });
            area.addEventListener('dragover', e => {
                e.preventDefault(); e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
            });
            area.addEventListener('dragleave', e => { e.preventDefault(); e.stopPropagation(); });
            area.addEventListener('drop', e => {
                e.preventDefault(); e.stopPropagation();
                const dtFiles = Array.from(e.dataTransfer.files || []);

                // HTML 파일 드롭 → 로드 (함께 드롭된 이미지 파일도 imgMap으로 전달)
                const htmlFile = dtFiles.find(f => f.name && f.name.endsWith('.html'));
                if (htmlFile) {
                    showToast('HTML 불러오는 중...');
                    const coImgFiles = dtFiles.filter(f => isImageFile(f));
                    if (coImgFiles.length > 0) {
                        const coImgMap = {};
                        Promise.all(coImgFiles.map(f => new Promise(resolve => {
                            const r = new FileReader();
                            r.onload = ev => { coImgMap[f.name] = ev.target.result; resolve(); };
                            r.onerror = () => resolve();
                            r.readAsDataURL(f);
                        }))).then(() => loadHtmlFile(htmlFile, coImgMap));
                    } else {
                        loadHtmlFile(htmlFile, {});
                    }
                    return;
                }

                const imgFiles = dtFiles.filter(f => isImageFile(f));
                if (!imgFiles.length) return;

                // 테이블 셀에 드롭 → 셀 안에 이미지 삽입
                const targetTd = e.target.closest('td, th');
                if (targetTd) {
                    imgFiles.forEach(file => {
                        const reader = new FileReader();
                        reader.onload = ev => {
                            recordState();
                            const img = document.createElement('img');
                            img.src = ev.target.result;
                            img.style.cssText = 'max-width:100%;height:auto;display:block;margin:0 auto;';
                            targetTd.appendChild(img);
                            recordState();
                        };
                        reader.readAsDataURL(file);
                    });
                    showToast('셀에 이미지가 삽입되었습니다.');
                    return;
                }

                // 깨진 이미지/히어로/텍스트마커 매칭 모드 (contentArea + 팝업 childArea 모두 스캔)
                const _scanAreas = [area];
                childPanels.forEach(panel => { const ca = getById('childArea_' + panel.id); if (ca) _scanAreas.push(ca); });
                const brokenImgs = _scanAreas.flatMap(a => Array.from(a.querySelectorAll('img[src]')).filter(img => {
                    const s = img.getAttribute('src') || '';
                    return !s.startsWith('data:') && !s.startsWith('http') && !s.startsWith('blob:');
                }));
                const heroImg = getById('mainHeroImg');
                const heroSrc = heroImg ? (heroImg.getAttribute('src') || '') : '';
                const heroBroken = heroSrc && !heroSrc.startsWith('data:') && !heroSrc.startsWith('http') && !heroSrc.startsWith('blob:');
                // contentArea + 모든 팝업 childArea 텍스트 합산 (팝업 내 마커도 감지)
                const _allTexts = _scanAreas.map(a => a.innerText || '').join('\n');
                const hasTextMarker = imgFiles.some(file => {
                    const base = file.name.replace(/\.[^.]+$/, '');
                    return _allTexts.includes(`(${base})`) || _allTexts.includes(`[${base}]`) ||
                           _allTexts.includes(`(${file.name})`) || _allTexts.includes(`[${file.name}]`);
                });

                if (brokenImgs.length > 0 || heroBroken || hasTextMarker) {
                    let matched = 0;
                    Promise.all(imgFiles.map(file => new Promise(resolve => {
                        const reader = new FileReader();
                        reader.onload = ev => {
                            const fname = file.name;
                            brokenImgs.forEach(img => {
                                const srcFname = (img.getAttribute('src') || '').split('/').pop().split('\\').pop();
                                if (srcFname === fname) { img.src = ev.target.result; matched++; }
                            });
                            if (heroBroken && heroImg) {
                                const heroFname = heroSrc.split('/').pop().split('\\').pop();
                                if (heroFname === fname) { applyHeroImage(ev.target.result, false, null, true); matched++; } // skipColorExtract=true: 재매칭 시 배경색 자동 추출 비활성화
                            }
                            resolve({ fname, b64: ev.target.result });
                        };
                        reader.onerror = () => resolve(null);
                        reader.readAsDataURL(file);
                    }))).then(results => {
                        const fileMap = {};
                        results.forEach(r => { if (r) fileMap[r.fname] = r.b64; });
                        const textMatched = runMatchWithFiles(fileMap);
                        matched += textMatched;
                        recordState();
                        showToast(matched > 0 ? '이미지 ' + matched + '개 매칭 완료!' : '매칭되는 파일명이 없습니다.');
                    });
                    return;
                }

                // 일반 삽입 모드: 커서 위치에 이미지 삽입
                let range;
                if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(e.clientX, e.clientY);
                else if (document.caretPositionFromPoint) {
                    const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
                    if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); range.collapse(true); }
                }
                if (range) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); savedRange = range; }
                else { area.focus(); }

                imgFiles.forEach(file => {
                    const reader = new FileReader();
                    reader.onload = ev => {
                        recordState();
                        area.focus();
                        if (savedRange) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(savedRange); }
                        document.execCommand('insertHTML', false, `<img src="${ev.target.result}" style="max-width:100%;width:auto;height:auto;display:inline-block;vertical-align:middle;margin:4px;border:none;">`);
                        if (window.getSelection().rangeCount > 0) savedRange = window.getSelection().getRangeAt(0);
                        recordState();
                    };
                    reader.readAsDataURL(file);
                });
                showToast("\ub4dc\ub798\uadf8\ud55c \uc774\ubbf8\uc9c0\uac00 \uc0bd\uc785\ub418\uc5c8\uc2b5\ub2c8\ub2e4.");
            });

            const pageWidthEl = getById('pageWidthInput');
            function applyPageWidth(w) {
                const sheet = getById('documentSheet');
                const wrapper = getById('childPanelsWrapper');
                if (sheet) sheet.style.width = w + 'px';
                if (wrapper) { wrapper.style.width = w + 'px'; wrapper.style.maxWidth = '100%'; }
                // childSheet 패널 너비도 동기화 (모바일/PC 전환 시 팝업도 같이 변경)
                document.querySelectorAll('[id^="childSheet_"]').forEach(el => {
                    el.style.width = w + 'px';
                    el.style.maxWidth = '100%';
                });
                document.querySelectorAll('[id^="childArea_"]').forEach(area => {
                    area.style.width = '100%';
                    area.style.minWidth = '';
                    area.style.boxSizing = 'border-box';
                });
            }
            if (pageWidthEl) {
                pageWidthEl.oninput = e => applyPageWidth(parseInt(e.target.value) || 840);
                // 초기 적용
                applyPageWidth(parseInt(pageWidthEl.value) || 840);
            }
            initNotionDetection();
            
            // HTML 파일 직접 열기 버튼 핸들러
            const htmlLoadInput = getById('htmlLoadInput');
            if (htmlLoadInput) {
                htmlLoadInput.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    showToast('HTML 불러오는 중...');
                    loadHtmlFile(file, {});
                    e.target.value = '';
                });
            }

            // 영상 파일 input 핸들러
            const videoFileInput = getById('videoFileInput');
            if (videoFileInput) {
                videoFileInput.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (file) insertVideoToEditor(file);
                    e.target.value = '';
                });
            }

            // master_guidelines.md 자동 로드 (인라인 폴백 포함)
            loadMasterGuideline();

            // ── tbody 내 th → td 강제 변환 MutationObserver ──────────────────
            let _thFixScheduled = false;
            function scheduleThFix() {
                if (_thFixScheduled) return;
                _thFixScheduled = true;
                // 브라우저가 DOM 처리를 끝낸 다음 tick에 실행 (즉시 실행 시 th가 아직 확정 안 된 경우 방지)
                Promise.resolve().then(() => { _thFixScheduled = false; fixTableThs(); });
            }
            const _thObserver = new MutationObserver(mutations => {
                let needFix = false;
                for (const m of mutations) {
                    if (m.type === 'childList') {
                        for (const node of m.addedNodes) {
                            if (node.nodeType === 1) {
                                if (node.tagName === 'TH' || node.querySelector?.('th')) {
                                    needFix = true; break;
                                }
                            }
                        }
                    }
                    if (needFix) break;
                }
                if (needFix) scheduleThFix();
            });
            const _ca = getById('contentArea');
            if (_ca) _thObserver.observe(_ca, { childList: true, subtree: true });
            // 초기 로드 시에도 한 번 실행
            fixTableThs();
            // input 이벤트 추가 보호 — 편집 중 th 재발생 방어
            let _thFixTimer = null;
            if (_ca) _ca.addEventListener('input', () => {
                clearTimeout(_thFixTimer);
                _thFixTimer = setTimeout(() => fixTableThs(), 200);
            });

            getById('editorImgInput').addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file || !isImageFile(file)) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    recordState();
                    const area = getById('contentArea');
                    area.focus();
                    if (savedRange) {
                        const sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(savedRange);
                    }
                    const imgHTML = `<img src="${ev.target.result}" style="max-width: 100%; width: auto; height: auto; display: inline-block; vertical-align: middle; margin: 4px; border: none;">`;
                    document.execCommand('insertHTML', false, imgHTML);
                    recordState();
                    showToast("\uc774\ubbf8\uc9c0\uac00 \uc0bd\uc785\ub418\uc5c8\uc2b5\ub2c8\ub2e4.");
                };
                reader.readAsDataURL(file);
                e.target.value = '';
            });

            function initDragDrop(zoneId, inputId, callback) {
                const zone = getById(zoneId); 
                const input = getById(inputId); 
                if (!zone) return;
                
                const handleDragOver = (e) => {
                    e.preventDefault(); 
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'copy'; 
                    
                    const dropTarget = zone.classList.contains('drop-zone') ? zone : (zone.querySelector('.drop-zone') || zone);
                    dropTarget.classList.add('active');
                };
                
                const handleDragLeave = (e) => {
                    e.preventDefault(); 
                    e.stopPropagation();
                    const dropTarget = zone.classList.contains('drop-zone') ? zone : (zone.querySelector('.drop-zone') || zone);
                    dropTarget.classList.remove('active');
                };

                const handleDrop = (e) => {
                    e.preventDefault(); 
                    e.stopPropagation();
                    const dropTarget = zone.classList.contains('drop-zone') ? zone : (zone.querySelector('.drop-zone') || zone);
                    dropTarget.classList.remove('active');
                    
                    let files = e.dataTransfer.files;
                    if (!files || files.length === 0) {
                        if (e.dataTransfer.items) {
                            files = Array.from(e.dataTransfer.items).filter(item => item.kind === 'file').map(item => item.getAsFile());
                        }
                    }
                    
                    if (files && files.length > 0) {
                        callback(files);
                    } else {
                        showToast("\uc774\ubbf8\uc9c0 \ud30c\uc77c\uc744 \uc778\uc2dd\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4. \ub2e4\uc2dc \uc2dc\ub3c4\ud574\uc8fc\uc138\uc694.");
                    }
                };

                zone.addEventListener('dragenter', handleDragOver, false);
                zone.addEventListener('dragover', handleDragOver, false);
                zone.addEventListener('dragleave', handleDragLeave, false);
                zone.addEventListener('drop', handleDrop, false);
                
                if(input) {
                    input.addEventListener('change', e => { 
                        if (e.target.files && e.target.files.length > 0) callback(e.target.files); 
                        e.target.value = ''; 
                    }); 
                }
            }

            // 파일 input change 핸들러 (클릭으로 파일 선택 시)
            getById('heroAssetInput').addEventListener('change', e => {
                Array.from(e.target.files||[]).forEach(f => {
                    if (!isImageFile(f)) return;
                    const r = new FileReader();
                    r.onload = ev => { uploadedAssets.push({b64:ev.target.result,name:f.name||'asset.png'}); renderHeroAssets(); };
                    r.readAsDataURL(f);
                });
                e.target.value = '';
            });
            getById('heroRefInput').addEventListener('change', e => {
                const f = e.target.files[0];
                if (!f || !isImageFile(f)) return;
                const r = new FileReader();
                r.onload = ev => {
                    referenceImageBase64 = ev.target.result;
                    getById('refPreview').innerHTML = `<div class="relative inline-block w-12 h-12 group pointer-events-auto shadow-sm rounded-lg border border-indigo-100 overflow-hidden shrink-0"><img src="${ev.target.result}" class="w-full h-full object-cover bg-slate-50"><button onclick="referenceImageBase64=null;getById('refPreview').innerHTML='';" class="absolute top-0 right-0 bg-red-500/80 text-white w-4 h-4 flex items-center justify-center text-[8px] font-bold opacity-0 group-hover:opacity-100 cursor-pointer rounded-bl-sm">✕</button></div>`;
                    showToast('레퍼런스 이미지가 등록되었습니다.');
                };
                r.readAsDataURL(f);
                e.target.value = '';
            });
            getById('heroLogoInput').addEventListener('change', e => {
                if (e.target.files[0]) loadLogoFile(e.target.files[0]);
                e.target.value = '';
            });
            getById('contentAssetInput').addEventListener('change', e => {
                Array.from(e.target.files||[]).forEach(f => {
                    if (!isImageFile(f)) return;
                    const r = new FileReader();
                    r.onload = ev => { contentAssetLibrary[f.name||`img_${Date.now()}`] = ev.target.result; renderContentAssets(); setTimeout(() => runImageMatching(true), 100); };
                    r.readAsDataURL(f);
                });
                e.target.value = '';
            });

            // se-div 삭제 방지: 내용이 비면 br 보장, se-div 자체 삭제 차단
            area.addEventListener('beforeinput', e => {
                if (e.inputType !== 'deleteContentBackward' && e.inputType !== 'deleteContentForward') return;
                const sel = window.getSelection();
                if (!sel || !sel.rangeCount) return;
                const range = sel.getRangeAt(0);
                const node = range.startContainer;

                // se-div 찾기
                const el = node.nodeType === 3 ? node.parentElement : node;
                const seDiv = el ? el.closest('.se-div') : null;
                if (!seDiv) return;

                // collapsed 상태 (커서만 있을 때)
                if (range.collapsed) {
                    const text = seDiv.textContent.replace(/[\s\u00a0]/g, '');
                    // 내용이 비어있으면 삭제 차단 (div 사라짐 방지)
                    if (text === '' || seDiv.innerHTML.replace(/<br\s*\/?>/gi,'').trim() === '') {
                        e.preventDefault();
                        return;
                    }
                    // [Backspace] 커서가 se-div 첫 위치이면 윗 블록과 병합 차단
                    if (e.inputType === 'deleteContentBackward') {
                        try {
                            const preRange = document.createRange();
                            preRange.setStart(seDiv, 0);
                            preRange.setEnd(range.startContainer, range.startOffset);
                            const preText = preRange.toString();
                            const preClone = preRange.cloneContents();
                            const hasPreContent = preText.length > 0 || preClone.querySelector('img, table');
                            if (!hasPreContent) { e.preventDefault(); return; }
                        } catch(_) {
                            const divStart = range.startOffset === 0 && (node === seDiv || node.parentElement === seDiv);
                            if (divStart) { e.preventDefault(); return; }
                        }
                    }
                    // [Delete] 커서가 se-div 끝 위치이면 아랫 블록과 병합 차단
                    if (e.inputType === 'deleteContentForward') {
                        try {
                            const postRange = document.createRange();
                            postRange.setStart(range.endContainer, range.endOffset);
                            // seDiv의 끝 위치로 range 끝 설정
                            const lastChild = seDiv.lastChild;
                            if (lastChild) {
                                if (lastChild.nodeType === 3) {
                                    postRange.setEnd(lastChild, lastChild.length);
                                } else {
                                    postRange.setEnd(seDiv, seDiv.childNodes.length);
                                }
                            } else {
                                postRange.setEnd(seDiv, 0);
                            }
                            const postText = postRange.toString();
                            const postClone = postRange.cloneContents();
                            const hasPostContent = postText.length > 0 || postClone.querySelector('img, table');
                            if (!hasPostContent) { e.preventDefault(); return; }
                        } catch(_) {
                            // fallback
                        }
                    }
                }

                // 선택 범위가 se-div 경계를 넘으면 차단
                if (!range.collapsed) {
                    const startDiv = range.startContainer.nodeType === 3
                        ? range.startContainer.parentElement?.closest('.se-div')
                        : range.startContainer.closest?.('.se-div');
                    const endDiv = range.endContainer.nodeType === 3
                        ? range.endContainer.parentElement?.closest('.se-div')
                        : range.endContainer.closest?.('.se-div');
                    if (startDiv && endDiv && startDiv !== endDiv) {
                        e.preventDefault();
                    }
                }
            });

            area.addEventListener('keyup', (e) => {
                if ([16,17,18,37,38,39,40].includes(e.keyCode)) return;
                const td = e.target.closest('td, th');
                if (td && (e.key.startsWith('Arrow') || ['Shift','Control','Alt','Meta'].includes(e.key))) return;
                // 빈 se-div가 되면 br 하나 보장 (영역 사라짐 방지)
                if (e.key === 'Backspace' || e.key === 'Delete') {
                    area.querySelectorAll('.se-div').forEach(div => {
                        if (!div.querySelector('table') && div.innerHTML.trim() === '') {
                            div.innerHTML = '<br>';
                        }
                    });
                }
                clearTimeout(typingTimer);
                typingTimer = setTimeout(() => { recordState(); }, 800);
            });

            area.addEventListener('dblclick', e => {
                const target = e.target;
                const block = target === area ? null : (target.closest('.se-div') || target.closest('table') || target.closest('div'));
                if (block) {
                    const selection = window.getSelection();
                    const range = document.createRange();
                    range.selectNode(block);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    showToast("\ube14\ub85d\uc774 \uc120\ud0dd\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \ubcf5\uc0ac(Ctrl+C) \ub610\ub294 \uc0ad\uc81c \uac00\ub2a5\ud569\ub2c8\ub2e4.");
                }
            });

            area.addEventListener('mousedown', e => {
                if (e.target.classList.contains('resizer-handle')) return; 

                const target = e.target; 
                const td = target.closest('td, th'); 
                const table = target.closest('table');
                const resizer = target.closest('.custom-resizer');
                // se-div 또는 se-para-div 우선 탐색, contentArea 내부로만 한정
                const div = (() => {
                    const closest = target.closest('.se-div, .se-para-div');
                    if (closest && area.contains(closest) && closest !== area) return closest;
                    const anyDiv = target !== area ? target.closest('div') : null;
                    if (anyDiv && area.contains(anyDiv) && anyDiv !== area) return anyDiv;
                    return null;
                })();
                // td 안의 img인지 판별 (td 분기보다 먼저 처리)
                const imgInTd = target.tagName === 'IMG' && td;
                
                if (activeLayer) activeLayer.classList.remove('active-layer');
                area.querySelectorAll('.img-selected').forEach(el => el.classList.remove('img-selected'));
                hideAllTools();
                hideImgFloatToolbar();

                // 테이블 셀이 아닌 곳 클릭 시 셀 선택 해제
                if (!td) {
                    clearSelection();
                    hideTableFloatToolbar();
                }

                if (resizer) {
                    activeLayer = resizer;
                    activeLayer.classList.add('active-layer');
                    getById('imgTools').style.display = 'flex';
                    hideTableFloatToolbar();

                } else if (imgInTd) {
                    // td 안 이미지 클릭 → 이미지 선택 우선, 셀/드래그 상태 완전 초기화
                    isSelecting = false; selectionStartCell = null;
                    clearSelection();
                    hideTableFloatToolbar();
                    activeLayer = target;
                    activeLayer.classList.add('active-layer');
                    getById('imgTools').style.display = 'flex';
                    showImgFloatToolbar(activeLayer);

                } else if (target.tagName === 'IMG') {
                    activeLayer = target;
                    activeLayer.classList.add('active-layer');
                    getById('imgTools').style.display = 'flex';
                    hideTableFloatToolbar();

                } else if (td) {
                    isSelecting = true; selectionStartCell = td; lastActiveCell = td; clearSelection();
                    td.classList.add('selected-cell'); selectedCells = [td];
                    activeLayer = table; activeLayer.classList.add('active-layer');
                    hideImgFloatToolbar();
                    setTimeout(() => showTableFloatToolbar(table, td), 0);

                } else if (table) {
                    activeLayer = table; activeLayer.classList.add('active-layer');
                    hideImgFloatToolbar();
                    setTimeout(() => showTableFloatToolbar(table, null), 0);
                } else if (div && div !== area && div.id !== 'contentArea' && area.contains(div)) {
                    activeLayer = div;
                    activeLayer.classList.add('active-layer');
                    getById('divTools').style.display = 'flex';
                    hideTableFloatToolbar();
                    // 아래 줄 추가 버튼 - 선택된 div 바로 아래에 위치
                    positionAddLineBtn();
                    
                    const computed = window.getComputedStyle(div);
                    getById('divRadiusInput').value = parseInt(computed.borderRadius) || 0;
                    const _pdEl = getById('divPaddingInput'); if (_pdEl) { _pdEl.value = Math.round(parseFloat(computed.paddingTop)) || Math.round(parseFloat(computed.paddingLeft)) || 0; }
                    getById('divShadowInput').checked = computed.boxShadow && computed.boxShadow !== 'none';
                    const divBgPk = getById('divBgColorInput');
                    if (divBgPk) {
                        const rgb = computed.backgroundColor;
                        if (rgb && rgb !== 'rgba(0, 0, 0, 0)' && rgb !== 'transparent') {
                            const m = rgb.match(/\d+/g);
                            if (m && m.length >= 3) {
                                divBgPk.value = '#' + [m[0],m[1],m[2]].map(n=>parseInt(n).toString(16).padStart(2,'0')).join('');
                            }
                        }
                    }
                } else {
                    activeLayer = null; lastActiveCell = null;
                    hideTableFloatToolbar();
                }
            });

            // copy 이벤트 - 인라인 스타일 완전 보존 (background-color 포함)
            area.addEventListener('copy', e => {
                const sel = window.getSelection();
                if (!sel || sel.isCollapsed) return;
                const range = sel.getRangeAt(0);
                const frag = range.cloneContents();
                const tmp = document.createElement('div');
                tmp.appendChild(frag);
                const html = tmp.innerHTML;
                if (html.trim()) {
                    e.preventDefault();
                    e.clipboardData.setData('text/html', html);
                    e.clipboardData.setData('text/plain', sel.toString());
                }
            });

            area.addEventListener('paste', e => {
                // HTML 표 붙여넣기 우선 처리 (엑셀 복사 시 이미지보다 먼저)
                const htmlDataFirst = e.clipboardData.getData('text/html');
                if (htmlDataFirst && /<table/i.test(htmlDataFirst) && !e.target.closest('td, th')) {
                    e.preventDefault();
                    recordState();
                    const doc2 = new DOMParser().parseFromString(htmlDataFirst, 'text/html');
                    const tbl = doc2.querySelector('table');
                    if (tbl) {
                        // 테이블 자체 스타일만 교체 (셀 스타일 건드리지 않음)
                        tbl.style.cssText = 'width:100%;border-collapse:collapse;table-layout:fixed;';
                        tbl.querySelectorAll('th, td').forEach(cell => {
                            // bgcolor 속성은 제거하되 style의 background-color는 유지
                            const bgAttr = cell.getAttribute('bgcolor');
                            if (bgAttr) {
                                // bgcolor → style background-color로 이전
                                const existing = cell.getAttribute('style') || '';
                                if (!existing.includes('background-color')) {
                                    cell.style.backgroundColor = bgAttr;
                                }
                                cell.removeAttribute('bgcolor');
                            }
                            cell.removeAttribute('width');
                        });
                        const area2 = getById('contentArea');
                        area2.focus();
                        const sel3 = window.getSelection();
                        if (savedRange && area2.contains(savedRange.startContainer)) {
                            sel3.removeAllRanges();
                            sel3.addRange(savedRange);
                        } else {
                            const r3 = document.createRange();
                            r3.selectNodeContents(area2);
                            r3.collapse(false);
                            sel3.removeAllRanges();
                            sel3.addRange(r3);
                        }
                        document.execCommand('insertHTML', false, tbl.outerHTML);
                        setTimeout(() => fixTableThs(), 0); // 붙여넣기 후 th→td 정규화
                        recordState();
                        showToast('표가 삽입되었습니다.');
                    }
                    return;
                }
                // 이미지 붙여넣기 (클립보드 이미지)
                const items = e.clipboardData?.items;
                if (items) {
                    for (const item of items) {
                        if (item.type.startsWith('image/')) {
                            e.preventDefault();
                            const file = item.getAsFile();
                            if (!file) break;
                            const reader = new FileReader();
                            reader.onload = ev => {
                                recordState();
                                const img = document.createElement('img');
                                img.src = ev.target.result;
                                img.style.cssText = 'max-width:100%;height:auto;display:block;margin:0 auto;';

                                const activeTd = e.target.closest('td, th');
                                if (activeTd) {
                                    // td 안에 붙여넣기: 기존 내용 대체
                                    activeTd.innerHTML = '';
                                    activeTd.appendChild(img);
                                } else {
                                    const area2 = getById('contentArea');
                                    const sel2 = window.getSelection();
                                    if (sel2 && sel2.rangeCount && area2.contains(sel2.getRangeAt(0).startContainer)) {
                                        const range = sel2.getRangeAt(0);
                                        range.deleteContents();
                                        range.insertNode(img);
                                    } else {
                                        area2.appendChild(img);
                                    }
                                }
                                recordState();
                                showToast('이미지가 붙여넣기 되었습니다.');
                            };
                            reader.readAsDataURL(file);
                            return;
                        }
                    }
                }

                // 셀 내부 붙여넣기
                const td = e.target.closest('td, th');
                if (!td) return;
                e.preventDefault();
                // HTML에 여러 행이 있으면 자동 행 추가
                const tdHtml = e.clipboardData.getData('text/html');
                if (tdHtml) {
                    const tmpDoc = new DOMParser().parseFromString(tdHtml, 'text/html');
                    const srcRows = tmpDoc.querySelectorAll('tr');
                    if (srcRows.length > 1) {
                        // 여러 행 → 자동 행 추가
                        const table = td.closest('table');
                        const tbody = table.querySelector('tbody') || table;
                        const allRows = Array.from(tbody.querySelectorAll('tr'));
                        const startRowIdx = allRows.indexOf(td.closest('tr'));
                        const startColIdx = Array.from(td.closest('tr').cells).indexOf(td);
                        recordState();
                        srcRows.forEach((srcRow, ri) => {
                            let targetRow = allRows[startRowIdx + ri];
                            if (!targetRow) {
                                targetRow = allRows[allRows.length - 1].cloneNode(true);
                                targetRow.querySelectorAll('td, th').forEach(c => { c.textContent = ''; });
                                tbody.appendChild(targetRow);
                                allRows.push(targetRow);
                            }
                            Array.from(srcRow.cells).forEach((srcCell, ci) => {
                                const cell = Array.from(targetRow.cells)[startColIdx + ci];
                                if (cell) cell.innerHTML = srcCell.innerHTML;
                            });
                        });
                        recordState();
                        return;
                    } else if (srcRows.length === 1) {
                        // 단일 행 → 셀 스타일 포함 붙여넣기
                        const srcTd = tmpDoc.querySelector('td, th');
                        if (srcTd) {
                            if (srcTd.getAttribute('style')) td.setAttribute('style', srcTd.getAttribute('style'));
                            td.innerHTML = srcTd.innerHTML;
                            recordState();
                            return;
                        }
                    }
                }
                const text = (e.clipboardData || window.clipboardData).getData('text/plain');
                const rows = text.split(/\r?\n/).filter(r => r.trim() !== '');
                if (rows.length > 1 || rows[0]?.includes('\t')) {
                    // 여러 행/열: 현재 셀부터 채우고 행 부족하면 추가
                    const table = td.closest('table');
                    const tbody = table.querySelector('tbody') || table;
                    const allRows = Array.from(tbody.querySelectorAll('tr'));
                    let startRowIdx = allRows.indexOf(td.closest('tr'));
                    let startColIdx = Array.from(td.closest('tr').cells).indexOf(td);
                    recordState();
                    rows.forEach((row, ri) => {
                        const cols = row.split('\t');
                        let targetRow = allRows[startRowIdx + ri];
                        if (!targetRow) {
                            targetRow = allRows[allRows.length - 1].cloneNode(true);
                            targetRow.querySelectorAll('td, th').forEach(c => { c.textContent = ''; });
                            tbody.appendChild(targetRow);
                            allRows.push(targetRow);
                        }
                        const cells = Array.from(targetRow.cells);
                        cols.forEach((col, ci) => {
                            const cell = cells[startColIdx + ci];
                            if (cell) cell.textContent = col;
                        });
                    });
                    recordState();
                } else {
                    const sel = window.getSelection();
                    if (!sel.rangeCount) return;
                    sel.deleteFromDocument();
                    sel.getRangeAt(0).insertNode(document.createTextNode(text));
                    sel.collapseToEnd();
                    recordState();
                }
            });

            area.addEventListener('mouseover', e => {
                if (isSelecting && selectionStartCell) {
                    const td = e.target.closest('td, th');
                    if (td && td.closest('table') === selectionStartCell.closest('table')) {
                        const table = selectionStartCell.closest('table'); const rows = Array.from(table.rows);
                        const startR = selectionStartCell.parentElement.rowIndex, startC = selectionStartCell.cellIndex;
                        const endR = td.parentElement.rowIndex, endC = td.cellIndex;
                        const minR = Math.min(startR, endR), maxR = Math.max(startR, endR);
                        const minC = Math.min(startC, endC), maxC = Math.max(startC, endC);
                        clearSelection();
                        for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) { const cell = rows[r].cells[c]; if (cell) { cell.classList.add('selected-cell'); selectedCells.push(cell); } }
                        updateTableSelInfo();
                        showTableFloatToolbar(table, null);
                    }
                }
            });

            // 전역 undo/redo (contentArea 밖에서도 동작, 단 area 내부는 area keydown에서 처리해 중복 방지)
            document.addEventListener('keydown', e => {
                const _area = getById('contentArea');
                if (_area && _area.contains(e.target)) return; // area 내부는 아래 area.addEventListener에서 처리
                if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoAction(); }
                if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'Z')) { e.preventDefault(); redoAction(); }
            });

            area.addEventListener('keydown', e => {
                if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undoAction(); }
                if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) { e.preventDefault(); redoAction(); }
                // div/table 블록 선택 상태 단축키
                const isBlockLayer = activeLayer && (
                    activeLayer.classList.contains('se-div') ||
                    activeLayer.tagName === 'TABLE' ||
                    activeLayer.tagName === 'DIV'
                ) && !activeLayer.classList.contains('custom-resizer');

                if (isBlockLayer) {
                    // Ctrl+C: 블록 복사 (blockClipboard에도 저장 → Ctrl+V로 붙여넣기 가능)
                    if (e.ctrlKey && e.key === 'c') {
                        e.preventDefault();
                        setBlockClipboard(activeLayer.outerHTML);
                        const sel = window.getSelection();
                        const range = document.createRange();
                        range.selectNode(activeLayer);
                        sel.removeAllRanges();
                        sel.addRange(range);
                        document.execCommand('copy');
                        showToast('블록 복사됨 (Ctrl+V로 붙여넣기)');
                        return;
                    }
                    // Ctrl+X: 블록 잘라내기
                    if (e.ctrlKey && e.key === 'x') {
                        e.preventDefault();
                        recordState();
                        setBlockClipboard(activeLayer.outerHTML);
                        const sel = window.getSelection();
                        const range = document.createRange();
                        range.selectNode(activeLayer);
                        sel.removeAllRanges();
                        sel.addRange(range);
                        document.execCommand('copy');
                        activeLayer.remove();
                        activeLayer = null;
                        hideAllTools();
                        recordState();
                        showToast('블록 잘라내기됨 (Ctrl+V로 붙여넣기)');
                        return;
                    }
                    // Delete/Backspace: 텍스트 커서가 블록 안에 있으면 일반 텍스트 삭제 허용
                    if (e.key === 'Delete' || e.key === 'Backspace') {
                        const _sel = window.getSelection();
                        if (_sel && _sel.rangeCount > 0) {
                            const _r = _sel.getRangeAt(0);
                            if (activeLayer.contains(_r.commonAncestorContainer)) {
                                return; // 텍스트 커서 모드 — 브라우저 기본 삭제 허용
                            }
                        }
                        e.preventDefault();
                        recordState();
                        activeLayer.remove();
                        activeLayer = null;
                        hideAllTools();
                        recordState();
                        showToast('블록이 삭제되었습니다.');
                        return;
                    }
                }

                if (e.ctrlKey && e.key === 'x' && activeLayer && (activeLayer.classList.contains('custom-resizer') || activeLayer.tagName === 'IMG')) {
                    e.preventDefault();
                    imgCutAction();
                    return;
                }

                if (e.ctrlKey && e.key === 'c' && activeLayer && (activeLayer.classList.contains('custom-resizer') || activeLayer.tagName === 'IMG')) {
                    const sel = window.getSelection();
                    if (!sel || sel.toString().trim() === '') {
                        e.preventDefault();
                        imgCopyAction();
                        return;
                    }
                }

                if (e.ctrlKey && e.key === 'v' && imgClipboard) {
                    e.preventDefault();
                    imgPasteAction();
                    return;
                }
                if (e.ctrlKey && e.key === 'v' && blockClipboard && !e.target.closest('td, th')) {
                    // blockClipboard가 있고 이미지 클립보드가 없는 경우에만 블록 붙여넣기
                    if (!imgClipboard) {
                        e.preventDefault();
                        blockPasteAction();
                        return;
                    }
                }
                
                // Delete/Backspace - 테이블 셀 선택 상태
                if ((e.key === 'Delete' || e.key === 'Backspace') && selectedCells.length > 0) {
                    const selection = window.getSelection();
                    // 텍스트가 선택된 경우 브라우저 기본 동작 허용 (텍스트 삭제)
                    // 단, 선택이 셀 경계를 넘는 경우만 방지
                    if (selection.toString().length === 0) { e.preventDefault(); smartDeleteAction('row'); }

                // td 안 이미지 선택 상태에서 Delete/Backspace → 이미지 삭제
                } else if ((e.key === 'Delete' || e.key === 'Backspace') && activeLayer && activeLayer.tagName === 'IMG' && activeLayer.closest('td, th')) {
                    e.preventDefault();
                    recordState();
                    const parentTd = activeLayer.closest('td, th');
                    activeLayer.remove();
                    activeLayer = null;
                    hideAllTools();
                    hideImgFloatToolbar();
                    lastActiveCell = parentTd;
                    recordState();
                    showToast('이미지가 삭제되었습니다.');

                // 일반 콘텐츠 영역 이미지/영상 (custom-resizer 래퍼 또는 bare 요소) 삭제
                } else if ((e.key === 'Delete' || e.key === 'Backspace') && activeLayer && (
                    activeLayer.classList?.contains('custom-resizer') ||
                    (activeLayer.tagName === 'IMG' && !activeLayer.closest('td, th')) ||
                    activeLayer.tagName === 'VIDEO'
                )) {
                    e.preventDefault();
                    recordState();
                    activeLayer.remove();
                    activeLayer = null;
                    hideAllTools();
                    hideImgFloatToolbar();
                    recordState();
                    showToast('미디어가 삭제되었습니다.');
                }

                // Enter 키 처리 - p 태그 안이면 새 p, 아니면 br
                if (e.key === 'Enter' && !e.shiftKey && !e.target.closest('td, th')) {
                    const sel = window.getSelection();
                    if (!sel || !sel.rangeCount) return;
                    const node = sel.anchorNode;
                    const el = node ? (node.nodeType === 3 ? node.parentElement : node) : null;
                    const inSeDiv = el && el.closest('.se-div');
                    const inP = el && el.closest('p');
                    if (inSeDiv) {
                        e.preventDefault();
                        const range = sel.getRangeAt(0);
                        range.deleteContents();
                        if (inP && inP.closest('.se-div')) {
                            // p 태그 안 → p 뒤에 새 p 삽입
                            const newP = document.createElement('p');
                            const styleStr = inP.getAttribute('style') || 'margin:0;line-height:1.8;';
                            newP.setAttribute('style', styleStr);
                            newP.innerHTML = '<br>';
                            inP.insertAdjacentElement('afterend', newP);
                            const newRange = document.createRange();
                            newRange.setStart(newP, 0);
                            newRange.collapse(true);
                            sel.removeAllRanges();
                            sel.addRange(newRange);
                        } else {
                            // p 밖 → br 삽입
                            const br = document.createElement('br');
                            range.insertNode(br);
                            const newRange = document.createRange();
                            newRange.setStartAfter(br);
                            newRange.collapse(true);
                            sel.removeAllRanges();
                            sel.addRange(newRange);
                        }
                        recordState(); // Enter 후 즉시 스냅샷 — Ctrl+Z 즉시 복원 보장
                    }
                }
            });

            recordState();

            // contentArea가 비어도 최소 높이 유지 (삭제 시 영역 사라짐 방지)
            const areaObserver = new MutationObserver(() => {
                const hasContent = area.innerHTML.trim().replace(/<br\s*\/?>/gi,'').replace(/&nbsp;/gi,'').trim().length > 0;
                area.style.minHeight = hasContent ? '200px' : '600px';
            });
            areaObserver.observe(area, { childList: true, subtree: true });
            area.addEventListener('click', e => {
                // 링크 새탭 열기
                // - 버튼 링크(<a> 또는 버튼 안 <a>): 일반 클릭으로 새 탭 (팝업 트리거·탭 버튼 제외)
                // - 일반 텍스트 링크: Ctrl/Cmd+클릭으로 새 탭
                const clickedLink = e.target.closest('a[href]');
                if (clickedLink && area.contains(clickedLink)) {
                    const isPopupTrigger = clickedLink.classList.contains('popup-trigger') || clickedLink.closest('.popup-trigger');
                    const isTabBtn = clickedLink.classList.contains('se-tab-btn') || clickedLink.closest('.se-tab-nav, .se-tabs');
                    const linkHref = clickedLink.getAttribute('href') || '';
                    const isAnchorLink = linkHref.startsWith('#') || linkHref === 'javascript:void(0)' || linkHref === 'javascript:;';
                    const isButtonLink = clickedLink.closest('button') ||
                        clickedLink.style.display?.includes('inline-flex') ||
                        clickedLink.style.display?.includes('flex') ||
                        clickedLink.style.borderRadius ||
                        clickedLink.style.padding ||
                        clickedLink.classList.contains('btn') ||
                        clickedLink.getAttribute('role') === 'button';
                    if (!isPopupTrigger && !isTabBtn && !isAnchorLink && (isButtonLink || e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        e.stopPropagation();
                        window.open(clickedLink.href, '_blank', 'noopener');
                        return;
                    }
                }
                // contenteditable 안에서 onclick 속성 실행 허용
                const onclickEl = e.target.closest('[onclick]');
                if (onclickEl && area.contains(onclickEl)) {
                    // popup-trigger: 에디터에서는 onclick 실행 안 함 (childPanel이 처리)
                    if (onclickEl.classList.contains('popup-trigger') || onclickEl.hasAttribute('data-popup')) return;
                    const fn = onclickEl.getAttribute('onclick');
                    if (fn) {
                        try { new Function(fn).call(onclickEl); } catch(err) { console.warn('onclick:', err); }
                    }
                }

                const clickedImg   = e.target.tagName === 'IMG' ? e.target : null;
                const clickedVideo = e.target.tagName === 'VIDEO' ? e.target : e.target.closest('video');
                const clickedResizer = e.target.closest('.custom-resizer');

                if (clickedResizer) {
                    e.preventDefault();
                    if (activeLayer) activeLayer.classList.remove('active-layer');
                    activeLayer = clickedResizer;
                    activeLayer.classList.add('active-layer');
                    getById('tableTools').style.display = 'none';
                    getById('imgTools').style.display = 'flex';
                    getById('divTools').style.display = 'none';
                    showImgFloatToolbar(activeLayer);
                    return;
                }

                // Ctrl+클릭 또는 se-div 직접 클릭 시 div 선택
                const clickedDiv = e.target.classList?.contains('se-div') ? e.target : e.target.closest('.se-div');
                if (clickedDiv && area.contains(clickedDiv) && (e.ctrlKey || e.metaKey || e.target === clickedDiv)) {
                    if (activeLayer) activeLayer.classList.remove('active-layer');
                    activeLayer = clickedDiv;
                    activeLayer.classList.add('active-layer');
                    getById('tableTools').style.display = 'none';
                    getById('imgTools').style.display = 'none';
                    getById('divTools').style.display = 'flex';
                    // 아래 줄 추가 버튼 - 선택된 div 바로 아래에 위치
                    positionAddLineBtn();
                    if (e.ctrlKey || e.metaKey) { e.preventDefault(); return; }
                }

                if (clickedImg && area.contains(clickedImg)) {
                    e.preventDefault();
                    if (activeLayer) activeLayer.classList.remove('active-layer');
                    area.querySelectorAll('.img-selected').forEach(el => el.classList.remove('img-selected'));
                    getById('tableTools').style.display = 'none';
                    getById('imgTools').style.display = 'flex';
                    getById('divTools').style.display = 'none';
                    hideImgFloatToolbar();

                    // td/th 안 이미지: 래퍼 없이 글자처럼 inline 취급 — 직접 선택
                    if (clickedImg.closest('td, th')) {
                        clickedImg.classList.add('img-selected');
                        activeLayer = clickedImg;
                        showImgFloatToolbar(activeLayer);
                        return;
                    }

                    recordState();
                    const wrap = wrapImgInResizer(clickedImg);
                    wrap.classList.add('active-layer');
                    activeLayer = wrap;
                    recordState();
                    showImgFloatToolbar(activeLayer);
                    return;
                }

                // 영상 클릭 → 이미지와 동일하게 리사이저 래핑 + 선택
                if (clickedVideo && area.contains(clickedVideo) && !clickedVideo.closest('.custom-resizer')) {
                    e.preventDefault();
                    if (activeLayer) activeLayer.classList.remove('active-layer');
                    getById('tableTools').style.display = 'none';
                    getById('imgTools').style.display = 'flex';
                    getById('divTools').style.display = 'none';
                    hideImgFloatToolbar();
                    recordState();
                    const wrap = wrapImgInResizer(clickedVideo);
                    wrap.classList.add('active-layer');
                    activeLayer = wrap;
                    recordState();
                    showImgFloatToolbar(activeLayer);
                    return;
                }

                if (e.target === area) {
                    const newDiv = document.createElement('div');
                    newDiv.innerHTML = '<br>';
                    area.appendChild(newDiv);
                    newDiv.focus();
                }
            });


            document.addEventListener('mousedown', function(e) {
                const area = getById('contentArea');
                // 플로팅 툴바 클릭 시 선택 상태 유지 (툴바가 contentArea 밖 fixed 엘리먼트)
                const imgTb  = getById('imgFloatToolbar');
                const tblTb  = getById('tableFloatToolbar');
                const vidTb  = getById('videoOptToolbar');
                const addBtn = getById('addLineBtn');
                if ((imgTb && imgTb.contains(e.target)) || (tblTb && tblTb.contains(e.target)) || (vidTb && vidTb.contains(e.target))) return;
                // addLineBtn 클릭 시 activeLayer 유지 (클릭 핸들러에서 사용)
                if (addBtn && addBtn.contains(e.target)) return;

                const inContentArea = area && area.contains(e.target);
                const inChildArea   = !!e.target.closest('[id^="childArea_"]');
                if (!inContentArea && !inChildArea) {
                    clearActiveLayer(); // img-selected 포함 전체 해제
                    clearSelection();
                    hideTableFloatToolbar();
                }
            });
        });

        function addLineBelow() {
            if (!activeLayer) return;
            // 스크롤 위치 저장 (focus 시 위로 튀는 현상 방지)
            const scrollContainer = getById('canvasScroll');
            const savedScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
            recordState();
            const newP = document.createElement('p');
            const textColor = getById('textColorPicker')?.value || '#1e293b';
            newP.style.cssText = `margin:0;line-height:1.8;color:${textColor};font-size:inherit;`;
            newP.innerHTML = '<br>';
            activeLayer.after(newP);
            activeLayer.classList.remove('active-layer');
            activeLayer = null;
            getById('addLineBtn').style.display = 'none';
            getById('divTools').style.display = 'none';
            recordState();
            setTimeout(() => {
                const area2 = getById('contentArea');
                if (area2) {
                    // 스크롤 복원 후 focus (preventScroll로 위치 유지)
                    area2.focus({ preventScroll: true });
                    const sel2 = window.getSelection();
                    const range2 = document.createRange();
                    range2.setStart(newP, 0);
                    range2.collapse(true);
                    sel2.removeAllRanges();
                    sel2.addRange(range2);
                    if (scrollContainer) scrollContainer.scrollTop = savedScrollTop;
                    newP.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }, 10);
        }

        // ── Notion 연동 ────────────────────────────────────────────────────────
        let registeredNotionPageId = null;
        let registeredNotionTitle = '';

        function extractNotionPageId(url) {
            const match = url.match(/([a-f0-9]{32})(?:\?|$|#)/i)
                || url.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\?|$|#)/i);
            if (!match) return null;
            const id = match[1].replace(/-/g, '');
            return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
        }

        function notionBlocksToText(blocks) {
            const lines = [];
            for (const block of blocks) {
                const type = block.type;
                const b = block[type];
                if (!b) continue;
                const richText = (b.rich_text || []).map(t => t.plain_text).join('');
                switch (type) {
                    case 'heading_1': lines.push(`# ${richText}`); break;
                    case 'heading_2': lines.push(`## ${richText}`); break;
                    case 'heading_3': lines.push(`### ${richText}`); break;
                    case 'paragraph': lines.push(richText || ''); break;
                    case 'bulleted_list_item': lines.push(`- ${richText}`); break;
                    case 'numbered_list_item': lines.push(`• ${richText}`); break;
                    case 'to_do': lines.push(`${b.checked ? '☑' : '☐'} ${richText}`); break;
                    case 'quote': lines.push(`> ${richText}`); break;
                    case 'callout': lines.push(`${b.icon?.emoji || ''} ${richText}`); break;
                    case 'divider': lines.push('---'); break;
                    case 'table_row': {
                        const cells = (b.cells || []).map(cell => cell.map(t => t.plain_text).join('')).join(' | ');
                        lines.push(`| ${cells} |`);
                        break;
                    }
                    default: if (richText) lines.push(richText); break;
                }
                if (block._children && block._children.length > 0) {
                    lines.push(notionBlocksToText(block._children));
                }
            }
            return lines.join('\n');
        }

        async function fetchNotionBlocks(pageId, token, cursor = null) {
            const PROXY = 'https://corsproxy.io/?url=';
            const target = `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
            const url = PROXY + encodeURIComponent(target);
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28' }
            });
            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                throw new Error(`Notion API 오류: ${res.status} — ${errText.slice(0, 120)}`);
            }
            return await res.json();
        }

        async function fetchNotionContent(pageId) {
            const token = getById('notionTokenInput')?.value.trim();
            if (!token) throw new Error('Notion Integration Token이 없습니다.');

            const PROXY = 'https://corsproxy.io/?url=';

            // 페이지 제목
            let pageTitle = '';
            try {
                const pageRes = await fetch(PROXY + encodeURIComponent(`https://api.notion.com/v1/pages/${pageId}`), {
                    headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28' }
                });
                if (pageRes.ok) {
                    const pageData = await pageRes.json();
                    const titleProp = Object.values(pageData.properties || {}).find(p => p.type === 'title');
                    if (titleProp) pageTitle = (titleProp.title || []).map(t => t.plain_text).join('');
                }
            } catch(e) {}

            // 블록 전체 가져오기
            let allBlocks = [], cursor = null, hasMore = true;
            while (hasMore) {
                const data = await fetchNotionBlocks(pageId, token, cursor);
                const blocks = data.results || [];
                for (const block of blocks) {
                    if (block.has_children && ['table','toggle','bulleted_list_item','numbered_list_item'].includes(block.type)) {
                        try {
                            const cd = await fetchNotionBlocks(block.id, token);
                            block._children = cd.results || [];
                        } catch(e) { block._children = []; }
                    }
                }
                allBlocks = allBlocks.concat(blocks);
                hasMore = data.has_more;
                cursor = data.next_cursor;
                if (allBlocks.length > 500) break;
            }

            const text = notionBlocksToText(allBlocks);
            return { title: pageTitle, text: pageTitle ? `# ${pageTitle}\n\n${text}` : text };
        }

        // 노션 URL 등록
        async function registerNotionUrl() {
            // file:// 프로토콜에서는 CORS 프록시가 null origin을 차단함 → 경고
            if (window.location.protocol === 'file:') {
                showToast('❌ Notion 연동은 파일을 직접 열면 동작하지 않습니다.\n→ VS Code Live Server 또는 http://localhost 로 접속해주세요.');
                alert('⚠️ Notion 연동 불가\n\n현재 파일을 직접(file://) 열고 있습니다.\n\n해결 방법:\n1. VS Code → index.html 우클릭 → "Open with Live Server"\n2. 또는 터미널: python3 -m http.server 8080\n   → 브라우저에서 http://localhost:8080 접속');
                return;
            }
            const urlInput = getById('notionPageUrl')?.value.trim();
            if (!urlInput) return showToast('⚠️ Notion URL을 입력하세요.');
            const token = getById('notionTokenInput')?.value.trim();
            if (!token) return showToast('⚠️ ENGINE SETTINGS에서 Notion Token을 먼저 입력하세요.');

            const pageId = extractNotionPageId(urlInput);
            if (!pageId) return showToast('⚠️ 유효한 Notion URL이 아닙니다.');

            showToast('📋 연결 확인 중...');
            try {
                const { title } = await fetchNotionContent(pageId);
                registeredNotionPageId = pageId;
                registeredNotionTitle = title || '노션 기획서';
                getById('notionRegisteredTitle').textContent = registeredNotionTitle;
                getById('notionRegistered').style.display = 'flex';
                showToast(`✅ "${registeredNotionTitle}" 연동 완료!`);
            } catch(e) {
                showToast('❌ 연결 실패: ' + e.message);
            }
        }

        // 기획서 업데이트 + 바로 생성
        async function notionUpdateAndGenerate() {
            if (!registeredNotionPageId) return showToast('⚠️ 노션 URL을 먼저 등록하세요.');
            const spinner = getById('notionUpdateSpinner');
            const btn = getById('notionUpdateBtn');
            if (spinner) spinner.classList.remove('hidden');
            if (btn) btn.disabled = true;
            showToast('🔄 노션에서 최신 내용 가져오는 중...');
            try {
                const { text } = await fetchNotionContent(registeredNotionPageId);
                getById('contentData').value = text;
                showToast('✅ 불러오기 완료! 생성 시작...');
                // 바로 generateContent 실행
                await generateContent();
            } catch(e) {
                showToast('❌ 실패: ' + e.message);
            } finally {
                if (spinner) spinner.classList.add('hidden');
                if (btn) btn.disabled = false;
            }
        }

        function clearNotionUrl() {
            registeredNotionPageId = null;
            registeredNotionTitle = '';
            const reg = getById('notionRegistered');
            if (reg) reg.style.display = 'none';
            const url = getById('notionPageUrl');
            if (url) url.value = '';
            const urlTop = getById('notionPageUrlTop');
            if (urlTop) urlTop.value = '';
            showToast('노션 연동이 해제되었습니다.');
        }

        function initNotionDetection() {} // placeholder (UI로 대체)
        // ── Notion 연동 끝 ────────────────────────────────────────────────────

        function showToast(msg) { const t = getById('toast'); if (t) { t.innerText = msg; t.style.display = 'block'; setTimeout(() => t.style.display = 'none', 3000); } }

        // tbody 내 th → td 강제 변환 + 각 행의 컬럼 수 정규화
        function fixTableThs(root) {
            (root || getById('contentArea'))?.querySelectorAll('table').forEach(table => {
                // 0) td/th 안의 기존 custom-resizer 래퍼 제거 → img를 inline 취급으로 복원
                // 안전: img + resizer-handle만 있는 래퍼만 처리 (다른 콘텐츠 있으면 건드리지 않음)
                table.querySelectorAll('td .custom-resizer, th .custom-resizer').forEach(wrap => {
                    const img = wrap.querySelector('img');
                    if (!img) return; // img 없는 래퍼는 건드리지 않음 (콘텐츠 유실 방지)
                    // img + resizer-handle 이외의 자식이 있으면 보존 (건드리지 않음)
                    const nonHandleChildren = Array.from(wrap.children).filter(
                        c => !c.classList.contains('resizer-handle') && c !== img
                    );
                    if (nonHandleChildren.length > 0) return; // 다른 자식 있으면 스킵
                    img.style.maxWidth = '100%';
                    img.style.height = 'auto';
                    img.style.display = 'block';
                    img.style.margin = '0 auto';
                    img.style.pointerEvents = '';
                    wrap.replaceWith(img);
                });

                // 0-0) 모든 td/th 공통 인라인 스타일 일괄 적용
                // ⚠️ outline/position 은 인라인 적용 금지 — CSS selected-cell 오버라이드 방지
                table.querySelectorAll('td, th').forEach(cell => {
                    if (!cell.style.border)        cell.style.border        = '1px solid #d9d9d9';
                    if (!cell.style.padding)        cell.style.padding       = '0.875rem 1rem';
                    if (!cell.style.minWidth)       cell.style.minWidth      = '2.5rem';
                    cell.style.wordBreak     = 'keep-all';
                    cell.style.overflowWrap  = 'break-word';
                    cell.style.verticalAlign = 'middle';
                    cell.style.lineHeight    = '1.4';
                    if (!cell.style.color)          cell.style.color         = 'inherit';
                    cell.style.boxSizing     = 'border-box';
                    if (!cell.style.fontSize)       cell.style.fontSize      = 'clamp(13px,1.5vw,15px)';
                });
                // 0-1) thead th/td 텍스트 가운데 정렬 + 헤더 하단 구분선
                table.querySelectorAll('thead th, thead td').forEach(cell => {
                    cell.style.textAlign    = 'center';
                    cell.style.fontWeight   = '700';
                    // AI가 설정한 border-bottom 보존, 없을 때만 기본값 적용
                    if (!cell.style.borderBottom) {
                        const ac = getById('accentPicker')?.value;
                        cell.style.borderBottom = '2px solid ' + ((ac && ac !== '#888888') ? ac : '#8b7355');
                    }
                });
                // 0-2) 테이블 자체 인라인 스타일 정규화
                table.style.borderCollapse = 'collapse';
                table.style.width          = '100%';
                table.style.tableLayout    = 'fixed';
                table.style.boxSizing      = 'border-box';

                // 1) thead의 th는 유지, 나머지 th → td 변환
                const theadThs = new Set();
                table.querySelectorAll('thead th').forEach(th => theadThs.add(th));
                table.querySelectorAll('th').forEach(th => {
                    if (theadThs.has(th)) return; // thead 헤더는 유지
                    const td = document.createElement('td');
                    td.innerHTML = th.innerHTML;
                    td.style.cssText = th.style.cssText;
                    if (th.getAttribute('colspan')) td.setAttribute('colspan', th.getAttribute('colspan'));
                    if (th.getAttribute('rowspan')) td.setAttribute('rowspan', th.getAttribute('rowspan'));
                    if (th.className) td.className = th.className;
                    th.replaceWith(td);
                });

                // 2) 컬럼 수 불일치 정규화 — rowspan/colspan 완전 고려 (그리드 시뮬레이션)
                const allRows = Array.from(table.querySelectorAll('tr'));
                if (allRows.length === 0) return;

                // 그리드 시뮬레이션: rowspan이 아래 행을 점유하는 것까지 추적
                const occupied = {}; // rowIdx → Set<colIdx>
                const markOccupied = (rowIdx, colIdx, rowspan, colspan) => {
                    for (let r = rowIdx; r < rowIdx + rowspan; r++) {
                        if (!occupied[r]) occupied[r] = new Set();
                        for (let c = colIdx; c < colIdx + colspan; c++) occupied[r].add(c);
                    }
                };
                let maxCols = 0;
                allRows.forEach((tr, rowIdx) => {
                    let colIdx = 0;
                    Array.from(tr.querySelectorAll('td, th')).forEach(cell => {
                        while (occupied[rowIdx]?.has(colIdx)) colIdx++;
                        const cs = parseInt(cell.getAttribute('colspan') || '1') || 1;
                        const rs = parseInt(cell.getAttribute('rowspan') || '1') || 1;
                        markOccupied(rowIdx, colIdx, rs, cs);
                        colIdx += cs;
                    });
                    const rowTotal = occupied[rowIdx] ? occupied[rowIdx].size : colIdx;
                    maxCols = Math.max(maxCols, rowTotal);
                });
                if (maxCols <= 0) return;

                // 부족한 행에만 빈 td 보충 — rowspan으로 덮인 행은 이미 occupiedInRow == maxCols
                table.querySelectorAll('tbody tr, tfoot tr').forEach(tr => {
                    const rowIdx = allRows.indexOf(tr);
                    const occupiedInRow = occupied[rowIdx] ? occupied[rowIdx].size : 0;
                    for (let c = occupiedInRow; c < maxCols; c++) {
                        const td = document.createElement('td');
                        td.style.cssText = 'border:1px solid #d9d9d9;padding:0.875rem 1rem;min-width:2.5rem;word-break:keep-all;overflow-wrap:break-word;vertical-align:middle;line-height:1.4;color:inherit;box-sizing:border-box;font-size:clamp(13px,1.5vw,15px);';
                        tr.appendChild(td);
                    }
                });

                // 3) 빈 행 제거 — 빈 인라인 포매팅 요소(span/b 등)도 비어있음으로 간주
                function isCellEffEmpty(cell) {
                    if (cell.textContent.replace(/[\s\u00a0\u200b]/g, '') !== '') return false;
                    return !Array.from(cell.childNodes).some(n => {
                        if (n.nodeType !== 1) return false;
                        if (['BR','WBR'].includes(n.tagName)) return false;
                        if (['SPAN','B','STRONG','I','EM','U','S','A','SMALL'].includes(n.tagName)) return !isCellEffEmpty(n);
                        return true; // IMG, TABLE 등 실체 요소
                    });
                }
                table.querySelectorAll('tr').forEach(tr => {
                    const cells = Array.from(tr.querySelectorAll('td, th'));
                    if (cells.length === 0) { tr.remove(); return; }
                    if (cells.every(isCellEffEmpty)) tr.remove();
                });
                // 빈 thead / tbody / tfoot 섹션 제거
                table.querySelectorAll('thead, tbody, tfoot').forEach(section => {
                    if (section.querySelectorAll('tr').length === 0) section.remove();
                });
            });
        }

        // 상단 ENGINE SETTINGS의 페이지 URL을 CONTENT ENGINE notionPageUrl 인풋과 동기화
        function syncNotionPageUrlToMain() {
            const topVal = (getById('notionPageUrlTop')?.value || '').trim();
            if (!topVal) { showToast('노션 페이지 URL을 입력하세요.'); return; }
            const mainInput = getById('notionPageUrl');
            if (mainInput) {
                mainInput.value = topVal;
                registerNotionUrl(); // CONTENT ENGINE의 등록 로직 실행
            } else {
                showToast('연동 완료 (CONTENT ENGINE 섹션에서 확인하세요)');
            }
        }

        // 노션 동기화 변경 확인 (기획서 연동 패널)
        async function checkNotionSync() {
            const token = getById('notionTokenInput')?.value.trim();
            const pageUrl = getById('notionPageUrl')?.value.trim();
            const statusEl = getById('notionSyncStatus');
            if (!token || !pageUrl) {
                showToast('노션 토큰과 페이지 URL을 먼저 입력하세요.');
                return;
            }
            // 페이지 ID 추출 (URL 또는 ID 직접 입력)
            const idMatch = pageUrl.replace(/-/g,'').match(/[0-9a-f]{32}/i);
            if (!idMatch) { showToast('올바른 노션 페이지 URL 또는 ID를 입력하세요.'); return; }
            const pageId = idMatch[0];
            if (statusEl) { statusEl.textContent = '확인 중...'; statusEl.classList.remove('hidden'); }
            try {
                const res = await fetch(`https://corsproxy.io/?https://api.notion.com/v1/pages/${pageId}`, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28' }
                });
                if (!res.ok) throw new Error('API 오류 ' + res.status);
                const data = await res.json();
                const lastEdited = data.last_edited_time;
                const stored = localStorage.getItem('notion_last_edited_' + pageId);
                const mode = getById('notionSyncMode')?.value || 'notify';
                if (statusEl) {
                    statusEl.textContent = `마지막 수정: ${new Date(lastEdited).toLocaleString('ko-KR')}`;
                    statusEl.classList.remove('hidden');
                }
                if (stored && stored !== lastEdited) {
                    if (mode === 'notify') {
                        showToast('📢 노션 기획서가 수정됐습니다! 재생성 버튼을 눌러주세요.');
                        if (statusEl) statusEl.textContent += ' ⚠️ 변경 감지됨';
                    } else if (mode === 'auto') {
                        showToast('🔄 변경 감지 — 자동 재생성 시작...');
                        await generateContent();
                    }
                } else if (!stored) {
                    showToast('노션 연결 확인 완료. 현재 상태가 저장됐습니다.');
                } else {
                    showToast('변경사항 없음 — 최신 상태입니다.');
                }
                localStorage.setItem('notion_last_edited_' + pageId, lastEdited);
            } catch(e) {
                showToast('노션 확인 실패: ' + e.message);
                if (statusEl) { statusEl.textContent = '연결 실패: ' + e.message; }
            }
        }
    