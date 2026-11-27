// FixMate Phase 3 — Complete Customer Application Experience
// Implements all 26 Customer features: Home, Browse/Search Services, Categories,
// Search/Filter Providers, Provider Profiles & Reviews, Service Details, Booking Form,
// Date & Time Slots, Address & Map Pin Confirmation, Instructions, Confirmation Screen,
// My Bookings, Status, History, Cancellation, Payment History, Notifications, Support,
// Profile, Password & Language Settings, Logout.

(function () {
  function todayIso() {
    const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    return now.toISOString().slice(0, 10);
  }

  function addDaysIso(days) {
    const now = new Date(Date.now() + (5.5 * 60 * 60 * 1000) + days * 24 * 60 * 60 * 1000);
    return now.toISOString().slice(0, 10);
  }

  function formatDateNice(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  // Override grid card click -> opens Service Details first (while pick(i) stays direct to booking)
  window.grid = function (L) {
    if (!L.length) {
      return `<div style="grid-column: 1 / -1">${emptyBox('search', 'Service nahi mili', 'Ye service abhi nahi mili. Dusra naam try karo ya category chun lo.')}</div>`;
    }
    return L.map(([x, i]) => `
      <button class="sc" onclick="openServiceDetail(${i})">
        <div class="im">
          ${art(i)}
          <span class="rt">${ic('star', 11, true)} ${x.r || 4.8} (${x.k || '5k+'})</span>
        </div>
        <b>${esc(x.n)}</b>
        <span class="mut" style="font-size:12px">${esc(x.c)}</span>
        <span class="pr">${x.c === 'Home Tutor' ? 'Free demo class' : inr(x.p) + ' se <s>' + inr(Math.round(x.p * 1.3 / 10) * 10) + '</s>'}</span>
      </button>
    `).join('');
  };

  window.home = function () {
    const activeBooking = S.B.find((b) => !b.paid && b.status !== 'cancelled');
    const topProviders = (S.providers || []).slice(0, 4);

    return `<div class="hd">
      <div class="row">
        ${fmLogo({ size: 34, onDark: true })}
        <div class="ics">
          <button class="ic" onclick="go('notif')" title="Notifications" aria-label="Notifications">
            ${ic('bell', 18)}
            ${S.unreadNotifications > 0 ? `<span class="notif-dot">${S.unreadNotifications > 9 ? '9+' : S.unreadNotifications}</span>` : ''}
          </button>
          <button class="ic" onclick="go('pf')" title="Profile & Settings" aria-label="Profile">${ic('user', 18)}</button>
          <button class="ic" onclick="theme()" title="Toggle Light/Dark theme" aria-label="Toggle theme">${ic(isDarkTheme() ? 'sun' : 'moon', 18)}</button>
        </div>
      </div>
      <button class="loc" onclick="openAddressModal()" title="Change service address">
        ${ic('pin', 14)} <span>${esc(S.ad || CITY + ', Jharkhand')}</span> ${ic('chevronDown', 14)}
      </button>
      <div class="search-input-wrap">
        <span class="ico-search">${ic('search', 18)}</span>
        <input id="q" placeholder="${t('cust.search_ph')}" value="${esc(S.q)}" oninput="S.q=this.value;sr()">
      </div>
    </div>

    ${activeBooking ? `
      <div class="active-booking-banner" onclick="go('bk')">
        <div>
          <div style="font-size:11px;font-weight:800;color:var(--pri);text-transform:uppercase;letter-spacing:0.5px">${t('cust.active_booking')}</div>
          <b style="font-size:14.5px;color:var(--ink)">${esc(activeBooking.service)}</b>
          <div class="mut" style="font-size:12px">${esc(trStatus(activeBooking.status))} • Code: <b style="color:var(--pri)">${esc(activeBooking.start_code)}</b></div>
        </div>
        <button class="btn sm" style="width:auto;padding:7px 14px;font-size:12px">${t('cust.track')} ${ic('arrowRight', 14)}</button>
      </div>
    ` : ''}

    <div class="emergency-strip" onclick="toggleEmergency()">
      <div>
        <b>${ic('alertTriangle', 16)} ${S.emergency ? t('cust.emergency_on') : t('cust.emergency_off')}</b>
        <span>${S.emergency ? t('cust.emergency_sub_on') : t('cust.emergency_sub_off')}</span>
      </div>
      <span class="badge" style="background:#FFFFFF;color:#DC2626;font-weight:800">${S.emergency ? 'Normal' : 'Priority'}</span>
    </div>

    ${S.coupons.length ? `
      <div class="coupons-strip">
        ${S.coupons.map((c) => `
          <div class="coupon-pill" onclick="copyCoupon('${esc(c.code)}')" title="Click to copy coupon">
            ${ic('tag', 15)}
            <div>
              <b>${esc(c.code)}</b>
              <span style="font-size:11px;color:var(--ink);opacity:0.85;margin-left:4px">${esc(c.title)}</span>
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="trust">${ic('shieldCheck', 18)} <span>${t('cust.trust')}</span></div>

    <div class="ai-home-banner" onclick="window.FixMateAI&&window.FixMateAI.open('voice')">
      <div class="ai-banner-left">
        <div class="ai-banner-badge">${ic('sparkles', 13)} AI Voice & Chat Assistant</div>
        <div class="ai-banner-title">${t('cust.ai_title')}</div>
        <div class="ai-banner-sub">${t('cust.ai_sub')}</div>
      </div>
      <div class="ai-banner-mic-btn">${ic('mic', 22)}</div>
    </div>

    <div class="card">
      <b style="display:flex;align-items:center;gap:6px">${ic('sparkles', 16)} ${t('cust.finder_title')}</b>
      <div class="mut" style="margin-top:2px">${t('cust.ai_sub')}</div>
      <div class="row" style="margin-top:10px;gap:6px">
        <input id="pb" placeholder="${t('cust.search_ph')}" style="margin:0;flex:1" onkeydown="if(event.key==='Enter') diag()">
        <button id="mic-diag-btn" class="mic-finder-btn" onclick="voiceDiag()" title="Voice search" aria-label="Voice search problem">${ic('mic', 18)}</button>
        <button class="btn sm" onclick="diag()">${ic('search', 15)} ${t('cust.finder_btn')}</button>
      </div>
      <div id="dg"></div>
    </div>

    <div class="row" style="margin:18px 0 8px">
      <h2 style="margin:0">${t('cust.popular_cats')}</h2>
      <button class="btn sm ghost" style="padding:5px 12px;font-size:12px" onclick="S.svcsTab='services';go('svcs')">${t('cust.view_all')} ${ic('arrowRight', 13)}</button>
    </div>
    <div class="chips">
      ${['Sab', ...CATS].map((c) => `
        <button class="chip ${S.cat === c ? 'on' : ''}" onclick="S.cat='${c}';render()">${c}</button>
      `).join('')}
    </div>

    <div id="gr" class="grid">${S.catalogLoading ? window.FixMateIcons?.fmSkeleton('cards', 4) || '' : grid(fl())}</div>

    ${topProviders.length ? `
      <div class="row" style="margin:22px 0 10px">
        <h2 style="margin:0">Top Verified Providers</h2>
        <button class="btn sm ghost" style="padding:5px 12px;font-size:12px" onclick="S.svcsTab='providers';go('svcs')">Find Pros ${ic('arrowRight', 13)}</button>
      </div>
      <div class="prov-strip">
        ${topProviders.map((p) => `
          <button class="prov-mini-card" onclick="openProviderDetail(${p.id})">
            <div class="row" style="width:100%">
              <span class="av" style="width:40px;height:40px;font-size:15px">${esc((p.name || 'P')[0].toUpperCase())}</span>
              <span class="badge ${p.online ? 'ok' : ''}" style="font-size:10px">${p.online ? 'Online' : 'Offline'}</span>
            </div>
            <b style="margin-top:6px;font-size:14px">${esc(p.name)}</b>
            <div class="mut" style="font-size:12px">${esc(p.skill)} · ${p.experience_years}y exp</div>
            <div style="font-size:12px;font-weight:700;color:var(--pri);margin-top:4px;display:flex;align-items:center;gap:4px">
              ${ic('star', 13, true)} ${p.avg_rating > 0 ? p.avg_rating : 'New'} (${p.review_count}) · ${p.completed_jobs} jobs
            </div>
          </button>
        `).join('')}
      </div>
    ` : ''}`;
  };

  /* ========================================================
     SERVICES & VERIFIED PROVIDERS EXPLORER
     ======================================================== */
  window.svcs = function () {
    const tab = S.svcsTab || 'services';
    return `<div style="margin-top:16px">
      <div class="row" style="margin-bottom:12px">
        <div>
          <h2 style="margin:0;font-size:22px">${t('cust.explore_title')}</h2>
          <div class="mut" style="font-size:12.5px">${t('cust.explore_sub')}</div>
        </div>
      </div>

      <div class="seg-tabs">
        <button class="seg-tab ${tab === 'services' ? 'on' : ''}" onclick="S.svcsTab='services';render()">${ic('grid', 15)} ${t('cust.tab_services')} (${SV.length})</button>
        <button class="seg-tab ${tab === 'providers' ? 'on' : ''}" onclick="S.svcsTab='providers';loadProviders()">${ic('userCheck', 15)} ${t('cust.tab_providers')}</button>
      </div>

      ${tab === 'services' ? renderServicesCatalogTab() : renderProvidersTab()}
    </div>`;
  };

  function renderServicesCatalogTab() {
    let items = fl();
    if (S.svcSort === 'price_asc') items = [...items].sort((a, b) => a[0].p - b[0].p);
    else if (S.svcSort === 'price_desc') items = [...items].sort((a, b) => b[0].p - a[0].p);
    else if (S.svcSort === 'rating') items = [...items].sort((a, b) => (b[0].r || 4.8) - (a[0].r || 4.8));

    return `
      <div class="row" style="gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <div class="search-input-wrap" style="margin-top:0;flex:2;min-width:200px">
          <span class="ico-search">${ic('search', 16)}</span>
          <input id="svcs-q" placeholder="Search AC, Plumber, Electrician..." value="${esc(S.q)}" oninput="S.q=this.value;render()" style="margin:0">
        </div>
        <select style="flex:1;min-width:140px;margin:0" onchange="S.svcSort=this.value;render()" aria-label="Sort services">
          <option value="recommended" ${S.svcSort === 'recommended' ? 'selected' : ''}>Sort: Recommended</option>
          <option value="price_asc" ${S.svcSort === 'price_asc' ? 'selected' : ''}>Price: Low to High</option>
          <option value="price_desc" ${S.svcSort === 'price_desc' ? 'selected' : ''}>Price: High to Low</option>
          <option value="rating" ${S.svcSort === 'rating' ? 'selected' : ''}>Top Rated</option>
        </select>
      </div>

      <div class="chips">
        ${['Sab', ...CATS].map((c) => `
          <button class="chip ${S.cat === c ? 'on' : ''}" onclick="S.cat='${c}';render()">${c}</button>
        `).join('')}
      </div>

      <div class="grid">${grid(items)}</div>
    `;
  }

  window.loadProviders = async function () {
    render();
    try {
      const qs = new URLSearchParams();
      if (S.provCat && S.provCat !== 'Sab') qs.set('cat', S.provCat);
      if (S.provQ) qs.set('q', S.provQ);
      if (S.provOnlineOnly) qs.set('online', '1');
      if (S.provMinRating) qs.set('min_rating', String(S.provMinRating));
      if (S.provSort) qs.set('sort', S.provSort);
      const res = await api('GET', '/providers?' + qs.toString());
      S.providers = res.providers || [];
      render();
    } catch (e) {
      toast(e.message || 'Providers load nahi ho sake');
    }
  };

  function renderProvidersTab() {
    const list = (S.providers || []).filter((p) => {
      if (S.provCat && S.provCat !== 'Sab' && p.skill !== S.provCat) return false;
      if (S.provOnlineOnly && !p.online) return false;
      if (S.provMinRating && p.avg_rating < S.provMinRating) return false;
      if (S.provQ) {
        const q = S.provQ.toLowerCase();
        if (!`${p.name} ${p.skill} ${p.service_areas || ''}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    return `
      <div class="row" style="gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <div class="search-input-wrap" style="margin-top:0;flex:2;min-width:200px">
          <span class="ico-search">${ic('search', 16)}</span>
          <input placeholder="Search provider name, skill or area..." value="${esc(S.provQ)}" oninput="S.provQ=this.value;render()" style="margin:0">
        </div>
        <select style="flex:1;min-width:140px;margin:0" onchange="S.provSort=this.value;loadProviders()" aria-label="Sort providers">
          <option value="rating" ${S.provSort === 'rating' ? 'selected' : ''}>Top Rated</option>
          <option value="exp" ${S.provSort === 'exp' ? 'selected' : ''}>Most Experienced</option>
          <option value="jobs" ${S.provSort === 'jobs' ? 'selected' : ''}>Most Jobs Completed</option>
        </select>
      </div>

      <div class="row" style="gap:8px;margin-bottom:10px;flex-wrap:wrap;justify-content:flex-start">
        <button class="chip ${S.provOnlineOnly ? 'on' : ''}" onclick="S.provOnlineOnly=!S.provOnlineOnly;render()">${ic('radio', 13)} Online Only</button>
        <button class="chip ${S.provMinRating === 4.5 ? 'on' : ''}" onclick="S.provMinRating=S.provMinRating===4.5?0:4.5;render()">${ic('star', 13, true)} 4.5+ Rating</button>
        <button class="chip ${S.provMinRating === 4.0 ? 'on' : ''}" onclick="S.provMinRating=S.provMinRating===4.0?0:4.0;render()">${ic('star', 13, true)} 4.0+ Rating</button>
      </div>

      <div class="chips">
        ${['Sab', ...CATS].map((c) => `
          <button class="chip ${S.provCat === c ? 'on' : ''}" onclick="S.provCat='${c}';render()">${c}</button>
        `).join('')}
      </div>

      ${list.length ? list.map((p) => `
        <div class="card prov-list-card" onclick="openProviderDetail(${p.id})" style="cursor:pointer">
          <div class="row">
            <div class="row" style="justify-content:flex-start;gap:12px">
              <span class="av">${esc((p.name || 'P')[0].toUpperCase())}</span>
              <div>
                <b style="font-size:15.5px;display:flex;align-items:center;gap:6px">${esc(p.name)} <span class="badge ok" style="font-size:10px">${ic('shieldCheck', 11)} Verified</span></b>
                <div class="mut" style="font-size:12.5px">${esc(p.skill)} · ${p.experience_years} yrs exp</div>
                ${p.service_areas ? `<div class="mut" style="font-size:11.5px;display:flex;align-items:center;gap:4px;margin-top:2px">${ic('pin', 12)} ${esc(p.service_areas)}</div>` : ''}
              </div>
            </div>
            <div style="text-align:right">
              <span class="badge ${p.online ? 'ok' : ''}">${p.online ? 'Online' : 'Offline'}</span>
              <div style="font-weight:800;color:var(--pri);font-size:13px;margin-top:6px;display:flex;align-items:center;justify-content:flex-end;gap:4px">
                ${ic('star', 13, true)} ${p.avg_rating > 0 ? p.avg_rating : 'New'} <span class="mut">(${p.review_count})</span>
              </div>
            </div>
          </div>
          <div class="row" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bd);font-size:12px">
            <span class="mut">${p.completed_jobs} jobs completed</span>
            <span style="color:var(--pri);font-weight:700;display:inline-flex;align-items:center;gap:4px">View Profile & Reviews ${ic('chevronRight', 14)}</span>
          </div>
        </div>
      `).join('') : emptyBox('users', 'Koi matching provider nahi mila', 'Filter clear karke dobara search karein.')}
    `;
  }

  /* ========================================================
     SERVICE DETAILS SCREEN
     ======================================================== */
  window.openServiceDetail = async function (idx) {
    const x = SV[idx];
    if (!x) return;
    S.sv = idx;
    S.selectedServiceDetail = {
      id: x.id || idx + 1,
      cat: x.c,
      name: x.n,
      price: x.p,
      rating: x.r || 4.8,
      duration_minutes: 60,
      warranty_days: 30,
      verified_providers: null,
      online_providers: null
    };
    S.selectedServiceReviews = [];
    S.scr = 'svcDetail';
    render();
    scrollTo(0, 0);

    try {
      const res = await api('GET', `/services/${x.id || idx + 1}`);
      if (res && res.service) {
        S.selectedServiceDetail = res.service;
        S.selectedServiceReviews = res.reviews || [];
        if (S.scr === 'svcDetail') render();
      }
    } catch (e) {}
  };

  window.svcDetail = function () {
    const d = S.selectedServiceDetail || {};
    const x = SV[S.sv] || SV[0];
    const isTutor = (d.cat || x.c) === 'Home Tutor';
    const revs = S.selectedServiceReviews || [];
    const matchingPros = (S.providers || []).filter((p) => p.skill === (d.cat || x.c)).slice(0, 3);

    return `<button class="back" onclick="go('svcs')">${ic('arrowLeft', 16)} Services</button>

    <div class="card" style="margin-top:8px">
      <div class="row" style="align-items:flex-start">
        <div class="im sm" style="width:82px;height:82px">${art(S.sv)}</div>
        <div style="flex:1">
          <span class="badge">${esc(d.cat || x.c)}</span>
          <h2 style="margin:6px 0 4px;font-size:20px">${esc(d.name || x.n)}</h2>
          <div class="mut" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12.5px">
            <span style="display:inline-flex;align-items:center;gap:4px;color:var(--ink);font-weight:700">${ic('star', 14, true)} ${d.avg_rating || x.r || 4.8} (${d.review_count || 0} reviews)</span>
            <span style="display:inline-flex;align-items:center;gap:4px">${ic('clock', 13)} ~${d.duration_minutes || 60} mins</span>
          </div>
        </div>
      </div>

      <div class="row" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--bd)">
        <div>
          <div class="mut" style="font-size:11.5px">Transparent Base Labor</div>
          <b style="font-size:24px;color:var(--pri)">${isTutor ? 'Free Demo' : inr(d.price || x.p)}</b>
        </div>
        <button class="btn sm acc" style="padding:12px 22px" onclick="S.preferredWorker=null;pick(${S.sv})">
          ${ic('calendar', 16)} Book Service
        </button>
      </div>
    </div>

    <div class="card">
      <b style="display:flex;align-items:center;gap:6px;margin-bottom:8px">${ic('shieldCheck', 17)} What's Included & FixMate Guarantee</b>
      <div class="mut" style="font-size:13px;line-height:1.55">
        ${esc(d.description || `Complete ${d.cat || x.c} inspection, safety check, and repair by police-verified FixMate professionals.`)}
      </div>
      <div class="tl" style="margin-bottom:0">
        <div class="d">${ic('checkCircle', 15)} 4-digit OTP safety start code verification</div>
        <div class="d">${ic('checkCircle', 15)} ₹99 inspection visit fee waived on quote approval</div>
        <div class="d">${ic('checkCircle', 15)} ${d.warranty_days || 30}-day free service rework warranty</div>
        ${d.verified_providers != null ? `<div class="d">${ic('userCheck', 15)} ${d.verified_providers} verified providers (${d.online_providers || 0} online now)</div>` : ''}
      </div>
    </div>

    ${matchingPros.length ? `
      <h2>Available Verified Providers (${esc(d.cat || x.c)})</h2>
      ${matchingPros.map((p) => `
        <div class="card row" style="cursor:pointer" onclick="openProviderDetail(${p.id})">
          <div class="row" style="justify-content:flex-start;gap:10px">
            <span class="av" style="width:42px;height:42px;font-size:15px">${esc(p.name[0].toUpperCase())}</span>
            <div>
              <b>${esc(p.name)}</b>
              <div class="mut" style="font-size:12px">${p.experience_years}y exp · ${ic('star', 12, true)} ${p.avg_rating} · ${p.completed_jobs} jobs</div>
            </div>
          </div>
          <span class="badge ${p.online ? 'ok' : ''}">${p.online ? 'Online' : 'Offline'}</span>
        </div>
      `).join('')}
    ` : ''}

    <h2>Customer Reviews (${revs.length})</h2>
    ${revs.length ? revs.map((r) => `
      <div class="card">
        <div class="row">
          <b>${esc(r.customer_name || 'Customer')}</b>
          <span class="badge warn">${ic('star', 12, true)} ${r.rating}/5</span>
        </div>
        ${r.comment ? `<div style="font-size:13px;margin-top:6px">"${esc(r.comment)}"</div>` : ''}
      </div>
    `).join('') : emptyBox('star', 'No reviews yet', 'Be the first to review this service after completion.')}`;
  };

  /* ========================================================
     PROVIDER PROFILE & REVIEWS SCREEN
     ======================================================== */
  window.openProviderDetail = async function (providerId) {
    S.selectedProvider = (S.providers || []).find((p) => p.id === providerId) || { id: providerId, name: 'Provider', skill: '', verified: true };
    S.selectedProviderReviews = [];
    S.selectedProviderServices = [];
    S.scr = 'provider';
    render();
    scrollTo(0, 0);

    try {
      const res = await api('GET', `/providers/${providerId}`);
      if (res && res.provider) {
        S.selectedProvider = res.provider;
        S.selectedProviderReviews = res.reviews || [];
        S.selectedProviderServices = res.services || [];
        if (S.scr === 'provider') render();
      }
    } catch (e) {
      toast(e.message || 'Provider profile load nahi hua');
    }
  };

  window.bookWithProvider = function (provider, serviceId) {
    const idx = SV.findIndex((s) => s.id === serviceId || s.c === provider.skill);
    S.preferredWorker = provider;
    if (idx >= 0) {
      pick(idx);
      S.preferredWorker = provider;
      render();
    } else {
      go('svcs');
    }
  };

  window.providerDetail = function () {
    const p = S.selectedProvider || {};
    const revs = S.selectedProviderReviews || [];
    const svcs = S.selectedProviderServices || [];
    const defaultSvcId = svcs[0]?.id || (SV.find((s) => s.c === p.skill)?.id);

    return `<button class="back" onclick="S.svcsTab='providers';go('svcs')">${ic('arrowLeft', 16)} Back to Providers</button>

    <div class="card" style="margin-top:8px">
      <div class="row" style="align-items:flex-start">
        <div class="row" style="justify-content:flex-start;gap:14px">
          <div class="av" style="width:60px;height:60px;font-size:22px">${esc((p.name || 'P')[0].toUpperCase())}</div>
          <div>
            <b style="font-size:19px">${esc(p.name || 'Provider')}</b>
            <div class="mut" style="font-size:13px">${esc(p.skill || 'Service Specialist')}</div>
            <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
              <span class="badge ok">${ic('shieldCheck', 12)} ID & Police Verified</span>
              <span class="badge ${p.online ? 'ok' : ''}">${p.online ? 'Online Now' : 'Currently Offline'}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="wk-kpi-row" style="margin-top:16px;margin-bottom:10px">
        <div class="wk-kpi-card">
          <div class="wk-kpi-val">${p.avg_rating > 0 ? p.avg_rating : 'New'}</div>
          <div class="wk-kpi-lbl">Avg Rating</div>
        </div>
        <div class="wk-kpi-card">
          <div class="wk-kpi-val">${p.completed_jobs || 0}</div>
          <div class="wk-kpi-lbl">Jobs Done</div>
        </div>
        <div class="wk-kpi-card">
          <div class="wk-kpi-val">${p.experience_years || 0} yrs</div>
          <div class="wk-kpi-lbl">Experience</div>
        </div>
      </div>

      ${p.bio ? `<div class="mut" style="font-size:13px;line-height:1.5;margin-bottom:10px">${esc(p.bio)}</div>` : ''}
      ${p.service_areas ? `<div class="mut" style="font-size:12.5px;display:flex;align-items:center;gap:6px;margin-bottom:14px">
        ${ic('pin', 14)} <b>Service Areas:</b> ${esc(p.service_areas)}
      </div>` : ''}

      ${defaultSvcId ? `
        <button class="btn acc" onclick='bookWithProvider(${JSON.stringify({ id: p.id, name: p.name, skill: p.skill }).replace(/'/g, "&#39;")}, ${defaultSvcId})'>
          ${ic('calendar', 16)} Book ${esc(p.name)} Now
        </button>
      ` : ''}
    </div>

    ${svcs.length ? `
      <h2>Services by ${esc(p.name)}</h2>
      ${svcs.map((s) => `
        <div class="card row">
          <div>
            <b>${esc(s.name)}</b>
            <div class="mut" style="font-size:12px">${esc(s.cat)} · ${ic('star', 12, true)} ${s.rating || 4.8}</div>
          </div>
          <div class="row" style="gap:8px">
            <b style="color:var(--pri)">${inr(s.price)}</b>
            <button class="btn sm acc" onclick='bookWithProvider(${JSON.stringify({ id: p.id, name: p.name, skill: p.skill }).replace(/'/g, "&#39;")}, ${s.id})'>Book</button>
          </div>
        </div>
      `).join('')}
    ` : ''}

    <h2>Ratings & Reviews (${revs.length})</h2>
    ${revs.length ? revs.map((r) => `
      <div class="card">
        <div class="row">
          <b>${esc(r.customer_name || 'Customer')}</b>
          <span class="badge warn">${ic('star', 12, true)} ${r.rating}/5</span>
        </div>
        <div class="mut" style="font-size:11.5px;margin-top:2px">${esc(r.service_name || '')}</div>
        ${r.comment ? `<div style="font-size:13px;margin-top:6px">"${esc(r.comment)}"</div>` : ''}
      </div>
    `).join('') : emptyBox('star', 'No reviews yet', 'Customer feedback will appear here after completed bookings.')}`;
  };

  /* ========================================================
     ENHANCED BOOKING FORM (Date, Slots, Map Confirmation, Instructions)
     ======================================================== */
  const origPick = window.pick;
  window.pick = function (i) {
    if (typeof origPick === 'function') origPick(i);
    if (!S.bkDate) S.bkDate = todayIso();
    S.bkSelectedTime = '';
    S.bkInstructions = '';
    S.bkMapConfirmed = Boolean(S.customerLat && S.customerLng);
    loadAvailableSlots(S.bkDate);
  };

  window.loadAvailableSlots = async function (dateStr) {
    S.bkDate = dateStr || todayIso();
    try {
      const qs = new URLSearchParams({ date: S.bkDate });
      const x = SV[S.sv] || SV[0];
      if (x) qs.set('cat', x.c);
      if (S.preferredWorker?.id) qs.set('provider_id', String(S.preferredWorker.id));
      const res = await api('GET', '/bookings/available-slots?' + qs.toString());
      S.bkSlots = res.slots || [];
      const firstAvail = S.bkSlots.find((s) => s.available);
      if (!S.bkSelectedTime || !S.bkSlots.some((s) => s.label === S.bkSelectedTime && s.available)) {
        S.bkSelectedTime = firstAvail ? firstAvail.label : '';
      }
      if (S.scr === 'book') render();
    } catch (e) {}
  };

  let bookingMapInstance = null;
  let bookingMapMarker = null;

  window.locateAddressOnMap = async function () {
    const query = (S.ad || '').trim();
    if (query.length < 4) {
      toast(t('val.address'));
      return;
    }
    toast('Searching address on map...');
    try {
      const resp = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(query));
      const rows = await resp.json();
      if (Array.isArray(rows) && rows[0] && rows[0].lat && rows[0].lon) {
        S.customerLat = Number(Number(rows[0].lat).toFixed(6));
        S.customerLng = Number(Number(rows[0].lon).toFixed(6));
        S.bkMapConfirmed = true;
        render();
        toast('Address pinned on map! Drag marker if needed.');
        return;
      }
      toast('Exact address not found on map. Please tap the map or use GPS.');
    } catch (e) {
      toast('Map search unavailable. Tap anywhere on the map or use GPS.');
    }
  };

  window.afterCustomerRender = function () {
    if (S.scr === 'book') {
      initBookingMapPicker();
    }
  };

  function initBookingMapPicker() {
    const el = $('booking-map-picker');
    if (!el || !window.L) return;
    if (bookingMapInstance) {
      try { bookingMapInstance.remove(); } catch (e) {}
      bookingMapInstance = null;
      bookingMapMarker = null;
    }

    const lat = S.customerLat || 23.7957;
    const lng = S.customerLng || 86.4304;
    const map = window.L.map(el).setView([lat, lng], S.customerLat ? 15 : 13);
    bookingMapInstance = map;
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19
    }).addTo(map);

    const placePin = (pLat, pLng) => {
      if (bookingMapMarker) {
        bookingMapMarker.setLatLng([pLat, pLng]);
      } else {
        bookingMapMarker = window.L.marker([pLat, pLng], { draggable: true }).addTo(map);
        bookingMapMarker.on('dragend', () => {
          const pos = bookingMapMarker.getLatLng();
          S.customerLat = Number(pos.lat.toFixed(6));
          S.customerLng = Number(pos.lng.toFixed(6));
          S.bkMapConfirmed = true;
          const lbl = $('bk-coord-label');
          if (lbl) lbl.textContent = `Pinned: ${S.customerLat.toFixed(4)}, ${S.customerLng.toFixed(4)}`;
        });
      }
      S.customerLat = Number(pLat.toFixed(6));
      S.customerLng = Number(pLng.toFixed(6));
      S.bkMapConfirmed = true;
      const lbl = $('bk-coord-label');
      if (lbl) lbl.textContent = `Pinned: ${S.customerLat.toFixed(4)}, ${S.customerLng.toFixed(4)}`;
    };

    if (S.customerLat && S.customerLng) {
      placePin(S.customerLat, S.customerLng);
    }

    map.on('click', (e) => {
      placePin(e.latlng.lat, e.latlng.lng);
      toast('Service location pin updated on map');
    });
  }

  window.book = function () {
    const x = SV[S.sv] || SV[0];
    const isTutor = x.c === 'Home Tutor';
    const matchingAmc = (S.myAmcSubs || []).find((s) => s.status === 'active' && s.category === x.c && Number(s.visits_remaining) > 0);
    const useAmc = Boolean(S.selectedAmcSubId && matchingAmc && S.selectedAmcSubId === matchingAmc.id);
    const emergencyFee = S.emergency ? 99 : 0;
    const discount = useAmc ? x.p : (S.appliedCoupon ? S.appliedCoupon.discount_amount : 0);
    const estimatedTotal = Math.max(0, x.p + emergencyFee - discount);
    const avail = S.emergencyAvail;
    const curDate = S.bkDate || todayIso();
    const slots = S.bkSlots && S.bkSlots.length ? S.bkSlots : (isTutor ? TS : SL).map((l, idx) => ({ id: String(idx), label: l, available: true }));

    return `<button class="back" onclick="go('svcDetail')">${ic('arrowLeft', 16)} Service Details</button>

    <div class="card row" style="justify-content:flex-start;margin-top:10px">
      <div class="im sm" style="width:70px;height:70px;flex-shrink:0">${art(S.sv)}</div>
      <div>
        <b style="font-size:16px">${esc(x.n)}</b>
        <div class="mut" style="display:flex;align-items:center;gap:6px">${esc(x.c)} • ${ic('star', 13, true)} ${x.r || 4.8}</div>
        <div style="font-weight:800;color:var(--pri);margin-top:2px">${isTutor ? 'Free Demo Class' : inr(x.p)}</div>
      </div>
    </div>

    ${S.preferredWorker ? `
      <div class="card row" style="border-color:var(--pri);background:var(--pri-soft)">
        <div>
          <b style="color:var(--pri);display:flex;align-items:center;gap:6px">${ic('userCheck', 15)} Preferred Provider: ${esc(S.preferredWorker.name)}</b>
          <div class="mut" style="font-size:12px">Verified ${esc(S.preferredWorker.skill)} specialist</div>
        </div>
        <button class="btn sm ghost" onclick="S.preferredWorker=null;render()">Change</button>
      </div>
    ` : ''}

    ${S.emergency ? `
      <div class="fm-alert ${avail && !avail.available ? 'warning' : 'error'}" style="margin:12px 0">
        ${ic('alertTriangle', 18)}
        <div>
        ${avail
          ? (avail.available
              ? `<b>Emergency Confirmed Available:</b> ${avail.online_technicians} verified technician(s) abhi online hain! Express fee: <b>₹99</b>.`
              : `<b>No Emergency Tech Online:</b> Abhi ${esc(x.c)} mein koi technician online nahi hai. Kripya normal slot chunein ya Emergency off karein.`)
          : '<b>Emergency Priority Mode:</b> Live technician availability check ki ja rahi hai (₹99 express fee).'}
        </div>
      </div>
    ` : ''}

    ${matchingAmc ? `
      <div class="card row" style="border-color:var(--pri);background:var(--pri-soft);margin:10px 0;cursor:pointer" onclick="S.selectedAmcSubId=${useAmc ? 'null' : matchingAmc.id};render()">
        <div>
          <b style="color:var(--pri);display:flex;align-items:center;gap:6px">${ic('shieldCheck', 16)} Active AMC Plan: ${esc(matchingAmc.plan_name)}</b>
          <div class="mut" style="font-size:12px">${matchingAmc.visits_remaining} free visit(s) remaining</div>
        </div>
        <input type="checkbox" ${useAmc ? 'checked' : ''} style="width:auto;margin:0;pointer-events:none">
      </div>
    ` : ''}

    <h2 style="display:flex;align-items:center;gap:7px">${ic('calendar', 18)} ${t('cust.date_select')}</h2>
    <div class="chips" style="margin-bottom:8px">
      ${[0, 1, 2].map((offset) => {
        const dIso = addDaysIso(offset);
        const label = offset === 0 ? 'Today' : (offset === 1 ? 'Tomorrow' : formatDateNice(dIso));
        return `<button class="chip ${curDate === dIso ? 'on' : ''}" onclick="loadAvailableSlots('${dIso}')">${label}</button>`;
      }).join('')}
    </div>
    <input type="date" min="${todayIso()}" value="${esc(curDate)}" onchange="loadAvailableSlots(this.value)" aria-label="${t('cust.date_select')}">

    <h2 style="display:flex;align-items:center;gap:7px">${ic('clock', 18)} ${t('cust.slots_select')}</h2>
    <div class="slot-grid">
      ${slots.map((s) => `
        <button class="slot-btn ${S.bkSelectedTime === s.label ? 'on' : ''}" ${!s.available ? 'disabled' : ''} onclick="S.bkSelectedTime='${esc(s.label)}';render()">
          <span>${esc(s.label)}</span>
          ${!s.available ? `<small>${esc(s.reason || 'Unavailable')}</small>` : ''}
        </button>
      `).join('')}
    </div>

    ${S.familyMembers && S.familyMembers.length ? `
      <h2>Kis ke liye book kar rahe hain?</h2>
      <div class="chips" style="margin-bottom:8px">
        <button class="chip ${!S.selectedFamilyMember ? 'on' : ''}" onclick="S.selectedFamilyMember='';render()">${ic('user', 13)} Myself</button>
        ${S.familyMembers.map((m) => `
          <button class="chip ${S.selectedFamilyMember === m.member_name ? 'on' : ''}" onclick="S.selectedFamilyMember='${esc(m.member_name)}';render()">
            ${ic('users', 13)} ${esc(m.member_name)} (${esc(m.relation)})
          </button>
        `).join('')}
      </div>
    ` : ''}

    <h2 style="display:flex;align-items:center;gap:7px">${ic('pin', 18)} ${t('cust.address_select')}</h2>
    ${S.addresses.length ? `
      <div class="chips" style="margin-bottom:8px">
        ${S.addresses.map((a) => {
          const full = a.address_line + (a.landmark ? ', ' + a.landmark : '') + ', ' + a.city;
          const isSel = S.ad === full;
          const addrIcon = a.label === 'Home' ? 'home' : (a.label === 'Work' ? 'building' : 'pin');
          return `<button class="chip ${isSel ? 'on' : ''}" onclick="selectAddress(${JSON.stringify(a).replace(/"/g, '&quot;')});S.scr='book';render()">
            ${ic(addrIcon, 13)} ${esc(a.label)}
          </button>`;
        }).join('')}
        <button class="chip" onclick="openAddAddressModal()">${ic('plus', 13)} Naya Address</button>
      </div>
    ` : ''}
    <input id="ad" placeholder="House / Flat no, street, landmark, city" value="${esc(S.ad)}" oninput="S.ad=this.value;S.bkMapConfirmed=false">

    <div class="card" style="padding:12px;margin-bottom:14px">
      <div class="row" style="margin-bottom:8px;flex-wrap:wrap;gap:6px">
        <b style="font-size:13px;display:flex;align-items:center;gap:6px">${ic('map', 15)} ${t('cust.map_pin_title')}</b>
        <div class="row" style="gap:6px">
          <button class="btn sm ghost" style="width:auto;padding:5px 10px;font-size:11.5px" onclick="locateAddressOnMap()">${ic('search', 13)} ${t('cust.find_address_map')}</button>
          <button class="btn sm ghost" style="width:auto;padding:5px 10px;font-size:11.5px" onclick="captureCustomerGps()">${ic('locate', 13)} ${t('cust.use_gps')}</button>
        </div>
      </div>
      <div id="booking-map-picker" class="live-map-box" style="height:185px"></div>
      <div class="row" style="margin-top:8px">
        <span id="bk-coord-label" class="mut" style="font-size:11.5px">
          ${S.customerLat ? `${t('cust.pinned_coords')}: ${S.customerLat.toFixed(4)}, ${S.customerLng.toFixed(4)}` : t('cust.pin_help')}
        </span>
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;cursor:pointer">
          <input type="checkbox" style="width:auto;margin:0" ${S.bkMapConfirmed ? 'checked' : ''} onchange="S.bkMapConfirmed=this.checked">
          ${t('cust.confirmed_pin')}
        </label>
      </div>
    </div>

    <h2>Booking Instructions & Issue Details</h2>
    <textarea id="bk-desc" placeholder="Describe issue or instructions for technician (gate code, landmark, appliance model...)" rows="2" oninput="S.bookingIssue=this.value;S.bkInstructions=this.value">${esc(S.bkInstructions || S.bookingIssue)}</textarea>

    <div class="photo-upload-wrap">
      ${S.bookingPhoto ? `
        <img src="${S.bookingPhoto}" class="photo-preview-thumb" alt="Issue photo">
        <button class="btn sm ghost" style="width:auto;padding:5px 12px;font-size:12px;color:var(--bad)" onclick="removePhoto()">${ic('trash', 14)} Photo Hatayein</button>
      ` : `
        <label for="bk-file" style="cursor:pointer;display:block">
          <div style="margin-bottom:6px;color:var(--pri)">${ic('camera', 26)}</div>
          <b>Dikkat ki photo jodein (Optional)</b>
          <div class="mut" style="font-size:12px">Technician ko pehle samajhne mein asani hogi</div>
        </label>
        <input type="file" id="bk-file" accept="image/*" style="display:none" onchange="onPhotoSelected(event)">
      `}
    </div>

    <h2 style="display:flex;align-items:center;gap:7px">${ic('tag', 18)} Offers & Coupons</h2>
    ${S.appliedCoupon ? `
      <div class="card row" style="border-color:var(--ok);background:var(--ok-soft)">
        <div>
          <b style="color:var(--ok);display:flex;align-items:center;gap:6px">${ic('checkCircle', 15)} ${esc(S.appliedCoupon.code)} Applied!</b>
          <div class="mut" style="font-size:12px">${esc(S.appliedCoupon.title)} (-${inr(S.appliedCoupon.discount_amount)})</div>
        </div>
        <button class="btn sm ghost" style="width:auto;padding:4px 10px;font-size:12px" onclick="removeAppliedCoupon()">Hatao</button>
      </div>
    ` : `
      <div class="row" style="margin-bottom:14px">
        <input id="cpn-input" placeholder="Coupon Code (e.g. WELCOME50)" style="margin:0;text-transform:uppercase">
        <button class="btn sm" style="width:auto;padding:12px 18px" onclick="applyCouponCode()">Apply</button>
      </div>
    `}

    <h2>Transparent Price Estimate</h2>
    <div class="price-breakdown">
      <div class="price-line"><span>Inspection / Visiting Fee</span><span>₹99 <small class="mut">(Bill mein adjust)</small></span></div>
      <div class="price-line"><span>Service Base Labor</span><span>${isTutor ? 'Free Demo' : inr(x.p)}</span></div>
      ${emergencyFee > 0 ? `<div class="price-line" style="color:var(--bad)"><span>Priority Emergency Dispatch Fee</span><span>+${inr(emergencyFee)}</span></div>` : ''}
      ${discount > 0 ? `<div class="price-line" style="color:var(--ok);font-weight:700"><span>${useAmc ? `AMC Benefit (${esc(matchingAmc.plan_name)})` : `Coupon Discount (${esc(S.appliedCoupon.code)})`}</span><span>-${inr(discount)}</span></div>` : ''}
      <div class="price-line total"><span>Estimated Total (Pay after service)</span><span>${isTutor ? 'Free Demo' : inr(estimatedTotal)}</span></div>
    </div>

    <h2>${t('cust.payment_after')}</h2>
    <div class="chips">
      <button class="chip ${S.pay === 'wallet' ? 'on' : ''}" onclick="S.pay='wallet';render()">${ic('wallet', 14)} ${t('cust.pay_wallet')} (${inr(S.w)})</button>
      <button class="chip ${S.pay === 'cash' ? 'on' : ''}" onclick="S.pay='cash';render()">${ic('checkCircle', 14)} ${t('cust.pay_cash')}</button>
      <button class="chip ${S.pay === 'razorpay' ? 'on' : ''}" onclick="S.pay='razorpay';render()">${ic('creditCard', 14)} ${t('cust.pay_online')}</button>
    </div>

    <button class="btn acc" style="margin-top:16px" onclick="doBook()">
      ${ic('checkCircle', 17)} ${isTutor ? 'Confirm Free Demo' : `${t('cust.confirm_booking')} (${inr(estimatedTotal)})`}
    </button>`;
  };

  window.doBook = function () {
    if (!S.ad.trim()) {
      toast(t('val.address'));
      return;
    }
    if (!S.bkMapConfirmed) {
      toast(t('val.location_confirm'));
      const mapEl = $('booking-map-picker');
      if (mapEl && typeof mapEl.scrollIntoView === 'function') {
        mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
    if (!S.bkSelectedTime && !(SL[S.slot])) {
      toast(t('val.slot'));
      return;
    }
    const x = SV[S.sv] || SV[0];
    const dIso = S.bkDate || todayIso();
    const tLabel = S.bkSelectedTime || (x.c === 'Home Tutor' ? TS : SL)[S.slot];
    const slotText = `${formatDateNice(dIso)} · ${tLabel}`;
    const issueDesc = ($('bk-desc')?.value || S.bookingIssue || '').trim();
    const couponCode = S.appliedCoupon ? S.appliedCoupon.code : null;

    act(async () => {
      const res = await api('POST', '/bookings', {
        serviceId: x.id || S.sv + 1,
        slot: slotText,
        scheduled_date: dIso,
        scheduled_time: tLabel,
        address: S.ad.trim(),
        formatted_address: S.ad.trim(),
        pay: S.pay,
        issue_desc: issueDesc,
        instructions: issueDesc,
        photo_url: S.bookingPhoto || null,
        coupon_code: couponCode,
        is_emergency: S.emergency ? 1 : 0,
        customer_lat: S.customerLat,
        customer_lng: S.customerLng,
        family_member_name: S.selectedFamilyMember || null,
        amc_subscription_id: S.selectedAmcSubId || null,
        preferred_worker_id: S.preferredWorker?.id || null
      });
      S.selectedAmcSubId = null;
      S.selectedFamilyMember = '';
      S.preferredWorker = null;
      S.lastCreatedBooking = res.booking;
      await refresh();
      S.scr = 'bkConfirm';
      render();
      scrollTo(0, 0);
    });
  };

  window.bkConfirm = function () {
    const b = S.lastCreatedBooking;
    if (!b) return bk();
    return `<div class="card" style="margin-top:20px;text-align:center;padding:28px 20px">
      <div class="onboarding-art-badge" style="width:78px;height:78px;margin:0 auto 14px;color:var(--ok);background:var(--ok-soft)">
        ${ic('checkCircle', 42)}
      </div>
      <span class="badge ok">Booking Confirmed</span>
      <h2 style="font-size:24px;margin:10px 0 4px">Booking #${b.id} Confirmed!</h2>
      <div class="mut" style="font-size:13.5px">${esc(b.service)} · ${esc(b.slot)}</div>

      <div class="otp" style="margin:18px auto;max-width:260px">${esc(b.start_code)}</div>
      <div class="mut" style="font-size:12px;margin-bottom:16px">Share this 4-digit safety code with the verified provider when they arrive.</div>

      <div class="card" style="background:var(--soft);border:none;text-align:left;font-size:13px">
        <div class="row" style="margin-bottom:6px"><span class="mut">Service Address</span><b>${esc(b.address)}</b></div>
        <div class="row" style="margin-bottom:6px"><span class="mut">Payment Method</span><b style="text-transform:capitalize">${esc(b.pay)}</b></div>
        <div class="row"><span class="mut">Status</span><b style="color:var(--pri)">${esc(b.label)}</b></div>
      </div>

      <div class="row" style="margin-top:16px;gap:10px">
        <button class="btn acc" style="flex:1" onclick="go('bk')">${ic('list', 16)} My Bookings</button>
        <button class="btn ghost" style="flex:1" onclick="go('home')">${ic('home', 16)} Back Home</button>
      </div>
    </div>`;
  };

  /* ========================================================
     BOOKINGS TAB (Active | History | Payment History)
     ======================================================== */
  window.cancelBook = function (id) {
    const reason = prompt('Cancellation reason (optional):', 'Schedule changed');
    if (reason === null) return;
    post(id, 'cancel', { reason }, 'Booking cancel kar di gayi');
  };

  window.bk = function () {
    const tab = S.bkTab || 'active';
    const activeList = S.B.filter((b) => !['completed', 'closed', 'cancelled'].includes(b.status) || (!b.paid && b.status !== 'cancelled'));
    const historyList = S.B.filter((b) => (['completed', 'closed'].includes(b.status) && b.paid) || b.status === 'cancelled');
    const payments = S.paymentsHistory || [];

    return `<div style="margin-top:16px">
      <div class="row" style="margin-bottom:12px">
        <h2 style="margin:0;font-size:22px">${t('cust.my_bookings')}</h2>
        <button class="btn sm ghost" onclick="go('mo')">${ic('wallet', 14)} ${t('cust.pay_wallet')}: ${inr(S.w)}</button>
      </div>

      <div class="seg-tabs">
        <button class="seg-tab ${tab === 'active' ? 'on' : ''}" onclick="S.bkTab='active';render()">${t('cust.tab_active')} (${activeList.length})</button>
        <button class="seg-tab ${tab === 'history' ? 'on' : ''}" onclick="S.bkTab='history';render()">${t('cust.tab_history')} (${historyList.length})</button>
        <button class="seg-tab ${tab === 'payments' ? 'on' : ''}" onclick="S.bkTab='payments';refresh().then(render)">${t('cust.tab_payments')} (${payments.length})</button>
      </div>

      ${tab === 'active' ? (activeList.length ? activeList.map(bkc).join('') : emptyBox('list', t('cust.empty_bookings'), t('cust.empty_bookings_desc'), `<button class="btn acc" onclick="go('svcs')">${t('nav.services')}</button>`)) : ''}
      ${tab === 'history' ? (historyList.length ? historyList.map(bkc).join('') : emptyBox('clock', t('cust.empty_history'), t('cust.empty_bookings_desc'))) : ''}
      ${tab === 'payments' ? renderPaymentHistory(payments) : ''}
    </div>`;
  };

  function renderPaymentHistory(payments) {
    const wTx = S.walletTxHistory && S.walletTxHistory.length ? S.walletTxHistory : (S.tx || []).map((t) => ({ label: t[0], amount: t[1] }));
    return `
      <h2 style="margin-top:8px">Booking Payments (${payments.length})</h2>
      ${payments.length ? payments.map((p) => `
        <div class="card">
          <div class="row">
            <div>
              <b>#${p.booking_id} ${esc(p.service_name)}</b>
              <div class="mut" style="font-size:12px">${esc(p.category)} · ${String(p.payment_method || '').toUpperCase()}</div>
            </div>
            <div style="text-align:right">
              <b style="font-size:16px;color:var(--pri)">${inr(p.amount)}</b><br>
              <span class="badge ${p.paid ? 'ok' : 'warn'}" style="font-size:10.5px">${p.paid ? 'Paid' : 'Pending'}</span>
            </div>
          </div>
          ${p.gateway_payment_id ? `<div class="mut" style="font-size:11px;margin-top:6px">Razorpay Ref: ${esc(p.gateway_payment_id)}</div>` : ''}
          ${['completed', 'closed'].includes(p.booking_status) ? `
            <button class="btn sm ghost" style="margin-top:8px" onclick="openInvoiceModal(${p.booking_id})">${ic('fileText', 14)} View Tax Invoice</button>
          ` : ''}
        </div>
      `).join('') : emptyBox('creditCard', 'No booking payments yet', 'Completed bookings ke payments aur receipts yahan dikhenge.')}

      <h2 style="margin-top:18px">Wallet Ledger (${wTx.length})</h2>
      ${wTx.length ? wTx.map((t) => `
        <div class="card row" style="margin-bottom:8px">
          <div>
            <b>${esc(t.label)}</b>
            ${t.created_at ? `<div class="mut" style="font-size:11px">${new Date(t.created_at).toLocaleDateString('en-IN')}</div>` : ''}
          </div>
          <b style="color:${t.amount < 0 ? 'var(--bad)' : 'var(--ok)'}">${t.amount < 0 ? '-' : '+'}${inr(Math.abs(t.amount))}</b>
        </div>
      `).join('') : '<div class="card mut">No wallet transactions yet.</div>'}
    `;
  }

  /* ========================================================
     DEDICATED NOTIFICATIONS SCREEN
     ======================================================== */
  window.notif = function () {
    const list = S.notifications || [];
    return `<div style="margin-top:16px">
      <div class="row" style="margin-bottom:14px">
        <div>
          <h2 style="margin:0;font-size:22px">${t('cust.notifications_title')}</h2>
          <div class="mut" style="font-size:12.5px">${S.unreadNotifications || 0} unread alerts</div>
        </div>
        ${list.length ? `<button class="btn sm ghost" onclick="markAllNotificationsRead()">${ic('check', 14)} ${t('cust.mark_all_read')}</button>` : ''}
      </div>
      ${list.length ? list.map((n) => `
        <div class="card" style="margin-bottom:10px;background:${n.is_read ? 'var(--card)' : 'var(--pri-soft)'};border-color:${n.is_read ? 'var(--bd)' : 'var(--pri)'};cursor:${n.booking_id ? 'pointer' : 'default'}" ${n.booking_id ? `onclick="S.bkTab='active';go('bk')"` : ''}>
          <div class="row">
            <b style="font-size:14px;display:flex;align-items:center;gap:6px">${ic('bell', 15)} ${esc(n.title)}</b>
            <span class="mut" style="font-size:11px">${new Date(n.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div class="mut" style="font-size:13px;margin-top:5px">${esc(n.body)}</div>
        </div>
      `).join('') : emptyBox('bell', t('cust.empty_notifications'), '')}
    </div>`;
  };

  /* ========================================================
     ENHANCED PROFILE, PASSWORD, LANGUAGE & SUPPORT SCREEN
     ======================================================== */
  window.saveCustomerProfileSettings = function () {
    const name = ($('pf-name')?.value || '').trim();
    const email = ($('pf-email')?.value || '').trim();
    const language = $('pf-lang')?.value || 'en';
    if (name.length < 2) {
      toast('Name must be at least 2 characters');
      return;
    }
    act(async () => {
      const res = await api('PUT', '/me/profile', { name, email, language });
      S.user = res.user;
      if (res.user?.language && typeof setLang === 'function') await setLang(res.user.language, false);
      try {
        const stored = JSON.parse(localStorage.getItem('fm_auth') || '{}');
        stored.u = res.user;
        localStorage.setItem('fm_auth', JSON.stringify(stored));
      } catch (e) {}
      render();
      toast(res.message || t('val.profile_saved'));
    });
  };

  window.saveCustomerPassword = function () {
    const cur = $('pf-cur-pw')?.value || '';
    const next = $('pf-new-pw')?.value || '';
    const conf = $('pf-conf-pw')?.value || '';
    if (next.length < 8) {
      toast('New password must be at least 8 characters');
      return;
    }
    if (next !== conf) {
      toast('Passwords do not match');
      return;
    }
    act(async () => {
      const res = await api('PUT', '/me/password', { current_password: cur || undefined, new_password: next });
      S.user.has_password = true;
      render();
      toast(res.message || 'Password updated');
    });
  };

  window.pf = function () {
    const u = S.user || { name: 'Customer', phone: '9876543210', id: 1, language: 'en' };
    const tab = S.pfTab || 'account';

    return `<div style="margin-top:16px">
      <div class="card row" style="justify-content:space-between">
        <div class="row" style="justify-content:flex-start">
          <div class="av">${esc((u.name || 'C')[0].toUpperCase())}</div>
          <div>
            <b style="font-size:17px">${esc(u.name)}</b>
            <div class="mut">+91 ${esc(u.phone)} ${u.email ? '· ' + esc(u.email) : ''}</div>
            <span class="badge" style="margin-top:4px">${esc(u.role)} · Lang: ${esc((u.language || 'en').toUpperCase())}</span>
          </div>
        </div>
        <button class="btn sm ghost" onclick="theme()" title="Switch theme">${ic(isDarkTheme() ? 'sun' : 'moon', 15)} ${isDarkTheme() ? 'Light' : 'Dark'}</button>
      </div>

      <div class="seg-tabs">
        <button class="seg-tab ${tab === 'account' ? 'on' : ''}" onclick="S.pfTab='account';render()">Account & Security</button>
        <button class="seg-tab ${tab === 'hub' ? 'on' : ''}" onclick="S.pfTab='hub';render()">Plans & Addresses</button>
        <button class="seg-tab ${tab === 'support' ? 'on' : ''}" onclick="S.pfTab='support';render()">Support (${(S.myComplaints || []).length})</button>
      </div>

      ${tab === 'account' ? `
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:16px;display:flex;align-items:center;gap:6px">${ic('user', 16)} ${t('cust.profile_settings')} & ${t('cust.lang_settings')}</h3>
          <div style="margin-bottom:12px">${langSelectorHtml()}</div>
          <label style="font-size:12.5px;font-weight:700">${t('auth.full_name')}</label>
          <input id="pf-name" value="${esc(u.name || '')}" style="margin:4px 0 10px">
          <label style="font-size:12.5px;font-weight:700">Email Address (Optional)</label>
          <input id="pf-email" type="email" placeholder="you@example.com" value="${esc(u.email || '')}" style="margin:4px 0 10px">
          <label style="font-size:12.5px;font-weight:700">${t('cust.lang_settings')}</label>
          <select id="pf-lang" style="margin:4px 0 14px" onchange="setLang(this.value)">
            <option value="en" ${(u.language || 'en') === 'en' ? 'selected' : ''}>English</option>
            <option value="hi" ${u.language === 'hi' ? 'selected' : ''}>Hindi (हिन्दी)</option>
            <option value="hinglish" ${u.language === 'hinglish' ? 'selected' : ''}>Hinglish</option>
          </select>
          <button class="btn acc" onclick="saveCustomerProfileSettings()">${ic('checkCircle', 16)} ${t('common.save')}</button>
        </div>

        <div class="card">
          <h3 style="margin:0 0 12px;font-size:16px;display:flex;align-items:center;gap:6px">${ic('lock', 16)} ${t('cust.password_mgmt')}</h3>
          ${u.has_password ? `
            <label style="font-size:12.5px;font-weight:700">Current Password</label>
            <input id="pf-cur-pw" type="password" placeholder="Enter current password" style="margin:4px 0 10px">
          ` : `<div class="fm-alert info" style="margin-top:0">${ic('key', 15)} Set an account password (minimum 8 characters) for added security.</div>`}
          <label style="font-size:12.5px;font-weight:700">New Password</label>
          <input id="pf-new-pw" type="password" placeholder="Minimum 8 characters" style="margin:4px 0 10px">
          <label style="font-size:12.5px;font-weight:700">Confirm New Password</label>
          <input id="pf-conf-pw" type="password" placeholder="Repeat new password" style="margin:4px 0 14px">
          <button class="btn ghost" onclick="saveCustomerPassword()">${ic('key', 15)} ${u.has_password ? 'Change Password' : 'Set Password'}</button>
        </div>

        <div class="card row">
          <div>
            <b>FixMate Wallet</b>
            <div class="mut">Balance: <b style="color:var(--pri)">${inr(S.w)}</b></div>
          </div>
          <button class="btn sm acc" onclick="go('mo')">${ic('wallet', 14)} Open Wallet</button>
        </div>
      ` : ''}

      ${tab === 'hub' ? `
        <div class="hub-grid">
          <button class="hub-tile" onclick="openAmcModal()">
            <span class="hub-tile-ico">${ic('shieldCheck', 18)}</span>
            <b>AMC Annual Plans</b>
            <span class="mut">${(S.myAmcSubs || []).filter((x) => x.status === 'active').length} Active Plan(s)</span>
          </button>
          <button class="hub-tile" onclick="openWarrantyModal()">
            <span class="hub-tile-ico">${ic('award', 18)}</span>
            <b>Service Warranty</b>
            <span class="mut">History & Coverage</span>
          </button>
          <button class="hub-tile" onclick="openFamilyModal()">
            <span class="hub-tile-ico">${ic('users', 18)}</span>
            <b>Family Accounts</b>
            <span class="mut">${(S.familyMembers || []).length} Member(s)</span>
          </button>
          <button class="hub-tile" onclick="openRemindersModal()">
            <span class="hub-tile-ico">${ic('clock', 18)}</span>
            <b>Service Reminders</b>
            <span class="mut">${(S.reminders || []).filter((r) => r.enabled).length} Scheduled</span>
          </button>
        </div>
        <button class="btn sm ghost" style="margin-top:10px" onclick="openPincodeModal()">${ic('pin', 15)} Check Serviceable Pincode Area</button>

        <div class="row" style="margin-top:20px">
          <h2 style="margin:0">Saved Addresses</h2>
          <button class="btn sm" style="width:auto;padding:7px 14px;font-size:12px" onclick="openAddAddressModal()">${ic('plus', 14)} Add New</button>
        </div>
        ${S.addresses.length ? S.addresses.map((a) => {
          const full = a.address_line + (a.landmark ? ', ' + a.landmark : '') + ', ' + a.city;
          const addrIcon = a.label === 'Home' ? 'home' : (a.label === 'Work' ? 'building' : 'pin');
          return `<div class="addr-item ${S.ad === full ? 'selected' : ''}">
            <div>
              <div style="font-weight:700;font-size:14px;display:flex;align-items:center;gap:6px">${ic(addrIcon, 15)} ${esc(a.label)} ${a.is_default ? '<span class="badge ok" style="font-size:10px">Default</span>' : ''}</div>
              <div class="mut" style="font-size:13px;margin-top:2px">${esc(a.address_line)}</div>
              <div class="mut" style="font-size:11px">${esc(a.landmark || '')} ${esc(a.city)} - ${esc(a.pincode)}</div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn sm ghost" style="width:auto;padding:4px 10px;font-size:11px" onclick="selectAddress(${JSON.stringify(a).replace(/"/g, '&quot;')})">Use</button>
              <button class="btn sm ghost" style="width:auto;padding:4px 8px;font-size:11px;color:var(--bad)" onclick="deleteAddress(${a.id})" title="Delete address">${ic('trash', 14)}</button>
            </div>
          </div>`;
        }).join('') : emptyBox('pin', 'Koi saved address nahi', '"+ Add New" par tap karke address save karein.')}

        <h2 style="margin-top:18px">Refer & Earn</h2>
        <div class="card row">
          <div>
            <div>Aapka Referral Code:</div>
            <b style="font-size:18px;color:var(--pri)">FIX${String(u.id || 1).padStart(4, '0')}</b>
            <div class="mut" style="font-size:12px">Dost ko pehli booking par ₹50 cashback, aur aapko bhi ₹50.</div>
          </div>
          <button class="btn sm" style="width:auto;padding:8px 14px" onclick="copyCoupon('FIX${String(u.id || 1).padStart(4, '0')}')">${ic('share', 14)} Share</button>
        </div>
      ` : ''}

      ${tab === 'support' ? `
        <div class="card">
          <div class="row" style="margin-bottom:10px">
            <div>
              <b style="font-size:16px">FixMate Customer Support</b>
              <div class="mut" style="font-size:12.5px">24x7 booking assistance, refunds & dispute resolution</div>
            </div>
            <button class="btn sm acc" onclick="openComplaintModal(null)">${ic('plus', 14)} New Ticket</button>
          </div>
          <div class="row" style="gap:8px">
            <a href="tel:+917209612650" class="btn sm ghost" style="flex:1;text-decoration:none">${ic('phone', 14)} Helpline</a>
            <button class="btn sm ghost" style="flex:1" onclick="window.FixMateAI&&window.FixMateAI.open('chat')">${ic('messageSquare', 14)} AI Support Chat</button>
          </div>
        </div>

        <h2>My Support Tickets (${(S.myComplaints || []).length})</h2>
        ${(S.myComplaints || []).length ? (S.myComplaints || []).map((c) => `
          <div class="card">
            <div class="row">
              <b>Ticket #${c.id}: ${esc(c.category)}</b>
              <span class="adm-badge ${c.status}">${esc(c.status)}</span>
            </div>
            ${c.service_name ? `<div class="mut" style="font-size:12px;margin-top:3px">Booking #${c.booking_id}: ${esc(c.service_name)}</div>` : ''}
            <div style="font-size:13px;margin-top:6px">"${esc(c.description)}"</div>
            ${c.resolution_notes ? `<div class="fm-alert success" style="margin-top:8px;margin-bottom:0">${ic('checkCircle', 15)} <div><b>Resolution:</b> ${esc(c.resolution_notes)}</div></div>` : ''}
          </div>
        `).join('') : emptyBox('alert', 'No support tickets', 'Need help with a booking or payment? Tap "New Ticket" above.')}
      ` : ''}

      <button class="btn acc" style="margin-top:16px" onclick="out()">${ic('logOut', 16)} ${t('common.logout')}</button>
    </div>`;
  };
})();
