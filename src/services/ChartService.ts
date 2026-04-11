import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import {
  Chart,
  CategoryScale,
  LinearScale,
  LineElement,
  BarElement,
  PointElement,
  LineController,
  BarController,
  Tooltip,
  Legend,
  Filler,
  ChartConfiguration,
} from 'chart.js';
import { OHLCCandle, DailyOutlookData } from '../types/market';

// Register only CJS-compatible Chart.js components.
// chartjs-chart-financial is ESM-only and cannot be required in a CommonJS
// build — we use a close-price area chart + overlays instead.
Chart.register(
  CategoryScale,
  LinearScale,
  LineElement,
  BarElement,
  PointElement,
  LineController,
  BarController,
  Tooltip,
  Legend,
  Filler,
);

const CHART_WIDTH  = 1200;
const CHART_HEIGHT = 650;

/**
 * Renders a 4H close-price chart with Hi/Lo bars, EMA lines, pullback zones,
 * and S/R levels. Returns a PNG Buffer for Telegram sendPhoto().
 *
 * Uses only Chart.js core (CJS) — no ESM-only candlestick plugin required.
 */
export class ChartService {
  private readonly canvas: ChartJSNodeCanvas;

  constructor() {
    this.canvas = new ChartJSNodeCanvas({
      width: CHART_WIDTH,
      height: CHART_HEIGHT,
      backgroundColour: '#131722',
    });
  }

