/* Control window: handles audio capture, Deepgram streaming, and UI state */

let deepgramSocket = null;
let audioContext = null;
let micStream = null;
let processor = null;
let isCapturing = false;
let fullTranscript = '';
let deepgramKey = '';

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const dot = document.getElementById('dot');
const statusText = document.getElementById('statusText');
const tipPreview = document.getElementById('tipPreview');
const setupWarning = document.getElementById('setupWarning');
const providerSelect = document.getElementById('providerSelect');
const providerStatus = document.getElementById('providerStatus');

let providers = [];

// Check env vars on load
window.electronAPI.getEnv().then((env) => {
  deepgramKey = env.deepgramKey;
  providers = env.providers || [];

  // Populate provider selector with key status
  updateProviderStatus();

  const hasDeepgram = env.hasDeepgramKey;
  const activeProvider = providers.find((p) => p.key === providerSelect.value);
  if (!hasDeepgram || !activeProvider?.hasKey) {
    setupWarning.style.display = 'block';
    startBtn.disabled = true;
  }
});

providerSelect.addEventListener('change', () => {
  window.electronAPI.setProvider(providerSelect.value);
  updateProviderStatus();

  const activeProvider = providers.find((p) => p.key === providerSelect.value);
  if (activeProvider?.hasKey) {
    setupWarning.style.display = 'none';
    startBtn.disabled = false;
  } else {
    setupWarning.style.display = 'block';
    startBtn.disabled = true;
  }
});

function updateProviderStatus() {
  const active = providers.find((p) => p.key === providerSelect.value);
  if (active?.hasKey) {
    providerStatus.textContent = '✓ key set';
    providerStatus.style.color = '#22c55e';
  } else {
    providerStatus.textContent = '✗ no key';
    providerStatus.style.color = '#f87171';
  }
}

// Listen for tips from main process
window.electronAPI.onCoachingTip((tip) => {
  if (!tip || tip.type === 'none' || !tip.text) return;
  appendTip(tip);
});

window.electronAPI.onCaptureStatus((status) => {
  updateStatus(status);
});

startBtn.addEventListener('click', startCapture);
stopBtn.addEventListener('click', stopCapture);
clearBtn.addEventListener('click', () => {
  tipPreview.innerHTML = '<span style="color:#444">Tips will appear here...</span>';
  fullTranscript = '';
  window.electronAPI.clearTips();
});

async function startCapture() {
  try {
    updateStatus('connecting');

    // Request microphone (user must route system audio through virtual device)
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: 16000,
        channelCount: 1,
      },
    });

    audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(micStream);

    // ScriptProcessor to get PCM chunks (deprecated but works everywhere in Electron)
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(audioContext.destination);

    // Open Deepgram WebSocket
    deepgramSocket = new WebSocket(
      `wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&language=en-US&interim_results=true&smart_format=true&endpointing=500`,
      ['token', deepgramKey]
    );

    deepgramSocket.onopen = () => {
      isCapturing = true;
      updateStatus('active');
    };

    deepgramSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const transcript = data?.channel?.alternatives?.[0]?.transcript || '';
        const isFinal = data?.is_final;

        if (transcript && isFinal) {
          fullTranscript += ' ' + transcript;
          window.electronAPI.sendTranscriptChunk(transcript);
          window.electronAPI.sendTranscriptUpdate(fullTranscript.trim());
        }
      } catch (_) {}
    };

    deepgramSocket.onerror = (err) => {
      console.error('Deepgram error', err);
      statusText.textContent = 'Deepgram connection error';
    };

    deepgramSocket.onclose = () => {
      if (isCapturing) stopCapture();
    };

    // Send PCM audio to Deepgram
    processor.onaudioprocess = (e) => {
      if (!isCapturing || deepgramSocket?.readyState !== WebSocket.OPEN) return;
      const float32 = e.inputBuffer.getChannelData(0);
      const int16 = float32ToInt16(float32);
      deepgramSocket.send(int16.buffer);
    };

  } catch (err) {
    console.error('Capture error', err);
    statusText.textContent = `Error: ${err.message}`;
    updateStatus('error');
  }
}

function stopCapture() {
  isCapturing = false;

  if (deepgramSocket) {
    deepgramSocket.close();
    deepgramSocket = null;
  }
  if (processor) {
    processor.disconnect();
    processor = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  updateStatus('off');
}

function updateStatus(status) {
  window.electronAPI.sendCaptureStatus(status);
  dot.className = 'dot';
  if (status === 'active') {
    dot.classList.add('active');
    statusText.textContent = 'Listening to audio...';
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else if (status === 'connecting') {
    statusText.textContent = 'Connecting...';
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else if (status === 'error') {
    statusText.textContent = 'Error — check console';
    startBtn.disabled = false;
    stopBtn.disabled = true;
  } else {
    dot.className = 'dot';
    statusText.textContent = 'Stopped';
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

function appendTip(tip) {
  const preview = document.getElementById('tipPreview');
  // Remove placeholder
  const placeholder = preview.querySelector('span');
  if (placeholder) placeholder.remove();

  const entry = document.createElement('div');
  entry.className = 'tip-entry';
  entry.innerHTML = `<span class="tip-badge badge-${tip.type}">${tip.type}</span>${escapeHtml(tip.text)}`;
  preview.appendChild(entry);
  preview.scrollTop = preview.scrollHeight;
}

function float32ToInt16(float32Array) {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
