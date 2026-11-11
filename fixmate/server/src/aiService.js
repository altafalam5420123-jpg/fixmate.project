const { TOOL_DEFINITIONS, executeTool, diagnoseSymptom } = require('./aiTools');
const { CATEGORIES } = require('./db');

const SYSTEM_PROMPT = `Aap FixMate home services platform (Dhanbad, Jharkhand) ke official AI Voice & Chat Assistant hain.
Aapka kaam customer ki samasyaon ko samajhna, simple causes batana, follow-up sawal poochna, real database se service aur charges batana, aur customer ke explicit confirmation ke baad hi booking/reschedule/cancel karna hai.

Niyam aur Vyavahar (Rules & Behavior):
1. Bhasha (Language):
   - Customer jis bhasha mein baat kare (Hindi, Hinglish ya English), usi bhasha mein vinamra aur natural Indian tone mein jawab dein.
   - Example: Customer: "Meri washing machine se paani leak ho raha hai." -> Assistant: "Samajh gaya. Aapki washing machine front-load hai ya top-load? Iske aam karan drain pipe dheela hona ya door seal kharab hona ho sakta hai."

2. Services aur Verified Data:
   - FixMate Dhanbad mein yeh categories deta hai: ${CATEGORIES.join(', ')}.
   - Hamesha 'search_services', 'check_availability', 'get_estimated_price', 'find_nearby_technicians', 'get_booking_status', 'get_invoice_summary', 'get_faqs' tools use karke REAL database records hi batayein.
   - Kabhi bhi fake availability, fake price, ya fake booking ID na banayein.

3. Strict Confirmation Gate (VERY IMPORTANT):
   - 'create_booking', 'reschedule_booking', ya 'request_booking_cancellation' call karne se PEHLE hamesha customer ko saaf summary dikhayein (Service, Slot, Address, Charges) aur poochein: "Kya main ise confirm kar doon?"
   - Jab tak customer explicitly 'Haan' / 'Yes' / 'Confirm' na bole, booking create, modify ya cancel KABHI na karein.

4. Invoices, Complaints & Support:
   - Bill ya GST samajhne ke liye 'get_invoice_summary' use karein.
   - Shikayat ya refund ke liye 'file_complaint' use karke asli support ticket darj karein.
   - Human executive se baat karne ke liye 'contact_human_support' call karein.`;

function isOpenAIRealtimeConfigured() {
  const apiKey = process.env.OPENAI_API_KEY;
  return Boolean(apiKey && apiKey !== 'your_openai_api_key_here' && !/your_|replace/i.test(apiKey) && apiKey.startsWith('sk-'));
}

function isGeminiConfigured() {
  const geminiKey = process.env.GEMINI_API_KEY;
  return Boolean(geminiKey && geminiKey !== 'your_gemini_api_key_here' && !/your_|replace/i.test(geminiKey));
}

