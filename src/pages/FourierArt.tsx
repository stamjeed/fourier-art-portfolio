import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Pt = { x: number; y: number };
type Complex = { re: number; im: number };
type FourierTerm = { freq: number; amp: number; phase: number; c: Complex };

// ---------- Complex helpers ----------
const cAdd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
const cMul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});
const cMag = (a: Complex) => Math.hypot(a.re, a.im);
const cArg = (a: Complex) => Math.atan2(a.im, a.re);
const cis = (theta: number): Complex => ({ re: Math.cos(theta), im: Math.sin(theta) });

// ---------- Resampling ----------
function resample(points: Pt[], targetN: number): Pt[] {
  if (points.length < 2) return points;

  const d: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    d.push(d[i - 1] + Math.hypot(dx, dy));
  }
  const total = d[d.length - 1];
  if (total === 0) return points;

  const step = total / (targetN - 1);
  const out: Pt[] = [points[0]];
  let j = 1;

  for (let i = 1; i < targetN - 1; i++) {
    const dist = i * step;
    while (j < d.length - 1 && d[j] < dist) j++;

    const d0 = d[j - 1];
    const d1 = d[j];
    const t = d1 === d0 ? 0 : (dist - d0) / (d1 - d0);

    out.push({
      x: points[j - 1].x + t * (points[j].x - points[j - 1].x),
      y: points[j - 1].y + t * (points[j].y - points[j - 1].y),
    });
  }

  out.push(points[points.length - 1]);
  return out;
}

// Smooth points WITHOUT wrap-around (for open curves)
function smoothPoints(points: Pt[], windowSize: number): Pt[] {
  if (points.length < 3) return points;
  const w = Math.max(1, Math.floor(windowSize));
  if (w === 1) return points;

  const half = Math.floor(w / 2);
  const out: Pt[] = [];

  for (let i = 0; i < points.length; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(points.length - 1, i + half);

    let sx = 0;
    let sy = 0;
    let count = 0;

    for (let j = start; j <= end; j++) {
      sx += points[j].x;
      sy += points[j].y;
      count++;
    }

    out.push({ x: sx / count, y: sy / count });
  }

  return out;
}

// ---------- DFT ----------
function dftComplex(points: Pt[]): FourierTerm[] {
  const N = points.length;
  const signal: Complex[] = points.map((p) => ({ re: p.x, im: p.y }));

  const terms: FourierTerm[] = [];
  for (let k = -Math.floor(N / 2); k <= Math.floor((N - 1) / 2); k++) {
    let sum: Complex = { re: 0, im: 0 };

    for (let n = 0; n < N; n++) {
      const phi = (-2 * Math.PI * k * n) / N;
      sum = cAdd(sum, cMul(signal[n], cis(phi)));
    }

    sum = { re: sum.re / N, im: sum.im / N };

    terms.push({
      freq: k,
      amp: cMag(sum),
      phase: cArg(sum),
      c: sum,
    });
  }

  terms.sort((a, b) => a.freq - b.freq);
  return terms;
}

// ---------- Canvas helpers ----------
function clearCanvas(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
}

