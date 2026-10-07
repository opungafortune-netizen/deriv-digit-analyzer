import React, { useMemo, useState } from "react";
import { useDerivFeed, MARKETS, MARKET_MAP } from "./useDerivFeed.js";
import { buildStats, buildPredictions } from "./analysis.js";

const WINDOW_SIZES = [20, 50, 100, 200];

function StatusPill({ status, activeHost, onRetry }) {
  const map = {
    live: { cls: "live", text: "LIVE Deriv feed" },
    sim: { cls: "sim", text: "Simulated feed (live unreachable)" },
    connecting: { cls: "connecting", text: "Connecting to Deriv..." },
  };
  const info = map[status] || map.connecting;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span className={`status-pill ${info.cls}`} title={activeHost ? `Endpoint: ${activeHost}` : ""}>
        <span className="dot" style={{ background: "currentColor", width: 7, height: 7, borderRadius: "50%" }} />
        {info.text}
      </span>
      {status !== "live" && (
        <button className="market-btn" onClick={onRetry} style={{ fontSize: 11, padding: "4px 10px" }}>
          Reconnect live
        </button>
      )}
    </div>
  );
}

function TickStrip({ ticks, decimals }) {
  const last30 = ticks.slice(-30);
  return (
    <div className="tick-strip">
      {last30.map((t, i) => (
        <div
          key={t.time + "-" + i}
          className={`tick-chip ${t.digit % 2 === 0 ? "even" : "odd"} ${
            i === last30.length - 1 ? "latest" : ""
          }`}
          title={t.quote.toFixed(decimals)}
        >
          {t.digit}
        </div>
      ))}
    </div>
  );
}

function DigitBars({ dist, hotDigit, coldDigit }) {
  const maxPct = Math.max(1, ...dist.map((d) => d.pct));
  return (
    <div className="bars">
      {dist.map((d) => {
        const heightPct = Math.max(2, (d.pct / maxPct) * 100);
        const cls =
          d.digit === hotDigit ? "hot" : d.digit === coldDigit ? "cold" : "";
        return (
          <div className={`bar-col ${cls}`} key={d.digit}>
            <div className="bar-pct">{d.pct.toFixed(0)}%</div>
            <div className="bar" style={{ height: `${heightPct}%` }} />
            <div className="bar-label">{d.digit}</div>
          </div>
        );
      })}
    </div>
  );
}

function PredictionGrid({ predictions }) {
  const { matches, differs, overUnder, oddEven } = predictions;
  return (
    <div className="predict-grid">
      <div className="predict-card matches">
        <div className="label">Matches (predicted digit)</div>
        <div className="value">{matches.digit}</div>
        <div className="conf">Confidence {matches.confidence.toFixed(1)}%</div>
        <div className="conf-bar-track">
          <div
            className="conf-bar-fill"
            style={{ width: `${Math.min(100, matches.confidence)}%`, background: "#00d395" }}
          />
        </div>
      </div>
      <div className="predict-card differs">
        <div className="label">Differs (avoid this digit)</div>
        <div className="value">{differs.digit}</div>
        <div className="conf">Confidence {differs.confidence.toFixed(1)}%</div>
        <div className="conf-bar-track">
          <div
            className="conf-bar-fill"
            style={{ width: `${Math.min(100, differs.confidence)}%`, background: "#ff444f" }}
          />
        </div>
      </div>
      <div className="predict-card over">
        <div className="label">Over / Under 5</div>
        <div className="value">{overUnder.pick}</div>
        <div className="conf">Confidence {overUnder.confidence.toFixed(1)}%</div>
        <div className="conf-bar-track">
          <div
            className="conf-bar-fill"
            style={{ width: `${Math.min(100, overUnder.confidence)}%`, background: "#4f8cff" }}
          />
        </div>
      </div>
      <div className="predict-card odd">
        <div className="label">Odd / Even</div>
        <div className="value">{oddEven.pick}</div>
        <div className="conf">Confidence {oddEven.confidence.toFixed(1)}%</div>
        <div className="conf-bar-track">
          <div
            className="conf-bar-fill"
            style={{ width: `${Math.min(100, oddEven.confidence)}%`, background: "#ffb020" }}
          />
        </div>
      </div>
    </div>
  );
}

function WatchlistRow({ market, ticks, isActive, onClick }) {
  const stats = useMemo(() => buildStats(ticks.slice(-50)), [ticks]);
  const lastDigit = ticks.length ? ticks[ticks.length - 1].digit : "-";
  return (
    <div
      className="watch-row"
      onClick={onClick}
      style={isActive ? { borderColor: "#4f8cff" } : undefined}
    >
      <div className="name">{market.label}</div>
      <div className="mini">
        {ticks.length} ticks{" "}
        {ticks.length > 0 && (
          <span className={`badge ${lastDigit % 2 === 0 ? "even" : "odd"}`}>
            {lastDigit % 2 === 0 ? "EVEN" : "ODD"}
          </span>
        )}
      </div>
      <div className="digit" style={{ color: "#fff" }}>
        {lastDigit}
      </div>
      <div className="mini">Hot: {stats.hot.digit} ({stats.hot.pct.toFixed(0)}%)</div>
    </div>
  );
}

