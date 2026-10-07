import { useEffect, useRef, useState, useCallback } from "react";

// Public demo app_id widely used for unauthenticated Deriv API demos.
const APP_ID = 1089;

// Deriv runs several edge hosts behind Cloudflare. Some networks/sandboxes
// can only reach a subset of them, so we try several in order and fail
// over automatically instead of giving up after one host.
const WS_HOSTS = [
  "ws.derivws.com",
  "ws.binaryws.com",
  "red.derivws.com",
  "green.derivws.com",
  "blue.derivws.com",
];

function wsUrl(host) {
  return `wss://${host}/websockets/v3?app_id=${APP_ID}`;
}

export const MARKETS = [
  { symbol: "R_10", label: "Volatility 10 Index", decimals: 3, base: 6500, vol: 0.9 },
  { symbol: "R_25", label: "Volatility 25 Index", decimals: 3, base: 900, vol: 1.4 },
  { symbol: "R_50", label: "Volatility 50 Index", decimals: 4, base: 250, vol: 2.1 },
  { symbol: "R_75", label: "Volatility 75 Index", decimals: 4, base: 101000, vol: 3.2 },
  { symbol: "R_100", label: "Volatility 100 Index", decimals: 2, base: 7000, vol: 4.5 },
  { symbol: "1HZ10V", label: "Volatility 10 (1s) Index", decimals: 2, base: 6500, vol: 1.1 },
  { symbol: "1HZ25V", label: "Volatility 25 (1s) Index", decimals: 2, base: 900, vol: 1.8 },
  { symbol: "1HZ50V", label: "Volatility 50 (1s) Index", decimals: 2, base: 250, vol: 2.6 },
  { symbol: "1HZ75V", label: "Volatility 75 (1s) Index", decimals: 2, base: 101000, vol: 3.8 },
  { symbol: "1HZ100V", label: "Volatility 100 (1s) Index", decimals: 2, base: 7000, vol: 5.2 },
];

export const MARKET_MAP = MARKETS.reduce((acc, m) => {
  acc[m.symbol] = m;
  return acc;
}, {});

const MAX_TICKS = 300;
const CONNECT_TIMEOUT_MS = 5000;
const PING_INTERVAL_MS = 25000;

function lastDigitOf(value, decimals) {
  const str = Number(value).toFixed(decimals);
  return Number(str[str.length - 1]);
}

