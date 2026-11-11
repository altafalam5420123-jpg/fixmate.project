const express = require('express');
const {
  createRealtimeSession,
  handleChatMessage,
  isOpenAIRealtimeConfigured,
  isGeminiConfigured
} = require('./aiService');
const { executeTool, TOOL_DEFINITIONS } = require('./aiTools');

function createAiRouter({ db, auth, authOptional }) {
  const router = express.Router();
  const requireAuth = auth ? auth() : (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Login karo' });
    next();
  };

  // 0. Check AI Voice & Chat capability status (never fakes credentials)
  router.get('/status', (req, res) => {
    const realtimeReady = isOpenAIRealtimeConfigured();
    const geminiReady = isGeminiConfigured();
    res.json({
      success: true,
      realtime_webrtc: realtimeReady ? 'ready' : 'BLOCKED',
      realtime_blocked_reason: realtimeReady ? null : 'OPENAI_API_KEY not configured in backend .env',
      chat_provider: geminiReady ? 'gemini' : (realtimeReady ? 'openai' : 'fixmate-ai-fallback'),
      speech_fallback: 'browser_web_speech_api',
      languages: ['Hindi', 'English', 'Hinglish']
    });
  });

  // 1. Voice WebRTC Session (Authenticated endpoint issuing short-lived credentials)
  router.post('/session', requireAuth, async (req, res) => {
    if (!isOpenAIRealtimeConfigured()) {
      return res.status(503).json({
        success: false,
        blocked: true,
        fallback: 'local_speech',
        message: 'BLOCKED: OPENAI_API_KEY backend .env mein configure nahi hai. Browser Web Speech API fallback active hai.'
      });
    }

    try {
      const language = req.body && req.body.language ? String(req.body.language) : 'auto';
      const session = await createRealtimeSession(language);
      res.json({
        success: true,
        mode: 'webrtc',
        client_secret: session.client_secret ? session.client_secret.value : null,
        expires_at: session.client_secret ? session.client_secret.expires_at : null,
        session_id: session.id,
        model: session.model,
        voice: session.voice
      });
    } catch (err) {
      res.status(502).json({
        success: false,
        fallback: 'local_speech',
        message: err.message || 'Realtime API session creation failed'
      });
    }
  });

  // 2. Chat & AI Assist endpoint (Voice transcript & Chat messages + DB history sync)
  router.post('/chat', authOptional, async (req, res, next) => {
    try {
      const { messages, activeBookingState, language } = req.body || {};
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ success: false, message: 'Messages array required' });
      }

      const sanitizedMessages = messages.slice(-12).map(m => ({
        role: ['user', 'assistant', 'system'].includes(m.role) ? m.role : 'user',
        content: String(m.content || '').slice(0, 1000)
      }));

      const lastUserMsg = [...sanitizedMessages].reverse().find(m => m.role === 'user');

      const response = await handleChatMessage({
        messages: sanitizedMessages,
        user: req.user || null,
        db,
        activeBookingState: activeBookingState || {},
        language: language || 'auto'
      });

      // Persist conversation history for authenticated users
      if (req.user && req.user.id && lastUserMsg) {
        try {
          await db.query(
            'INSERT INTO ai_messages (user_id, role, content, provider) VALUES ($1, $2, $3, $4)',
            [req.user.id, 'user', lastUserMsg.content, 'user']
          );
          await db.query(
            'INSERT INTO ai_messages (user_id, role, content, cards_json, provider) VALUES ($1, $2, $3, $4, $5)',
            [
              req.user.id,
              'assistant',
              String(response.reply || ''),
              response.cards && response.cards.length ? JSON.stringify(response.cards) : null,
              response.provider || 'fixmate-ai'
            ]
          );
        } catch (histErr) {
          console.warn('[AI History Save Notice]:', histErr.message);
        }
      }

      res.json({
        success: true,
        ...response
      });
    } catch (err) {
      next(err);
    }
  });

  // 3. Get Conversation History (Authenticated user)
  router.get('/history', requireAuth, async (req, res, next) => {
    try {
      const rows = await db.query(
        'SELECT id, role, content, cards_json, provider, created_at FROM ai_messages WHERE user_id = $1 ORDER BY id DESC LIMIT 40',
        [req.user.id]
      );
      const history = rows.rows.reverse().map(r => {
        let cards = [];
        try {
          if (r.cards_json) cards = JSON.parse(r.cards_json);
        } catch {
          cards = [];
        }
        return {
          id: r.id,
          role: r.role,
          content: r.content,
          cards,
          provider: r.provider,
          time: r.created_at
        };
      });
      res.json({ success: true, messages: history });
    } catch (err) {
      next(err);
    }
  });

  // 4. Clear Conversation History (Authenticated user)
  router.delete('/history', requireAuth, async (req, res, next) => {
    try {
      await db.query('DELETE FROM ai_messages WHERE user_id = $1', [req.user.id]);
      res.json({ success: true, message: 'Conversation history cleared' });
    } catch (err) {
      next(err);
    }
  });

  // 5. Direct Tool Execution (for WebRTC DataChannel & UI tool calls)
  router.post('/tools/execute', authOptional, async (req, res, next) => {
    try {
      const { name, args } = req.body || {};
      if (!name) return res.status(400).json({ success: false, message: 'Tool name required' });

      const result = await executeTool(name, args || {}, { db, user: req.user || null });
      res.json({
        success: true,
        tool: name,
        result
      });
    } catch (err) {
      next(err);
    }
  });

  // 6. List available AI Tools schema
  router.get('/tools', (req, res) => {
    res.json({
      success: true,
      tools: TOOL_DEFINITIONS
    });
  });

  return router;
}

module.exports = { createAiRouter };