  async renderOutlookChart(candles: OHLCCandle[], outlook: DailyOutlookData): Promise<Buffer> {
    const slice = candles.slice(-60); // 60 × 4H ≈ 10 days — clear candlestick view

    const labels = slice.map((c) =>
      new Date(c.time).toLocaleString('en-GB', {
        timeZone: 'Asia/Bangkok',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    );

    // ── Candle colours ────────────────────────────────────────────────────────
    const BULL  = '#26a69a';
    const BEAR  = '#ef5350';
    const DOJI  = '#b0bec5';
    const candleColour = (c: OHLCCandle) =>
      Math.abs(c.close - c.open) < (c.high - c.low) * 0.1 ? DOJI
        : c.close >= c.open ? BULL : BEAR;
    const bodyColours = slice.map(c => candleColour(c) + 'cc'); // semi-transparent body
    const wickColours = slice.map(c => candleColour(c));

    // ── EMA values ────────────────────────────────────────────────────────────
    const snap4h   = outlook.indicators['4h'];
    const ema14val = snap4h?.ema_14 ?? null;
    const ema60val = snap4h?.ema_60 ?? null;
    const ema14Line = ema14val !== null ? slice.map(() => ema14val) : null;
    const ema60Line = ema60val !== null ? slice.map(() => ema60val) : null;

    // ── Pullback zones ────────────────────────────────────────────────────────
    const pz = outlook.primaryZone;
    const sz = outlook.secondaryZone;

    // ── S/R key levels (fall back to Claude-stored levels if keyLevels empty) ─
    const resistances = outlook.srContext.keyLevels
      .filter((l) => l.type === 'resistance').slice(0, 3);
    const supports = outlook.srContext.keyLevels
      .filter((l) => l.type === 'support').slice(0, 3);
    if (resistances.length === 0 && outlook.keyResistance != null) {
      resistances.push({ type: 'resistance', price: outlook.keyResistance, strength: 'moderate', source: 'swing' });
    }
    if (supports.length === 0 && outlook.keySupport != null) {
      supports.push({ type: 'support', price: outlook.keySupport, strength: 'moderate', source: 'swing' });
    }

    // ── Bias colour ───────────────────────────────────────────────────────────
    const biasColour =
      outlook.bias === 'BUY'  ? BULL :
      outlook.bias === 'SELL' ? BEAR : '#b0bec5';

    // ── Datasets ──────────────────────────────────────────────────────────────
    const datasets: ChartConfiguration['data']['datasets'] = [];

    // Candlestick wicks — thin floating bar [low, high]
    datasets.push({
      type: 'bar',
      label: '_wick',
      data: slice.map(c => [c.low, c.high]),
      backgroundColor: wickColours,
      borderColor: wickColours,
      borderWidth: 0,
      barThickness: 2,
      order: 1,
    } as any);

    // Candlestick bodies — wider floating bar [min(open,close), max(open,close)]
    datasets.push({
      type: 'bar',
      label: `${outlook.symbol} OHLC`,
      data: slice.map(c => [Math.min(c.open, c.close), Math.max(c.open, c.close)]),
      backgroundColor: bodyColours,
      borderColor: wickColours,
      borderWidth: 1,
      barThickness: 8,
      order: 0,
    } as any);

    // EMA14 line
    if (ema14Line) {
      datasets.push({
        type: 'line',
        label: 'EMA 14',
        data: ema14Line,
        borderColor: '#ffeb3b',
        borderWidth: 1.5,
        borderDash: [4, 3],
        pointRadius: 0,
        tension: 0,
        fill: false,
        order: 2,
      } as any);
    }

    // EMA60 line
    if (ema60Line) {
      datasets.push({
        type: 'line',
        label: 'EMA 60',
        data: ema60Line,
        borderColor: '#ff9800',
        borderWidth: 1.5,
        borderDash: [7, 4],
        pointRadius: 0,
        tension: 0,
        fill: false,
        order: 2,
      } as any);
    }

    // Primary pullback zone band
    if (pz) {
      datasets.push({
        type: 'line',
        label: 'Primary Zone',
        data: slice.map(() => pz.priceHigh),
        borderColor: 'rgba(38,166,154,0.5)',
        borderWidth: 1,
        pointRadius: 0,
        fill: '+1',
        backgroundColor: 'rgba(38,166,154,0.13)',
        tension: 0,
        order: 10,
      } as any);
      datasets.push({
        type: 'line',
        label: '_pz_low',
        data: slice.map(() => pz.priceLow),
        borderColor: 'rgba(38,166,154,0.5)',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        tension: 0,
        order: 10,
      } as any);
    }

    // Secondary pullback zone band
    if (sz) {
      datasets.push({
        type: 'line',
        label: 'Secondary Zone',
        data: slice.map(() => sz.priceHigh),
        borderColor: 'rgba(255,152,0,0.45)',
        borderWidth: 1,
        pointRadius: 0,
        fill: '+1',
        backgroundColor: 'rgba(255,152,0,0.10)',
        tension: 0,
        order: 11,
      } as any);
      datasets.push({
        type: 'line',
        label: '_sz_low',
        data: slice.map(() => sz.priceLow),
        borderColor: 'rgba(255,152,0,0.45)',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        tension: 0,
        order: 11,
      } as any);
    }

    // Resistance lines
    for (const r of resistances) {
      datasets.push({
        type: 'line',
        label: `R ${r.price.toFixed(5)}`,
        data: slice.map(() => r.price),
        borderColor: 'rgba(239,83,80,0.8)',
        borderWidth: 1,
        borderDash: [6, 4],
        pointRadius: 0,
        tension: 0,
        fill: false,
        order: 3,
      } as any);
    }

    // Support lines
    for (const s of supports) {
      datasets.push({
        type: 'line',
        label: `S ${s.price.toFixed(5)}`,
        data: slice.map(() => s.price),
        borderColor: 'rgba(38,166,154,0.8)',
        borderWidth: 1,
        borderDash: [6, 4],
        pointRadius: 0,
        tension: 0,
        fill: false,
        order: 3,
      } as any);
    }

    // Current price line
    datasets.push({
      type: 'line',
      label: `Now ${outlook.currentPrice.toFixed(5)}`,
      data: slice.map(() => outlook.currentPrice),
      borderColor: biasColour,
      borderWidth: 2,
      pointRadius: 0,
      tension: 0,
      fill: false,
      order: 0,
    } as any);

    // ── Y-axis range ──────────────────────────────────────────────────────────
    const prices = slice.flatMap((c) => [c.high, c.low]);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const pad  = (maxP - minP) * 0.06;

    // ── Title ─────────────────────────────────────────────────────────────────
    const biasLabel = outlook.bias ?? 'NEUTRAL';
    const adxLabel  = outlook.adxValue != null ? ` | ADX ${outlook.adxValue.toFixed(1)}` : '';
    const titleText = `${outlook.symbol} 4H  —  Bias: ${biasLabel}${adxLabel}`;

    const config: ChartConfiguration = {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: false,
        animation: false as any,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: '#b0bec5',
              font: { size: 11 },
              filter: (item) => !item.text.startsWith('_'),
            },
          },
          tooltip: { enabled: false },
          title: {
            display: true,
            text: titleText,
            color: '#eceff1',
            font: { size: 15, weight: 'bold' },
            padding: { bottom: 8 },
          } as any,
        },
        scales: {
          x: {
            ticks: {
              color: '#607d8b',
              font: { size: 9 },
              maxTicksLimit: 12,
              maxRotation: 0,
            },
            grid: { color: 'rgba(96,125,139,0.2)' },
          },
          y: {
            position: 'right',
            ticks: { color: '#607d8b', font: { size: 10 } },
            grid: { color: 'rgba(96,125,139,0.2)' },
            min: minP - pad,
            max: maxP + pad,
          },
        },
      },
    };

    return this.canvas.renderToBuffer(config);
  }
}

