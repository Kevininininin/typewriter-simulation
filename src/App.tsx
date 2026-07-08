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
const backgroundStorageBucket = "background-images";
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
  typewriterTemplate: "/assets/typewriter-template.png",
  backgroundPathway: "/assets/background-pathway.jpg",
  backgroundShadow: "/assets/background-shadow.jpg",
  menuHomeRounded: "/assets/menu-home-rounded.svg",
  googleSignInMark: "/assets/google-signin-mark.svg",
};

const defaultBackgroundImages: BackgroundImageOption[] = [
  {
    id: "default-pathway",
    name: "Pathway",
    url: ASSETS.backgroundPathway,
  },
  {
    id: "default-shadow",
    name: "Shadow",
    url: ASSETS.backgroundShadow,
  },
];

const defaultBackgroundSettings: BackgroundSettings = {
  mode: "mono",
  monoColor: "#171337",
  gradientColor1: "#171337",
  gradientColor2: "#42369d",
  gradientAngle: 90,
  selectedImageId: null,
  uploadedImages: [],
};

const monoSwatches = ["#ffffff", "#5f3a0d", "#154e34", "#171337", "#4a0c3c", "#000000"];

const preloadImageAsset = async (source: string) => {
  const image = new Image();

  if (typeof image.decode === "function") {
    image.src = source;
    await image.decode();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`Unable to load image asset: ${source}`));
    image.src = source;
  });
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
  carriageDrag: "/assets/audio/new%20line%20on%20drag.mp3",
};
const carriageDragLoopOverlapSeconds = 0.12;

type Notice = "ready" | "margin" | "page-end";
type LineSpacing = 0 | 1 | 1.5 | 2;
type ExportFormat = "pdf" | "png";
type AuthMode = "sign-in" | "register";
type PendingAuthAction = "new-page" | "export" | null;
type SaveStatus = "idle" | "saving" | "saved" | "error";
type SaveStatusSource = "page" | "background" | null;
type BackgroundMode = "mono" | "gradient" | "image";
type ColorPickerTarget = "mono" | "gradient-1" | "gradient-2" | null;
type LineBreak = {
  afterLineIndex: number;
  spacing: LineSpacing;
  advance: number;
};
type BackgroundImageOption = {
  id: string;
  name: string;
  url: string;
  path?: string;
  isUserUpload?: boolean;
};
type BackgroundSettings = {
  mode: BackgroundMode;
  monoColor: string;
  gradientColor1: string;
  gradientColor2: string;
  gradientAngle: number;
  selectedImageId: string | null;
  uploadedImages: BackgroundImageOption[];
};
type ViewMode = "editor" | "grid";
type OnboardingPlacement = "platen" | "page" | "account" | "typing";
type SavedPage = {
  id: string;
  title?: string | null;
  lines: string[];
  lineBreaks: LineBreak[];
  createdAt?: string;
  updatedAt?: string;
};
type StoredPageDocument = {
  version: 1;
  lines: string[];
  lineBreaks: LineBreak[];
};
type StoredBackgroundSettings = Omit<BackgroundSettings, "uploadedImages"> & {
  version: 1;
  uploadedImages: Array<Pick<BackgroundImageOption, "id" | "name" | "path" | "isUserUpload">>;
};
type CarriageDrag = {
  pointerId: number;
  startClientX: number;
  startAdvance: number;
  hasMoved: boolean;
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
type OnboardingStep = {
  title: string;
  description: string;
  placement: OnboardingPlacement;
};

const onboardingSteps: OnboardingStep[] = [
  {
    title: "Move Across A Row",
    description: "Drag the platen left or right to move your cursor within the current row, then type to edit from that spot.",
    placement: "platen",
  },
  {
    title: "Change Rows",
    description: "Drag the page up or down to move between rows. Release it and the page snaps to the closest editable line.",
    placement: "page",
  },
  {
    title: "Save Or Export",
    description: "Sign up or log in for free to store pages and export your work whenever you are ready.",
    placement: "account",
  },
  {
    title: "Start Typing",
    description: "Click into the page and type. The typewriter sounds, cursor, and slugs respond as you write.",
    placement: "typing",
  },
];

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

function getLastContentPosition(lines: string[]): { lineIndex: number; cursorColumn: number } {
  for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
    const line = lines[lineIndex] ?? "";
    if (!/\S/.test(line)) continue;

    return {
      lineIndex,
      cursorColumn: line.trimEnd().length,
    };
  }

  return { lineIndex: 0, cursorColumn: 0 };
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

function normalizeHexColor(value: unknown, fallback = "#171337"): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(trimmed)) return fallback;
  return `#${trimmed.toLowerCase()}`;
}

function getHexLabel(color: string): string {
  return normalizeHexColor(color).replace("#", "").toUpperCase();
}

function hexToRgb(color: string) {
  const normalized = normalizeHexColor(color);
  const value = Number.parseInt(normalized.slice(1), 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function hexToHsv(color: string) {
  const { r, g, b } = hexToRgb(color);
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }

  return {
    h: hue < 0 ? hue + 360 : hue,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

function hsvToHex(hue: number, saturation: number, value: number): string {
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = value - chroma;
  const [r1, g1, b1] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];

  return rgbToHex((r1 + match) * 255, (g1 + match) * 255, (b1 + match) * 255);
}

function getBackgroundCss(settings: BackgroundSettings): string {
  if (settings.mode === "gradient") {
    return `linear-gradient(${settings.gradientAngle}deg, ${settings.gradientColor1}, ${settings.gradientColor2})`;
  }

  if (settings.mode === "image") {
    const selectedImage = getAvailableBackgroundImages(settings).find((image) => image.id === settings.selectedImageId);
    if (selectedImage?.url) return `url("${selectedImage.url}") center / cover no-repeat`;
  }

  return settings.monoColor;
}

function getAvailableBackgroundImages(settings: BackgroundSettings): BackgroundImageOption[] {
  return [...defaultBackgroundImages, ...settings.uploadedImages];
}

function createStoredBackgroundSettings(settings: BackgroundSettings): StoredBackgroundSettings {
  return {
    version: 1,
    mode: settings.mode,
    monoColor: normalizeHexColor(settings.monoColor),
    gradientColor1: normalizeHexColor(settings.gradientColor1),
    gradientColor2: normalizeHexColor(settings.gradientColor2, "#42369d"),
    gradientAngle: clamp(settings.gradientAngle, 0, 360),
    selectedImageId: settings.selectedImageId,
    uploadedImages: settings.uploadedImages
      .filter((image) => image.isUserUpload && image.path)
      .slice(0, 2)
      .map((image) => ({
        id: image.id,
        name: image.name,
        path: image.path,
        isUserUpload: true,
      })),
  };
}

function areStoredBackgroundSettingsEqual(first: StoredBackgroundSettings, second: StoredBackgroundSettings): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function createBackgroundSettingsFromStored(
  storedSettings: StoredBackgroundSettings,
  uploadedImages: BackgroundImageOption[],
): BackgroundSettings {
  const restoredUploads = storedSettings.uploadedImages.flatMap((storedImage) => {
    const matchingImage = uploadedImages.find(
      (image) => image.path === storedImage.path || image.id === storedImage.id,
    );
    if (!matchingImage?.url) return [];

    return [
      {
        id: storedImage.id,
        name: storedImage.name,
        path: storedImage.path,
        url: matchingImage.url,
        isUserUpload: true,
      },
    ];
  });
  const selectedImagePool = getAvailableBackgroundImages({
    ...defaultBackgroundSettings,
    ...storedSettings,
    uploadedImages: restoredUploads,
  });
  const selectedImageId = selectedImagePool.some((image) => image.id === storedSettings.selectedImageId)
    ? storedSettings.selectedImageId
    : null;

  return {
    ...defaultBackgroundSettings,
    ...storedSettings,
    uploadedImages: restoredUploads,
    selectedImageId,
    mode: storedSettings.mode === "image" && !selectedImageId ? "mono" : storedSettings.mode,
  };
}

function readStoredBackgroundSettings(settings: unknown): StoredBackgroundSettings | null {
  if (!settings || typeof settings !== "object") return null;
  const candidate = settings as Partial<StoredBackgroundSettings>;
  const mode: BackgroundMode =
    candidate.mode === "gradient" || candidate.mode === "image" || candidate.mode === "mono" ? candidate.mode : "mono";
  const uploadedImages = Array.isArray(candidate.uploadedImages)
    ? candidate.uploadedImages
        .filter((image): image is Pick<BackgroundImageOption, "id" | "name" | "path" | "isUserUpload"> => {
          if (!image || typeof image !== "object") return false;
          const value = image as Partial<BackgroundImageOption>;
          return typeof value.id === "string" && typeof value.name === "string" && typeof value.path === "string";
        })
        .slice(0, 2)
    : [];

  return {
    version: 1,
    mode,
    monoColor: normalizeHexColor(candidate.monoColor),
    gradientColor1: normalizeHexColor(candidate.gradientColor1),
    gradientColor2: normalizeHexColor(candidate.gradientColor2, "#42369d"),
    gradientAngle: typeof candidate.gradientAngle === "number" ? clamp(candidate.gradientAngle, 0, 360) : 90,
    selectedImageId: typeof candidate.selectedImageId === "string" ? candidate.selectedImageId : null,
    uploadedImages,
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

function createExportCanvas(lines: string[], lineBreaks: LineBreak[]): HTMLCanvasElement {
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

  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`Could not export ${type}.`));
      },
      type,
      quality,
    );
  });
}

