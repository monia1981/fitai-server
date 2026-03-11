/**
 * FitAI Proxy Server
 *
 * Required env variables:
 *   GEMINI_API_KEY   — your Gemini key (never sent to the app)
 *   APP_SECRET       — a long random string shared with the app (set in VITE_APP_SECRET)
 *
 * Optional:
 *   PORT             — default 4000
 */

import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { GoogleGenAI } from '@google/genai';

const app  = express();
const PORT = process.env.PORT ?? 4000;

// ── Startup checks ────────────────────────────────────────────────────────────
if (!process.env.GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY is not set.');
  process.exit(1);
}
if (!process.env.APP_SECRET) {
  console.error('ERROR: APP_SECRET is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

const ai        = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const APP_SECRET = process.env.APP_SECRET;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '4mb' }));

// Rate limit: max 30 requests / minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down.' },
});
app.use('/api', limiter);

// Secret token check — rejects any request without the correct header
app.use('/api', (req, res, next) => {
  const token = req.headers['x-app-secret'];
  if (token !== APP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ── Health check (no auth needed) ────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Single-turn generation (phase detection) ──────────────────────────────────
app.post('/api/generate', async (req, res) => {
  try {
    const { contents } = req.body;
    if (!contents) return res.status(400).json({ error: 'Missing contents' });

    const response = await ai.models.generateContent({
      model: 'gemini-flash-lite-latest',
      contents,
    });

    res.json({ text: response.text ?? '' });
  } catch (err) {
    console.error('/api/generate error:', err);
    res.status(500).json({ error: 'Gemini request failed' });
  }
});

// ── Stateless chat (AI coach) ─────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { systemInstruction, history = [], message } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });

    const geminiHistory = history.map(m => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));

    const chat = ai.chats.create({
      model: 'gemini-flash-lite-latest',
      config: { systemInstruction: systemInstruction ?? '' },
      history: geminiHistory,
    });

    const result = await chat.sendMessage({ message });
    res.json({ text: result.text ?? '' });
  } catch (err) {
    console.error('/api/chat error:', err);
    res.status(500).json({ error: 'Gemini request failed' });
  }
});

app.listen(PORT, () => {
  console.log(`FitAI proxy server listening on http://localhost:${PORT}`);
});
