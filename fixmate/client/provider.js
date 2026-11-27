// FixMate Phase 4 — Complete Service Provider Application Experience
// Implements all 26 Service Provider features:
// Home, Online/Offline Status, New Requests (Accept/Reject), Upcoming/Active/Completed/Cancelled Jobs,
// Authorized Customer Details, Booking Status Updates, Live GPS Consent,
// Profile Management, Service Categories, Experience, Service Area, Pricing, Weekly Availability,
// Earnings Dashboard, Payment History, Ratings & Reviews, Notifications,
// Verification Documents & Status (Pending/Approved/Rejected/Suspended),
// Support, Password Management, Language Settings, Logout.

(function () {
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DOC_TYPES = ['Aadhaar Card', 'PAN Card', 'Driving License', 'Voter ID', 'Skill Certificate'];

  function verifStatusOf(u) {
    if (!u) return 'pending';
    const st = u.verification_status;
    if (st && ['pending', 'approved', 'rejected', 'suspended'].includes(st)) {
      if (st === 'approved' && Number(u.id_verified) === 0) return 'pending';
      return st;
    }
    return Number(u.id_verified ?? 1) === 1 ? 'approved' : 'pending';
  }

  function verifBadgeHtml(status) {
    if (status === 'approved') return `<span class="badge ok">${ic('shieldCheck', 12)} Approved Partner</span>`;
    if (status === 'rejected') return `<span class="badge bad">${ic('xCircle', 12)} Verification Rejected</span>`;
    if (status === 'suspended') return `<span class="badge bad">${ic('alertTriangle', 12)} Account Suspended</span>`;
    return `<span class="badge warn">${ic('clock', 12)} Verification Pending</span>`;
  }

  function verifBannerHtml(u) {
    const st = verifStatusOf(u);
    if (st === 'approved') return '';
    const msgMap = {
      pending: 'Aapka provider verification abhi review mein hai. Admin approval ke baad hi aap naye customer booking requests accept kar sakte hain.',
      rejected: 'Aapke verification documents reject ho gaye hain. Kripya sahi documents dubara upload karein.',
      suspended: 'Aapka provider account abhi suspended hai. Support team se sampark karein.'
    };
    const cls = st === 'pending' ? 'warning' : 'danger';
    return `<div class="fm-alert ${cls}" style="margin-bottom:14px;align-items:flex-start">
      ${ic(st === 'pending' ? 'clock' : 'alertTriangle', 18)}
      <div style="flex:1">
        <b style="display:block;font-size:13.5px;margin-bottom:2px">Verification Status: ${st.toUpperCase()}</b>
        <div style="font-size:12px;line-height:1.45">${msgMap[st] || msgMap.pending}</div>
        ${u.verification_notes ? `<div style="font-size:12px;margin-top:4px;font-weight:700">Note: ${esc(u.verification_notes)}</div>` : ''}
        <button class="btn sm ghost" style="margin-top:8px;width:auto;padding:6px 12px;font-size:12px" onclick="S.wkProfileTab='verification';setWkTab('profile')">
          ${ic('fileText', 13)} Manage Verification Documents
        </button>
      </div>
    </div>`;
  }

  window.setWkTab = function (t) {
    S.wkTab = t || 'home';
    render();
    scrollTo(0, 0);
  };

  window.wk = function () {
    const tab = S.wkTab || 'home';
    if (tab === 'requests') return wk_requests();
    if (tab === 'jobs') return wk_jobs();
    if (tab === 'earnings') return wk_earnings();
    if (tab === 'profile') return wk_profile();
    return wk_home();
  };

  function wkHeader(u) {
    const rating = S.wkStats?.avg_rating ? S.wkStats.avg_rating : 'New';
    const cats = Array.isArray(u.service_categories) && u.service_categories.length ? u.service_categories : [u.skill || 'Service Partner'];
    return `<div class="hd" style="margin-bottom:14px">
      <div class="row">
        <div>
          <div style="margin-bottom:4px">${fmLogo({ size: 28, onDark: true })}</div>
          <b style="font-size:19px">${esc(u.name)}</b>
          <div style="font-size:12.5px;opacity:0.92;display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px">
            <span>${esc(cats.slice(0, 2).join(' • '))}${cats.length > 2 ? ` +${cats.length - 2}` : ''}</span>
            <span>• ${ic('star', 13, true)} ${rating}</span>
          </div>
        </div>
        <div class="ics">
          <button class="ic" onclick="openNotificationsModal()" title="Notifications" aria-label="Notifications">
            ${ic('bell', 18)}
            ${S.unreadNotifications > 0 ? `<span class="notif-dot">${S.unreadNotifications > 9 ? '9+' : S.unreadNotifications}</span>` : ''}
          </button>
          <button class="ic" onclick="theme()" title="Toggle theme" aria-label="Toggle theme">${ic(isDarkTheme() ? 'sun' : 'moon', 18)}</button>
          <button class="ic" onclick="out()" title="Logout" aria-label="Logout">${ic('logOut', 18)}</button>
        </div>
      </div>
      <div style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        ${verifBadgeHtml(verifStatusOf(u))}
        <span style="font-size:11.5px;opacity:0.9;display:inline-flex;align-items:center;gap:4px">${ic('pin', 12)} ${esc(u.service_areas || 'All Dhanbad')}</span>
      </div>
    </div>`;
  }

  function wk_home() {
    const u = S.user || {};
    const on = u.online !== false;
    const st = S.wkStats || {};
    const approved = verifStatusOf(u) === 'approved';
    const open = S.B.filter((b) => b.status === 'requested');
    const upcoming = S.B.filter((b) => b.status === 'assigned');
    const inMotion = S.B.filter((b) => ['on_the_way', 'inspecting', 'quoted', 'in_progress'].includes(b.status));
    const recentJobs = [...upcoming, ...inMotion].slice(0, 2);

    return `${wkHeader(u)}
    ${verifBannerHtml(u)}

    <div class="wk-online-card">
      <div>
        <b style="font-size:15px;display:flex;align-items:center;gap:7px">
          <span style="width:9px;height:9px;border-radius:50%;background:${on ? 'var(--ok)' : 'var(--mut)'}"></span>
          ${on ? t('prov.online_title') : t('prov.offline_title')}
        </b>
        <div class="mut" style="font-size:12px">
          ${!approved ? t('auth.provider_kyc_note') : (on ? t('prov.online_sub') : t('prov.offline_sub'))}
        </div>
      </div>
      <button class="tg ${on ? 'on' : ''}" onclick="setOnline(${!on})" aria-label="Online status toggle"></button>
    </div>

    <div class="wk-kpi-grid">
      <div class="wk-kpi-card" onclick="setWkTab('requests')" style="cursor:pointer">
        <div class="wk-kpi-val">${open.length}</div>
        <div class="wk-kpi-lbl">${t('prov.new_requests')}</div>
      </div>
      <div class="wk-kpi-card" onclick="S.wkJobsTab='upcoming';setWkTab('jobs')" style="cursor:pointer">
        <div class="wk-kpi-val">${st.upcoming_jobs != null ? st.upcoming_jobs : upcoming.length}</div>
        <div class="wk-kpi-lbl">${t('prov.upcoming_jobs')}</div>
      </div>
      <div class="wk-kpi-card" onclick="S.wkJobsTab='active';setWkTab('jobs')" style="cursor:pointer">
        <div class="wk-kpi-val">${st.in_progress_jobs != null ? st.in_progress_jobs : inMotion.length}</div>
        <div class="wk-kpi-lbl">${t('prov.active_jobs')}</div>
      </div>
      <div class="wk-kpi-card" onclick="S.wkJobsTab='completed';setWkTab('jobs')" style="cursor:pointer">
        <div class="wk-kpi-val">${st.completed_jobs || 0}</div>
        <div class="wk-kpi-lbl">${t('prov.completed')}</div>
      </div>
      <div class="wk-kpi-card" onclick="setWkTab('earnings')" style="cursor:pointer">
        <div class="wk-kpi-val">${inr(S.w)}</div>
        <div class="wk-kpi-lbl">${t('prov.wallet_bal')}</div>
      </div>
      <div class="wk-kpi-card" onclick="S.wkEarnTab='reviews';setWkTab('earnings')" style="cursor:pointer">
        <div class="wk-kpi-val">${st.avg_rating ? st.avg_rating : 'New'}</div>
        <div class="wk-kpi-lbl">${st.review_count || 0} ${t('prov.reviews')}</div>
      </div>
    </div>

    <h2 style="font-size:16px;margin:16px 0 8px">${t('prov.quick_actions')}</h2>
    <div class="wk-quick-grid">
      <button class="card wk-quick-btn" onclick="setWkTab('requests')">
        <span class="wk-q-ico">${ic('bell', 18)}</span>
        <b>Requests (${open.length})</b>
        <span class="mut">Accept or pass jobs</span>
      </button>
      <button class="card wk-quick-btn" onclick="S.wkProfileTab='availability';setWkTab('profile')">
        <span class="wk-q-ico">${ic('calendar', 18)}</span>
        <b>Availability</b>
        <span class="mut">Weekly schedule</span>
      </button>
      <button class="card wk-quick-btn" onclick="S.wkProfileTab='verification';setWkTab('profile')">
        <span class="wk-q-ico">${ic('shieldCheck', 18)}</span>
        <b>Verification</b>
        <span class="mut">${verifStatusOf(u).toUpperCase()}</span>
      </button>
      <button class="card wk-quick-btn" onclick="S.wkProfileTab='profile';setWkTab('profile')">
        <span class="wk-q-ico">${ic('tag', 18)}</span>
        <b>Skills & Pricing</b>
        <span class="mut">Categories & rates</span>
      </button>
    </div>

    <div class="row" style="margin:18px 0 8px">
      <h2 style="font-size:16px;margin:0">Active & Upcoming Work</h2>
      <button class="link-btn" onclick="setWkTab('jobs')">View All ${ic('chevronRight', 14)}</button>
    </div>
    ${recentJobs.length ? recentJobs.map(window.wcard).join('') : emptyBox('checkCircle', 'Abhi koi active job nahi hai', 'Requests tab se naye bookings accept karein.')}`;
  }

  function wk_requests() {
    const u = S.user || {};
    const on = u.online !== false;
    const approved = verifStatusOf(u) === 'approved';
    const open = S.B.filter((b) => b.status === 'requested');

    return `<div class="row" style="margin-bottom:12px">
      <div>
        <h2 style="margin:0;font-size:21px">${t('prov.requests_title')}</h2>
        <div class="mut" style="font-size:12px">${t('prov.online_sub')}</div>
      </div>
      <button class="tg ${on ? 'on' : ''}" onclick="setOnline(${!on})" title="Online/Offline toggle"></button>
    </div>

    ${verifBannerHtml(u)}

    ${!approved ? emptyBox('shield', trStatus(verifStatusOf(u)), t('auth.provider_kyc_note'), `<button class="btn sm acc" style="width:auto" onclick="S.wkProfileTab='verification';setWkTab('profile')">${t('prov.tab_verification')}</button>`) : (
      !on ? `<div class="fm-alert warning">${ic('alertTriangle', 16)} ${t('prov.offline_sub')}</div>` : (
        open.length ? open.map((b) => wreqCard(b)).join('') : emptyBox('bell', t('prov.empty_requests'), t('prov.empty_requests_desc'))
      )
    )}`;
  }

  window.wreqCard = function (b) {
    const approved = verifStatusOf(S.user) === 'approved';
    return `<div class="job-req-card">
      <div class="row" style="align-items:flex-start">
        <div>
          <span class="badge" style="margin-bottom:6px">${esc(b.cat || 'Service')}</span>
          <b style="display:block;font-size:15.5px">${esc(b.service)}</b>
        </div>
        <div style="text-align:right">
          <span class="badge warn">New Request</span>
          <div style="font-weight:800;font-size:14px;color:var(--pri);margin-top:4px">${inr(b.price)}</div>
        </div>
      </div>

      <div class="job-meta-row" style="margin-top:8px">
        <span>${ic('pin', 14)} ${esc(b.address)}</span>
        <span>${ic('calendar', 14)} ${esc(b.scheduled_date ? `${b.scheduled_date} • ${b.scheduled_time || b.slot}` : b.slot)}</span>
      </div>

      ${b.is_emergency ? `<div class="badge bad" style="margin-bottom:8px">${ic('alertTriangle', 12)} Urgent Emergency Request</div>` : ''}
      ${(b.instructions || b.issue_desc) ? `<div class="card" style="background:var(--soft);border:none;padding:8px 10px;margin-bottom:8px;font-size:12.5px"><b>Customer Note:</b> ${esc(b.instructions || b.issue_desc)}</div>` : ''}
      ${b.photo_url ? `<img src="${b.photo_url}" class="photo-preview-thumb" style="max-height:110px;margin-bottom:8px" alt="Issue photo">` : ''}

      <div class="row" style="margin-top:10px;gap:8px">
        <button class="btn sm acc" style="flex:2" ${!approved ? 'disabled' : ''} onclick="post(${b.id},'accept',null,'Booking accepted!')">
          ${ic('checkCircle', 15)} ${t('prov.accept_booking')}
        </button>
        <button class="btn sm ghost" style="flex:1;color:var(--bad)" onclick="wkRejectJob(${b.id})">
          ${ic('xCircle', 15)} ${t('prov.reject_booking')}
        </button>
      </div>
    </div>`;
  };

  window.wkRejectJob = function (id) {
    act(async () => {
      await api('POST', `/bookings/${id}/reject-job`, { reason: 'Declined by service provider' });
      await refresh();
      render();
      toast('Request reject kar diya gaya');
    });
  };

  function wk_jobs() {
    const tab = S.wkJobsTab || 'upcoming';
    const upcoming = S.B.filter((b) => b.status === 'assigned');
    const active = S.B.filter((b) => ['on_the_way', 'inspecting', 'quoted', 'in_progress'].includes(b.status));
    const completed = S.B.filter((b) => ['completed', 'closed'].includes(b.status));
    const cancelled = S.B.filter((b) => b.status === 'cancelled');

    const map = { upcoming, active, completed, cancelled };
    const list = map[tab] || upcoming;

    return `<h2 style="margin:0 0 10px;font-size:21px">${t('prov.my_jobs')}</h2>
    <div class="seg" style="margin-bottom:14px">
      <button class="pill ${tab === 'upcoming' ? 'on' : ''}" onclick="S.wkJobsTab='upcoming';render()">${t('prov.upcoming')} (${upcoming.length})</button>
      <button class="pill ${tab === 'active' ? 'on' : ''}" onclick="S.wkJobsTab='active';render()">${t('prov.active')} (${active.length})</button>
      <button class="pill ${tab === 'completed' ? 'on' : ''}" onclick="S.wkJobsTab='completed';render()">${t('prov.completed')} (${completed.length})</button>
      <button class="pill ${tab === 'cancelled' ? 'on' : ''}" onclick="S.wkJobsTab='cancelled';render()">${t('prov.cancelled')} (${cancelled.length})</button>
    </div>

    ${list.length ? list.map(window.wcard).join('') : emptyBox(
      tab === 'cancelled' ? 'xCircle' : 'tool',
      t('prov.empty_jobs'),
      ''
    )}`;
  }

  window.wcard = function (b) {
    const a = b.status;
    const isCancelled = a === 'cancelled';
    const mapQuery = encodeURIComponent((b.formatted_address || b.address || 'Dhanbad') + '');

    return `<div class="job-assigned-card">
      <div class="row" style="align-items:flex-start">
        <div>
          <span class="badge" style="margin-bottom:4px">${esc(b.cat || 'Service')} • #${b.id}</span>
          <b style="display:block;font-size:15.5px">${esc(b.service)}</b>
        </div>
        <span class="badge ${b.paid ? 'ok' : (isCancelled ? 'bad' : 'warn')}">${esc(b.label)}</span>
      </div>

      ${!isCancelled ? `
        <div class="card" style="background:var(--soft);border:none;padding:10px 12px;margin:10px 0">
          <div style="font-size:11px;font-weight:800;color:var(--pri);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px">Authorized Customer Details</div>
          <div style="font-size:13.5px;font-weight:700;display:flex;align-items:center;gap:6px">${ic('user', 14)} ${esc(b.customer_name || 'Customer')}</div>
          <div class="mut" style="font-size:12.5px;margin-top:4px;display:flex;align-items:flex-start;gap:6px">${ic('pin', 14)} <span>${esc(b.formatted_address || b.address)}</span></div>
          <div class="mut" style="font-size:12px;margin-top:4px;display:flex;align-items:center;gap:6px">${ic('calendar', 14)} ${esc(b.scheduled_date ? `${b.scheduled_date} • ${b.scheduled_time || b.slot}` : b.slot)}</div>
        </div>
      ` : `
        <div class="job-meta-row" style="margin-top:8px">
          <span>${ic('calendar', 14)} ${esc(b.slot)}</span>
          ${b.cancellation_reason ? `<span>${ic('alert', 14)} ${esc(b.cancellation_reason)}</span>` : ''}
        </div>
      `}

      ${(b.instructions || b.issue_desc) && !isCancelled ? `<div class="card" style="background:var(--card);padding:8px 10px;margin-bottom:8px;font-size:12.5px"><b>Instructions:</b> ${esc(b.instructions || b.issue_desc)}</div>` : ''}

      ${!isCancelled ? `
        <div class="row" style="margin-bottom:10px;gap:8px">
          <a href="${b.customer_lat && b.customer_lng ? `https://www.openstreetmap.org/?mlat=${b.customer_lat}&mlon=${b.customer_lng}#map=16/${b.customer_lat}/${b.customer_lng}` : `https://www.google.com/maps/search/?api=1&query=${mapQuery}`}" target="_blank" rel="noopener" class="btn sm ghost" style="flex:1;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px">
            ${ic('nav', 14)} Navigate
          </a>
          ${b.contact_phone ? `
            <a href="tel:${esc(b.contact_phone)}" class="btn sm sec" style="flex:1;text-decoration:none">
              ${ic('phone', 14)} Call Customer
            </a>
          ` : ''}
        </div>
      ` : ''}

      ${['assigned', 'on_the_way', 'inspecting', 'quoted', 'in_progress'].includes(a) ? `
        <div class="card" style="background:${S.wkSharingBookingId === b.id || b.tracking_active ? 'var(--ok-soft)' : 'var(--soft)'};border-color:${S.wkSharingBookingId === b.id || b.tracking_active ? 'var(--ok)' : 'var(--bd)'};padding:10px 12px;margin-bottom:10px">
          <div class="row">
            <div style="font-size:12px">
              <b style="display:flex;align-items:center;gap:6px">${ic('radio', 15)} ${S.wkSharingBookingId === b.id || b.tracking_active ? 'Live Location Sharing Active' : 'Share Live Location'}</b>
              <div class="mut" style="font-size:11px">Consent-based GPS sharing sirf is active job ke liye.</div>
            </div>
            <button class="btn sm ${S.wkSharingBookingId === b.id ? 'ghost' : 'acc'}" style="width:auto;padding:6px 12px;font-size:11.5px" onclick="toggleWorkerLocationSharing(${b.id})">
              ${S.wkSharingBookingId === b.id ? `${ic('stopCircle', 14)} Stop GPS` : `${ic('locate', 14)} Share GPS`}
            </button>
          </div>
        </div>
      ` : ''}

      ${a === 'assigned' ? `
        <button class="btn acc" onclick="post(${b.id},'on-the-way',null,'Customer ko notify kiya: Aap raste mein hain')">
          ${ic('nav', 16)} Start Journey (On The Way)
        </button>
      ` : ''}

      ${a === 'on_the_way' ? `
        <div class="job-step-box">
          <div style="font-weight:700;font-size:13px;margin-bottom:4px">Customer ka 4-digit safety code daalein:</div>
          <input id="c${b.id}" type="tel" inputmode="numeric" maxlength="4" placeholder="----" style="font-size:24px;letter-spacing:8px;text-align:center;font-weight:800;margin:6px 0">
          <label class="btn sm ghost" style="display:flex;margin:6px 0;cursor:pointer">
            <input type="file" accept="image/*" style="display:none" onchange="onWorkerStartPhoto(event, ${b.id})">
            ${ic('camera', 15)} ${S.wkStartPhotos[b.id] ? 'Start Photo Proof Attached' : 'Start Photo Proof (Optional)'}
          </label>
          <button class="btn acc" onclick="workerStartJob(${b.id})">${ic('checkCircle', 16)} Verify Code & Start Work</button>
        </div>
      ` : ''}

      ${a === 'inspecting' ? `
        <div class="job-step-box">
          <div style="font-weight:700;font-size:13px">Inspection Poora: Quote Bhejein</div>
          <div class="mut" style="font-size:12px;margin:4px 0 8px">Base service charge ${inr(b.price)}. Additional spare parts cost daalein:</div>
          <input id="q${b.id}" type="number" min="0" placeholder="Spare parts cost (₹), 0 agar koi part nahi" style="margin-bottom:8px">
          <input id="qd${b.id}" type="text" placeholder="Parts details (e.g. Capacitor, Copper Pipe)" style="margin-bottom:8px">
          <button class="btn acc" onclick="post(${b.id},'quote',{parts:+$('q${b.id}').value||0,parts_desc:($('qd${b.id}')?.value||'').trim()||null},'Quote bhej diya gaya! Customer approval ka intezaar karein.')">
            ${ic('send', 15)} Send Inspection Quote
          </button>
        </div>
      ` : ''}

      ${a === 'quoted' ? `
        <div class="fm-alert warning" style="margin-top:8px">
          ${ic('clock', 16)}
          <div>
            <b>Customer Quote Approval Pending</b>
            <div style="font-size:12px;margin-top:2px">Quote Total: <b>${inr(b.total)}</b> (Service: ${inr(b.price)} + Parts: ${inr(b.parts)})</div>
          </div>
        </div>
      ` : ''}

      ${a === 'in_progress' ? `
        <div class="job-step-box">
          <div style="font-weight:700;font-size:13px;color:var(--pri);display:flex;align-items:center;gap:6px">${ic('tool', 15)} Work In Progress</div>
          <label class="btn sm ghost" style="display:flex;margin:8px 0;cursor:pointer">
            <input type="file" accept="image/*" style="display:none" onchange="onWorkerCompletePhoto(event, ${b.id})">
            ${ic('camera', 15)} ${S.wkCompletePhotos[b.id] ? 'Completion Photo Attached' : 'Completion Photo Proof (Optional)'}
          </label>
          <button class="btn acc" onclick="workerCompleteJob(${b.id})">${ic('checkCircle', 16)} Mark Job Completed</button>
        </div>
      ` : ''}

      ${['completed', 'closed'].includes(a) ? `
        <div class="card" style="background:var(--soft);border:none;margin-top:10px;padding:10px 12px">
          <b style="display:flex;align-items:center;gap:6px">${ic(b.paid ? 'checkCircle' : 'clock', 15)} ${b.paid ? 'Payment Settled' : 'Payment Pending'}</b>
          <div class="mut" style="font-size:12px;margin-top:2px">
            ${b.paid ? `Net Payout (85%): ${inr(Math.round((b.total || b.price) * 0.85))}` : `Customer payment of ${inr(b.total || b.price)} pending`}
          </div>
          <button class="btn sm ghost" style="margin-top:8px;width:100%" onclick="openInvoiceModal(${b.id})">
            ${ic('fileText', 15)} View Job Invoice & Breakdown
          </button>
        </div>
      ` : ''}
    </div>`;
  };

  function wk_earnings() {
    const tab = S.wkEarnTab || 'overview';
    const payData = S.wkPayments || {};
    const sum = payData.summary || {};
    const jobPayouts = payData.job_payouts || [];
    const walletTxs = payData.wallet_transactions || [];
    const rating = S.wkStats?.avg_rating ? S.wkStats.avg_rating : 0;
    const revCount = S.wkStats?.review_count || S.wkReviews.length;

    return `<div class="hd" style="margin-bottom:14px">
      <div style="font-size:13px;opacity:0.9">Earnings & Payouts</div>
      <b style="font-size:34px">${inr(S.w)}</b>
      <div style="font-size:12.5px;opacity:0.92;margin-top:4px">Net Earned: ${inr(sum.total_net_earned != null ? sum.total_net_earned : (S.wkStats?.total_earnings || S.w))} • Pending: ${inr(sum.pending_payout || 0)}</div>
    </div>

    <div class="seg" style="margin-bottom:14px">
      <button class="pill ${tab === 'overview' ? 'on' : ''}" onclick="S.wkEarnTab='overview';render()">Earnings</button>
      <button class="pill ${tab === 'payments' ? 'on' : ''}" onclick="S.wkEarnTab='payments';render()">Payments (${jobPayouts.length})</button>
      <button class="pill ${tab === 'reviews' ? 'on' : ''}" onclick="S.wkEarnTab='reviews';render()">Reviews (${revCount})</button>
    </div>

    ${tab === 'overview' ? `
      <div class="wk-kpi-grid" style="margin-bottom:12px">
        <div class="wk-kpi-card">
          <div class="wk-kpi-val">${inr(sum.total_gross || 0)}</div>
          <div class="wk-kpi-lbl">Gross Job Value</div>
        </div>
        <div class="wk-kpi-card">
          <div class="wk-kpi-val">${inr(sum.total_net_earned != null ? sum.total_net_earned : (S.wkStats?.total_earnings || 0))}</div>
          <div class="wk-kpi-lbl">85% Net Kamai</div>
        </div>
        <div class="wk-kpi-card">
          <div class="wk-kpi-val">${inr(sum.total_commission || 0)}</div>
          <div class="wk-kpi-lbl">15% Platform Fee</div>
        </div>
      </div>

      <div class="card" style="border-left:4px solid var(--pri);margin-bottom:12px">
        <div style="font-weight:800;font-size:14.5px;color:var(--pri);display:flex;align-items:center;gap:6px">${ic('wallet', 16)} FixMate Partner Payout Split</div>
        <div class="row" style="margin-top:8px"><span>Provider Share</span><b style="color:var(--ok)">85%</b></div>
        <div class="row" style="margin-top:4px"><span>Platform & Insurance Fee</span><b class="mut">15%</b></div>
        <div class="mut" style="font-size:11.5px;margin-top:8px">Online / Wallet payments settle hone par aapka 85% hissa seedhe wallet mein credit hota hai.</div>
      </div>

      <h3 style="margin:14px 0 8px;font-size:16px">Recent Wallet Credits</h3>
      ${walletTxs.length ? walletTxs.slice(0, 8).map((t) => `
        <div class="card row" style="margin-bottom:8px">
          <div>
            <div style="font-weight:700;font-size:13.5px">${esc(t.label)}</div>
            <div class="mut" style="font-size:11px">${esc(String(t.created_at || '').slice(0, 16).replace('T', ' '))}</div>
          </div>
          <b style="font-size:15px;color:${t.amount < 0 ? 'var(--bad)' : 'var(--ok)'}">${t.amount < 0 ? '-' : '+'}${inr(Math.abs(t.amount))}</b>
        </div>
      `).join('') : emptyBox('wallet', 'Abhi koi payout nahi hua', 'Completed aur paid jobs ki kamai yahan dikhai degi.')}
    ` : ''}

    ${tab === 'payments' ? `
      <h3 style="margin:0 0 10px;font-size:17px">Completed Jobs Payment History</h3>
      ${jobPayouts.length ? jobPayouts.map((p) => `
        <div class="card" style="margin-bottom:10px">
          <div class="row">
            <div>
              <b>#${p.booking_id} • ${esc(p.service)}</b>
              <div class="mut" style="font-size:11.5px">${esc(p.category)} • Mode: ${esc((p.pay_mode || 'cash').toUpperCase())}</div>
            </div>
            <span class="badge ${p.paid ? 'ok' : 'warn'}">${p.paid ? 'Paid' : 'Pending'}</span>
          </div>
          <div class="row" style="margin-top:8px;font-size:12.5px">
            <span class="mut">Gross: ${inr(p.gross_amount)} | Fee: ${inr(p.platform_fee)}</span>
            <b style="color:var(--ok)">Net: ${inr(p.net_payout)}</b>
          </div>
          <button class="btn sm ghost" style="margin-top:8px;width:100%" onclick="openInvoiceModal(${p.booking_id})">
            ${ic('fileText', 14)} View Invoice
          </button>
        </div>
      `).join('') : emptyBox('creditCard', 'Abhi koi job payment record nahi hai', 'Completed jobs ka payout breakdown yahan aayega.')}
    ` : ''}

    ${tab === 'reviews' ? `
      <div class="card" style="text-align:center;padding:22px 16px;margin-bottom:14px">
        <div style="font-size:40px;font-weight:800;color:var(--pri);line-height:1">${rating}</div>
        <div class="star-rating-row" style="margin:8px 0">
          ${[1, 2, 3, 4, 5].map((s) => `<span style="color:${s <= Math.round(rating) ? '#F59E0B' : '#CBD5E1'}">${ic('star', 20, s <= Math.round(rating))}</span>`).join('')}
        </div>
        <div class="mut" style="font-size:13px">${revCount} Verified Customer Reviews</div>
      </div>
      ${S.wkReviews.length ? S.wkReviews.map((r) => `
        <div class="card" style="margin-bottom:10px">
          <div class="row">
            <b>${esc(r.customer_name || 'Customer')}</b>
            <span class="badge warn">${ic('star', 12, true)} ${r.rating}/5</span>
          </div>
          <div class="mut" style="font-size:11.5px;margin:2px 0 6px">${esc(r.service_name || 'Service')}</div>
          ${r.comment ? `<div style="font-size:13px;line-height:1.45">"${esc(r.comment)}"</div>` : '<div class="mut" style="font-size:12px">Rating submitted</div>'}
        </div>
      `).join('') : emptyBox('star', 'Abhi koi review nahi mila', 'Customer reviews complete jobs ke baad yahan dikhenge.')}
    ` : ''}`;
  }

  function wk_profile() {
    const u = S.user || {};
    const tab = S.wkProfileTab || 'profile';
    const st = verifStatusOf(u);
    const cats = Array.isArray(u.service_categories) && u.service_categories.length ? u.service_categories : [u.skill || CATS[0]];
    const pricing = (u.pricing_json && typeof u.pricing_json === 'object') ? u.pricing_json : {};
    const avail = Array.isArray(S.wkAvail) && S.wkAvail.length === 7 ? S.wkAvail : DAYS.map((_, d) => ({
      day_of_week: d, is_available: d !== 0, start_time: '09:00', end_time: '20:00'
    }));

    return `<h2 style="margin:0 0 12px;font-size:21px">${t('prov.profile_settings')}</h2>

    <div class="card row" style="justify-content:flex-start;margin-bottom:12px">
      <div class="av">${esc((u.name || 'P')[0].toUpperCase())}</div>
      <div style="flex:1">
        <b style="font-size:16px">${esc(u.name)}</b>
        <div class="mut" style="font-size:12.5px">+91 ${esc(u.phone)} • ${u.experience_years || 0} yrs exp</div>
        <div style="margin-top:6px">${verifBadgeHtml(st)}</div>
      </div>
    </div>

    <div class="seg" style="margin-bottom:14px">
      <button class="pill ${tab === 'profile' ? 'on' : ''}" onclick="S.wkProfileTab='profile';render()">${t('prov.tab_profile')}</button>
      <button class="pill ${tab === 'availability' ? 'on' : ''}" onclick="S.wkProfileTab='availability';render()">${t('prov.tab_availability')}</button>
      <button class="pill ${tab === 'verification' ? 'on' : ''}" onclick="S.wkProfileTab='verification';render()">${t('prov.tab_verification')}</button>
      <button class="pill ${tab === 'settings' ? 'on' : ''}" onclick="S.wkProfileTab='settings';render()">${t('prov.tab_settings')}</button>
    </div>

    ${tab === 'profile' ? `
      <div class="card">
        <h3 style="margin:0 0 12px;font-size:16px">Business & Service Details</h3>
        <label class="fm-lbl">Full Name</label>
        <input id="wk-name" value="${esc(u.name || '')}" style="margin:4px 0 10px">

        <label class="fm-lbl">About / Bio</label>
        <textarea id="wk-bio" rows="2" placeholder="Apne kaam aur specialization ke baare mein likhein..." style="margin:4px 0 10px">${esc(u.bio || '')}</textarea>

        <label class="fm-lbl">Primary Skill</label>
        <select id="wk-skill" style="margin:4px 0 10px">
          ${CATS.map((c) => `<option value="${esc(c)}" ${u.skill === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>

        <label class="fm-lbl">Service Categories (Multi-select)</label>
        <div class="wk-cat-checks" style="margin:6px 0 12px">
          ${CATS.map((c) => `
            <label class="wk-check-pill">
              <input type="checkbox" class="wk-cat-cb" value="${esc(c)}" ${cats.includes(c) ? 'checked' : ''} onchange="syncWkPricingRows()">
              <span>${esc(c)}</span>
            </label>
          `).join('')}
        </div>

        <div class="row" style="gap:10px">
          <div style="flex:1">
            <label class="fm-lbl">Experience (Years)</label>
            <input id="wk-exp" type="number" min="0" max="50" value="${esc(u.experience_years != null ? u.experience_years : 2)}" style="margin:4px 0 10px">
          </div>
          <div style="flex:1">
            <label class="fm-lbl">Default Base Rate (₹)</label>
            <input id="wk-base-rate" type="number" min="0" max="50000" value="${esc(u.base_rate != null ? u.base_rate : 199)}" style="margin:4px 0 10px">
          </div>
        </div>

        <label class="fm-lbl">Service Area Coverage</label>
        <input id="wk-areas" placeholder="e.g. Saraidhela, Bank More, Hirapur" value="${esc(u.service_areas || 'All Dhanbad')}" style="margin:4px 0 12px">

        <label class="fm-lbl">Category Visiting / Base Rates (₹)</label>
        <div id="wk-pricing-rows" style="margin:6px 0 12px;display:flex;flex-direction:column;gap:6px">
          ${cats.map((c) => `
            <div class="row" style="gap:8px;background:var(--soft);padding:6px 10px;border-radius:10px">
              <span style="font-size:13px;font-weight:600;flex:1">${esc(c)}</span>
              <input type="number" min="0" max="50000" data-cat="${esc(c)}" class="wk-price-inp" value="${esc(pricing[c] != null ? pricing[c] : (u.base_rate || 199))}" style="width:110px;margin:0">
            </div>
          `).join('')}
        </div>

        <button class="btn acc" onclick="saveWorkerProfile()">${ic('checkCircle', 16)} Save Profile & Pricing</button>
      </div>
    ` : ''}

    ${tab === 'availability' ? `
      <div class="card">
        <h3 style="margin:0 0 6px;font-size:16px">Weekly Working Hours</h3>
        <div class="mut" style="font-size:12px;margin-bottom:12px">Apne kaam karne ke din aur timing set karein.</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${avail.map((row) => `
            <div class="wk-avail-row">
              <label style="display:flex;align-items:center;gap:8px;min-width:118px;font-weight:700;font-size:13px;cursor:pointer">
                <input type="checkbox" id="av-on-${row.day_of_week}" ${row.is_available ? 'checked' : ''}>
                ${DAYS[row.day_of_week]}
              </label>
              <div style="display:flex;align-items:center;gap:6px;flex:1">
                <input type="time" id="av-st-${row.day_of_week}" value="${esc(row.start_time || '09:00')}" style="margin:0;padding:6px 8px">
                <span class="mut">-</span>
                <input type="time" id="av-en-${row.day_of_week}" value="${esc(row.end_time || '20:00')}" style="margin:0;padding:6px 8px">
              </div>
            </div>
          `).join('')}
        </div>
        <button class="btn acc" style="margin-top:14px" onclick="saveWorkerAvailability()">${ic('calendar', 16)} Save Weekly Availability</button>
      </div>
    ` : ''}

    ${tab === 'verification' ? `
      <div class="card">
        <div class="row" style="margin-bottom:10px">
          <h3 style="margin:0;font-size:16px">KYC & Verification Status</h3>
          ${verifBadgeHtml(st)}
        </div>
        ${u.verification_notes ? `<div class="fm-alert danger" style="margin-bottom:10px">${ic('alertTriangle', 15)} Admin Feedback: ${esc(u.verification_notes)}</div>` : ''}
        ${u.verification_submitted_at ? `<div class="mut" style="font-size:12px;margin-bottom:10px">Last Submitted: ${esc(String(u.verification_submitted_at).slice(0, 16).replace('T', ' '))} (${esc(u.verification_doc_type || 'ID')})</div>` : ''}

        <label class="fm-lbl">Document Type</label>
        <select id="wk-doc-type" style="margin:4px 0 10px">
          ${DOC_TYPES.map((dt) => `<option value="${esc(dt)}" ${u.verification_doc_type === dt ? 'selected' : ''}>${esc(dt)}</option>`).join('')}
        </select>

        <label class="fm-lbl">Upload Document Image or Reference</label>
        <label class="btn sm ghost" style="display:flex;margin:6px 0 10px;cursor:pointer">
          <input type="file" accept="image/*" style="display:none" onchange="onWorkerDocFile(event)">
          ${ic('camera', 15)} ${S.wkPendingDocData ? 'Document Image Ready' : 'Choose Document Photo'}
        </label>
        ${(S.wkPendingDocData || (u.id_document_url && u.id_document_url.startsWith('data:image'))) ? `
          <img src="${S.wkPendingDocData || u.id_document_url}" class="photo-preview-thumb" style="max-height:140px;margin-bottom:10px" alt="Verification document preview">
        ` : ''}

        <input id="wk-doc-url" placeholder="Ya Document Reference / URL daalein (e.g. AADHAAR-XXXX-1234)" value="${esc(!u.id_document_url?.startsWith('data:') ? (u.id_document_url || '') : '')}" style="margin:4px 0 12px">

        <button class="btn acc" onclick="submitWorkerVerification()">${ic('shieldCheck', 16)} Submit Verification Documents</button>
      </div>
    ` : ''}

    ${tab === 'settings' ? `
      <div class="card" style="margin-bottom:12px">
        <h3 style="margin:0 0 10px;font-size:16px">${t('cust.lang_settings')}</h3>
        <div style="margin-bottom:10px">${langSelectorHtml()}</div>
        <select id="wk-lang" style="margin-bottom:10px" onchange="setLang(this.value)">
          <option value="en" ${(u.language || 'en') === 'en' ? 'selected' : ''}>English</option>
          <option value="hi" ${u.language === 'hi' ? 'selected' : ''}>Hindi (हिन्दी)</option>
          <option value="hinglish" ${u.language === 'hinglish' ? 'selected' : ''}>Hinglish</option>
        </select>
        <button class="btn sm acc" onclick="saveWorkerLanguage()">${ic('globe', 15)} ${t('common.save')}</button>
      </div>

      <div class="card" style="margin-bottom:12px">
        <h3 style="margin:0 0 10px;font-size:16px">${t('cust.password_mgmt')}</h3>
        ${u.has_password ? `<input id="wk-pw-cur" type="password" placeholder="Current password" style="margin-bottom:8px">` : ''}
        <input id="wk-pw-new" type="password" placeholder="New password (min 8 characters)" style="margin-bottom:10px">
        <button class="btn sm acc" onclick="saveWorkerPassword()">${ic('lock', 15)} ${u.has_password ? 'Change Password' : 'Set Password'}</button>
      </div>

      <div class="card" style="margin-bottom:12px">
        <h3 style="margin:0 0 8px;font-size:16px">${t('prov.partner_support')}</h3>
        <div class="mut" style="font-size:12.5px;margin-bottom:10px">${t('cust.support_section')}</div>
        <div class="row" style="gap:8px;margin-bottom:10px">
          <a href="tel:+917209612650" class="btn sm ghost" style="flex:1;text-decoration:none">${ic('phone', 14)} ${t('common.helpline')}</a>
          <a href="mailto:support@fixmate.in" class="btn sm ghost" style="flex:1;text-decoration:none">${ic('mail', 14)} ${t('common.email_support')}</a>
        </div>
        <button class="btn sm sec" style="width:100%" onclick="openComplaintModal()">${ic('messageSquare', 15)} Raise Partner Support Ticket</button>
      </div>

      <button class="btn ghost" style="width:100%;color:var(--bad);margin-bottom:8px" onclick="out()">${ic('logOut', 16)} ${t('common.logout')}</button>
      <button class="btn sm ghost" style="width:100%" onclick="logoutAllDevices()">${ic('shield', 15)} Logout All Devices</button>
    ` : ''}`;
  }

  window.syncWkPricingRows = function () {
    const cbs = Array.from(document.querySelectorAll('.wk-cat-cb:checked')).map((el) => el.value);
    const wrap = $('wk-pricing-rows');
    if (!wrap) return;
    const curVals = {};
    wrap.querySelectorAll('.wk-price-inp').forEach((inp) => { curVals[inp.dataset.cat] = inp.value; });
    const baseRate = +($('wk-base-rate')?.value || S.user?.base_rate || 199);
    const pricing = (S.user?.pricing_json && typeof S.user.pricing_json === 'object') ? S.user.pricing_json : {};
    wrap.innerHTML = cbs.map((c) => `
      <div class="row" style="gap:8px;background:var(--soft);padding:6px 10px;border-radius:10px">
        <span style="font-size:13px;font-weight:600;flex:1">${esc(c)}</span>
        <input type="number" min="0" max="50000" data-cat="${esc(c)}" class="wk-price-inp" value="${esc(curVals[c] != null ? curVals[c] : (pricing[c] != null ? pricing[c] : baseRate))}" style="width:110px;margin:0">
      </div>
    `).join('');
  };

  window.saveWorkerProfile = function () {
    const name = ($('wk-name')?.value || '').trim();
    const bio = ($('wk-bio')?.value || '').trim();
    const skill = $('wk-skill')?.value;
    const selectedCats = Array.from(document.querySelectorAll('.wk-cat-cb:checked')).map((c) => c.value);
    const categories = selectedCats.length ? selectedCats : [skill];
    const exp = +($('wk-exp')?.value || 0);
    const baseRate = +($('wk-base-rate')?.value || 199);
    const areas = ($('wk-areas')?.value || '').trim();
    const pricingObj = {};
    document.querySelectorAll('.wk-price-inp').forEach((inp) => {
      if (inp.dataset.cat && inp.value !== '') pricingObj[inp.dataset.cat] = +inp.value || 0;
    });

    act(async () => {
      const res = await api('PUT', '/worker/profile', {
        name,
        bio,
        skill,
        service_categories: categories,
        experience_years: exp,
        base_rate: baseRate,
        service_areas: areas,
        pricing_json: pricingObj
      });
      S.user = res.user;
      try {
        const stored = JSON.parse(localStorage.getItem('fm_auth') || '{}');
        stored.u = res.user;
        localStorage.setItem('fm_auth', JSON.stringify(stored));
      } catch (e) {}
      await refresh();
      render();
      toast('Provider profile aur pricing save ho gayi!');
    });
  };

  window.saveWorkerAvailability = function () {
    const days = [];
    for (let d = 0; d < 7; d++) {
      days.push({
        day_of_week: d,
        is_available: Boolean($(`av-on-${d}`)?.checked),
        start_time: $(`av-st-${d}`)?.value || '09:00',
        end_time: $(`av-en-${d}`)?.value || '20:00'
      });
    }
    act(async () => {
      const res = await api('PUT', '/worker/availability', { days });
      S.wkAvail = res.availability || days;
      render();
      toast('Weekly availability update ho gayi!');
    });
  };

  window.onWorkerDocFile = function (ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      S.wkPendingDocData = e.target.result;
      render();
      toast('Verification document image attach ho gaya');
    };
    reader.readAsDataURL(file);
  };

  window.submitWorkerVerification = function () {
    const doc_type = $('wk-doc-type')?.value || 'Aadhaar Card';
    const refVal = ($('wk-doc-url')?.value || '').trim();
    const id_document_url = S.wkPendingDocData || refVal || S.user?.id_document_url || '';
    if (!id_document_url || id_document_url.length < 10) {
      toast('Kripya document image upload karein ya valid reference ID daalein');
      return;
    }
    act(async () => {
      const res = await api('POST', '/worker/verification', { doc_type, id_document_url });
      S.user = res.user;
      S.wkPendingDocData = null;
      try {
        const stored = JSON.parse(localStorage.getItem('fm_auth') || '{}');
        stored.u = res.user;
        localStorage.setItem('fm_auth', JSON.stringify(stored));
      } catch (e) {}
      await refresh();
      render();
      toast('Verification documents admin review ke liye submit ho gaye!');
    });
  };

  window.saveWorkerLanguage = function () {
    const language = $('wk-lang')?.value || 'en';
    act(async () => {
      await setLang(language, true);
    });
  };

  window.saveWorkerPassword = function () {
    const current_password = $('wk-pw-cur')?.value || undefined;
    const new_password = ($('wk-pw-new')?.value || '').trim();
    if (new_password.length < 8) {
      toast(t('val.password_len'));
      return;
    }
    act(async () => {
      const res = await api('PUT', '/me/password', { current_password, new_password });
      S.user.has_password = true;
      render();
      toast(res.message || t('val.password_saved'));
    });
  };
})();
