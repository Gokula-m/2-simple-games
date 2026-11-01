import { useState, useRef, useCallback, useEffect } from "react";
import MemoryMatchGame from "../games/memory-match";
import SkribblGame, { GameMessage } from "../games/skribbl";

export interface TwoPlayerTestProps {
  gameType?: "memorymatch" | "skribbl";
}

export function TwoPlayerTest({ gameType = "memorymatch" }: TwoPlayerTestProps) {
  // Config
  const [panelWidth, setPanelWidth] = useState<number>(384); // 320 to 384
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [dropPackets, setDropPackets] = useState<boolean>(false);

  // Stats
  const [maxMsgSize, setMaxMsgSize] = useState<number>(0);
  const [maxMsgRate, setMaxMsgRate] = useState<number>(0);
  const [currentMsgRate, setCurrentMsgRate] = useState<number>(0);

  // Rate tracking
  const msgTimestampsRef = useRef<number[]>([]);

  // Subscriptions
  const hostHandlerRef = useRef<((msg: GameMessage) => void) | null>(null);
  const guestHandlerRef = useRef<((msg: GameMessage) => void) | null>(null);

  // Rolling message rate check
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      msgTimestampsRef.current = msgTimestampsRef.current.filter((t) => now - t <= 1000);
      const rate = msgTimestampsRef.current.length;
      setCurrentMsgRate(rate);
      setMaxMsgRate((prev) => Math.max(prev, rate));
    }, 250);
    return () => clearInterval(interval);
  }, []);

  const recordMessage = useCallback((_sender: "host" | "guest", msg: GameMessage) => {
    const payloadStr = JSON.stringify(msg);
    const size = new TextEncoder().encode(payloadStr).length;
    if (size > 512) {
      console.warn("Message exceeded 512 bytes limit!", size, msg);
    }

    const now = Date.now();
    msgTimestampsRef.current.push(now);
    setMaxMsgSize((prev) => Math.max(prev, size));
  }, []);

  // Host send implementation
  const hostSend = useCallback(
    (msg: GameMessage) => {
      recordMessage("host", msg);

      if (dropPackets && Math.random() < 0.2) {
        console.warn("[Simulated Drop] Host message dropped:", msg);
        return;
      }

      const dispatch = () => {
        if (guestHandlerRef.current) {
          guestHandlerRef.current(JSON.parse(JSON.stringify(msg)));
        }
      };

      if (latencyMs > 0) {
        setTimeout(dispatch, latencyMs);
      } else {
        dispatch();
      }
    },
    [dropPackets, latencyMs, recordMessage]
  );

  // Guest send implementation
  const guestSend = useCallback(
    (msg: GameMessage) => {
      recordMessage("guest", msg);

      if (dropPackets && Math.random() < 0.2) {
        console.warn("[Simulated Drop] Guest message dropped:", msg);
        return;
      }

      const dispatch = () => {
        if (hostHandlerRef.current) {
          hostHandlerRef.current(JSON.parse(JSON.stringify(msg)));
        }
      };

      if (latencyMs > 0) {
        setTimeout(dispatch, latencyMs);
      } else {
        dispatch();
      }
    },
    [dropPackets, latencyMs, recordMessage]
  );

  // Host onMessage
  const hostOnMessage = useCallback((handler: (msg: GameMessage) => void) => {
    hostHandlerRef.current = handler;
    return () => {
      hostHandlerRef.current = null;
    };
  }, []);

  // Guest onMessage
  const guestOnMessage = useCallback((handler: (msg: GameMessage) => void) => {
    guestHandlerRef.current = handler;
    return () => {
      guestHandlerRef.current = null;
    };
  }, []);

  // Exit handlers
  const handleHostExit = useCallback(() => {
    console.log("Host clicked Exit");
  }, []);

  const handleGuestExit = useCallback(() => {
    console.log("Guest clicked Exit");
  }, []);

  // Injection test buttons
  const injectInvalidMessage = () => {
    if (guestHandlerRef.current) {
      guestHandlerRef.current({ action: "malformed_unknown_action", dummy: true });
    }
  };

  const injectDuplicateDraw = () => {
    if (guestHandlerRef.current) {
      guestHandlerRef.current({
        action: "draw",
        op: "batch",
        strokeId: 999,
        seq: 1,
        pts: [0.1, 0.2, 0.3, 0.4],
      });
    }
  };

  return (
    <div className="flex flex-col gap-5 w-full max-w-6xl mx-auto p-4">
      {/* Test Control & Metrics Bar */}
      <div className="bg-[#130d24] border border-white/10 rounded-2xl p-4 shadow-xl flex flex-wrap items-center justify-between gap-4">
        {/* Compliance badges */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-xl">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-xs font-semibold text-emerald-300">
              Max Size: {maxMsgSize}B / 512B
            </span>
            <span className="text-[10px] text-emerald-400 font-bold uppercase">
              {maxMsgSize <= 512 ? "PASS" : "FAIL"}
            </span>
          </div>

          <div className="flex items-center gap-2 bg-sky-500/10 border border-sky-500/30 px-3 py-1.5 rounded-xl">
            <span className="w-2 h-2 rounded-full bg-sky-400" />
            <span className="text-xs font-semibold text-sky-300">
              Rate: {currentMsgRate} msg/s (Peak: {maxMsgRate})
            </span>
            <span className="text-[10px] text-sky-400 font-bold uppercase">
              {maxMsgRate <= 10 ? "PASS" : "WARN"}
            </span>
          </div>
        </div>

        {/* Panel Width & Network Sim Controls */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-1.5 rounded-xl">
            <span className="text-[#b3a6cc]">Width:</span>
            <button
              onClick={() => setPanelWidth(320)}
              className={`px-2 py-0.5 rounded font-medium ${
                panelWidth === 320 ? "bg-indigo-600 text-white" : "text-[#b3a6cc] hover:text-white"
              }`}
            >
              320px
            </button>
            <button
              onClick={() => setPanelWidth(384)}
              className={`px-2 py-0.5 rounded font-medium ${
                panelWidth === 384 ? "bg-indigo-600 text-white" : "text-[#b3a6cc] hover:text-white"
              }`}
            >
              384px (Max)
            </button>
          </div>

          <div className="flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-1.5 rounded-xl">
            <span className="text-[#b3a6cc]">Sim Latency:</span>
            {[0, 100, 300].map((lat) => (
              <button
                key={lat}
                onClick={() => setLatencyMs(lat)}
                className={`px-2 py-0.5 rounded font-medium ${
                  latencyMs === lat ? "bg-indigo-600 text-white" : "text-[#b3a6cc] hover:text-white"
                }`}
              >
                {lat}ms
              </button>
            ))}
          </div>

          <button
            onClick={() => setDropPackets(!dropPackets)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
              dropPackets
                ? "bg-rose-500/20 text-rose-300 border-rose-400"
                : "bg-white/5 text-[#b3a6cc] border-white/10 hover:text-white"
            }`}
          >
            {dropPackets ? "Drop 20% Packets (ON)" : "Drop Packets (OFF)"}
          </button>

          <button
            onClick={injectInvalidMessage}
            className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-amber-300 text-xs font-medium"
            title="Inject an invalid message to test rejection"
          >
            Inject Invalid
          </button>

          <button
            onClick={injectDuplicateDraw}
            className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-amber-300 text-xs font-medium"
            title="Inject duplicate stroke data"
          >
            Inject Duplicate
          </button>
        </div>
      </div>

      {/* Side-by-Side In-Call Simulation Panels */}
      <div className="flex flex-wrap items-center justify-center gap-8 py-2">
        {/* HOST PANEL */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-[#f9a8d4]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#f9a8d4]" />
            Host View (Alice) • Role: host • {panelWidth}px × 420px
          </div>
          <div
            style={{ width: `${panelWidth}px`, height: "420px" }}
            className="bg-[#120b22]/90 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col relative"
          >
            {gameType === "memorymatch" ? (
              <MemoryMatchGame
                key={`host-${gameType}`}
                role="host"
                myName="Alice (Host)"
                peerName="Bob (Guest)"
                send={hostSend}
                onMessage={hostOnMessage}
                onExit={handleHostExit}
              />
            ) : (
              <SkribblGame
                key={`host-${gameType}`}
                role="host"
                myName="Alice (Host)"
                peerName="Bob (Guest)"
                send={hostSend}
                onMessage={hostOnMessage}
                onExit={handleHostExit}
              />
            )}
          </div>
        </div>

        {/* GUEST PANEL */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-[#7dd3fc]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#7dd3fc]" />
            Guest View (Bob) • Role: guest • {panelWidth}px × 420px
          </div>
          <div
            style={{ width: `${panelWidth}px`, height: "420px" }}
            className="bg-[#120b22]/90 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col relative"
          >
            {gameType === "memorymatch" ? (
              <MemoryMatchGame
                key={`guest-${gameType}`}
                role="guest"
                myName="Bob (Guest)"
                peerName="Alice (Host)"
                send={guestSend}
                onMessage={guestOnMessage}
                onExit={handleGuestExit}
              />
            ) : (
              <SkribblGame
                key={`guest-${gameType}`}
                role="guest"
                myName="Bob (Guest)"
                peerName="Alice (Host)"
                send={guestSend}
                onMessage={guestOnMessage}
                onExit={handleGuestExit}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
