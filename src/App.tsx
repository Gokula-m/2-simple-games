import { useState } from "react";
import { TwoPlayerTest } from "./TwoPlayerTest";
import { meta as memoryMeta } from "../games/memory-match/meta";
import { meta as skribblMeta } from "../games/skribbl/meta";

export default function App() {
  const [activeGame, setActiveGame] = useState<"memorymatch" | "skribbl">("memorymatch");

  return (
    <div className="min-h-screen bg-[#090614] text-[#f8f4ff] flex flex-col items-center">
      {/* Top Navigation & Game Selector */}
      <header className="w-full border-b border-white/10 bg-[#0f0a21]/80 backdrop-blur-md sticky top-0 z-50 py-3 px-6">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#ff3d7f] to-[#ff7a59] flex items-center justify-center font-black text-white text-base shadow-lg shadow-pink-500/20">
              G
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-[#f8f4ff]">
                Gulaab In-Call Two-Player Games
              </h1>
              <p className="text-[11px] text-[#b3a6cc]">
                Live Video Companion Panels Testing Harness
              </p>
            </div>
          </div>

          {/* Game Switcher Tabs */}
          <div className="flex items-center bg-white/5 border border-white/10 p-1 rounded-2xl gap-1">
            <button
              onClick={() => setActiveGame("memorymatch")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeGame === "memorymatch"
                  ? "bg-gradient-to-r from-[#ff3d7f] to-[#ff7a59] text-white shadow-md"
                  : "text-[#b3a6cc] hover:text-white"
              }`}
            >
              <span>{memoryMeta.emoji}</span>
              <span>{memoryMeta.name}</span>
            </button>

            <button
              onClick={() => setActiveGame("skribbl")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeGame === "skribbl"
                  ? "bg-gradient-to-r from-[#ff3d7f] to-[#ff7a59] text-white shadow-md"
                  : "text-[#b3a6cc] hover:text-white"
              }`}
            >
              <span>{skribblMeta.emoji}</span>
              <span>{skribblMeta.name}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Two-Player Test Area */}
      <main className="w-full flex-1 flex flex-col items-center justify-start py-6">
        <TwoPlayerTest key={activeGame} gameType={activeGame} />
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-white/10 py-3 text-center text-xs text-[#b3a6cc]">
        Gulaab Video In-Call Games • React 19 • TypeScript • Tailwind CSS v4 • Zero external network dependencies
      </footer>
    </div>
  );
}
