import { RECORD_KEYS, type RecordKey, type RunRecord } from "./storage";

/**
 * How many of the latest runs the charts show: all of them in practice (the save
 * keeps up to 1000), so the whole arc of improvement is visible. Records always
 * count every run.
 */
export const CHART_RUNS = 1000;

/** Past this many runs, plain runs lose their dots so the line stays readable; records keep theirs. */
const DOTS_UP_TO = 60;

const LABEL: Record<RecordKey, string> = { score: "Score", accuracy: "Accuracy", wpm: "WPM", longestStreak: "Best streak" };
const FMT: Record<RecordKey, (v: number) => string> = {
  score: (v) => Math.round(v).toLocaleString(),
  accuracy: (v) => `${(v * 100).toFixed(1)}%`,
  wpm: (v) => v.toFixed(1),
  longestStreak: (v) => String(Math.round(v)),
};

export interface Series {
  key: RecordKey;
  /** the shown runs' values, oldest first */
  values: number[];
  /** best so far after each shown run (counting runs before the window too) */
  best: number[];
  /** did this shown run beat every run before it? */
  record: boolean[];
  /** all-time best and the index of the shown run that set it (-1 if older than the window) */
  top: number;
  topIndex: number;
}

/** Values, running bests and record flags for one measure over the last `n` runs. */
export function series(history: readonly RunRecord[], key: RecordKey, n = CHART_RUNS): Series {
  const start = Math.max(0, history.length - n);
  let best = -Infinity;
  for (let i = 0; i < start; i++) best = Math.max(best, history[i]![key]);
  const values: number[] = [];
  const bestArr: number[] = [];
  const record: boolean[] = [];
  let topIndex = -1;
  for (let i = start; i < history.length; i++) {
    const v = history[i]![key];
    // the very first run ever sets the line going but isn't a "record"
    const isRecord = v > best && i > 0;
    if (v > best) {
      best = v;
      topIndex = i - start;
    }
    values.push(v);
    bestArr.push(best);
    record.push(isRecord);
  }
  return { key, values, best: bestArr, record, top: best, topIndex };
}

const W = 400;
const H = 74;
const PL = 6;
const PR = 6;
const PT = 19;
const PB = 17;

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function chart(s: Series, first: string, last: string): string {
  const v = s.values;
  let lo = Math.min(...v, s.top);
  let hi = Math.max(...v, s.top);
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
  lo -= pad;
  hi += pad;
  const x = (i: number) => (v.length === 1 ? W / 2 : PL + ((W - PL - PR) * i) / (v.length - 1));
  const y = (val: number) => PT + (H - PT - PB) * (1 - (val - lo) / (hi - lo));
  const path = (vals: number[]) => vals.map((val, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(val).toFixed(1)}`).join(" ");
  const runDots = v.length <= DOTS_UP_TO;
  const dots = v
    .map((val, i) =>
      s.record[i]
        ? `<circle class="rec" cx="${x(i).toFixed(1)}" cy="${y(val).toFixed(1)}" r="5"/>`
        : runDots
          ? `<circle class="run" cx="${x(i).toFixed(1)}" cy="${y(val).toFixed(1)}" r="3"/>`
          : "",
    )
    .join("");
  const topLabel =
    s.topIndex >= 0
      ? `<text class="top" x="${Math.min(W - 34, Math.max(34, x(s.topIndex))).toFixed(1)}" y="${(y(s.top) - 9).toFixed(1)}" text-anchor="middle">${FMT[s.key](s.top)}</text>`
      : "";
  return `<svg class="history-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${LABEL[s.key]} over your last ${v.length} runs, best ${FMT[s.key](s.top)}">
    <line class="axis" x1="${PL}" x2="${W - PR}" y1="${H - PB + 3}" y2="${H - PB + 3}"/>
    ${v.length > 1 ? `<path class="best" d="${path(s.best)}"/><path class="line" d="${path(v)}"/>` : ""}
    ${dots}
    ${topLabel}
    <text class="date" x="${PL}" y="${H - 2}">${first}</text>
    ${v.length > 1 ? `<text class="date" x="${W - PR}" y="${H - 2}" text-anchor="end">${last}</text>` : ""}
  </svg>`;
}

/** The title screen's run history: score, accuracy, WPM and best streak over time, records in gold. */
export function historyHtml(history: readonly RunRecord[]): string {
  if (history.length === 0) return "";
  const shown = history.slice(-CHART_RUNS);
  const first = day(shown[0]!.at);
  const last = day(shown[shown.length - 1]!.at);
  const charts = RECORD_KEYS.map((k) => {
    const s = series(history, k);
    const latest = s.values[s.values.length - 1]!;
    return `<div class="history-row">
        <span class="history-name">${LABEL[k]}</span>
        <span class="history-vals">last ${FMT[k](latest)} · best <b>${FMT[k](s.top)}</b></span>
      </div>
      ${chart(s, first, last)}`;
  }).join("");
  return `<div class="history">${charts}
    <div class="history-key"><span><i class="rec"></i>new record</span><span><i class="run"></i>run</span></div>
  </div>`;
}
