import { useState, useEffect, useRef, useCallback, type JSX } from "react";

export type GameMessage = {
  action: string;
  [key: string]:
    | string
    | number
    | boolean
    | number[]
    | null;
};

export interface GameProps {
  role: "host" | "guest";
  myName: string;
  peerName: string;
  send: (msg: GameMessage) => void;
  onMessage: (handler: (msg: GameMessage) => void) => () => void;
  onExit: () => void;
}

interface WordItem {
  word: string;
  category: string;
}

const WORD_BANK: WordItem[] = [
  // Animals
  { word: "Elephant", category: "Animals" },
  { word: "Butterfly", category: "Animals" },
  { word: "Rabbit", category: "Animals" },
  { word: "Penguin", category: "Animals" },
  // Food
  { word: "Pizza", category: "Food" },
  { word: "Burger", category: "Food" },
  { word: "Ice cream", category: "Food" },
  { word: "Watermelon", category: "Food" },
  // Objects
  { word: "Umbrella", category: "Objects" },
  { word: "Camera", category: "Objects" },
  { word: "Bicycle", category: "Objects" },
  { word: "Clock", category: "Objects" },
  // Nature
  { word: "Rainbow", category: "Nature" },
  { word: "Mountain", category: "Nature" },
  { word: "Volcano", category: "Nature" },
  { word: "Sunflower", category: "Nature" },
  // Everyday activities
  { word: "Dancing", category: "Activities" },
  { word: "Swimming", category: "Activities" },
  { word: "Sleeping", category: "Activities" },
  { word: "Cooking", category: "Activities" },
];

type Phase = "lobby" | "drawing" | "round_end" | "game_over" | "peer_left";

interface Stroke {
  strokeId: number;
  color: string;
  size: number;
  isEraser: boolean;
  points: number[]; // [x0, y0, x1, y1, ...] normalized 0..1
}

const TOTAL_ROUNDS = 6; // 3 rounds each as drawer
const ROUND_TIME = 60; // 60 seconds per round

const PALETTE = [
  "#000000",
  "#ffffff",
  "#ef4444",
  "#3b82f6",
  "#10b981",
  "#fbbf24",
  "#f97316",
  "#a855f7",
];

const BRUSH_SIZES = [
  { label: "S", size: 3 },
  { label: "M", size: 6 },
  { label: "L", size: 12 },
];