export default function App() {
  const { ticksBySymbol, status, activeHost, retryLive } = useDerivFeed();
  const [activeSymbol, setActiveSymbol] = useState(MARKETS[0].symbol);
  const [windowSize, setWindowSize] = useState(50);

  const market = MARKET_MAP[activeSymbol];
  const allTicks = ticksBySymbol[activeSymbol] || [];
  const windowedTicks = useMemo(
    () => allTicks.slice(-windowSize),
    [allTicks, windowSize]
  );

  const stats = useMemo(() => buildStats(windowedTicks), [windowedTicks]);
  const predictions = useMemo(() => buildPredictions(stats), [stats]);

  const lastTick = allTicks[allTicks.length - 1];

  return (
    <div className="app">
      <div className="header">
        <div>
          <h1>
            <span className="dot" />
            Deriv Digit Analyzer
          </h1>
          <div className="sub">
            Last-digit frequency analysis & predictions for Matches / Differs / Over-Under / Odd-Even
          </div>
        </div>
        <StatusPill status={status} activeHost={activeHost} onRetry={retryLive} />
      </div>

      <div className="toolbar">
        <div className="market-select-wrap">
          {MARKETS.map((m) => (
            <button
              key={m.symbol}
              className={`market-btn ${m.symbol === activeSymbol ? "active" : ""}`}
              onClick={() => setActiveSymbol(m.symbol)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="layout">
        <div className="col-main">
          <div className="panel">
            <h2>
              {market.label}
              <span className="hint">Symbol: {market.symbol}</span>
            </h2>
            <div className="price-row">
              <div className="price">
                {lastTick ? lastTick.quote.toFixed(market.decimals) : "—"}
              </div>
              <div className="last-digit">
                {lastTick !== undefined ? lastTick.digit : "-"}
              </div>
              <div className="small-muted">last digit</div>
            </div>
            <TickStrip ticks={allTicks} decimals={market.decimals} />
          </div>

          <div className="panel">
            <h2>
              Digit Distribution
              <span className="hint">
                Window:
                {WINDOW_SIZES.map((w) => (
                  <button
                    key={w}
                    onClick={() => setWindowSize(w)}
                    className="market-btn"
                    style={{
                      marginLeft: 6,
                      padding: "3px 8px",
                      fontSize: 11,
                      borderColor: windowSize === w ? "#4f8cff" : undefined,
                      color: windowSize === w ? "#fff" : undefined,
                    }}
                  >
                    {w}
                  </button>
                ))}
              </span>
            </h2>
            <DigitBars
              dist={stats.dist}
              hotDigit={stats.hot.digit}
              coldDigit={stats.cold.digit}
            />
            <div className="small-muted" style={{ marginTop: 10 }}>
              Based on last {stats.total} ticks. Odd {stats.odd.toFixed(0)}% / Even{" "}
              {stats.even.toFixed(0)}% &middot; Over(6-9) {stats.over.toFixed(0)}% / Under-or-5
              (0-5) {stats.underOrEqual.toFixed(0)}%
            </div>
          </div>

          <div className="panel">
            <h2>Predictions <span className="hint">updates every tick</span></h2>
            <PredictionGrid predictions={predictions} />
          </div>
        </div>

        <div className="col-side">
          <div className="panel">
            <h2>Market Watchlist</h2>
            <div className="watchlist">
              {MARKETS.map((m) => (
                <WatchlistRow
                  key={m.symbol}
                  market={m}
                  ticks={ticksBySymbol[m.symbol] || []}
                  isActive={m.symbol === activeSymbol}
                  onClick={() => setActiveSymbol(m.symbol)}
                />
              ))}
            </div>
          </div>

          <div className="panel">
            <h2>Digit Table</h2>
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Digit</th>
                  <th>Count</th>
                  <th>%</th>
                </tr>
              </thead>
              <tbody>
                {stats.dist.map((d) => (
                  <tr key={d.digit}>
                    <td>
                      <span className={`badge ${d.digit % 2 === 0 ? "even" : "odd"}`}>
                        {d.digit}
                      </span>
                    </td>
                    <td>{d.count}</td>
                    <td>{d.pct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="footer-note">
        Deriv synthetic indices are generated by a certified random number generator.
        Digit frequency statistics describe recent history only and do not guarantee
        future outcomes. Trade responsibly — this tool is for informational / educational
        purposes and is not financial advice. When the live feed is unavailable, data shown
        is clearly marked as simulated.
      </div>
    </div>
  );
}