async function createRealtimeSession(language = 'auto') {
  if (!isOpenAIRealtimeConfigured()) {
    const err = new Error('BLOCKED: OPENAI_API_KEY backend .env mein configure nahi hai. Browser Web Speech fallback active rahega.');
    err.code = 'REALTIME_BLOCKED';
    throw err;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
  const voice = process.env.OPENAI_REALTIME_VOICE || 'alloy';
  const langInstruction = language === 'hi'
    ? '\nPreferred language for user replies: Hindi / Hinglish.'
    : (language === 'en' ? '\nPreferred language for user replies: Clear Indian English.' : '');

  const body = {
    model,
    voice,
    instructions: SYSTEM_PROMPT + langInstruction,
    tools: TOOL_DEFINITIONS,
    tool_choice: 'auto',
    input_audio_transcription: {
      model: 'whisper-1'
    }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI Realtime session failed (${res.status}): ${errText}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function handleChatMessage({ messages, user, db, activeBookingState = {}, language = 'auto' }) {
  // 1. Google Gemini Chat with Function Calling
  if (isGeminiConfigured()) {
    try {
      return await callGeminiChat({ messages, user, db, language });
    } catch (err) {
      console.warn('Gemini chat completion failed, falling back:', err.message);
    }
  }

  // 2. OpenAI Chat Completions with Function Calling
  if (isOpenAIRealtimeConfigured()) {
    try {
      return await callOpenAIChat({ messages, user, db, language });
    } catch (err) {
      console.warn('OpenAI chat completion failed, using built-in fallback:', err.message);
    }
  }

  // 3. Built-in Intelligent Hindi/Hinglish/English DB-backed Assistant
  return await runLocalAIFallback({ messages, user, db, activeBookingState, language });
}

let activeGeminiModel = null;

async function callGeminiChat({ messages, user, db, language = 'auto' }) {
  const apiKey = process.env.GEMINI_API_KEY;
  const preferredModel = activeGeminiModel || process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const modelCandidates = [
    preferredModel === 'gemini-1.5-flash' ? 'gemini-flash-latest' : preferredModel,
    'gemini-flash-latest',
    'gemini-3.8-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash'
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  const geminiTools = [{
    functionDeclarations: TOOL_DEFINITIONS.map(t => t.function)
  }];

  const contents = messages.slice(-10).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content || '') }]
  }));

  if (contents.length > 0 && contents[0].role === 'model') {
    contents.shift();
  }
  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
  }

  const langHint = language === 'hi'
    ? '\nRespond primarily in Hindi/Hinglish.'
    : (language === 'en' ? '\nRespond primarily in English.' : '');

  let iterations = 0;
  const maxIterations = 5;
  let executedCards = [];

  while (iterations < maxIterations) {
    iterations++;
    let res = null;

    for (const testModel of modelCandidates) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const attempt = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${testModel}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: SYSTEM_PROMPT + langHint }]
            },
            contents,
            tools: geminiTools,
            generationConfig: {
              temperature: 0.5,
              maxOutputTokens: 650
            }
          }),
          signal: controller.signal
        });

        if (attempt.ok) {
          res = attempt;
          activeGeminiModel = testModel;
          break;
        } else if (attempt.status !== 404) {
          res = attempt;
          break;
        }
      } catch (e) {
        if (testModel === modelCandidates[modelCandidates.length - 1]) {
          throw e;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!res || !res.ok) {
      const errText = res ? await res.text().catch(() => '') : 'Failed to reach Gemini API';
      throw new Error(`Gemini API error (${res ? res.status : 500}): ${errText}`);
    }

    const data = await res.json();
    const candidate = data.candidates && data.candidates[0];
    if (!candidate || !candidate.content) {
      throw new Error('Gemini returned empty candidate');
    }

    const parts = candidate.content.parts || [];
    const functionCallPart = parts.find(p => p.functionCall);

    if (functionCallPart && functionCallPart.functionCall) {
      const call = functionCallPart.functionCall;
      const name = call.name;
      const args = call.args || {};

      const toolResult = await executeTool(name, args, { db, user });
      executedCards.push({ tool: name, args, result: toolResult });

      contents.push(candidate.content);
      contents.push({
        role: 'function',
        parts: [{
          functionResponse: {
            name,
            response: toolResult
          }
        }]
      });
    } else {
      const textPart = parts.find(p => p.text);
      const reply = textPart ? textPart.text : 'Aapki service ke liye main taiyaar hoon. Kripya batayein kya madad karoon?';
      return {
        reply,
        cards: executedCards,
        provider: 'gemini'
      };
    }
  }

  return {
    reply: 'Aapki service details check kar li gayi hain. Kya main booking confirm kar doon?',
    cards: executedCards,
    provider: 'gemini'
  };
}