export function useDerivFeed() {
  const [ticksBySymbol, setTicksBySymbol] = useState(() => {
    const init = {};
    MARKETS.forEach((m) => (init[m.symbol] = []));
    return init;
  });
  // connecting | live | sim
  const [status, setStatus] = useState("connecting");
  const [activeHost, setActiveHost] = useState(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const wsRef = useRef(null);
  const simTimers = useRef([]);
  const gotLiveTick = useRef(false);
  const stopped = useRef(false);
  const pingTimer = useRef(null);
  const connectTimer = useRef(null);
  const reconnectTimer = useRef(null);
  const hostIndex = useRef(0);
  const manualRetryToken = useRef(0);

  const pushTick = (symbol, quote, decimals) => {
    const digit = lastDigitOf(quote, decimals);
    setTicksBySymbol((prev) => {
      const arr = prev[symbol] ? prev[symbol].slice() : [];
      arr.push({ quote: Number(quote), digit, time: Date.now() });
      if (arr.length > MAX_TICKS) arr.shift();
      return { ...prev, [symbol]: arr };
    });
  };

  const pushHistory = (symbol, prices, decimals) => {
    if (!prices || !prices.length) return;
    setTicksBySymbol((prev) => {
      const existing = prev[symbol] || [];
      if (existing.length > 0) return prev; // don't clobber live data already arrived
      const arr = prices.slice(-MAX_TICKS).map((p, i) => ({
        quote: Number(p),
        digit: lastDigitOf(p, decimals),
        time: Date.now() - (prices.length - i) * 1000,
      }));
      return { ...prev, [symbol]: arr };
    });
  };

  const clearSim = () => {
    simTimers.current.forEach((t) => clearTimeout(t));
    simTimers.current = [];
  };

  const startSimulation = useCallback(() => {
    if (stopped.current || gotLiveTick.current) return;
    setStatus("sim");
    clearSim();
    const prices = {};
    MARKETS.forEach((m) => (prices[m.symbol] = m.base));
    MARKETS.forEach((m) => {
      const tick = () => {
        if (stopped.current || gotLiveTick.current) return;
        const drift = (Math.random() - 0.5) * m.vol;
        prices[m.symbol] = Math.max(0.01, prices[m.symbol] + drift);
        pushTick(m.symbol, prices[m.symbol], m.decimals);
        const delay = 500 + Math.random() * 900;
        const t = setTimeout(tick, delay);
        simTimers.current.push(t);
      };
      const initialDelay = Math.random() * 500;
      const t = setTimeout(tick, initialDelay);
      simTimers.current.push(t);
    });
  }, []);

  const cleanupSocket = () => {
    clearTimeout(connectTimer.current);
    clearInterval(pingTimer.current);
    if (wsRef.current) {
      try {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
      } catch (e) {}
    }
    wsRef.current = null;
  };

  const scheduleReconnect = useCallback(() => {
    if (stopped.current) return;
    const attempt = reconnectAttempt + 1;
    setReconnectAttempt(attempt);
    const delay = Math.min(20000, 1500 * Math.pow(1.5, Math.min(attempt, 8)));
    reconnectTimer.current = setTimeout(() => {
      connect();
    }, delay);
  }, [reconnectAttempt]);

  const connect = useCallback(() => {
    if (stopped.current) return;
    cleanupSocket();
    const host = WS_HOSTS[hostIndex.current % WS_HOSTS.length];
    hostIndex.current += 1;
    setActiveHost(host);
    if (!gotLiveTick.current) setStatus("connecting");

    let ws;
    try {
      ws = new WebSocket(wsUrl(host));
    } catch (e) {
      scheduleReconnect();
      if (!gotLiveTick.current) startSimulation();
      return;
    }
    wsRef.current = ws;

    connectTimer.current = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        try {
          ws.close();
        } catch (e) {}
        if (!gotLiveTick.current) startSimulation();
        scheduleReconnect();
      }
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      clearTimeout(connectTimer.current);
      setReconnectAttempt(0);
      MARKETS.forEach((m) => {
        // ticks_history with subscribe:1 gives us recent history AND
        // seamlessly starts a live tick subscription in one call.
        ws.send(
          JSON.stringify({
            ticks_history: m.symbol,
            adjust_start_time: 1,
            count: 60,
            end: "latest",
            style: "ticks",
            subscribe: 1,
          })
        );
      });
      pingTimer.current = setInterval(() => {
        try {
          ws.send(JSON.stringify({ ping: 1 }));
        } catch (e) {}
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.msg_type === "history" && msg.echo_req && msg.echo_req.ticks_history) {
          const sym = msg.echo_req.ticks_history;
          const market = MARKET_MAP[sym];
          if (market && msg.history && msg.history.prices) {
            pushHistory(sym, msg.history.prices, market.decimals);
          }
        } else if (msg.msg_type === "tick" && msg.tick) {
          const sym = msg.tick.symbol;
          const market = MARKET_MAP[sym];
          if (!market) return;
          if (!gotLiveTick.current) {
            gotLiveTick.current = true;
            clearSim();
            setStatus("live");
          }
          pushTick(sym, msg.tick.quote, market.decimals);
        } else if (msg.error) {
          // subscription-level error for one symbol; not fatal to the socket
          if (!gotLiveTick.current) startSimulation();
        }
      } catch (e) {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      if (!gotLiveTick.current) startSimulation();
    };

    ws.onclose = () => {
      clearInterval(pingTimer.current);
      if (stopped.current) return;
      gotLiveTick.current = false;
      setStatus((s) => (s === "live" ? "connecting" : s));
      startSimulation();
      scheduleReconnect();
    };
  }, [scheduleReconnect, startSimulation]);

  // Manual retry: resets backoff/host rotation and tries again immediately.
  const retryLive = useCallback(() => {
    manualRetryToken.current += 1;
    clearTimeout(reconnectTimer.current);
    setReconnectAttempt(0);
    hostIndex.current = 0;
    gotLiveTick.current = false;
    connect();
  }, [connect]);

  useEffect(() => {
    stopped.current = false;
    connect();

    return () => {
      stopped.current = true;
      clearTimeout(reconnectTimer.current);
      cleanupSocket();
      clearSim();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ticksBySymbol, status, activeHost, retryLive };
}
