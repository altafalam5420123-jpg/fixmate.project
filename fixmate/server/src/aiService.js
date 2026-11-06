const { TOOL_DEFINITIONS, executeTool } = require('./aiTools');

const SYSTEM_PROMPT = `Aap FixMate home services platform (Dhanbad, Jharkhand) ke official AI Voice & Chat Assistant hain.
Aapka kaam customer ki samasyaon ko samajhna, sahi service batana, transparent charges aur 30-din ki warranty explain karna, aur unke manzoori ke baad booking karna hai.

Niyam aur Vyavahar (Rules & Behavior):
1. Bhasha (Language):
   - Customer jis bhasha mein baat kare (Hindi, Hinglish ya English), usi bhasha mein aadar ke saath jawab dein.
   - Natural Indian tone rakhein, jaise ek vinamra aur knowledgeable customer support executive baat karta hai.
   - Example Hindi: "Bilkul! Main aapki help karta hoon. Washing machine mein kya dikkat aa rahi hai?"
   - Example Hinglish: "Sure, main check kar deta hoon. Kya machine bilkul on nahi ho rahi ya spin nahi kar rahi?"

2. Services aur Availability:
   - FixMate Dhanbad mein in categories ki services deta hai: Electrician, Plumber, AC Repair, TV Repair, Mechanic, Home Tutor.
   - Sabhi technicians 100% police-verified hain.
   - Har service par 30 din ki free warranty milti hai.
   - Technician aane par 4-digit security code se kaam shuru hota hai.

3. Tools Calling:
   - Services dhundne ke liye 'search_services' use karein.
   - Pricing ya charge poochne par 'get_estimated_price' use karein.
   - Technician ya slot poochne par 'check_availability' aur 'find_nearby_technicians' use karein.
   - Status janne ke liye 'get_booking_status' use karein.
   - Cancellation ke liye 'request_booking_cancellation' use karein.
   - Human support ya complicated dispute ke liye 'contact_human_support' call karein.

4. Booking Confirmation Rule (VERY IMPORTANT):
   - Booking create karne se pehle hamesha customer ko poora summary batayein:
     (Service, Slot, Address, Estimated charges)
   - Aur saaf-saaf poochein: "Kya main ye booking confirm kar doon?" (ya English: "Would you like me to confirm this booking?")
   - Customer ke explicit 'Haan' / 'Confirm' / 'Yes' kahne se pehle 'create_booking' tool KABHI call na karein.

5. Security:
   - Kisi customer se password ya bank OTP na maangein.
   - Real-world database records hi use karein.`;

async function createRealtimeSession() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your_openai_api_key_here') {
    throw new Error('OPENAI_API_KEY backend .env mein configure nahi hai');
  }

  const model = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
  const voice = process.env.OPENAI_REALTIME_VOICE || 'alloy';

  const body = {
    model,
    voice,
    instructions: SYSTEM_PROMPT,
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

    const data = await res.json();
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleChatMessage({ messages, user, db, activeBookingState }) {
  // 1. Check Google Gemini (Super smart, fast, excellent Hindi/Hinglish & generous free tier)
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey && geminiKey !== 'your_gemini_api_key_here') {
    try {
      return await callGeminiChat({ messages, user, db });
    } catch (err) {
      console.warn('Gemini chat completion failed, falling back:', err.message);
    }
  }

  // 2. Check OpenAI
  const apiKey = process.env.OPENAI_API_KEY;
  const hasOpenAI = apiKey && apiKey !== 'your_openai_api_key_here' && apiKey.startsWith('sk-');

  if (hasOpenAI) {
    try {
      return await callOpenAIChat({ messages, user, db });
    } catch (err) {
      console.warn('OpenAI chat completion failed, using intelligent built-in fallback:', err.message);
    }
  }

  // 3. Built-in intelligent assistant fallback
  return await runLocalAIFallback({ messages, user, db, activeBookingState });
}

let activeGeminiModel = null;

