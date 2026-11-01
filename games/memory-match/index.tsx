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

export interface EmojiItem {
  id: number;
  emoji: string;
  name: string;
}

export const EMOJI_PAIRS: EmojiItem[] = [
  { id: 1, emoji: "🐱", name: "Cat" },
  { id: 2, emoji: "🐼", name: "Panda" },
  { id: 3, emoji: "🦋", name: "Butterfly" },
  { id: 4, emoji: "🍕", name: "Pizza" },
  { id: 5, emoji: "🌈", name: "Rainbow" },
  { id: 6, emoji: "❤️", name: "Heart" },
  { id: 7, emoji: "🌻", name: "Sunflower" },
  { id: 8, emoji: "🍦", name: "Ice cream" },
];

export interface CardState {
  index: number;
  state: "hidden" | "revealed" | "matched";
  emojiId: number | null;
}

type Phase = "lobby" | "playing" | "game_over" | "peer_left";

const TOTAL_PAIRS = 8;
const BOARD_SIZE = 16;

export default function MemoryMatchGame({
  role,
  myName,
  peerName,
  send,
  onMessage,
  onExit,
}: GameProps): JSX.Element {
  const isHost = role === "host";

  // Game State
  const [phase, setPhase] = useState<Phase>("lobby");
  const [gameId, setGameId] = useState<number>(1);
  const [turn, setTurn] = useState<"host" | "guest">("host");
  const [scores, setScores] = useState<{ host: number; guest: number }>({ host: 0, guest: 0 });
  const [matchedPairs, setMatchedPairs] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>("Tap two cards to find a match!");
  const [cards, setCards] = useState<CardState[]>(() =>
    Array.from({ length: BOARD_SIZE }, (_, i) => ({
      index: i,
      state: "hidden",
      emojiId: null,
    }))
  );

  // Host Private Deck (16 emoji IDs: each 1..8 appears twice)
  const hostDeckRef = useRef<number[]>([]);
  // Currently revealed card indices in active turn (0, 1, or 2)
  const revealedIndicesRef = useRef<number[]>([]);
  // Lock flag while mismatch timeout is pending
  const isLockedRef = useRef<boolean>(false);
  const mismatchTimeoutRef = useRef<any>(null);

  // Track latest state for message handler validation
  const stateRef = useRef({
    phase,
    gameId,
    turn,
    scores,
    matchedPairs,
    cards,
  });
  stateRef.current = {
    phase,
    gameId,
    turn,
    scores,
    matchedPairs,
    cards,
  };

  // Safe Send with message size validation (< 512 bytes)
  const safeSend = useCallback(
    (msg: GameMessage) => {
      const serialized = JSON.stringify(msg);
      if (serialized.length > 512) {
        console.warn("Message exceeded 512 bytes limit:", serialized.length, msg);
        return;
      }
      send(msg);
    },
    [send]
  );

  // Generate & Shuffle 16-card deck (Host authoritative)
  const generateShuffledDeck = useCallback((): number[] => {
    // 8 pairs: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8]
    const deck: number[] = [];
    EMOJI_PAIRS.forEach((item) => {
      deck.push(item.id, item.id);
    });

    // Fisher-Yates shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }, []);

  // Determine who starts a given game session
  // Game 1: host, Game 2: guest, Game 3: host...
  const getGameStarter = useCallback((gId: number): "host" | "guest" => {
    return gId % 2 === 1 ? "host" : "guest";
  }, []);

  // Host starts game
  const handleHostStart = useCallback(() => {
    if (!isHost) return;

    if (mismatchTimeoutRef.current) {
      clearTimeout(mismatchTimeoutRef.current);
      mismatchTimeoutRef.current = null;
    }

    const starter = getGameStarter(1);
    const newDeck = generateShuffledDeck();
    hostDeckRef.current = newDeck;
    revealedIndicesRef.current = [];
    isLockedRef.current = false;

    setGameId(1);
    setTurn(starter);
    setScores({ host: 0, guest: 0 });
    setMatchedPairs(0);
    setStatusMessage(starter === role ? "Your turn! Tap a card." : `${peerName}'s turn!`);
    setCards(
      Array.from({ length: BOARD_SIZE }, (_, i) => ({
        index: i,
        state: "hidden",
        emojiId: null,
      }))
    );
    setPhase("playing");

    // Broadcast start WITHOUT sending complete deck (per security requirement 9.3)
    safeSend({
      action: "start",
      gameId: 1,
      boardSize: BOARD_SIZE,
      turn: starter,
      hostScore: 0,
      guestScore: 0,
    });
  }, [isHost, getGameStarter, generateShuffledDeck, role, peerName, safeSend]);

  // Host processes a card flip
  const processCardFlip = useCallback(
    (cardIndex: number, byRole: "host" | "guest") => {
      if (!isHost) return;

      const { phase: curPhase, gameId: curGameId, turn: curTurn, scores: curScores, matchedPairs: curPairs, cards: curCards } = stateRef.current;
      if (curPhase !== "playing") return;
      if (isLockedRef.current) return;
      if (byRole !== curTurn) return;
      if (cardIndex < 0 || cardIndex >= BOARD_SIZE) return;

      const targetCard = curCards[cardIndex];
      if (!targetCard || targetCard.state !== "hidden") return;

      const currentRevealed = revealedIndicesRef.current;
      if (currentRevealed.includes(cardIndex)) return;
      if (currentRevealed.length >= 2) return;

      // Reveal card authoritatively
      const emojiId = hostDeckRef.current[cardIndex];
      const newRevealed = [...currentRevealed, cardIndex];
      revealedIndicesRef.current = newRevealed;

      // Update local cards state
      setCards((prev) =>
        prev.map((c) => (c.index === cardIndex ? { ...c, state: "revealed", emojiId } : c))
      );

      // Broadcast reveal to guest
      safeSend({
        action: "reveal",
        gameId: curGameId,
        cardIndex,
        emojiId,
        flipNumber: newRevealed.length,
      });

      // If this is the FIRST card
      if (newRevealed.length === 1) {
        setStatusMessage(byRole === role ? "Choose a second card..." : `${peerName} is choosing a second card...`);
        return;
      }

      // If this is the SECOND card: Evaluate match
      if (newRevealed.length === 2) {
        isLockedRef.current = true;
        const [firstIdx, secondIdx] = newRevealed;
        const emoji1 = hostDeckRef.current[firstIdx];
        const emoji2 = hostDeckRef.current[secondIdx];

        if (emoji1 === emoji2) {
          // MATCH!
          const newPairs = curPairs + 1;
          const newScores = {
            ...curScores,
            [byRole]: curScores[byRole] + 1,
          };

          setScores(newScores);
          setMatchedPairs(newPairs);
          revealedIndicesRef.current = [];
          isLockedRef.current = false;

          // Mark cards matched
          setCards((prev) =>
            prev.map((c) =>
              c.index === firstIdx || c.index === secondIdx
                ? { ...c, state: "matched", emojiId: emoji1 }
                : c
            )
          );

          const isGameOver = newPairs >= TOTAL_PAIRS;
          if (isGameOver) {
            setPhase("game_over");
          } else {
            setStatusMessage(
              byRole === role
                ? "✨ Match found! You get another turn!"
                : `✨ ${peerName} found a match and plays again!`
            );
          }

          safeSend({
            action: "resolve",
            gameId: curGameId,
            isMatch: true,
            card1: firstIdx,
            card2: secondIdx,
            emojiId: emoji1,
            hostScore: newScores.host,
            guestScore: newScores.guest,
            turn: curTurn, // Same player continues
            matchedPairs: newPairs,
            isGameOver,
          });
        } else {
          // MISMATCH: Show for 1 second, then hide and switch turn
          setStatusMessage("No match. Flipping back...");

          mismatchTimeoutRef.current = setTimeout(() => {
            const nextTurn = curTurn === "host" ? "guest" : "host";
            revealedIndicesRef.current = [];
            isLockedRef.current = false;

            setCards((prev) =>
              prev.map((c) =>
                c.index === firstIdx || c.index === secondIdx
                  ? { ...c, state: "hidden", emojiId: null }
                  : c
              )
            );
            setTurn(nextTurn);
            setStatusMessage(nextTurn === role ? "Your turn! Tap a card." : `${peerName}'s turn!`);

            safeSend({
              action: "hide",
              gameId: curGameId,
              card1: firstIdx,
              card2: secondIdx,
              turn: nextTurn,
            });
          }, 1000);
        }
      }
    },
    [isHost, role, peerName, safeSend]
  );

  // Active player taps a card
  const handleCardTap = useCallback(
    (cardIndex: number) => {
      const { phase: curPhase, turn: curTurn, cards: curCards } = stateRef.current;
      if (curPhase !== "playing") return;
      if (isLockedRef.current) return;
      if (curTurn !== role) return;

      const card = curCards[cardIndex];
      if (!card || card.state !== "hidden") return;
      if (revealedIndicesRef.current.length >= 2) return;
      if (revealedIndicesRef.current.includes(cardIndex)) return;

      if (isHost) {
        processCardFlip(cardIndex, "host");
      } else {
        // Guest sends flip request to host
        safeSend({
          action: "flip",
          gameId: stateRef.current.gameId,
          cardIndex,
          by: "guest",
        });
      }
    },
    [role, isHost, processCardFlip, safeSend]
  );

  // Rematch
  const handleRematch = useCallback(() => {
    const nextGameId = stateRef.current.gameId + 1;
    const starter = getGameStarter(nextGameId);

    if (mismatchTimeoutRef.current) {
      clearTimeout(mismatchTimeoutRef.current);
      mismatchTimeoutRef.current = null;
    }

    if (isHost) {
      const newDeck = generateShuffledDeck();
      hostDeckRef.current = newDeck;
      revealedIndicesRef.current = [];
      isLockedRef.current = false;

      setGameId(nextGameId);
      setTurn(starter);
      setScores({ host: 0, guest: 0 });
      setMatchedPairs(0);
      setStatusMessage(starter === role ? "New game! Your turn." : `New game! ${peerName}'s turn.`);
      setCards(
        Array.from({ length: BOARD_SIZE }, (_, i) => ({
          index: i,
          state: "hidden",
          emojiId: null,
        }))
      );
      setPhase("playing");

      safeSend({
        action: "rematch",
        gameId: nextGameId,
        boardSize: BOARD_SIZE,
        turn: starter,
        hostScore: 0,
        guestScore: 0,
      });
    } else {
      safeSend({
        action: "rematch",
        gameId: stateRef.current.gameId,
        by: "guest",
      });
    }
  }, [isHost, getGameStarter, generateShuffledDeck, role, peerName, safeSend]);

  // Leave
  const handleLeave = useCallback(() => {
    if (mismatchTimeoutRef.current) {
      clearTimeout(mismatchTimeoutRef.current);
      mismatchTimeoutRef.current = null;
    }
    safeSend({ action: "leave", by: role });
    onExit();
  }, [role, safeSend, onExit]);

  // Message Handler & Synchronization
  useEffect(() => {
    const unsubscribe = onMessage((msg: GameMessage) => {
      if (!msg || typeof msg.action !== "string") return;

      // Handle Leave
      if (msg.action === "leave") {
        if (mismatchTimeoutRef.current) {
          clearTimeout(mismatchTimeoutRef.current);
          mismatchTimeoutRef.current = null;
        }
        setPhase("peer_left");
        return;
      }

      // 1. START
      if (msg.action === "start") {
        if (!isHost) {
          const gId = typeof msg.gameId === "number" ? msg.gameId : 1;
          const starter = msg.turn === "guest" ? "guest" : "host";

          revealedIndicesRef.current = [];
          isLockedRef.current = false;

          setGameId(gId);
          setTurn(starter);
          setScores({ host: 0, guest: 0 });
          setMatchedPairs(0);
          setStatusMessage(starter === role ? "Your turn! Tap a card." : `${peerName}'s turn!`);
          setCards(
            Array.from({ length: BOARD_SIZE }, (_, i) => ({
              index: i,
              state: "hidden",
              emojiId: null,
            }))
          );
          setPhase("playing");
        }
        return;
      }

      // 2. FLIP (Received by Host from Guest)
      if (msg.action === "flip") {
        if (isHost && msg.by === "guest" && typeof msg.cardIndex === "number") {
          processCardFlip(msg.cardIndex, "guest");
        }
        return;
      }

      // 3. REVEAL (Published authoritatively by Host)
      if (msg.action === "reveal") {
        if (!isHost) {
          const idx = typeof msg.cardIndex === "number" ? msg.cardIndex : -1;
          const eId = typeof msg.emojiId === "number" ? msg.emojiId : null;
          if (idx >= 0 && idx < BOARD_SIZE && eId !== null) {
            setCards((prev) =>
              prev.map((c) => (c.index === idx ? { ...c, state: "revealed", emojiId: eId } : c))
            );
          }
        }
        return;
      }

      // 4. RESOLVE (Matches authoritatively resolved by Host)
      if (msg.action === "resolve") {
        if (!isHost) {
          const c1 = typeof msg.card1 === "number" ? msg.card1 : -1;
          const c2 = typeof msg.card2 === "number" ? msg.card2 : -1;
          const eId = typeof msg.emojiId === "number" ? msg.emojiId : null;
          const hScore = typeof msg.hostScore === "number" ? msg.hostScore : 0;
          const gScore = typeof msg.guestScore === "number" ? msg.guestScore : 0;
          const pairs = typeof msg.matchedPairs === "number" ? msg.matchedPairs : 0;
          const curTurn = msg.turn === "guest" ? "guest" : "host";

          setScores({ host: hScore, guest: gScore });
          setMatchedPairs(pairs);
          setTurn(curTurn);

          if (c1 >= 0 && c2 >= 0 && eId !== null) {
            setCards((prev) =>
              prev.map((c) =>
                c.index === c1 || c.index === c2 ? { ...c, state: "matched", emojiId: eId } : c
              )
            );
          }

          if (msg.isGameOver === true) {
            setPhase("game_over");
          } else {
            setStatusMessage(
              curTurn === role
                ? "✨ Match found! You get another turn!"
                : `✨ ${peerName} found a match and plays again!`
            );
          }
        }
        return;
      }

      // 5. HIDE (Mismatches flipped face-down authoritatively by Host)
      if (msg.action === "hide") {
        if (!isHost) {
          const c1 = typeof msg.card1 === "number" ? msg.card1 : -1;
          const c2 = typeof msg.card2 === "number" ? msg.card2 : -1;
          const nextTurn = msg.turn === "guest" ? "guest" : "host";

          setCards((prev) =>
            prev.map((c) =>
              c.index === c1 || c.index === c2 ? { ...c, state: "hidden", emojiId: null } : c
            )
          );
          setTurn(nextTurn);
          setStatusMessage(nextTurn === role ? "Your turn! Tap a card." : `${peerName}'s turn!`);
        }
        return;
      }

      // 6. REMATCH
      if (msg.action === "rematch") {
        if (isHost) {
          if (msg.by === "guest") {
            handleRematch();
          }
        } else {
          const nextGId = typeof msg.gameId === "number" ? msg.gameId : stateRef.current.gameId + 1;
          const starter = msg.turn === "guest" ? "guest" : "host";

          revealedIndicesRef.current = [];
          isLockedRef.current = false;

          setGameId(nextGId);
          setTurn(starter);
          setScores({ host: 0, guest: 0 });
          setMatchedPairs(0);
          setStatusMessage(starter === role ? "New game! Your turn." : `New game! ${peerName}'s turn.`);
          setCards(
            Array.from({ length: BOARD_SIZE }, (_, i) => ({
              index: i,
              state: "hidden",
              emojiId: null,
            }))
          );
          setPhase("playing");
        }
        return;
      }
    });

    return () => {
      unsubscribe();
      if (mismatchTimeoutRef.current) {
        clearTimeout(mismatchTimeoutRef.current);
        mismatchTimeoutRef.current = null;
      }
    };
  }, [isHost, onMessage, role, peerName, processCardFlip, handleRematch]);

  // Emoji lookup helper
  const getEmoji = (emojiId: number | null): string => {
    if (!emojiId) return "";
    const item = EMOJI_PAIRS.find((p) => p.id === emojiId);
    return item ? item.emoji : "";
  };

  const isMyTurn = turn === role;
  const myScore = role === "host" ? scores.host : scores.guest;
  const peerScore = role === "host" ? scores.guest : scores.host;

  // Winner calculation
  const getWinnerMessage = () => {
    if (scores.host > scores.guest) {
      return role === "host" ? "🎉 You Won the Game!" : `👏 ${peerName} Won the Game!`;
    } else if (scores.guest > scores.host) {
      return role === "guest" ? "🎉 You Won the Game!" : `👏 ${peerName} Won the Game!`;
    }
    return "🤝 It's a Friendly Draw!";
  };

  return (
    <div className="w-full max-w-[384px] min-w-[320px] h-[420px] max-h-[420px] flex flex-col justify-between p-2 select-none overflow-hidden font-sans text-[#f8f4ff] bg-transparent">
      {/* Top Header: Scores, Turn, Pairs Count, Leave */}
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
          {phase === "playing" && (
            <span className="text-[11px] font-mono font-medium bg-white/10 px-2 py-0.5 rounded-full text-[#b3a6cc]">
              {matchedPairs}/{TOTAL_PAIRS} Pairs
            </span>
          )}

          <button
            onClick={handleLeave}
            className="text-[11px] text-[#b3a6cc] hover:text-[#f8f4ff] hover:bg-white/10 px-2 py-1 rounded transition-colors"
            title="Leave game"
          >
            Leave
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col justify-center items-center py-1 overflow-hidden">
        {/* LOBBY PHASE */}
        {phase === "lobby" && (
          <div className="flex flex-col items-center justify-center gap-3 w-full animate-fadeIn text-center">
            <div className="text-4xl animate-bounce">🧠</div>
            <h2 className="text-lg font-bold tracking-tight text-[#f8f4ff]">Memory Match</h2>
            <p className="text-xs text-[#b3a6cc] max-w-[260px]">
              Find all 8 matching pairs of emoji cards. Match a pair to earn 1 pt and go again!
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

        {/* ACTIVE PLAYING PHASE: 4x4 CARD GRID */}
        {phase === "playing" && (
          <div className="flex flex-col items-center justify-between w-full h-full py-0.5">
            {/* Status bar */}
            <div className="flex items-center justify-between w-full px-1 text-[11px] mb-1">
              <div className="flex items-center gap-1.5 font-medium">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isMyTurn ? "bg-[#34d399] animate-pulse" : "bg-[#fbbf24]"
                  }`}
                />
                <span className={isMyTurn ? "text-[#34d399] font-bold" : "text-[#b3a6cc]"}>
                  {isMyTurn ? "Your Turn" : `${turn === "host" ? "Alice (Host)" : "Bob (Guest)"}'s Turn`}
                </span>
              </div>
              <span className="text-[11px] text-[#b3a6cc] truncate max-w-[170px]">
                {statusMessage}
              </span>
            </div>

            {/* 4x4 Grid of Cards */}
            <div className="grid grid-cols-4 gap-1.5 w-full max-w-[310px] aspect-square my-auto justify-items-center items-center">
              {cards.map((card) => {
                const isRevealed = card.state === "revealed";
                const isMatched = card.state === "matched";
                const isFaceUp = isRevealed || isMatched;
                const emoji = getEmoji(card.emojiId);

                return (
                  <button
                    key={card.index}
                    onClick={() => handleCardTap(card.index)}
                    disabled={isFaceUp || !isMyTurn || phase !== "playing"}
                    aria-label={isFaceUp ? `Card ${card.index + 1}: ${emoji}` : `Card ${card.index + 1} Hidden`}
                    className={`min-w-[44px] min-h-[44px] w-full h-full max-w-[70px] max-h-[70px] rounded-xl flex items-center justify-center text-2xl transition-all duration-300 shadow-sm border ${
                      isMatched
                        ? "bg-emerald-950/50 border-emerald-400/70 text-white cursor-default scale-95 opacity-90 shadow-emerald-500/10"
                        : isRevealed
                        ? "bg-indigo-950/80 border-indigo-400 text-white scale-100 shadow-indigo-500/20 ring-2 ring-indigo-400/40"
                        : isMyTurn
                        ? "bg-gradient-to-br from-[#261845] to-[#160e2e] border-white/15 text-white/40 hover:border-pink-400/50 hover:scale-[1.02] active:scale-95 cursor-pointer"
                        : "bg-gradient-to-br from-[#1d1338] to-[#120a26] border-white/10 text-white/20 cursor-not-allowed opacity-80"
                    }`}
                  >
                    {isFaceUp ? (
                      <span className="transform transition-transform scale-100 animate-fadeIn">
                        {emoji}
                      </span>
                    ) : (
                      <span className="text-xs font-black tracking-widest text-white/30 select-none">
                        ?
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* GAME OVER PHASE */}
        {phase === "game_over" && (
          <div className="flex flex-col items-center justify-center gap-2.5 w-full animate-fadeIn text-center">
            <div className="text-3xl">🏆</div>
            <h3 className="text-base font-bold text-[#f8f4ff]">{getWinnerMessage()}</h3>

            <div className="flex items-center justify-center gap-4 py-2 px-4 rounded-xl bg-white/5 border border-white/10 my-1">
              <div className="text-center">
                <div className="text-xs text-[#f9a8d4] font-semibold">{myName}</div>
                <div className="text-xl font-extrabold text-white">{myScore}</div>
              </div>
              <div className="text-sm text-white/30 font-bold">:</div>
              <div className="text-center">
                <div className="text-xs text-[#7dd3fc] font-semibold">{peerName}</div>
                <div className="text-xl font-extrabold text-white">{peerScore}</div>
              </div>
            </div>

            <p className="text-xs text-[#34d399] font-medium">
              All 8 matching pairs collected!
            </p>

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
            <p className="text-xs text-[#b3a6cc]">The memory match session has ended.</p>
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

