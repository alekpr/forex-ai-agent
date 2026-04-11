import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import {
  Chart,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  LineController,
  Tooltip,
  Legend,
  Filler,
  ChartConfiguration,
} from 'chart.js';
import { CandlestickController, CandlestickElement, OhlcElement } from 'chartjs-chart-financial';
import { OHLCCandle, DailyOutlookData } from '../types/market';

// Register Chart.js components + financial plugin
Chart.register(
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  LineController,
  Tooltip,
  Legend,
  Filler,
  CandlestickController,
  CandlestickElement,
  OhlcElement,
);

const CHART_WIDTH  = 1200;
const CHART_HEIGHT = 650;

/**
 * Renders a 4H candlestick chart with EMA lines, pullback zones, and S/R levels.
 * Returns a PNG Buffer suitable for sending via Telegram sendPhoto().
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
    // Use the last 80 candles to keep the chart readable
    const slice = candles.slice(-80);

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

    // ── Candlestick data ───────────────────────────────────────────────────────
    const candleData = slice.map((c) => ({
      x: new Date(c.time).getTime(),
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
    }));

    // ── EMA lines from indicators ──────────────────────────────────────────────
    const snap4h = outlook.indicators['4h'];
    const ema14val  = snap4h?.ema_14  ?? null;
    const ema60val  = snap4h?.ema_60  ?? null;

    // Flat lines across all candles (we only have latest value, not history)
    const ema14Line  = ema14val  !== null ? slice.map(() => ema14val)  : null;
    const ema60Line  = ema60val  !== null ? slice.map(() => ema60val)  : null;

    // ── Pullback zone fills ────────────────────────────────────────────────────
    const pz = outlook.primaryZone;
    const sz = outlook.secondaryZone;

    const primaryZoneUpper = pz ? slice.map(() => pz.priceHigh) : null;
    const primaryZoneLower = pz ? slice.map(() => pz.priceLow)  : null;
    const secondaryZoneUpper = sz ? slice.map(() => sz.priceHigh) : null;
    const secondaryZoneLower = sz ? slice.map(() => sz.priceLow)  : null;

    // ── Key S/R lines ──────────────────────────────────────────────────────────
    const resistances = outlook.srContext.keyLevels
      .filter((l) => l.type === 'resistance')
      .slice(0, 3);
    const supports = outlook.srContext.keyLevels
      .filter((l) => l.type === 'support')
      .slice(0, 3);

    // ── Bias colours ──────────────────────────────────────────────────────────
    const biasColour =
      outlook.bias === 'BUY'  ? '#26a69a' :
      outlook.bias === 'SELL' ? '#ef5350' :
      '#b0bec5';

    // ── Build dataset array ────────────────────────────────────────────────────
    const datasets: ChartConfiguration['data']['datasets'] = [];

    // Candlesticks
    datasets.push({
      type: 'candlestick' as any,
      label: `${outlook.symbol} 4H`,
      data: candleData as any,
      borderColor: {
        up:   '#26a69a',
        down: '#ef5350',
        unchanged: '#b0bec5',
      } as any,
      backgroundColor: {
        up:   '#26a69a',
        down: '#ef5350',
        unchanged: '#b0bec5',
      } as any,
    });

    // EMA14
    if (ema14Line) {
      datasets.push({
        type: 'line',
        label: 'EMA 14',
        data: ema14Line,
        borderColor: '#ffeb3b',
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0,
        borderDash: [4, 2],
      } as any);
    }

    // EMA60
    if (ema60Line) {
      datasets.push({
        type: 'line',
        label: 'EMA 60',
        data: ema60Line,
        borderColor: '#ff9800',
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0,
        borderDash: [6, 3],
      } as any);
    }

    // Primary pullback zone (EMA14 band) — filled area
    if (primaryZoneUpper && primaryZoneLower) {
      datasets.push({
        type: 'line',
        label: 'Primary Zone',
        data: primaryZoneUpper,
        borderColor: 'rgba(38,166,154,0.6)',
        borderWidth: 1,
        pointRadius: 0,
        fill: '+1',
        backgroundColor: 'rgba(38,166,154,0.12)',
        tension: 0,
      } as any);
      datasets.push({
        type: 'line',
        label: '_primary_lower',
        data: primaryZoneLower,
        borderColor: 'rgba(38,166,154,0.6)',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        tension: 0,
      } as any);
    }

    // Secondary pullback zone (EMA60 band) — filled area
    if (secondaryZoneUpper && secondaryZoneLower) {
      datasets.push({
        type: 'line',
        label: 'Secondary Zone',
        data: secondaryZoneUpper,
        borderColor: 'rgba(255,152,0,0.5)',
        borderWidth: 1,
        pointRadius: 0,
        fill: '+1',
        backgroundColor: 'rgba(255,152,0,0.10)',
        tension: 0,
      } as any);
      datasets.push({
        type: 'line',
        label: '_secondary_lower',
        data: secondaryZoneLower,
        borderColor: 'rgba(255,152,0,0.5)',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        tension: 0,
      } as any);
    }

    // Resistance lines
    for (const r of resistances) {
      datasets.push({
        type: 'line',
        label: `R ${r.price.toFixed(5)}`,
        data: slice.map(() => r.price),
        borderColor: 'rgba(239,83,80,0.75)',
        borderWidth: 1,
        pointRadius: 0,
        borderDash: [5, 4],
        tension: 0,
      } as any);
    }

    // Support lines
    for (const s of supports) {
      datasets.push({
        type: 'line',
        label: `S ${s.price.toFixed(5)}`,
        data: slice.map(() => s.price),
        borderColor: 'rgba(38,166,154,0.75)',
        borderWidth: 1,
        pointRadius: 0,
        borderDash: [5, 4],
        tension: 0,
      } as any);
    }

    // Current price line
    datasets.push({
      type: 'line',
      label: `Price ${outlook.currentPrice.toFixed(5)}`,
      data: slice.map(() => outlook.currentPrice),
      borderColor: biasColour,
      borderWidth: 2,
      pointRadius: 0,
      tension: 0,
    } as any);

    // ── Price range for Y axis ─────────────────────────────────────────────────
    const prices = slice.flatMap((c) => [c.high, c.low]);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const padding = (maxPrice - minPrice) * 0.05;

    // ── Chart title ────────────────────────────────────────────────────────────
    const biasLabel = outlook.bias ?? 'NEUTRAL';
    const adxLabel  = outlook.adxValue != null ? ` | ADX ${outlook.adxValue.toFixed(1)}` : '';
    const titleText = `${outlook.symbol} 4H — Bias: ${biasLabel}${adxLabel}`;

    const config: ChartConfiguration = {
      type: 'bar' as any, // overridden per-dataset
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
              // Hide internal fill datasets
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
            min: minPrice - padding,
            max: maxPrice + padding,
          },
        },
      },
    };

    return this.canvas.renderToBuffer(config);
  }
}