async function callGeminiChat({ messages, user, db }) {
  const apiKey = process.env.GEMINI_API_KEY;
  const preferredModel = activeGeminiModel || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const modelCandidates = [
    preferredModel,
    'gemini-1.5-flash',
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-1.5-pro'
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

  let iterations = 0;
  const maxIterations = 5;
  let executedCards = [];

  while (iterations < maxIterations) {
    iterations++;
    let res = null;
    let selectedModel = preferredModel;

    for (const testModel of modelCandidates) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const attempt = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${testModel}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: SYSTEM_PROMPT }]
            },
            contents,
            tools: geminiTools,
            generationConfig: {
              temperature: 0.6,
              maxOutputTokens: 600
            }
          }),
          signal: controller.signal
        });

        if (attempt.ok) {
          res = attempt;
          selectedModel = testModel;
          activeGeminiModel = testModel;
          break;
        } else if (attempt.status !== 404) {
          // If error is not 404 (model not found), don't keep cycling models
          res = attempt;
          selectedModel = testModel;
          break;
        }
      } catch (e) {
        // network or timeout error
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

async function callOpenAIChat({ messages, user, db }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const conversation = [
    { role: 'system', content: SYSTEM_PROMPT },
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
          temperature: 0.7
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
// Intelligent Built-in NLP Assistant (Hindi/Hinglish/English)
// Works 100% out of the box even before OpenAI key is entered!
// -----------------------------------------------------------------------
async function runLocalAIFallback({ messages, user, db, activeBookingState = {} }) {
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const text = (lastUserMsg ? lastUserMsg.content : '').trim();
  const lower = text.toLowerCase();

  const isHindi = /[\u0900-\u097F]/.test(text);
  const isConfirmation = /\b(haan|ha|haa|yes|yep|confirm|confirmed|kar do|kar do na|kar dijiye|theek hai|sahi hai|ok|done|sure|book|booking|book karo|book kardo|book kar do)\b/i.test(lower);
  const isDenial = /\b(nahi|na|no|nope|cancel|mat karo|don't|stop)\b/i.test(lower);

  let cards = [];
  let reply = '';

  // Extract serviceId from active state or previous conversation
  let targetServiceId = activeBookingState.serviceId;
  if (!targetServiceId) {
    for (const m of [...messages].reverse()) {
      const c = (m.content || '').toLowerCase();
      if (/ac|cool|gas/i.test(c)) { targetServiceId = 7; break; }
      if (/wash|machin|fan|switch|wiring|inverter/i.test(c)) { targetServiceId = 1; break; }
      if (/plumb|tap|leak|water/i.test(c)) { targetServiceId = 4; break; }
      if (/tv|screen/i.test(c)) { targetServiceId = 9; break; }
      if (/bike|car/i.test(c)) { targetServiceId = 11; break; }
      if (/tutor|teach|class/i.test(c)) { targetServiceId = 13; break; }
    }
  }

  // 1. Booking Confirmation check
  if (isConfirmation && !isDenial && (activeBookingState.pendingConfirmation || targetServiceId || /book|booking/i.test(lower))) {
    if (!user) {
      return {
        reply: isHindi
          ? 'Booking confirm karne ke liye pehle login zaroori hai. Kripya login screen par apna number verify karein.'
          : 'Booking confirm karne ke liye pehle login karein. Login karte hi 1 click mein aapki booking ho jayegi.',
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
      reply = isHindi
        ? `🎉 Badhai ho! Aapki booking confirm ho chuki hai (Booking ID: #${bookResult.booking.id}). Hamara verified technician ${slot} pahuchega. Technician aane par unhe safety code ${bookResult.booking.start_code} batayein.`
        : `🎉 Great! Aapki booking confirm ho gayi hai (ID: #${bookResult.booking.id})! Slot: "${slot}". Technician pahuche to unhe 4-digit safety code ${bookResult.booking.start_code} dikhayein. 30 din ki free warranty included hai!`;
    } else {
      reply = bookResult.message || 'Booking mein dikkat aayi. Kripya thodi der baad dobara koshish karein.';
    }

    return { reply, cards, provider: 'fixmate-ai' };
  }

  // 2. Cancellation of confirmation
  if (isDenial && activeBookingState.pendingConfirmation) {
    return {
      reply: isHindi
        ? 'Ji bilkul, maine booking cancel kar di hai. Kya aap kisi aur service ya dusre time slot ki jankari lena chahenge?'
        : 'Koi baat nahi! Booking request cancel kar di gayi hai. Aap jab chahein naya slot ya service book kar sakte hain.',
      cards: [],
      provider: 'fixmate-ai'
    };
  }

  // 3. Cancellation request
  if (lower.includes('cancel') || lower.includes('radd') || lower.includes('band')) {
    if (!user) {
      return { reply: 'Booking cancel karne ke liye pehle login karein.', needsLogin: true, cards: [] };
    }
    const statusResult = await executeTool('get_booking_status', {}, { db, user });
    if (statusResult.bookings && statusResult.bookings.length > 0) {
      const b = statusResult.bookings[0];
      const cancelResult = await executeTool('request_booking_cancellation', {
        booking_id: b.booking_id,
        reason: 'Customer requested via AI Assistant'
      }, { db, user });
      cards.push({ tool: 'request_booking_cancellation', result: cancelResult });
      reply = cancelResult.message;
    } else {
      reply = 'Aapki koi active booking nahi mili jise cancel kiya ja sake.';
    }
    return { reply, cards, provider: 'fixmate-ai' };
  }

  // 4. Status check / My bookings
  if (lower.includes('status') || lower.includes('booking') || lower.includes('mera kaam') || lower.includes('track')) {
    if (!user) {
      return {
        reply: 'Apni bookings dekhne aur track karne ke liye pehle login karein.',
        needsLogin: true,
        cards: []
      };
    }
    const statusResult = await executeTool('get_booking_status', {}, { db, user });
    cards.push({ tool: 'get_booking_status', result: statusResult });
    if (statusResult.bookings && statusResult.bookings.length > 0) {
      const b = statusResult.bookings[0];
      reply = `Aapki active booking (#${b.booking_id} - ${b.service}) ka status hai: "${b.status_text}". Slot: ${b.slot}. Technician: ${b.assigned_worker}. Safety Code: ${b.start_code || '---'}.`;
    } else {
      reply = 'Abhi aapki koi active booking nahi hai. Kya aap koi nayi service book karna chahte hain? Jaise Electrician, Plumber, AC Repair ya Home Tutor?';
    }
    return { reply, cards, provider: 'fixmate-ai' };
  }

  // 5. Human support / Escalation
  if (lower.includes('human') || lower.includes('support') || lower.includes('help desk') || lower.includes('complaint') || lower.includes('shikayat') || lower.includes('customer care')) {
    const supportResult = await executeTool('contact_human_support', {
      reason: text,
      customer_phone: user ? user.phone : 'Unregistered'
    }, { db, user });
    cards.push({ tool: 'contact_human_support', result: supportResult });
    reply = `FixMate Customer Care desk se connect kar diya gaya hai. Helpline: ${supportResult.support_phone} (Timing: ${supportResult.hours}). Ticket: #${supportResult.ticket_id}. ${supportResult.note}`;
    return { reply, cards, provider: 'fixmate-ai' };
  }

  // 6. Technician check
  if (lower.includes('technician') || lower.includes('worker') || lower.includes('karigar') || lower.includes('mistri')) {
    let cat = 'Electrician';
    if (lower.includes('plumb') || lower.includes('pipe') || lower.includes('nal')) cat = 'Plumber';
    if (lower.includes('ac') || lower.includes('cool')) cat = 'AC Repair';
    if (lower.includes('tv')) cat = 'TV Repair';
    if (lower.includes('bike') || lower.includes('car') || lower.includes('mechanic')) cat = 'Mechanic';
    if (lower.includes('tutor') || lower.includes('padhai')) cat = 'Home Tutor';

    const techResult = await executeTool('find_nearby_technicians', { category: cat }, { db, user });
    cards.push({ tool: 'find_nearby_technicians', result: techResult });
    reply = `Dhanbad mein ${cat} ke verified technicians online aur available hain. Sabhi ID & Police-verified hain aur 4.8+ rated hain. Kya aap appointment book karna chahte hain?`;
    return { reply, cards, provider: 'fixmate-ai' };
  }

  // 7. General search & problem matching
  let matchedCategory = null;
  if (/electric|switch|fan|wiring|inverter|light|bijli/i.test(lower)) matchedCategory = 'Electrician';
  else if (/plumb|tap|leak|water|tank|nal|pipe/i.test(lower)) matchedCategory = 'Plumber';
  else if (/ac|gas|cool|split|filter|ac repair/i.test(lower)) matchedCategory = 'AC Repair';
  else if (/tv|screen|sound|mount|television/i.test(lower)) matchedCategory = 'TV Repair';
  else if (/bike|car|puncture|engine|service|mechanic/i.test(lower)) matchedCategory = 'Mechanic';
  else if (/tutor|teacher|maths|science|class|padhai/i.test(lower)) matchedCategory = 'Home Tutor';
  else if (/washing machine|wash|spin|drain|dryer|fridge|refrigerator|microwave/i.test(lower)) matchedCategory = 'Electrician';

  // Inherit category from conversation context if not explicitly mentioned in this turn
  if (!matchedCategory && targetServiceId) {
    const prevService = await db.queryOne('SELECT cat FROM services WHERE id = $1', [targetServiceId]);
    if (prevService) matchedCategory = prevService.cat;
  }

  const searchResult = await executeTool('search_services', {
    query: text,
    category: matchedCategory || undefined
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

    const alreadyAskedProblem = messages.some(m => m.role === 'assistant' && /kya problem aa rahi hai/i.test(m.content || ''));
    const userDescribedProblem = /spin|chal|on|chalu|leak|kharab|awaz|vibration|motor|power|wire|current|garam|thanda|book|booking/i.test(lower);

    if (/washing machine|wash machine/i.test(lower) && !alreadyAskedProblem && !userDescribedProblem) {
      reply = isHindi
        ? `Bilkul! Main aapki help karta hoon. Washing machine mein kya problem aa rahi hai? (Jaise spin nahi chal raha, paani leak ho raha hai, ya machine on nahi ho rahi?) Hamara verified expert Dhanbad mein 60 minute mein inspection ke liye aa sakta hai.`
        : `Bilkul! Main aapki help karta hoon. Washing machine mein kya problem aa rahi hai? Jaise machine on nahi ho rahi, vibration hai, ya spin nahi ho raha? Visit charge ${top.base_price} se start hai jo final quote mein adjust ho jayega.`;
    } else {
      reply = isHindi
        ? `Ji! Hamare paas "${top.name}" uplabdh hai (Rating: ⭐ ${top.rating}). Visit charge ${top.base_price} se shuru hota hai jo kaam hone par final quote mein jud jata hai. 30 din ki free warranty bhi shamil hai. Dhanbad mein technician 60 minute mein pahuch sakta hai. Kya main aapke liye ye booking confirm kar doon? ("Haan book kar do" kahein)`
        : `Maine aapke liye "${top.name}" find kiya hai (⭐ ${top.rating}). Base visit charge: ${top.base_price}. Dhanbad mein technician 60 minute mein aa sakta hai. 30-day warranty included hai. Kya main ye booking confirm kar doon? ("Haan book kar do" kahein)`;
    }

    return {
      reply,
      cards,
      provider: 'fixmate-ai',
      pendingBooking: {
        serviceId: top.id,
        serviceName: top.name,
        price: top.price_numeric,
        slot: 'Abhi (60 min mein)'
      }
    };
  }

  // Default welcome
  reply = isHindi
    ? 'Namaste! Main FixMate AI Assistant hoon. Main Dhanbad mein Electrician, Plumber, AC Repair, TV Repair, Mechanic aur Home Tutor services book karne mein aapki sahayata kar sakta hoon. Aapko kis service ki zaroorat hai?'
    : 'Hello! I am your FixMate AI Assistant. You can speak or type in Hindi, Hinglish, or English. How can I help you today? You can ask about AC repair, Electrician, Plumber, Technician status, or booking charges!';

  return { reply, cards, provider: 'fixmate-ai' };
}

module.exports = {
  SYSTEM_PROMPT,
  createRealtimeSession,
  handleChatMessage,
  runLocalAIFallback
};
