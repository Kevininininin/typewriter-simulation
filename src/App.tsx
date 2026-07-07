import {
  ChangeEvent,
  ClipboardEvent,
  CSSProperties,
  FormEvent,
  KeyboardEvent,
  PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

const letterWidthInches = 8.5;
const letterHeightInches = 11;
const paperWidth = 1672;
const paperMargin = paperWidth / letterWidthInches;
const paperPrintableWidth = paperWidth - paperMargin * 2;
const paperHeight = paperWidth * (letterHeightInches / letterWidthInches);
const paperBottom = 2607;
const initialPaperHeight = 430;
const textInsetX = 836 + paperMargin;
const textBaseTop = paperBottom - initialPaperHeight + paperMargin;
const typePointX = 2369;

const FIGMA = {
  frameWidth: 4621,
  frameHeight: 2894,
  carriageRightX: typePointX - textInsetX,
  carriageLeftX: 69,
  maxPaperHeight: paperHeight,
  initialPaperHeight,
  lineHeight: 39,
  typeSize: 33,
  paperBottom,
  paperWidth,
  paperMargin,
  printableWidth: paperPrintableWidth,
  textInsetX,
  textBaseTop,
  cursorX: typePointX,
  cursorY: textBaseTop,
};

const maxAdvance = FIGMA.printableWidth;
const maxFeed = FIGMA.maxPaperHeight - FIGMA.initialPaperHeight;
const paperTopMargin = FIGMA.textBaseTop - (FIGMA.paperBottom - FIGMA.initialPaperHeight);
const pageEndLiftRange = paperTopMargin + FIGMA.lineHeight;
const maxPaperBottomLift = Math.max(60, FIGMA.paperBottom - (FIGMA.cursorY + paperTopMargin));
const defaultZoom = 1.5;
const initialZoom = defaultZoom;
const exportCanvasWidth = 1632;
const exportCanvasHeight = 2112;
const exportCanvasMargin = 192;
const exportPdfWidth = 612;
const exportPdfHeight = 792;
const exportPdfMargin = 72;
const fontSpec = `${FIGMA.typeSize}px "Special Elite", "Courier New", monospace`;
const slugTransitionMs = 90;
const lineAdvances: Record<LineSpacing, number> = {
  0: 24,
  1: FIGMA.lineHeight,
  1.5: FIGMA.lineHeight * 1.5,
  2: FIGMA.lineHeight * 2,
};

const ASSETS = {
  platen: "/assets/platen.png",
  paperPressRoller: "/assets/paper-press-roller.png",
  pointGuideGuard: "/assets/point-guide-guard.png",
  colorRibbonSlugsIdle: "/assets/color-ribbon-slugs-idle.png",
  colorRibbonSlugsActive: "/assets/color-ribbon-slugs-active-hidden-export.png",
  slug: "/assets/slug-center.png",
  typewriterBody: "/assets/typewriter-body.png",
};

const AUDIO = {
  ding: "/assets/audio/Ding.mp3",
  keyPresses: [
    "/assets/audio/key%20press%201.mp3",
    "/assets/audio/key%20press%202.mp3",
    "/assets/audio/key%20press%203.mp3",
    "/assets/audio/key%20press%204.mp3",
    "/assets/audio/key%20press%205.mp3",
    "/assets/audio/key%20press%206.mp3",
  ],
  newLine: "/assets/audio/new%20line.mp3",
};

type Notice = "ready" | "margin" | "page-end";
type LineSpacing = 0 | 1 | 1.5 | 2;
type ExportFormat = "pdf" | "png";
type AuthMode = "sign-in" | "register";
type PendingAuthAction = "new-page" | "export" | null;
type SaveStatus = "idle" | "saving" | "saved" | "error";
type LineBreak = {
  afterLineIndex: number;
  spacing: LineSpacing;
  advance: number;
};
type ViewMode = "editor" | "grid";
type SavedPage = {
  id: string;
  title?: string | null;
  lines: string[];
  lineBreaks: LineBreak[];
  updatedAt?: string;
};
type StoredPageDocument = {
  version: 1;
  lines: string[];
  lineBreaks: LineBreak[];
};
type CarriageDrag = {
  pointerId: number;
  startClientX: number;
  startAdvance: number;
};
type PageDrag = {
  pointerId: number;
  startClientY: number;
  startFeed: number;
};
type SlugConfig = {
  id: number;
  slugWidth: number;
  slugHeight: number;
  angle: number;
};

const slugPivot = {
  x: 2365.5,
  y: 2437,
};

const slugRestOffset = 227;

const slugConfigs: SlugConfig[] = [
  { id: 0, slugWidth: 81, slugHeight: 432, angle: 0 },
  { id: 1, slugWidth: 81, slugHeight: 432, angle: 11.33 },
  { id: 2, slugWidth: 81, slugHeight: 432, angle: 22.05 },
  { id: 3, slugWidth: 81, slugHeight: 432, angle: 36.19 },
  { id: 4, slugWidth: 81, slugHeight: 432, angle: 47.46 },
  { id: 5, slugWidth: 81, slugHeight: 536.78, angle: 55.43 },
  { id: 6, slugWidth: 81, slugHeight: 536.78, angle: 61.93 },
  { id: 7, slugWidth: 81, slugHeight: 432, angle: -11.33 },
  { id: 8, slugWidth: 81, slugHeight: 432, angle: -22.05 },
  { id: 9, slugWidth: 81, slugHeight: 432, angle: -36.19 },
  { id: 10, slugWidth: 81, slugHeight: 432, angle: -47.46 },
  { id: 11, slugWidth: 81, slugHeight: 536.78, angle: -55.43 },
  { id: 12, slugWidth: 81, slugHeight: 536.78, angle: -61.93 },
];

const slugKeyGroups = ["`1qaz", "2wsx", "3edc", "4rfv5tgb", "6yhn", "7ujm", "8ik,", "9ol.", "0p;/", "-[]", "='\\", "nm", "abcdefghijklmnopqrstuvwxyz0123456789"];

function getSlugIdForKey(key: string): number {
  const normalized = key.toLowerCase();
  const groupIndex = slugKeyGroups.findIndex((group) => group.includes(normalized));
  if (groupIndex >= 0) return groupIndex;
  return normalized.charCodeAt(0) % slugConfigs.length;
}

function isPrintableKey(event: KeyboardEvent): boolean {
  return event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
}

function shouldPlayReturnSound(line: string, cursorColumn: number): boolean {
  const traveledText = line.slice(0, cursorColumn);
  return traveledText.length >= 15 && /\S/.test(traveledText);
}

function getLineAdvance(spacing: LineSpacing): number {
  return lineAdvances[spacing];
}

function getLineTops(lineBreaks: LineBreak[], lineCount: number): number[] {
  const tops = [0];

  for (let index = 1; index < lineCount; index += 1) {
    tops[index] = tops[index - 1] + (lineBreaks[index - 1]?.advance ?? getLineAdvance(1));
  }

  return tops;
}

function normalizeLineBreaks(lineBreaks: LineBreak[]): LineBreak[] {
  return lineBreaks.map((lineBreak, index) => ({
    ...lineBreak,
    afterLineIndex: index,
  }));
}

function hasPageContent(lines: string[]): boolean {
  return lines.some((line) => line.trim().length > 0);
}

function createPageId(): string {
  if ("crypto" in window && "randomUUID" in window.crypto) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createStoredPageDocument(lines: string[], lineBreaks: LineBreak[]): StoredPageDocument {
  return {
    version: 1,
    lines: [...lines],
    lineBreaks: normalizeLineBreaks(lineBreaks).map((lineBreak) => ({ ...lineBreak })),
  };
}

function readStoredPageDocument(document: unknown): StoredPageDocument | null {
  if (!document || typeof document !== "object") return null;
  const candidate = document as Partial<StoredPageDocument>;
  if (!Array.isArray(candidate.lines) || !Array.isArray(candidate.lineBreaks)) return null;
  if (!candidate.lines.every((line) => typeof line === "string")) return null;

  return {
    version: 1,
    lines: candidate.lines,
    lineBreaks: normalizeLineBreaks(
      candidate.lineBreaks
        .filter((lineBreak): lineBreak is LineBreak => {
          if (!lineBreak || typeof lineBreak !== "object") return false;
          const value = lineBreak as Partial<LineBreak>;
          return (
            typeof value.afterLineIndex === "number" &&
            typeof value.advance === "number" &&
            (value.spacing === 0 || value.spacing === 1 || value.spacing === 1.5 || value.spacing === 2)
          );
        })
        .map((lineBreak) => ({ ...lineBreak })),
    ),
  };
}

function getInitialViewMode(): ViewMode {
  const storedViewMode = window.localStorage.getItem("typewriter-view-mode");
  return storedViewMode === "grid" ? "grid" : "editor";
}

function getDownloadName(fileName: string, extension: ExportFormat): string {
  const fallbackName = "typewriter-page";
  const baseName = fileName.trim() || fallbackName;
  const withoutKnownExtension = baseName.replace(/\.(pdf|png)$/i, "");
  return `${withoutKnownExtension}.${extension}`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function sanitizePdfText(text: string): string {
  return text
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function createPdfBlob(lines: string[], lineBreaks: LineBreak[]): Blob {
  const lineTops = getLineTops(lineBreaks, lines.length);
  const scale = (exportPdfWidth - exportPdfMargin * 2) / FIGMA.printableWidth;
  const fontSize = FIGMA.typeSize * scale;
  const textCommands = lines
    .map((line, index) => {
      const y = exportPdfHeight - exportPdfMargin - fontSize - (lineTops[index] ?? 0) * scale;
      if (y < exportPdfMargin) return "";
      return `1 0 0 1 ${exportPdfMargin.toFixed(2)} ${y.toFixed(2)} Tm (${sanitizePdfText(line)}) Tj`;
    })
    .filter(Boolean)
    .join("\n");
  const stream = `0.929 0.886 0.816 rg\n0 0 ${exportPdfWidth} ${exportPdfHeight} re f\n0 0 0 rg\nBT\n/F1 ${fontSize.toFixed(2)} Tf\n${textCommands}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${exportPdfWidth} ${exportPdfHeight}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf], { type: "application/pdf" });
}

async function createPngBlob(lines: string[], lineBreaks: LineBreak[]): Promise<Blob> {
  if ("fonts" in document) await document.fonts.load(fontSpec);

  const canvas = document.createElement("canvas");
  canvas.width = exportCanvasWidth;
  canvas.height = exportCanvasHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create export canvas.");

  const lineTops = getLineTops(lineBreaks, lines.length);
  const scale = (exportCanvasWidth - exportCanvasMargin * 2) / FIGMA.printableWidth;
  context.fillStyle = "#ede2d0";
  context.fillRect(0, 0, exportCanvasWidth, exportCanvasHeight);
  context.fillStyle = "#050505";
  context.font = `${FIGMA.typeSize * scale}px "Special Elite", "Courier New", monospace`;
  context.textBaseline = "top";

  lines.forEach((line, index) => {
    const y = exportCanvasMargin + (lineTops[index] ?? 0) * scale;
    if (y <= exportCanvasHeight - exportCanvasMargin) {
      context.fillText(line, exportCanvasMargin, y);
    }
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not export PNG."));
    }, "image/png");
  });
}

function getLinePrefix(line: string, column: number): string {
  if (column <= line.length) return line.slice(0, column);
  return line.padEnd(column, " ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function ensureProfileForUser(currentUser: User, displayName?: string) {
  if (!supabase) return;

  await supabase.from("profiles").upsert({
    id: currentUser.id,
    email: currentUser.email,
    updated_at: new Date().toISOString(),
    ...(displayName !== undefined ? { display_name: displayName.trim() || null } : {}),
  });
}

function useSpecialEliteMeasure() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [fontReady, setFontReady] = useState(false);

  useEffect(() => {
    canvasRef.current = document.createElement("canvas");

    if ("fonts" in document) {
      document.fonts.load(fontSpec).then(() => setFontReady(true));
    } else {
      setFontReady(true);
    }
  }, []);

  return useMemo(() => {
    const measure = (text: string) => {
      const context = canvasRef.current?.getContext("2d");
      if (!context) return text.length * 18;
      context.font = fontSpec;
      return context.measureText(text).width;
    };

    return { measure, fontReady };
  }, [fontReady]);
}

function App() {
  const [lines, setLines] = useState<string[]>([""]);
  const [lineBreaks, setLineBreaks] = useState<LineBreak[]>([]);
  const [pages, setPages] = useState<SavedPage[]>([]);
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(getInitialViewMode);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("sign-in");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [pendingAuthAction, setPendingAuthAction] = useState<PendingAuthAction>(null);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("pdf");
  const [exportFileName, setExportFileName] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [isStageReady, setIsStageReady] = useState(false);
  const [notice, setNotice] = useState<Notice>("ready");
  const [activeSlugId, setActiveSlugId] = useState<number | null>(null);
  const [isSlugPressed, setIsSlugPressed] = useState(false);
  const [stageScale, setStageScale] = useState(1);
  const [zoom, setZoom] = useState(initialZoom);
  const [lineSpacing, setLineSpacing] = useState<LineSpacing>(1);
  const [cursorColumn, setCursorColumn] = useState(0);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [isCarriageDragging, setIsCarriageDragging] = useState(false);
  const [isPageDragging, setIsPageDragging] = useState(false);
  const [dragFeed, setDragFeed] = useState<number | null>(null);
  const releaseTimeoutRef = useRef<number | null>(null);
  const linesRef = useRef(lines);
  const lineBreaksRef = useRef(lineBreaks);
  const cursorColumnRef = useRef(cursorColumn);
  const currentLineIndexRef = useRef(currentLineIndex);
  const carriageDragRef = useRef<CarriageDrag | null>(null);
  const pageDragRef = useRef<PageDrag | null>(null);
  const marginDingedRef = useRef(false);
  const saveTimeoutRef = useRef<number | null>(null);
  const keyPressAudioRef = useRef<HTMLAudioElement[]>([]);
  const dingAudioRef = useRef<HTMLAudioElement | null>(null);
  const newLineAudioRef = useRef<HTMLAudioElement | null>(null);
  const viewportRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { measure } = useSpecialEliteMeasure();

  const lineTops = useMemo(() => getLineTops(lineBreaks, lines.length), [lineBreaks, lines.length]);
  const currentLine = lines[currentLineIndex] ?? "";
  const currentAdvance = Math.min(measure(getLinePrefix(currentLine, cursorColumn)), maxAdvance);
  const carriageX = FIGMA.carriageRightX - currentAdvance;
  const feed = Math.min(dragFeed ?? lineTops[currentLineIndex] ?? 0, maxFeed);
  const paperTop = FIGMA.paperBottom - (FIGMA.initialPaperHeight + feed);
  const pageEndProgress = clamp((feed - (maxFeed - pageEndLiftRange)) / pageEndLiftRange, 0, 1);
  const paperBottom = FIGMA.paperBottom - maxPaperBottomLift * pageEndProgress;
  const textTop = FIGMA.textBaseTop - feed;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!supabase) {
      setIsAuthLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setIsAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      setIsAuthLoading(false);
      if (nextUser) window.setTimeout(() => void ensureProfileForUser(nextUser), 0);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !user) {
      setSaveStatus("idle");
      return;
    }

    const supabaseClient = supabase;
    let isCancelled = false;

    const loadPages = async () => {
      const { data, error } = await supabaseClient
        .from("pages")
        .select("id,title,document,updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      if (isCancelled) return;

      if (error) {
        setSaveStatus("error");
        return;
      }

      const remotePages = (data ?? []).flatMap((page) => {
        const document = readStoredPageDocument(page.document);
        if (!document) return [];
        return [
          {
            id: page.id,
            title: page.title,
            lines: document.lines,
            lineBreaks: document.lineBreaks,
            updatedAt: page.updated_at,
          },
        ];
      });

      setPages((previousPages) => {
        const localPages = previousPages.filter(
          (localPage) => !remotePages.some((remotePage) => remotePage.id === localPage.id),
        );
        return [...remotePages, ...localPages];
      });
      setSaveStatus(remotePages.length > 0 ? "saved" : "idle");
    };

    void loadPages();

    return () => {
      isCancelled = true;
    };
  }, [user]);

  useEffect(() => {
    const stageFrame = window.requestAnimationFrame(() => setIsStageReady(true));
    return () => window.cancelAnimationFrame(stageFrame);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("typewriter-view-mode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    lineBreaksRef.current = lineBreaks;
  }, [lineBreaks]);

  useEffect(() => {
    cursorColumnRef.current = cursorColumn;
  }, [cursorColumn]);

  useEffect(() => {
    currentLineIndexRef.current = currentLineIndex;
  }, [currentLineIndex]);

  useEffect(() => {
    keyPressAudioRef.current = AUDIO.keyPresses.map((source) => {
      const audio = new Audio(source);
      audio.preload = "auto";
      return audio;
    });

    dingAudioRef.current = new Audio(AUDIO.ding);
    dingAudioRef.current.preload = "auto";

    newLineAudioRef.current = new Audio(AUDIO.newLine);
    newLineAudioRef.current.preload = "auto";
  }, []);

  useEffect(() => {
    if (viewMode !== "editor") return;

    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateScale = () => {
      const { width, height } = viewport.getBoundingClientRect();
      setStageScale(Math.min(width / FIGMA.frameWidth, height / FIGMA.frameHeight));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewMode]);

  useEffect(() => {
    if (notice === "ready") return;
    const timeout = window.setTimeout(() => setNotice("ready"), 700);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    return () => {
      if (releaseTimeoutRef.current) window.clearTimeout(releaseTimeoutRef.current);
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const setDocumentLines = (nextLines: string[]) => {
    linesRef.current = nextLines;
    setLines(nextLines);
  };

  const setDocumentLineBreaks = (nextLineBreaks: LineBreak[]) => {
    const normalizedLineBreaks = normalizeLineBreaks(nextLineBreaks);
    lineBreaksRef.current = normalizedLineBreaks;
    setLineBreaks(normalizedLineBreaks);
  };

  const setDocumentCursorColumn = (nextCursorColumn: number) => {
    cursorColumnRef.current = nextCursorColumn;
    setCursorColumn(nextCursorColumn);
  };

  const setDocumentLineIndex = (nextLineIndex: number) => {
    currentLineIndexRef.current = nextLineIndex;
    setCurrentLineIndex(nextLineIndex);
  };

  const setCurrentLine = (line: string, nextCursorColumn: number) => {
    const next = [...linesRef.current];
    next[currentLineIndexRef.current] = line;
    setDocumentLines(next);
    setDocumentCursorColumn(nextCursorColumn);
  };

  const saveCurrentPageToCache = (options: { includeEmpty?: boolean } = {}) => {
    const { includeEmpty = false } = options;
    const currentLines = linesRef.current;
    if (!includeEmpty && !hasPageContent(currentLines)) return null;

    const id = currentPageId ?? createPageId();
    const pageSnapshot: SavedPage = {
      id,
      lines: [...currentLines],
      lineBreaks: normalizeLineBreaks(lineBreaksRef.current).map((lineBreak) => ({ ...lineBreak })),
    };

    setPages((previousPages) => {
      const existingIndex = previousPages.findIndex((page) => page.id === id);
      if (existingIndex === -1) return [...previousPages, pageSnapshot];

      const nextPages = [...previousPages];
      nextPages[existingIndex] = pageSnapshot;
      return nextPages;
    });

    setCurrentPageId(id);
    return id;
  };

  const persistPage = async (page: SavedPage, currentUser = user) => {
    if (!supabase || !currentUser || !hasPageContent(page.lines)) return;

    setSaveStatus("saving");
    const { error } = await supabase.from("pages").upsert({
      id: page.id,
      user_id: currentUser.id,
      title: page.title ?? null,
      document: createStoredPageDocument(page.lines, page.lineBreaks),
      updated_at: new Date().toISOString(),
    });

    setSaveStatus(error ? "error" : "saved");
  };

  const saveCurrentPage = async (options: { includeEmpty?: boolean } = {}) => {
    const id = saveCurrentPageToCache(options);
    if (!id || !user) return id;

    await persistPage({
      id,
      lines: [...linesRef.current],
      lineBreaks: normalizeLineBreaks(lineBreaksRef.current).map((lineBreak) => ({ ...lineBreak })),
    });

    return id;
  };

  const openAuthModal = (mode: AuthMode = "sign-in", pendingAction: PendingAuthAction = null) => {
    setAuthMode(mode);
    setPendingAuthAction(pendingAction);
    setAuthMessage(
      isSupabaseConfigured
        ? ""
        : "Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your local .env file before signing in.",
    );
    setIsAuthOpen(true);
    setIsAccountOpen(false);
  };

  const closeAuthModal = () => {
    setIsAuthOpen(false);
    setPendingAuthAction(null);
    setAuthMessage("");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const ensureSignedIn = (pendingAction: PendingAuthAction) => {
    if (user) return true;
    openAuthModal("sign-in", pendingAction);
    return false;
  };

  const completePendingAuthAction = async (action: PendingAuthAction) => {
    setPendingAuthAction(null);

    if (action === "new-page") {
      await startNewPage();
      return;
    }

    if (action === "export") {
      await openExportModal();
    }
  };

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setAuthMessage("Supabase is not configured yet. Add your URL and anon key to .env.");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthMessage("");

    try {
      if (authMode === "register") {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              display_name: authDisplayName.trim() || null,
            },
          },
        });

        if (error) throw error;

        const registeredUser = data.user;
        if (!data.session) {
          setAuthMessage("Account created. Check your email to confirm your account, then sign in.");
          setAuthMode("sign-in");
          return;
        }

        if (registeredUser) await ensureProfileForUser(registeredUser, authDisplayName);
        setUser(registeredUser);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        });

        if (error) throw error;
        await ensureProfileForUser(data.user);
        setUser(data.user);
      }

      setAuthPassword("");
      setIsAuthOpen(false);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!supabase) {
      setAuthMessage("Supabase is not configured yet. Add your URL and anon key to .env.");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthMessage("");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) {
      setAuthMessage(error.message);
      setIsAuthSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    await saveCurrentPage();
    await supabase.auth.signOut();
    setUser(null);
    setPages([]);
    setCurrentPageId(null);
    resetDocument();
    setViewMode("editor");
    window.localStorage.setItem("typewriter-view-mode", "editor");
    setIsAccountOpen(false);
    setIsAuthOpen(false);
    setPendingAuthAction(null);
    setSaveStatus("idle");
  };

  useEffect(() => {
    if (!user || !hasPageContent(lines)) return;

    if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = window.setTimeout(() => {
      void saveCurrentPage();
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    };
  }, [lines, lineBreaks, user]);

  useEffect(() => {
    if (!user || isAuthOpen || !pendingAuthAction) return;
    void completePendingAuthAction(pendingAuthAction);
  }, [user, isAuthOpen, pendingAuthAction]);

  useEffect(() => {
    if (!user || !isAuthOpen || isAuthSubmitting) return;
    setIsAuthOpen(false);
    setAuthPassword("");
    setAuthMessage("");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [user, isAuthOpen, isAuthSubmitting]);

  const ensureLineIndexExists = (targetLineIndex: number) => {
    const nextLines = [...linesRef.current];
    const nextLineBreaks = [...lineBreaksRef.current];

    while (nextLines.length <= targetLineIndex) {
      const tops = getLineTops(nextLineBreaks, nextLines.length);
      const currentFeed = tops[nextLines.length - 1] ?? 0;
      const advance = getLineAdvance(lineSpacing);

      if (currentFeed + advance > maxFeed) break;

      nextLineBreaks.push({
        afterLineIndex: nextLineBreaks.length,
        spacing: lineSpacing,
        advance,
      });
      nextLines.push("");
    }

    setDocumentLines(nextLines);
    setDocumentLineBreaks(nextLineBreaks);
    return Math.min(targetLineIndex, nextLines.length - 1);
  };

  const getClosestCursorColumn = (line: string, targetAdvance: number) => {
    let bestColumn = 0;
    let bestDistance = Math.abs(targetAdvance);
    const maxColumns = 160;

    for (let column = 1; column <= maxColumns; column += 1) {
      const advance = measure(getLinePrefix(line, column));
      const distance = Math.abs(advance - targetAdvance);

      if (distance < bestDistance) {
        bestColumn = column;
        bestDistance = distance;
      }

      if (advance > maxAdvance && advance > targetAdvance) break;
    }

    return bestColumn;
  };

  const getClosestLineIndex = (targetFeed: number) => {
    const currentLines = linesRef.current;
    const currentLineBreaks = lineBreaksRef.current;
    const tops = getLineTops(currentLineBreaks, currentLines.length);
    const advance = getLineAdvance(lineSpacing);
    let feedCursor = tops[tops.length - 1] ?? 0;

    while (feedCursor + advance <= maxFeed) {
      feedCursor += advance;
      tops.push(feedCursor);
    }

    let bestIndex = 0;
    let bestDistance = Math.abs(targetFeed);

    for (let index = 0; index < tops.length; index += 1) {
      const distance = Math.abs(tops[index] - targetFeed);

      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    }

    return bestIndex;
  };

  const fillCurrentLineToCursor = () => {
    const previous = linesRef.current;
    const index = currentLineIndexRef.current;
    const line = previous[index] ?? "";
    const cursor = cursorColumnRef.current;

    if (cursor <= line.length) return;

    const next = [...previous];
    next[index] = line.padEnd(cursor, " ");
    setDocumentLines(next);
  };

  const playAudio = (audio: HTMLAudioElement | null | undefined) => {
    if (!audio) return;
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  };

  const playRandomKeyPress = () => {
    const audios = keyPressAudioRef.current;
    if (audios.length === 0) return;
    playAudio(audios[Math.floor(Math.random() * audios.length)]);
  };

  const playNewLine = () => {
    playAudio(newLineAudioRef.current);
  };

  const playDing = () => {
    playAudio(dingAudioRef.current);
  };

  const pressSlug = (key: string) => {
    if (releaseTimeoutRef.current) window.clearTimeout(releaseTimeoutRef.current);
    releaseTimeoutRef.current = null;
    setActiveSlugId(getSlugIdForKey(key));
    setIsSlugPressed(true);
  };

  const releaseSlug = () => {
    if (activeSlugId === null) return;
    setIsSlugPressed(false);
    if (releaseTimeoutRef.current) window.clearTimeout(releaseTimeoutRef.current);
    releaseTimeoutRef.current = window.setTimeout(() => {
      setActiveSlugId(null);
      releaseTimeoutRef.current = null;
    }, slugTransitionMs);
  };

  const resetDocument = () => {
    setDocumentLines([""]);
    setDocumentLineBreaks([]);
    setDocumentLineIndex(0);
    setDocumentCursorColumn(0);
    setDragFeed(null);
    marginDingedRef.current = false;
    setNotice("ready");
    inputRef.current?.focus();
  };

  const startNewPage = async () => {
    if (!ensureSignedIn("new-page")) return;
    await saveCurrentPage();
    setCurrentPageId(null);
    resetDocument();
    setViewMode("editor");
    setIsExportOpen(false);
  };

  const openPageGrid = async () => {
    await saveCurrentPage({ includeEmpty: pages.length === 0 && currentPageId === null });
    setViewMode("grid");
    setIsExportOpen(false);
  };

  const openSavedPage = (page: SavedPage) => {
    setCurrentPageId(page.id);
    setDocumentLines([...page.lines]);
    setDocumentLineBreaks(page.lineBreaks.map((lineBreak) => ({ ...lineBreak })));
    setDocumentLineIndex(0);
    setDocumentCursorColumn(0);
    setDragFeed(null);
    marginDingedRef.current = false;
    setNotice("ready");
    setViewMode("editor");
    setIsExportOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const openExportModal = async () => {
    if (!ensureSignedIn("export")) return;
    await saveCurrentPage();
    setIsExportOpen(true);
  };

  const closeExportModal = () => {
    setIsExportOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const exportCurrentPage = async () => {
    setIsExporting(true);

    try {
      await saveCurrentPage();
      const currentLines = linesRef.current;
      const currentLineBreaks = lineBreaksRef.current;
      const blob =
        exportFormat === "pdf"
          ? createPdfBlob(currentLines, currentLineBreaks)
          : await createPngBlob(currentLines, currentLineBreaks);
      downloadBlob(blob, getDownloadName(exportFileName, exportFormat));
      closeExportModal();
    } finally {
      setIsExporting(false);
    }
  };

  const addReturn = () => {
    const previous = linesRef.current;
    const previousLineBreaks = lineBreaksRef.current;
    const index = currentLineIndexRef.current;
    const line = previous[index] ?? "";
    const advance = getLineAdvance(lineSpacing);
    const currentFeed = getLineTops(previousLineBreaks, previous.length)[index] ?? 0;

    if (currentFeed + advance > maxFeed) {
      setNotice("page-end");
      return false;
    }

    if (shouldPlayReturnSound(line, cursorColumnRef.current)) playNewLine();
    setNotice("ready");
    const nextLines = [...previous];
    const nextLineBreaks = [...previousLineBreaks];
    nextLines.splice(index + 1, 0, "");
    nextLineBreaks.splice(index, 0, {
      afterLineIndex: index,
      spacing: lineSpacing,
      advance,
    });
    setDocumentLines(nextLines);
    setDocumentLineBreaks(nextLineBreaks);
    setDocumentLineIndex(index + 1);
    setDocumentCursorColumn(0);
    marginDingedRef.current = false;
    return true;
  };

  const addCharacter = (character: string) => {
    const previous = linesRef.current;
    const index = currentLineIndexRef.current;
    const line = previous[index] ?? "";
    const cursor = cursorColumnRef.current;
    const sourceLine = cursor > line.length ? line.padEnd(cursor, " ") : line;
    const candidate = `${sourceLine.slice(0, cursor)}${character}${sourceLine.slice(cursor + 1)}`;
    const nextCursor = cursor + 1;

    if (measure(getLinePrefix(candidate, nextCursor)) > maxAdvance) {
      if (!marginDingedRef.current) playDing();
      marginDingedRef.current = true;
      setNotice("margin");
      return;
    }

    marginDingedRef.current = false;
    setNotice("ready");
    setCurrentLine(candidate, nextCursor);
  };

  const removeCharacter = () => {
    const previous = linesRef.current;
    const next = [...previous];
    const index = currentLineIndexRef.current;
    const line = next[index] ?? "";
    const cursor = cursorColumnRef.current;

    if (cursor > 0) {
      next[index] = `${line.slice(0, cursor - 1)}${line.slice(cursor)}`;
      setDocumentLines(next);
      setDocumentCursorColumn(cursor - 1);
    } else if (index > 0) {
      next.splice(index, 1);
      setDocumentLines(next);
      const nextLineBreaks = [...lineBreaksRef.current];
      nextLineBreaks.splice(index - 1, 1);
      setDocumentLineBreaks(nextLineBreaks);
      setDocumentLineIndex(index - 1);
      setDocumentCursorColumn(next[index - 1]?.length ?? 0);
    }

    marginDingedRef.current = false;
    setNotice("ready");
  };

  const typeText = (text: string, options: { playKeySounds?: boolean } = {}) => {
    const { playKeySounds = true } = options;

    for (const character of text) {
      if (character === "\n" || character === "\r") {
        addReturn();
      } else if (character >= " ") {
        if (playKeySounds) playRandomKeyPress();
        addCharacter(character);
      }
    }
  };

  const moveCursorLeft = () => {
    setDocumentCursorColumn(Math.max(0, cursorColumnRef.current - 1));
    marginDingedRef.current = false;
    setNotice("ready");
  };

  const moveCursorRight = () => {
    const line = linesRef.current[currentLineIndexRef.current] ?? "";
    const cursor = cursorColumnRef.current;

    if (cursor < line.length) {
      setDocumentCursorColumn(cursor + 1);
      marginDingedRef.current = false;
      setNotice("ready");
      return;
    }

    addCharacter(" ");
  };

  const startCarriageDrag = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("[data-page-surface]")) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    carriageDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startAdvance: measure(getLinePrefix(linesRef.current[currentLineIndexRef.current] ?? "", cursorColumnRef.current)),
    };
    setIsCarriageDragging(true);
    inputRef.current?.focus();
  };

  const updateCarriageDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = carriageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    const effectiveScale = stageScale * zoom || 1;
    const targetAdvance = clamp(drag.startAdvance - (event.clientX - drag.startClientX) / effectiveScale, 0, maxAdvance);
    const line = linesRef.current[currentLineIndexRef.current] ?? "";
    setDocumentCursorColumn(getClosestCursorColumn(line, targetAdvance));
    marginDingedRef.current = false;
    setNotice("ready");
  };

  const finishCarriageDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = carriageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    carriageDragRef.current = null;
    setIsCarriageDragging(false);
    fillCurrentLineToCursor();
    inputRef.current?.focus();
  };

  const startPageDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pageDragRef.current = {
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startFeed: lineTops[currentLineIndexRef.current] ?? 0,
    };
    setIsPageDragging(true);
    inputRef.current?.focus();
  };

  const updatePageDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = pageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    const effectiveScale = stageScale * zoom || 1;
    const targetFeed = clamp(drag.startFeed - (event.clientY - drag.startClientY) / effectiveScale, 0, maxFeed);
    setDragFeed(targetFeed);
    setNotice("ready");
  };

  const finishPageDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = pageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const effectiveScale = stageScale * zoom || 1;
    const targetFeed = clamp(drag.startFeed - (event.clientY - drag.startClientY) / effectiveScale, 0, maxFeed);
    const snappedLineIndex = ensureLineIndexExists(getClosestLineIndex(targetFeed));
    setDocumentLineIndex(snappedLineIndex);
    pageDragRef.current = null;
    setIsPageDragging(false);
    setDragFeed(null);
    inputRef.current?.focus();
  };

  const handleZoomChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setZoom(Number(event.target.value));
    inputRef.current?.focus();
  };

  const handleLineSpacingChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setLineSpacing(Number(event.target.value) as LineSpacing);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isExportOpen) {
      event.preventDefault();
      return;
    }

    if (viewMode !== "editor") {
      event.preventDefault();
      return;
    }

    if (event.repeat) {
      event.preventDefault();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      addReturn();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveCursorLeft();
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveCursorRight();
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      playRandomKeyPress();
      removeCharacter();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      playRandomKeyPress();
      typeText("    ", { playKeySounds: false });
      return;
    }

    if (isPrintableKey(event)) {
      event.preventDefault();
      playRandomKeyPress();
      if (event.key !== " ") pressSlug(event.key);
      addCharacter(event.key);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    typeText(event.clipboardData.getData("text"));
  };

  const isRibbonActive = activeSlugId !== null && isSlugPressed;

  return (
    <main
      className="app-shell"
      onPointerDown={() => viewMode === "editor" && !isExportOpen && inputRef.current?.focus()}
    >
      <textarea
        ref={inputRef}
        className="keyboard-capture"
        aria-label="Typewriter input"
        value=""
        onChange={() => undefined}
        onKeyDown={handleKeyDown}
        onKeyUp={releaseSlug}
        onPaste={handlePaste}
        autoFocus
      />

      <nav className="app-menu" aria-label="Typewriter menu">
        <div className="menu-cluster">
          <button className="glass-button icon-button" type="button" onClick={openPageGrid} aria-label="Show page grid">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z" />
            </svg>
          </button>
          <button className="glass-button text-button" type="button" onClick={startNewPage}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 3h7.6L19 7.4V21H7V3Zm7 1.8V8h3.2L14 4.8ZM9 5v14h8V10h-5V5H9Zm3 7h2v2h2v2h-2v2h-2v-2h-2v-2h2v-2Z" />
            </svg>
            <span>New Page</span>
          </button>
        </div>

        {viewMode === "editor" ? (
          <div className="menu-cluster menu-controls">
            <label>
              <span>Zoom</span>
              <span className="select-shell">
                <span className="select-value">
                  {zoom === 1.5 ? "Default" : zoom === 1 ? "50%" : zoom === 1.25 ? "75%" : zoom === 1.75 ? "125%" : "150%"}
                </span>
                <select value={zoom} onChange={handleZoomChange} aria-label="Zoom">
                  <option value={1}>50%</option>
                  <option value={1.25}>75%</option>
                  <option value={1.5}>Default</option>
                  <option value={1.75}>125%</option>
                  <option value={2}>150%</option>
                </select>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m7 9 5 5 5-5H7Z" />
                </svg>
              </span>
            </label>
            <label>
              <span>Line</span>
              <span className="select-shell">
                <span className="select-value">{lineSpacing === 0 ? "0" : `${lineSpacing}x`}</span>
                <select value={lineSpacing} onChange={handleLineSpacingChange} aria-label="Line spacing">
                  <option value={0}>0</option>
                  <option value={1}>1x</option>
                  <option value={1.5}>1.5x</option>
                  <option value={2}>2x</option>
                </select>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m7 9 5 5 5-5H7Z" />
                </svg>
              </span>
            </label>
            <button className="glass-button export-menu-button" type="button" onClick={openExportModal}>
              Export
            </button>
            {user ? (
              <span className={`save-status save-status-${saveStatus}`}>
                {saveStatus === "saving" ? "Saving..." : saveStatus === "error" ? "Save failed" : saveStatus === "saved" ? "Saved" : ""}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="menu-cluster account-cluster">
          {isAuthLoading ? (
            <span className="glass-button text-button account-static">Checking...</span>
          ) : user ? (
            <div className="account-menu">
              <button
                className="glass-button icon-button account-button"
                type="button"
                onClick={() => setIsAccountOpen((isOpen) => !isOpen)}
                aria-label="Account"
                aria-expanded={isAccountOpen}
              >
                <span>{(user.email?.[0] ?? "U").toUpperCase()}</span>
              </button>
              {isAccountOpen ? (
                <section className="account-popover" aria-label="Account settings">
                  <span className="account-label">Signed in as</span>
                  <strong>{user.email}</strong>
                  <button className="glass-button text-button" type="button" onClick={handleSignOut}>
                    Sign Out
                  </button>
                </section>
              ) : null}
            </div>
          ) : (
            <button className="glass-button text-button" type="button" onClick={() => openAuthModal("sign-in")}>
              Sign In
            </button>
          )}
        </div>
      </nav>

      {viewMode === "grid" ? (
        <section className="page-grid-view" aria-label="Saved pages">
          <div className="page-grid">
            {pages.map((page, index) => (
              <button className="page-preview" type="button" key={page.id} onClick={() => openSavedPage(page)}>
                <span className="page-preview-content">{page.lines.join("\n")}</span>
                <span className="page-preview-label">Page {index + 1}</span>
              </button>
            ))}
            <button className="new-page-card" type="button" onClick={startNewPage}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 3h7.6L19 7.4V21H7V3Zm7 1.8V8h3.2L14 4.8ZM9 5v14h8V10h-5V5H9Zm3 7h2v2h2v2h-2v2h-2v-2h-2v-2h2v-2Z" />
              </svg>
              <span>New Page</span>
            </button>
          </div>
        </section>
      ) : (
        <section
          ref={viewportRef}
          className={`machine-viewport ${isStageReady ? "is-stage-ready" : ""}`}
          aria-label="Interactive typewriter"
        >
          <div className="machine-stage" style={{ transform: `translateX(-50%) scale(${stageScale * zoom})` }}>
          <div
            className={`carriage ${notice !== "ready" ? "carriage-alert" : ""} ${
              isCarriageDragging ? "is-dragging" : ""
            } ${isPageDragging ? "is-page-dragging" : ""}`}
            style={{ transform: `translate3d(${carriageX}px, 0, 0)` }}
            onPointerDown={startCarriageDrag}
            onPointerMove={updateCarriageDrag}
            onPointerUp={finishCarriageDrag}
            onPointerCancel={finishCarriageDrag}
          >
            <img className="figma-asset platen" src={ASSETS.platen} alt="" draggable="false" />

            <div
              className={`paper ${pageEndProgress > 0.85 ? "is-page-ending" : ""}`}
              data-page-surface
              onPointerDown={startPageDrag}
              onPointerMove={updatePageDrag}
              onPointerUp={finishPageDrag}
              onPointerCancel={finishPageDrag}
              style={{
                top: paperTop,
                height: paperBottom - paperTop,
                width: FIGMA.paperWidth,
              }}
            />

            <div
              className="roller-shadow"
              data-page-surface
              onPointerDown={startPageDrag}
              onPointerMove={updatePageDrag}
              onPointerUp={finishPageDrag}
              onPointerCancel={finishPageDrag}
            />

            <div
              className="typed-paper-text"
              data-page-surface
              onPointerDown={startPageDrag}
              onPointerMove={updatePageDrag}
              onPointerUp={finishPageDrag}
              onPointerCancel={finishPageDrag}
              style={{
                left: FIGMA.textInsetX,
                top: textTop,
                width: FIGMA.printableWidth,
              }}
            >
              {lines.map((line, index) => (
                <div key={index} className="typed-paper-line" style={{ top: lineTops[index] ?? 0 }}>
                  {line || "\u00a0"}
                </div>
              ))}
            </div>

            <img
              className="figma-asset paper-press-roller"
              src={ASSETS.paperPressRoller}
              alt=""
              draggable="false"
            />
          </div>

          <div className="fixed-typewriter-body" data-active-slug-id={activeSlugId ?? ""}>
            <img className="figma-asset point-guide-guard" src={ASSETS.pointGuideGuard} alt="" draggable="false" />
            <img
              className={`figma-asset color-ribbon-slugs-idle ${isRibbonActive ? "" : "is-visible"}`}
              src={ASSETS.colorRibbonSlugsIdle}
              alt=""
              draggable="false"
            />
            <img
              className={`figma-asset color-ribbon-slugs-active ${isRibbonActive ? "is-visible" : ""}`}
              src={ASSETS.colorRibbonSlugsActive}
              alt=""
              draggable="false"
            />
            <div className="slug-stage" aria-hidden="true">
              {slugConfigs.map((slug) => (
                <div
                  key={slug.id}
                  className={`slug-slot ${activeSlugId === slug.id ? "is-visible" : ""} ${
                    activeSlugId === slug.id && isSlugPressed ? "is-held" : ""
                  }`}
                  style={{
                    "--slug-pivot-x": `${slugPivot.x}px`,
                    "--slug-pivot-y": `${slugPivot.y}px`,
                    "--slug-angle": `${slug.angle}deg`,
                    "--slug-width": `${slug.slugWidth}px`,
                    "--slug-height": `${slug.slugHeight}px`,
                    "--slug-rest-offset": `${slugRestOffset}px`,
                  } as CSSProperties}
                >
                  <img
                    className="slug-piece"
                    src={ASSETS.slug}
                    alt=""
                    draggable="false"
                    style={{
                      width: slug.slugWidth,
                      height: slug.slugHeight,
                    }}
                  />
                </div>
              ))}
            </div>
            <img className="figma-asset typewriter-body" src={ASSETS.typewriterBody} alt="" draggable="false" />
            <div className="typing-cursor" style={{ left: FIGMA.cursorX, top: FIGMA.cursorY }} />
          </div>
          </div>
        </section>
      )}

      {isAuthOpen ? (
        <div className="export-overlay" onPointerDown={closeAuthModal}>
          <section className="export-modal auth-modal" aria-label="Sign in" onPointerDown={(event) => event.stopPropagation()}>
            <div className="export-modal-header">
              <h2>{authMode === "sign-in" ? "Sign In" : "Create Account"}</h2>
              <button className="glass-button icon-button" type="button" onClick={closeAuthModal} aria-label="Close">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6.4 5 12.6 12.6-1.4 1.4L5 6.4 6.4 5Zm12.6 1.4L6.4 19 5 17.6 17.6 5 19 6.4Z" />
                </svg>
              </button>
            </div>

            <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
              <button
                className={authMode === "sign-in" ? "is-active" : ""}
                type="button"
                onClick={() => {
                  setAuthMode("sign-in");
                  setAuthMessage("");
                }}
              >
                Sign In
              </button>
              <button
                className={authMode === "register" ? "is-active" : ""}
                type="button"
                onClick={() => {
                  setAuthMode("register");
                  setAuthMessage("");
                }}
              >
                Register
              </button>
            </div>

            <button
              className="oauth-button"
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isAuthSubmitting || !isSupabaseConfigured}
            >
              <span aria-hidden="true">G</span>
              Continue with Google
            </button>

            <div className="auth-divider">
              <span>or</span>
            </div>

            <form className="auth-form" onSubmit={handleAuthSubmit}>
              {authMode === "register" ? (
                <label className="export-field">
                  <span>Name</span>
                  <input
                    value={authDisplayName}
                    onChange={(event) => setAuthDisplayName(event.target.value)}
                    placeholder="Optional"
                    autoComplete="name"
                  />
                </label>
              ) : null}

              <label className="export-field">
                <span>Email</span>
                <input
                  type="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </label>

              <label className="export-field">
                <span>Password</span>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete={authMode === "register" ? "new-password" : "current-password"}
                  required
                  minLength={6}
                />
              </label>

              {authMessage ? <p className="auth-message">{authMessage}</p> : null}

              <button className="export-submit" type="submit" disabled={isAuthSubmitting || !isSupabaseConfigured}>
                {isAuthSubmitting ? "Working..." : authMode === "sign-in" ? "Sign In" : "Create Account"}
              </button>
            </form>
          </section>
        </div>
      ) : null}

      {isExportOpen ? (
        <div className="export-overlay" onPointerDown={closeExportModal}>
          <section
            className="export-modal"
            aria-label="Export"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="export-modal-header">
              <h2>Export</h2>
              <span className="select-shell">
                <span className="select-value">{exportFormat.toUpperCase()}</span>
                <select
                  value={exportFormat}
                  onChange={(event) => setExportFormat(event.target.value as ExportFormat)}
                  aria-label="Export format"
                >
                  <option value="pdf">PDF</option>
                  <option value="png">PNG</option>
                </select>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m7 9 5 5 5-5H7Z" />
                </svg>
              </span>
            </div>

            <label className="export-field">
              <span>File Name</span>
              <input
                value={exportFileName}
                onChange={(event) => setExportFileName(event.target.value)}
                placeholder="typewriter-page"
              />
            </label>

            <div className="export-preview-block">
              <span>Preview</span>
              <div className="export-preview-frame">
                <div className="export-paper-preview">
                  <span>{lines.join("\n") || "\u00a0"}</span>
                </div>
              </div>
            </div>

            <button className="export-submit" type="button" onClick={exportCurrentPage} disabled={isExporting}>
              {isExporting ? "Exporting..." : "Export"}
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default App;
