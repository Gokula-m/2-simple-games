# Gulaab – In-Call Two-Player Games

Lightweight, mobile-friendly, two-player in-call companion games developed for Gulaab's live video calling application:

1. **🧠 Memory Match**: A 4 × 4 card-matching game with host-authoritative anti-cheating, 8 unique emoji pairs, and turn-retention mechanics.
2. **🎨 Skribbl – Draw & Guess**: Real-time canvas drawing and word-guessing with normalized coordinates, throttled stroke batching (≤ 10 msgs/s, < 180 B), and private secret word validation.

---

## Technical Stack

- **Framework**: React 19 + TypeScript
- **Styling**: Tailwind CSS v4
- **Build Tool**: Vite
- **Networking**: Gulaab In-Call `send()` / `onMessage()` architecture (Zero external network calls, WebSockets, or CDNs)
- **Dimensions**: Strictly bounded to max 384px width, max 420px height, and responsive down to 320px width without scrolling.

---

## Project Structure

```text
├── games/
│   ├── memory-match/
│   │   ├── index.tsx       # Memory Match main component
│   │   ├── meta.ts         # Metadata and actions
│   │   └── README.md       # Game documentation & protocol
│   └── skribbl/
│       ├── index.tsx       # Skribbl main component
│       ├── meta.ts         # Metadata and actions
│       └── README.md       # Game documentation & protocol
├── src/
│   ├── TwoPlayerTest.tsx   # Side-by-side Host/Guest test harness
│   ├── App.tsx             # Interactive launcher page
│   ├── main.tsx            # React entrypoint
│   └── index.css           # Styling & reduced-motion configuration
├── LICENSE                 # MIT License
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000/` to test both games side-by-side.

3. Build for production:
   ```bash
   npm run build
   ```

---

## License

MIT License. See [LICENSE](LICENSE) for details.
