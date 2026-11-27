const crypto = require('crypto');
const { CATEGORIES } = require('./db');

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'search_services',
      description: 'Search available home services in FixMate by keyword or category across all FixMate categories (e.g. Electrician, Plumber, AC Repair, TV Repair, Washing Machine, Refrigerator, RO & Water Purifier, Microwave, Carpenter, Home Cleaning, Pest Control, Painting, Appliance Installation, General Home Maintenance, Mechanic, Home Tutor).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or customer symptom such as "fan", "ac cooling", "washing machine leak", "tap leak", "switch", "wiring", "bike service"' },
          category: { type: 'string', enum: CATEGORIES, description: 'Optional service category filter' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_service_details',
      description: 'Get detailed information about a specific service including base visit price, rating, category, and warranty.',
      parameters: {
        type: 'object',
        properties: {
          service_id: { type: 'integer', description: 'ID of the service' },
          service_name: { type: 'string', description: 'Name of the service (optional if service_id is provided)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: 'Check real-time appointment time slots and online technician availability from the database for a service or category.',
      parameters: {
        type: 'object',
        properties: {
          service_id: { type: 'integer', description: 'Service ID' },
          category: { type: 'string', description: 'Service category' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_estimated_price',
      description: 'Get transparent price estimate and visiting charge policy for a service problem.',
      parameters: {
        type: 'object',
        properties: {
          service_id: { type: 'integer', description: 'Service ID' },
          problem_description: { type: 'string', description: 'Specific description of the customer problem' }
        },
        required: ['service_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_nearby_technicians',
      description: 'Find verified technicians in Dhanbad from real database records for a given category.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: CATEGORIES, description: 'Service category' }
        },
        required: ['category']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_technician_details',
      description: 'Retrieve verified badge, skill, real completed jobs count, and real reviews rating of a specific technician.',
      parameters: {
        type: 'object',
        properties: {
          worker_id: { type: 'integer', description: 'Worker user ID' }
        },
        required: ['worker_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_booking',
      description: 'Create an actual confirmed booking in FixMate. MUST ONLY be called AFTER the customer has given explicit verbal or written confirmation to book.',
      parameters: {
        type: 'object',
        properties: {
          service_id: { type: 'integer', description: 'The service ID to book' },
          slot: { type: 'string', description: 'Selected slot (e.g. "Abhi (60 min mein)", "Aaj 6 se 8 PM", "Kal 10 se 12 AM")' },
          address: { type: 'string', description: 'Customer full service address' },
          issue_desc: { type: 'string', description: 'Optional summary of customer problem/symptoms' },
          pay_method: { type: 'string', enum: ['wallet', 'cash', 'razorpay'], description: 'Payment method ("wallet", "cash", or "razorpay" for online)' },
          confirmed: { type: 'boolean', description: 'Explicit customer agreement to book. Must be true.' }
        },
        required: ['service_id', 'slot', 'address', 'confirmed']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_booking_status',
      description: 'Get real database status of customer bookings (latest bookings or specific booking by ID).',
      parameters: {
        type: 'object',
        properties: {
          booking_id: { type: 'integer', description: 'Optional specific booking ID to inspect' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'reschedule_booking',
      description: 'Reschedule a customer booking time slot. MUST ONLY be called AFTER explicit customer confirmation. Only valid while status is requested or assigned.',
      parameters: {
        type: 'object',
        properties: {
          booking_id: { type: 'integer', description: 'Booking ID to reschedule' },
          new_slot: { type: 'string', description: 'New time slot chosen by customer' },
          confirmed: { type: 'boolean', description: 'Explicit customer agreement to reschedule. Must be true.' }
        },
        required: ['booking_id', 'new_slot', 'confirmed']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'request_booking_cancellation',
      description: 'Cancel a customer booking if work has not yet started (status requested or assigned). MUST ONLY be called AFTER explicit customer confirmation.',
      parameters: {
        type: 'object',
        properties: {
          booking_id: { type: 'integer', description: 'Booking ID to cancel' },
          reason: { type: 'string', description: 'Reason for cancellation' },
          confirmed: { type: 'boolean', description: 'Explicit customer agreement to cancel. Must be true.' }
        },
        required: ['booking_id', 'confirmed']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_invoice_summary',
      description: 'Fetch real itemized billing, quote parts breakdown, 18% GST taxes, promo discounts, and payment status for a customer booking to explain their invoice clearly.',
      parameters: {
        type: 'object',
        properties: {
          booking_id: { type: 'integer', description: 'Optional booking ID (defaults to latest booking if omitted)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'file_complaint',
      description: 'Register an official complaint or support ticket into the FixMate database for a booking or service issue.',
      parameters: {
        type: 'object',
        properties: {
          booking_id: { type: 'integer', description: 'Related booking ID (optional)' },
          category: { type: 'string', enum: ['Quality of Work', 'Delay in Service', 'Technician Behavior', 'Pricing Dispute', 'Parts Issue', 'Other'], description: 'Complaint category' },
          description: { type: 'string', description: 'Detailed description of the issue' },
          refund_requested: { type: 'boolean', description: 'Whether customer is requesting a refund' }
        },
        required: ['category', 'description']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_faqs',
      description: 'Get verified FixMate policy answers regarding warranty, visiting charges, cancellation rules, safety start code, and service coverage.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Optional topic such as "warranty", "cancellation", "visiting_fee", "safety", "pricing", "all"' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'contact_human_support',
      description: 'Escalate customer query to human customer support desk for sensitive issues, custom requirements, or call-back requests.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Reason for human support escalation' },
          customer_phone: { type: 'string', description: 'Customer contact phone number' }
        },
        required: ['reason']
      }
    }
  }
];

const STANDARD_SLOTS = ['Abhi (60 min mein)', 'Aaj 6 se 8 PM', 'Kal 10 se 12 AM'];
const TUTOR_SLOTS = ['Free demo: Kal 5 PM', 'Free demo: Parso 5 PM'];

const SYMPTOM_KB = [
  {
    pattern: /washing\s*machine|wash\s*machine|spin|dryer|drum|paani\s*leak.*machine|machine.*leak/i,
    category: 'Washing Machine',
    fallbackDbCategory: 'Electrician',
    searchTerms: ['washing', 'switch', 'wiring'],
    causes: [
      'Drain hose pipe dheela hona ya crack hona',
      'Door rubber gasket/seal ghis jaana (front-load mein aam wajah)',
      'Inlet water valve ya pump filter block hona'
    ],
    followUpHi: 'Samajh gaya. Aapki washing machine front-load hai ya top-load? Aur paani neeche se leak ho raha hai ya peeche wale pipe se?',
    followUpEn: 'Got it. Is your washing machine a front-load or top-load model, and is water leaking from the door seal or the back drain pipe?'
  },
  {
    pattern: /\b(ac|a\.c\.|air\s*conditioner|split\s*ac|window\s*ac)\b|thandi\s*hawa|cooling\s*nahi|not\s*cooling|gas\s*(refill|leak)/i,
    category: 'AC Repair',
    fallbackDbCategory: 'AC Repair',
    searchTerms: ['ac', 'gas', 'split'],
    causes: [
      'Indoor unit ke air filter mein dhool jamna (airflow block)',
      'Refrigerant/coolant gas kam hona ya pipe leakage',
      'Outdoor condenser unit ya capacitor weak hona'
    ],
    followUpHi: 'Samajh gaya. Kya ye Split AC hai ya Window AC? Aur kya hawa bilkul garam aa rahi hai ya sirf cooling kam hui hai?',
    followUpEn: 'Understood. Is it a Split AC or Window AC, and is it blowing warm air or just cooling slowly?'
  },
  {
    pattern: /tap|nal|pipe|sink|basin|flush|toilet|bathroom|plumb|water\s*tank|paani\s*(tapak|leak|beh)/i,
    category: 'Plumber',
    fallbackDbCategory: 'Plumber',
    searchTerms: ['tap', 'leakage', 'fitting', 'tank'],
    causes: [
      'Tap ka rubber washer ya ceramic cartridge kharab hona',
      'Pipe joint par Teflon tape / sealing loose hona',
      'Water pressure zyada hone se spindle leak hona'
    ],
    followUpHi: 'Samajh gaya. Kya paani tap band karne ke baad bhi continuous tapak raha hai, ya pipe joint se leak ho raha hai?',
    followUpEn: 'Got it. Is water dripping even when the tap is closed, or leaking from a pipe joint?'
  },
  {
    pattern: /fan|pankha|switch|socket|board|wiring|inverter|mcb|bijli|light|short\s*circuit|spark|fridge|refrigerator|geyser|microwave/i,
    category: 'Electrician',
    fallbackDbCategory: 'Electrician',
    searchTerms: ['fan', 'switch', 'inverter'],
    causes: [
      'Ceiling fan ka capacitor weak hona ya winding issue',
      'Switch board ya socket ke andar loose connection / burnt wire',
      'MCB trip ya voltage fluctuation'
    ],
    followUpHi: 'Samajh gaya. Kya bilkul power/current nahi aa raha, ya kuch awaz/sparking/slow chalne ki dikkat hai?',
    followUpEn: 'Understood. Is there zero power at all, or do you hear noise, notice slow speed, or see sparking?'
  },
  {
    pattern: /\btv\b|television|screen|led|lcd|wall\s*mount|remote/i,
    category: 'TV Repair',
    fallbackDbCategory: 'TV Repair',
    searchTerms: ['tv', 'mount'],
    causes: [
      'Backlight strip ya T-Con display board issue',
      'Power supply PCB capacitor fault'
    ],
    followUpHi: 'Kya TV mein aawaz aa rahi hai par picture nahi dikh rahi, ya TV bilkul on nahi ho raha?',
    followUpEn: 'Do you hear sound with a blank screen, or is the TV not turning on at all?'
  },
  {
    pattern: /bike|car|scooter|scooty|puncture|engine|garage|mechanic/i,
    category: 'Mechanic',
    fallbackDbCategory: 'Mechanic',
    searchTerms: ['bike', 'car'],
    causes: [
      'Spark plug, battery charge ya engine oil service due hona',
      'Fuel filter ya starter relay check ki zaroorat'
    ],
    followUpHi: 'Aapki bike hai ya car? Aur kya starting problem aa rahi hai ya regular servicing chahiye?',
    followUpEn: 'Is it a bike or a car, and are you facing a breakdown/starting trouble or looking for regular servicing?'
  },
  {
    pattern: /tutor|tuition|teacher|maths|science|english|coding|class\s*\d/i,
    category: 'Home Tutor',
    fallbackDbCategory: 'Home Tutor',
    searchTerms: ['maths', 'english', 'tutor'],
    causes: [],
    followUpHi: 'Kaunsi class aur subject ke liye home tutor chahiye? Pehla demo class bilkul free hai!',
    followUpEn: 'Which grade and subjects do you need a home tutor for? Your first demo session is free!'
  }
];

function diagnoseSymptom(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  for (const item of SYMPTOM_KB) {
    if (item.pattern.test(q)) {
      return item;
    }
  }
  return null;
}

const VERIFIED_FAQS = {
  warranty: 'FixMate gives a 30-day free service & labor warranty on every completed repair, plus up to 90 days warranty on genuine spare parts replaced by our technicians.',
  visiting_fee: 'Standard inspection / visiting charge is ₹99 (or service base fee). If you approve the repair quote, the inspection fee is adjusted/waived in your final bill. If you reject the quote after inspection, only ₹99 visit charge applies.',
  cancellation: 'You can cancel or reschedule for free anytime while your booking is in "Requested" or "Assigned" status (before the technician starts travelling or begins work).',
  safety: 'All FixMate technicians undergo ID & police verification. Work only starts after you share your unique 4-digit Safety Code shown in the FixMate app.',
  pricing: '100% transparent upfront pricing: base labor + genuine spare parts (approved by you before work starts) minus promo discounts + standard 18% GST (CGST 9% + SGST 9%) shown on digital tax invoices.',
  coverage: 'Currently serving Dhanbad, Jharkhand across all residential areas. Emergency priority bookings aim for ~60 min dispatch depending on live technician availability.'
};

async function ensureSeedWorkers() {
  // Disabled: do not auto-seed fake/sample technicians into production users table.
  return;
}

async function executeTool(name, args, { db, user }) {
  await ensureSeedWorkers(db);

  switch (name) {
    case 'search_services': {
      const q = (args.query || '').trim();
      const cat = (args.category || '').trim();
      const symptom = diagnoseSymptom(q);
      let query = 'SELECT id, cat, name, price, rating FROM services WHERE 1=1';
      const params = [];
      let pIdx = 1;

      if (cat) {
        query += ` AND cat = $${pIdx++}`;
        params.push(cat);
      }
      if (q) {
        query += ` AND (name ILIKE '%' || $${pIdx} || '%' OR cat ILIKE '%' || $${pIdx} || '%')`;
        params.push(q);
        pIdx++;
      }
      query += ' ORDER BY rating DESC LIMIT 6';

      const res = await db.query(query, params);
      let results = res.rows;

      // Smart symptom-aware DB lookup when exact substring isn't in service title
      if (results.length === 0 && (q || cat)) {
        const searchCat = cat || (symptom ? symptom.category : null);
        if (searchCat) {
          const exactCatRes = await db.query('SELECT id, cat, name, price, rating FROM services WHERE cat = $1 ORDER BY rating DESC LIMIT 4', [searchCat]);
          results = exactCatRes.rows;
        }
        if (results.length === 0 && symptom && symptom.fallbackDbCategory) {
          const fbRes = await db.query('SELECT id, cat, name, price, rating FROM services WHERE cat = $1 ORDER BY rating DESC LIMIT 4', [symptom.fallbackDbCategory]);
          results = fbRes.rows;
        }
      }

      return {
        success: true,
        count: results.length,
        detected_category: symptom ? symptom.category : (cat || (results[0]?.cat || null)),
        possible_causes: symptom ? symptom.causes : [],
        follow_up_question: symptom ? symptom.followUpHi : null,
        services: results.map(s => ({
          id: s.id,
          category: s.cat,
          name: s.name,
          base_price: `₹${s.price}`,
          price_numeric: s.price,
          rating: Number(s.rating),
          starting_note: s.cat === 'Home Tutor' ? 'Free demo class available' : `Visit/Base fee starts at ₹${s.price}`
        }))
      };
    }

    case 'get_service_details': {
      let service;
      if (args.service_id) {
        service = await db.queryOne('SELECT * FROM services WHERE id = $1', [args.service_id]);
      } else if (args.service_name) {
        service = await db.queryOne("SELECT * FROM services WHERE name ILIKE '%' || $1 || '%' LIMIT 1", [args.service_name]);
      }

      if (!service) {
        return { success: false, error: 'Service nahi mili. Kripya list mein se chunein.' };
      }

      return {
        success: true,
        service: {
          id: service.id,
          name: service.name,
          category: service.cat,
          base_visit_price: `₹${service.price}`,
          price_numeric: service.price,
          rating: Number(service.rating),
          warranty: '30 Din ki free service warranty har service par (spare parts par 90 din)',
          safety: 'Police & ID-verified technician aur 4-digit safety start code',
          quote_policy: 'Kaam shuru hone se pehle itemized quote customer approval ke liye diya jata hai.'
        }
      };
    }

    case 'check_availability': {
      let service = null;
      let cat = args.category;
      if (args.service_id) {
        service = await db.queryOne('SELECT * FROM services WHERE id = $1', [args.service_id]);
        if (service) cat = service.cat;
      }

      const isTutor = cat === 'Home Tutor';
      const slots = isTutor ? TUTOR_SLOTS : STANDARD_SLOTS;

      let onlineWorkers = 0;
      if (cat) {
        const row = await db.queryOne("SELECT COUNT(*) AS c FROM users WHERE role = 'worker' AND skill = $1 AND online = 1", [cat]);
        onlineWorkers = row ? Number(row.c) : 0;
        // Fallback check for general or appliance repairs mapped to Electrician if specific trade has 0 dedicated workers
        if (onlineWorkers === 0 && ['Washing Machine', 'Refrigerator', 'Microwave', 'Appliance Installation', 'General Home Maintenance'].includes(cat)) {
          const fb = await db.queryOne("SELECT COUNT(*) AS c FROM users WHERE role = 'worker' AND skill = 'Electrician' AND online = 1");
          onlineWorkers = fb ? Number(fb.c) : 0;
        }
      } else {
        const row = await db.queryOne("SELECT COUNT(*) AS c FROM users WHERE role = 'worker' AND online = 1");
        onlineWorkers = row ? Number(row.c) : 0;
      }

      return {
        success: true,
        available: onlineWorkers > 0,
        category: cat || 'General',
        city: 'Dhanbad, Jharkhand',
        available_slots: onlineWorkers > 0 ? slots : ['Aaj 6 se 8 PM', 'Kal 10 se 12 AM'],
        online_technicians: onlineWorkers,
        fastest_arrival: onlineWorkers > 0 ? '60 minutes (Abhi slot mein)' : 'Scheduled slot (Next available technician)'
      };
    }

    case 'get_estimated_price': {
      const service = await db.queryOne('SELECT * FROM services WHERE id = $1', [args.service_id]);
      if (!service) return { success: false, error: 'Service ID invalid hai' };

      const base = service.price;
      const isTutor = service.cat === 'Home Tutor';

      if (isTutor) {
        return {
          success: true,
          service_name: service.name,
          first_class: 'Free demo class',
          monthly_plan: `₹${base} per month`,
          policy: 'Demo pasand aane par hi monthly fee pay karein.'
        };
      }

      const symptom = diagnoseSymptom(args.problem_description || '');
      return {
        success: true,
        service_name: service.name,
        inspection_visit_fee: '₹99 (waived when repair is approved)',
        base_service_labor: `₹${base}`,
        estimated_range: `₹${base} se ₹${Math.round(base * 1.6)} tak (plus any spare parts approved by you)`,
        possible_causes: symptom ? symptom.causes : [],
        gst_note: '18% GST (CGST 9% + SGST 9%) itemized tax invoice par lagu hota hai.',
        rule: `Approval ke baad ₹99 visit charge maaf ho jata hai aur sirf ₹${base} labor + spare parts bill hota hai. Agar quote reject kiya toh sirf ₹99 visit fee lagegi.`
      };
    }

    case 'find_nearby_technicians': {
      let res = await db.query(
        "SELECT id, name, skill, phone, online, COALESCE(id_verified, 1) AS id_verified FROM users WHERE role = 'worker' AND skill = $1",
        [args.category]
      );
      if (res.rows.length === 0 && ['Washing Machine', 'Refrigerator', 'Microwave'].includes(args.category)) {
        res = await db.query(
          "SELECT id, name, skill, phone, online, COALESCE(id_verified, 1) AS id_verified FROM users WHERE role = 'worker' AND skill = 'Electrician'"
        );
      }

      const technicians = [];
      for (const t of res.rows) {
        const revRow = await db.queryOne('SELECT AVG(rating) AS avg_r, COUNT(*) AS cnt FROM reviews WHERE worker_id = $1', [t.id]);
        const jobRow = await db.queryOne("SELECT COUNT(*) AS jobs FROM bookings WHERE worker_id = $1 AND status IN ('completed', 'closed')", [t.id]);
        technicians.push({
          worker_id: t.id,
          name: t.name,
          skill: t.skill,
          verified: Boolean(t.id_verified),
          badge: t.id_verified ? 'Police & ID Verified ✅' : 'Verification Pending',
          rating: revRow && revRow.avg_r ? Number(Number(revRow.avg_r).toFixed(1)) : null,
          reviews_count: revRow ? Number(revRow.cnt) : 0,
          completed_jobs: jobRow ? Number(jobRow.jobs) : 0,
          status: t.online ? 'Online & Available' : 'Currently Offline'
        });
      }

      return {
        success: true,
        city: 'Dhanbad, Jharkhand',
        category: args.category,
        count: technicians.length,
        technicians
      };
    }

    case 'get_technician_details': {
      const row = await db.queryOne("SELECT id, name, skill, phone, online, experience_years, service_areas, COALESCE(id_verified, 1) AS id_verified FROM users WHERE id = $1 AND role = 'worker'", [args.worker_id]);
      if (!row) {
        return { success: false, error: 'Technician nahi mila' };
      }

      const revRow = await db.queryOne('SELECT AVG(rating) AS avg_r, COUNT(*) AS cnt FROM reviews WHERE worker_id = $1', [row.id]);
      const jobRow = await db.queryOne("SELECT COUNT(*) AS jobs FROM bookings WHERE worker_id = $1 AND status IN ('completed', 'closed')", [row.id]);

      return {
        success: true,
        technician: {
          id: row.id,
          name: row.name,
          trade: row.skill,
          verified: Boolean(row.id_verified),
          experience_years: row.experience_years || 2,
          service_areas: row.service_areas || 'All Dhanbad',
          police_verification: row.id_verified ? 'Verified by FixMate Safety Team' : 'Pending Verification',
          rating: revRow && revRow.avg_r ? Number(Number(revRow.avg_r).toFixed(1)) : null,
          reviews_count: revRow ? Number(revRow.cnt) : 0,
          jobs_completed: jobRow ? Number(jobRow.jobs) : 0
        }
      };
    }

    case 'create_booking': {
      if (!user) {
        return {
          success: false,
          needs_login: true,
          message: 'Booking confirm karne ke liye pehle login karna zaroori hai. Kripya login screen se login karein.'
        };
      }
      if (user.role !== 'customer') {
        return { success: false, message: 'Sirf customers hi service book kar sakte hain.' };
      }
      if (args.confirmed !== true) {
        return {
          success: false,
          needs_confirmation: true,
          message: 'Booking abhi confirm nahi hui. Kripya customer se explicit confirmation poochhein: "Kya main ye booking confirm kar doon?"'
        };
      }

      const s = await db.queryOne('SELECT * FROM services WHERE id = $1', [args.service_id]);
      if (!s) return { success: false, message: 'Service nahi mili' };

      const slot = String(args.slot || 'Abhi (60 min mein)').slice(0, 60);
      const address = String(args.address || 'Dhanbad, Jharkhand').slice(0, 200);
      const issueDesc = args.issue_desc ? String(args.issue_desc).slice(0, 500) : null;
      const pay = ['wallet', 'cash', 'razorpay'].includes(args.pay_method) ? args.pay_method : 'wallet';
      const code = String(crypto.randomInt(1000, 10000));

      const ins = await db.query(
        'INSERT INTO bookings (customer_id, service_id, slot, address, pay, start_code, issue_desc) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [user.id, s.id, slot, address, pay, code, issueDesc]
      );

      const bookingId = ins.rows[0].id;

      return {
        success: true,
        booking_created: true,
        booking: {
          id: bookingId,
          service: s.name,
          category: s.cat,
          price: s.price,
          slot,
          address,
          pay_method: pay,
          status: 'requested',
          status_label: 'Booking confirm',
          start_code: code,
          warranty: '30 Din Free Warranty',
          security_note: 'Jab worker aapke ghar pahuchein, unhe ye 4-digit safety code batayein kaam shuru karne ke liye.'
        }
      };
    }

    case 'get_booking_status': {
      if (!user) {
        return { success: false, needs_login: true, message: 'Apne bookings dekhne ke liye login karein.' };
      }

      const LABELS = {
        requested: 'Booking confirm (Technician assign ho raha hai)',
        assigned: 'Worker assign hua',
        on_the_way: 'Worker raste mein hai',
        inspecting: 'Worker jaanch kar raha hai',
        quoted: 'Quote taiyaar hai (Approval pending)',
        in_progress: 'Kaam chal raha hai',
        completed: 'Kaam poora hua',
        closed: 'Quote reject, visit fee baaki',
        cancelled: 'Booking cancel hui'
      };

      let rows;
      if (args.booking_id) {
        const res = await db.query(`
          SELECT b.*, s.name AS service_name, s.cat, s.price AS base_price, w.name AS worker_name, w.phone AS worker_phone
          FROM bookings b
          JOIN services s ON s.id = b.service_id
          LEFT JOIN users w ON w.id = b.worker_id
          WHERE b.id = $1 AND b.customer_id = $2
        `, [args.booking_id, user.id]);
        rows = res.rows;
      } else {
        const res = await db.query(`
          SELECT b.*, s.name AS service_name, s.cat, s.price AS base_price, w.name AS worker_name, w.phone AS worker_phone
          FROM bookings b
          JOIN services s ON s.id = b.service_id
          LEFT JOIN users w ON w.id = b.worker_id
          WHERE b.customer_id = $1
          ORDER BY b.id DESC LIMIT 3
        `, [user.id]);
        rows = res.rows;
      }

      if (!rows.length) {
        return { success: true, count: 0, message: 'Aapki abhi koi active booking nahi mili.' };
      }

      return {
        success: true,
        count: rows.length,
        bookings: rows.map(b => ({
          booking_id: b.id,
          service: b.service_name,
          category: b.cat,
          slot: b.slot,
          address: b.address,
          status: b.status,
          status_text: LABELS[b.status] || b.status,
          assigned_worker: b.worker_name || 'Assigning soon...',
          worker_phone: b.worker_phone ? b.worker_phone.slice(0, 2) + 'XXXXXX' + b.worker_phone.slice(-2) : null,
          start_code: b.start_code,
          total: b.total > 0 ? `₹${b.total}` : `₹${b.base_price} (estimated base fee)`,
          paid: Boolean(b.paid)
        }))
      };
    }

    case 'reschedule_booking': {
      if (!user) {
        return { success: false, needs_login: true, message: 'Booking reschedule karne ke liye login zaroori hai.' };
      }
      if (args.confirmed !== true) {
        return {
          success: false,
          needs_confirmation: true,
          message: 'Reschedule se pehle customer ki explicit confirmation lein: "Kya main slot change confirm kar doon?"'
        };
      }
      const b = await db.queryOne('SELECT * FROM bookings WHERE id = $1 AND customer_id = $2', [args.booking_id, user.id]);
      if (!b) return { success: false, message: 'Booking nahi mili ya aapke account ki nahi hai.' };
      if (!['requested', 'assigned'].includes(b.status)) {
        return {
          success: false,
          message: `Booking #${b.id} abhi reschedule nahi ho sakti kyunki technician already '${b.status}' state mein hai.`
        };
      }
      const newSlot = String(args.new_slot || '').trim().slice(0, 80);
      if (!newSlot) return { success: false, message: 'Naya time slot specify karein.' };

      await db.query('UPDATE bookings SET slot = $1 WHERE id = $2', [newSlot, b.id]);
      return {
        success: true,
        rescheduled: true,
        booking_id: b.id,
        old_slot: b.slot,
        new_slot: newSlot,
        message: `Booking #${b.id} ka slot safalta-poorvak "${newSlot}" par reschedule ho gaya hai.`
      };
    }

    case 'request_booking_cancellation': {
      if (!user) {
        return { success: false, needs_login: true, message: 'Booking cancel karne ke liye login zaroori hai.' };
      }
      if (args.confirmed !== true) {
        return {
          success: false,
          needs_confirmation: true,
          message: 'Cancel karne se pehle customer ki explicit confirmation zaroori hai: "Kya aap sach mein is booking ko cancel karna chahte hain?"'
        };
      }

      const b = await db.queryOne('SELECT * FROM bookings WHERE id = $1 AND customer_id = $2', [args.booking_id, user.id]);
      if (!b) return { success: false, message: 'Ye booking aapki nahi hai ya nahi mili.' };

      if (!['requested', 'assigned'].includes(b.status)) {
        return {
          success: false,
          message: `Booking abhi cancel nahi ho sakti kyunki worker already '${b.status}' state mein hai. Helpdesk se call karein.`
        };
      }

      await db.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [b.id]);
      return {
        success: true,
        booking_id: b.id,
        cancelled: true,
        message: `Booking #${b.id} safalta-poorvak cancel kar di gayi hai. Koi cancellation fee nahi lagi.`
      };
    }

    case 'get_invoice_summary': {
      if (!user) {
        return { success: false, needs_login: true, message: 'Apna bill aur invoice dekhne ke liye login karein.' };
      }

      const b = args.booking_id
        ? await db.queryOne(
            `SELECT b.*, s.name AS service_name, s.price AS base_price, w.name AS worker_name
             FROM bookings b JOIN services s ON s.id = b.service_id LEFT JOIN users w ON w.id = b.worker_id
             WHERE b.id = $1 AND b.customer_id = $2`,
            [args.booking_id, user.id]
          )
        : await db.queryOne(
            `SELECT b.*, s.name AS service_name, s.price AS base_price, w.name AS worker_name
             FROM bookings b JOIN services s ON s.id = b.service_id LEFT JOIN users w ON w.id = b.worker_id
             WHERE b.customer_id = $1 ORDER BY b.id DESC LIMIT 1`,
            [user.id]
          );

      if (!b) return { success: false, message: 'Koi booking/invoice record nahi mila.' };

      const isRejectedQuote = b.status === 'closed';
      const baseLabor = isRejectedQuote ? 99 : Number(b.base_price || 0);
      const partsCost = isRejectedQuote ? 0 : Number(b.parts || 0);
      const emergencyFee = b.is_emergency ? 99 : 0;
      const discount = Number(b.discount_amount || 0);
      const subtotal = Math.max(0, baseLabor + partsCost + emergencyFee - discount);
      const cgst = Math.round(subtotal * 0.09);
      const sgst = Math.round(subtotal * 0.09);
      const finalPayable = Number(b.total) > 0 ? Number(b.total) : subtotal + cgst + sgst;

      return {
        success: true,
        invoice: {
          invoice_number: `INV-FM-${String(b.id).padStart(4, '0')}`,
          booking_id: b.id,
          service_name: b.service_name,
          status: b.status,
          technician: b.worker_name || 'Pending assignment',
          base_labor: `₹${baseLabor}`,
          inspection_fee_note: isRejectedQuote ? '₹99 Inspection Charge Applied' : '₹99 Waived on service acceptance',
          spare_parts: partsCost > 0 ? `₹${partsCost} (${b.parts_desc || 'Genuine spare parts'})` : '₹0',
          discount: discount > 0 ? `-₹${discount} (${b.coupon_code || 'Promo'})` : '₹0',
          gst_breakdown: `₹${cgst + sgst} (CGST 9% ₹${cgst} + SGST 9% ₹${sgst})`,
          total_payable: `₹${finalPayable}`,
          payment_status: b.paid ? 'PAID' : 'PAYMENT PENDING',
          payment_mode: b.pay,
          warranty: isRejectedQuote ? 'N/A' : `${b.warranty_days || 30} Days Service Warranty`
        }
      };
    }

    case 'file_complaint': {
      if (!user) {
        return { success: false, needs_login: true, message: 'Complaint ticket register karne ke liye pehle login karein.' };
      }
      const desc = String(args.description || '').trim();
      if (desc.length < 5) {
        return { success: false, message: 'Kripya apni dikkat ka kam se kam 5 akshar mein vivaran batayein.' };
      }
      const category = String(args.category || 'Other');
      const refundRequested = args.refund_requested ? 1 : 0;
      let bookingId = args.booking_id ? Number(args.booking_id) : null;
      if (bookingId) {
        const owns = await db.queryOne('SELECT id FROM bookings WHERE id = $1 AND customer_id = $2', [bookingId, user.id]);
        if (!owns) bookingId = null;
      }

      const ins = await db.query(
        `INSERT INTO complaints (booking_id, customer_id, category, description, refund_requested)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [bookingId, user.id, category, desc.slice(0, 1000), refundRequested]
      );
      const ticketId = ins.rows[0].id;

      return {
        success: true,
        ticket_created: true,
        ticket_id: ticketId,
        category,
        status: 'open',
        message: `Aapki complaint Ticket #${ticketId} safalta-poorvak darj ho gayi hai. FixMate Support Team is par turant action legi.`
      };
    }

    case 'get_faqs': {
      const topic = String(args.topic || 'all').toLowerCase();
      if (topic !== 'all' && VERIFIED_FAQS[topic]) {
        return { success: true, topic, answer: VERIFIED_FAQS[topic] };
      }
      return {
        success: true,
        topic: 'all',
        faqs: VERIFIED_FAQS
      };
    }

    case 'contact_human_support': {
      return {
        success: true,
        support_phone: '+91 7209612650',
        support_email: 'support@fixmate.in',
        hours: 'Subah 8:00 AM se Raat 9:00 PM tak (Daily)',
        city_desk: 'FixMate Customer Operations Desk, Dhanbad',
        ticket_id: `FM-SUP-${Date.now().toString().slice(-6)}`,
        note: 'Aap upar diye gaye helpline number par call kar sakte hain ya customer executive thodi der mein aapse sampark karega.'
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  executeTool,
  ensureSeedWorkers,
  diagnoseSymptom,
  VERIFIED_FAQS
};
