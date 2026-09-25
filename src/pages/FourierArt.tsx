import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Pt, FourierTerm } from "../lib/fourier";
import DftWorker from "../workers/dft.worker?worker";
import type { DftWorkerRequest, DftWorkerResponse } from "../workers/dft.worker";

// ---------- Canvas helpers ----------
function clearCanvas(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
}

export default function FourierArt() {
  const drawRef = useRef<HTMLCanvasElement | null>(null);
  const reconRef = useRef<HTMLCanvasElement | null>(null);
  const reconSectionRef = useRef<HTMLDivElement | null>(null);

  // stop AFTER drawing final frame
  const stopRequestedRef = useRef(false);

  const [isDrawing, setIsDrawing] = useState(false);
  const [rawPoints, setRawPoints] = useState<Pt[]>([]);
  const [terms, setTerms] = useState<FourierTerm[] | null>(null);
  const [running, setRunning] = useState(false);
  const [computing, setComputing] = useState(false);

  // DFT runs in a worker so large sample counts don't freeze the UI thread
  const workerRef = useRef<Worker | null>(null);
  const convertTokenRef = useRef(0);

  useEffect(() => {
    const worker = new DftWorker();
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const [numCircles, setNumCircles] = useState(160);
  const [speed, setSpeed] = useState(1.0);
  const [sampleN, setSampleN] = useState(800);
  const [smoothness, setSmoothness] = useState(9);

  const [stopAfterOne, setStopAfterOne] = useState(true);

  // ✅ NEW: circles visibility
  const [showCircles, setShowCircles] = useState(true);

  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 640 : false
  );

  // phone UX: settings start collapsed (they're secondary to Draw -> Convert -> Reconstruction)
  const [showControls, setShowControls] = useState(!isMobile);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ----- Responsive canvas sizing -----
  useEffect(() => {
    const d = drawRef.current;
    const r = reconRef.current;
    if (!d || !r) return;

    const resize = () => {
      const DPR = window.devicePixelRatio || 1;

      const dRect = d.getBoundingClientRect();
      const rRect = r.getBoundingClientRect();

      const drawW = Math.max(280, Math.floor(dRect.width));
      const reconW = Math.max(280, Math.floor(rRect.width));

      const drawH = isMobile ? Math.floor(drawW * 0.85) : drawW;
      const reconH = isMobile ? Math.floor(reconW * 0.85) : reconW;

      d.width = Math.floor(drawW * DPR);
      d.height = Math.floor(drawH * DPR);
      d.style.width = `${drawW}px`;
      d.style.height = `${drawH}px`;

      r.width = Math.floor(reconW * DPR);
      r.height = Math.floor(reconH * DPR);
      r.style.width = `${reconW}px`;
      r.style.height = `${reconH}px`;

      const dctx = d.getContext("2d")!;
      const rctx = r.getContext("2d")!;
      dctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      rctx.setTransform(DPR, 0, 0, DPR, 0, 0);

      dctx.lineCap = "round";
      dctx.lineJoin = "round";
      rctx.lineCap = "round";
      rctx.lineJoin = "round";

      redrawDrawCanvas();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(d);
    ro.observe(r);

    resize();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  const redrawDrawCanvas = () => {
    const d = drawRef.current;
    if (!d) return;
    const ctx = d.getContext("2d")!;
    const w = d.getBoundingClientRect().width;
    const h = d.getBoundingClientRect().height;

    clearCanvas(ctx, w, h);

    const cx = w / 2;
    const cy = h / 2;

    const grid = Math.max(26, Math.floor(w / 13));
    ctx.globalAlpha = 0.12;
    ctx.beginPath();
    for (let x = grid; x < w; x += grid) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = grid; y < h; y += grid) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (rawPoints.length > 1) {
      ctx.beginPath();
      for (let i = 0; i < rawPoints.length; i++) {
        const p = rawPoints[i];
        const x = p.x + cx;
        const y = p.y + cy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  };

  useEffect(() => {
    redrawDrawCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawPoints]);

  const pointerToCentered = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return { x: x - rect.width / 2, y: y - rect.height / 2 };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    setRunning(false);
    setTerms(null);
    setIsDrawing(true);
    const p = pointerToCentered(e);
    setRawPoints([p]);

    // optional: helps on phone if finger leaves canvas
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const p = pointerToCentered(e);
    setRawPoints((prev) => [...prev, p]);
  };

  const onPointerUp = () => setIsDrawing(false);

  const onConvert = () => {
    if (rawPoints.length < 10) return;
    const worker = workerRef.current;
    if (!worker) return;

    // on phones, jump straight to the reconstruction so users don't have to scroll for it themselves
    if (isMobile) {
      reconSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    const token = ++convertTokenRef.current;
    setComputing(true);

    const handleMessage = (e: MessageEvent) => {
      worker.removeEventListener("message", handleMessage);
      // ignore stale results from a superseded Convert or an intervening Clear
      if (token !== convertTokenRef.current) return;

      const { terms: computed } = e.data as DftWorkerResponse;
      setTerms(computed);

      stopRequestedRef.current = false;

      // ✅ show circles during animation
      setShowCircles(true);

      setRunning(true);
      setComputing(false);
    };

    worker.addEventListener("message", handleMessage);
    worker.postMessage({
      points: rawPoints,
      sampleN,
      smoothness,
    } satisfies DftWorkerRequest);
  };

  const onClear = () => {
    convertTokenRef.current++; // invalidate any in-flight computation
    setComputing(false);
    setRunning(false);
    setTerms(null);
    setRawPoints([]);
    setShowCircles(true);

    const r = reconRef.current;
    if (r) {
      const rctx = r.getContext("2d")!;
      clearCanvas(rctx, r.getBoundingClientRect().width, r.getBoundingClientRect().height);
    }
  };

  // animation
  useEffect(() => {
    const canvas = reconRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    let t = 0;
    const path: Pt[] = [];
    const MAX_PATH_LEN = 1500;

    // Sort once per effect run instead of every animation frame
    const sortedTerms = terms
      ? [...terms].sort((a, b) => Math.abs(a.freq) - Math.abs(b.freq))
      : [];
    const useTerms = sortedTerms.slice(0, Math.min(numCircles, sortedTerms.length));

    const drawFrame = () => {
      // Keep final drawing visible when not running
      if (terms && !running) return;

      // Poll until we have terms
      if (!terms) {
        raf = requestAnimationFrame(drawFrame);
        return;
      }

      const w = canvas.getBoundingClientRect().width;
      const h = canvas.getBoundingClientRect().height;

      clearCanvas(ctx, w, h);

      // background wash
      ctx.globalAlpha = 0.06;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;

      let x = w / 2;
      let y = h / 2;

      // ✅ Only draw circles/arms while animating (or when user wants)
      if (showCircles) {
        // Batch every circle/arm into two paths instead of one stroke() call per term
        const circles = new Path2D();
        const arms = new Path2D();

        for (const term of useTerms) {
          const prevX = x;
          const prevY = y;

          const angle = term.freq * t + term.phase;
          const radius = term.amp;

          x += radius * Math.cos(angle);
          y += radius * Math.sin(angle);

          circles.moveTo(prevX + radius, prevY);
          circles.arc(prevX, prevY, radius, 0, Math.PI * 2);

          arms.moveTo(prevX, prevY);
          arms.lineTo(x, y);
        }

        ctx.globalAlpha = 0.24;
        ctx.stroke(circles);
        ctx.globalAlpha = 1;
        ctx.stroke(arms);
      } else {
        // still compute endpoint, just don't draw circles
        for (const term of useTerms) {
          const angle = term.freq * t + term.phase;
          const radius = term.amp;
          x += radius * Math.cos(angle);
          y += radius * Math.sin(angle);
        }
      }

      // path: append to the end and trim in occasional batches, instead of
      // an O(n) unshift/pop on every single frame
      path.push({ x, y });
      if (path.length > MAX_PATH_LEN * 2) {
        path.splice(0, path.length - MAX_PATH_LEN);
      }

      // draw path with break on big jumps
      const breakDist = Math.min(w, h) * 0.25;
      ctx.beginPath();
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        if (i === 0) {
          ctx.moveTo(p.x, p.y);
          continue;
        }
        const prev = path[i - 1];
        const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
        if (dist > breakDist) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.lineWidth = 3;
      ctx.stroke();

      // advance time
      const dt = (2 * Math.PI) / (terms.length || 1);
      t += dt * speed;

      // completion
      if (t >= 2 * Math.PI) {
        if (stopAfterOne) {
          t = 2 * Math.PI;
          stopRequestedRef.current = true;
        } else {
          t = 0;
          path.length = 0;
        }
      }

      // ✅ Finish: hide circles + stop animating (path stays visible)
      if (stopRequestedRef.current) {
        stopRequestedRef.current = false;
        setShowCircles(false); // circles disappear
        setRunning(false); // stops frames (doesn't clear)
        return;
      }

      raf = requestAnimationFrame(drawFrame);
    };

    raf = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(raf);
  }, [terms, running, numCircles, speed, stopAfterOne, showCircles]);

  const settingsPanel = (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
        columnGap: 20,
      }}
    >
      <div>
        <label style={labelStyle}>
          Circles: <b>{numCircles}</b>
        </label>
        <input
          type="range"
          min={10}
          max={450}
          value={numCircles}
          onChange={(e) => setNumCircles(Number(e.target.value))}
          className="fa-range"
        />
        <p style={helpStyle}>How many spinning circles redraw your picture — more of them means a closer match.</p>
      </div>

      <div>
        <label style={labelStyle}>
          Speed: <b>{speed.toFixed(1)}x</b>
        </label>
        <input
          type="range"
          min={0.2}
          max={3}
          step={0.1}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="fa-range"
        />
        <p style={helpStyle}>How fast the reconstruction animation plays.</p>
      </div>

      <div>
        <label style={labelStyle}>
          Samples: <b>{sampleN}</b>
        </label>
        <input
          type="range"
          min={200}
          max={1500}
          step={50}
          value={sampleN}
          onChange={(e) => setSampleN(Number(e.target.value))}
          className="fa-range"
        />
        <p style={helpStyle}>How many points your drawing is split into before conversion — more captures finer detail.</p>
      </div>

      <div>
        <label style={labelStyle}>
          Smoothness: <b>{smoothness}</b>
        </label>
        <input
          type="range"
          min={1}
          max={21}
          step={2}
          value={smoothness}
          onChange={(e) => setSmoothness(Number(e.target.value))}
          className="fa-range"
        />
        <p style={helpStyle}>Evens out shaky hand-drawn lines before conversion.</p>
      </div>

      <div style={{ gridColumn: isMobile ? "auto" : "1 / -1" }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 8,
            fontSize: 14,
            color: "var(--fa-text-soft)",
          }}
        >
          <input
            type="checkbox"
            checked={stopAfterOne}
            onChange={(e) => setStopAfterOne(e.target.checked)}
            className="fa-checkbox"
          />
          Stop after reconstruction
        </label>
        <p style={{ ...helpStyle, marginLeft: 24 }}>
          Freeze on the finished drawing instead of looping the animation forever.
        </p>
      </div>
    </div>
  );

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
        minHeight: "100dvh",
        padding: isMobile ? "20px 0 40px" : "40px 0 56px",
      }}
    >
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding: isMobile ? "0 12px" : "0 16px",
        }}
      >
        <header style={{ marginBottom: 18 }}>
          <h1
            style={{
              fontSize: isMobile ? 24 : 32,
              margin: 0,
              marginBottom: 6,
              letterSpacing: "-0.02em",
            }}
          >
            <span style={{ color: "var(--fa-accent)" }}>Fourier</span> Art Generator
          </h1>
          <p style={{ margin: 0, color: "var(--fa-text-soft)", fontSize: isMobile ? 13 : 16 }}>
            Draw anything on the left, then hit <b>Convert</b>. A ring of spinning circles will redraw your
            picture on the right, one loop at a time.
          </p>
        </header>

        <section
          className="fa-card"
          style={{
            display: "flex",
            gap: 12,
            padding: isMobile ? "14px 16px" : "18px 22px",
            marginBottom: 20,
            alignItems: "flex-start",
          }}
        >
          <span className="fa-badge" aria-hidden style={{ fontStyle: "italic", fontFamily: "Georgia, serif" }}>
            i
          </span>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4, fontSize: isMobile ? 14 : 15 }}>
              What is this, and why does it exist?
            </div>
            <p style={{ margin: 0, color: "var(--fa-text-soft)", fontSize: isMobile ? 13 : 14, lineHeight: 1.5 }}>
              It's a little doodle toy. Any shape you draw, no matter how squiggly, can be rebuilt out of
              circles spinning at different sizes and speeds. This page lets you draw something and watch
              that idea happen live, so a neat piece of math becomes something you can actually see and
              play with.
            </p>
            <p
              style={{
                margin: 0,
                marginTop: 8,
                color: "var(--fa-text-soft)",
                fontSize: isMobile ? 13 : 14,
                lineHeight: 1.5,
              }}
            >
              Mathematically, it's the Fourier transform: your drawing is treated as a repeating wave and
              decomposed into a sum of simple rotating terms, one per circle, each with its own frequency,
              radius, and starting angle. Adding those rotations back together — largest circle first, down
              to the smallest — retraces the exact path you drew.
            </p>
          </div>
        </section>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: 20,
            alignItems: "start",
          }}
        >
          <div className="fa-card" style={{ padding: isMobile ? 14 : 18 }}>
            <h3 style={{ margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8, fontSize: 16 }}>
              <span className="fa-badge">1</span> Draw
            </h3>
            <canvas
              ref={drawRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              style={{
                borderRadius: 14,
                border: "1px solid var(--fa-border)",
                touchAction: "none",
                width: "100%",
                height: "auto",
                display: "block",
                background: "#fff",
              }}
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr 1fr" : "auto auto auto",
                gap: 10,
                marginTop: 14,
              }}
            >
              <button
                onClick={onConvert}
                className="fa-btn fa-btn-primary"
                style={{ gridColumn: isMobile ? "1 / -1" : "auto" }}
                disabled={computing}
              >
                {computing ? "Computing…" : "Convert"}
              </button>

              <button
                onClick={() => {
                  if (!terms) return;
                  setShowCircles(true); // if user presses Play, show circles again
                  setRunning((v) => !v);
                }}
                className="fa-btn"
                disabled={!terms}
                title={!terms ? "Convert first" : ""}
              >
                {running ? "Pause" : "Play"}
              </button>

              <button onClick={onClear} className="fa-btn">
                Clear
              </button>
            </div>

            {/* Settings live inline on desktop; on mobile they move below Reconstruction, collapsed */}
            {!isMobile && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--fa-border)" }}>
                {settingsPanel}
              </div>
            )}
          </div>

          <div ref={reconSectionRef} className="fa-card" style={{ padding: isMobile ? 14 : 18 }}>
            <h3 style={{ margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8, fontSize: 16 }}>
              <span className="fa-badge">2</span> Reconstruction
            </h3>
            <canvas
              ref={reconRef}
              style={{
                borderRadius: 14,
                border: "1px solid var(--fa-border)",
                width: "100%",
                height: "auto",
                display: "block",
                background: "#fff",
              }}
            />

            <div
              style={{
                marginTop: 14,
                paddingTop: 14,
                borderTop: "1px solid var(--fa-border)",
                color: "var(--fa-text-soft)",
                fontSize: isMobile ? 13 : 14,
                lineHeight: 1.5,
              }}
            >
              <b style={{ color: "var(--fa-text)" }}>How it works:</b> Every drawing can be rebuilt out of
              many spinning circles of different sizes and speeds. Chain them tip-to-tail and the last point
              traces your original drawing back out — that's what's animating above.
            </div>
          </div>

          {isMobile && (
            <div className="fa-card" style={{ padding: 14 }}>
              <button
                onClick={() => setShowControls((v) => !v)}
                className="fa-btn"
                style={{ width: "100%" }}
              >
                {showControls ? "Hide Controls" : "Show Controls"}
              </button>
              {showControls && <div style={{ marginTop: 14 }}>{settingsPanel}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  marginTop: 10,
  marginBottom: 4,
  fontSize: 14,
  color: "var(--fa-text-soft)",
};

const helpStyle: React.CSSProperties = {
  margin: 0,
  marginTop: 2,
  fontSize: 12,
  lineHeight: 1.4,
  color: "var(--fa-text-soft)",
  opacity: 0.75,
};