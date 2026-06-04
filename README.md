# ForCalls — Real-time AI Sales Coaching

An invisible overlay app that listens to your Google Meet / Zoom calls and gives you live coaching tips powered by Claude AI.

## What it does

- Captures your call audio in real-time
- Transcribes speech using Deepgram
- Sends transcript to Claude for analysis
- Shows coaching tips as an overlay **invisible to screen sharing**
- Tips include: objection handling, buying signal responses, discovery questions, closing cues

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Get API keys

- **Anthropic (Claude):** https://console.anthropic.com/
- **Deepgram:** https://console.deepgram.com/ (free tier: 200 hrs/month)

### 3. Create `.env` file

```
ANTHROPIC_API_KEY=sk-ant-...
DEEPGRAM_API_KEY=...
```

### 4. Set up virtual audio device (CRITICAL)

The app captures your microphone by default. To capture **system audio** (what's playing through your speakers — i.e. the other person on the call):

**Mac:**
- Install [BlackHole](https://existential.audio/blackhole/) (free)
- In System Preferences → Sound → Output: set to BlackHole
- In System Preferences → Sound → Input: set to BlackHole
- Or use [Loopback](https://rogueamoeba.com/loopback/) for more control

**Windows:**
- Install [VB-Cable](https://vb-audio.com/Cable/) (free)
- Set your speakers to output through VB-Cable
- The app will capture VB-Cable as input

**Alternative:** Run the app and select the virtual device as your microphone input when prompted.

### 5. Run

```bash
npm start
```

## Usage

1. Start a Google Meet or Zoom call
2. Open ForCalls and click **▶ Start Listening**
3. Allow microphone access (point it at your virtual audio device)
4. Coaching tips appear in the bottom-right corner of your screen
5. The overlay is **not captured** by screen share (Mac: uses `setContentProtection`, Windows: similar)

**Keyboard shortcut:** `Ctrl+Shift+H` — toggle overlay visibility

## Tip types

| Icon | Type | When it fires |
|------|------|---------------|
| 🛡️ | Objection | Prospect raises concerns |
| 🎯 | Signal | Prospect shows buying interest |
| 🔍 | Discovery | Conversation needs a probing question |
| 🤝 | Close | Good moment to attempt a close |
| 💡 | Tip | General best practice |

## Customization

Edit `src/coaching-engine.js` to customize the coaching prompt for your specific sales methodology (SPIN, Challenger, MEDDIC, etc.).

## Architecture

```
main.js              — Electron main process, window management, IPC routing
preload.js           — Secure IPC bridge (contextBridge)
src/coaching-engine.js — Claude API integration
renderer/
  control.html/js    — Control panel: start/stop, audio capture, Deepgram streaming
  overlay.html       — Floating tips overlay (screen-share invisible)
```