async function callOpenAIChat({ messages, user, db, language = 'auto' }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const langHint = language === 'hi'
    ? '\nRespond primarily in Hindi/Hinglish.'
    : (language === 'en' ? '\nRespond primarily in English.' : '');

  const conversation = [
    { role: 'system', content: SYSTEM_PROMPT + langHint },
    ...messages.slice(-10)
  ];

  let iterations = 0;
  const maxIterations = 5;
  let executedCards = [];

  while (iterations < maxIterations) {
    iterations++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    let res;
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: conversation,
          tools: TOOL_DEFINITIONS,
          tool_choice: 'auto',
          temperature: 0.6
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`OpenAI Chat API error: ${res.status} ${t}`);
    }

    const data = await res.json();
    const choice = data.choices && data.choices[0];
    if (!choice) throw new Error('OpenAI returned empty choice');

    const msg = choice.message;
    conversation.push(msg);

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const call of msg.tool_calls) {
        const name = call.function.name;
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch (e) {
          args = {};
        }

        const toolResult = await executeTool(name, args, { db, user });
        executedCards.push({ tool: name, args, result: toolResult });

        conversation.push({
          role: 'tool',
          tool_call_id: call.id,
          name,
          content: JSON.stringify(toolResult)
        });
      }
    } else {
      return {
        reply: msg.content || 'Aapki service ke liye main taiyaar hoon. Kripya batayein kya madad karoon?',
        cards: executedCards,
        provider: 'openai'
      };
    }
  }

  return {
    reply: 'Aapki service details check kar li gayi hain. Kya aap booking confirm karna chahte hain?',
    cards: executedCards,
    provider: 'openai'
  };
}