function sanitizePdfText(text: string): string {
  return text
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

async function createPdfBlob(lines: string[], lineBreaks: LineBreak[]): Promise<Blob> {
  if ("fonts" in document) await document.fonts.load(fontSpec);

  const measurementCanvas = document.createElement("canvas");
  const context = measurementCanvas.getContext("2d");
  if (!context) throw new Error("Could not create PDF measurement canvas.");

  const lineTops = getLineTops(lineBreaks, lines.length);
  const canvasTextScale = (exportCanvasWidth - exportCanvasMargin * 2) / FIGMA.printableWidth;
  const pdfScale = exportPdfWidth / exportCanvasWidth;
  const canvasFontSize = FIGMA.typeSize * canvasTextScale;
  const pdfFontSize = canvasFontSize * pdfScale;
  context.font = `${canvasFontSize}px "Special Elite", "Courier New", monospace`;
  context.textBaseline = "alphabetic";
  const metrics = context.measureText("H");
  const baselineOffset = (metrics.actualBoundingBoxAscent || canvasFontSize * 0.8) * pdfScale;
  const textCommands = lines
    .flatMap((line, lineIndex) => {
      const canvasY = exportCanvasMargin + (lineTops[lineIndex] ?? 0) * canvasTextScale;
      const y = exportPdfHeight - canvasY * pdfScale - baselineOffset;
      if (y < exportPdfMargin || y > exportPdfHeight - exportPdfMargin + pdfFontSize) return [];

      return Array.from(line).map((character, characterIndex) => {
        const prefix = line.slice(0, characterIndex);
        const canvasX = exportCanvasMargin + context.measureText(prefix).width;
        const x = canvasX * pdfScale;
        return `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${sanitizePdfText(character)}) Tj`;
      });
    })
    .join("\n");
  const stream = `0.929 0.886 0.816 rg\n0 0 ${exportPdfWidth} ${exportPdfHeight} re f\nBT\n0 0 0 rg\n/F1 ${pdfFontSize.toFixed(2)} Tf\n${textCommands}\nET`;
  const encoder = new TextEncoder();
  const chunks: BlobPart[] = [];
  const offsets = [0];
  let byteLength = 0;
  const appendString = (value: string) => {
    chunks.push(value);
    byteLength += encoder.encode(value).byteLength;
  };
  const addObject = (content: () => void) => {
    offsets.push(byteLength);
    appendString(`${offsets.length - 1} 0 obj\n`);
    content();
    appendString("\nendobj\n");
  };

  appendString("%PDF-1.4\n");
  addObject(() => appendString("<< /Type /Catalog /Pages 2 0 R >>"));
  addObject(() => appendString("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"));
  addObject(() =>
    appendString(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${exportPdfWidth} ${exportPdfHeight}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    ),
  );
  addObject(() => appendString("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>"));
  addObject(() => appendString(`<< /Length ${encoder.encode(stream).byteLength} >>\nstream\n${stream}\nendstream`));

  const xrefOffset = byteLength;
  appendString(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  offsets.slice(1).forEach((offset) => {
    appendString(`${String(offset).padStart(10, "0")} 00000 n \n`);
  });
  appendString(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return new Blob(chunks, { type: "application/pdf" });
}

async function createPngBlob(lines: string[], lineBreaks: LineBreak[]): Promise<Blob> {
  if ("fonts" in document) await document.fonts.load(fontSpec);

  const canvas = createExportCanvas(lines, lineBreaks);
  return canvasToBlob(canvas, "image/png");
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

function getUserDisplayName(currentUser: User): string {
  const metadata = currentUser.user_metadata ?? {};
  const metadataName =
    typeof metadata.display_name === "string"
      ? metadata.display_name
      : typeof metadata.full_name === "string"
        ? metadata.full_name
        : typeof metadata.name === "string"
          ? metadata.name
          : "";

  return metadataName.trim() || currentUser.email?.split("@")[0] || "User";
}

function getProfileInitials(displayName: string): string {
  const words = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "U";
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
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
  const [isSelectingPages, setIsSelectingPages] = useState(false);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(() => new Set());
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeletingPages, setIsDeletingPages] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("sign-in");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isGoogleAuthSubmitting, setIsGoogleAuthSubmitting] = useState(false);
  const [pendingAuthAction, setPendingAuthAction] = useState<PendingAuthAction>(null);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveStatusSource, setSaveStatusSource] = useState<SaveStatusSource>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("pdf");
  const [exportFileName, setExportFileName] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBackgroundOpen, setIsBackgroundOpen] = useState(false);
  const [backgroundTab, setBackgroundTab] = useState<BackgroundMode>("mono");
  const [backgroundSettings, setBackgroundSettings] = useState<BackgroundSettings>(defaultBackgroundSettings);
  const [draftBackgroundSettings, setDraftBackgroundSettings] =
    useState<BackgroundSettings>(defaultBackgroundSettings);
  const [colorPickerTarget, setColorPickerTarget] = useState<ColorPickerTarget>(null);
  const [isUploadingBackground, setIsUploadingBackground] = useState(false);
  const [isSavingBackground, setIsSavingBackground] = useState(false);
  const [backgroundMessage, setBackgroundMessage] = useState("");
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [onboardingStepIndex, setOnboardingStepIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [areStageAssetsReady, setAreStageAssetsReady] = useState(false);
  const [isStageMeasured, setIsStageMeasured] = useState(false);
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
  const carriageDragFrameRef = useRef<number | null>(null);
  const pageDragFrameRef = useRef<number | null>(null);
  const pendingCarriageColumnRef = useRef<number | null>(null);
  const pendingDragFeedRef = useRef<number | null>(null);
  const marginDingedRef = useRef(false);
  const saveTimeoutRef = useRef<number | null>(null);
  const keyPressAudioRef = useRef<HTMLAudioElement[]>([]);
  const dingAudioRef = useRef<HTMLAudioElement | null>(null);
  const newLineAudioRef = useRef<HTMLAudioElement | null>(null);
  const carriageDragAudioContextRef = useRef<AudioContext | null>(null);
  const carriageDragBufferRef = useRef<AudioBuffer | null>(null);
  const carriageDragSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const carriageDragLoopTimeoutRef = useRef<number | null>(null);
  const isCarriageDragAudioPlayingRef = useRef(false);
  const viewportRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const backgroundUploadInputRef = useRef<HTMLInputElement>(null);
  const { measure } = useSpecialEliteMeasure();

  const lineTops = useMemo(() => getLineTops(lineBreaks, lines.length), [lineBreaks, lines.length]);
  const userDisplayName = useMemo(() => (user ? getUserDisplayName(user) : ""), [user]);
  const profileInitials = useMemo(() => (user ? getProfileInitials(userDisplayName) : ""), [user, userDisplayName]);
  const orderedPages = useMemo(
    () =>
      [...pages].sort((firstPage, secondPage) => {
        const firstTime = firstPage.updatedAt ? Date.parse(firstPage.updatedAt) : 0;
        const secondTime = secondPage.updatedAt ? Date.parse(secondPage.updatedAt) : 0;
        return secondTime - firstTime;
      }),
    [pages],
  );
  const pageNumbersById = useMemo(() => {
    const orderedByCreation = [...pages].sort((firstPage, secondPage) => {
      const firstTime = Date.parse(firstPage.createdAt ?? firstPage.updatedAt ?? "");
      const secondTime = Date.parse(secondPage.createdAt ?? secondPage.updatedAt ?? "");
      return (Number.isNaN(firstTime) ? 0 : firstTime) - (Number.isNaN(secondTime) ? 0 : secondTime);
    });

    return new Map(orderedByCreation.map((page, index) => [page.id, index + 1]));
  }, [pages]);
  const currentLine = lines[currentLineIndex] ?? "";
  const currentAdvance = Math.min(measure(getLinePrefix(currentLine, cursorColumn)), maxAdvance);
  const carriageX = FIGMA.carriageRightX - currentAdvance;
  const feed = Math.min(dragFeed ?? lineTops[currentLineIndex] ?? 0, maxFeed);
  const paperTop = FIGMA.paperBottom - (FIGMA.initialPaperHeight + feed);
  const pageEndProgress = clamp((feed - (maxFeed - pageEndLiftRange)) / pageEndLiftRange, 0, 1);
  const paperBottom = FIGMA.paperBottom - maxPaperBottomLift * pageEndProgress;
  const textTop = FIGMA.textBaseTop - feed;
  const isStageReady = areStageAssetsReady && isStageMeasured;
  const selectedPageCount = selectedPageIds.size;
  const activeOnboardingStep = onboardingSteps[onboardingStepIndex];
  const shouldShowOnboarding =
    viewMode === "editor" &&
    isOnboardingOpen &&
    !isAuthOpen &&
    !isExportOpen &&
    !isDeleteConfirmOpen &&
    !isSettingsOpen &&
    !isBackgroundOpen;
  const isLastOnboardingStep = onboardingStepIndex === onboardingSteps.length - 1;
  const backgroundCss = getBackgroundCss(backgroundSettings);
  const draftBackgroundCss = getBackgroundCss(draftBackgroundSettings);
  const availableDraftBackgroundImages = getAvailableBackgroundImages(draftBackgroundSettings);
  const selectedBackgroundImage = availableDraftBackgroundImages.find(
    (image) => image.id === draftBackgroundSettings.selectedImageId,
  );
  const hasBackgroundSettingsChanges = useMemo(
    () =>
      JSON.stringify(createStoredBackgroundSettings(draftBackgroundSettings)) !==
      JSON.stringify(createStoredBackgroundSettings(backgroundSettings)),
    [backgroundSettings, draftBackgroundSettings],
  );
  const activePickerColor =
    colorPickerTarget === "mono"
      ? draftBackgroundSettings.monoColor
      : colorPickerTarget === "gradient-1"
        ? draftBackgroundSettings.gradientColor1
        : colorPickerTarget === "gradient-2"
          ? draftBackgroundSettings.gradientColor2
          : "#171337";
  const activePickerHsv = hexToHsv(activePickerColor);

  const updatePageSaveStatus = (status: SaveStatus) => {
    setSaveStatusSource(status === "idle" ? null : "page");
    setSaveStatus(status);
  };

  const updateBackgroundSaveStatus = (status: SaveStatus) => {
    setSaveStatusSource(status === "idle" ? null : "background");
    setSaveStatus(status);
  };

  const saveStatusLabel =
    saveStatus === "saving"
      ? saveStatusSource === "background"
        ? "Saving background..."
        : "Saving..."
      : saveStatus === "error"
        ? saveStatusSource === "background"
          ? "Background save failed"
          : "Save failed"
        : saveStatus === "saved"
          ? saveStatusSource === "background"
            ? "Background saved"
            : "Saved"
          : "";

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
      updatePageSaveStatus("idle");
      return;
    }

    const supabaseClient = supabase;
    let isCancelled = false;

    const loadPages = async () => {
      const { data, error } = await supabaseClient
        .from("pages")
        .select("id,title,document,created_at,updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      if (isCancelled) return;

      if (error) {
        updatePageSaveStatus("error");
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
            createdAt: page.created_at,
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
      updatePageSaveStatus(remotePages.length > 0 ? "saved" : "idle");
    };

    void loadPages();

    return () => {
      isCancelled = true;
    };
  }, [user]);

  useEffect(() => {
    let isCancelled = false;
    let stageFrame = 0;

    Promise.all(Object.values(ASSETS).map(preloadImageAsset))
      .catch(() => undefined)
      .then(() => {
        if (isCancelled) return;
        stageFrame = window.requestAnimationFrame(() => setAreStageAssetsReady(true));
      });

    return () => {
      isCancelled = true;
      if (stageFrame) window.cancelAnimationFrame(stageFrame);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("typewriter-view-mode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (user) return;
    const storedValue = window.localStorage.getItem("typewriter-background-settings");
    let storedSettings: StoredBackgroundSettings | null = null;

    try {
      storedSettings = storedValue ? readStoredBackgroundSettings(JSON.parse(storedValue)) : null;
    } catch {
      storedSettings = null;
    }

    if (!storedSettings) return;
    const selectedImageId = defaultBackgroundImages.some((image) => image.id === storedSettings.selectedImageId)
      ? storedSettings.selectedImageId
      : null;
    const nextSettings = {
      ...defaultBackgroundSettings,
      ...storedSettings,
      uploadedImages: [],
      selectedImageId,
      mode: storedSettings.mode === "image" && !selectedImageId ? "mono" : storedSettings.mode,
    };
    setBackgroundSettings(nextSettings);
    setDraftBackgroundSettings(nextSettings);
  }, [user]);

  useEffect(() => {
    if (!supabase || !user) return;

    const supabaseClient = supabase;
    let isCancelled = false;

    const loadBackgroundSettings = async () => {
      const { data, error } = await supabaseClient
        .from("profiles")
        .select("background_settings")
        .eq("id", user.id)
        .maybeSingle();

      if (isCancelled || error) return;
      const storedSettings = readStoredBackgroundSettings(data?.background_settings);
      if (!storedSettings) return;

      const uploadedImages = await Promise.all(
        storedSettings.uploadedImages.map(async (image) => {
          if (!image.path) return null;
          const { data: signedUrlData, error: signedUrlError } = await supabaseClient.storage
            .from(backgroundStorageBucket)
            .createSignedUrl(image.path, 60 * 60);

          if (signedUrlError || !signedUrlData?.signedUrl) return null;
          return {
            id: image.id,
            name: image.name,
            path: image.path,
            isUserUpload: true,
            url: signedUrlData.signedUrl,
          } satisfies BackgroundImageOption;
        }),
      );

      if (isCancelled) return;
      const availableImages = uploadedImages.filter(
        (image): image is Exclude<(typeof uploadedImages)[number], null> => image !== null,
      );
      const selectedImagePool = getAvailableBackgroundImages({
        ...defaultBackgroundSettings,
        ...storedSettings,
        uploadedImages: availableImages,
      });
      const selectedImageId = selectedImagePool.some((image) => image.id === storedSettings.selectedImageId)
        ? storedSettings.selectedImageId
        : null;
      const nextSettings = {
        ...defaultBackgroundSettings,
        ...storedSettings,
        uploadedImages: availableImages,
        selectedImageId,
        mode: storedSettings.mode === "image" && !selectedImageId ? "mono" : storedSettings.mode,
      };
      setBackgroundSettings(nextSettings);
      setDraftBackgroundSettings(nextSettings);
    };

    void loadBackgroundSettings();

    return () => {
      isCancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (viewMode === "grid") return;
    setIsSelectingPages(false);
    setSelectedPageIds(new Set());
    setIsDeleteConfirmOpen(false);
  }, [viewMode]);

  useEffect(() => {
    setSelectedPageIds((previousIds) => {
      const availableIds = new Set(pages.map((page) => page.id));
      const nextIds = new Set([...previousIds].filter((pageId) => availableIds.has(pageId)));
      return nextIds.size === previousIds.size ? previousIds : nextIds;
    });
  }, [pages]);

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

    const audioContext = new AudioContext();
    carriageDragAudioContextRef.current = audioContext;
    void fetch(AUDIO.carriageDrag)
      .then((response) => response.arrayBuffer())
      .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer))
      .then((buffer) => {
        carriageDragBufferRef.current = buffer;
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (viewMode !== "editor") return;

    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateScale = () => {
      const { width, height } = viewport.getBoundingClientRect();
      const nextScale = Math.min(width / FIGMA.frameWidth, height / FIGMA.frameHeight);
      setStageScale((currentScale) => (Math.abs(currentScale - nextScale) < 0.0001 ? currentScale : nextScale));
      setIsStageMeasured(true);
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
    if (isMuted) stopCarriageDragLoop();
  }, [isMuted]);

  useEffect(() => {
    return () => {
      if (releaseTimeoutRef.current) window.clearTimeout(releaseTimeoutRef.current);
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
      if (carriageDragFrameRef.current) window.cancelAnimationFrame(carriageDragFrameRef.current);
      if (pageDragFrameRef.current) window.cancelAnimationFrame(pageDragFrameRef.current);
      stopCarriageDragLoop();
      void carriageDragAudioContextRef.current?.close();
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
    if (cursorColumnRef.current === nextCursorColumn) return;
    cursorColumnRef.current = nextCursorColumn;
    setCursorColumn(nextCursorColumn);
  };

  const setDocumentLineIndex = (nextLineIndex: number) => {
    if (currentLineIndexRef.current === nextLineIndex) return;
    currentLineIndexRef.current = nextLineIndex;
    setCurrentLineIndex(nextLineIndex);
  };

  const setReadyNotice = () => {
    setNotice((currentNotice) => (currentNotice === "ready" ? currentNotice : "ready"));
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
    const updatedAt = new Date().toISOString();
    const existingPage = pages.find((page) => page.id === id);
    const pageSnapshot: SavedPage = {
      id,
      lines: [...currentLines],
      lineBreaks: normalizeLineBreaks(lineBreaksRef.current).map((lineBreak) => ({ ...lineBreak })),
      createdAt: existingPage?.createdAt ?? updatedAt,
      updatedAt,
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

    updatePageSaveStatus("saving");
    const { error } = await supabase.from("pages").upsert({
      id: page.id,
      user_id: currentUser.id,
      title: page.title ?? null,
      document: createStoredPageDocument(page.lines, page.lineBreaks),
      updated_at: new Date().toISOString(),
    });

    updatePageSaveStatus(error ? "error" : "saved");
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
    setIsAuthSubmitting(false);
    setIsGoogleAuthSubmitting(false);
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
    setIsAuthSubmitting(false);
    setIsGoogleAuthSubmitting(false);
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

    setIsGoogleAuthSubmitting(true);
    setAuthMessage("");

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
        },
      });

      if (error) setAuthMessage(error.message);
    } finally {
      setIsGoogleAuthSubmitting(false);
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
    updatePageSaveStatus("idle");
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
    if (!audio || isMuted) return;
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  };

  const scheduleCarriageDragLoopSegment = () => {
    const audioContext = carriageDragAudioContextRef.current;
    const buffer = carriageDragBufferRef.current;
    if (!audioContext || !buffer || isMuted || !isCarriageDragAudioPlayingRef.current) return;

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    carriageDragSourcesRef.current.add(source);
    source.onended = () => {
      carriageDragSourcesRef.current.delete(source);
      source.disconnect();
    };
    source.start();

    const nextStartDelay = Math.max(0.02, buffer.duration - carriageDragLoopOverlapSeconds);
    carriageDragLoopTimeoutRef.current = window.setTimeout(
      scheduleCarriageDragLoopSegment,
      nextStartDelay * 1000,
    );
  };

  const playCarriageDragLoop = () => {
    const audioContext = carriageDragAudioContextRef.current;
    const buffer = carriageDragBufferRef.current;
    if (!audioContext || !buffer || isMuted || isCarriageDragAudioPlayingRef.current) return;

    isCarriageDragAudioPlayingRef.current = true;
    void audioContext.resume().then(scheduleCarriageDragLoopSegment).catch(() => {
      isCarriageDragAudioPlayingRef.current = false;
    });
  };

  const stopCarriageDragLoop = () => {
    isCarriageDragAudioPlayingRef.current = false;
    if (carriageDragLoopTimeoutRef.current !== null) {
      window.clearTimeout(carriageDragLoopTimeoutRef.current);
      carriageDragLoopTimeoutRef.current = null;
    }

    carriageDragSourcesRef.current.forEach((source) => {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped sources can be ignored.
      }
      source.disconnect();
    });
    carriageDragSourcesRef.current.clear();
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
    setReadyNotice();
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

  const returnFromPageGrid = () => {
    setViewMode("editor");
    setIsExportOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const openSavedPage = (page: SavedPage) => {
    if (isSelectingPages) {
      setSelectedPageIds((previousIds) => {
        const nextIds = new Set(previousIds);
        if (nextIds.has(page.id)) {
          nextIds.delete(page.id);
        } else {
          nextIds.add(page.id);
        }
        return nextIds;
      });
      return;
    }

    setCurrentPageId(page.id);
    setDocumentLines([...page.lines]);
    setDocumentLineBreaks(page.lineBreaks.map((lineBreak) => ({ ...lineBreak })));
    const lastContentPosition = getLastContentPosition(page.lines);
    setDocumentLineIndex(lastContentPosition.lineIndex);
    setDocumentCursorColumn(lastContentPosition.cursorColumn);
    setDragFeed(null);
    marginDingedRef.current = false;
    setReadyNotice();
    setViewMode("editor");
    setIsExportOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const togglePageSelectionMode = () => {
    setIsSelectingPages((isSelecting) => {
      if (isSelecting) setSelectedPageIds(new Set());
      return !isSelecting;
    });
  };

  const requestDeleteSelectedPages = () => {
    if (selectedPageIds.size === 0) return;
    setIsDeleteConfirmOpen(true);
  };

  const closeDeleteConfirmModal = () => {
    if (isDeletingPages) return;
    setIsDeleteConfirmOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const confirmDeleteSelectedPages = async () => {
    const pageIdsToDelete = [...selectedPageIds];
    if (pageIdsToDelete.length === 0) return;

    const pageIdsToDeleteSet = new Set(pageIdsToDelete);
    const previousPages = pages;

    setIsDeletingPages(true);
    setPages((currentPages) => currentPages.filter((page) => !pageIdsToDeleteSet.has(page.id)));
    setSelectedPageIds(new Set());
    setIsSelectingPages(false);
    setIsDeleteConfirmOpen(false);

    if (currentPageId && pageIdsToDeleteSet.has(currentPageId)) {
      setCurrentPageId(null);
      resetDocument();
    }

    if (!supabase || !user) {
      setIsDeletingPages(false);
      return;
    }

    updatePageSaveStatus("saving");
    const { error } = await supabase.from("pages").delete().eq("user_id", user.id).in("id", pageIdsToDelete);
    if (error) {
      setPages(previousPages);
      setSelectedPageIds(pageIdsToDeleteSet);
      setIsSelectingPages(true);
      updatePageSaveStatus("error");
      setIsDeletingPages(false);
      return;
    }

    updatePageSaveStatus("saved");
    setIsDeletingPages(false);
  };

  const openExportModal = async () => {
    await saveCurrentPage();
    setIsExportOpen(true);
  };

  const closeExportModal = () => {
    setIsExportOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const openSettingsModal = () => {
    setIsSettingsOpen(true);
    setIsBackgroundOpen(false);
    setIsAccountOpen(false);
    setIsExportOpen(false);
    setIsOnboardingOpen(false);
  };

  const closeSettingsModal = () => {
    setIsSettingsOpen(false);
    setColorPickerTarget(null);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const openBackgroundModal = () => {
    setBackgroundTab(backgroundSettings.mode);
    setDraftBackgroundSettings(backgroundSettings);
    setIsBackgroundOpen(true);
    setIsSettingsOpen(false);
    setColorPickerTarget(null);
    setBackgroundMessage("");
  };

  const closeBackgroundModal = () => {
    setIsBackgroundOpen(false);
    setDraftBackgroundSettings(backgroundSettings);
    setColorPickerTarget(null);
    setBackgroundMessage("");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const returnToSettingsFromBackground = () => {
    setIsBackgroundOpen(false);
    setIsSettingsOpen(true);
    setDraftBackgroundSettings(backgroundSettings);
    setColorPickerTarget(null);
    setBackgroundMessage("");
  };

  const updateBackgroundColor = (target: ColorPickerTarget, color: string) => {
    const normalizedColor = normalizeHexColor(color);
    setDraftBackgroundSettings((currentSettings) => {
      if (target === "mono") return { ...currentSettings, monoColor: normalizedColor, mode: "mono" };
      if (target === "gradient-1") return { ...currentSettings, gradientColor1: normalizedColor, mode: "gradient" };
      if (target === "gradient-2") return { ...currentSettings, gradientColor2: normalizedColor, mode: "gradient" };
      return currentSettings;
    });
  };

  const updateColorFromPickerPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!colorPickerTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const saturation = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const value = clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1);
    updateBackgroundColor(colorPickerTarget, hsvToHex(activePickerHsv.h, saturation, value));
  };

  const startColorPickerDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateColorFromPickerPointer(event);
  };

  const updateColorPickerDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateColorFromPickerPointer(event);
  };

  const updateColorHue = (event: PointerEvent<HTMLDivElement>) => {
    if (!colorPickerTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const hue = clamp((event.clientX - rect.left) / rect.width, 0, 1) * 360;
    updateBackgroundColor(colorPickerTarget, hsvToHex(hue, activePickerHsv.s, activePickerHsv.v));
  };

  const startHueDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateColorHue(event);
  };

  const updateHueDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateColorHue(event);
  };

  const uploadBackgroundImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setBackgroundMessage("Choose a PNG or JPG image.");
      return;
    }

    if (!user || !supabase) {
      setBackgroundMessage("Sign in to store uploaded background images.");
      return;
    }

    const existingUploads = draftBackgroundSettings.uploadedImages.filter((image) => image.isUserUpload);
    if (existingUploads.length >= 2) {
      setBackgroundMessage("You can store up to two uploaded images.");
      return;
    }

    const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const id = createPageId();
    const path = `${user.id}/${id}.${extension}`;

    setIsUploadingBackground(true);
    setBackgroundMessage("");

    try {
      const { error: uploadError } = await supabase.storage
        .from(backgroundStorageBucket)
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;

      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from(backgroundStorageBucket)
        .createSignedUrl(path, 60 * 60);
      if (signedUrlError || !signedUrlData?.signedUrl) throw signedUrlError ?? new Error("Could not load uploaded image.");

      const imageOption: BackgroundImageOption = {
        id,
        name: file.name,
        path,
        url: signedUrlData.signedUrl,
        isUserUpload: true,
      };

      setDraftBackgroundSettings((currentSettings) => ({
        ...currentSettings,
        mode: "image",
        selectedImageId: id,
        uploadedImages: [...currentSettings.uploadedImages.filter((image) => image.isUserUpload).slice(0, 1), imageOption],
      }));
      setBackgroundTab("image");
    } catch (error) {
      setBackgroundMessage(error instanceof Error ? error.message : "Image upload failed.");
    } finally {
      setIsUploadingBackground(false);
    }
  };

  const removeBackgroundImage = async (image: BackgroundImageOption) => {
    if (image.path && supabase && user) {
      await supabase.storage.from(backgroundStorageBucket).remove([image.path]);
    }

    setDraftBackgroundSettings((currentSettings) => {
      const uploadedImages = currentSettings.uploadedImages.filter((currentImage) => currentImage.id !== image.id);
      const selectedImageId =
        currentSettings.selectedImageId === image.id ? (uploadedImages[0]?.id ?? null) : currentSettings.selectedImageId;
      return {
        ...currentSettings,
        uploadedImages,
        selectedImageId,
        mode: currentSettings.mode === "image" && !selectedImageId ? "mono" : currentSettings.mode,
      };
    });
  };

  const saveBackgroundSettings = async () => {
    if (!hasBackgroundSettingsChanges) return;

    const settingsToStore = createStoredBackgroundSettings(draftBackgroundSettings);
    let confirmedSettings = createBackgroundSettingsFromStored(
      settingsToStore,
      draftBackgroundSettings.uploadedImages,
    );

    if (supabase && user) {
      setIsSavingBackground(true);
      updateBackgroundSaveStatus("saving");

      try {
        const { data, error } = await supabase
          .from("profiles")
          .upsert({
            id: user.id,
            email: user.email,
            background_settings: settingsToStore,
            updated_at: new Date().toISOString(),
          })
          .select("background_settings")
          .eq("id", user.id)
          .maybeSingle();
        const confirmedStoredSettings = readStoredBackgroundSettings(data?.background_settings);

        if (error || !confirmedStoredSettings) {
          updateBackgroundSaveStatus("error");
          setIsSavingBackground(false);
          setBackgroundMessage(error?.message ?? "Could not confirm the saved background.");
          return;
        }

        if (!areStoredBackgroundSettingsEqual(settingsToStore, confirmedStoredSettings)) {
          updateBackgroundSaveStatus("error");
          setIsSavingBackground(false);
          setBackgroundMessage("Saved background did not match the selected background. Try again.");
          return;
        }

        confirmedSettings = createBackgroundSettingsFromStored(
          confirmedStoredSettings,
          draftBackgroundSettings.uploadedImages,
        );
        updateBackgroundSaveStatus("saved");
      } catch (error) {
        updateBackgroundSaveStatus("error");
        setBackgroundMessage(error instanceof Error ? error.message : "Background save failed.");
        return;
      } finally {
        setIsSavingBackground(false);
      }
    }

    window.localStorage.setItem("typewriter-background-settings", JSON.stringify(settingsToStore));
    setBackgroundSettings(confirmedSettings);
    setDraftBackgroundSettings(confirmedSettings);
    if (!supabase || !user) updateBackgroundSaveStatus("saved");
    setBackgroundMessage("");
    setIsBackgroundOpen(false);
    setColorPickerTarget(null);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const openOnboarding = () => {
    setOnboardingStepIndex(0);
    setIsOnboardingOpen(true);
    setIsAccountOpen(false);
    setIsExportOpen(false);
    setViewMode("editor");
  };

  const goToPreviousOnboardingStep = () => {
    setOnboardingStepIndex((currentIndex) => Math.max(0, currentIndex - 1));
  };

  const goToNextOnboardingStep = () => {
    setOnboardingStepIndex((currentIndex) => Math.min(onboardingSteps.length - 1, currentIndex + 1));
  };

  const closeOnboarding = () => {
    setIsOnboardingOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const exportCurrentPage = async () => {
    if (!user) {
      setIsExportOpen(false);
      openAuthModal("sign-in", "export");
      return;
    }

    setIsExporting(true);

    try {
      await saveCurrentPage();
      const currentLines = linesRef.current;
      const currentLineBreaks = lineBreaksRef.current;
      const blob =
        exportFormat === "pdf"
          ? await createPdfBlob(currentLines, currentLineBreaks)
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
    setReadyNotice();
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
    setReadyNotice();
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
    setReadyNotice();
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
    setReadyNotice();
  };

  const moveCursorRight = () => {
    const line = linesRef.current[currentLineIndexRef.current] ?? "";
    const cursor = cursorColumnRef.current;

    if (cursor < line.length) {
      setDocumentCursorColumn(cursor + 1);
      marginDingedRef.current = false;
      setReadyNotice();
      return;
    }

    addCharacter(" ");
  };

  const getCarriageColumnForClientX = (drag: CarriageDrag, clientX: number) => {
    const effectiveScale = stageScale * zoom || 1;
    const targetAdvance = clamp(drag.startAdvance - (clientX - drag.startClientX) / effectiveScale, 0, maxAdvance);
    const line = linesRef.current[currentLineIndexRef.current] ?? "";
    return getClosestCursorColumn(line, targetAdvance);
  };

  const commitPendingCarriageDrag = () => {
    carriageDragFrameRef.current = null;
    const nextColumn = pendingCarriageColumnRef.current;
    pendingCarriageColumnRef.current = null;
    if (nextColumn === null) return;

    setDocumentCursorColumn(nextColumn);
    marginDingedRef.current = false;
    setReadyNotice();
  };

  const scheduleCarriageDragCommit = (nextColumn: number) => {
    pendingCarriageColumnRef.current = nextColumn;
    if (carriageDragFrameRef.current !== null) return;
    carriageDragFrameRef.current = window.requestAnimationFrame(commitPendingCarriageDrag);
  };

  const cancelPendingCarriageDrag = () => {
    if (carriageDragFrameRef.current !== null) {
      window.cancelAnimationFrame(carriageDragFrameRef.current);
      carriageDragFrameRef.current = null;
    }
    pendingCarriageColumnRef.current = null;
  };

  const getPageFeedForClientY = (drag: PageDrag, clientY: number) => {
    const effectiveScale = stageScale * zoom || 1;
    return clamp(drag.startFeed - (clientY - drag.startClientY) / effectiveScale, 0, maxFeed);
  };

  const commitPendingPageDrag = () => {
    pageDragFrameRef.current = null;
    const nextFeed = pendingDragFeedRef.current;
    pendingDragFeedRef.current = null;
    if (nextFeed === null) return;

    setDragFeed((currentFeed) => {
      if (currentFeed !== null && Math.abs(currentFeed - nextFeed) < 0.5) return currentFeed;
      return nextFeed;
    });
    setReadyNotice();
  };

  const schedulePageDragCommit = (nextFeed: number) => {
    pendingDragFeedRef.current = nextFeed;
    if (pageDragFrameRef.current !== null) return;
    pageDragFrameRef.current = window.requestAnimationFrame(commitPendingPageDrag);
  };

  const cancelPendingPageDrag = () => {
    if (pageDragFrameRef.current !== null) {
      window.cancelAnimationFrame(pageDragFrameRef.current);
      pageDragFrameRef.current = null;
    }
    pendingDragFeedRef.current = null;
  };

  const startCarriageDrag = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("[data-page-surface]")) return;

    event.preventDefault();
    cancelPendingCarriageDrag();
    event.currentTarget.setPointerCapture(event.pointerId);
    carriageDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startAdvance: measure(getLinePrefix(linesRef.current[currentLineIndexRef.current] ?? "", cursorColumnRef.current)),
      hasMoved: false,
    };
    setIsCarriageDragging(true);
    inputRef.current?.focus();
  };

  const updateCarriageDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = carriageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    if (!drag.hasMoved && Math.abs(event.clientX - drag.startClientX) > 1) {
      drag.hasMoved = true;
      playCarriageDragLoop();
    }
    scheduleCarriageDragCommit(getCarriageColumnForClientX(drag, event.clientX));
  };

  const finishCarriageDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = carriageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    carriageDragRef.current = null;
    cancelPendingCarriageDrag();
    stopCarriageDragLoop();
    setDocumentCursorColumn(getCarriageColumnForClientX(drag, event.clientX));
    setIsCarriageDragging(false);
    fillCurrentLineToCursor();
    inputRef.current?.focus();
  };

  const startPageDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    cancelPendingPageDrag();
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
    schedulePageDragCommit(getPageFeedForClientY(drag, event.clientY));
  };

  const finishPageDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = pageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    cancelPendingPageDrag();
    const targetFeed = getPageFeedForClientY(drag, event.clientY);
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
    if (isExportOpen || isDeleteConfirmOpen || isSettingsOpen || isBackgroundOpen) {
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
  const renderColorPickerPanel = (target: Exclude<ColorPickerTarget, null>) =>
    colorPickerTarget === target ? (
      <section className="background-editor-section color-picker-section" aria-label="Custom color picker">
        <div className="color-picker-header">
          <h3>Custom Color</h3>
          <button className="color-picker-close-button" type="button" onClick={() => setColorPickerTarget(null)} aria-label="Close color picker">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6.4 5 12.6 12.6-1.4 1.4L5 6.4 6.4 5Zm12.6 1.4L6.4 19 5 17.6 17.6 5 19 6.4Z" />
            </svg>
          </button>
        </div>
        <div
          className="color-field"
          style={{ backgroundColor: `hsl(${activePickerHsv.h} 100% 50%)` }}
          onPointerDown={startColorPickerDrag}
          onPointerMove={updateColorPickerDrag}
        >
          <span
            className="color-field-thumb"
            style={{
              left: `${activePickerHsv.s * 100}%`,
              top: `${(1 - activePickerHsv.v) * 100}%`,
            }}
          />
        </div>
        <div className="hue-slider" onPointerDown={startHueDrag} onPointerMove={updateHueDrag}>
          <span className="hue-thumb" style={{ left: `${(activePickerHsv.h / 360) * 100}%` }} />
        </div>
      </section>
    ) : null;

  return (
    <main
      className="app-shell"
      style={{ background: backgroundCss }}
      onPointerDown={() =>
        viewMode === "editor" &&
        !isExportOpen &&
        !isSettingsOpen &&
        !isBackgroundOpen &&
        inputRef.current?.focus()
      }
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
          <button
            className="glass-button icon-button home-menu-button"
            type="button"
            onClick={viewMode === "grid" ? returnFromPageGrid : openPageGrid}
            aria-label={viewMode === "grid" ? "Return to current page" : "Home"}
          >
            {viewMode === "grid" ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 11v2H7.8l5.6 5.6L12 20 4 12l8-8 1.4 1.4L7.8 11H20Z" />
              </svg>
            ) : (
              <img className="menu-home-icon" src={ASSETS.menuHomeRounded} alt="" aria-hidden="true" />
            )}
          </button>
          {viewMode === "editor" ? (
            <>
              <button
                className="glass-button icon-button menu-settings-button"
                type="button"
                onClick={(event) => {
                  event.currentTarget.blur();
                  openSettingsModal();
                }}
                aria-label="Open settings"
                aria-expanded={isSettingsOpen || isBackgroundOpen}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M19.4 13.5c.08-.48.1-.98.1-1.5s-.02-1.02-.1-1.5l2-1.55-2-3.46-2.35.95c-.78-.6-1.44-.98-2.25-1.28L14.45 2h-4l-.35 3.16c-.81.3-1.55.72-2.25 1.28L5.5 5.49l-2 3.46 2 1.55c-.08.48-.1.98-.1 1.5s.02 1.02.1 1.5l-2 1.55 2 3.46 2.35-.95c.7.56 1.44.98 2.25 1.28l.35 3.16h4l.35-3.16c.81-.3 1.47-.68 2.25-1.28l2.35.95 2-3.46-2-1.55ZM12.45 15.5A3.5 3.5 0 1 1 12.45 8a3.5 3.5 0 0 1 0 7.5Z" />
                </svg>
              </button>
              <button
                className="glass-button icon-button menu-sound-button"
                type="button"
                onClick={(event) => {
                  event.currentTarget.blur();
                  setIsMuted((muted) => !muted);
                }}
                aria-label={isMuted ? "Unmute sounds" : "Mute sounds"}
                aria-pressed={isMuted}
              >
                {isMuted ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 9v6h4l5 4V5L8 9H4Z" />
                    <path d="M18.8 5.8 5.8 18.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 3c0-1.77-1-3.29-2.5-4.03v8.06c1.5-.74 2.5-2.26 2.5-4.03Zm-2.5-8.6v2.06c2.89.86 5 3.54 5 6.54s-2.11 5.68-5 6.54v2.06c4.01-.91 7-4.49 7-8.6s-2.99-7.69-7-8.6Z" />
                  </svg>
                )}
              </button>
              <button
                className="glass-button icon-button menu-help-button"
                type="button"
                onClick={(event) => {
                  event.currentTarget.blur();
                  openOnboarding();
                }}
                aria-label="Open tutorial"
              >
                ?
              </button>
            </>
          ) : null}
          {user ? (
            <span className={`save-status save-status-${saveStatus}`}>
              {saveStatusLabel}
            </span>
          ) : null}
        </div>
        <div className="menu-cluster account-cluster">
          {viewMode === "grid" ? (
            <div className="grid-action-cluster">
              {isSelectingPages ? (
                <button
                  className="glass-button delete-pages-button"
                  type="button"
                  onClick={requestDeleteSelectedPages}
                  disabled={selectedPageCount === 0}
                >
                  Delete {selectedPageCount > 0 ? selectedPageCount : ""}
                </button>
              ) : null}
              <button
                className={`glass-button text-button multi-select-button ${isSelectingPages ? "is-active" : ""}`}
                type="button"
                onClick={togglePageSelectionMode}
                aria-pressed={isSelectingPages}
              >
                {isSelectingPages ? "Cancel" : "Select"}
              </button>
            </div>
          ) : null}
          {viewMode === "editor" ? (
            <button className="glass-button export-menu-button" type="button" onClick={openExportModal}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3v10.2l3.6-3.6L17 11l-6 6-6-6 1.4-1.4 3.6 3.6V3h2Zm-7 14h2v2h10v-2h2v4H5v-4Z" />
              </svg>
              Export
            </button>
          ) : null}
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
                <span>{profileInitials}</span>
              </button>
              {isAccountOpen ? (
                <section className="account-popover" aria-label="Account settings">
                  <span className="account-label">Signed in as</span>
                  <strong>{userDisplayName}</strong>
                  <span className="account-label">{user.email}</span>
                  <button className="glass-button text-button" type="button" onClick={handleSignOut}>
                    Sign Out
                  </button>
                </section>
              ) : null}
            </div>
          ) : (
            <button
              className="glass-button icon-button signed-out-account-button"
              type="button"
              onClick={() => openAuthModal("sign-in")}
              aria-label="Sign in"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 12.5c2.49 0 4.5-2.01 4.5-4.5S14.49 3.5 12 3.5 7.5 5.51 7.5 8s2.01 4.5 4.5 4.5Zm0 2c-3 0-7 1.5-7 4.45V21h14v-2.05c0-2.95-4-4.45-7-4.45Z" />
              </svg>
            </button>
          )}
        </div>
      </nav>

      {viewMode === "grid" ? (
        <section className="page-grid-view" aria-label="Saved pages">
          <div className="page-grid">
            <button className="new-page-card" type="button" onClick={startNewPage}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 3h7.6L19 7.4V21H7V3Zm7 1.8V8h3.2L14 4.8ZM9 5v14h8V10h-5V5H9Zm3 7h2v2h2v2h-2v2h-2v-2h-2v-2h2v-2Z" />
              </svg>
              <span>New Page</span>
            </button>
            {orderedPages.map((page) => {
              const isSelected = selectedPageIds.has(page.id);
              const pageNumber = pageNumbersById.get(page.id) ?? 1;

              return (
                <button
                  className={`page-preview ${isSelectingPages ? "is-selecting" : ""} ${isSelected ? "is-selected" : ""}`}
                  type="button"
                  key={page.id}
                  onClick={() => openSavedPage(page)}
                  aria-pressed={isSelectingPages ? isSelected : undefined}
                  aria-label={isSelectingPages ? `${isSelected ? "Deselect" : "Select"} page ${pageNumber}` : `Open page ${pageNumber}`}
                >
                  {isSelectingPages ? (
                    <span className="page-selection-mark" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path d="m9.4 16.2-3.6-3.6L4.4 14l5 5L20 8.4 18.6 7 9.4 16.2Z" />
                      </svg>
                    </span>
                  ) : null}
                  <span className="page-preview-content">{page.lines.join("\n")}</span>
                  <span className="page-preview-label">Page {pageNumber}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <section
          ref={viewportRef}
          className={`machine-viewport ${isStageReady ? "is-stage-ready" : ""}`}
          aria-label="Interactive typewriter"
        >
          <div
            className="machine-stage"
            style={{ transform: `translateX(-50%) scale(${stageScale * zoom * (isStageReady ? 1 : 0.5)})` }}
          >
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

      {shouldShowOnboarding && activeOnboardingStep ? (
        <div className="onboarding-layer" aria-live="polite">
          <section
            className={`onboarding-card onboarding-card-${activeOnboardingStep.placement}`}
            aria-label="Getting started"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button className="onboarding-close-button" type="button" onClick={closeOnboarding} aria-label="Close tutorial">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6.4 5 12.6 12.6-1.4 1.4L5 6.4 6.4 5Zm12.6 1.4L6.4 19 5 17.6 17.6 5 19 6.4Z" />
              </svg>
            </button>
            <span className="onboarding-step-count">
              {onboardingStepIndex + 1} / {onboardingSteps.length}
            </span>
            <h2>{activeOnboardingStep.title}</h2>
            <p>{activeOnboardingStep.description}</p>
            <div className="onboarding-actions">
              <button
                className="glass-button text-button"
                type="button"
                onClick={goToPreviousOnboardingStep}
                disabled={onboardingStepIndex === 0}
              >
                Previous
              </button>
              {isLastOnboardingStep ? (
                <button className="glass-button text-button onboarding-primary-action" type="button" onClick={closeOnboarding}>
                  Close
                </button>
              ) : (
                <button className="glass-button text-button onboarding-primary-action" type="button" onClick={goToNextOnboardingStep}>
                  Next
                </button>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {isSettingsOpen ? (
        <div className="export-overlay settings-overlay" onPointerDown={closeSettingsModal}>
          <section
            className="export-modal settings-modal"
            aria-label="Settings"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="export-modal-header">
              <h2>Settings</h2>
              <button className="glass-button icon-button" type="button" onClick={closeSettingsModal} aria-label="Close settings">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6.4 5 12.6 12.6-1.4 1.4L5 6.4 6.4 5Zm12.6 1.4L6.4 19 5 17.6 17.6 5 19 6.4Z" />
                </svg>
              </button>
            </div>

            <div className="settings-content">
              <section className="settings-section" aria-label="View settings">
                <h3>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 5c5.2 0 8.4 5.1 8.9 6l.4.8-.4.8c-.5.9-3.7 6-8.9 6s-8.4-5.1-8.9-6l-.4-.8.4-.8c.5-.9 3.7-6 8.9-6Zm0 2c-3.9 0-6.5 3.8-7.2 4.8.7 1.1 3.3 4.8 7.2 4.8s6.5-3.8 7.2-4.8C18.5 10.8 15.9 7 12 7Zm0 2.2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Z" />
                  </svg>
                  View
                </h3>
                <div className="settings-row">
                  <span>Background</span>
                  <button className="background-chip" type="button" onClick={openBackgroundModal} aria-label="Edit background">
                    <span style={{ background: backgroundCss }} />
                  </button>
                </div>
                <div className="settings-row">
                  <span>Zoom</span>
                  <span className="select-shell settings-select">
                    <span className="select-value">
                      {zoom === 1.5 ? "1x" : zoom === 1 ? "0.5x" : zoom === 1.25 ? "0.75x" : zoom === 1.75 ? "1.25x" : "1.5x"}
                    </span>
                    <select value={zoom} onChange={handleZoomChange} aria-label="Zoom">
                      <option value={1}>0.5x</option>
                      <option value={1.25}>0.75x</option>
                      <option value={1.5}>1x</option>
                      <option value={1.75}>1.25x</option>
                      <option value={2}>1.5x</option>
                    </select>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m7 9 5 5 5-5H7Z" />
                    </svg>
                  </span>
                </div>
              </section>

              <section className="settings-section" aria-label="Page settings">
                <h3>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 2h9l5 5v15H6V2Zm8 2H8v16h10V8h-4V4Zm-3 7h5v2h-5v-2Zm0 4h5v2h-5v-2Z" />
                  </svg>
                  Page
                </h3>
                <div className="settings-row">
                  <span>Line Spacing</span>
                  <span className="select-shell settings-select">
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
                </div>
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {isBackgroundOpen ? (
        <div className="export-overlay settings-overlay" onPointerDown={closeBackgroundModal}>
          <section
            className={`export-modal background-modal ${colorPickerTarget ? "is-picking-color" : ""}`}
            aria-label="Background settings"
            onPointerDown={(event) => {
              event.stopPropagation();
              if (
                colorPickerTarget &&
                event.target instanceof HTMLElement &&
                !event.target.closest(".color-picker-section, .color-picker-anchor")
              ) {
                setColorPickerTarget(null);
              }
            }}
          >
            <div className="export-modal-header">
              <div className="modal-title-with-back">
                <button className="glass-button icon-button" type="button" onClick={returnToSettingsFromBackground} aria-label="Back to settings">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 11v2H7.8l5.6 5.6L12 20 4 12l8-8 1.4 1.4L7.8 11H20Z" />
                  </svg>
                </button>
                <h2>Background</h2>
              </div>
              <button className="glass-button icon-button" type="button" onClick={closeBackgroundModal} aria-label="Close background settings">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6.4 5 12.6 12.6-1.4 1.4L5 6.4 6.4 5Zm12.6 1.4L6.4 19 5 17.6 17.6 5 19 6.4Z" />
                </svg>
              </button>
            </div>

            <div className="background-tabs" role="tablist" aria-label="Background mode">
              {(["mono", "gradient", "image"] as BackgroundMode[]).map((mode) => (
                <button
                  key={mode}
                  className={backgroundTab === mode ? "is-active" : ""}
                  type="button"
                  onClick={() => {
                    setBackgroundTab(mode);
                    setDraftBackgroundSettings((currentSettings) => ({
                      ...currentSettings,
                      mode,
                      selectedImageId:
                        mode === "image" && !currentSettings.selectedImageId
                          ? defaultBackgroundImages[0]?.id ?? null
                          : currentSettings.selectedImageId,
                    }));
                    setColorPickerTarget(null);
                  }}
                >
                  {mode === "mono" ? "Mono" : mode === "gradient" ? "Gradient" : "Image"}
                </button>
              ))}
            </div>

            <div className="background-modal-scroll">
              <section className="background-editor-section" aria-label="Background preview">
                <h3>Preview</h3>
                <div className="background-preview-card">
                  <div className="background-preview-fill" style={{ background: draftBackgroundCss }} />
                  <img className="background-preview-typewriter" src={ASSETS.typewriterTemplate} alt="" aria-hidden="true" />
                </div>
              </section>

              {backgroundTab === "mono" ? (
                <section className="background-editor-section" aria-label="Mono background colors">
                  <h3>Colors</h3>
                  <div className="color-swatches">
                    {monoSwatches.map((color) => (
                      <button
                        key={color}
                        className={`color-swatch ${normalizeHexColor(draftBackgroundSettings.monoColor) === color ? "is-active" : ""}`}
                        type="button"
                        onClick={() => updateBackgroundColor("mono", color)}
                        aria-label={`Use ${getHexLabel(color)} background`}
                      >
                        <span style={{ background: color }} />
                      </button>
                    ))}
                  </div>
                  <div className="settings-row">
                    <span>Custom color</span>
                    <span className="color-picker-anchor">
                      {renderColorPickerPanel("mono")}
                      <button className="color-value-button" type="button" onClick={() => setColorPickerTarget(colorPickerTarget === "mono" ? null : "mono")}>
                        <span>{getHexLabel(draftBackgroundSettings.monoColor)}</span>
                        <i style={{ background: draftBackgroundSettings.monoColor }} />
                      </button>
                    </span>
                  </div>
                </section>
              ) : null}

              {backgroundTab === "gradient" ? (
                <section className="background-editor-section" aria-label="Gradient background colors">
                  <h3>Colors</h3>
                  <div className="settings-row">
                    <span>Gradient Orientation</span>
                    <label className="angle-input-shell">
                      <input
                        type="number"
                        min={0}
                        max={360}
                        value={draftBackgroundSettings.gradientAngle}
                        onChange={(event) =>
                          setDraftBackgroundSettings((currentSettings) => ({
                            ...currentSettings,
                            gradientAngle: clamp(Number(event.target.value), 0, 360),
                            mode: "gradient",
                          }))
                        }
                        aria-label="Gradient orientation"
                      />
                      <span>°</span>
                    </label>
                  </div>
                  <div className="settings-row">
                    <span>Color 1</span>
                    <span className="color-picker-anchor">
                      {renderColorPickerPanel("gradient-1")}
                      <button className="color-value-button" type="button" onClick={() => setColorPickerTarget(colorPickerTarget === "gradient-1" ? null : "gradient-1")}>
                        <span>{getHexLabel(draftBackgroundSettings.gradientColor1)}</span>
                        <i style={{ background: draftBackgroundSettings.gradientColor1 }} />
                      </button>
                    </span>
                  </div>
                  <div className="settings-row">
                    <span>Color 2</span>
                    <span className="color-picker-anchor">
                      {renderColorPickerPanel("gradient-2")}
                      <button className="color-value-button" type="button" onClick={() => setColorPickerTarget(colorPickerTarget === "gradient-2" ? null : "gradient-2")}>
                        <span>{getHexLabel(draftBackgroundSettings.gradientColor2)}</span>
                        <i style={{ background: draftBackgroundSettings.gradientColor2 }} />
                      </button>
                    </span>
                  </div>
                </section>
              ) : null}

              {backgroundTab === "image" ? (
                <section className="background-editor-section" aria-label="Image backgrounds">
                  <h3>Images</h3>
                  <input
                    ref={backgroundUploadInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg"
                    className="hidden-file-input"
                    onChange={uploadBackgroundImage}
                  />
                  <div className="image-grid">
                    <button
                      className="image-upload-card"
                      type="button"
                      onClick={() => backgroundUploadInputRef.current?.click()}
                      disabled={isUploadingBackground || draftBackgroundSettings.uploadedImages.filter((image) => image.isUserUpload).length >= 2}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M11 16V7.8l-3.2 3.2L6.4 9.6 12 4l5.6 5.6-1.4 1.4L13 7.8V16h-2Zm-6 2h14v2H5v-2Z" />
                      </svg>
                      <strong>{isUploadingBackground ? "Uploading..." : "Upload Image"}</strong>
                      <span>.PNG, .jpg</span>
                    </button>
                    {availableDraftBackgroundImages.map((image) => (
                      <div
                        key={image.id}
                        className={`image-choice ${draftBackgroundSettings.selectedImageId === image.id ? "is-active" : ""}`}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setDraftBackgroundSettings((currentSettings) => ({
                              ...currentSettings,
                              mode: "image",
                              selectedImageId: image.id,
                            }))
                          }
                          aria-label={`Use ${image.name} background`}
                        >
                          <img src={image.url} alt="" />
                        </button>
                        {image.isUserUpload ? (
                          <button className="image-remove-button" type="button" onClick={() => void removeBackgroundImage(image)} aria-label={`Remove ${image.name}`}>
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="m6.4 5 12.6 12.6-1.4 1.4L5 6.4 6.4 5Zm12.6 1.4L6.4 19 5 17.6 17.6 5 19 6.4Z" />
                            </svg>
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {backgroundMessage ? <p className="background-message">{backgroundMessage}</p> : null}
                </section>
              ) : null}
            </div>

            {backgroundTab !== "image" && backgroundMessage ? <p className="background-message">{backgroundMessage}</p> : null}
            {backgroundTab === "image" && selectedBackgroundImage ? (
              <p className="background-message">Selected: {selectedBackgroundImage.name}</p>
            ) : null}
            <button
              className="export-submit background-save-button"
              type="button"
              onClick={saveBackgroundSettings}
              disabled={!hasBackgroundSettingsChanges || isSavingBackground}
            >
              {isSavingBackground ? "Saving..." : "Confirm"}
            </button>
          </section>
        </div>
      ) : null}

      {isAuthOpen ? (
        <div className="export-overlay auth-overlay" onPointerDown={closeAuthModal}>
          <section className="export-modal auth-modal" aria-label="Sign in" onPointerDown={(event) => event.stopPropagation()}>
            <div className="export-modal-header">
              <h2>{authMode === "sign-in" ? "Sign In" : "Sign Up"}</h2>
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
                Sign Up
              </button>
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
                {isAuthSubmitting ? "Working..." : authMode === "sign-in" ? "Sign In" : "Sign Up"}
              </button>
            </form>

            <div className="auth-divider">
              <span>or</span>
            </div>

            <button
              className="oauth-button"
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isGoogleAuthSubmitting || isAuthSubmitting || !isSupabaseConfigured}
            >
              <img className="google-signin-mark" src={ASSETS.googleSignInMark} alt="" aria-hidden="true" />
              {isGoogleAuthSubmitting
                ? "Opening Google..."
                : authMode === "sign-in"
                  ? "Sign in with Google"
                  : "Sign up with Google"}
            </button>
          </section>
        </div>
      ) : null}

      {isDeleteConfirmOpen ? (
        <div className="export-overlay" onPointerDown={closeDeleteConfirmModal}>
          <section
            className="export-modal delete-confirm-modal"
            aria-label="Confirm page deletion"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="export-modal-header">
              <h2>Delete Pages</h2>
              <button
                className="glass-button icon-button"
                type="button"
                onClick={closeDeleteConfirmModal}
                aria-label="Close"
                disabled={isDeletingPages}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6.4 5 12.6 12.6-1.4 1.4L5 6.4 6.4 5Zm12.6 1.4L6.4 19 5 17.6 17.6 5 19 6.4Z" />
                </svg>
              </button>
            </div>
            <p className="delete-confirm-copy">
              Confirming delete will permanently remove {selectedPageCount === 1 ? "this page" : "these pages"} from
              your account and cannot be undone.
            </p>
            <div className="delete-confirm-actions">
              <button className="glass-button text-button" type="button" onClick={closeDeleteConfirmModal} disabled={isDeletingPages}>
                Cancel
              </button>
              <button className="glass-button text-button danger-button" type="button" onClick={confirmDeleteSelectedPages} disabled={isDeletingPages}>
                {isDeletingPages ? "Deleting..." : "Delete Forever"}
              </button>
            </div>
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
              <button className="glass-button icon-button" type="button" onClick={closeExportModal} aria-label="Close">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6.4 5 12.6 12.6-1.4 1.4L5 6.4 6.4 5Zm12.6 1.4L6.4 19 5 17.6 17.6 5 19 6.4Z" />
                </svg>
              </button>
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

            <div className="export-actions">
              <span className="select-shell export-format-select">
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
              <button className="export-submit" type="button" onClick={exportCurrentPage} disabled={isExporting}>
                {isExporting ? "Exporting..." : "Export"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default App;
