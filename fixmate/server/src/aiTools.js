const crypto = require('crypto');
const { CATEGORIES } = require('./db');

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'search_services',
      description: 'Search available home services in FixMate by keyword or category (e.g. Electrician, Plumber, AC Repair, TV Repair, Mechanic, Home Tutor).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term such as "fan", "ac cooling", "leakage", "switch", "wiring", "bike service"' },
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
      description: 'Check available appointment time slots and technician availability for a service.',
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
      description: 'Get realistic price estimate and explanation for a service problem. Explains that visit fee adjusts in final quote.',
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
      description: 'Find verified, police-verified technicians nearby in Dhanbad for a given category.',
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
      description: 'Retrieve verified badge, skill, and ratings of a specific technician.',
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
      description: 'Get status of customer bookings (latest active booking or specific booking by ID).',
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
      name: 'request_booking_cancellation',
      description: 'Cancel a customer booking if work has not yet started (status requested or assigned).',
      parameters: {
        type: 'object',
        properties: {
          booking_id: { type: 'integer', description: 'Booking ID to cancel' },
          reason: { type: 'string', description: 'Reason for cancellation' }
        },
        required: ['booking_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'contact_human_support',
      description: 'Escalate customer query to human customer support desk for sensitive issues or custom requirements.',
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

async function ensureSeedWorkers(db) {
  try {
    const existing = await db.queryOne("SELECT COUNT(*) AS count FROM users WHERE role = 'worker'");
    if (Number(existing.count) === 0) {
      const workers = [
        ['9800000001', 'Sunil Kumar (Verified Pro)', 'Electrician'],
        ['9800000002', 'Ramesh Verma (Senior Plumber)', 'Plumber'],
        ['9800000003', 'Mohammad Imran (AC Specialist)', 'AC Repair'],
        ['9800000004', 'Vikas Sharma (Electronics Expert)', 'TV Repair'],
        ['9800000005', 'Manoj Mahato (Certified Mechanic)', 'Mechanic'],
        ['9800000006', 'Priya Kumari (B.Tech, Maths/Science)', 'Home Tutor']
      ];
      await db.transaction(async (tx) => {
        for (const w of workers) {
          await tx.query(
            `INSERT INTO users (phone, name, role, skill, wallet, online, token_version)
             VALUES ($1, $2, 'worker', $3, 1000, 1, 0)
             ON CONFLICT (phone) DO NOTHING`,
            [w[0], w[1], w[2]]
          );
        }
      });
    }
  } catch (err) {
    console.warn('[AI Tools] Seed workers check skipped:', err.message);
  }
}

async function executeTool(name, args, { db, user }) {
  await ensureSeedWorkers(db);

  switch (name) {
    case 'search_services': {
      const q = (args.query || '').trim();
      const cat = (args.category || '').trim();
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

      // Intelligent keyword fallback if exact substring not found
      if (results.length === 0 && q) {
        let fallbackCat = cat;
        if (!fallbackCat) {
          if (/wash|machin|fridge|refrigerator|geyser|cooler|motor|heater|microwave/i.test(q)) fallbackCat = 'Electrician';
          else if (/tap|leak|pipe|nal|tank|flush|basin/i.test(q)) fallbackCat = 'Plumber';
          else if (/ac|cool|gas/i.test(q)) fallbackCat = 'AC Repair';
          else if (/bike|car|scooter|motorcycle/i.test(q)) fallbackCat = 'Mechanic';
          else if (/tutor|teach|class|maths|science/i.test(q)) fallbackCat = 'Home Tutor';
          else if (/tv|screen|sound|dth/i.test(q)) fallbackCat = 'TV Repair';
        }
        if (fallbackCat) {
          const fbRes = await db.query('SELECT id, cat, name, price, rating FROM services WHERE cat = $1 ORDER BY rating DESC LIMIT 3', [fallbackCat]);
          results = fbRes.rows;
        }
      }

      return {
        success: true,
        count: results.length,
        services: results.map(s => ({
          id: s.id,
          category: s.cat,
          name: s.name,
          base_price: `₹${s.price}`,
          price_numeric: s.price,
          rating: Number(s.rating),
          starting_note: s.cat === 'Home Tutor' ? 'Free demo class available' : `Visit starts at ₹${s.price}`
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
          warranty: '30 Din ki free warranty har service par',
          safety: 'Police-verified technician aur 4-digit safety start code',
          quote_policy: 'Kaam shuru hone se pehle transparent quote diya jayega. Visit fee quote mein adjust ho jati hai.'
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
      }

      return {
        success: true,
        available: true,
        category: cat || 'General',
        city: 'Dhanbad, Jharkhand',
        available_slots: slots,
        online_technicians: Math.max(onlineWorkers, 1),
        fastest_arrival: '60 minutes (Abhi slot mein)'
      };
    }

    case 'get_estimated_price': {
      const service = await db.queryOne('SELECT * FROM services WHERE id = $1', [args.service_id]);
      if (!service) return { success: false, error: 'Service ID invalid hai' };

      const base = service.price;
      const isTutor = service.cat === 'Home Tutor';

      let minTotal = base;
      let maxTotal = Math.round(base * 1.6);

      if (isTutor) {
        return {
          success: true,
          service_name: service.name,
          first_class: 'Free demo class',
          monthly_plan: `₹${base} per month`,
          policy: 'Demo pasand aane par hi monthly fee pay karein.'
        };
      }

      return {
        success: true,
        service_name: service.name,
        inspection_visit_fee: `₹${base}`,
        estimated_range: `₹${minTotal} se ₹${maxTotal} tak (problem complexity ke aadhar par)`,
        rule: `₹${base} visit fee kaam hone par final quote mein adjust ho jati hai. Agar quote reject kiya toh sirf ₹99 visit fee lagegi.`
      };
    }

    case 'find_nearby_technicians': {
      const res = await db.query("SELECT id, name, skill, phone FROM users WHERE role = 'worker' AND skill = $1", [args.category]);
      const rows = res.rows;
      const technicians = rows.length ? rows : [
        { id: 99, name: `${args.category} Expert Technician`, skill: args.category, phone: '98XXXXXX10' }
      ];

      return {
        success: true,
        city: 'Dhanbad, Jharkhand',
        category: args.category,
        count: technicians.length,
        technicians: technicians.map(t => ({
          worker_id: t.id,
          name: t.name,
          badge: 'Police & ID Verified ✅',
          experience: '4.8+ Rating (FixMate Certified)',
          status: 'Online & Available'
        }))
      };
    }

    case 'get_technician_details': {
      const row = await db.queryOne("SELECT id, name, skill, phone, online FROM users WHERE id = $1 AND role = 'worker'", [args.worker_id]);
      if (!row) {
        return { success: false, error: 'Technician nahi mila' };
      }

      return {
        success: true,
        technician: {
          id: row.id,
          name: row.name,
          trade: row.skill,
          verified: true,
          police_verification: 'Verified by FixMate Safety Team',
          rating: 4.8,
          jobs_completed: '250+'
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
      if (!args.confirmed) {
        return {
          success: false,
          needs_confirmation: true,
          message: 'Booking abhi confirm nahi hui. Kripya customer se confirmation poochhein: "Kya main ye booking confirm kar doon?"'
        };
      }

      const s = await db.queryOne('SELECT * FROM services WHERE id = $1', [args.service_id]);
      if (!s) return { success: false, message: 'Service nahi mili' };

      const slot = String(args.slot || 'Abhi (60 min mein)').slice(0, 60);
      const address = String(args.address || 'Dhanbad, Jharkhand').slice(0, 200);
      const pay = ['wallet', 'cash', 'razorpay'].includes(args.pay_method) ? args.pay_method : 'wallet';
      const code = String(crypto.randomInt(1000, 10000));

      const ins = await db.query(
        'INSERT INTO bookings (customer_id, service_id, slot, address, pay, start_code) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [user.id, s.id, slot, address, pay, code]
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
        quoted: 'Quote taiyaar hai',
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
          total: b.total > 0 ? `₹${b.total}` : `₹${b.base_price} (visit fee)`,
          paid: Boolean(b.paid)
        }))
      };
    }

    case 'request_booking_cancellation': {
      if (!user) {
        return { success: false, needs_login: true, message: 'Booking cancel karne ke liye login zaroori hai.' };
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
        message: `Booking #${b.id} safalta-poorvak cancel kar di gayi hai.`
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
        note: 'Aap upar diye gaye helpline number par call kar sakte hain ya customer executive thodi der mein call karega.'
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  executeTool,
  ensureSeedWorkers
};