// -----------------------------------------------------------------------
// Intelligent Built-in DB-backed NLP Assistant (Hindi/Hinglish/English)
// Never invents data; enforces confirmation before booking/cancel/reschedule.
// -----------------------------------------------------------------------
async function runLocalAIFallback({ messages, user, db, activeBookingState = {}, language = 'auto' }) {
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const text = (lastUserMsg ? lastUserMsg.content : '').trim();
  const lower = text.toLowerCase();

  const isHindi = language === 'hi' || /[\u0900-\u097F]/.test(text);
  const isEnglishOnly = language === 'en';
  const isConfirmation = /\b(haan|ha|haa|han|yes|yep|confirm|confirmed|kar do|kar do na|kar dijiye|theek hai|sahi hai|ok|done|sure)\b/i.test(lower);
  const isDenial = /\b(nahi|nahin|na|no|nope|mat karo|don't|stop|rehne do)\b/i.test(lower);

  let cards = [];
  let reply = '';

  // Handle pending cancellation confirmation gate
  if (activeBookingState.pendingAction === 'cancel') {
    if (isDenial) {
      return {
        reply: isEnglishOnly
          ? 'Alright, I will keep your booking active. Let me know if you need anything else!'
          : 'Theek hai! Aapki booking active hi rahegi. Aur kya madad kar sakta hoon?',
        cards: [],
        pendingBooking: null,
        provider: 'fixmate-ai'
      };
    }
    if (isConfirmation && user) {
      const cancelResult = await executeTool('request_booking_cancellation', {
        booking_id: activeBookingState.bookingId,
        reason: 'Customer confirmed via AI Assistant',
        confirmed: true
      }, { db, user });
      cards.push({ tool: 'request_booking_cancellation', result: cancelResult });
      return {
        reply: cancelResult.message,
        cards,
        pendingBooking: null,
        provider: 'fixmate-ai'
      };
    }
  }

  // Handle pending reschedule confirmation gate
  if (activeBookingState.pendingAction === 'reschedule') {
    if (isDenial) {
      return {
        reply: 'Theek hai, slot change nahi kiya gaya hai.',
        cards: [],
        pendingBooking: null,
        provider: 'fixmate-ai'
      };
    }
    if (isConfirmation && user) {
      const reschedResult = await executeTool('reschedule_booking', {
        booking_id: activeBookingState.bookingId,
        new_slot: activeBookingState.slot || 'Aaj 6 se 8 PM',
        confirmed: true
      }, { db, user });
      cards.push({ tool: 'reschedule_booking', result: reschedResult });
      return {
        reply: reschedResult.message,
        cards,
        pendingBooking: null,
        provider: 'fixmate-ai'
      };
    }
  }

  // Extract target serviceId from state or conversation context
  let targetServiceId = activeBookingState.serviceId;
  if (!targetServiceId) {
    for (const m of [...messages].reverse()) {
      const symptom = diagnoseSymptom(m.content || '');
      if (symptom) {
        const sRes = await executeTool('search_services', { query: m.content, category: symptom.fallbackDbCategory }, { db, user });
        if (sRes.services && sRes.services.length > 0) {
          targetServiceId = sRes.services[0].id;
          break;
        }
      }
    }
  }

  // 1. Booking Confirmation check (Strict gate!)
  if (isConfirmation && !isDenial && (activeBookingState.pendingConfirmation || (targetServiceId && /\b(book|booking)\b/i.test(lower)))) {
    if (!user) {
      return {
        reply: isHindi
          ? 'Booking confirm karne ke liye pehle login zaroori hai. Kripya login screen par apna number verify karein.'
          : 'Please log in first to confirm your booking. Once signed in, I can confirm it right away!',
        needsLogin: true,
        cards: []
      };
    }

    const serviceId = targetServiceId || 1;
    const slot = activeBookingState.slot || 'Abhi (60 min mein)';
    const address = activeBookingState.address || user.address || 'Dhanbad, Jharkhand';

    const bookResult = await executeTool('create_booking', {
      service_id: serviceId,
      slot,
      address,
      pay_method: 'wallet',
      confirmed: true
    }, { db, user });

    cards.push({ tool: 'create_booking', result: bookResult });

    if (bookResult.success) {
      reply = isEnglishOnly
        ? `🎉 Confirmed! Booking #${bookResult.booking.id} (${bookResult.booking.service}) is scheduled for "${slot}". Share 4-digit Safety Code ${bookResult.booking.start_code} with our verified technician on arrival.`
        : `🎉 Badhai ho! Aapki booking confirm ho chuki hai (ID: #${bookResult.booking.id} - ${bookResult.booking.service}). Slot: "${slot}". Technician pahuche to 4-digit safety code ${bookResult.booking.start_code} dikhayein. 30 din ki free warranty shamil hai!`;
    } else {
      reply = bookResult.message || 'Booking mein dikkat aayi. Kripya thodi der baad dobara koshish karein.';
    }

    return { reply, cards, provider: 'fixmate-ai' };
  }

  // 2. Denial of pending booking
  if (isDenial && activeBookingState.pendingConfirmation) {
    return {
      reply: isHindi
        ? 'Ji bilkul, maine booking cancel kar di hai. Kya aap kisi aur service ya dusre time slot ki jankari lena chahenge?'
        : 'No problem! I did not place the booking. Let me know whenever you want to check another service or slot.',
      cards: [],
      pendingBooking: null,
      provider: 'fixmate-ai'
    };
  }

  // 3. Cancellation request (Ask explicit confirmation first!)
  if (/\b(cancel|radd)\b/i.test(lower)) {
    if (!user) {
      return { reply: 'Booking cancel karne ke liye pehle login karein.', needsLogin: true, cards: [] };
    }
    const statusResult = await executeTool('get_booking_status', {}, { db, user });
    cards.push({ tool: 'get_booking_status', result: statusResult });
    const cancellable = (statusResult.bookings || []).find(b => ['requested', 'assigned'].includes(b.status));
    if (cancellable) {
      return {
        reply: `Aapki booking #${cancellable.booking_id} (${cancellable.service}, Slot: ${cancellable.slot}) abhi cancel ho sakti hai (free cancellation). Kya main is booking ko confirm cancel kar doon? ("Haan" ya "Nahi" bolein)`,
        cards,
        pendingBooking: {
          pendingAction: 'cancel',
          bookingId: cancellable.booking_id,
          pendingConfirmation: true
        },
        provider: 'fixmate-ai'
      };
    }
    return {
      reply: 'Aapki koi cancellable active booking (Requested/Assigned status) nahi mili. Agar technician kaam shuru kar chuka hai, to human support se baat karein.',
      cards,
      provider: 'fixmate-ai'
    };
  }

  // 4. Reschedule request (Ask confirmation first!)
  if (/reschedule|time\s*badl|slot\s*change|slot\s*badl/i.test(lower)) {
    if (!user) {
      return { reply: 'Slot reschedule karne ke liye pehle login karein.', needsLogin: true, cards: [] };
    }
    const statusResult = await executeTool('get_booking_status', {}, { db, user });
    cards.push({ tool: 'get_booking_status', result: statusResult });
    const reschedulable = (statusResult.bookings || []).find(b => ['requested', 'assigned'].includes(b.status));
    if (reschedulable) {
      const requestedSlot = /kal|tomorrow/i.test(lower) ? 'Kal 10 se 12 AM' : (/shaam|evening|6|7|8/i.test(lower) ? 'Aaj 6 se 8 PM' : 'Aaj 6 se 8 PM');
      return {
        reply: `Aapki Booking #${reschedulable.booking_id} abhi "${reschedulable.slot}" par hai. Kya main iska time badal kar "${requestedSlot}" confirm kar doon? ("Haan" kahein ya apna pasandida slot batayein)`,
        cards,
        pendingBooking: {
          pendingAction: 'reschedule',
          bookingId: reschedulable.booking_id,
          slot: requestedSlot,
          pendingConfirmation: true
        },
        provider: 'fixmate-ai'
      };
    }
    return {
      reply: 'Aapki koi reschedule ho sakne wali active booking nahi mili.',
      cards,
      provider: 'fixmate-ai'
    };
  }

  // 5. Invoice / Bill / Payment explanation
  if (/invoice|bill|gst|receipt|kitna paisa|charge\s*kyun|payment\s*detail/i.test(lower)) {
    if (!user) {
      return { reply: 'Apna invoice aur payment details dekhne ke liye pehle login karein.', needsLogin: true, cards: [] };
    }
    const invResult = await executeTool('get_invoice_summary', {}, { db, user });
    cards.push({ tool: 'get_invoice_summary', result: invResult });
    if (invResult.success && invResult.invoice) {
      const iv = invResult.invoice;
      reply = `Aapka Invoice ${iv.invoice_number} (${iv.service_name}): Base Labor ${iv.base_labor}, Spare Parts ${iv.spare_parts}, Discount ${iv.discount}, Taxes ${iv.gst_breakdown}. Total Payable: ${iv.total_payable} (${iv.payment_status}). Warranty: ${iv.warranty}.`;
    } else {
      reply = invResult.message;
    }
    return { reply, cards, provider: 'fixmate-ai' };
  }

  // 6. Complaint registration
  if (/complaint|shikayat|refund\s*chahiye|galat\s*kaam|kharab\s*kaam/i.test(lower)) {
    if (!user) {
      return { reply: 'Complaint darj karne ke liye pehle login karein, ya helpline +91 7209612650 par call karein.', needsLogin: true, cards: [] };
    }
    const compResult = await executeTool('file_complaint', {
      category: /refund|paise|charge|bill/i.test(lower) ? 'Pricing Dispute' : 'Quality of Work',
      description: text.length >= 5 ? text : 'Customer filed support issue via AI Assistant',
      refund_requested: /refund/i.test(lower)
    }, { db, user });
    cards.push({ tool: 'file_complaint', result: compResult });
    return { reply: compResult.message, cards, provider: 'fixmate-ai' };
  }

  // 7. FAQs (Warranty / Visiting Fee / Safety / Cancellation Policy)
  if (/warranty|guarantee|visit\s*fee|visiting\s*charge|safety\s*code|policy|cancel\s*charge/i.test(lower)) {
    let topic = 'all';
    if (/warranty|guarantee/i.test(lower)) topic = 'warranty';
    else if (/visit/i.test(lower)) topic = 'visiting_fee';
    else if (/safety|code|otp/i.test(lower)) topic = 'safety';
    else if (/cancel/i.test(lower)) topic = 'cancellation';

    const faqResult = await executeTool('get_faqs', { topic }, { db, user });
    cards.push({ tool: 'get_faqs', result: faqResult });
    return {
      reply: faqResult.answer || `FixMate Policy: 30 din free warranty, ₹99 visiting charge (kaam manzoor karne par maaf), verified technicians aur 4-digit OTP safety code.`,
      cards,
      provider: 'fixmate-ai'
    };
  }

  // 8. Status check / My bookings
  if (/status|mera kaam|track|my booking/i.test(lower)) {
    if (!user) {
      return { reply: 'Apni bookings dekhne aur track karne ke liye pehle login karein.', needsLogin: true, cards: [] };
    }
    const statusResult = await executeTool('get_booking_status', {}, { db, user });
    cards.push({ tool: 'get_booking_status', result: statusResult });
    if (statusResult.bookings && statusResult.bookings.length > 0) {
      const b = statusResult.bookings[0];
      reply = `Aapki booking #${b.booking_id} (${b.service}) ka status hai: "${b.status_text}". Slot: ${b.slot}. Technician: ${b.assigned_worker}. Safety Code: ${b.start_code || '---'}.`;
    } else {
      reply = 'Abhi aapki koi active booking nahi mili. Kya aap koi nayi service book karna chahte hain?';
    }
    return { reply, cards, provider: 'fixmate-ai' };
  }

  // 9. Human support escalation
  if (/human|support|help\s*desk|customer\s*care|agent|baat\s*kar/i.test(lower)) {
    const supportResult = await executeTool('contact_human_support', {
      reason: text,
      customer_phone: user ? user.phone : 'Unregistered'
    }, { db, user });
    cards.push({ tool: 'contact_human_support', result: supportResult });
    reply = `FixMate Customer Care desk se connect kar diya gaya hai. Helpline: ${supportResult.support_phone} (Timing: ${supportResult.hours}). Reference: #${supportResult.ticket_id}. ${supportResult.note}`;
    return { reply, cards, provider: 'fixmate-ai' };
  }

  // 10. Technician check
  if (/technician|worker|karigar|mistri/i.test(lower)) {
    const symptom = diagnoseSymptom(lower);
    const cat = symptom ? symptom.fallbackDbCategory : 'Electrician';
    const techResult = await executeTool('find_nearby_technicians', { category: cat }, { db, user });
    cards.push({ tool: 'find_nearby_technicians', result: techResult });
    if (techResult.count > 0) {
      reply = `Dhanbad mein ${cat} ke ${techResult.count} police & ID-verified technicians uplabdh hain. Kya aap appointment book karna chahenge?`;
    } else {
      reply = `Abhi ${cat} category mein koi technician online nahi dikh raha hai. Aap scheduled slot choose kar sakte hain ya support team se baat kar sakte hain.`;
    }
    return { reply, cards, provider: 'fixmate-ai' };
  }

  // 11. Smart Symptom Diagnosis & Service Search
  const symptom = diagnoseSymptom(text);
  const searchCat = symptom ? symptom.fallbackDbCategory : undefined;
  const searchResult = await executeTool('search_services', {
    query: text,
    category: searchCat
  }, { db, user });

  cards.push({ tool: 'search_services', result: searchResult });

  if (searchResult.count > 0) {
    const top = searchResult.services[0];
    const availResult = await executeTool('check_availability', { service_id: top.id }, { db, user });
    cards.push({ tool: 'check_availability', result: availResult });

    const priceResult = await executeTool('get_estimated_price', {
      service_id: top.id,
      problem_description: text
    }, { db, user });
    cards.push({ tool: 'get_estimated_price', result: priceResult });

    const alreadyAskedFollowUp = messages.some(m =>
      m.role === 'assistant' && /front-load|split ac|window ac|continuous|tapak/i.test(m.content || '')
    );

    if (symptom && !alreadyAskedFollowUp && !/\b(book|booking|rate|price|charge|kitna)\b/i.test(lower)) {
      const followUp = isEnglishOnly ? symptom.followUpEn : symptom.followUpHi;
      const causesNote = symptom.causes.length
        ? `\n\nPossible reasons: ${symptom.causes.slice(0, 2).join('; ')}.`
        : '';
      const techNote = availResult.available
        ? `Recommended: "${top.name}" (${top.base_price} base labor, ₹99 visit fee inspection approve hone par maaf).`
        : `Note: Abhi is slot mein live technician offline hai, aap later slot reserve kar sakte hain.`;
      reply = `${followUp}${causesNote}\n${techNote}`;
    } else {
      reply = isEnglishOnly
        ? `Found "${top.name}" (⭐ ${top.rating}). Estimated base fee: ${top.base_price} (plus parts if approved; ₹99 visit charge waived on approval). ${availResult.online_technicians} verified technician(s) available in Dhanbad. Should I confirm this booking for "Abhi (60 min mein)"?`
        : `Ji! Hamare paas "${top.name}" uplabdh hai (⭐ ${top.rating}). Base fee: ${top.base_price} (₹99 visiting charge kaam manzoor hone par maaf ho jata hai, 30 din free warranty shamil). Dhanbad mein ${availResult.online_technicians} verified technician(s) available hain. Kya main ye booking confirm kar doon? ("Haan book kar do" kahein)`;
    }

    return {
      reply,
      cards,
      provider: 'fixmate-ai',
      pendingBooking: {
        serviceId: top.id,
        serviceName: top.name,
        price: top.price_numeric,
        slot: availResult.available_slots[0] || 'Abhi (60 min mein)'
      }
    };
  }

  // Default welcome
  reply = isEnglishOnly
    ? 'Hello! I am FixMate AI Assistant. Tell me your home repair problem (e.g., AC not cooling, washing machine leak, tap leak, fan repair) or ask about your booking/invoice.'
    : 'Namaste! Main FixMate AI Assistant hoon. Apni home service problem batayein (jaise "AC thandi hawa nahi de raha", "washing machine se paani leak", "tap leak", "fan repair") ya booking/bill check karein!';

  return { reply, cards, provider: 'fixmate-ai' };
}

// -----------------------------------------------------------------------
// Smart Service Finder (Section 4): Maps natural language issue -> real DB service
// -----------------------------------------------------------------------
async function smartFindService({ query, db }) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) {
    return { success: false, error: 'Kripya apni samasya likhein ya bolein' };
  }

  const symptom = diagnoseSymptom(cleanQuery);
  const searchRes = await executeTool('search_services', {
    query: cleanQuery,
    category: symptom ? symptom.fallbackDbCategory : undefined
  }, { db, user: null });

  let recommended = searchRes.services || [];
  if (recommended.length === 0) {
    // Fallback to top rated general services from real DB
    const topRes = await db.query('SELECT id, cat, name, price, rating FROM services ORDER BY rating DESC LIMIT 3');
    recommended = topRes.rows.map(s => ({
      id: s.id,
      category: s.cat,
      name: s.name,
      base_price: `₹${s.price}`,
      price_numeric: s.price,
      rating: Number(s.rating),
      starting_note: `Visit/Base fee starts at ₹${s.price}`
    }));
  }

  const top = recommended[0] || null;
  const avail = top ? await executeTool('check_availability', { service_id: top.id }, { db, user: null }) : null;

  return {
    success: true,
    query: cleanQuery,
    detected_category: symptom ? symptom.category : (top ? top.category : 'General Home Maintenance'),
    possible_causes: symptom ? symptom.causes : [],
    follow_up_question: symptom ? symptom.followUpHi : null,
    recommended_services: recommended,
    availability: avail
  };
}

module.exports = {
  SYSTEM_PROMPT,
  isOpenAIRealtimeConfigured,
  isGeminiConfigured,
  createRealtimeSession,
  handleChatMessage,
  runLocalAIFallback,
  smartFindService
};
