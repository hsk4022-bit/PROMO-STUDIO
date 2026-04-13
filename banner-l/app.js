const { useState, useRef, useEffect } = React;
const {
  Download, Layout, CheckCircle2, AlertCircle, Loader2, X, Zap, Box, Type,
  MessageSquareText, Check, PlusSquare, Maximize, RotateCcw,
  Layers, Trash2, PlusCircle, Square, CheckSquare,
  Scan, Files, UploadCloud, Info, Archive, ImageIcon,
  LayoutTemplate, Languages, ImagePlus, KeyRound, Plus, FileSpreadsheet,
  Globe, Save, ChevronRight, Link: LinkIcon, RefreshCw, ClipboardList,
  Hash, AlignLeft, Crown
} = LucideReact;

const apiKeyDefault = "";
const API_MODEL = "gemini-3.1-flash-image-preview";

// master_guidelines.md 로드 (캐시)
let _guidelinesCache = null;
const loadGuidelines = async () => {
  if (_guidelinesCache) return _guidelinesCache;
  const resp = await fetch('master_guidelines.md');
  _guidelinesCache = await resp.text();
  return _guidelinesCache;
};

// --- 28개 규격별 로고 데이터 박제 ---
const FIXED_LOGO_SCALES = {
  "640x100": 60, "728x90": 45, "970x90": 50, "300x50": 65, "300x60": 70, "320x50": 75, "320x100": 85, "900x150": 70, "970x250": 55, "500x500": 80, "1080x1080": 70, "300x250": 85, "480x320": 75, "800x400": 60, "1024x768": 60, "1200x628": 55, "1200x800": 55, "1280x720": 50, "1920x1080": 60, "320x480": 110, "300x600": 110, "375x667": 110, "640x960": 90, "768x1024": 80, "800x1200": 80, "720x1280": 85, "1203x1500": 85, "1080x1920": 85
};

const FIXED_LOGO_PADDINGS = {
  "1024x1024": 32, "640x100": 12, "728x90": 12, "970x90": 12, "300x50": 8, "300x60": 8, "320x50": 8, "320x100": 8, "900x150": 12, "970x250": 12, "500x500": 24, "1080x1080": 32, "300x250": 12, "480x320": 12, "800x400": 24, "1024x768": 24, "1200x628": 24, "1200x800": 24, "1280x720": 24, "1920x1080": 24, "320x480": 12, "300x600": 12, "375x667": 24, "640x960": 24, "768x1024": 24, "800x1200": 32, "720x1280": 32, "1203x1500": 32, "1080x1920": 32
};