export default function FourierArt() {
  const drawRef = useRef<HTMLCanvasElement | null>(null);
  const reconRef = useRef<HTMLCanvasElement | null>(null);

  // stop AFTER drawing final frame
  const stopRequestedRef = useRef(false);

  const [isDrawing, setIsDrawing] = useState(false);
  const [rawPoints, setRawPoints] = useState<Pt[]>([]);
  const [terms, setTerms] = useState<FourierTerm[] | null>(null);
  const [running, setRunning] = useState(false);

  const [numCircles, setNumCircles] = useState(160);
  const [speed, setSpeed] = useState(1.0);
  const [sampleN, setSampleN] = useState(800);
  const [smoothness, setSmoothness] = useState(9);

  const [stopAfterOne, setStopAfterOne] = useState(true);

  // ✅ NEW: circles visibility
  const [showCircles, setShowCircles] = useState(true);

  // phone UX: collapse controls
  const [showControls, setShowControls] = useState(true);

  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 640 : false
  );

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

    let pts = resample(rawPoints, sampleN);
    pts = smoothPoints(pts, smoothness);

    const computed = dftComplex(pts);
    setTerms(computed);

    stopRequestedRef.current = false;

    // ✅ show circles during animation
    setShowCircles(true);

    setRunning(true);
  };

  const onClear = () => {
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

      const sorted = [...terms].sort((a, b) => Math.abs(a.freq) - Math.abs(b.freq));
      const useTerms = sorted.slice(0, Math.min(numCircles, sorted.length));

      let x = w / 2;
      let y = h / 2;

      // ✅ Only draw circles/arms while animating (or when user wants)
      if (showCircles) {
        for (const term of useTerms) {
          const prevX = x;
          const prevY = y;

          const angle = term.freq * t + term.phase;
          const radius = term.amp;

          x += radius * Math.cos(angle);
          y += radius * Math.sin(angle);

          ctx.globalAlpha = 0.24;
          ctx.beginPath();
          ctx.arc(prevX, prevY, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;

          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
      } else {
        // still compute endpoint, just don't draw circles
        for (const term of useTerms) {
          const angle = term.freq * t + term.phase;
          const radius = term.amp;
          x += radius * Math.cos(angle);
          y += radius * Math.sin(angle);
        }
      }

      // path
      path.unshift({ x, y });
      if (path.length > 1500) path.pop();

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

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <div
        style={{
          maxWidth: 1400,
          margin: "24px auto",
          padding: isMobile ? "0 12px" : "0 16px",
        }}
      >
        <h1 style={{ fontSize: isMobile ? 22 : 28, marginBottom: 6 }}>
          Fourier Transform Art Generator
        </h1>

        <p style={{ marginTop: 0, opacity: 0.85, fontSize: isMobile ? 13 : 16 }}>
          Draw on the left. Click <b>Convert</b> to watch your drawing reconstructed using rotating circles (epicycles).
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: 18,
            alignItems: "start",
          }}
        >
          <div>
            <h3 style={{ margin: "10px 0" }}>1) Draw</h3>
            <canvas
              ref={drawRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              style={{
                borderRadius: 16,
                border: "1px solid rgba(0,0,0,0.2)",
                touchAction: "none",
                width: "100%",
                height: "auto",
                display: "block",
              }}
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr 1fr" : "auto auto auto",
                gap: 10,
                marginTop: 12,
              }}
            >
              <button
                onClick={onConvert}
                style={{
                  ...btnStyle,
                  gridColumn: isMobile ? "1 / -1" : "auto",
                }}
              >
                Convert
              </button>

              <button
                onClick={() => {
                  if (!terms) return;
                  setShowCircles(true); // if user presses Play, show circles again
                  setRunning((v) => !v);
                }}
                style={btnStyle}
                disabled={!terms}
                title={!terms ? "Convert first" : ""}
              >
                {running ? "Pause" : "Play"}
              </button>

              <button onClick={onClear} style={btnStyle}>
                Clear
              </button>
            </div>

            {isMobile && (
              <button
                onClick={() => setShowControls((v) => !v)}
                style={{ ...btnStyle, width: "100%", marginTop: 12 }}
              >
                {showControls ? "Hide Controls" : "Show Controls"}
              </button>
            )}

            {(!isMobile || showControls) && (
              <div style={{ marginTop: 14 }}>
                <label style={labelStyle}>
                  Circles: <b>{numCircles}</b>
                </label>
                <input
                  type="range"
                  min={10}
                  max={450}
                  value={numCircles}
                  onChange={(e) => setNumCircles(Number(e.target.value))}
                  style={{ width: "100%" }}
                />

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
                  style={{ width: "100%" }}
                />

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
                  style={{ width: "100%" }}
                />

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
                  style={{ width: "100%" }}
                />

                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                  <input
                    type="checkbox"
                    checked={stopAfterOne}
                    onChange={(e) => setStopAfterOne(e.target.checked)}
                  />
                  Stop after reconstruction
                </label>
              </div>
            )}
          </div>

          <div>
            <h3 style={{ margin: "10px 0" }}>2) Reconstruction</h3>
            <canvas
              ref={reconRef}
              style={{
                borderRadius: 16,
                border: "1px solid rgba(0,0,0,0.2)",
                width: "100%",
                height: "auto",
                display: "block",
              }}
            />

            <div
              style={{
                marginTop: 14,
                opacity: 0.9,
                fontSize: isMobile ? 13 : 14,
                lineHeight: 1.4,
              }}
            >
              <b>How it works:</b> Your drawing becomes a complex signal <code>x + i·y</code>. We compute its DFT
              coefficients and animate epicycles that sum to reconstruct the path.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.2)",
  background: "white",
  cursor: "pointer",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginTop: 10,
  marginBottom: 6,
  opacity: 0.85,
};