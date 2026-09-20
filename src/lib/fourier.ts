export type Pt = { x: number; y: number };
export type Complex = { re: number; im: number };
export type FourierTerm = { freq: number; amp: number; phase: number; c: Complex };

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
export function resample(points: Pt[], targetN: number): Pt[] {
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
export function smoothPoints(points: Pt[], windowSize: number): Pt[] {
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
export function dftComplex(points: Pt[]): FourierTerm[] {
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
