# Memory Match – In-Call Two-Player Game for Gulaab

A lightweight, interactive two-player Memory Match game built specifically for Gulaab's in-call live video calling application.

## Features

- **4 × 4 Card Grid**: 16 cards arranged in an equal-dimension grid containing 8 matching pairs.
- **Built-in Emoji Pairs**:
  1. 🐱 Cat
  2. 🐼 Panda
  3. 🦋 Butterfly
  4. 🍕 Pizza
  5. 🌈 Rainbow
  6. ❤️ Heart
  7. 🌻 Sunflower
  8. 🍦 Ice cream
- **Host Authoritative Security**:
  - The host maintains the complete shuffled 16-card deck privately in memory.
  - The complete board identity is **never transmitted to the guest upfront**, preventing clients from inspecting packets to see all card locations.
  - Card identities are only revealed when a card is selected during a valid turn.
- **Turn & Match Rules**:
  - A player selects two face-down cards.
  - **Match**: Player earns 1 point, cards stay face-up with success indicator, and the active player gets another turn.
  - **Mismatch**: Cards stay visible for ~1 second, then authoritatively flip back face-down, passing the turn to the other player.
  - Alternates who starts first in every rematch session.
- **Strict Compliance**:
  - Communicates exclusively via Gulaab's `send()` and `onMessage()` interfaces.
  - Zero external dependencies or network connections.
  - Zero scrolling, strictly bounded within 384 × 420px down to 320px width.
  - Touch targets >= 44 × 44px.
  - All messages strictly under 512 bytes.

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

| Action | Sent By | Description | Key Payload Attributes |
|---|---|---|---|
| `start` | Host | Initializes game board and starting player | `gameId`, `boardSize`, `turn`, `hostScore`, `guestScore` |
| `flip` | Guest | Requests card selection at index | `gameId`, `cardIndex`, `by` |
| `reveal` | Host | Authoritatively publishes card identity | `gameId`, `cardIndex`, `emojiId`, `flipNumber` |
| `resolve` | Host | Confirms matching pair and awards point | `gameId`, `isMatch`, `card1`, `card2`, `emojiId`, `hostScore`, `guestScore`, `turn`, `matchedPairs`, `isGameOver` |
| `hide` | Host | Tells clients to flip mismatched cards face-down | `gameId`, `card1`, `card2`, `turn` |
| `rematch` | Host / Guest | Resets match, shuffles new deck, and alternates starter | `gameId`, `boardSize`, `turn`, `hostScore`, `guestScore` |
| `leave` | Either | Informs peer that player has exited | `by` |

