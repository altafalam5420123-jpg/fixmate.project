// FixMate Phase 6 — Backend Multilingual Dictionary & Message Localizer
// Supports: English ('en' default), Hindi ('hi'), and conversational Hinglish ('hinglish').
// Never translates DB enums, status keys, role identifiers, or API field names.

const VALID_LANGS = ['en', 'hi', 'hinglish'];

function normalizeLang(val) {
  const s = String(val || '').trim().toLowerCase();
  if (s === 'hi' || s.startsWith('hi-')) return 'hi';
  if (s === 'hinglish' || s === 'hi-en') return 'hinglish';
  if (s === 'en' || s.startsWith('en-')) return 'en';
  return null;
}

function resolveLangFromRequest(req, user = null) {
  const headerLang = normalizeLang(req?.headers?.['x-lang']) || normalizeLang(req?.query?.lang);
  if (headerLang) return headerLang;
  const userLang = normalizeLang(user?.language || req?.user?.language);
  if (userLang) return userLang;
  return null;
}

const STATUS_LABELS = {
  en: {
    requested: 'Pending',
    assigned: 'Accepted',
    on_the_way: 'On The Way',
    inspecting: 'Inspecting',
    quoted: 'Quote Ready',
    in_progress: 'In Progress',
    completed: 'Completed',
    closed: 'Closed (Visit Fee Only)',
    cancelled: 'Cancelled',
    rejected: 'Rejected'
  },
  hi: {
    requested: 'लंबित (पेंडिंग)',
    assigned: 'स्वीकृत (टेक्नीशियन असाइन)',
    on_the_way: 'टेक्नीशियन रास्ते में हैं',
    inspecting: 'जांच चल रही है',
    quoted: 'कोटेशन तैयार है',
    in_progress: 'काम चल रहा है',
    completed: 'काम पूरा हुआ',
    closed: 'बंद (केवल विज़िट शुल्क)',
    cancelled: 'रद्द (कैंसिल)',
    rejected: 'अस्वीकृत'
  },
  hinglish: {
    requested: 'Pending (Technician Confirm Ho Raha Hai)',
    assigned: 'Accepted (Technician Assign Hua)',
    on_the_way: 'Technician Raste Mein Hai',
    inspecting: 'Inspection Chal Raha Hai',
    quoted: 'Quote Taiyaar Hai',
    in_progress: 'Kaam Chal Raha Hai',
    completed: 'Kaam Poora Hua',
    closed: 'Closed (Sirf Visit Charge)',
    cancelled: 'Cancelled',
    rejected: 'Rejected'
  }
};