export default function SkribblGame({
  role,
  myName,
  peerName,
  send,
  onMessage,
  onExit,
}: GameProps): JSX.Element {
  const isHost = role === "host";

  // Game state
  const [phase, setPhase] = useState<Phase>("lobby");
  const [gameId, setGameId] = useState<number>(1);
  const [round, setRound] = useState<number>(1);
  const [drawer, setDrawer] = useState<"host" | "guest">("host");
  const [secretWord, setSecretWord] = useState<string>("");
  const [wordCategory, setWordCategory] = useState<string>("");
  const [letterCount, setLetterCount] = useState<number>(0);
  const [revealedWord, setRevealedWord] = useState<string>("");
  const [timeLeft, setTimeLeft] = useState<number>(ROUND_TIME);
  const [scores, setScores] = useState<{ host: number; guest: number }>({ host: 0, guest: 0 });
  const [roundEndReason, setRoundEndReason] = useState<"correct" | "timeout" | null>(null);
  const [roundWinner, setRoundWinner] = useState<"host" | "guest" | null>(null);
  const [guessInput, setGuessInput] = useState<string>("");
  const [feedback, setFeedback] = useState<{ text: string; isCorrect: boolean } | null>(null);

  // Drawing Tools State
  const [color, setColor] = useState<string>("#ffffff");
  const [brushSize, setBrushSize] = useState<number>(6);
  const [isEraser, setIsEraser] = useState<boolean>(false);

  // Canvas Refs & Stroke Data
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const strokeCounterRef = useRef<number>(0);
  const isDrawingRef = useRef<boolean>(false);
  const batchBufferRef = useRef<number[]>([]);
  const batchSeqRef = useRef<number>(0);
  const lastSendTimeRef = useRef<number>(0);
  const timerIntervalRef = useRef<any>(null);

  // Track state in ref for message listeners
  const stateRef = useRef({
    phase,
    gameId,
    round,
    drawer,
    secretWord,
    wordCategory,
    letterCount,
    scores,
    timeLeft,
  });
  stateRef.current = {
    phase,
    gameId,
    round,
    drawer,
    secretWord,
    wordCategory,
    letterCount,
    scores,
    timeLeft,
  };

  // Safe send wrapper checking size limit (< 512 bytes)
  const safeSend = useCallback(
    (msg: GameMessage) => {
      const payloadStr = JSON.stringify(msg);
      if (payloadStr.length > 512) {
        console.warn("Message exceeded 512 bytes limit!", payloadStr.length, msg);
        return;
      }
      send(msg);
    },
    [send]
  );

  // Redraw complete canvas from stroke history
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas background
    ctx.fillStyle = "#18132b";
    ctx.fillRect(0, 0, width, height);

    // Draw all strokes
    strokesRef.current.forEach((stroke) => {
      const { color: sColor, size: sSize, isEraser: sEraser, points: sPts } = stroke;
      if (sPts.length < 2) return;

      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = sEraser ? "#18132b" : sColor;
      ctx.fillStyle = sEraser ? "#18132b" : sColor;
      ctx.lineWidth = sSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (sPts.length === 2) {
        // Single point tap
        const px = sPts[0] * width;
        const py = sPts[1] * height;
        ctx.arc(px, py, sSize / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.moveTo(sPts[0] * width, sPts[1] * height);
        for (let i = 2; i < sPts.length; i += 2) {
          ctx.lineTo(sPts[i] * width, sPts[i + 1] * height);
        }
        ctx.stroke();
      }
      ctx.restore();
    });
  }, []);

  // Flush batched points to peer (throttled to <= 10 msgs/sec)
  const flushBatchBuffer = useCallback(
    (forceEnd = false) => {
      const current = currentStrokeRef.current;
      if (!current) return;

      const pts = batchBufferRef.current;
      if (pts.length === 0 && !forceEnd) return;

      // Slice up to 16 numbers (8 coordinates) to keep packet well below 512 bytes
      const chunk = pts.splice(0, 16);
      batchSeqRef.current += 1;

      safeSend({
        action: "draw",
        op: forceEnd && pts.length === 0 ? "end" : "batch",
        strokeId: current.strokeId,
        seq: batchSeqRef.current,
        pts: chunk,
      });

      lastSendTimeRef.current = Date.now();
    },
    [safeSend]
  );

  // Helper to determine who draws for a given round
  const getRoundDrawer = useCallback((r: number, gId: number): "host" | "guest" => {
    // If gId is odd: Round 1 host, Round 2 guest, Round 3 host...
    // If gId is even: Round 1 guest, Round 2 host, Round 3 guest...
    const baseOffset = (gId - 1) % 2;
    const isRoundOdd = r % 2 === 1;
    if (baseOffset === 0) {
      return isRoundOdd ? "host" : "guest";
    } else {
      return isRoundOdd ? "guest" : "host";
    }
  }, []);

  // Pick random word from WORD_BANK
  const pickRandomWord = useCallback((): WordItem => {
    const idx = Math.floor(Math.random() * WORD_BANK.length);
    return WORD_BANK[idx];
  }, []);

  // Host starts next round
  const startRound = useCallback(
    (targetRound: number, gId: number) => {
      if (!isHost) return;

      const currentDrawer = getRoundDrawer(targetRound, gId);
      const chosen = pickRandomWord();

      // Clear strokes
      strokesRef.current = [];
      redrawCanvas();

      setRound(targetRound);
      setDrawer(currentDrawer);
      setWordCategory(chosen.category);
      setLetterCount(chosen.word.length);
      setRevealedWord("");
      setFeedback(null);
      setRoundEndReason(null);
      setRoundWinner(null);
      setTimeLeft(ROUND_TIME);
      setPhase("drawing");

      if (currentDrawer === "host") {
        // Host is drawer: host knows secret word
        setSecretWord(chosen.word);
        // Send to guest without secret word
        safeSend({
          action: "round",
          gameId: gId,
          round: targetRound,
          drawer: "host",
          category: chosen.category,
          letterCount: chosen.word.length,
          timeLeft: ROUND_TIME,
        });
      } else {
        // Guest is drawer: host sends secret word to guest only
        setSecretWord(""); // Host UI must NOT see secret word
        safeSend({
          action: "round",
          gameId: gId,
          round: targetRound,
          drawer: "guest",
          word: chosen.word,
          category: chosen.category,
          letterCount: chosen.word.length,
          timeLeft: ROUND_TIME,
        });
      }
    },
    [isHost, getRoundDrawer, pickRandomWord, redrawCanvas, safeSend]
  );

  // Host starts game
  const handleHostStart = useCallback(() => {
    if (!isHost) return;
    setGameId(1);
    setScores({ host: 0, guest: 0 });
    startRound(1, 1);
  }, [isHost, startRound]);

  // Host Authoritative Timer Effect
  useEffect(() => {
    if (!isHost || phase !== "drawing") {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      return;
    }

    timerIntervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;

          // Round expired with no correct guess
          const { round: curRound, secretWord: curWord, scores: curScores } = stateRef.current;
          setRoundEndReason("timeout");
          setRevealedWord(curWord);
          setPhase("round_end");

          safeSend({
            action: "roundEnd",
            round: curRound,
            reason: "timeout",
            word: curWord,
            hostScore: curScores.host,
            guestScore: curScores.guest,
          });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [isHost, phase, safeSend]);

  // Drawing event handlers (Touch & Mouse with normalized coordinates)
  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    let clientX = 0;
    let clientY = 0;

    if ("touches" in e) {
      if (e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if (e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
      }
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    const rawX = clientX - rect.left;
    const rawY = clientY - rect.top;

    // Normalize between 0 and 1, rounded to 3 decimal places
    const normX = Math.max(0, Math.min(1, Math.round((rawX / rect.width) * 1000) / 1000));
    const normY = Math.max(0, Math.min(1, Math.round((rawY / rect.height) * 1000) / 1000));

    return { x: normX, y: normY };
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (drawer !== role || phase !== "drawing") return;
    e.preventDefault();

    const { x, y } = getCoordinates(e);
    isDrawingRef.current = true;
    strokeCounterRef.current += 1;
    batchSeqRef.current = 0;
    batchBufferRef.current = [];

    const newStroke: Stroke = {
      strokeId: strokeCounterRef.current,
      color,
      size: brushSize,
      isEraser,
      points: [x, y],
    };

    currentStrokeRef.current = newStroke;
    strokesRef.current.push(newStroke);

    // Immediately render locally
    redrawCanvas();

    // Send stroke start message
    safeSend({
      action: "draw",
      op: "start",
      strokeId: newStroke.strokeId,
      color: newStroke.color,
      size: newStroke.size,
      isEraser: newStroke.isEraser,
      pts: [x, y],
    });
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawingRef.current || drawer !== role || phase !== "drawing") return;
    e.preventDefault();

    const { x, y } = getCoordinates(e);
    const current = currentStrokeRef.current;
    if (!current) return;

    // Append to local stroke points
    current.points.push(x, y);
    // Append to network buffer
    batchBufferRef.current.push(x, y);

    // Fast local redraw
    redrawCanvas();

    // Throttle network dispatch: max 10 messages per second (100ms interval)
    const now = Date.now();
    if (now - lastSendTimeRef.current >= 100) {
      flushBatchBuffer(false);
    }
  };

  const handlePointerUp = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawingRef.current || drawer !== role || phase !== "drawing") return;
    e.preventDefault();

    isDrawingRef.current = false;
    flushBatchBuffer(true);
    currentStrokeRef.current = null;
  };

  // Undo Last Stroke
  const handleUndo = () => {
    if (drawer !== role || phase !== "drawing") return;
    if (strokesRef.current.length === 0) return;

    const removed = strokesRef.current.pop();
    redrawCanvas();

    safeSend({
      action: "draw",
      op: "undo",
      strokeId: removed ? removed.strokeId : 0,
    });
  };

  // Clear Canvas
  const handleClear = () => {
    if (drawer !== role || phase !== "drawing") return;
    strokesRef.current = [];
    redrawCanvas();

    safeSend({
      action: "draw",
      op: "clear",
    });
  };

  // Guesser submits guess
  const handleGuessSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (drawer === role || phase !== "drawing") return;
    const cleanGuess = guessInput.trim().toLowerCase();
    if (!cleanGuess) return;

    setGuessInput("");

    if (drawer === "guest") {
      // Guest is drawer, Host is guessing
      // Host sends guess to guest to validate locally
      safeSend({
        action: "guess",
        text: cleanGuess,
        round: stateRef.current.round,
        by: "host",
      });
    } else {
      // Host is drawer, Guest is guessing
      // Guest sends guess to host to validate locally
      safeSend({
        action: "guess",
        text: cleanGuess,
        round: stateRef.current.round,
        by: "guest",
      });
    }
  };

  // Transition to next round or finish game
  const handleNextRound = () => {
    if (isHost) {
      if (round >= TOTAL_ROUNDS) {
        setPhase("game_over");
        safeSend({
          action: "round",
          isGameOver: true,
          hostScore: scores.host,
          guestScore: scores.guest,
        });
      } else {
        startRound(round + 1, gameId);
      }
    } else {
      safeSend({ action: "round", by: "guest" });
    }
  };

  // Rematch
  const handleRematch = () => {
    const nextGameId = gameId + 1;
    if (isHost) {
      setGameId(nextGameId);
      setScores({ host: 0, guest: 0 });
      startRound(1, nextGameId);
      safeSend({
        action: "rematch",
        gameId: nextGameId,
        hostScore: 0,
        guestScore: 0,
      });
    } else {
      safeSend({ action: "rematch", by: "guest" });
    }
  };

  // Leave
  const handleLeave = () => {
    safeSend({ action: "leave", by: role });
    onExit();
  };

  // Message Handler & Synchronization
  useEffect(() => {
    const unsubscribe = onMessage((msg: GameMessage) => {
      if (!msg || typeof msg.action !== "string") return;

      // Handle Leave
      if (msg.action === "leave") {
        setPhase("peer_left");
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        return;
      }

      // 1. ROUND INITIALIZATION
      if (msg.action === "round") {
        if (!isHost) {
          if (msg.isGameOver === true) {
            setPhase("game_over");
            return;
          }
          const curRound = typeof msg.round === "number" ? msg.round : 1;
          const curDrawer = msg.drawer === "guest" ? "guest" : "host";
          const cat = typeof msg.category === "string" ? msg.category : "";
          const lCount = typeof msg.letterCount === "number" ? msg.letterCount : 0;
          const sWord = typeof msg.word === "string" ? msg.word : "";

          strokesRef.current = [];
          redrawCanvas();

          setRound(curRound);
          setDrawer(curDrawer);
          setWordCategory(cat);
          setLetterCount(lCount);
          setSecretWord(sWord); // Only populated if Guest is drawer
          setRevealedWord("");
          setFeedback(null);
          setRoundEndReason(null);
          setRoundWinner(null);
          setTimeLeft(ROUND_TIME);
          setPhase("drawing");
        } else {
          if (msg.by === "guest" && stateRef.current.phase === "round_end") {
            handleNextRound();
          }
        }
        return;
      }

      // 2. DRAWING SYNCHRONIZATION
      if (msg.action === "draw") {
        const op = msg.op;
        if (op === "start") {
          const sId = typeof msg.strokeId === "number" ? msg.strokeId : Date.now();
          const sColor = typeof msg.color === "string" ? msg.color : "#ffffff";
          const sSize = typeof msg.size === "number" ? msg.size : 6;
          const sEraser = Boolean(msg.isEraser);
          const pts = Array.isArray(msg.pts) ? (msg.pts as number[]) : [];

          const newStroke: Stroke = {
            strokeId: sId,
            color: sColor,
            size: sSize,
            isEraser: sEraser,
            points: [...pts],
          };
          strokesRef.current.push(newStroke);
          redrawCanvas();
        } else if (op === "batch" || op === "end") {
          const sId = typeof msg.strokeId === "number" ? msg.strokeId : 0;
          const pts = Array.isArray(msg.pts) ? (msg.pts as number[]) : [];
          const target = strokesRef.current.find((s) => s.strokeId === sId);
          if (target && pts.length > 0) {
            target.points.push(...pts);
            redrawCanvas();
          }
        } else if (op === "undo") {
          strokesRef.current.pop();
          redrawCanvas();
        } else if (op === "clear") {
          strokesRef.current = [];
          redrawCanvas();
        }
        return;
      }

      // 3. GUESS SUBMISSION (Validated locally by Drawer)
      if (msg.action === "guess") {
        const guessText = typeof msg.text === "string" ? msg.text.trim().toLowerCase() : "";
        const curRound = typeof msg.round === "number" ? msg.round : stateRef.current.round;
        const secret = stateRef.current.secretWord.trim().toLowerCase();

        // Check if guess matches
        if (secret && guessText === secret) {
          // Drawer validates that guess is correct!
          if (isHost) {
            // Host is drawer, Guest guessed correctly!
            const newScores = {
              host: stateRef.current.scores.host + 5, // Drawer gets 5 pts
              guest: stateRef.current.scores.guest + 10, // Guesser gets 10 pts
            };
            setScores(newScores);
            setRoundWinner("guest");
            setRoundEndReason("correct");
            setRevealedWord(stateRef.current.secretWord);
            setPhase("round_end");

            safeSend({
              action: "roundEnd",
              round: curRound,
              reason: "correct",
              winner: "guest",
              word: stateRef.current.secretWord,
              hostScore: newScores.host,
              guestScore: newScores.guest,
            });
          } else {
            // Guest is drawer, Host guessed correctly!
            // Guest notifies Host of correct guess
            safeSend({
              action: "correct",
              round: curRound,
              by: "host",
              guess: guessText,
            });
          }
        } else {
          // Incorrect guess feedback
          setFeedback({
            text: `Peer guessed "${guessText}"`,
            isCorrect: false,
          });
        }
        return;
      }

      // 4. CORRECT GUESS CONFIRMATION (Received by Host when Guest is drawer)
      if (msg.action === "correct") {
        if (isHost && stateRef.current.phase === "drawing") {
          const curRound = typeof msg.round === "number" ? msg.round : stateRef.current.round;
          const word = typeof msg.guess === "string" ? msg.guess : "";
          const newScores = {
            host: stateRef.current.scores.host + 10, // Guesser (Host) gets 10 pts
            guest: stateRef.current.scores.guest + 5, // Drawer (Guest) gets 5 pts
          };
          setScores(newScores);
          setRoundWinner("host");
          setRoundEndReason("correct");
          setRevealedWord(word);
          setPhase("round_end");

          safeSend({
            action: "roundEnd",
            round: curRound,
            reason: "correct",
            winner: "host",
            word,
            hostScore: newScores.host,
            guestScore: newScores.guest,
          });
        }
        return;
      }

      // 5. ROUND END (Broadcast by Host)
      if (msg.action === "roundEnd") {
        if (!isHost) {
          if (typeof msg.hostScore === "number" && typeof msg.guestScore === "number") {
            setScores({ host: msg.hostScore, guest: msg.guestScore });
          }
          if (typeof msg.word === "string") setRevealedWord(msg.word);
          if (msg.reason === "correct" || msg.reason === "timeout") setRoundEndReason(msg.reason);
          if (msg.winner === "host" || msg.winner === "guest") setRoundWinner(msg.winner);
          setPhase("round_end");
        }
        return;
      }

      // 6. REMATCH
      if (msg.action === "rematch") {
        if (isHost) {
          handleRematch();
        } else {
          const nextGId = typeof msg.gameId === "number" ? msg.gameId : gameId + 1;
          setGameId(nextGId);
          setScores({ host: 0, guest: 0 });
        }
        return;
      }
    });

    return () => {
      unsubscribe();
    };
  }, [isHost, onMessage, redrawCanvas, safeSend, handleNextRound, handleRematch, gameId]);

  // Generate blank spaces for guesser: e.g. "E L E P H A N T" or "_ _ _ _ _ _ _ _"
  const getHintDisplay = () => {
    if (drawer === role) {
      return secretWord ? secretWord.toUpperCase() : "...";
    }
    if (letterCount <= 0) return "...";
    return Array(letterCount).fill("_").join(" ");
  };

  const isMyTurnToDraw = drawer === role;
  const drawerName = drawer === role ? myName : peerName;

  return (
    <div className="w-full max-w-[384px] min-w-[320px] h-[420px] max-h-[420px] flex flex-col justify-between p-2 select-none overflow-hidden font-sans text-[#f8f4ff] bg-transparent">
      {/* Top Header: Scores, Round, Timer, Leave */}
      <div className="flex items-center justify-between border-b border-white/10 pb-1.5 px-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <span className="text-[#f9a8d4] truncate max-w-[80px]" title={role === "host" ? myName : peerName}>
            {role === "host" ? myName : peerName}: {scores.host}
          </span>
          <span className="text-white/40">vs</span>
          <span className="text-[#7dd3fc] truncate max-w-[80px]" title={role === "guest" ? myName : peerName}>
            {role === "guest" ? myName : peerName}: {scores.guest}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {phase === "drawing" && (
            <div
              className={`flex items-center gap-1 text-xs font-mono font-bold px-2 py-0.5 rounded-full ${
                timeLeft <= 15 ? "bg-rose-500/20 text-rose-300 animate-pulse" : "bg-white/10 text-[#f8f4ff]"
              }`}
            >
              <span>⏱</span>
              <span>{timeLeft}s</span>
            </div>
          )}

          {phase !== "lobby" && phase !== "game_over" && phase !== "peer_left" && (
            <span className="text-[11px] font-medium bg-white/10 px-2 py-0.5 rounded-full text-[#b3a6cc]">
              R{round}/{TOTAL_ROUNDS}
            </span>
          )}

          <button
            onClick={handleLeave}
            className="text-[11px] text-[#b3a6cc] hover:text-[#f8f4ff] hover:bg-white/10 px-2 py-1 rounded transition-colors"
          >
            Leave
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex flex-col justify-center items-center py-1 overflow-hidden">
        {/* LOBBY PHASE */}
        {phase === "lobby" && (
          <div className="flex flex-col items-center justify-center gap-3 w-full animate-fadeIn text-center">
            <div className="text-4xl animate-bounce">🎨</div>
            <h2 className="text-lg font-bold text-[#f8f4ff]">Skribbl: Draw & Guess</h2>
            <p className="text-xs text-[#b3a6cc] max-w-[270px]">
              One draws, one guesses! Guess correctly to score 10 pts; drawer earns 5 bonus pts!
            </p>
            {isHost ? (
              <button
                onClick={handleHostStart}
                className="min-h-[44px] min-w-[140px] px-6 py-2.5 rounded-xl font-semibold text-sm bg-gradient-to-r from-[#ff3d7f] to-[#ff7a59] text-white shadow-lg active:scale-95 transition-transform"
              >
                Start Game
              </button>
            ) : (
              <div className="flex items-center gap-2 text-xs text-[#b3a6cc] py-2">
                <span className="w-2 h-2 rounded-full bg-[#fbbf24] animate-ping" />
                Waiting for {peerName} to start...
              </div>
            )}
          </div>
        )}

        {/* ACTIVE DRAWING & GUESSING PHASE */}
        {phase === "drawing" && (
          <div className="flex flex-col items-center w-full h-full justify-between">
            {/* Word / Hint Bar */}
            <div className="flex items-center justify-between w-full px-2 py-0.5 text-xs">
              <span className="text-[#b3a6cc] text-[11px]">
                {isMyTurnToDraw ? "Drawing:" : "Guessing:"}
              </span>
              <span className="font-bold tracking-widest text-[#f8f4ff] font-mono text-sm bg-black/30 px-2 py-0.5 rounded border border-white/10">
                {getHintDisplay()}
              </span>
              <span className="text-[10px] bg-white/10 text-indigo-200 px-1.5 py-0.5 rounded">
                {wordCategory || "General"}
              </span>
            </div>

            {/* Drawing Canvas */}
            <div className="relative w-full flex-1 max-h-[200px] rounded-xl overflow-hidden border border-white/20 bg-[#18132b] shadow-inner my-1 touch-none">
              <canvas
                ref={canvasRef}
                width={350}
                height={200}
                className="w-full h-full block cursor-crosshair touch-none"
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                onMouseLeave={handlePointerUp}
                onTouchStart={handlePointerDown}
                onTouchMove={handlePointerMove}
                onTouchEnd={handlePointerUp}
                onTouchCancel={handlePointerUp}
              />
              {!isMyTurnToDraw && (
                <div className="absolute top-2 left-2 text-[10px] text-[#b3a6cc] bg-black/40 px-2 py-0.5 rounded-full pointer-events-none">
                  ✏️ {drawerName} is drawing...
                </div>
              )}
            </div>

            {/* Interactive Controls Bar */}
            {isMyTurnToDraw ? (
              /* DRAWER TOOLBAR */
              <div className="w-full flex flex-col gap-1 px-1">
                <div className="flex items-center justify-between w-full">
                  {/* Colors */}
                  <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                    {PALETTE.map((pColor) => (
                      <button
                        key={pColor}
                        onClick={() => {
                          setColor(pColor);
                          setIsEraser(false);
                        }}
                        style={{ backgroundColor: pColor }}
                        className={`w-6 h-6 rounded-full border transition-transform ${
                          color === pColor && !isEraser
                            ? "scale-125 border-white ring-2 ring-white/40"
                            : "border-white/20 hover:scale-110"
                        }`}
                        title={pColor}
                      />
                    ))}
                  </div>

                  {/* Eraser */}
                  <button
                    onClick={() => setIsEraser(!isEraser)}
                    className={`min-h-[32px] px-2.5 py-1 text-xs rounded-lg font-medium border transition-colors ${
                      isEraser
                        ? "bg-rose-500/30 text-rose-300 border-rose-400"
                        : "bg-white/10 text-[#b3a6cc] border-white/10 hover:text-white"
                    }`}
                  >
                    🧹 Eraser
                  </button>
                </div>

                <div className="flex items-center justify-between w-full">
                  {/* Brush Sizes */}
                  <div className="flex items-center gap-1">
                    {BRUSH_SIZES.map((b) => (
                      <button
                        key={b.size}
                        onClick={() => setBrushSize(b.size)}
                        className={`min-w-[28px] h-7 text-xs rounded font-bold border transition-colors ${
                          brushSize === b.size
                            ? "bg-indigo-600 text-white border-indigo-400"
                            : "bg-white/5 text-[#b3a6cc] border-white/10 hover:text-white"
                        }`}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>

                  {/* Undo & Clear */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={handleUndo}
                      className="min-h-[32px] px-2.5 py-1 text-xs rounded-lg bg-white/10 text-[#b3a6cc] hover:text-white border border-white/10 active:scale-95"
                    >
                      ↩ Undo
                    </button>
                    <button
                      onClick={handleClear}
                      className="min-h-[32px] px-2.5 py-1 text-xs rounded-lg bg-white/10 text-[#b3a6cc] hover:text-white border border-white/10 active:scale-95"
                    >
                      🗑 Clear
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* GUESSER INPUT FORM */
              <div className="w-full flex flex-col gap-1 px-1">
                <form onSubmit={handleGuessSubmit} className="flex items-center gap-2 w-full">
                  <input
                    type="text"
                    value={guessInput}
                    onChange={(e) => setGuessInput(e.target.value)}
                    placeholder="Type your guess here..."
                    maxLength={30}
                    className="flex-1 min-h-[44px] px-3 rounded-xl bg-white/10 border border-white/20 text-[#f8f4ff] placeholder-white/40 text-xs focus:outline-none focus:border-[#7dd3fc]"
                  />
                  <button
                    type="submit"
                    className="min-h-[44px] px-5 rounded-xl bg-gradient-to-r from-[#ff3d7f] to-[#ff7a59] text-white font-bold text-xs shadow-md active:scale-95"
                  >
                    Guess
                  </button>
                </form>

                {feedback && (
                  <div className="text-[11px] text-center text-amber-300 font-medium truncate">
                    {feedback.text}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ROUND END RESULT */}
        {phase === "round_end" && (
          <div className="flex flex-col items-center justify-center gap-2 w-full animate-fadeIn text-center">
            <div className="text-3xl">
              {roundEndReason === "correct" ? "🎉" : "⏰"}
            </div>

            <h3 className="text-sm font-bold text-[#f8f4ff]">
              {roundEndReason === "correct"
                ? `${roundWinner === role ? "You" : peerName} guessed the word!`
                : "Time's up! No one guessed the word."}
            </h3>

            <div className="py-2 px-4 rounded-xl bg-white/5 border border-white/10 my-1">
              <div className="text-[11px] text-[#b3a6cc]">The secret word was:</div>
              <div className="text-base font-extrabold text-[#34d399] tracking-wider uppercase">
                {revealedWord || secretWord}
              </div>
            </div>

            <p className="text-xs text-[#b3a6cc]">
              {roundEndReason === "correct"
                ? "+10 pts to Guesser, +5 pts bonus to Drawer"
                : "+0 pts awarded"}
            </p>

            <button
              onClick={handleNextRound}
              className="min-h-[44px] min-w-[140px] px-6 py-2 rounded-xl bg-gradient-to-r from-[#ff3d7f] to-[#ff7a59] text-white font-semibold text-xs shadow-md active:scale-95 transition-all mt-1"
            >
              {round >= TOTAL_ROUNDS ? "See Final Results →" : "Next Round →"}
            </button>
          </div>
        )}

        {/* GAME OVER */}
        {phase === "game_over" && (
          <div className="flex flex-col items-center justify-center gap-2.5 w-full animate-fadeIn text-center">
            <div className="text-3xl">🏆</div>
            <h3 className="text-base font-bold text-[#f8f4ff]">
              {scores.host > scores.guest
                ? role === "host"
                  ? "🎉 You Won the Game!"
                  : `👏 ${peerName} Won the Game!`
                : scores.guest > scores.host
                ? role === "guest"
                  ? "🎉 You Won the Game!"
                  : `👏 ${peerName} Won the Game!`
                : "🤝 It's a Friendly Draw!"}
            </h3>

            <div className="flex items-center justify-center gap-4 py-2 px-4 rounded-xl bg-white/5 border border-white/10 my-1">
              <div className="text-center">
                <div className="text-xs text-[#f9a8d4] font-semibold">{myName}</div>
                <div className="text-xl font-extrabold text-white">{role === "host" ? scores.host : scores.guest}</div>
              </div>
              <div className="text-sm text-white/30 font-bold">:</div>
              <div className="text-center">
                <div className="text-xs text-[#7dd3fc] font-semibold">{peerName}</div>
                <div className="text-xl font-extrabold text-white">{role === "host" ? scores.guest : scores.host}</div>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={handleRematch}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-gradient-to-r from-[#ff3d7f] to-[#ff7a59] text-white font-semibold text-xs shadow-md active:scale-95 transition-transform"
              >
                Play Again
              </button>
              <button
                onClick={handleLeave}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-[#b3a6cc] hover:text-white font-medium text-xs transition-colors"
              >
                Exit
              </button>
            </div>
          </div>
        )}

        {/* PEER LEFT */}
        {phase === "peer_left" && (
          <div className="flex flex-col items-center justify-center gap-3 w-full animate-fadeIn text-center">
            <div className="text-3xl">👋</div>
            <h3 className="text-sm font-semibold text-[#f8f4ff]">{peerName} left the game.</h3>
            <p className="text-xs text-[#b3a6cc]">The drawing session has ended.</p>
            <button
              onClick={onExit}
              className="min-h-[44px] px-6 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-[#f8f4ff] text-xs font-semibold transition-colors mt-2"
            >
              Close
            </button>
          </div>
        )}
      </div>

      {/* Footer bar */}
      <div className="border-t border-white/10 pt-1 flex items-center justify-between text-[11px] text-[#b3a6cc] px-1">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#f9a8d4]" />
          <span>You: {myName}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#7dd3fc]" />
          <span>Peer: {peerName}</span>
        </div>
      </div>
    </div>
  );
}
