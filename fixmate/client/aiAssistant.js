// FixMate AI Voice + Chat Assistant Controller (Phase 6)
// Features: Authenticated OpenAI Realtime WebRTC, Web Speech STT/TTS Fallback,
// Waveform Visualizer, Hindi/English/Hinglish Support, Mic Permission Handling,
// Mute & End-Call Controls, DB-Synced Conversation History, Real DB Tool Cards.

(function () {
  const HISTORY_STORAGE_KEY = 'fm_ai_history';
  const WELCOME_MSG = {
    role: 'assistant',
    content: 'Namaste! Main FixMate AI Assistant hoon. Main Dhanbad mein kisi bhi home service jaise AC Repair, Washing Machine, Plumber, Electrician book karne, slot reschedule/cancel karne, ya bill samjhane mein aapki help kar sakta hoon. Aap bol kar ya likh kar bata sakte hain!',
    time: new Date()
  };

  const AssistantState = {
    isOpen: false,
    mode: 'voice', // 'voice' | 'chat'
    status: 'idle', // 'idle' | 'listening' | 'processing' | 'speaking'
    language: 'auto', // 'auto' | 'hi' | 'en'
    isMuted: false,
    isWebRTCActive: false,
    realtimeBlocked: false,
    realtimeBlockedReason: '',
    messages: loadLocalHistory(),
    pendingBooking: null,
    // Realtime WebRTC references
    peerConnection: null,
    dataChannel: null,
    localAudioStream: null,
    remoteAudioEl: null,
    // Web Speech fallback references
    recognition: null,
    speechSynthesisUtterance: null,
    animationFrameId: null
  };

  function getApiBase() {
    let b = '';
    try { b = localStorage.getItem('fm_api_base'); } catch (e) {}
    if (!b) b = window.API_BASE_URL || '';
    if (!b && typeof location !== 'undefined' && location.origin && location.origin.startsWith('http')) {
      b = location.origin;
    }
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

  function loadLocalHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(-30);
      }
    } catch (e) {}
    return [WELCOME_MSG];
  }

  function saveLocalHistory() {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(AssistantState.messages.slice(-30)));
    } catch (e) {}
  }

  // Sync history from PostgreSQL when authenticated
  async function syncHistoryFromServer() {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`${getApiBase()}/api/ai/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.messages) && data.messages.length > 0) {
        AssistantState.messages = data.messages;
        saveLocalHistory();
        renderMessages();
      }
    } catch (e) {}
  }

  async function fetchAiStatus() {
    try {
      const res = await fetch(`${getApiBase()}/api/ai/status`);
      if (!res.ok) return;
      const data = await res.json();
      AssistantState.realtimeBlocked = data.realtime_webrtc === 'BLOCKED';
      AssistantState.realtimeBlockedReason = data.realtime_blocked_reason || '';
      const modeBadge = document.getElementById('ai-voice-mode-note');
      if (modeBadge) {
        modeBadge.textContent = AssistantState.realtimeBlocked
          ? 'Browser Voice Active (OpenAI Realtime BLOCKED: API Key not configured)'
          : 'OpenAI Realtime WebRTC + Smart Chat Ready';
      }
    } catch (e) {}
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
            <button id="ai-lang-btn" class="ai-lang-pill" onclick="window.FixMateAI.cycleLanguage()" title="Language badlo">Auto 🌐</button>
            <button class="ai-header-btn" onclick="window.FixMateAI.clearHistory()" title="History saaf karein">🗑️</button>
            <button id="ai-mode-toggle" class="ai-header-btn" onclick="window.FixMateAI.toggleMode()" title="Mode badlo">
              <span id="ai-mode-icon">💬</span>
            </button>
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
              <div class="ai-voice-tag" id="ai-voice-mode-note">Hindi • English • Hinglish</div>
              <div id="ai-live-transcript" class="ai-transcript-box">
                "Bol kar batayein: Meri washing machine se paani leak ho raha hai..."
              </div>
              <div id="ai-mic-perm-banner" class="ai-perm-banner">
                <b>Microphone Permission Blocked:</b> Browser address bar mein 🔒 icon par click karke Microphone "Allow" karein, ya neeche <b>Chat Mode</b> use karein.
                <div style="margin-top:6px">
                  <button class="ai-ctl-btn" style="padding:4px 10px;font-size:11px" onclick="window.FixMateAI.startListening()">Retry Mic</button>
                </div>
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
            <div class="ai-voice-controls" style="flex-wrap:wrap">
              <button id="ai-mute-btn" class="ai-ctl-btn" onclick="window.FixMateAI.toggleMute()">
                <span id="ai-mute-icon">🔊</span> Mute
              </button>
              <button class="ai-ctl-btn end-call" onclick="window.FixMateAI.endVoiceCall()">
                <span>📞</span> End Call
              </button>
              <button class="ai-ctl-btn switch" onclick="window.FixMateAI.setMode('chat')">
                <span>💬</span> Chat
              </button>
            </div>
          </div>
        </div>

        <!-- Mode 2: Chat Interface -->
        <div id="ai-chat-view" class="ai-view-container" style="display:none;">
          <!-- Quick Suggestions Chips -->
          <div class="ai-suggestions-bar">
            <button class="ai-chip" onclick="window.FixMateAI.sendSuggested('Meri washing machine se paani leak ho raha hai')">🌀 Washing machine leak</button>
            <button class="ai-chip" onclick="window.FixMateAI.sendSuggested('AC thandi hawa nahi de raha')">❄️ AC cooling issue</button>
            <button class="ai-chip" onclick="window.FixMateAI.sendSuggested('Mera booking status batao')">📋 Booking status</button>
            <button class="ai-chip" onclick="window.FixMateAI.sendSuggested('Mera invoice bill explain karo')">🧾 Invoice/GST</button>
            <button class="ai-chip" onclick="window.FixMateAI.sendSuggested('30 day warranty policy kya hai?')">🛡️ Warranty FAQ</button>
            <button class="ai-chip" onclick="window.FixMateAI.sendSuggested('Customer care support chahiye')">📞 Support</button>
          </div>

          <!-- Chat Message Thread -->
          <div id="ai-messages-scroll" class="ai-messages-list"></div>

          <!-- Chat Input Area -->
          <div class="ai-chat-input-bar">
            <input id="ai-text-input" type="text" placeholder="Hindi, Hinglish ya English mein likhein..." onkeydown="if(event.key==='Enter') window.FixMateAI.sendMessage()">
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

  function setupWaveform() {
    const canvas = document.getElementById('ai-waveform-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let phase = 0;
    function draw() {
      AssistantState.animationFrameId = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const isActive = AssistantState.status === 'listening' || AssistantState.status === 'speaking' || AssistantState.isWebRTCActive;
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

  function setStatus(status, text) {
    AssistantState.status = status;
    const dot = document.getElementById('ai-status-dot');
    const txt = document.getElementById('ai-status-text');
    const orb = document.getElementById('ai-mic-orb');
    const hint = document.getElementById('ai-voice-action-hint');

    if (dot) dot.className = 'ai-status-indicator ' + status;
    if (txt) {
      txt.textContent = text || (status === 'listening' ? 'Aapki aawaz sun raha hoon...' :
        status === 'processing' ? 'FixMate AI soch raha hai...' :
        status === 'speaking' ? 'FixMate AI bol raha hai...' : 'Taiyaar hai (Tap mic)');
    }
    if (orb) orb.className = 'ai-orb-ring ' + status;
    if (hint) {
      hint.textContent = status === 'listening' ? 'Sun raha hoon... Bolein' :
        status === 'processing' ? 'Database check ho raha hai...' :
        status === 'speaking' ? 'Bol raha hoon • Tap karke rokein' : 'Tap mic to speak • Bolne ke liye tap karein';
    }
  }

  function showMicPermError(show) {
    const banner = document.getElementById('ai-mic-perm-banner');
    if (banner) banner.classList.toggle('show', Boolean(show));
  }

  function cycleLanguage() {
    const order = ['auto', 'hi', 'en'];
    const labels = { auto: 'Auto 🌐', hi: 'हिंदी 🇮🇳', en: 'English' };
    const idx = (order.indexOf(AssistantState.language) + 1) % order.length;
    AssistantState.language = order[idx];
    const btn = document.getElementById('ai-lang-btn');
    if (btn) btn.textContent = labels[AssistantState.language];
  }

  async function clearHistory() {
    const token = getAuthToken();
    if (token) {
      try {
        await fetch(`${getApiBase()}/api/ai/history`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch (e) {}
    }
    AssistantState.messages = [WELCOME_MSG];
    AssistantState.pendingBooking = null;
    saveLocalHistory();
    renderMessages();
  }

  function renderMessages() {
    const list = document.getElementById('ai-messages-scroll');
    if (!list) return;

    list.innerHTML = AssistantState.messages.map((m) => {
      const isUser = m.role === 'user';
      return `
        <div class="ai-msg-row ${isUser ? 'user' : 'assistant'}">
          ${!isUser ? `<div class="ai-msg-av">✨</div>` : ''}
          <div class="ai-bubble ${isUser ? 'user' : 'assistant'}">
            <div class="ai-msg-text">${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
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

  function renderCardsHtml(cards) {
    if (!Array.isArray(cards) || cards.length === 0) return '';
    return cards.map(c => {
      if (!c || !c.result) return '';
      if (c.tool === 'create_booking' && c.result.success && c.result.booking) {
        const b = c.result.booking;
        return `
          <div class="ai-card success-booking">
            <div class="ai-card-badge">✅ Booking Confirmed</div>
            <div class="ai-card-title">${escapeHtml(b.service)}</div>
            <div class="ai-card-row"><span>Booking ID:</span> <b>#${b.id}</b></div>
            <div class="ai-card-row"><span>Slot:</span> <b>${escapeHtml(b.slot)}</b></div>
            <div class="ai-card-row"><span>Safety Code:</span> <b class="ai-code-pill">${escapeHtml(b.start_code)}</b></div>
            <div class="ai-card-row"><span>Warranty:</span> <b>30 Din Free Warranty</b></div>
            <div class="ai-card-note">${escapeHtml(b.security_note)}</div>
          </div>
        `;
      }
      if (c.tool === 'search_services' && c.result.services && c.result.services.length) {
        const s = c.result.services[0];
        const causes = c.result.possible_causes || [];
        return `
          <div class="ai-card service-preview">
            <div class="ai-card-title">${escapeHtml(s.name)}</div>
            <div class="ai-card-row"><span>Base Fee:</span> <b>${escapeHtml(s.base_price)}</b></div>
            <div class="ai-card-row"><span>Rating:</span> <b>⭐ ${s.rating} (Verified)</b></div>
            ${causes.length ? `<div class="ai-card-note"><b>Common Causes:</b> ${escapeHtml(causes.slice(0, 2).join('; '))}</div>` : ''}
            <div class="ai-card-actions">
              <button class="ai-btn-sm" onclick="window.FixMateAI.sendSuggested('Haan, ye booking confirm kar do')">Booking Confirm Karein</button>
            </div>
          </div>
        `;
      }
      if (c.tool === 'get_booking_status' && c.result.bookings && c.result.bookings.length) {
        const b = c.result.bookings[0];
        return `
          <div class="ai-card">
            <div class="ai-card-badge">📋 Booking #${b.booking_id}</div>
            <div class="ai-card-title">${escapeHtml(b.service)}</div>
            <div class="ai-card-row"><span>Status:</span> <b>${escapeHtml(b.status_text)}</b></div>
            <div class="ai-card-row"><span>Technician:</span> <b>${escapeHtml(b.assigned_worker)}</b></div>
            <div class="ai-card-row"><span>Total:</span> <b>${escapeHtml(b.total)}</b></div>
          </div>
        `;
      }
      if (c.tool === 'reschedule_booking' && c.result.rescheduled) {
        return `
          <div class="ai-card success-booking">
            <div class="ai-card-badge">🕒 Slot Rescheduled</div>
            <div class="ai-card-row"><span>Booking #${c.result.booking_id}:</span> <b>${escapeHtml(c.result.new_slot)}</b></div>
          </div>
        `;
      }
      if (c.tool === 'request_booking_cancellation' && c.result.cancelled) {
        return `
          <div class="ai-card">
            <div class="ai-card-badge" style="color:#DC2626">❌ Booking Cancelled</div>
            <div class="ai-card-note">${escapeHtml(c.result.message)}</div>
          </div>
        `;
      }
      if (c.tool === 'get_invoice_summary' && c.result.invoice) {
        const iv = c.result.invoice;
        return `
          <div class="ai-card invoice-card">
            <div class="ai-card-title">🧾 ${escapeHtml(iv.invoice_number)} (${escapeHtml(iv.payment_status)})</div>
            <div class="ai-card-row"><span>Base Labor:</span> <b>${escapeHtml(iv.base_labor)}</b></div>
            <div class="ai-card-row"><span>Spare Parts:</span> <b>${escapeHtml(iv.spare_parts)}</b></div>
            <div class="ai-card-row"><span>GST (18%):</span> <b>${escapeHtml(iv.gst_breakdown)}</b></div>
            <div class="ai-card-row"><span>Total Payable:</span> <b>${escapeHtml(iv.total_payable)}</b></div>
          </div>
        `;
      }
      if (c.tool === 'file_complaint' && c.result.ticket_created) {
        return `
          <div class="ai-card ticket-card">
            <div class="ai-card-title">🎫 Support Ticket #${c.result.ticket_id}</div>
            <div class="ai-card-row"><span>Category:</span> <b>${escapeHtml(c.result.category)}</b></div>
            <div class="ai-card-note">${escapeHtml(c.result.message)}</div>
          </div>
        `;
      }
      if (c.tool === 'find_nearby_technicians' && c.result.technicians) {
        return `
          <div class="ai-card tech-card">
            <div class="ai-card-badge">🛡️ Police & ID Verified</div>
            <div class="ai-card-title">${escapeHtml(c.result.category)} Technicians (Dhanbad)</div>
            <div class="ai-card-note">${c.result.count > 0 ? `${c.result.count} verified technician(s) available in database.` : 'No technician currently online in this trade.'}</div>
          </div>
        `;
      }
      if (c.tool === 'contact_human_support') {
        return `
          <div class="ai-card support-card">
            <div class="ai-card-title">📞 FixMate Customer Desk</div>
            <div class="ai-card-row"><span>Helpline:</span> <b>${escapeHtml(c.result.support_phone || '+91 7209612650')}</b></div>
            <div class="ai-card-row"><span>Hours:</span> <b>${escapeHtml(c.result.hours || '8 AM - 9 PM')}</b></div>
            <div class="ai-card-note">${escapeHtml(c.result.note || '')}</div>
          </div>
        `;
      }
      return '';
    }).join('');
  }

  // Attempt Authenticated OpenAI Realtime WebRTC Connection
  async function tryConnectRealtimeWebRTC() {
    const token = getAuthToken();
    if (!token || AssistantState.realtimeBlocked) return false;
    if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) return false;

    try {
      const res = await fetch(`${getApiBase()}/api/ai/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ language: AssistantState.language })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (errData.blocked) {
          AssistantState.realtimeBlocked = true;
          AssistantState.realtimeBlockedReason = errData.message;
        }
        return false;
      }

      const sessionData = await res.json();
      if (!sessionData.success || !sessionData.client_secret) return false;

      const pc = new RTCPeerConnection();
      AssistantState.peerConnection = pc;

      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      AssistantState.remoteAudioEl = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
        setStatus('speaking', 'FixMate AI bol raha hai (Realtime)...');
      };

      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      showMicPermError(false);
      AssistantState.localAudioStream = ms;
      ms.getTracks().forEach(t => {
        t.enabled = !AssistantState.isMuted;
        pc.addTrack(t, ms);
      });

      const dc = pc.createDataChannel('oai-events');
      AssistantState.dataChannel = dc;
      dc.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'conversation.item.input_audio_transcription.completed' && msg.transcript) {
            AssistantState.messages.push({ role: 'user', content: msg.transcript, time: new Date() });
            saveLocalHistory();
            renderMessages();
            const box = document.getElementById('ai-live-transcript');
            if (box) box.textContent = `"${msg.transcript}"`;
          } else if (msg.type === 'response.audio_transcript.done' && msg.transcript) {
            AssistantState.messages.push({ role: 'assistant', content: msg.transcript, time: new Date() });
            saveLocalHistory();
            renderMessages();
            setStatus('listening', 'Realtime Audio Active...');
          } else if (msg.type === 'response.function_call_arguments.done') {
            const args = JSON.parse(msg.arguments || '{}');
            const toolRes = await fetch(`${getApiBase()}/api/ai/tools/execute`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
              },
              body: JSON.stringify({ name: msg.name, args })
            }).then(r => r.json()).catch(e => ({ error: e.message }));

            dc.send(JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: msg.call_id,
                output: JSON.stringify(toolRes.result || toolRes)
              }
            }));
            dc.send(JSON.stringify({ type: 'response.create' }));
          }
        } catch (e) {}
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(sessionData.model)}`, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${sessionData.client_secret}`,
          'Content-Type': 'application/sdp'
        }
      });

      if (!sdpRes.ok) {
        teardownWebRTC();
        return false;
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      AssistantState.isWebRTCActive = true;
      setStatus('listening', 'Realtime Voice Connected (HD)...');
      return true;
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        showMicPermError(true);
      }
      teardownWebRTC();
      return false;
    }
  }

  function teardownWebRTC() {
    AssistantState.isWebRTCActive = false;
    if (AssistantState.dataChannel) {
      try { AssistantState.dataChannel.close(); } catch (e) {}
      AssistantState.dataChannel = null;
    }
    if (AssistantState.peerConnection) {
      try { AssistantState.peerConnection.close(); } catch (e) {}
      AssistantState.peerConnection = null;
    }
    if (AssistantState.localAudioStream) {
      try { AssistantState.localAudioStream.getTracks().forEach(t => t.stop()); } catch (e) {}
      AssistantState.localAudioStream = null;
    }
    if (AssistantState.remoteAudioEl) {
      try { AssistantState.remoteAudioEl.srcObject = null; } catch (e) {}
      AssistantState.remoteAudioEl = null;
    }
  }

  // Start Voice Listening (WebRTC first if configured, otherwise Web Speech STT)
  async function startListening() {
    interruptSpeech();
    showMicPermError(false);

    if (!AssistantState.realtimeBlocked && !AssistantState.isWebRTCActive) {
      const webrtcConnected = await tryConnectRealtimeWebRTC();
      if (webrtcConnected) return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatus('idle', 'Voice STT unsupported — switching to Chat');
      setMode('chat');
      return;
    }

    try {
      if (AssistantState.recognition) {
        AssistantState.recognition.abort();
      }

      const recog = new SpeechRecognition();
      AssistantState.recognition = recog;
      recog.lang = AssistantState.language === 'en' ? 'en-IN' : 'hi-IN';
      recog.continuous = false;
      recog.interimResults = true;

      recog.onstart = () => {
        showMicPermError(false);
        setStatus('listening', 'Aapki aawaz sun raha hoon...');
      };

      recog.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        const box = document.getElementById('ai-live-transcript');
        if (box && transcript) box.textContent = `"${transcript}"`;
        if (event.results[event.results.length - 1]?.isFinal) {
          handleUserUtterance(transcript);
        }
      };

      recog.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          showMicPermError(true);
          setStatus('idle', 'Microphone permission denied');
        } else {
          setStatus('idle', 'Tap mic to speak');
        }
      };

      recog.onend = () => {
        if (AssistantState.status === 'listening') {
          setStatus('idle', 'Tap mic to speak');
        }
      };

      recog.start();
    } catch (err) {
      setStatus('idle', 'Microphone error: ' + err.message);
    }
  }

  function stopListening() {
    if (AssistantState.recognition) {
      try { AssistantState.recognition.stop(); } catch (e) {}
    }
    if (AssistantState.status === 'listening') {
      setStatus('idle', 'Tap mic to speak');
    }
  }

  let speechWatchdog = null;

  function toggleListening() {
    interruptSpeech();
    if (AssistantState.status === 'listening' || AssistantState.isWebRTCActive) {
      teardownWebRTC();
      stopListening();
    } else {
      startListening();
    }
  }

  function endVoiceCall() {
    teardownWebRTC();
    stopListening();
    interruptSpeech();
    setMode('chat');
  }

  function interruptSpeech() {
    if (speechWatchdog) {
      clearTimeout(speechWatchdog);
      speechWatchdog = null;
    }
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    if (!AssistantState.isWebRTCActive) {
      setStatus('idle', 'Tap mic to speak');
    }
  }

  async function handleUserUtterance(text) {
    if (!text || !text.trim()) return;
    text = text.trim();

    AssistantState.messages.push({ role: 'user', content: text, time: new Date() });
    saveLocalHistory();
    renderMessages();
    setStatus('processing', 'FixMate AI soch raha hai...');

    const box = document.getElementById('ai-live-transcript');
    if (box) box.textContent = `"${text}"`;

    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 14000);

    try {
      const token = getAuthToken();
      const res = await fetch(`${getApiBase()}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          messages: AssistantState.messages.map(m => ({ role: m.role, content: m.content })),
          activeBookingState: AssistantState.pendingBooking || {},
          language: AssistantState.language
        }),
        signal: controller.signal
      });

      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'AI processing error');

      if (data.pendingBooking === null) {
        AssistantState.pendingBooking = null;
      } else if (data.pendingBooking) {
        AssistantState.pendingBooking = {
          ...AssistantState.pendingBooking,
          ...data.pendingBooking,
          pendingConfirmation: true
        };
      }

      if (data.cards && data.cards.some(c =>
        ['create_booking', 'reschedule_booking', 'request_booking_cancellation'].includes(c.tool) && c.result?.success
      )) {
        AssistantState.pendingBooking = null;
        try {
          if (typeof window.refresh === 'function') window.refresh().catch(() => {});
        } catch (e) {}
      }

      AssistantState.messages.push({
        role: 'assistant',
        content: data.reply,
        cards: data.cards || [],
        time: new Date()
      });
      saveLocalHistory();
      renderMessages();

      if (AssistantState.mode === 'voice' && !AssistantState.isMuted) {
        speakResponse(data.reply);
      } else {
        setStatus('idle', 'Ready');
      }
    } catch (err) {
      const errMsg = err.name === 'AbortError'
        ? 'Network timeout ho gaya. Kripya dobara bolein.'
        : 'Maaf kijiye, backend se response nahi mila. Kripya check karein server chalu hai.';
      AssistantState.messages.push({ role: 'assistant', content: errMsg, time: new Date() });
      saveLocalHistory();
      renderMessages();
      setStatus('idle', 'Tap mic to speak');
      if (AssistantState.mode === 'voice' && !AssistantState.isMuted) {
        speakResponse(errMsg);
      }
    } finally {
      clearTimeout(fetchTimeout);
    }
  }

  function speakResponse(text) {
    if (speechWatchdog) clearTimeout(speechWatchdog);
    if (!('speechSynthesis' in window)) {
      setStatus('idle', 'Ready');
      return;
    }

    try { window.speechSynthesis.cancel(); } catch (e) {}

    const cleanText = String(text || '').replace(/[*_#`]/g, '').replace(/https?:\/\/\S+/g, '').slice(0, 340);
    const utter = new SpeechSynthesisUtterance(cleanText);

    try {
      const voices = window.speechSynthesis.getVoices();
      const targetLang = AssistantState.language === 'en' ? 'en-IN' : 'hi';
      const indVoice = voices.find(v => v.lang.includes(targetLang) || v.lang.includes('IN')) || voices[0];
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

    const maxDuration = Math.min(10000, Math.max(3000, cleanText.length * 65));
    speechWatchdog = setTimeout(resetToIdle, maxDuration);
    AssistantState.speechSynthesisUtterance = utter;

    setTimeout(() => {
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        window.speechSynthesis.speak(utter);
      } catch (e) {
        resetToIdle();
      }
    }, 70);
  }

  function toggleMute() {
    AssistantState.isMuted = !AssistantState.isMuted;
    const btn = document.getElementById('ai-mute-btn');
    const icon = document.getElementById('ai-mute-icon');
    if (btn && icon) {
      icon.textContent = AssistantState.isMuted ? '🔇' : '🔊';
      btn.classList.toggle('muted', AssistantState.isMuted);
    }
    if (AssistantState.localAudioStream) {
      AssistantState.localAudioStream.getAudioTracks().forEach(t => {
        t.enabled = !AssistantState.isMuted;
      });
    }
    if (AssistantState.isMuted) interruptSpeech();
  }

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

  function sendMessage() {
    const input = document.getElementById('ai-text-input');
    if (!input) return;
    const txt = input.value.trim();
    if (!txt) return;
    input.value = '';
    handleUserUtterance(txt);
  }

  function sendSuggested(txt) {
    if (AssistantState.mode === 'voice') setMode('chat');
    handleUserUtterance(txt);
  }

  function openAssistant(initialMode = 'voice') {
    initAssistantUI();
    AssistantState.isOpen = true;
    const backdrop = document.getElementById('ai-modal-backdrop');
    const panel = document.getElementById('ai-panel');

    if (backdrop) backdrop.classList.add('open');
    if (panel) panel.classList.add('open');

    fetchAiStatus();
    syncHistoryFromServer();
    setMode(initialMode);
  }

  function closeAssistant() {
    AssistantState.isOpen = false;
    teardownWebRTC();
    interruptSpeech();
    stopListening();

    const backdrop = document.getElementById('ai-modal-backdrop');
    const panel = document.getElementById('ai-panel');

    if (backdrop) backdrop.classList.remove('open');
    if (panel) panel.classList.remove('open');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function formatTime(d) {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  window.FixMateAI = {
    open: openAssistant,
    close: closeAssistant,
    toggleMode,
    setMode,
    toggleListening,
    startListening,
    endVoiceCall,
    interruptSpeech,
    toggleMute,
    cycleLanguage,
    clearHistory,
    sendMessage,
    sendSuggested
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAssistantUI);
  } else {
    initAssistantUI();
  }
})();