const NOTIF_TEMPLATES = {
  en: {
    assigned: ['Provider Assigned', 'An approved FixMate provider has accepted your booking.'],
    on_the_way: ['Provider On The Way', 'Your service provider is on the way. Track live arrival on the map!'],
    inspecting: ['Provider Arrived', 'Your provider has arrived and started inspection.'],
    quoted: ['Inspection Quote Ready', 'Your provider sent an estimate. Please review and approve to begin work.'],
    in_progress: ['Work In Progress', 'Repair work has started as per your approved quote.'],
    completed: ['Service Completed', 'Your service is complete! View your tax invoice and 30-day warranty.'],
    cancelled: ['Booking Cancelled', 'This booking has been cancelled.']
  },
  hi: {
    assigned: ['टेक्नीशियन असाइन हो गए', 'एक सत्यापित फिक्समेट पार्टनर ने आपकी बुकिंग स्वीकार कर ली है।'],
    on_the_way: ['टेक्नीशियन रास्ते में हैं', 'आपका सर्विस पार्टनर घर आ रहा है। मैप पर लाइव लोकेशन देखें!'],
    inspecting: ['टेक्नीशियन पहुंच गए', 'टेक्नीशियन पहुंच चुके हैं और जांच शुरू हो गई है।'],
    quoted: ['कोटेशन तैयार है', 'टेक्नीशियन ने मरम्मत का अनुमान भेजा है। काम शुरू करने के लिए कृपया स्वीकार करें।'],
    in_progress: ['काम शुरू हो गया है', 'आपकी मंजूरी के अनुसार मरम्मत का काम शुरू हो गया है।'],
    completed: ['सेवा पूरी हुई', 'काम पूरा हो गया है! अपना डिजिटल बिल और 30-दिन की वारंटी देखें।'],
    cancelled: ['बुकिंग रद्द की गई', 'आपकी बुकिंग रद्द कर दी गई है।']
  },
  hinglish: {
    assigned: ['Technician Assign Ho Gaye', 'Approved FixMate technician ne aapka job accept kar liya hai.'],
    on_the_way: ['Technician Raste Mein Hai', 'Aapke technician nikal chuke hain. Live map par track karein!'],
    inspecting: ['Technician Pahunch Gaye', 'Technician ghar pahunch chuke hain aur inspection shuru ho gayi hai.'],
    quoted: ['Quote Taiyaar Hai', 'Technician ne estimate bhej diya hai. Kaam shuru karwane ke liye approve karein.'],
    in_progress: ['Kaam Shuru Ho Gaya', 'Aapke quote approve karne ke baad kaam shuru ho gaya hai.'],
    completed: ['Service Complete Hui', 'Kaam poora ho gaya! Apna digital invoice aur 30-day warranty dekhein.'],
    cancelled: ['Booking Cancel Hui', 'Aapki booking cancel kar di gayi hai.']
  }
};

