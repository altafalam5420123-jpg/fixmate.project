// FixMate AI Voice + Chat Assistant Controller
// Features: Realtime WebRTC Voice, Web Speech API Fallback, Waveform Visualizer,
// Interactive Chat Interface, Multilingual (Hindi/English/Hinglish), Tool Cards.

(function () {
  const AssistantState = {
    isOpen: false,
    mode: 'voice', // 'voice' | 'chat'
    status: 'idle', // 'idle' | 'listening' | 'processing' | 'speaking'
    isMuted: false,
    messages: [
      {
        role: 'assistant',
        content: 'Namaste! Main FixMate AI Assistant hoon. Main Dhanbad mein kisi bhi home service jaise Electrician, Plumber, AC Repair ya Tutor book karne mein aapki help kar sakta hoon. Aap bol kar ya likh kar bata sakte hain!',
        time: new Date()
      }
    ],
    pendingBooking: null,
    // Realtime WebRTC references
    peerConnection: null,
    dataChannel: null,
    localAudioStream: null,
    // Web Speech fallback references
    recognition: null,
    speechSynthesisUtterance: null,
    audioContext: null,
    analyser: null,
    animationFrameId: null
  };

  // Helper to get backend URL
  function getApiBase() {
    let b = '';
    try { b = localStorage.getItem('fm_api_base'); } catch (e) {}
    if (!b) b = window.API_BASE_URL || '';
    return String(b).trim().replace(/\/+$/, '');
  }

  function getAuthToken() {
    try {
      const a = JSON.parse(localStorage.getItem('fm_auth') || 'null');
      return a ? a.t : null;
    } catch (e) {
      return null;
    }
  }

  // Inject UI container into DOM
  function initAssistantUI() {
    if (document.getElementById('fixmate-ai-root')) return;

    const root = document.createElement('div');
    root.id = 'fixmate-ai-root';
    root.innerHTML = `
      <!-- Floating Action Pill -->
      <button id="ai-floating-btn" class="ai-fab-pill" onclick="window.FixMateAI.open('voice')" aria-label="Talk to FixMate AI">
        <span class="ai-fab-icon">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
          </svg>
        </span>
        <span class="ai-fab-text">Talk to FixMate AI</span>
        <span class="ai-fab-sparkle">✨</span>
      </button>

      <!-- Assistant Modal Backdrop -->
      <div id="ai-modal-backdrop" class="ai-backdrop" onclick="window.FixMateAI.close()"></div>

      <!-- Assistant Drawer / Panel -->
      <div id="ai-panel" class="ai-modal-panel">
        <!-- Panel Header -->
        <div class="ai-header">
          <div class="ai-header-brand">
            <div class="ai-avatar-badge">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>
              </svg>
            </div>
            <div>
              <div class="ai-title">FixMate AI Assistant</div>
              <div class="ai-subtitle">
                <span class="ai-status-indicator" id="ai-status-dot"></span>
                <span id="ai-status-text">Voice & Chat ready</span>
              </div>
            </div>
          </div>

          <div class="ai-header-controls">
            <!-- Mode Toggle Button (Voice <-> Chat) -->
            <button id="ai-mode-toggle" class="ai-header-btn" onclick="window.FixMateAI.toggleMode()" title="Mode badlo">
              <span id="ai-mode-icon">💬</span>
            </button>
            <!-- Close Button -->
            <button class="ai-header-btn" onclick="window.FixMateAI.close()" title="Band karein">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Mode 1: Voice Interface -->
        <div id="ai-voice-view" class="ai-view-container ai-voice-active">
          <div class="ai-voice-hero">
            <div class="ai-voice-prompt-card">
              <div class="ai-voice-tag">Hindi • English • Hinglish</div>
              <div id="ai-live-transcript" class="ai-transcript-box">
                "Bol kar batayein: Washing machine ya AC repair karwani hai..."
              </div>
            </div>

            <!-- Animated Waveform & Visualizer Orb -->
            <div class="ai-visualizer-container">
              <canvas id="ai-waveform-canvas" width="300" height="70" class="ai-waveform"></canvas>
              <div id="ai-mic-orb" class="ai-orb-ring" onclick="window.FixMateAI.toggleListening()">
                <div class="ai-orb-core">
                  <svg id="ai-mic-svg" viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="22"/>
                  </svg>
                </div>
              </div>
              <div id="ai-voice-action-hint" class="ai-action-hint">Tap mic to speak • Bolne ke liye tap karein</div>
            </div>

            <!-- Voice Controls Bar -->
            <div class="ai-voice-controls">
              <button id="ai-mute-btn" class="ai-ctl-btn" onclick="window.FixMateAI.toggleMute()">
                <span id="ai-mute-icon">🔊</span> Mute
              </button>
              <button class="ai-ctl-btn stop" onclick="window.FixMateAI.interruptSpeech()">
                <span>⏹️</span> Stop Speaking
              </button>
              <button class="ai-ctl-btn switch" onclick="window.FixMateAI.setMode('chat')">
                <span>💬</span> Chat Mode
              </button>
            </div>
          </div>
        </div>

        <!-- Mode 2: Chat Interface -->
        <div id="ai-chat-view" class="ai-view-container" style="display:none;">
          <!-- Quick Suggestions Chips -->
          <div class="ai-suggestions-bar">
            <button class="ai-chip" onclick="window.FixMateAI.sendSuggested('Washing machine repair karwani hai')">🌀 Washing machine</button>
            <button class="ai-chip" onclick="window.FixMateAI.sendSuggested('AC gas refill kitne ki hai?')">❄️ AC gas refill</button>
            <button class="ai-chip" onclick="window.FixMateAI.sendSuggested('Mera booking status batao')">📋 Booking status</button>
            <button class="ai-chip" onclick="window.FixMateAI.sendSuggested('Verified electrician chahiye')">💡 Electrician</button>
            <button class="ai-chip" onclick="window.FixMateAI.sendSuggested('Customer care support chahiye')">📞 Support</button>
          </div>

          <!-- Chat Message Thread -->
          <div id="ai-messages-scroll" class="ai-messages-list">
            <!-- Messages rendered dynamically -->
          </div>

          <!-- Chat Input Area -->
          <div class="ai-chat-input-bar">
            <input id="ai-text-input" type="text" placeholder="Apni problem likhein ya bolein..." onkeydown="if(event.key==='Enter') window.FixMateAI.sendMessage()">
            <button id="ai-send-btn" class="ai-send-btn" onclick="window.FixMateAI.sendMessage()" aria-label="Send message">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    setupWaveform();
    renderMessages();
  }

  // Waveform visualization
  function setupWaveform() {
    const canvas = document.getElementById('ai-waveform-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let phase = 0;
    function draw() {
      AssistantState.animationFrameId = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const isActive = AssistantState.status === 'listening' || AssistantState.status === 'speaking';
      const amp = isActive ? (AssistantState.status === 'speaking' ? 22 : 14) : 2;
      const freq = isActive ? 0.08 : 0.03;
      phase += isActive ? 0.09 : 0.02;

      ctx.beginPath();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = isActive ? (AssistantState.status === 'speaking' ? '#FA6A00' : '#006A60') : 'rgba(0,106,96,0.2)';

      for (let x = 0; x < canvas.width; x++) {
        const y = canvas.height / 2 + Math.sin(x * freq + phase) * amp * Math.sin((x / canvas.width) * Math.PI);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Second harmonic wave
      if (isActive) {
        ctx.beginPath();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = AssistantState.status === 'speaking' ? 'rgba(250,106,0,0.45)' : 'rgba(47,158,122,0.45)';
        for (let x = 0; x < canvas.width; x++) {
          const y = canvas.height / 2 + Math.sin(x * (freq * 1.5) - phase) * (amp * 0.7) * Math.sin((x / canvas.width) * Math.PI);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    draw();
  }

  // Update UI status & visual states
  function setStatus(status, text) {
    AssistantState.status = status;
    const dot = document.getElementById('ai-status-dot');
    const txt = document.getElementById('ai-status-text');
    const orb = document.getElementById('ai-mic-orb');
    const hint = document.getElementById('ai-voice-action-hint');

    if (dot) {
      dot.className = 'ai-status-indicator ' + status;
    }
    if (txt) {
      txt.textContent = text || (status === 'listening' ? 'Aapki aawaz sun raha hoon...' :
                                 status === 'processing' ? 'FixMate AI soch raha hai...' :
                                 status === 'speaking' ? 'FixMate AI bol raha hai...' : 'Taiyaar hai (Tap mic)');
    }
    if (orb) {
      orb.className = 'ai-orb-ring ' + status;
    }
    if (hint) {
      hint.textContent = status === 'listening' ? 'Sun raha hoon... Bolein' :
                         status === 'processing' ? 'Jankari verify ho rahi hai...' :
                         status === 'speaking' ? 'Bol raha hoon • Tap karke rokein' : 'Tap mic to speak • Bolne ke liye tap karein';
    }
  }

  // Render Messages list
  function renderMessages() {
    const list = document.getElementById('ai-messages-scroll');
    if (!list) return;

    list.innerHTML = AssistantState.messages.map((m, idx) => {
      const isUser = m.role === 'user';
      return `
        <div class="ai-msg-row ${isUser ? 'user' : 'assistant'}">
          ${!isUser ? `<div class="ai-msg-av">✨</div>` : ''}
          <div class="ai-bubble ${isUser ? 'user' : 'assistant'}">
            <div class="ai-msg-text">${escapeHtml(m.content)}</div>
            ${m.cards ? renderCardsHtml(m.cards) : ''}
            <div class="ai-msg-time">${formatTime(m.time)}</div>
          </div>
        </div>
      `;
    }).join('') + (AssistantState.status === 'processing' ? `
      <div class="ai-msg-row assistant">
        <div class="ai-msg-av">✨</div>
        <div class="ai-bubble assistant typing">
          <span class="ai-typing-dot"></span>
          <span class="ai-typing-dot"></span>
          <span class="ai-typing-dot"></span>
        </div>
      </div>
    ` : '');

    list.scrollTop = list.scrollHeight;
  }

  // Render interactive cards inside chat
  function renderCardsHtml(cards) {
    if (!Array.isArray(cards) || cards.length === 0) return '';
    return cards.map(c => {
      if (c.tool === 'create_booking' && c.result && c.result.success) {
        const b = c.result.booking;
        return `
          <div class="ai-card success-booking">
            <div class="ai-card-badge">✅ Booking Confirmed</div>
            <div class="ai-card-title">${escapeHtml(b.service)}</div>
            <div class="ai-card-row"><span>Booking ID:</span> <b>#${b.id}</b></div>
            <div class="ai-card-row"><span>Slot:</span> <b>${escapeHtml(b.slot)}</b></div>
            <div class="ai-card-row"><span>Safety Code:</span> <b class="ai-code-pill">${b.start_code}</b></div>
            <div class="ai-card-row"><span>Warranty:</span> <b>30 Din Free Warranty</b></div>
            <div class="ai-card-note">${escapeHtml(b.security_note)}</div>
          </div>
        `;
      }
      if (c.tool === 'search_services' && c.result && c.result.services && c.result.services.length) {
        const s = c.result.services[0];
        return `
          <div class="ai-card service-preview">
            <div class="ai-card-title">${escapeHtml(s.name)}</div>
            <div class="ai-card-row"><span>Base Visit:</span> <b>${s.base_price}</b></div>
            <div class="ai-card-row"><span>Rating:</span> <b>⭐ ${s.rating} (Verified)</b></div>
            <div class="ai-card-actions">
              <button class="ai-btn-sm" onclick="window.FixMateAI.sendSuggested('Haan, ye booking confirm kar do')">Booking Confirm Karein</button>
            </div>
          </div>
        `;
      }
      if (c.tool === 'find_nearby_technicians' && c.result && c.result.technicians) {
        return `
          <div class="ai-card tech-card">
            <div class="ai-card-badge">🛡️ Police & ID Verified</div>
            <div class="ai-card-title">${escapeHtml(c.result.category)} Technicians (Dhanbad)</div>
            <div class="ai-card-note">Verified workers are ready for fast dispatch within 60 minutes.</div>
          </div>
        `;
      }
      if (c.tool === 'contact_human_support' && c.result) {
        return `
          <div class="ai-card support-card">
            <div class="ai-card-title">📞 FixMate Customer Desk</div>
            <div class="ai-card-row"><span>Helpline:</span> <b>${c.result.toll_free}</b></div>
            <div class="ai-card-note">${escapeHtml(c.result.message)}</div>
          </div>
        `;
      }
      return '';
    }).join('');
  }

  // Voice Interaction Engine: WebRTC Realtime + Web Speech Fallback
  async function startListening() {
    interruptSpeech();

    // 1. Try Web Speech Recognition for immediate listening feedback
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Aapka browser Speech Recognition support nahi karta. Kripya Chat mode mein text likhein.');
      setMode('chat');
      return;
    }

    try {
      if (AssistantState.recognition) {
        AssistantState.recognition.abort();
      }

      const recog = new SpeechRecognition();
      AssistantState.recognition = recog;
      recog.lang = 'hi-IN'; // Recognizes Hindi and Indian English naturally
      recog.continuous = false;
      recog.interimResults = true;

      recog.onstart = () => {
        setStatus('listening', 'Aapki aawaz sun raha hoon...');
      };

      recog.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        const box = document.getElementById('ai-live-transcript');
        if (box && transcript) {
          box.textContent = `"${transcript}"`;
        }
        if (event.results[0].isFinal) {
          handleUserUtterance(transcript);
        }
      };

      recog.onerror = (e) => {
        console.warn('Speech recognition error:', e.error);
        if (e.error === 'not-allowed') {
          alert('Microphone permission allow karein taaki FixMate AI aapki aawaz sun sake.');
        }
        setStatus('idle', 'Tap mic to speak');
      };

      recog.onend = () => {
        if (AssistantState.status === 'listening') {
          setStatus('idle', 'Tap mic to speak');
        }
      };

      recog.start();
    } catch (err) {
      console.error('Mic start error:', err);
      setStatus('idle', 'Microphone error: ' + err.message);
    }
  }

  function stopListening() {
    if (AssistantState.recognition) {
      try {
        AssistantState.recognition.stop();
      } catch (e) {}
    }
    if (AssistantState.status === 'listening') {
      setStatus('idle', 'Tap mic to speak');
    }
  }

  let speechWatchdog = null;

  function toggleListening() {
    interruptSpeech();
    if (AssistantState.status === 'listening') {
      stopListening();
    } else {
      startListening();
    }
  }

  // Interruption handling: User taps stop or speaks over AI
  function interruptSpeech() {
    if (speechWatchdog) {
      clearTimeout(speechWatchdog);
      speechWatchdog = null;
    }
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    setStatus('idle', 'Tap mic to speak');
  }

  // Handle customer speech or text
  async function handleUserUtterance(text) {
    if (!text || !text.trim()) return;
    text = text.trim();

    // Add user message to UI
    AssistantState.messages.push({
      role: 'user',
      content: text,
      time: new Date()
    });
    renderMessages();
    setStatus('processing', 'FixMate AI soch raha hai...');

    const box = document.getElementById('ai-live-transcript');
    if (box) box.textContent = `"${text}"`;

    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 12000);

    try {
      const base = getApiBase();
      const token = getAuthToken();

      const res = await fetch(`${base}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          messages: AssistantState.messages.map(m => ({ role: m.role, content: m.content })),
          activeBookingState: AssistantState.pendingBooking || {}
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.message || 'AI processing error');
      }

      // Update pending booking state if present
      if (data.pendingBooking) {
        AssistantState.pendingBooking = {
          ...AssistantState.pendingBooking,
          ...data.pendingBooking,
          pendingConfirmation: true
        };
      }

      // If user confirms, clear pending
      if (data.cards && data.cards.some(c => c.tool === 'create_booking' && c.result?.success)) {
        AssistantState.pendingBooking = null;
        try {
          if (typeof window.refresh === 'function') {
            window.refresh().catch(() => {});
          }
        } catch (e) {}
      }

      // Add assistant response
      AssistantState.messages.push({
        role: 'assistant',
        content: data.reply,
        cards: data.cards || [],
        time: new Date()
      });
      renderMessages();

      // Speak response aloud if in Voice Mode
      if (AssistantState.mode === 'voice' && !AssistantState.isMuted) {
        speakResponse(data.reply);
      } else {
        setStatus('idle', 'Ready');
      }
    } catch (err) {
      console.error('AI chat error:', err);
      const errMsg = err.name === 'AbortError'
        ? 'Network timeout ho gaya. Kripya dobara bolein.'
        : 'Maaf kijiye, backend se response nahi mila. Kripya check karein server chalu hai.';
      AssistantState.messages.push({
        role: 'assistant',
        content: errMsg,
        time: new Date()
      });
      renderMessages();
      setStatus('idle', 'Tap mic to speak');
      if (AssistantState.mode === 'voice' && !AssistantState.isMuted) {
        speakResponse(errMsg);
      }
    } finally {
      clearTimeout(fetchTimeout);
    }
  }

  // Speech Synthesis Output (Natural Indian pitch & rate with Watchdog protection)
  function speakResponse(text) {
    if (speechWatchdog) clearTimeout(speechWatchdog);

    if (!('speechSynthesis' in window)) {
      setStatus('idle', 'Ready');
      return;
    }

    try {
      window.speechSynthesis.cancel();
    } catch (e) {}

    const cleanText = text.replace(/[*_#`]/g, '').replace(/https?:\/\/\S+/g, '').slice(0, 320);
    const utter = new SpeechSynthesisUtterance(cleanText);

    // Pick best Hindi / Indian English voice if available
    try {
      const voices = window.speechSynthesis.getVoices();
      const indVoice = voices.find(v => v.lang.includes('hi') || v.lang.includes('IN')) || voices[0];
      if (indVoice) utter.voice = indVoice;
    } catch (e) {}

    utter.rate = 1.05;
    utter.pitch = 1.0;

    const resetToIdle = () => {
      if (speechWatchdog) clearTimeout(speechWatchdog);
      setStatus('idle', 'Tap mic to speak');
    };

    utter.onstart = () => {
      setStatus('speaking', 'FixMate AI bol raha hai...');
      const box = document.getElementById('ai-live-transcript');
      if (box) box.textContent = cleanText;
    };

    utter.onend = resetToIdle;
    utter.onerror = resetToIdle;

    // Safety watchdog: Chrome Android Web Speech bug prevention
    const maxDuration = Math.min(9000, Math.max(3000, cleanText.length * 65));
    speechWatchdog = setTimeout(resetToIdle, maxDuration);

    AssistantState.speechSynthesisUtterance = utter;

    // Delay slightly to avoid cancel/speak collision in Android Chromium
    setTimeout(() => {
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        window.speechSynthesis.speak(utter);
      } catch (e) {
        resetToIdle();
      }
    }, 70);
  }

  // Toggle Mute
  function toggleMute() {
    AssistantState.isMuted = !AssistantState.isMuted;
    const btn = document.getElementById('ai-mute-btn');
    const icon = document.getElementById('ai-mute-icon');
    if (btn && icon) {
      icon.textContent = AssistantState.isMuted ? '🔇' : '🔊';
      btn.classList.toggle('muted', AssistantState.isMuted);
    }
    if (AssistantState.isMuted) {
      interruptSpeech();
    }
  }

  // Toggle Mode (Voice <-> Chat)
  function toggleMode() {
    setMode(AssistantState.mode === 'voice' ? 'chat' : 'voice');
  }

  function setMode(mode) {
    AssistantState.mode = mode;
    const voiceView = document.getElementById('ai-voice-view');
    const chatView = document.getElementById('ai-chat-view');
    const modeIcon = document.getElementById('ai-mode-icon');

    if (mode === 'chat') {
      interruptSpeech();
      stopListening();
      if (voiceView) voiceView.style.display = 'none';
      if (chatView) chatView.style.display = 'flex';
      if (modeIcon) modeIcon.textContent = '🎙️';
      renderMessages();
    } else {
      if (chatView) chatView.style.display = 'none';
      if (voiceView) voiceView.style.display = 'flex';
      if (modeIcon) modeIcon.textContent = '💬';
      startListening();
    }
  }

  // Send message from chat input
  function sendMessage() {
    const input = document.getElementById('ai-text-input');
    if (!input) return;
    const txt = input.value.trim();
    if (!txt) return;
    input.value = '';
    handleUserUtterance(txt);
  }

  function sendSuggested(txt) {
    handleUserUtterance(txt);
  }

  // Open & Close Modal
  function openAssistant(initialMode = 'voice') {
    initAssistantUI();
    AssistantState.isOpen = true;
    const backdrop = document.getElementById('ai-modal-backdrop');
    const panel = document.getElementById('ai-panel');

    if (backdrop) backdrop.classList.add('open');
    if (panel) panel.classList.add('open');

    setMode(initialMode);
  }

  function closeAssistant() {
    AssistantState.isOpen = false;
    interruptSpeech();
    stopListening();

    const backdrop = document.getElementById('ai-modal-backdrop');
    const panel = document.getElementById('ai-panel');

    if (backdrop) backdrop.classList.remove('open');
    if (panel) panel.classList.remove('open');
  }

  // Utilities
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function formatTime(d) {
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Expose global interface
  window.FixMateAI = {
    open: openAssistant,
    close: closeAssistant,
    toggleMode,
    setMode,
    toggleListening,
    interruptSpeech,
    toggleMute,
    sendMessage,
    sendSuggested
  };

  // Auto-init floating button when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAssistantUI);
  } else {
    initAssistantUI();
  }
})();

