const express = require('express');
const { createRealtimeSession, handleChatMessage } = require('./aiService');
const { executeTool, TOOL_DEFINITIONS } = require('./aiTools');

function createAiRouter({ db, authOptional }) {
  const router = express.Router();

  // 1. Voice WebRTC Session (Temporary credentials)
  router.post('/session', authOptional, async (req, res) => {
    try {
      const session = await createRealtimeSession();
      res.json({
        success: true,
        mode: 'webrtc',
        client_secret: session.client_secret ? session.client_secret.value : null,
        session_id: session.id,
        model: session.model,
        voice: session.voice
      });
    } catch (err) {
      // Graceful fallback response when Realtime API key is not yet set
      res.json({
        success: false,
        fallback: 'local_speech',
        message: err.message || 'Realtime API not available, falling back to Web Speech engine'
      });
    }
  });

  // 2. Chat & AI Assist endpoint (Voice transcription text & Chat messages)
  router.post('/chat', authOptional, async (req, res, next) => {
    try {
      const { messages, activeBookingState } = req.body;
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ success: false, message: 'Messages array required' });
      }

      // Security limit: cap message length and payload
      const sanitizedMessages = messages.slice(-12).map(m => ({
        role: ['user', 'assistant', 'system'].includes(m.role) ? m.role : 'user',
        content: String(m.content || '').slice(0, 1000)
      }));

      const response = await handleChatMessage({
        messages: sanitizedMessages,
        user: req.user || null,
        db,
        activeBookingState: activeBookingState || {}
      });

      res.json({
        success: true,
        ...response
      });
    } catch (err) {
      next(err);
    }
  });

  // 3. Direct Tool Execution (for UI client invocations)
  router.post('/tools/execute', authOptional, async (req, res, next) => {
    try {
      const { name, args } = req.body;
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

  // 4. List available AI Tools schema
  router.get('/tools', (req, res) => {
    res.json({
      success: true,
      tools: TOOL_DEFINITIONS
    });
  });

  return router;
}

module.exports = { createAiRouter };