// --- UTILS ---
const processImageMetadata = (file) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const src = e.target.result;
      const img = new Image();
      img.src = src;
      img.onload = () => resolve({ id: `src-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, src, w: img.width, h: img.height, name: file.name });
      img.onerror = () => resolve(null);
    };
  });
};

const urlToBase64 = (url) => {
  return new Promise((resolve) => {
    if (!url || !url.startsWith('http') || url.includes('...')) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
};

const stripBase64Params = (base64) => base64?.split('base64,')[1] || '';

const finalizeBannerPixel = (base64, targetW, targetH, logoBase64, scaleModifier = 100, position = 'tl') => {
  return new Promise((resolve) => {
    if (!base64) return resolve(null);
    const img = new Image();
    img.src = base64;
    img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = targetW; canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.drawImage(img, 0, 0, targetW, targetH);

        if (logoBase64) {
          try {
            const logoImg = await new Promise((res, rej) => {
                const lImg = new Image(); lImg.src = logoBase64;
                lImg.onload = () => res(lImg); lImg.onerror = rej;
            });
            const key = `${targetW}x${targetH}`;
            const padding = FIXED_LOGO_PADDINGS[key] || 12;
            let baseLogoH = targetH * 0.22; let baseLogoW = targetW * 0.28;
            if (targetH <= 100) baseLogoH = targetH * 0.48;
            let maxLogoH = baseLogoH * (scaleModifier / 100);
            let maxLogoW = baseLogoW * (scaleModifier / 100);
            maxLogoH = Math.min(maxLogoH, targetH - (padding * 2));
            maxLogoW = Math.min(maxLogoW, targetW - (padding * 2));
            const fitScale = Math.min(maxLogoW / logoImg.width, maxLogoH / logoImg.height);
            const finalW = logoImg.width * fitScale; const finalH = logoImg.height * fitScale;
            let lx, ly;
            switch(position) {
              case 'tr': lx = targetW - finalW - padding; ly = padding; break;
              case 'bl': lx = padding; ly = targetH - finalH - padding; break;
              case 'br': lx = targetW - finalW - padding; ly = targetH - finalH - padding; break;
              case 'tl': default: lx = padding; ly = padding; break;
            }
            ctx.drawImage(logoImg, lx, ly, finalW, finalH);
          } catch(e) { console.error("Logo drawing error", e); }
        }
        resolve(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.onerror = () => resolve(null);
  });
};

const CompactSingleUploader = ({ label, image, onUpload, onDelete, icon: Icon = PlusSquare, height = "h-12" }) => {
    const fileInputRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);
    return (
      <div className="flex flex-col gap-1 w-full text-left">
        {label && <div className="flex justify-between items-center px-1"><span className="text-[9px] text-slate-400 font-normal uppercase tracking-widest flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" /> <span>{label}</span></span></div>}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) {
              setIsDragging(false);
            }
          }}
          onDrop={async (e) => {
            e.preventDefault();
            setIsDragging(false);
            const f = e.dataTransfer.files?.[0];
            if(f && f.type.startsWith('image/')) {
               const meta = await processImageMetadata(f);
               if(meta) onUpload(meta.src);
            }
          }}
          className={`relative group ${height} w-full rounded border border-dashed transition-all flex items-center justify-center overflow-hidden ${isDragging ? 'bg-[#3264ff]/20 border-[#3264ff]' : 'bg-black/40 border-[#2d2f36]'} hover:border-[#3264ff]/50 cursor-pointer ${image ? 'border-solid' : ''}`}
        >
          {image ? (
            <>
              <img src={image} alt="upload" className="w-full h-full object-contain p-1" />
              <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all"><button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-red-400 p-2 hover:scale-110 transition-transform"><Trash2 className="w-4 h-4" /></button></div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-1 opacity-20 text-slate-400 text-center">
              <UploadCloud className="w-4 h-4" />
              <span className="text-[7px] font-normal uppercase tracking-widest">UPLOAD</span>
            </div>
          )}
          <input type="file" ref={fileInputRef} onChange={async (e) => { const file = e.target.files?.[0]; if (file) { const m = await processImageMetadata(file); if(m) onUpload(m.src); } }} accept="image/*" className="hidden" />
        </div>
      </div>
    );
};

function App() {
  const [sourceBanners, setSourceBanners] = useState([]);
  const [masterBannerId, setMasterBannerId] = useState(null);
  const [styleReference, setStyleReference] = useState(null);
  const [textureAssets, setTextureAssets] = useState([]);
  const [userApiKey, setUserApiKey] = useState('');

  const [globalOriginalText, setGlobalOriginalText] = useState('');
  const [globalLogoToErase, setGlobalLogoToErase] = useState(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [sheetUrl, setSheetUrl] = useState('');
  const [isFetchingSheet, setIsFetchingSheet] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);

  const [isDraggingBoard, setIsDraggingBoard] = useState(false);
  const [isDraggingTexture, setIsDraggingTexture] = useState(false);
  const [isDraggingCsv, setIsDraggingCsv] = useState(false);

  const [loadRange, setLoadRange] = useState({ start: 1, end: 100 });

  const [languages, setLanguages] = useState([
    { id: 'lang-default', suffix: '', main_title: '', subtitle: '', sub_sub_text: '', button_text: '', filename_suffix: '', logo: null, position: 'tl', scale: 100, extra_instructions: '', master_style_image: null }
  ]);

  const [results, setResults] = useState({});
  const boardInputRef = useRef(null);

  useEffect(() => {
    const preventDefault = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);
    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, []);

  const updateLangField = (id, field, val) => {
    setLanguages(prev => prev.map(l => l.id === id ? { ...l, [field]: val } : l));
  };

  const addLanguage = () => {
    const newId = `lang-${Date.now()}`;
    setLanguages(prev => [...prev, { id: newId, suffix: '', main_title: '', subtitle: '', sub_sub_text: '', button_text: '', filename_suffix: '', logo: null, position: 'tl', scale: 100, extra_instructions: '', master_style_image: null }]);
  };

  const removeLanguage = (id) => {
    if (languages.length > 1) setLanguages(prev => prev.filter(l => l.id !== id));
  };

  const handleSourceBannersUpload = async (files) => {
    const validFiles = files.filter(f => f.type.startsWith('image/'));
    const metas = await Promise.all(validFiles.map(f => processImageMetadata(f)));

    setSourceBanners(prev => {
        const newBanners = [...prev, ...metas];
        if (!masterBannerId && newBanners.length > 0) {
            const master = newBanners.find(m => m.w === 1024 && m.h === 1024) || [...newBanners].sort((a,b) => (b.w*b.h) - (a.w*a.h))[0];
            setMasterBannerId(master.id);
            if (!styleReference) setStyleReference(master.src);
        }
        return newBanners;
    });
  };

  const parseCsvText = async (text) => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length <= 1) return;

    const allDataLines = lines.slice(1);
    const startIndex = Math.max(0, loadRange.start - 1);
    const endIndex = Math.min(allDataLines.length, loadRange.end);
    const targetLines = allDataLines.slice(startIndex, endIndex);

    const newLangs = await Promise.all(targetLines.map(async (line, idx) => {
      const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
      const c = parts.map(p => p.replace(/^"|"$/g, '').trim());

      const suffix = c[0] || '';
      const original_text = c[1] || '';
      const title = c[2] || '';
      const subtitle = c[3] || '';
      const sub_sub_text = c[4] || '';
      const btn_text = c[5] || '';
      const file_suffix = c[6] || '';
      const logo_url = c[7] || '';
      const extra = c[8] || '';

      const logo_base64 = (logo_url && logo_url.startsWith('http') && !logo_url.includes('...')) ? await urlToBase64(logo_url) : null;

      return {
        id: `lang-${suffix || Date.now() + idx}`,
        suffix: suffix,
        original_text: original_text,
        main_title: title,
        subtitle: subtitle,
        sub_sub_text: sub_sub_text,
        button_text: btn_text,
        filename_suffix: file_suffix,
        logo: logo_base64 || languages[0]?.logo || null,
        position: 'tl',
        scale: 100,
        extra_instructions: extra,
        master_style_image: languages[0]?.master_style_image || null
      };
    }));

    if (newLangs.length > 0) {
        setLanguages(newLangs);
        const firstOriginalText = newLangs.find(l => l.original_text)?.original_text;
        if (firstOriginalText) {
            setGlobalOriginalText(firstOriginalText);
        }
        setLastSyncTime(new Date().toLocaleTimeString());
    }
  };

  const handleSheetFetch = async () => {
    if (!sheetUrl.trim()) return;
    setIsFetchingSheet(true);
    setError(null);
    try {
      let fetchUrl = sheetUrl.trim();
      if (fetchUrl.includes('docs.google.com/spreadsheets')) {
        const matches = fetchUrl.match(/\/d\/(.+?)\//);
        if (matches && matches[1]) {
          const sheetId = matches[1];
          let gid = fetchUrl.match(/gid=(\d+)/)?.[1] || '0';
          fetchUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
        }
      }
      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error("시트 연결 실패. 권한을 확인하세요.");
      const text = await response.text();
      await parseCsvText(text);
    } catch (e) { setError(e.message); } finally { setIsFetchingSheet(false); }
  };

  const callGeminiAPI = async (prompt, images) => {
    const activeKey = userApiKey.trim() || apiKeyDefault;
    if (!activeKey) throw new Error("API Key가 필요합니다.");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent?key=${activeKey}`;
    const parts = [{ text: prompt }];
    images.filter(img => img).forEach(img => parts.push({ inlineData: { mimeType: "image/jpeg", data: stripBase64Params(img) } }));

    const payload = { contents: [{ parts }], generationConfig: { responseModalities: ["IMAGE"] } };

    const retryDelays = [2000, 4000, 8000, 15000];

    for (let i = 0; i <= retryDelays.length; i++) {
        try {
            const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (resp.ok) {
                const data = await resp.json();
                const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
                if (part) return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;

                const finishReason = data.candidates?.[0]?.finishReason;
                if (finishReason === 'SAFETY') {
                    throw new Error("안전 필터(Safety)에 의해 이미지가 차단되었습니다.");
                }
                throw new Error(`이미지 데이터가 반환되지 않았습니다 (사유: ${finishReason || 'Unknown'})`);
            } else {
                const err = await resp.json();
                const errMsg = err.error?.message || "";

                const isRetryable = resp.status === 429 || resp.status >= 500 || errMsg.includes('MALFORMED_FUNCTION_CALL');

                if (isRetryable && i < retryDelays.length) {
                    console.warn(`[API 에러 복구 중] ${resp.status} - ${errMsg}. ${retryDelays[i]}ms 대기 후 재요청합니다...`);
                    await new Promise(r => setTimeout(r, retryDelays[i]));
                    continue;
                }
                throw new Error(`API 오류 (${resp.status}): ${errMsg || "알 수 없는 오류"}`);
            }
        } catch (e) {
            if (i === retryDelays.length) throw e;
        }
    }
  };

  const generateSingleResult = async (banner, lang, customPrompt = "") => {
    if (!banner || !lang) return;

    const isMaster = banner.id === masterBannerId;
    const currentStyleRef = isMaster ? styleReference : (lang.master_style_image || styleReference);
    const hasStyleRef = !!currentStyleRef;

    setResults(prev => ({
        ...prev,
        [banner.id]: {
            ...(prev[banner.id] || {}),
            [lang.id]: { url: null, rawUrl: null, loading: true, error: null }
        }
    }));

    try {
        const promptImages = [banner.src];
        let imgIdx = 1;
        let refInputsStr = `- Image 1 (REF_1): Original Banner (Layout Guide)\n`;

        let styleRefStr = "";
        if (hasStyleRef) {
            promptImages.push(currentStyleRef);
            imgIdx++;
            refInputsStr += `- Image ${imgIdx} (REF_2): Style Reference / Typography Master\n`;
            styleRefStr = `Image ${imgIdx} (REF_2)`;
        }

        let eraseLogoStr = "";
        if (globalLogoToErase) {
            promptImages.push(globalLogoToErase);
            imgIdx++;
            refInputsStr += `- Image ${imgIdx} (REF_ERASE): TARGET LOGO/GRAPHIC TO ERASE\n`;
            eraseLogoStr = `Image ${imgIdx} (REF_ERASE)`;
        }

        promptImages.push(...textureAssets);

        // master_guidelines.md 템플릿 로드 후 변수 치환
        const guidelinesTemplate = await loadGuidelines();

        const eraseLogoLine = globalLogoToErase
          ? `3. SPECIFIC GRAPHIC TO ERASE: You MUST find the exact graphic/logo shown in ${eraseLogoStr} within Image 1 and perfectly erase it!`
          : '';

        const styleRule = hasStyleRef
          ? (isMaster
              ? `2. VISUAL STYLE = ${styleRefStr}: You MUST strictly apply the high-resolution texture, color grade, and visual mood of ${styleRefStr}.`
              : `2. TYPOGRAPHY & STYLE MASTER = ${styleRefStr}: You MUST strictly copy the EXACT font style, text effects (stroke, glow, drop shadow), and text colors seen in ${styleRefStr} and apply them to the new text. Do not invent new text styles.`)
          : '';

        const extraTextLine = lang.sub_sub_text ? `- Extra text: "${lang.sub_sub_text}"` : '';
        const buttonLine = lang.button_text
          ? `- Button: Draw a button with text "${lang.button_text}" exactly where it was.`
          : `- NO BUTTON: Erase existing buttons completely.`;

        const crucialLine = !isMaster
          ? `CRUCIAL: The structural layout MUST follow Image 1 (REF_1) and the typography style MUST exactly follow ${styleRefStr}.`
          : '';

        const manualReprompt = customPrompt ? `\n[MANUAL RE-PROMPT]: ${customPrompt}` : '';

        const targetTextBlock = globalOriginalText
          ? `[TARGET TEXT TO REPLACE]\n- Original Text in REF_1 to erase: "${globalOriginalText}"\n(CRITICAL INSTRUCTION: Scan REF_1 to find this exact original text. Erase it completely, and put the new translated text in that exact location.)`
          : '';

        const prompt = guidelinesTemplate
          .replace('{{REF_INPUTS}}', refInputsStr)
          .replace('{{ORIGINAL_TEXT}}', globalOriginalText || 'ALL EXISTING TEXT AND LETTERS')
          .replace('{{ERASE_LOGO_LINE}}', eraseLogoLine)
          .replace('{{STYLE_RULE}}', styleRule)
          .replace('{{MAIN_TITLE}}', lang.main_title)
          .replace('{{SUBTITLE}}', lang.subtitle)
          .replace('{{EXTRA_TEXT_LINE}}', extraTextLine)
          .replace('{{BUTTON_LINE}}', buttonLine)
          .replace('{{EXTRA_INSTRUCTIONS}}', lang.extra_instructions || 'Maintain strict design consistency.')
          .replace('{{CRUCIAL_LINE}}', crucialLine)
          .replace('{{MANUAL_REPROMPT}}', manualReprompt)
          .replace('{{TARGET_TEXT_BLOCK}}', targetTextBlock);

        const rawUrl = await callGeminiAPI(prompt, promptImages);
        const key = `${banner.w}x${banner.h}`;
        const initScale = FIXED_LOGO_SCALES[key] || 100;
        const finalUrl = await finalizeBannerPixel(rawUrl, banner.w, banner.h, lang.logo, initScale, lang.position);

        setResults(prev => ({
            ...prev,
            [banner.id]: {
                ...prev[banner.id],
                [lang.id]: { url: finalUrl, rawUrl: rawUrl, scale: initScale, prompt: customPrompt, loading: false }
            }
        }));

        if (isMaster && rawUrl) {
            setLanguages(prev => prev.map(l => l.id === lang.id ? { ...l, master_style_image: rawUrl } : l));
        }

    } catch (e) {
        console.error(`[${lang.id}] 렌더링 실패 상세 에러:`, e);
        setResults(prev => ({
            ...prev,
            [banner.id]: {
                ...prev[banner.id],
                [lang.id]: { error: e.message, loading: false }
            }
        }));
    }
  };

  const runInBatches = async (tasks, batchSize = 3) => {
    for (let i = 0; i < tasks.length; i += batchSize) {
        const chunk = tasks.slice(i, i + batchSize);
        await Promise.all(chunk.map(async (task, idx) => {
            if (idx > 0) {
                await new Promise(r => setTimeout(r, idx * 2500));
            }
            return task();
        }));
        if (i + batchSize < tasks.length) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }
  };

  const generateMastersOnly = async () => {
    if (!masterBannerId) return setError("마스터 레이아웃으로 지정된 배너가 없습니다.");
    const masterBanner = sourceBanners.find(b => b.id === masterBannerId);
    if (!masterBanner) return;

    setIsGenerating(true);
    const tasks = [];
    for (const lang of languages) {
        if (!lang.main_title && !lang.subtitle) continue;
        tasks.push(() => generateSingleResult(masterBanner, lang));
    }
    await runInBatches(tasks, 3);
    setIsGenerating(false);
  };

  const generateRestAll = async () => {
    if (sourceBanners.length <= 1) return alert("마스터 외에 생성할 다른 규격의 배너가 없습니다.");
    setIsGenerating(true);
    const tasks = [];
    for (const banner of sourceBanners) {
        if (banner.id === masterBannerId) continue;
        for (const lang of languages) {
            if (!lang.main_title && !lang.subtitle) continue;
            tasks.push(() => generateSingleResult(banner, lang));
        }
    }
    await runInBatches(tasks, 3);
    setIsGenerating(false);
  };

  const handleCountryBatch = async (lang) => {
    if (sourceBanners.length === 0) return;
    setIsGenerating(true);
    const tasks = [];
    for (const banner of sourceBanners) {
        tasks.push(() => generateSingleResult(banner, lang));
    }
    await runInBatches(tasks, 3);
    setIsGenerating(false);
  };

  const updateLogoResult = async (bannerId, langId, newScale) => {
    const banner = sourceBanners.find(b => b.id === bannerId);
    const lang = languages.find(l => l.id === langId);
    const res = results[bannerId]?.[langId];
    if (banner && lang && res?.rawUrl) {
        const updatedUrl = await finalizeBannerPixel(res.rawUrl, banner.w, banner.h, lang.logo, newScale, lang.position);
        setResults(prev => ({ ...prev, [bannerId]: { ...prev[bannerId], [langId]: { ...res, url: updatedUrl, scale: newScale } } }));
    }
  };

  const getOutputFileName = (banner, lang) => {
    const sizePart = `${banner.w}x${banner.h}`;
    let suffixPart = lang.filename_suffix || "";
    if (suffixPart && !suffixPart.startsWith('_')) {
        suffixPart = `_${suffixPart}`;
    }
    return `${sizePart}${suffixPart}.jpg`;
  };

  const handleExportZip = async () => {
    if (!window.JSZip) {
      const s = document.createElement('script'); s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      document.head.appendChild(s); await new Promise(r => s.onload = r);
    }
    const zip = new window.JSZip();
    let fileCount = 0;
    sourceBanners.forEach(b => {
      languages.forEach(l => {
        const res = results[b.id]?.[l.id];
        if (res?.url) {
          zip.folder(l.suffix || 'unnamed').file(getOutputFileName(b, l), res.url.split('base64,')[1], { base64: true });
          fileCount++;
        }
      });
    });
    if (fileCount === 0) return alert("저장할 파일이 없습니다.");
    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement('a'); link.href = URL.createObjectURL(content); link.download = `translated_pack_${Date.now()}.zip`; link.click();
  };

  const inputBaseClass = "w-full bg-black border border-white/10 px-2.5 py-2 text-[11px] rounded outline-none focus:border-[#3264ff] transition-all text-slate-300 font-normal";

  const sortedSourceBanners = [...sourceBanners].sort((a, b) => {
    if (a.id === masterBannerId) return -1;
    if (b.id === masterBannerId) return 1;
    return 0;
  });

  return (
    <div className="min-h-screen bg-[#0d0e12] text-[#e1e3e8] font-sans flex flex-col overflow-hidden text-left">
      <header className="h-16 border-b border-white/5 flex items-center justify-between px-8 bg-black shrink-0 z-50">
        <div className="flex items-center gap-3">
          <Globe className="w-6 h-6 text-[#3264ff]" />
          <h1 className="text-xl font-black italic tracking-tighter text-white uppercase">BATCH TRANSLATOR</h1>
        </div>
        <div className="flex items-center gap-3">
            <button onClick={() => window.location.reload()} className="px-4 py-2 bg-red-950/20 text-red-500 border border-red-950/50 text-[10px] font-black rounded-sm hover:bg-red-950/40 uppercase">
              <span>RESET</span>
            </button>
            <button onClick={handleExportZip} className="px-6 py-2 bg-[#107c41] text-white text-[10px] font-black rounded-sm flex items-center gap-2 hover:brightness-110 shadow-lg shadow-[#107c41]/20 uppercase transition-all">
              <Archive className="w-4 h-4"/> <span>EXPORT (.ZIP)</span>
            </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* SIDEBAR */}
        <aside className="w-[320px] border-r border-white/5 bg-[#090a0d] p-5 overflow-y-auto custom-scrollbar flex flex-col gap-5 shrink-0 z-30">
            <div className="space-y-2">
                <label className="text-[10px] font-black text-[#3264ff] uppercase tracking-widest flex items-center gap-2">
                  <KeyRound className="w-4 h-4" /> <span>CONFIG</span>
                </label>
                <input type="password" value={userApiKey} onChange={e => setUserApiKey(e.target.value)} placeholder="API KEY" className="w-full bg-[#111217] border border-[#2d2f36] px-4 py-2.5 text-xs rounded-sm focus:border-[#3264ff] outline-none text-slate-300" />
            </div>

            <div className="space-y-4 pt-4 border-t border-white/5">
                <CompactSingleUploader label="2. STYLE REF (HQ)" image={styleReference} onUpload={setStyleReference} onDelete={() => setStyleReference(null)} icon={Scan} height="h-20" />
                <div className="flex flex-col gap-1 w-full text-left mt-2">
                    <div className="flex justify-between items-center px-1">
                      <span className="text-[9px] font-black text-[#8a8d97] uppercase tracking-widest flex items-center gap-2"><Layers className="w-3.5 h-3.5" /> <span>3. 질감 (ASSET)</span></span>
                    </div>
                    <div
                        onDragOver={(e) => { e.preventDefault(); setIsDraggingTexture(true); }}
                        onDragLeave={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget)) setIsDraggingTexture(false);
                        }}
                        onDrop={async (e) => {
                            e.preventDefault();
                            setIsDraggingTexture(false);
                            const fs = Array.from(e.dataTransfer.files);
                            for(let f of fs) {
                                if(f.type.startsWith('image/')) {
                                    const m = await processImageMetadata(f);
                                    if(m) setTextureAssets(p => [...p, m.src]);
                                }
                            }
                        }}
                        className={`grid grid-cols-3 gap-1.5 p-1.5 rounded border border-dashed transition-all ${isDraggingTexture ? 'border-[#3264ff] bg-[#3264ff]/10' : 'border-[#2d2f36] bg-[#0d0e12]'}`}
                    >
                        {textureAssets.map((img, idx) => (
                            <div key={idx} className="relative group aspect-square rounded-sm overflow-hidden bg-[#15171c] shadow-lg">
                              <img src={img} alt="t" className="w-full h-full object-cover" />
                              <button onClick={() => setTextureAssets(prev => prev.filter((_, i) => i !== idx))} className="absolute inset-0 bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="w-3 h-3 text-red-400"/></button>
                            </div>
                        ))}
                        <div onClick={() => { const i = document.createElement('input'); i.type='file'; i.multiple=true; i.accept='image/*'; i.onchange=async(e)=> { const fs = Array.from(e.target.files); for(let f of fs) { const m = await processImageMetadata(f); if(m) setTextureAssets(p => [...p, m.src]); } }; i.click(); }} className="aspect-square border border-dashed border-[#2d2f36] flex flex-col items-center justify-center cursor-pointer rounded-sm hover:bg-white/5 text-slate-700">
                          <Plus className="w-4 h-4"/><span className="text-[7px] font-black uppercase tracking-tighter mt-0.5">Add</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-white/5">
                <div className="space-y-3 bg-[#107c41]/5 p-3 rounded-sm border border-[#107c41]/10">
                    <label className="text-[10px] font-black text-[#107c41] uppercase tracking-widest flex items-center gap-2"><LinkIcon className="w-4 h-4" /> <span>BATCH SETTINGS</span></label>
                    <div className="space-y-1.5">
                        <span className="text-[8px] font-black text-[#107c41] uppercase tracking-tighter flex items-center gap-1"><Hash className="w-3 h-3" /> <span>불러올 행 범위 (Start - End)</span></span>
                        <div className="flex items-center gap-2">
                            <input type="number" min="1" value={loadRange.start} onChange={e => setLoadRange(p => ({...p, start: parseInt(e.target.value) || 1}))} className="w-full bg-black border border-white/10 px-2 py-1.5 text-[10px] rounded outline-none text-center text-slate-300" />
                            <span className="text-slate-700">-</span>
                            <input type="number" min="1" value={loadRange.end} onChange={e => setLoadRange(p => ({...p, end: parseInt(e.target.value) || 100}))} className="w-full bg-black border border-white/10 px-2 py-1.5 text-[10px] rounded outline-none text-center text-slate-300" />
                        </div>
                    </div>
                    <div className="flex gap-1">
                        <div className="relative flex-1">
                             <input type="text" value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} placeholder="Google Sheet URL..." className="w-full bg-[#111217] border border-[#2d2f36] px-3 py-2 text-[10px] rounded-sm focus:border-[#107c41] outline-none pr-8 transition-all text-slate-300" />
                             {sheetUrl && <button onClick={() => {setSheetUrl(''); setLastSyncTime(null);}} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-red-400"><X className="w-3 h-3"/></button>}
                        </div>
                        <button onClick={handleSheetFetch} disabled={isFetchingSheet || !sheetUrl.trim()} className="bg-[#107c41] text-white px-3 py-2 rounded-sm hover:brightness-110 transition-all">
                          {isFetchingSheet ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        </button>
                    </div>
                    {lastSyncTime && <p className="text-[7px] text-[#107c41] font-black uppercase tracking-widest px-1 animate-fade-in">● SYNCED: {lastSyncTime}</p>}
                </div>
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><FileSpreadsheet className="w-4 h-4" /> <span>BULK CSV UPLOAD</span></label>
                    <div
                      onDragOver={(e) => { e.preventDefault(); setIsDraggingCsv(true); }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget)) setIsDraggingCsv(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDraggingCsv(false);
                        const file = e.dataTransfer.files[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload=(ev)=>parseCsvText(ev.target.result);
                          reader.readAsText(file);
                        }
                      }}
                      onClick={() => { const i = document.createElement('input'); i.type='file'; i.accept='.csv'; i.onchange=(e)=>{ const f = e.target.files[0]; if(f) { const r = new FileReader(); r.onload=(ev)=>parseCsvText(ev.target.result); r.readAsText(f); } }; i.click(); }}
                      className={`flex flex-col items-center justify-center gap-2 py-3 border border-dashed rounded cursor-pointer transition-all ${isDraggingCsv ? 'border-[#3264ff] bg-[#3264ff]/10' : 'border-[#2d2f36] bg-[#0d0e12] hover:bg-white/5'}`}
                    >
                        <UploadCloud className={`w-4 h-4 ${isDraggingCsv ? 'text-[#3264ff]' : 'text-slate-700'}`} />
                        <span className={`text-[8px] font-black uppercase tracking-widest ${isDraggingCsv ? 'text-[#3264ff]' : 'text-slate-500'}`}>Drop CSV File</span>
                    </div>
                </div>
                {error && <div className="p-2 bg-red-950/30 border border-red-500/50 text-red-400 text-[10px] rounded animate-pulse">{error}</div>}

                {/* 분리된 2-STEP 생성 버튼 영역 */}
                <div className="pt-2 space-y-2">
                    <button onClick={generateMastersOnly} disabled={isGenerating || !masterBannerId} className="w-full py-3.5 bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/30 font-black text-xs rounded-md hover:bg-[#f59e0b] hover:text-white disabled:opacity-20 flex items-center justify-center gap-2 transition-all uppercase active:scale-95">
                        {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />} <span>STEP 1: 언어별 마스터 생성</span>
                    </button>
                    <button onClick={generateRestAll} disabled={isGenerating || sourceBanners.length <= 1} className="w-full py-3.5 bg-[#3264ff] text-white font-black text-xs rounded-md hover:brightness-110 disabled:opacity-20 flex items-center justify-center gap-2 transition-all uppercase active:scale-95 shadow-lg shadow-[#3264ff]/20">
                        {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} <span>STEP 2: 전 규격 일괄 생성</span>
                    </button>
                </div>
            </div>
        </aside>

        {/* WORKBOARD */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#0d0e12]">
            <div className="flex-1 overflow-auto custom-scrollbar">
                <table className="border-collapse table-fixed min-w-full">
                    <thead className="sticky top-0 z-40">
                        <tr className="bg-[#090a0d] border-b border-white/10 shadow-2xl">
                            {/* 소스 배너 헤더 */}
                            <th className="w-[320px] p-4 text-left align-top sticky left-0 z-50 bg-[#0a0d14] border-r-2 border-[#3264ff]/40 shadow-[15px_0_30px_rgba(0,0,0,0.8)]">
                                <div className="flex flex-col gap-3">
                                    <h2 className="text-[10px] font-black text-[#3264ff] uppercase tracking-[0.3em]">1. SOURCE BANNERS</h2>
                                    <div
                                        onClick={() => boardInputRef.current?.click()}
                                        onDragOver={(e) => { e.preventDefault(); setIsDraggingBoard(true); }}
                                        onDragLeave={(e) => {
                                          if (!e.currentTarget.contains(e.relatedTarget)) setIsDraggingBoard(false);
                                        }}
                                        onDrop={async (e) => {
                                            e.preventDefault(); setIsDraggingBoard(false);
                                            await handleSourceBannersUpload(Array.from(e.dataTransfer.files));
                                        }}
                                        className={`group h-24 border-2 border-dashed rounded flex flex-col items-center justify-center gap-2 transition-all cursor-pointer ${isDraggingBoard ? 'border-[#3264ff] bg-[#3264ff]/10' : 'border-[#2d2f36] bg-black/20 hover:border-[#3264ff]/50'}`}
                                    >
                                        <UploadCloud className={`w-5 h-5 transition-colors ${isDraggingBoard ? 'text-[#3264ff]' : 'text-slate-700'}`} />
                                        <p className={`text-[8px] font-black text-center ${isDraggingBoard ? 'text-[#3264ff]' : 'text-slate-500'} uppercase`}>DRAG & DROP</p>
                                        <input type="file" ref={boardInputRef} onChange={async e => { await handleSourceBannersUpload(Array.from(e.target.files)); }} multiple accept="image/*" className="hidden" />
                                    </div>
                                    <div className="bg-[#3264ff]/10 border border-[#3264ff]/20 rounded-sm p-2 animate-fade-in">
                                        <p className="text-[9px] text-[#3264ff] font-black uppercase leading-tight">업로드하는 원본 배너가 새로운 언어 배너 생성 시 구도와 레이아웃의 기준이 됩니다.</p>
                                    </div>
                                    <div className="flex items-center justify-between text-slate-600 font-bold text-[8px] uppercase px-1">
                                      <span>Items: {sourceBanners.length}</span>
                                      <button onClick={() => {setSourceBanners([]); setMasterBannerId(null);}} className="hover:text-red-400">Clear</button>
                                    </div>

                                    {/* 공통 원문 텍스트 입력칸 */}
                                    <div className="mt-2 pt-3 border-t border-white/5">
                                        <label className="text-[10px] font-black text-orange-400 uppercase tracking-widest flex items-center gap-2 mb-2">
                                            <Type className="w-4 h-4" /> <span>지울 원문 텍스트 (공통)</span>
                                        </label>
                                        <textarea
                                            rows="2"
                                            value={globalOriginalText}
                                            onChange={e => setGlobalOriginalText(e.target.value)}
                                            placeholder="예: 메이드 카페에서 일하게 된 모험가, ..."
                                            className="w-full bg-black border border-white/10 px-2.5 py-2 text-[11px] rounded outline-none focus:border-orange-500 transition-all text-orange-200 font-normal resize-none"
                                        />
                                        <p className="text-[7px] text-slate-500 mt-1.5 leading-tight">입력한 텍스트를 모든 배너에서 찾아 완벽히 지웁니다.</p>
                                    </div>

                                    {/* 공통 지울 그래픽 업로드칸 */}
                                    <div className="mt-3 pt-3 border-t border-white/5">
                                        <label className="text-[10px] font-black text-rose-400 uppercase tracking-widest flex items-center gap-2 mb-2">
                                            <Scan className="w-4 h-4" /> <span>지울 특정 그래픽/로고</span>
                                        </label>
                                        <CompactSingleUploader
                                            label=""
                                            image={globalLogoToErase}
                                            onUpload={setGlobalLogoToErase}
                                            onDelete={() => setGlobalLogoToErase(null)}
                                            icon={ImagePlus}
                                            height="h-20"
                                        />
                                        <p className="text-[7px] text-slate-500 mt-1.5 leading-tight">텍스트로 지워지지 않는 단풍잎, 뱃지 등 특정 그래픽 요소의 이미지를 캡처해 올리면 AI가 추적하여 완벽히 지웁니다.</p>
                                    </div>
                                </div>
                            </th>
                            {languages.map((lang) => (
                                <th key={lang.id} className="w-[320px] max-w-[600px] p-4 text-left align-top border-r border-white/5 relative">
                                    <div className="relative bg-[#111217] border border-[#2d2f36] rounded p-4 flex flex-col gap-2.5 shadow-2xl group/card animate-fade-in h-full">
                                        <div className="absolute -top-2 -right-2 opacity-0 group-hover/card:opacity-100 transition-opacity z-10 text-right">
                                          {languages.length > 1 && <button onClick={() => removeLanguage(lang.id)} className="w-6 h-6 bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform"><X className="w-3 h-3"/></button>}
                                        </div>

                                        {/* 언어별 수동 마스터 업로드 */}
                                        <div className="mb-0.5">
                                            <CompactSingleUploader
                                                label="👑 마스터 수동 업로드 (Drag & Drop)"
                                                image={lang.master_style_image}
                                                onUpload={(img) => updateLangField(lang.id, 'master_style_image', img)}
                                                onDelete={() => updateLangField(lang.id, 'master_style_image', null)}
                                                icon={Crown}
                                                height="h-14"
                                            />
                                        </div>

                                        <input type="text" value={lang.main_title} onChange={e => updateLangField(lang.id, 'main_title', e.target.value)} placeholder="타이틀 텍스트" className={inputBaseClass} />
                                        <input type="text" value={lang.subtitle} onChange={e => updateLangField(lang.id, 'subtitle', e.target.value)} placeholder="서브타이틀 텍스트" className={inputBaseClass} />
                                        <input type="text" value={lang.sub_sub_text} onChange={e => updateLangField(lang.id, 'sub_sub_text', e.target.value)} placeholder="추가 서브 문구" className={inputBaseClass} />
                                        <input type="text" value={lang.button_text} onChange={e => updateLangField(lang.id, 'button_text', e.target.value)} placeholder="버튼 텍스트" className={inputBaseClass} />

                                        <div className="h-px bg-white/5 my-1" />

                                        <input type="text" value={lang.suffix} onChange={e => updateLangField(lang.id, 'suffix', e.target.value)} placeholder="다운로드 폴더명(예:en)" className={inputBaseClass} />
                                        <input type="text" value={lang.filename_suffix} onChange={e => updateLangField(lang.id, 'filename_suffix', e.target.value)} placeholder="파일명 추가문구(예:_en)" className={inputBaseClass} />

                                        <div className="h-px bg-white/5 my-1" />

                                        <textarea rows="2" value={lang.extra_instructions} onChange={e => updateLangField(lang.id, 'extra_instructions', e.target.value)} placeholder="추가 지시사항" className={`${inputBaseClass} resize-none leading-relaxed text-[9px]`} />

                                        <div className="grid grid-cols-2 gap-2 mt-0.5">
                                             <CompactSingleUploader label="" image={lang.logo} onUpload={(img) => updateLangField(lang.id, 'logo', img)} onDelete={() => updateLangField(lang.id, 'logo', null)} height="h-12" icon={LayoutTemplate} />
                                             <div className="flex flex-col gap-1">
                                                <div className="grid grid-cols-4 gap-0.5">
                                                  {['tl','tr','bl','br'].map(p => (
                                                    <button key={p} onClick={() => updateLangField(lang.id, 'position', p)} className={`py-1 text-[7px] font-black border rounded-sm transition-all ${lang.position === p ? 'bg-[#3264ff] border-[#3264ff] text-white' : 'bg-black/40 border-white/5 text-slate-600'} text-center`}>
                                                      <span>{p.toUpperCase()}</span>
                                                    </button>
                                                  ))}
                                                </div>
                                                <div className="flex items-center gap-1.5 w-full mt-1">
                                                  <input type="range" min="20" max="250" value={lang.scale} onChange={e => updateLangField(lang.id, 'scale', Number(e.target.value))} className="w-full" />
                                                </div>
                                             </div>
                                        </div>
                                    </div>
                                    <div className="absolute right-0 top-1/2 -translate-y-1/2 h-px bg-white/5 w-full -z-10" />
                                </th>
                            ))}
                            <th className="w-16 h-full relative group cursor-pointer text-center" onClick={addLanguage}>
                                <div className="absolute inset-y-0 left-0 w-px bg-white/5 group-hover:bg-[#3264ff]/50 transition-colors" />
                                <div className="h-full flex items-center justify-center text-center">
                                    <div className="w-9 h-9 bg-[#3264ff] text-white rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform opacity-80 group-hover:opacity-100">
                                      <Plus className="w-5 h-5" />
                                    </div>
                                </div>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {sortedSourceBanners.map((banner, bIdx) => {
                            const isMaster = banner.id === masterBannerId;
                            return (
                            <tr key={banner.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors group/row">
                                <td className={`p-4 align-top sticky left-0 z-30 ${isMaster ? 'bg-[#121c36] border-r-2 border-[#3264ff]/60' : 'bg-[#0a0d14] border-r-2 border-[#3264ff]/40 group-hover/row:bg-[#111622]'} shadow-[15px_0_30px_rgba(0,0,0,0.8)] transition-colors`}>
                                    {isMaster && <div className="absolute top-0 left-0 w-1 h-full bg-[#3264ff]" />}
                                    <div className="space-y-3 text-left">
                                        <div className="flex items-center gap-2.5">
                                          <span className="w-6 h-6 flex items-center justify-center bg-[#1a1c23] rounded-full text-[9px] font-black text-slate-500 text-center">{bIdx + 1}</span>
                                          <span className="text-[11px] font-black text-white italic uppercase tracking-tighter">{banner.w}x{banner.h}</span>
                                          {isMaster && <span className="bg-[#f59e0b] text-white text-[8px] px-1.5 py-0.5 rounded-sm inline-flex items-center gap-1 font-black uppercase shadow-lg shadow-[#f59e0b]/20"><Crown className="w-3 h-3"/> Master</span>}
                                        </div>
                                        <div className={`relative w-full rounded border overflow-hidden transition-all flex flex-col items-center justify-center ${isMaster ? 'border-[#f59e0b]/50 bg-black' : 'bg-black/40 border-white/5 shadow-inner group-hover/row:border-[#3264ff]/30'}`}>
                                            <img src={banner.src} className="max-w-full h-auto object-contain block transition-all" alt="s" />
                                        </div>
                                        <div className="flex items-center justify-between px-1 w-full">
                                            <div className="text-[8px] font-bold text-slate-500 uppercase truncate text-left flex-1">{banner.name}</div>
                                            {!isMaster && <button onClick={() => {setMasterBannerId(banner.id); setStyleReference(banner.src);}} className="text-[8px] font-bold text-slate-500 hover:text-[#3264ff] transition-colors">마스터 지정</button>}
                                        </div>
                                    </div>
                                </td>
                                {languages.map(lang => {
                                    const res = results?.[banner.id]?.[lang.id];
                                    return (
                                        <td key={lang.id} className="p-4 align-top border-r border-white/5 max-w-[600px]">
                                            <div className={`relative bg-[#090a0d] rounded border border-white/5 shadow-inner transition-all flex flex-col gap-2 ${res?.url || res?.loading ? 'p-2 shadow-2xl' : 'p-3 min-h-[160px] bg-black/20'} ${isMaster ? 'ring-1 ring-[#f59e0b]/20' : ''}`}>

                                                <div className="flex items-center justify-between px-1 mb-1">
                                                    <div className="flex items-center gap-3 flex-1">
                                                        <span className="text-[7px] font-black text-slate-600 uppercase tracking-widest shrink-0">
                                                          <span>로고 사이즈</span>
                                                        </span>

                                                        {res?.url && (
                                                            <div className="flex items-center gap-2 w-[30%] ml-2">
                                                                <input type="range" min="10" max="250" value={res.scale || 100} onChange={e => updateLogoResult(banner.id, lang.id, Number(e.target.value))} className="w-full" />
                                                                <span className="text-[7px] font-black text-[#3264ff] shrink-0">{res.scale || 100}%</span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="flex gap-1.5 text-right shrink-0">
                                                        <button onClick={() => generateSingleResult(banner, lang, res?.prompt)} className="p-1 bg-white/5 rounded-sm hover:bg-white/10 text-slate-500 transition-all">
                                                          <RotateCcw className="w-3 h-3"/>
                                                        </button>
                                                        {res?.url && (
                                                          <button onClick={() => {
                                                            const a = document.createElement('a'); a.href = res.url; a.download = getOutputFileName(banner, lang); a.click();
                                                          }} className="p-1 bg-[#3264ff]/10 rounded-sm text-[#3264ff] hover:bg-[#3264ff] hover:text-white transition-all">
                                                            <Download className="w-3 h-3" />
                                                          </button>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="relative flex flex-col gap-3 pb-1 w-full mt-1">
                                                    {res?.url && (
                                                        <div className="relative group/img w-full animate-fade-in flex justify-center bg-black/20 rounded border border-white/5">
                                                            <img src={res.url} className="max-w-full h-auto object-contain block" alt="Output" />
                                                            <button onClick={() => { const a = document.createElement('a'); a.href = res.url; a.download = getOutputFileName(banner, lang); a.click(); }} className="absolute top-2 right-2 p-1.5 bg-black/60 text-white rounded hover:bg-[#3264ff] opacity-0 group-hover/img:opacity-100 transition-all">
                                                                <Download className="w-3 h-3" />
                                                            </button>
                                                        </div>
                                                    )}

                                                    {res?.loading && (
                                                      <div className="flex flex-col items-center justify-center w-full min-h-[160px] gap-2 animate-pulse text-center bg-white/[0.02] rounded border border-dashed border-white/10">
                                                        <Loader2 className="w-5 h-5 text-[#3264ff] animate-spin" />
                                                        <span className="text-[7px] font-black text-[#3264ff] tracking-[0.1em] uppercase">
                                                            RENDERING...
                                                        </span>
                                                      </div>
                                                    )}

                                                    {(!res?.loading && res?.error && !res?.url) && (
                                                      <div className="flex items-center justify-center w-full min-h-[160px]">
                                                        <div className="text-red-500 text-[9px] font-bold text-center px-2 leading-tight bg-red-950/30 p-2 rounded border border-red-500/30">{res.error}</div>
                                                      </div>
                                                    )}

                                                    {(!res?.loading && !res?.url && !res?.error) && (
                                                      <div className="flex items-center justify-center w-full min-h-[160px]">
                                                        <Zap className="w-7 h-7 opacity-5" />
                                                      </div>
                                                    )}
                                                </div>

                                                {res?.url && (
                                                    <div className="mt-1 px-1">
                                                        <div className="flex gap-1.5 items-center bg-black/40 p-1.5 rounded-sm border border-white/5 focus-within:border-[#3264ff]/40 transition-all">
                                                            <MessageSquareText className="w-3.5 h-3.5 text-slate-700 ml-0.5 shrink-0" />
                                                            <input type="text" value={res.prompt || ''} onChange={e => setResults(prev => ({...prev, [banner.id]: {...prev[banner.id], [lang.id]: {...res, prompt: e.target.value}}}))} onKeyDown={e => e.key === 'Enter' && generateSingleResult(banner, lang, res.prompt)} placeholder="Prompt..." className="flex-1 bg-transparent text-[9px] text-slate-300 outline-none" />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                    );
                                })}
                                <td className="bg-white/[0.01]" />
                            </tr>
                            );
                        })}
                    </tbody>
                </table>
                {sourceBanners.length === 0 && (
                  <div className="h-[40vh] flex flex-col items-center justify-center text-slate-800 gap-4 italic font-black uppercase tracking-widest text-center opacity-30">
                    <ImageIcon className="w-14 h-14 mb-2" />
                    <span>Awaiting Source Banners</span>
                  </div>
                )}
            </div>
        </div>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
