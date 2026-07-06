import { ClipboardEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

const FIGMA = {
  frameWidth: 4621,
  frameHeight: 2894,
  carriageRightX: 1367,
  carriageLeftX: 69,
  maxFeed: 1852 - 643,
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
const maxLineIndex = Math.floor(FIGMA.maxFeed / FIGMA.lineHeight);
const fontSpec = `${FIGMA.typeSize}px "Special Elite", "Courier New", monospace`;

const ASSETS = {
  platen: "/assets/platen.png",
  paperPressRoller: "/assets/paper-press-roller.png",
  pointGuideGuard: "/assets/point-guide-guard.png",
  colorRibbonSlugs: "/assets/color-ribbon-slugs.png",
  typewriterBody: "/assets/typewriter-body.png",
};

type Notice = "ready" | "margin" | "page-end";

function isPrintableKey(event: KeyboardEvent): boolean {
  return event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
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
  const [notice, setNotice] = useState<Notice>("ready");
  const [stageScale, setStageScale] = useState(1);
  const viewportRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { measure } = useSpecialEliteMeasure();

  const currentLineIndex = lines.length - 1;
  const currentLine = lines[currentLineIndex] ?? "";
  const currentAdvance = Math.min(measure(currentLine), maxAdvance);
  const carriageX = FIGMA.carriageRightX - currentAdvance;
  const feed = Math.min(currentLineIndex * FIGMA.lineHeight, FIGMA.maxFeed);
  const paperTop = FIGMA.paperBottom - (643 + feed);
  const textTop = FIGMA.textBaseTop - feed;
  const typedText = lines.join("\n");

  useEffect(() => {
    inputRef.current?.focus();
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

  const resetDocument = () => {
    setLines([""]);
    setNotice("ready");
    inputRef.current?.focus();
  };

  const addReturn = () => {
    setLines((previous) => {
      if (previous.length - 1 >= maxLineIndex) {
        setNotice("page-end");
        return previous;
      }
      setNotice("ready");
      return [...previous, ""];
    });
  };

  const addCharacter = (character: string) => {
    setLines((previous) => {
      const next = [...previous];
      const index = next.length - 1;
      const candidate = `${next[index]}${character}`;

      if (measure(candidate) > maxAdvance) {
        setNotice("margin");
        return previous;
      }

      next[index] = candidate;
      setNotice("ready");
      return next;
    });
  };

  const removeCharacter = () => {
    setLines((previous) => {
      const next = [...previous];
      const index = next.length - 1;

      if (next[index].length > 0) {
        next[index] = next[index].slice(0, -1);
        return next;
      }

      if (next.length > 1) {
        next.pop();
        return next;
      }

      return previous;
    });
    setNotice("ready");
  };

  const typeText = (text: string) => {
    for (const character of text) {
      if (character === "\n" || character === "\r") {
        addReturn();
      } else if (character >= " ") {
        addCharacter(character);
      }
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addReturn();
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      removeCharacter();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      typeText("    ");
      return;
    }

    if (isPrintableKey(event)) {
      event.preventDefault();
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

  return (
    <main className="app-shell" onPointerDown={() => inputRef.current?.focus()}>
      <textarea
        ref={inputRef}
        className="keyboard-capture"
        aria-label="Typewriter input"
        value=""
        onChange={() => undefined}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        autoFocus
      />

      <div className="app-toolbar" aria-live="polite">
        <span>{statusText}</span>
        <button type="button" onClick={resetDocument}>
          New page
        </button>
      </div>

      <section ref={viewportRef} className="machine-viewport" aria-label="Interactive typewriter">
        <div className="machine-stage" style={{ transform: `scale(${stageScale})` }}>
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
                lineHeight: `${FIGMA.lineHeight}px`,
              }}
            >
              {typedText}
            </div>

            <img
              className="figma-asset paper-press-roller"
              src={ASSETS.paperPressRoller}
              alt=""
              draggable="false"
            />
          </div>

          <div className="fixed-typewriter-body">
            <img className="figma-asset point-guide-guard" src={ASSETS.pointGuideGuard} alt="" draggable="false" />
            <img className="figma-asset color-ribbon-slugs" src={ASSETS.colorRibbonSlugs} alt="" draggable="false" />
            <img className="figma-asset typewriter-body" src={ASSETS.typewriterBody} alt="" draggable="false" />
            <div className="typing-cursor" style={{ left: FIGMA.cursorX, top: FIGMA.cursorY }} />
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