// Map existing internal backend strings -> clean EN / HI / Hinglish equivalents
const MESSAGE_MAP = {
  'Login karo': {
    en: 'Please log in to continue.',
    hi: 'आगे बढ़ने के लिए कृपया लॉगिन करें।',
    hinglish: 'Aage badhne ke liye pehle login karein.'
  },
  'Ye action is role ke liye nahi hai': {
    en: 'This action is not permitted for your account role.',
    hi: 'यह अनुमति आपके अकाउंट रोल के लिए नहीं है।',
    hinglish: 'Ye action aapke role ke liye allowed nahi hai.'
  },
  'Aapka account suspend kar diya gaya hai. Support se sampark karein.': {
    en: 'Your account has been suspended. Please contact FixMate support.',
    hi: 'आपका खाता निलंबित (सस्पेंड) कर दिया गया है। कृपया सहायता टीम से संपर्क करें।',
    hinglish: 'Aapka account suspend kar diya gaya hai. Support team se baat karein.'
  },
  'Sahi 10 digit mobile number daalo': {
    en: 'Please enter a valid 10-digit mobile number.',
    hi: 'कृपया सही 10 अंकों का मोबाइल नंबर दर्ज करें।',
    hinglish: 'Kripya sahi 10-digit mobile number daalein.'
  },
  'OTP bhej diya': {
    en: 'OTP sent successfully.',
    hi: 'ओटीपी सफलतापूर्वक भेज दिया गया है।',
    hinglish: 'OTP bhej diya gaya hai.'
  },
  'Mobile number ya OTP sahi nahi hai': {
    en: 'Please enter a valid mobile number and 6-digit OTP.',
    hi: 'कृपया सही मोबाइल नंबर और 6 अंकों का ओटीपी दर्ज करें।',
    hinglish: 'Mobile number aur 6-digit OTP sahi check karke daalein.'
  },
  'Pehle OTP mangao': {
    en: 'Please request an OTP first.',
    hi: 'कृपया पहले ओटीपी मंगाएं।',
    hinglish: 'Pehle OTP request karein.'
  },
  'OTP expire ho gaya': {
    en: 'Your OTP has expired. Please request a new one.',
    hi: 'ओटीपी की समय सीमा समाप्त हो गई है। कृपया नया ओटीपी मंगाएं।',
    hinglish: 'OTP expire ho gaya hai, kripya naya OTP mangwayein.'
  },
  '3 galat try ho gaye. Naya OTP mangao': {
    en: 'Too many wrong attempts. Please request a new OTP.',
    hi: '3 गलत प्रयास हो गए हैं। कृपया नया ओटीपी मंगाएं।',
    hinglish: '3 baar galat OTP dala gaya. Ab naya OTP mangwayein.'
  },
  'Galat OTP': {
    en: 'Incorrect OTP. Please try again.',
    hi: 'गलत ओटीपी। कृपया दोबारा प्रयास करें।',
    hinglish: 'Galat OTP hai, ek baar phir check karein.'
  },
  'Naam aur role chuno': {
    en: 'Please enter your name and choose an account type.',
    hi: 'कृपया अपना नाम और अकाउंट का प्रकार चुनें।',
    hinglish: 'Apna naam aur account type chuno.'
  },
  'Admin privileges public signup se assign nahi ki ja sakti': {
    en: 'Admin privileges cannot be assigned through public registration.',
    hi: 'सार्वजनिक साइनअप से एडमिन अधिकार नहीं दिए जा सकते।',
    hinglish: 'Admin account public signup se nahi banaya ja sakta.'
  },
  'Slot aur address zaruri hain': {
    en: 'Time slot and service address are required.',
    hi: 'समय स्लॉट और पता दोनों आवश्यक हैं।',
    hinglish: 'Time slot aur service address dono zaruri hain.'
  },
  'Payment wallet, cash ya online hona chahiye': {
    en: 'Payment method must be wallet, cash, or online.',
    hi: 'भुगतान का तरीका वॉलेट, कैश या ऑनलाइन होना चाहिए।',
    hinglish: 'Payment wallet, cash ya online hona chahiye.'
  },
  'Booking nahi mili': {
    en: 'Booking not found.',
    hi: 'बुकिंग नहीं मिली।',
    hinglish: 'Ye booking nahi mili.'
  },
  'Ye booking tumhari nahi hai': {
    en: 'You are not authorized to access this booking.',
    hi: 'आप इस बुकिंग को देखने के लिए अधिकृत नहीं हैं।',
    hinglish: 'Ye booking aapke account ki nahi hai.'
  },
  'Aapka provider verification abhi pending/inactive hai. Approval ke baad hi jobs accept kar sakte hain.': {
    en: 'Your provider account is not approved yet. You can accept jobs only after admin approval.',
    hi: 'आपका प्रोवाइडर वेरिफिकेशन अभी लंबित/निष्क्रिय है। एडमिन अप्रूवल के बाद ही आप काम स्वीकार कर सकते हैं।',
    hinglish: 'Aapka provider verification abhi pending/inactive hai. Approval ke baad hi bookings accept kar paayenge.'
  },
  'Pehle online aao': {
    en: 'Please go online before accepting booking requests.',
    hi: 'बुकिंग स्वीकार करने से पहले कृपया ऑनलाइन आएं।',
    hinglish: 'Jobs accept karne ke liye pehle Online switch ON karein.'
  },
  'Ye kaam tumhare skill ka nahi hai': {
    en: 'This booking does not match your registered service categories.',
    hi: 'यह काम आपकी चुनी हुई सर्विस श्रेणी में नहीं है।',
    hinglish: 'Ye booking aapki selected categories se match nahi karti.'
  },
  'Start code galat hai': {
    en: 'Incorrect 4-digit start code.',
    hi: '4-अंकों का स्टार्ट कोड गलत है।',
    hinglish: '4-digit start code galat hai.'
  },
  'Wallet mein paise kam hain': {
    en: 'Insufficient wallet balance.',
    hi: 'वॉलेट में पर्याप्त राशि नहीं है।',
    hinglish: 'Wallet mein balance kam hai.'
  },
  'Payment ho gaya': {
    en: 'Payment completed successfully.',
    hi: 'भुगतान सफलतापूर्वक हो गया।',
    hinglish: 'Payment ho gaya!'
  },
  'Technician profile update ho gaya': {
    en: 'Provider profile updated successfully.',
    hi: 'प्रोवाइडर प्रोफ़ाइल सफलतापूर्वक अपडेट हो गई।',
    hinglish: 'Provider profile update ho gaya!'
  },
  'Weekly availability save ho gayi': {
    en: 'Weekly availability saved successfully.',
    hi: 'साप्ताहिक उपलब्धता सफलतापूर्वक सेव हो गई।',
    hinglish: 'Weekly availability save ho gayi!'
  },
  'Verification document review ke liye submit ho gaya': {
    en: 'Verification document submitted for admin review.',
    hi: 'वेरिफिकेशन दस्तावेज़ समीक्षा के लिए सबमिट हो गया है।',
    hinglish: 'Verification document review ke liye submit ho gaya!'
  },
  'Profile updated successfully': {
    en: 'Profile updated successfully.',
    hi: 'प्रोफ़ाइल सफलतापूर्वक अपडेट हो गई।',
    hinglish: 'Profile update ho gayi!'
  },
  'Password updated successfully': {
    en: 'Password updated successfully.',
    hi: 'पासवर्ड सफलतापूर्वक बदल दिया गया।',
    hinglish: 'Password update ho gaya!'
  },
  'Password set successfully': {
    en: 'Password set successfully.',
    hi: 'पासवर्ड सफलतापूर्वक सेट हो गया।',
    hinglish: 'Password set ho gaya!'
  },
  'Current password is incorrect': {
    en: 'Current password is incorrect.',
    hi: 'वर्तमान पासवर्ड गलत है।',
    hinglish: 'Purana password galat hai.'
  },
  'Route nahi mila': {
    en: 'API route not found.',
    hi: 'अनुरोधित मार्ग (रूट) उपलब्ध नहीं है।',
    hinglish: 'Ye API route nahi mila.'
  },
  'Server mein dikkat aayi': {
    en: 'An internal server error occurred. Please try again.',
    hi: 'सर्वर में तकनीकी समस्या आई है। कृपया कुछ देर बाद प्रयास करें।',
    hinglish: 'Server mein thodi dikkat aayi hai, dobara try karein.'
  },
  'Selected provider is date par unavailable hai': {
    en: 'Selected provider is unavailable on the chosen date.',
    hi: 'चयनित प्रोवाइडर चुनी गई तिथि पर उपलब्ध नहीं हैं।',
    hinglish: 'Selected provider is date par unavailable hai.'
  },
  'Selected provider us din unavailable hai': {
    en: 'Selected provider is unavailable on that weekday.',
    hi: 'चयनित प्रोवाइडर उस दिन उपलब्ध नहीं हैं।',
    hinglish: 'Selected provider us din unavailable hai.'
  },
  'Aapne is din ke liye availability OFF rakhi hai': {
    en: 'You marked yourself unavailable for this booking date.',
    hi: 'आपने इस बुकिंग तिथि के लिए उपलब्धता बंद (OFF) रखी है।',
    hinglish: 'Aapne is date ke liye apni availability OFF rakhi hai.'
  },
  'Live location sharing band kar di gayi': {
    en: 'Live location sharing stopped.',
    hi: 'लाइव लोकेशन शेयरिंग बंद कर दी गई है।',
    hinglish: 'Live location sharing band kar di gayi.'
  },
  'Live tracking sirf active job ke dauran hi chalu ho sakti hai': {
    en: 'Live tracking can only be enabled during an active job.',
    hi: 'लाइव ट्रैकिंग केवल सक्रिय कार्य के दौरान ही चालू की जा सकती है।',
    hinglish: 'Live tracking sirf active job ke dauran hi ON ho sakti hai.'
  }
};

function translateBackendMessage(msg, lang) {
  if (!msg || !lang) return msg;
  const entry = MESSAGE_MAP[msg];
  if (entry && entry[lang]) return entry[lang];
  return msg;
}

module.exports = {
  VALID_LANGS,
  normalizeLang,
  resolveLangFromRequest,
  STATUS_LABELS,
  NOTIF_TEMPLATES,
  translateBackendMessage
};
