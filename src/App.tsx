import { ChangeEvent, ClipboardEvent, CSSProperties, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

const FIGMA = {
  frameWidth: 4621,
  frameHeight: 2894,
  carriageRightX: 1367,
  carriageLeftX: 69,
  maxPaperHeight: 1852,
  initialPaperHeight: 560,
  lineHeight: 39,
  typeSize: 33,
  paperBottom: 2607,
  paperWidth: 1672,
  textInsetX: 1002,
  textBaseTop: 2350,
  cursorX: 2369,
  cursorY: 2350,
};

const maxAdvance = FIGMA.carriageRightX - FIGMA.carriageLeftX;
const maxFeed = FIGMA.maxPaperHeight - FIGMA.initialPaperHeight;
const fontSpec = `${FIGMA.typeSize}px "Special Elite", "Courier New", monospace`;
const slugTransitionMs = 90;
const lineSpace = FIGMA.lineHeight - FIGMA.typeSize;

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
type LineBreak = {
  afterLineIndex: number;
  spacing: LineSpacing;
  advance: number;
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
  return FIGMA.typeSize + lineSpace * spacing;
}

function getLineTops(lineBreaks: LineBreak[], lineCount: number): number[] {
  const tops = [0];

  for (let index = 1; index < lineCount; index += 1) {
    tops[index] = tops[index - 1] + (lineBreaks[index - 1]?.advance ?? getLineAdvance(1));
  }

  return tops;
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
  const [notice, setNotice] = useState<Notice>("ready");
  const [activeSlugId, setActiveSlugId] = useState<number | null>(null);
  const [isSlugPressed, setIsSlugPressed] = useState(false);
  const [stageScale, setStageScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [lineSpacing, setLineSpacing] = useState<LineSpacing>(1);
  const [cursorColumn, setCursorColumn] = useState(0);
  const releaseTimeoutRef = useRef<number | null>(null);
  const linesRef = useRef(lines);
  const lineBreaksRef = useRef(lineBreaks);
  const cursorColumnRef = useRef(cursorColumn);
  const marginDingedRef = useRef(false);
  const keyPressAudioRef = useRef<HTMLAudioElement[]>([]);
  const dingAudioRef = useRef<HTMLAudioElement | null>(null);
  const newLineAudioRef = useRef<HTMLAudioElement | null>(null);
  const viewportRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { measure } = useSpecialEliteMeasure();

  const lineTops = useMemo(() => getLineTops(lineBreaks, lines.length), [lineBreaks, lines.length]);
  const currentLineIndex = lines.length - 1;
  const currentLine = lines[currentLineIndex] ?? "";
  const currentAdvance = Math.min(measure(currentLine.slice(0, cursorColumn)), maxAdvance);
  const carriageX = FIGMA.carriageRightX - currentAdvance;
  const feed = Math.min(lineTops[currentLineIndex] ?? 0, maxFeed);
  const paperTop = FIGMA.paperBottom - (FIGMA.initialPaperHeight + feed);
  const textTop = FIGMA.textBaseTop - feed;
  const typedText = lines.join("\n");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
  }, []);

  useEffect(() => {
    if (notice === "ready") return;
    const timeout = window.setTimeout(() => setNotice("ready"), 700);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    return () => {
      if (releaseTimeoutRef.current) window.clearTimeout(releaseTimeoutRef.current);
    };
  }, []);

  const setDocumentLines = (nextLines: string[]) => {
    linesRef.current = nextLines;
    setLines(nextLines);
  };

  const setDocumentLineBreaks = (nextLineBreaks: LineBreak[]) => {
    lineBreaksRef.current = nextLineBreaks;
    setLineBreaks(nextLineBreaks);
  };

  const setDocumentCursorColumn = (nextCursorColumn: number) => {
    cursorColumnRef.current = nextCursorColumn;
    setCursorColumn(nextCursorColumn);
  };

  const setCurrentLine = (line: string, nextCursorColumn: number) => {
    const next = [...linesRef.current];
    next[next.length - 1] = line;
    setDocumentLines(next);
    setDocumentCursorColumn(nextCursorColumn);
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
    setDocumentCursorColumn(0);
    marginDingedRef.current = false;
    setNotice("ready");
    inputRef.current?.focus();
  };

  const addReturn = () => {
    const previous = linesRef.current;
    const previousLineBreaks = lineBreaksRef.current;
    const line = previous[previous.length - 1] ?? "";
    const advance = getLineAdvance(lineSpacing);
    const currentFeed = getLineTops(previousLineBreaks, previous.length)[previous.length - 1] ?? 0;

    if (currentFeed + advance > maxFeed) {
      setNotice("page-end");
      return false;
    }

    if (shouldPlayReturnSound(line, cursorColumnRef.current)) playNewLine();
    setNotice("ready");
    setDocumentLines([...previous, ""]);
    setDocumentLineBreaks([
      ...previousLineBreaks,
      {
        afterLineIndex: previous.length - 1,
        spacing: lineSpacing,
        advance,
      },
    ]);
    setDocumentCursorColumn(0);
    marginDingedRef.current = false;
    return true;
  };

  const addCharacter = (character: string) => {
    const previous = linesRef.current;
    const index = previous.length - 1;
    const line = previous[index] ?? "";
    const cursor = cursorColumnRef.current;
    const candidate = `${line.slice(0, cursor)}${character}${line.slice(cursor + 1)}`;
    const nextCursor = cursor + 1;

    if (measure(candidate.slice(0, nextCursor)) > maxAdvance) {
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
    const index = next.length - 1;
    const line = next[index] ?? "";
    const cursor = cursorColumnRef.current;

    if (cursor > 0) {
      next[index] = `${line.slice(0, cursor - 1)}${line.slice(cursor)}`;
      setDocumentLines(next);
      setDocumentCursorColumn(cursor - 1);
    } else if (next.length > 1) {
      next.pop();
      setDocumentLines(next);
      setDocumentLineBreaks(lineBreaksRef.current.slice(0, -1));
      setDocumentCursorColumn(next[next.length - 1]?.length ?? 0);
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
    const line = linesRef.current[linesRef.current.length - 1] ?? "";
    const cursor = cursorColumnRef.current;

    if (cursor < line.length) {
      setDocumentCursorColumn(cursor + 1);
      marginDingedRef.current = false;
      setNotice("ready");
      return;
    }

    addCharacter(" ");
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

  const statusText =
    notice === "margin"
      ? "Margin reached"
      : notice === "page-end"
        ? "End of page"
        : `${typedText.length} characters`;
  const isRibbonActive = activeSlugId !== null && isSlugPressed;

  return (
    <main className="app-shell" onPointerDown={() => inputRef.current?.focus()}>
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

      <div className="app-toolbar" aria-live="polite">
        <span>{statusText}</span>
        <label>
          Zoom
          <select value={zoom} onChange={handleZoomChange}>
            <option value={1}>Default</option>
            <option value={1.25}>125%</option>
            <option value={1.5}>150%</option>
            <option value={1.75}>175%</option>
          </select>
        </label>
        <label>
          Line
          <select value={lineSpacing} onChange={handleLineSpacingChange}>
            <option value={0}>0</option>
            <option value={1}>1</option>
            <option value={1.5}>1.5</option>
            <option value={2}>2</option>
          </select>
        </label>
        <button type="button" onClick={resetDocument}>
          New page
        </button>
      </div>

      <section ref={viewportRef} className="machine-viewport" aria-label="Interactive typewriter">
        <div className="machine-stage" style={{ transform: `translateX(-50%) scale(${stageScale * zoom})` }}>
          <div
            className={`carriage ${notice !== "ready" ? "carriage-alert" : ""}`}
            style={{ transform: `translate3d(${carriageX}px, 0, 0)` }}
          >
            <img className="figma-asset platen" src={ASSETS.platen} alt="" draggable="false" />

            <div
              className="paper"
              style={{
                top: paperTop,
                height: FIGMA.paperBottom - paperTop,
                width: FIGMA.paperWidth,
              }}
            />

            <div className="roller-shadow" />

            <div
              className="typed-paper-text"
              style={{
                top: textTop,
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
    </main>
  );
}

export default App;
