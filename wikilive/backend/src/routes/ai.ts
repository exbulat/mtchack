import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

router.use(requireAuth);

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GptResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

function validatePrompt(prompt: unknown): string | null {
  if (typeof prompt !== 'string') return null;
  const trimmed = prompt.trim();
  if (trimmed.length === 0 || trimmed.length > 5000) return null;
  return trimmed;
}

router.post('/chat', async (req: Request, res: Response) => {
  const apiUrl = process.env.MWS_GPT_API_URL || 'https://api.gpt.mws.ru/v1/chat/completions';
  const apiKey = process.env.MWS_GPT_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'MWS_GPT_API_KEY not configured' });
  }

  try {
    const { prompt, context } = req.body;
    const validatedPrompt = validatePrompt(prompt);
    if (!validatedPrompt) {
      return res.status(400).json({ error: 'Prompt is required and must be 1-5000 characters' });
    }
    const validatedContext = typeof context === 'string' ? context.substring(0, 10000) : '';

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Ты — AI-помощник в вики-редакторе WikiLive. Помогай писать и редактировать текст. Отвечай на русском языке. Будь кратким и полезным.',
      },
      ...(validatedContext
        ? [{ role: 'user' as const, content: `Контекст текущей страницы:\n${validatedContext}` }]
        : []),
      { role: 'user', content: validatedPrompt },
    ];

    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mws-gpt-alpha',
        messages,
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });

    if (!resp.ok) {
      await resp.text();
      console.error('[AI] MWS GPT error:', resp.status);
      return res.status(resp.status).json({ error: 'AI service error' });
    }

    const data = (await resp.json()) as GptResponse;
    const reply = data.choices?.[0]?.message?.content || '';
    res.json({ reply });
  } catch (err) {
    console.error('[AI] Request failed:', err instanceof Error ? err.message : 'Unknown error');
    res.status(502).json({ error: 'Failed to reach AI service' });
  }
});

router.post('/suggest', async (req: Request, res: Response) => {
  const apiUrl = process.env.MWS_GPT_API_URL || 'https://api.gpt.mws.ru/v1/chat/completions';
  const apiKey = process.env.MWS_GPT_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'MWS_GPT_API_KEY not configured' });
  }

  try {
    const { text, action } = req.body;
    if (typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const validatedText = text.trim().substring(0, 5000);

    const prompts: Record<string, string> = {
      summarize: `Кратко резюмируй следующий текст:\n\n${validatedText}`,
      expand: `Раскрой подробнее следующий текст, добавь деталей:\n\n${validatedText}`,
      improve: `Улучши стиль и читаемость текста, сохранив смысл:\n\n${validatedText}`,
      translate_en: `Переведи на английский:\n\n${validatedText}`,
    };

    if (typeof action !== 'string' || !prompts[action]) {
      return res.status(400).json({ error: 'Недопустимое действие. Разрешены: summarize, expand, improve, translate_en' });
    }

    const prompt = prompts[action];

    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mws-gpt-alpha',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });

    if (!resp.ok) {
      console.error('[AI] MWS GPT suggest error:', resp.status);
      return res.status(resp.status).json({ error: 'AI service error' });
    }

    const data = (await resp.json()) as GptResponse;
    const reply = data.choices?.[0]?.message?.content || '';
    res.json({ reply });
  } catch (err) {
    console.error('[AI] Suggest request failed:', err instanceof Error ? err.message : 'Unknown error');
    res.status(502).json({ error: 'Failed to reach AI service' });
  }
});

export default router;
