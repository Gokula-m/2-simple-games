# Skribbl: Draw & Guess – In-Call Game for Gulaab

A lightweight, real-time two-player drawing and guessing game designed specifically for Gulaab's in-call video companion panel.

## Features

- **Draw & Guess Gameplay**: One player draws a randomly chosen secret word while the peer guesses it.
- **Alternating Roles**: Drawer and Guesser switch roles after every round. Host starts as the drawer in Round 1.
- **Built-in Word Collection**: 20 curated words across 5 categories: Animals, Food, Objects, Nature, and Activities.
- **Normalized 2D Canvas**: Coordinates are normalized (0.000 to 1.000) ensuring pixel-perfect scaling across any phone display from 320px to 384px.
- **Real-time Stroke Synchronization**:
  - Compact batch messaging with stroke start, batch, and end operations.
  - Throttled to **maximum 10 messages per second** (100ms interval).
  - Every network message is **strictly under 512 bytes**.
  - Supports color palette, 3 brush sizes, eraser, undo stroke, and clear canvas.
- **Guesser Privacy & Validation**: The secret word is strictly kept private to the drawer during the round. Guesses are validated locally by the drawer.
- **Host Authoritative Timer**: 60-second timer managed authoritatively by the host, preventing client timer drift or late scoring.
- **Scoring**: 10 points for the guesser upon a correct guess, and 5 points bonus for the drawer.
- **Rematch & Leave**: Supports clean rematch sessions (swapping starting drawer) and graceful exits.

---

## Component Interface

```tsx
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

export default function Game(props: GameProps): JSX.Element;
```

---

## Messaging Protocol

All actions are declared in `meta.ts`:

| Action | Sent By | Description | Key Attributes |
|---|---|---|---|
| `start` | Host | Initializes game | `gameId`, `round`, `drawer` |
| `round` | Host / Guest | Broadcasts round metadata | `round`, `drawer`, `category`, `letterCount`, `word` (drawer only) |
| `draw` | Drawer | Synchronizes drawing strokes | `op` (`start`, `batch`, `end`, `undo`, `clear`), `strokeId`, `pts` |
| `guess` | Guesser | Submits guess text for validation | `text`, `round`, `by` |
| `correct` | Drawer / Host | Confirms guess was correct | `round`, `guess`, `by` |
| `roundEnd` | Host | Ends round and reveals secret word | `reason`, `word`, `winner`, `hostScore`, `guestScore` |
| `rematch` | Host / Guest | Resets match and swaps starting drawer | `gameId`, `hostScore`, `guestScore` |
| `leave` | Either | Informs peer that player has exited | `by` |

---

## Message Size & Rate Limit Guarantees

1. **Size Limit**: Drawing points are quantized to 3 decimals and streamed in chunks of up to 16 numbers (`[x0, y0, x1, y1, ...]`), resulting in payloads typically under 140 bytes, well within the 512-byte limit.
2. **Rate Limit**: Outgoing stroke batches are buffered and dispatched using a 100ms throttle timer, guaranteeing a maximum of 10 messages per second.

