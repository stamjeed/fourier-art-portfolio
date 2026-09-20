import { resample, smoothPoints, dftComplex, type Pt, type FourierTerm } from "../lib/fourier";

export interface DftWorkerRequest {
  points: Pt[];
  sampleN: number;
  smoothness: number;
}

export interface DftWorkerResponse {
  terms: FourierTerm[];
}

const ctx = self as unknown as Worker;

ctx.onmessage = (e: MessageEvent) => {
  const { points, sampleN, smoothness } = e.data as DftWorkerRequest;

  let pts = resample(points, sampleN);
  pts = smoothPoints(pts, smoothness);
  const terms = dftComplex(pts);

  ctx.postMessage({ terms } satisfies DftWorkerResponse);
};
