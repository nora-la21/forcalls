const Anthropic = require('@anthropic-ai/sdk');

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
- Only tip if something is clearly actionable
- Keep it under 25 words

Respond ONLY with valid JSON, no markdown:
{"type": "objection"|"signal"|"discovery"|"close"|"tip"|"none", "text": "your tip here or empty string"}`;

class CoachingEngine {
  constructor() {
    this.client = null;
    this.recentTranscript = '';
    this.lastAnalyzedLength = 0;
    this.debounceTimer = null;
    this.pendingResolvers = [];
  }

  _getClient() {
    if (!this.client) {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY not set');
      }
      this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    return this.client;
  }

  // Called with each new transcript chunk; debounces 3s before sending to Claude
  analyze(newChunk) {
    this.recentTranscript += ' ' + newChunk;
    // Keep rolling window of last ~2000 chars
    if (this.recentTranscript.length > 2000) {
      this.recentTranscript = this.recentTranscript.slice(-2000);
    }

    const wordCount = newChunk.trim().split(/\s+/).length;
    if (wordCount < 6) return Promise.resolve(null);

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
      const client = this._getClient();
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 120,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Recent call transcript:\n"${transcript}"\n\nCoaching tip:`,
          },
        ],
      });

      const raw = response.content[0]?.text?.trim() || '{"type":"none","text":""}';
      let tip;
      try {
        tip = JSON.parse(raw);
      } catch {
        tip = { type: 'none', text: '' };
      }

      tip.timestamp = Date.now();
      resolvers.forEach((r) => r(tip));
    } catch (err) {
      const errorTip = {
        type: 'error',
        text: err.message.includes('API_KEY') ? 'Set ANTHROPIC_API_KEY in your .env file' : `Error: ${err.message}`,
        timestamp: Date.now(),
      };
      resolvers.forEach((r) => r(errorTip));
    }
  }
}

module.exports = CoachingEngine;
