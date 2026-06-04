const SYSTEM_PROMPT = `You are a real-time sales coach listening to a live sales call transcript.
Analyze the latest transcript segment and provide ONE concise, immediately actionable coaching tip (max 2 sentences).

Focus areas:
- OBJECTION: Prospect raises concerns or hesitations → suggest specific response language to overcome it
- SIGNAL: Prospect shows buying interest or asks about implementation → suggest how to advance the deal
- DISCOVERY: Conversation is surface-level or stalling → suggest a probing question to uncover pain/need
- CLOSE: Prospect seems ready or conversation has covered enough ground → suggest a soft close technique
- TIP: General best practice for the current moment in the conversation

Rules:
- Be direct and prescriptive ("Say: '...'", "Ask them: '...'", "Now is a good time to...")
- Keep it under 25 words
- Only tip if something is clearly actionable

Respond ONLY with valid JSON, no markdown:
{"type": "objection"|"signal"|"discovery"|"close"|"tip"|"none", "text": "your tip here or empty string"}`;

const PROVIDERS = {
  groq: {
    label: 'Groq (Free)',
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'llama-3.1-8b-instant',
    envKey: 'GROQ_API_KEY',
  },
  anthropic: {
    label: 'Anthropic Claude',
    baseURL: null, // uses SDK
    model: 'claude-haiku-4-5-20251001',
    envKey: 'ANTHROPIC_API_KEY',
  },
  openai: {
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    envKey: 'OPENAI_API_KEY',
  },
};

class CoachingEngine {
  constructor() {
    this.recentTranscript = '';
    this.debounceTimer = null;
    this.pendingResolvers = [];
    this.provider = 'groq';
  }

  setProvider(providerKey) {
    if (PROVIDERS[providerKey]) {
      this.provider = providerKey;
    }
  }

  getProviders() {
    return Object.entries(PROVIDERS).map(([key, p]) => ({
      key,
      label: p.label,
      hasKey: !!process.env[p.envKey],
    }));
  }

  analyze(newChunk) {
    this.recentTranscript += ' ' + newChunk;
    if (this.recentTranscript.length > 2000) {
      this.recentTranscript = this.recentTranscript.slice(-2000);
    }

    if (newChunk.trim().split(/\s+/).length < 6) return Promise.resolve(null);

    return new Promise((resolve) => {
      this.pendingResolvers.push(resolve);
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this._runAnalysis(), 3000);
    });
  }

  async _runAnalysis() {
    const resolvers = [...this.pendingResolvers];
    this.pendingResolvers = [];
    const transcript = this.recentTranscript.trim();

    try {
      const tip = await this._callProvider(transcript);
      tip.timestamp = Date.now();
      resolvers.forEach((r) => r(tip));
    } catch (err) {
      const errorTip = {
        type: 'error',
        text: err.message.includes('key') || err.message.includes('401')
          ? `Missing or invalid API key for ${PROVIDERS[this.provider].label}`
          : `Error: ${err.message}`,
        timestamp: Date.now(),
      };
      resolvers.forEach((r) => r(errorTip));
    }
  }

  async _callProvider(transcript) {
    const pConfig = PROVIDERS[this.provider];
    const apiKey = process.env[pConfig.envKey];

    if (!apiKey) {
      return { type: 'error', text: `Set ${pConfig.envKey} in your .env file` };
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Recent call transcript:\n"${transcript}"\n\nCoaching tip:` },
    ];

    if (this.provider === 'anthropic') {
      return this._callAnthropic(apiKey, pConfig.model, transcript);
    }

    // Groq and OpenAI share the OpenAI-compatible API format
    const response = await fetch(`${pConfig.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: pConfig.model,
        messages,
        max_tokens: 120,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`${pConfig.label} API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '{"type":"none","text":""}';
    try {
      return JSON.parse(raw);
    } catch {
      return { type: 'none', text: '' };
    }
  }

  async _callAnthropic(apiKey, model, transcript) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 120,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: `Recent call transcript:\n"${transcript}"\n\nCoaching tip:` },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const raw = data.content?.[0]?.text?.trim() || '{"type":"none","text":""}';
    try {
      return JSON.parse(raw);
    } catch {
      return { type: 'none', text: '' };
    }
  }
}

module.exports = CoachingEngine;
