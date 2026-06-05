function buildSalesPrompt(context) {
  const contextBlock = context
    ? `\n\nContext about this deal:\n${context}\nUse this to make tips more specific.`
    : '';
  return `You are a real-time sales coach listening to a live sales call transcript.
Analyze the latest transcript segment and provide ONE concise, immediately actionable coaching tip (max 2 sentences).${contextBlock}

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
}

function buildInterviewPrompt(context) {
  const contextBlock = context
    ? `\n\nJob description / role context:\n${context}\nTailor all tips to this specific role. Remind the candidate to highlight relevant skills from the job description when appropriate.`
    : '';
  return `You are a real-time interview coach listening to a live job interview transcript.
Analyze the latest transcript segment and provide ONE concise, immediately actionable coaching tip (max 2 sentences).${contextBlock}

Focus areas:
- STRUCTURE: Answer is rambling or missing a point → suggest using STAR method or being more concise
- EXAMPLE: Claim made without proof → remind to add a specific example or metric
- LANGUAGE: Weak phrases detected ("I think maybe", "I'm not sure", "sort of") → suggest stronger wording
- QUESTION: Good moment to ask the interviewer something → suggest a smart question to ask
- ENERGY: Answer sounds flat or nervous → suggest reframing or adding enthusiasm
- TIP: General best practice for the current moment

Rules:
- Be direct and specific ("Add an example like...", "Replace 'I think' with 'I know'", "Ask them: '...'")
- Keep it under 25 words
- Only tip if something is clearly actionable

Respond ONLY with valid JSON, no markdown:
{"type": "structure"|"example"|"language"|"question"|"energy"|"tip"|"none", "text": "your tip here or empty string"}`;
}

const PROVIDERS = {
  groq: {
    label: 'Groq (Free)',
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
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
    this.mode = 'sales';
    this.context = '';
  }

  setProvider(providerKey) {
    if (PROVIDERS[providerKey]) {
      this.provider = providerKey;
    }
  }

  setMode(mode) {
    if (['sales', 'interview'].includes(mode)) {
      this.mode = mode;
      this.recentTranscript = '';
    }
  }

  setContext(text) {
    this.context = text.trim();
  }

  async generateReport(fullTranscript, tips) {
    const pConfig = PROVIDERS[this.provider];
    const apiKey = process.env[pConfig.envKey];
    if (!apiKey) throw new Error(`Missing ${pConfig.envKey}`);

    const modeLabel = this.mode === 'interview' ? 'job interview' : 'sales call';
    const tipsSummary = tips.map(t => `[${t.type}] ${t.text}`).join('\n');
    const contextBlock = this.context ? `\nSession context:\n${this.context}\n` : '';

    const prompt = `You analyzed a ${modeLabel} in real time and provided these coaching tips:\n${tipsSummary}\n${contextBlock}
Full transcript:\n"${fullTranscript.slice(0, 4000)}"\n
Now generate a comprehensive post-session report. Respond with valid JSON only:
{
  "score": <number 1-10>,
  "score_rationale": "<1 sentence why>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "improvements": [{"area": "<area>", "detail": "<specific advice>"}],
  "mistakes": [{"mistake": "<what happened>", "fix": "<how to fix>"}],
  "repeatable_patterns": ["<pattern observed more than once>"],
  "top_recommendation": "<single most important thing to work on>",
  "summary": "<2-3 sentence overall summary>"
}`;

    const messages = [
      { role: 'system', content: `You are an expert ${modeLabel} coach writing a post-session performance report. Be specific, honest, and actionable.` },
      { role: 'user', content: prompt },
    ];

    let raw;
    if (this.provider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: pConfig.model, max_tokens: 1000, system: messages[0].content, messages: [messages[1]] }),
      });
      const data = await response.json();
      raw = data.content?.[0]?.text;
    } else {
      const response = await fetch(`${pConfig.baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: pConfig.model, max_tokens: 1000, messages }),
      });
      const data = await response.json();
      raw = data.choices?.[0]?.message?.content;
    }

    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  }

  _getSystemPrompt() {
    if (this.mode === 'interview') return buildInterviewPrompt(this.context);
    return buildSalesPrompt(this.context);
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
      this.debounceTimer = setTimeout(() => this._runAnalysis(), 5000);
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
      { role: 'system', content: this._getSystemPrompt() },
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
        system: this._getSystemPrompt(),
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
