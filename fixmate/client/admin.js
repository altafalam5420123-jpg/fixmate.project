// FixMate Phase 5 — Founder / Admin Dashboard Experience
// Implements complete operational control backed by live PostgreSQL/SQLite queries:
// Overview KPIs & Revenue Analytics, Customer Management, Provider Management & KYC,
// Booking Management (Search/Filter/Sort/Pagination/Assign/History/Cancel),
// Categories/Services/Coupons Catalog, Payment & Refund Tracking, Reviews Moderation,
// Support Tickets, Notification Broadcasts, Audit Logs, CSV Exports, Admin Profile & Settings.

(function () {
  function fmtDt(dt) {
    if (!dt) return '-';
    return String(dt).slice(0, 16).replace('T', ' ');
  }

  function verifBadge(st) {
    const s = st || 'pending';
    if (s === 'approved') return `<span class="badge ok">${ic('shieldCheck', 12)} Approved</span>`;
    if (s === 'rejected') return `<span class="badge bad">${ic('xCircle', 12)} Rejected</span>`;
    if (s === 'suspended') return `<span class="badge bad">${ic('alertTriangle', 12)} Suspended</span>`;
    return `<span class="badge warn">${ic('clock', 12)} Pending</span>`;
  }

  window.downloadAdminCsv = function (type) {
    if (!S.token) return toast('Pehle login karein');
    const url = `${getApiBase()}/api/admin/export/${encodeURIComponent(type)}?token=${encodeURIComponent(S.token)}`;
    window.open(url, '_blank');
    toast(`${type} CSV export download shuru hua`);
  };

  window.refreshAdminData = async function () {
    const bQs = new URLSearchParams({ page: S.admBookingPage || 1, limit: 15, sort: S.admBookingSort || 'newest' });
    if (S.admBookingFilter && S.admBookingFilter !== 'all') bQs.set('status', S.admBookingFilter);
    if (S.admBookingQ) bQs.set('q', S.admBookingQ);
    if (S.admBookingDate) bQs.set('date', S.admBookingDate);

    const pQs = new URLSearchParams({ page: S.admProvPage || 1, limit: 15, sort: S.admProvSort || 'newest' });
    if (S.admProvFilter && S.admProvFilter !== 'all') pQs.set('verification_status', S.admProvFilter);
    if (S.admProvQ) pQs.set('q', S.admProvQ);

    const cQs = new URLSearchParams({ page: S.admCustPage || 1, limit: 15, sort: S.admCustSort || 'newest' });
    if (S.admCustFilter && S.admCustFilter !== 'all') cQs.set('status', S.admCustFilter);
    if (S.admCustQ) cQs.set('q', S.admCustQ);

    const payQs = new URLSearchParams({ page: S.admPayPage || 1, limit: 15 });
    if (S.admPayMode && S.admPayMode !== 'all') payQs.set('pay', S.admPayMode);
    if (S.admPayPaid === '1' || S.admPayPaid === '0') payQs.set('paid', S.admPayPaid);

    const aQs = new URLSearchParams({ page: S.admAuditPage || 1, limit: 20 });
    if (S.admAuditFilter && S.admAuditFilter !== 'all') aQs.set('target_type', S.admAuditFilter);

    const [anRes, bkRes, pvRes, csRes, catRes, cpnRes, payRes, refRes, revRes, cmpRes, ntfRes, audRes] = await Promise.all([
      api('GET', '/admin/analytics').catch(() => ({ analytics: {} })),
      api('GET', '/admin/bookings?' + bQs.toString()).catch(() => ({ bookings: [] })),
      api('GET', '/admin/providers?' + pQs.toString()).catch(() => ({ providers: [] })),
      api('GET', '/admin/customers?' + cQs.toString()).catch(() => ({ customers: [] })),
      api('GET', '/admin/categories').catch(() => ({ categories: [] })),
      api('GET', '/coupons').catch(() => ({ coupons: [] })),
      api('GET', '/admin/payments?' + payQs.toString()).catch(() => ({ payments: [], summary: {} })),
      api('GET', '/admin/refunds').catch(() => ({ refunds: [] })),
      api('GET', '/admin/reviews').catch(() => ({ reviews: [] })),
      api('GET', '/admin/complaints').catch(() => ({ complaints: [] })),
      api('GET', '/admin/notifications').catch(() => ({ notifications: [] })),
      api('GET', '/admin/audit-logs?' + aQs.toString()).catch(() => ({ logs: [] }))
    ]);

    if (anRes?.analytics) S.admAnalytics = anRes.analytics;
    S.admBookings = bkRes.bookings || [];
    S.admBookingsMeta = { page: bkRes.page || 1, pages: bkRes.pages || 1, total: bkRes.total || S.admBookings.length };
    S.admProviders = pvRes.providers || [];
    S.admWorkers = S.admProviders;
    S.admProvidersMeta = { page: pvRes.page || 1, pages: pvRes.pages || 1, total: pvRes.total || S.admProviders.length };
    S.admCustomers = csRes.customers || [];
    S.admCustomersMeta = { page: csRes.page || 1, pages: csRes.pages || 1, total: csRes.total || S.admCustomers.length };
    S.admCategories = catRes.categories || [];
    S.coupons = cpnRes.coupons || [];
    S.admPayments = payRes.payments || [];
    S.admPaymentsSummary = payRes.summary || {};
    S.admPaymentsMeta = { page: payRes.page || 1, pages: payRes.pages || 1, total: payRes.total || S.admPayments.length };
    S.admRefunds = refRes.refunds || [];
    S.admReviews = revRes.reviews || [];
    S.admComplaints = cmpRes.complaints || [];
    S.admNotifs = ntfRes.notifications || [];
    S.admAuditLogs = audRes.logs || [];
    S.admAuditMeta = { page: audRes.page || 1, pages: audRes.pages || 1, total: audRes.total || S.admAuditLogs.length };
  };

  window.setAdmTab = function (tab) {
    S.admTab = tab || 'overview';
    render();
    scrollTo(0, 0);
  };

  function pagerHtml(meta, pageKey) {
    if (!meta || meta.pages <= 1) return '';
    return `<div class="row" style="margin-top:12px;justify-content:center;gap:10px">
      <button class="btn sm ghost" style="width:auto" ${meta.page <= 1 ? 'disabled' : ''} onclick="S.${pageKey}=${Math.max(1, meta.page - 1)};refresh().then(render)">${ic('arrowLeft', 14)} Prev</button>
      <span class="mut" style="font-size:12.5px">Page ${meta.page} of ${meta.pages} (${meta.total} records)</span>
      <button class="btn sm ghost" style="width:auto" ${meta.page >= meta.pages ? 'disabled' : ''} onclick="S.${pageKey}=${Math.min(meta.pages, meta.page + 1)};refresh().then(render)">Next ${ic('arrowRight', 14)}</button>
    </div>`;
  }

  window.adm = function () {
    const cur = S.admTab || 'overview';
    const u = S.user || { name: 'Founder Admin', phone: '' };
    const openComplaints = (S.admComplaints || []).filter((c) => c.status === 'open').length;
    const pendingVerif = S.admAnalytics?.pending_provider_verifications || 0;

    const navItems = [
      { id: 'overview', label: t('adm.overview'), icon: 'layoutDashboard' },
      { id: 'bookings', label: t('adm.bookings'), icon: 'list' },
      { id: 'techs', label: t('adm.providers'), icon: 'tool', badge: pendingVerif },
      { id: 'customers', label: t('adm.customers'), icon: 'users' },
      { id: 'catalog', label: t('adm.catalog'), icon: 'tag' },
      { id: 'payments', label: t('adm.payments'), icon: 'wallet' },
      { id: 'complaints', label: t('adm.support'), icon: 'alert', badge: openComplaints },
      { id: 'notifications', label: t('adm.notifications'), icon: 'bell' },
      { id: 'audit', label: t('adm.audit'), icon: 'shield' }
    ];

    return `<div class="adm-shell">
      <aside class="adm-sidebar" aria-label="Founder Admin navigation">
        <div style="padding:4px 4px 12px;border-bottom:1.5px solid var(--bd)">
          ${fmLogo({ size: 34, subtitle: t('adm.console_badge') })}
        </div>
        <nav class="adm-side-nav">
          ${navItems.map((it) => `
            <button class="adm-side-btn ${cur === it.id ? 'on' : ''}" onclick="setAdmTab('${it.id}')">
              <span class="lbl">${ic(it.icon, 16)} ${it.label}</span>
              ${it.badge ? `<span class="badge ${cur === it.id ? '' : 'warn'}" style="${cur === it.id ? 'background:rgba(255,255,255,0.22);color:#fff' : ''}">${it.badge}</span>` : ''}
            </button>
          `).join('')}
        </nav>
        <div style="margin-top:auto;padding-top:12px;border-top:1.5px solid var(--bd);display:flex;flex-direction:column;gap:8px">
          <div style="font-size:12px">
            <b>${esc(u.name)}</b>
            <div class="mut">${esc(u.email || u.phone)}</div>
          </div>
          <div class="row" style="gap:6px">
            <button class="btn sm ghost" style="flex:1" onclick="theme()" title="Toggle theme">${ic(isDarkTheme() ? 'sun' : 'moon', 15)}</button>
            <button class="btn sm ghost" style="flex:2;color:var(--bad)" onclick="out()">${ic('logOut', 15)} ${t('common.logout')}</button>
          </div>
        </div>
      </aside>

      <div class="adm-main">
        <div class="adm-hero">
          <div class="row">
            <div>
              <span class="brand-badge" style="margin:0 0 6px">${ic('shieldCheck', 13)} ${t('adm.console_badge')}</span>
              <h2 style="font-size:21px;margin:0 0 2px;color:#fff">${t('adm.console_title')}</h2>
              <div style="font-size:12.5px;opacity:0.9">${esc(u.name)} · Live Database Telemetry</div>
            </div>
            <div class="ics" style="flex-wrap:wrap;justify-content:flex-end">
              ${langSelectorHtml({ compact: true, onDark: true })}
              <button class="ic" onclick="refresh().then(render);toast('${t('adm.refresh')}')" title="${t('adm.refresh')}" aria-label="${t('adm.refresh')}">${ic('refresh', 18)}</button>
              <button class="ic" onclick="theme()" title="Toggle theme" aria-label="Toggle theme">${ic(isDarkTheme() ? 'sun' : 'moon', 18)}</button>
              <button class="btn sm ghost" style="background:rgba(255,255,255,0.16);color:#fff;border-color:rgba(255,255,255,0.3)" onclick="out()">
                ${ic('logOut', 15)} ${t('common.logout')}
              </button>
            </div>
          </div>
        </div>

        <div class="adm-subnav">
          ${navItems.map((it) => `
            <button class="chip ${cur === it.id ? 'on' : ''}" onclick="setAdmTab('${it.id}')">${ic(it.icon, 14)} ${it.label}</button>
          `).join('')}
        </div>

        ${cur === 'overview' ? admOverview() : ''}
        ${cur === 'bookings' ? admBookings() : ''}
        ${cur === 'techs' ? admProviders() : ''}
        ${cur === 'customers' ? admCustomers() : ''}
        ${cur === 'catalog' ? admCatalog() : ''}
        ${cur === 'payments' ? admPayments() : ''}
        ${cur === 'complaints' ? admSupportAndReviews() : ''}
        ${cur === 'notifications' ? admNotifications() : ''}
        ${cur === 'audit' ? admAuditAndSettings() : ''}
        ${renderAdminModal()}
      </div>
    </div>`;
  };

  function admOverview() {
    const an = S.admAnalytics || {};
    const revByCat = an.revenue_by_category || [];
    const maxCatRev = Math.max(1, ...revByCat.map((r) => Number(r.paid_revenue || 0)));

    return `
      <div class="adm-kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        <div class="adm-kpi-card highlight" onclick="setAdmTab('payments')" style="cursor:pointer">
          <span class="mut" style="font-size:11px;font-weight:700">${ic('trendingUp', 13)} GROSS REVENUE</span>
          <div class="adm-kpi-val" style="color:var(--pri)">${inr(an.total_revenue || 0)}</div>
          <div class="adm-kpi-sub">15% Cut: <b>${inr(an.platform_commission || 0)}</b> · Refunds: ${inr(an.total_refunds || 0)}</div>
        </div>
        <div class="adm-kpi-card" onclick="setAdmTab('customers')" style="cursor:pointer">
          <span class="mut" style="font-size:11px;font-weight:700">${ic('users', 13)} TOTAL CUSTOMERS</span>
          <div class="adm-kpi-val">${an.total_customers || 0}</div>
          <div class="adm-kpi-sub">Registered accounts</div>
        </div>
        <div class="adm-kpi-card" onclick="setAdmTab('techs')" style="cursor:pointer">
          <span class="mut" style="font-size:11px;font-weight:700">${ic('tool', 13)} TOTAL PROVIDERS</span>
          <div class="adm-kpi-val">${an.total_workers || 0}</div>
          <div class="adm-kpi-sub">${an.verified_workers || 0} approved · <b style="color:var(--warn)">${an.pending_provider_verifications || 0} pending KYC</b></div>
        </div>
        <div class="adm-kpi-card orange" onclick="setAdmTab('bookings')" style="cursor:pointer">
          <span class="mut" style="font-size:11px;font-weight:700">${ic('list', 13)} TOTAL BOOKINGS</span>
          <div class="adm-kpi-val">${an.total_bookings || 0}</div>
          <div class="adm-kpi-sub">All statuses combined</div>
        </div>
      </div>

      <div class="wk-kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(115px,1fr));margin-top:10px">
        <div class="wk-kpi-card" onclick="S.admBookingFilter='requested';setAdmTab('bookings')" style="cursor:pointer">
          <div class="wk-kpi-val" style="color:var(--warn)">${an.pending_bookings || 0}</div>
          <div class="wk-kpi-lbl">Pending</div>
        </div>
        <div class="wk-kpi-card" onclick="S.admBookingFilter='assigned';setAdmTab('bookings')" style="cursor:pointer">
          <div class="wk-kpi-val">${an.accepted_bookings || 0}</div>
          <div class="wk-kpi-lbl">Accepted</div>
        </div>
        <div class="wk-kpi-card" onclick="S.admBookingFilter='active';setAdmTab('bookings')" style="cursor:pointer">
          <div class="wk-kpi-val" style="color:var(--pri)">${an.active_bookings || 0}</div>
          <div class="wk-kpi-lbl">Active Jobs</div>
        </div>
        <div class="wk-kpi-card" onclick="S.admBookingFilter='completed';setAdmTab('bookings')" style="cursor:pointer">
          <div class="wk-kpi-val" style="color:var(--ok)">${an.completed_bookings || 0}</div>
          <div class="wk-kpi-lbl">Completed</div>
        </div>
        <div class="wk-kpi-card" onclick="S.admBookingFilter='cancelled';setAdmTab('bookings')" style="cursor:pointer">
          <div class="wk-kpi-val" style="color:var(--bad)">${an.cancelled_bookings || 0}</div>
          <div class="wk-kpi-lbl">Cancelled</div>
        </div>
      </div>

      <div class="adm-table-card" style="margin-top:12px">
        <div class="row" style="margin-bottom:10px">
          <b style="font-size:15px">${ic('barChart', 16)} Category Revenue Analytics (Real DB Data)</b>
          <button class="btn sm ghost" style="width:auto" onclick="downloadAdminCsv('bookings')">${ic('download', 14)} Export CSV</button>
        </div>
        ${revByCat.length ? revByCat.slice(0, 6).map((c) => {
          const pct = Math.round((Number(c.paid_revenue || 0) / maxCatRev) * 100);
          return `<div style="margin-bottom:10px">
            <div class="row" style="font-size:12.5px;margin-bottom:4px">
              <b>${esc(c.cat)}</b>
              <span class="mut">${c.bookings_count} bookings · <b>${inr(c.paid_revenue || 0)}</b></span>
            </div>
            <div style="height:7px;background:var(--soft);border-radius:999px;overflow:hidden">
              <div style="width:${pct}%;height:100%;background:var(--grad-hero);border-radius:999px"></div>
            </div>
          </div>`;
        }).join('') : '<div class="mut">No booking revenue recorded yet.</div>'}
      </div>

      <div class="adm-table-card" style="margin-top:12px">
        <div class="row" style="margin-bottom:10px">
          <b style="font-size:15px">${ic('award', 16)} Top Services</b>
          <button class="btn sm ghost" style="width:auto" onclick="setAdmTab('catalog')">Manage Catalog</button>
        </div>
        ${(an.top_services && an.top_services.length) ? an.top_services.map((s) => `
          <div class="adm-svc-row">
            <div><b>${esc(s.name)}</b><div class="mut" style="font-size:11px">${esc(s.cat)}</div></div>
            <div style="text-align:right"><b>${s.bookings_count} bookings</b><div class="mut" style="font-size:11px">${inr(s.total_revenue)}</div></div>
          </div>
        `).join('') : '<div class="mut">No services booked yet.</div>'}
      </div>
    `;
  }

  function admBookings() {
    const list = S.admBookings || [];
    const filter = S.admBookingFilter || 'all';

    return `
      <div class="card" style="margin-bottom:12px;padding:12px">
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <input id="adm-bk-q" placeholder="Search Booking #ID, customer, service..." value="${esc(S.admBookingQ || '')}" style="flex:2;min-width:180px;margin:0" onkeydown="if(event.key==='Enter'){S.admBookingQ=this.value;S.admBookingPage=1;refresh().then(render);}">
          <input id="adm-bk-dt" type="date" value="${esc(S.admBookingDate || '')}" style="flex:1;min-width:130px;margin:0" onchange="S.admBookingDate=this.value;S.admBookingPage=1;refresh().then(render)">
          <select style="flex:1;min-width:120px;margin:0" onchange="S.admBookingSort=this.value;S.admBookingPage=1;refresh().then(render)">
            <option value="newest" ${(S.admBookingSort || 'newest') === 'newest' ? 'selected' : ''}>Newest</option>
            <option value="oldest" ${S.admBookingSort === 'oldest' ? 'selected' : ''}>Oldest</option>
            <option value="amount_desc" ${S.admBookingSort === 'amount_desc' ? 'selected' : ''}>Highest Amount</option>
          </select>
          <button class="btn sm acc" style="width:auto" onclick="S.admBookingQ=$('adm-bk-q').value;S.admBookingPage=1;refresh().then(render)">${ic('search', 14)} Filter</button>
          <button class="btn sm ghost" style="width:auto" onclick="downloadAdminCsv('bookings')">${ic('download', 14)} CSV</button>
        </div>
      </div>

      <div class="chips" style="margin-bottom:12px">
        ${['all', 'requested', 'assigned', 'active', 'completed', 'cancelled'].map((st) => `
          <button class="chip ${filter === st ? 'on' : ''}" onclick="S.admBookingFilter='${st}';S.admBookingPage=1;refresh().then(render)">${st === 'all' ? 'All' : st.toUpperCase()}</button>
        `).join('')}
      </div>

      ${list.length ? list.map((b) => `
        <div class="adm-item-card">
          <div class="row">
            <div>
              <b>#${b.id} · ${esc(b.service_name || 'Service')}</b>
              <div class="mut" style="font-size:11.5px">${esc(b.cat || '')} · Created ${fmtDt(b.created_at)}</div>
            </div>
            <span class="adm-badge ${b.status}">${b.status.replace(/_/g, ' ')}</span>
          </div>
          <div class="mut" style="font-size:12.5px;margin:6px 0">
            Customer: <b>${esc(b.customer_name || 'Customer')}</b> (${esc(b.customer_phone || '')})<br>
            Slot: <b>${esc(b.scheduled_date ? `${b.scheduled_date} • ${b.scheduled_time || b.slot}` : b.slot)}</b><br>
            Location: ${esc(b.formatted_address || b.address || '')}
          </div>
          <div class="row" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--bd)">
            <div>
              ${b.worker_name ? `<span style="font-size:12px">Provider: <b>${esc(b.worker_name)}</b> (${esc(b.worker_phone || '')})</span>` : `<span class="adm-badge open">${ic('alertTriangle', 12)} Unassigned</span>`}
              ${b.tracking_active ? ` <span class="badge ok" style="font-size:10px">${ic('radio', 11)} Live GPS</span>` : ''}
            </div>
            <b>${inr(b.total || b.base_price || 0)} · <span style="color:${b.paid ? 'var(--ok)' : 'var(--warn)'}">${b.paid ? 'Paid' : 'Unpaid'}</span></b>
          </div>
          <div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">
            ${!['completed', 'closed', 'cancelled'].includes(b.status) ? `
              <button class="btn sm acc" style="width:auto" onclick="openAdminAssignModal(${b.id})">${ic('userCheck', 14)} ${b.worker_name ? 'Reassign' : 'Assign'}</button>
            ` : ''}
            ${['assigned', 'on_the_way', 'inspecting', 'quoted', 'in_progress'].includes(b.status) ? `
              <button class="btn sm ghost" style="width:auto" onclick="openTrackingModal(${b.id})">${ic('map', 14)} Track Live</button>
            ` : ''}
            <button class="btn sm ghost" style="width:auto" onclick="openAdminBookingHistory(${b.id})">${ic('clock', 14)} History</button>
            <button class="btn sm ghost" style="width:auto" onclick="openInvoiceModal(${b.id})">${ic('fileText', 14)} Invoice</button>
            ${!['completed', 'closed', 'cancelled'].includes(b.status) ? `
              <button class="btn sm ghost" style="width:auto;color:var(--bad)" onclick="adminCancelBooking(${b.id})">${ic('xCircle', 14)} Cancel</button>
            ` : ''}
          </div>
        </div>
      `).join('') : emptyBox('list', 'No matching bookings found', 'Filters change karke dobara check karein.')}
      ${pagerHtml(S.admBookingsMeta, 'admBookingPage')}
    `;
  }

  function admProviders() {
    const list = S.admProviders || [];
    const filter = S.admProvFilter || 'all';

    return `
      <div class="card" style="margin-bottom:12px;padding:12px">
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <input id="adm-pv-q" placeholder="Search provider name, phone, skill..." value="${esc(S.admProvQ || '')}" style="flex:2;min-width:180px;margin:0" onkeydown="if(event.key==='Enter'){S.admProvQ=this.value;S.admProvPage=1;refresh().then(render);}">
          <select style="flex:1;min-width:130px;margin:0" onchange="S.admProvSort=this.value;S.admProvPage=1;refresh().then(render)">
            <option value="newest" ${(S.admProvSort || 'newest') === 'newest' ? 'selected' : ''}>Newest</option>
            <option value="rating" ${S.admProvSort === 'rating' ? 'selected' : ''}>Top Rating</option>
            <option value="jobs" ${S.admProvSort === 'jobs' ? 'selected' : ''}>Completed Jobs</option>
            <option value="earnings" ${S.admProvSort === 'earnings' ? 'selected' : ''}>Highest Earnings</option>
          </select>
          <button class="btn sm acc" style="width:auto" onclick="S.admProvQ=$('adm-pv-q').value;S.admProvPage=1;refresh().then(render)">${ic('search', 14)} Search</button>
          <button class="btn sm ghost" style="width:auto" onclick="downloadAdminCsv('providers')">${ic('download', 14)} CSV</button>
        </div>
      </div>

      <div class="chips" style="margin-bottom:12px">
        ${['all', 'pending', 'approved', 'rejected', 'suspended'].map((st) => `
          <button class="chip ${filter === st ? 'on' : ''}" onclick="S.admProvFilter='${st}';S.admProvPage=1;refresh().then(render)">${st.toUpperCase()}</button>
        `).join('')}
      </div>

      ${list.length ? list.map((w) => {
        const vst = w.verification_status || (w.id_verified ? 'approved' : 'pending');
        return `<div class="adm-item-card">
          <div class="row">
            <div class="row" style="justify-content:flex-start;gap:10px">
              <span class="av" style="background:var(--pri-soft);color:var(--pri);border-radius:12px">${ic('tool', 20)}</span>
              <div>
                <b>${esc(w.name)}</b>
                <div class="mut" style="font-size:12px">${esc((w.service_categories || [w.skill]).join(', '))} · ${w.experience_years || 0} yrs exp</div>
              </div>
            </div>
            ${verifBadge(vst)}
          </div>
          <div class="mut" style="font-size:12px;margin:8px 0">
            Phone: <b>${esc(w.phone)}</b> ${w.email ? `· ${esc(w.email)}` : ''} · Availability: <b>${w.online ? 'Online' : 'Offline'}</b><br>
            Rating: <b>${w.avg_rating > 0 ? w.avg_rating : 'New'}</b> (${w.review_count || 0}) · Jobs Done: <b>${w.completed_jobs || 0}</b> · Earnings: <b>${inr(w.earnings || 0)}</b><br>
            Service Area: ${esc(w.service_areas || 'Not specified')}
            ${w.verification_doc_type ? ` · Doc: <b>${esc(w.verification_doc_type)}</b>` : ''}
          </div>
          <div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">
            ${w.id_document_url ? `<button class="btn sm ghost" style="width:auto" onclick="openAdminDocModal(${w.id})">${ic('fileText', 14)} View Doc</button>` : ''}
            ${vst !== 'approved' ? `<button class="btn sm acc" style="width:auto" onclick="adminVerifyProvider(${w.id}, 'approved')">${ic('checkCircle', 14)} ${vst === 'suspended' ? 'Reactivate' : 'Approve'}</button>` : ''}
            ${vst === 'pending' ? `<button class="btn sm ghost" style="width:auto;color:var(--bad)" onclick="openAdminVerifyAction(${w.id}, 'rejected')">${ic('xCircle', 14)} Reject</button>` : ''}
            ${vst !== 'suspended' ? `<button class="btn sm ghost" style="width:auto;color:var(--bad)" onclick="openAdminVerifyAction(${w.id}, 'suspended')">${ic('alertTriangle', 14)} Suspend</button>` : ''}
          </div>
        </div>`;
      }).join('') : emptyBox('tool', 'No providers found', 'Real registered service providers yahan dikhenge.')}
      ${pagerHtml(S.admProvidersMeta, 'admProvPage')}
    `;
  }

  function admCustomers() {
    const list = S.admCustomers || [];
    const filter = S.admCustFilter || 'all';

    return `
      <div class="card" style="margin-bottom:12px;padding:12px">
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <input id="adm-cs-q" placeholder="Search customer name, email, phone..." value="${esc(S.admCustQ || '')}" style="flex:2;min-width:180px;margin:0" onkeydown="if(event.key==='Enter'){S.admCustQ=this.value;S.admCustPage=1;refresh().then(render);}">
          <select style="flex:1;min-width:130px;margin:0" onchange="S.admCustSort=this.value;S.admCustPage=1;refresh().then(render)">
            <option value="newest" ${(S.admCustSort || 'newest') === 'newest' ? 'selected' : ''}>Newest Registered</option>
            <option value="name" ${S.admCustSort === 'name' ? 'selected' : ''}>Name A-Z</option>
            <option value="bookings" ${S.admCustSort === 'bookings' ? 'selected' : ''}>Most Bookings</option>
          </select>
          <button class="btn sm acc" style="width:auto" onclick="S.admCustQ=$('adm-cs-q').value;S.admCustPage=1;refresh().then(render)">${ic('search', 14)} Search</button>
          <button class="btn sm ghost" style="width:auto" onclick="downloadAdminCsv('customers')">${ic('download', 14)} CSV</button>
        </div>
      </div>

      <div class="chips" style="margin-bottom:12px">
        ${['all', 'active', 'suspended'].map((st) => `
          <button class="chip ${filter === st ? 'on' : ''}" onclick="S.admCustFilter='${st}';S.admCustPage=1;refresh().then(render)">${st.toUpperCase()}</button>
        `).join('')}
      </div>

      ${list.length ? list.map((c) => `
        <div class="adm-item-card">
          <div class="row">
            <div>
              <b>${esc(c.name)}</b>
              <div class="mut" style="font-size:12px">${esc(c.email || 'No email')} · ${esc(c.phone)}</div>
            </div>
            <span class="badge ${c.account_status === 'suspended' ? 'bad' : 'ok'}">${esc((c.account_status || 'active').toUpperCase())}</span>
          </div>
          <div class="mut" style="font-size:12px;margin:8px 0">
            Registered: <b>${fmtDt(c.created_at)}</b> · Bookings: <b>${c.bookings_count || 0}</b> · Total Spent: <b>${inr(c.total_spent || 0)}</b> · Wallet: <b>${inr(c.wallet || 0)}</b>
          </div>
          <div class="row" style="gap:8px">
            <button class="btn sm ghost" style="width:auto" onclick="openAdminCustomerHistory(${c.id})">${ic('list', 14)} Booking History</button>
            <button class="btn sm ${c.account_status === 'suspended' ? 'acc' : 'ghost'}" style="width:auto;${c.account_status === 'suspended' ? '' : 'color:var(--bad)'}" onclick="toggleCustomerStatus(${c.id}, '${c.account_status === 'suspended' ? 'active' : 'suspended'}')">
              ${ic(c.account_status === 'suspended' ? 'checkCircle' : 'alertTriangle', 14)} ${c.account_status === 'suspended' ? 'Reactivate' : 'Suspend'}
            </button>
          </div>
        </div>
      `).join('') : emptyBox('users', 'No customers found', 'Registered customer accounts yahan dikhenge.')}
      ${pagerHtml(S.admCustomersMeta, 'admCustPage')}
    `;
  }

  function admCatalog() {
    const tab = S.admCatalogTab || 'services';
    const cats = S.admCategories || [];
    const svcs = SV || [];
    const cpns = S.coupons || [];

    return `
      <div class="seg" style="margin-bottom:14px">
        <button class="pill ${tab === 'services' ? 'on' : ''}" onclick="S.admCatalogTab='services';render()">Services (${svcs.length})</button>
        <button class="pill ${tab === 'categories' ? 'on' : ''}" onclick="S.admCatalogTab='categories';render()">Categories (${cats.length})</button>
        <button class="pill ${tab === 'coupons' ? 'on' : ''}" onclick="S.admCatalogTab='coupons';render()">Coupons (${cpns.length})</button>
      </div>

      ${tab === 'categories' ? `
        <div class="card" style="margin-bottom:12px">
          <h3 style="margin:0 0 10px;font-size:16px">Add Service Category</h3>
          <div class="row" style="gap:8px;flex-wrap:wrap">
            <input id="adm-cat-name" placeholder="Category name (e.g. Solar Repair)" style="flex:2;min-width:170px;margin:0">
            <input id="adm-cat-desc" placeholder="Short description" style="flex:2;min-width:170px;margin:0">
            <button class="btn sm acc" style="width:auto" onclick="submitAdminAddCategory()">${ic('plus', 14)} Add Category</button>
          </div>
        </div>
        <div class="adm-table-card">
          ${cats.map((c) => `
            <div class="adm-svc-row">
              <div>
                <b>${esc(c.name)}</b> <span class="badge ${c.is_active ? 'ok' : 'bad'}" style="font-size:10px">${c.is_active ? 'Active' : 'Hidden'}</span>
                <div class="mut" style="font-size:11px">${c.service_count || 0} services · ${esc(c.description || '')}</div>
              </div>
              <button class="btn sm ghost" style="width:auto" onclick="toggleAdminCategory(${c.id}, ${c.is_active ? 0 : 1})">${c.is_active ? 'Disable' : 'Enable'}</button>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${tab === 'services' ? `
        <div class="row" style="margin-bottom:10px">
          <h3 style="margin:0;font-size:17px">Service Catalog (${svcs.length})</h3>
          <button class="btn sm acc" style="width:auto" onclick="openAdminAddServiceModal()">${ic('plus', 15)} Add Service</button>
        </div>
        <div class="adm-table-card">
          ${svcs.map((s) => `
            <div class="adm-svc-row">
              <div><b>${esc(s.n)}</b><div class="mut" style="font-size:11px">${esc(s.c)} · ${ic('star', 11, true)} ${s.r || 4.8}</div></div>
              <div class="row" style="gap:8px">
                <b style="color:var(--pri)">${inr(s.p)}</b>
                <button class="btn sm ghost" style="width:auto" onclick="openAdminEditPriceModal({ id: ${s.id}, name: '${esc(s.n).replace(/'/g, "\\'")}', cat: '${esc(s.c)}', price: ${s.p} })">${ic('edit', 13)} Edit</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${tab === 'coupons' ? `
        <div class="row" style="margin-bottom:10px">
          <h3 style="margin:0;font-size:17px">Promo Coupons (${cpns.length})</h3>
          <button class="btn sm acc" style="width:auto" onclick="openAdminAddCouponModal()">${ic('plus', 15)} Add Coupon</button>
        </div>
        <div class="adm-table-card">
          ${cpns.length ? cpns.map((c) => `
            <div class="adm-svc-row">
              <div><b>${esc(c.code)}</b><div class="mut" style="font-size:11px">${esc(c.title)} · Min ${inr(c.min_order_amount || 0)}</div></div>
              <div class="row" style="gap:8px">
                <span class="adm-badge open">${c.discount_type === 'percentage' ? c.discount_value + '% OFF' : inr(c.discount_value) + ' FLAT'}</span>
                ${c.id ? `<button class="btn sm ghost" style="width:auto;color:var(--bad)" onclick="deactivateCoupon(${c.id})">Deactivate</button>` : ''}
              </div>
            </div>
          `).join('') : '<div class="mut">No active coupons.</div>'}
        </div>
      ` : ''}
    `;
  }

  function admPayments() {
    const tab = S.admPayTab || 'ledger';
    const sum = S.admPaymentsSummary || {};
    const list = S.admPayments || [];
    const refunds = S.admRefunds || [];

    return `
      <div class="adm-kpi-grid" style="margin-bottom:12px">
        <div class="adm-kpi-card highlight">
          <span class="mut" style="font-size:11px;font-weight:700">COLLECTED PAYMENTS</span>
          <div class="adm-kpi-val" style="color:var(--ok)">${inr(sum.collected_revenue || 0)}</div>
          <div class="adm-kpi-sub">15% Platform Cut: ${inr(sum.platform_commission || 0)}</div>
        </div>
        <div class="adm-kpi-card">
          <span class="mut" style="font-size:11px;font-weight:700">PENDING COLLECTION</span>
          <div class="adm-kpi-val" style="color:var(--warn)">${inr(sum.pending_collection || 0)}</div>
          <div class="adm-kpi-sub">Completed & unpaid</div>
        </div>
      </div>

      <div class="seg" style="margin-bottom:12px">
        <button class="pill ${tab === 'ledger' ? 'on' : ''}" onclick="S.admPayTab='ledger';render()">Payment Ledger</button>
        <button class="pill ${tab === 'refunds' ? 'on' : ''}" onclick="S.admPayTab='refunds';render()">Refunds (${refunds.length})</button>
      </div>

      ${tab === 'ledger' ? `
        <div class="card" style="margin-bottom:12px;padding:12px">
          <div class="row" style="gap:8px;flex-wrap:wrap">
            <select style="flex:1;margin:0" onchange="S.admPayMode=this.value;S.admPayPage=1;refresh().then(render)">
              <option value="all" ${(S.admPayMode || 'all') === 'all' ? 'selected' : ''}>All Modes</option>
              <option value="wallet" ${S.admPayMode === 'wallet' ? 'selected' : ''}>Wallet</option>
              <option value="razorpay" ${S.admPayMode === 'razorpay' ? 'selected' : ''}>Razorpay Online</option>
              <option value="cash" ${S.admPayMode === 'cash' ? 'selected' : ''}>Cash</option>
            </select>
            <select style="flex:1;margin:0" onchange="S.admPayPaid=this.value;S.admPayPage=1;refresh().then(render)">
              <option value="" ${!S.admPayPaid ? 'selected' : ''}>All Status</option>
              <option value="1" ${S.admPayPaid === '1' ? 'selected' : ''}>Paid Only</option>
              <option value="0" ${S.admPayPaid === '0' ? 'selected' : ''}>Unpaid Only</option>
            </select>
            <button class="btn sm ghost" style="width:auto" onclick="downloadAdminCsv('payments')">${ic('download', 14)} Export CSV</button>
            <button class="btn sm acc" style="width:auto" onclick="openAdminRefundModal(null, null)">${ic('wallet', 14)} Issue Refund</button>
          </div>
        </div>

        ${list.length ? list.map((p) => `
          <div class="adm-item-card">
            <div class="row">
              <b>#${p.booking_id} · ${esc(p.service_name)}</b>
              <span class="badge ${p.paid ? 'ok' : 'warn'}">${p.paid ? 'PAID' : 'UNPAID'} · ${esc((p.pay || '').toUpperCase())}</span>
            </div>
            <div class="mut" style="font-size:12px;margin:4px 0">
              Customer: <b>${esc(p.customer_name)}</b> (${esc(p.customer_phone)}) · Amount: <b>${inr(p.total || p.base_price)}</b>
              ${p.gateway_payment_id ? `<br>Gateway Ref: <code>${esc(p.gateway_payment_id)}</code>` : ''}
            </div>
            <div class="row" style="margin-top:8px;gap:8px">
              <button class="btn sm ghost" style="width:auto" onclick="openInvoiceModal(${p.booking_id})">${ic('fileText', 14)} Invoice</button>
              <button class="btn sm ghost" style="width:auto" onclick="openAdminRefundModal(${p.booking_id}, ${p.customer_id})">${ic('repeat', 14)} Refund</button>
            </div>
          </div>
        `).join('') : emptyBox('wallet', 'No payment records found', 'Bookings aur payments yahan track hongi.')}
        ${pagerHtml(S.admPaymentsMeta, 'admPayPage')}
      ` : `
        <div class="row" style="margin-bottom:10px">
          <h3 style="margin:0;font-size:16px">Refund History</h3>
          <button class="btn sm acc" style="width:auto" onclick="openAdminRefundModal(null, null)">${ic('plus', 14)} New Refund</button>
        </div>
        ${refunds.length ? refunds.map((r) => `
          <div class="adm-item-card">
            <div class="row">
              <b>Refund #${r.id} · ${esc(r.customer_name)}</b>
              <span class="badge ok">${inr(r.amount)} · ${esc(r.status.toUpperCase())}</span>
            </div>
            <div class="mut" style="font-size:12px;margin-top:4px">
              ${r.booking_id ? `Booking #${r.booking_id} · ` : ''}Reason: ${esc(r.reason)}<br>
              By: ${esc(r.admin_name || 'Founder')} · ${fmtDt(r.created_at)}
            </div>
          </div>
        `).join('') : emptyBox('repeat', 'No refunds processed yet', 'Issued refunds yahan track honge.')}
      `}
    `;
  }

  function admSupportAndReviews() {
    const tab = S.admSuppTab || 'complaints';
    const cmpList = S.admComplaints || [];
    const revList = S.admReviews || [];

    return `
      <div class="seg" style="margin-bottom:12px">
        <button class="pill ${tab === 'complaints' ? 'on' : ''}" onclick="S.admSuppTab='complaints';render()">Support Tickets (${cmpList.length})</button>
        <button class="pill ${tab === 'reviews' ? 'on' : ''}" onclick="S.admSuppTab='reviews';render()">Reviews Moderation (${revList.length})</button>
      </div>

      ${tab === 'complaints' ? `
        ${cmpList.length ? cmpList.map((c) => `
          <div class="adm-item-card">
            <div class="row">
              <b>Ticket #${c.id}: ${esc(c.category)}</b>
              <span class="adm-badge ${c.status}">${c.status}</span>
            </div>
            <div class="mut" style="font-size:12px;margin:4px 0">
              Customer: <b>${esc(c.customer_name)}</b> (${esc(c.customer_phone)})
              ${c.booking_id ? ` · Booking #${c.booking_id}` : ''}
            </div>
            <div style="font-size:13px;margin:6px 0">${esc(c.description)}</div>
            ${c.resolution_notes ? `<div class="card" style="background:var(--soft);border:none;padding:8px 10px;font-size:12px"><b>Resolution:</b> ${esc(c.resolution_notes)} ${c.refund_amount ? `(Refunded ${inr(c.refund_amount)})` : ''}</div>` : ''}
            ${c.status !== 'resolved' && c.status !== 'closed' ? `
              <button class="btn sm acc" style="margin-top:8px;width:auto" onclick="openAdminResolveModal(${c.id})">${ic('checkCircle', 14)} Resolve & Issue Refund</button>
            ` : ''}
          </div>
        `).join('') : emptyBox('alert', 'No support tickets', 'Customer tickets yahan dikhengi.')}
      ` : `
        ${revList.length ? revList.map((r) => `
          <div class="adm-item-card">
            <div class="row">
              <b>${esc(r.service_name)} · ${ic('star', 13, true)} ${r.rating}/5</b>
              <span class="badge ${r.is_hidden ? 'bad' : 'ok'}">${r.is_hidden ? 'Hidden' : 'Public'}</span>
            </div>
            <div class="mut" style="font-size:12px;margin:4px 0">By <b>${esc(r.customer_name)}</b> -> Provider: <b>${esc(r.worker_name || 'N/A')}</b></div>
            ${r.comment ? `<div style="font-size:13px;margin:6px 0">"${esc(r.comment)}"</div>` : ''}
            <div class="row" style="gap:8px;margin-top:8px">
              <button class="btn sm ghost" style="width:auto" onclick="moderateAdminReview(${r.id}, ${r.is_hidden ? 0 : 1})">${r.is_hidden ? 'Unhide Review' : 'Hide Review'}</button>
              <button class="btn sm ghost" style="width:auto;color:var(--bad)" onclick="deleteAdminReview(${r.id})">${ic('trash', 14)} Delete</button>
            </div>
          </div>
        `).join('') : emptyBox('star', 'No reviews yet', 'Customer reviews moderation ke liye yahan aayengi.')}
      `}
    `;
  }

  function admNotifications() {
    const list = S.admNotifs || [];
    return `
      <div class="card" style="margin-bottom:14px">
        <h3 style="margin:0 0 10px;font-size:16px">${ic('send', 16)} Send Platform Announcement</h3>
        <label class="fm-lbl">Target Audience</label>
        <select id="adm-bc-target" style="margin:4px 0 10px">
          <option value="all">All Active Users (Customers + Providers)</option>
          <option value="customers">Customers Only</option>
          <option value="providers">Service Providers Only</option>
        </select>
        <label class="fm-lbl">Title</label>
        <input id="adm-bc-title" placeholder="e.g. Festive Service Offer / Maintenance Notice" style="margin:4px 0 10px">
        <label class="fm-lbl">Message</label>
        <textarea id="adm-bc-body" rows="3" placeholder="Notification message..." style="margin:4px 0 12px"></textarea>
        <button class="btn acc" onclick="sendAdminBroadcast()">${ic('send', 16)} Broadcast Notification</button>
      </div>

      <h3 style="margin:0 0 10px;font-size:16px">Recent Notifications Log (${list.length})</h3>
      ${list.length ? list.slice(0, 30).map((n) => `
        <div class="adm-item-card">
          <div class="row">
            <b>${esc(n.title)}</b>
            <span class="badge">${esc(n.user_role || '')} · ${esc(n.user_name || '')}</span>
          </div>
          <div class="mut" style="font-size:12px;margin-top:4px">${esc(n.body)}</div>
          <div class="mut" style="font-size:11px;margin-top:4px">${fmtDt(n.created_at)} · ${n.is_read ? 'Read' : 'Unread'}</div>
        </div>
      `).join('') : emptyBox('bell', 'No notifications sent yet', 'System aur broadcast notifications yahan dikhengi.')}
    `;
  }

  function admAuditAndSettings() {
    const tab = S.admAuditTab || 'logs';
    const logs = S.admAuditLogs || [];
    const u = S.user || {};

    return `
      <div class="seg" style="margin-bottom:12px">
        <button class="pill ${tab === 'logs' ? 'on' : ''}" onclick="S.admAuditTab='logs';render()">Audit Logs (${S.admAuditMeta?.total || logs.length})</button>
        <button class="pill ${tab === 'profile' ? 'on' : ''}" onclick="S.admAuditTab='profile';render()">Admin Profile & Settings</button>
      </div>

      ${tab === 'logs' ? `
        <div class="row" style="margin-bottom:10px;gap:8px;flex-wrap:wrap">
          <select style="flex:1;margin:0" onchange="S.admAuditFilter=this.value;S.admAuditPage=1;refresh().then(render)">
            <option value="all" ${(S.admAuditFilter || 'all') === 'all' ? 'selected' : ''}>All Targets</option>
            <option value="provider" ${S.admAuditFilter === 'provider' ? 'selected' : ''}>Providers</option>
            <option value="customer" ${S.admAuditFilter === 'customer' ? 'selected' : ''}>Customers</option>
            <option value="booking" ${S.admAuditFilter === 'booking' ? 'selected' : ''}>Bookings</option>
            <option value="refund" ${S.admAuditFilter === 'refund' ? 'selected' : ''}>Refunds</option>
            <option value="category" ${S.admAuditFilter === 'category' ? 'selected' : ''}>Categories</option>
            <option value="service" ${S.admAuditFilter === 'service' ? 'selected' : ''}>Services</option>
          </select>
          <button class="btn sm ghost" style="width:auto" onclick="downloadAdminCsv('audit-logs')">${ic('download', 14)} Export Audit CSV</button>
        </div>
        ${logs.length ? logs.map((l) => `
          <div class="adm-item-card">
            <div class="row">
              <b>${esc(l.action)}</b>
              <span class="badge">${esc(l.target_type)}${l.target_id ? ` #${l.target_id}` : ''}</span>
            </div>
            <div class="mut" style="font-size:12px;margin-top:4px">
              Admin: <b>${esc(l.admin_name || 'Founder')}</b> · ${fmtDt(l.created_at)}
              ${l.details_json ? `<div style="margin-top:4px;word-break:break-word"><code>${esc(l.details_json)}</code></div>` : ''}
            </div>
          </div>
        `).join('') : emptyBox('shield', 'No audit events recorded yet', 'Founder actions automatically log honge.')}
        ${pagerHtml(S.admAuditMeta, 'admAuditPage')}
      ` : `
        <div class="card" style="margin-bottom:12px">
          <h3 style="margin:0 0 10px;font-size:16px">${t('adm.profile_settings')}</h3>
          <div style="margin-bottom:12px">${langSelectorHtml()}</div>
          <label class="fm-lbl">${t('auth.full_name')}</label>
          <input id="adm-pf-name" value="${esc(u.name || '')}" style="margin:4px 0 10px">
          <label class="fm-lbl">Email</label>
          <input id="adm-pf-email" type="email" value="${esc(u.email || '')}" style="margin:4px 0 10px">
          <label class="fm-lbl">${t('cust.lang_settings')}</label>
          <select id="adm-pf-lang" style="margin:4px 0 12px" onchange="setLang(this.value)">
            <option value="en" ${(u.language || 'en') === 'en' ? 'selected' : ''}>English</option>
            <option value="hi" ${u.language === 'hi' ? 'selected' : ''}>Hindi (हिन्दी)</option>
            <option value="hinglish" ${u.language === 'hinglish' ? 'selected' : ''}>Hinglish</option>
          </select>
          <button class="btn acc" onclick="saveAdminProfile()">${ic('checkCircle', 16)} ${t('common.save')}</button>
        </div>

        <div class="card" style="margin-bottom:12px">
          <h3 style="margin:0 0 10px;font-size:16px">${t('cust.password_mgmt')}</h3>
          ${u.has_password ? `<input id="adm-pw-cur" type="password" placeholder="Current password" style="margin-bottom:8px">` : ''}
          <input id="adm-pw-new" type="password" placeholder="New password (min 8 chars)" style="margin-bottom:10px">
          <button class="btn sm acc" onclick="saveAdminPassword()">${ic('lock', 15)} ${u.has_password ? 'Change Password' : 'Set Password'}</button>
        </div>

        <button class="btn ghost" style="width:100%;color:var(--bad);margin-bottom:8px" onclick="out()">${ic('logOut', 16)} ${t('common.logout')}</button>
        <button class="btn sm ghost" style="width:100%" onclick="logoutAllDevices()">${ic('shield', 15)} Logout All Devices</button>
      `}
    `;
  }

  function renderAdminModal() {
    if (S.modal === 'adminBookingHist' && S.admHistoryData) {
      const { booking, history } = S.admHistoryData;
      return `<div class="modal-overlay" onclick="closeModal()">
        <div class="modal-sheet" onclick="event.stopPropagation()" style="max-height:85vh;overflow-y:auto">
          <div class="modal-header">
            <h3>${ic('clock', 18)} Booking #${booking.id} Audit Timeline</h3>
            <button class="modal-close" onclick="closeModal()">${ic('x', 18)}</button>
          </div>
          ${(history || []).length ? history.map((h) => `
            <div class="card" style="margin-bottom:8px;padding:10px">
              <div class="row"><b>${esc((h.old_status || 'start') + ' -> ' + h.new_status)}</b><span class="mut" style="font-size:11px">${fmtDt(h.created_at)}</span></div>
              <div class="mut" style="font-size:12px">By: ${esc(h.changed_by_name || 'System')} (${esc(h.changed_by_role || '')})</div>
              ${h.notes ? `<div style="font-size:12px;margin-top:4px">${esc(h.notes)}</div>` : ''}
            </div>
          `).join('') : '<div class="mut">No transition records yet.</div>'}
        </div>
      </div>`;
    }

    if (S.modal === 'adminCustomerHist' && S.admCustomerHistData) {
      const { customer, bookings } = S.admCustomerHistData;
      return `<div class="modal-overlay" onclick="closeModal()">
        <div class="modal-sheet" onclick="event.stopPropagation()" style="max-height:85vh;overflow-y:auto">
          <div class="modal-header">
            <h3>${ic('users', 18)} ${esc(customer.name)} · History</h3>
            <button class="modal-close" onclick="closeModal()">${ic('x', 18)}</button>
          </div>
          ${(bookings || []).length ? bookings.map((b) => `
            <div class="card" style="margin-bottom:8px;padding:10px">
              <div class="row"><b>#${b.id} · ${esc(b.service_name)}</b><span class="badge">${esc(b.status)}</span></div>
              <div class="mut" style="font-size:12px">${fmtDt(b.created_at)} · ${inr(b.total)} · ${b.paid ? 'Paid' : 'Unpaid'}</div>
            </div>
          `).join('') : '<div class="mut">No bookings found for this customer.</div>'}
        </div>
      </div>`;
    }

    if (S.modal === 'adminDocPreview' && S.admDocProvider) {
      const w = S.admDocProvider;
      return `<div class="modal-overlay" onclick="closeModal()">
        <div class="modal-sheet" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h3>${ic('fileText', 18)} KYC Doc: ${esc(w.name)}</h3>
            <button class="modal-close" onclick="closeModal()">${ic('x', 18)}</button>
          </div>
          <div class="mut" style="margin-bottom:10px">Document Type: <b>${esc(w.verification_doc_type || 'ID')}</b></div>
          ${String(w.id_document_url || '').startsWith('data:image')
            ? `<img src="${w.id_document_url}" style="width:100%;max-height:360px;object-fit:contain;border-radius:12px;border:1px solid var(--bd)" alt="KYC Document">`
            : `<div class="card" style="word-break:break-all">${esc(w.id_document_url || '')}</div>`}
        </div>
      </div>`;
    }

    if (S.modal === 'adminRefund') {
      return `<div class="modal-overlay" onclick="closeModal()">
        <div class="modal-sheet" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h3>${ic('wallet', 18)} Issue Customer Refund</h3>
            <button class="modal-close" onclick="closeModal()">${ic('x', 18)}</button>
          </div>
          <label class="fm-lbl">Booking ID (Optional if Customer ID filled)</label>
          <input id="adm-rf-bk" type="number" value="${S.admRefundBookingId || ''}" placeholder="Booking ID" style="margin:4px 0 10px">
          <label class="fm-lbl">Customer User ID</label>
          <input id="adm-rf-uid" type="number" value="${S.admRefundUserId || ''}" placeholder="Customer ID" style="margin:4px 0 10px">
          <label class="fm-lbl">Refund Amount (₹)</label>
          <input id="adm-rf-amt" type="number" min="1" placeholder="Amount in INR" style="margin:4px 0 10px">
          <label class="fm-lbl">Reason</label>
          <input id="adm-rf-reason" placeholder="Reason for refund" style="margin:4px 0 12px">
          <button class="btn acc" onclick="submitAdminRefund()">${ic('checkCircle', 16)} Credit Refund to Wallet</button>
        </div>
      </div>`;
    }
    return '';
  }

  window.adminVerifyProvider = function (id, status) {
    act(async () => {
      const res = await api('POST', `/admin/technicians/${id}/verify`, { status, verified: status === 'approved' });
      await refresh();
      render();
      toast(res.message);
    });
  };

  window.openAdminVerifyAction = function (id, status) {
    const notes = prompt(`Enter reason/notes to set provider status to "${status}":`);
    if (notes === null) return;
    act(async () => {
      const res = await api('POST', `/admin/technicians/${id}/verify`, { status, verified: false, notes: notes.trim() || `Marked ${status} by Founder` });
      await refresh();
      render();
      toast(res.message);
    });
  };

  window.openAdminDocModal = function (id) {
    S.admDocProvider = (S.admProviders || []).find((p) => p.id === id) || null;
    S.modal = 'adminDocPreview';
    render();
  };

  window.openAdminBookingHistory = async function (id) {
    try {
      const res = await api('GET', `/admin/bookings/${id}/history`);
      S.admHistoryData = res;
      S.modal = 'adminBookingHist';
      render();
    } catch (e) { toast(e.message); }
  };

  window.adminCancelBooking = function (id) {
    const reason = prompt('Enter cancellation reason:');
    if (!reason || reason.trim().length < 2) return;
    act(async () => {
      const res = await api('POST', `/admin/bookings/${id}/cancel`, { reason: reason.trim() });
      await refresh();
      render();
      toast(res.message);
    });
  };

  window.openAdminCustomerHistory = async function (id) {
    try {
      const res = await api('GET', `/admin/customers/${id}/bookings`);
      S.admCustomerHistData = res;
      S.modal = 'adminCustomerHist';
      render();
    } catch (e) { toast(e.message); }
  };

  window.toggleCustomerStatus = function (id, status) {
    act(async () => {
      const res = await api('POST', `/admin/customers/${id}/status`, { status });
      await refresh();
      render();
      toast(res.message);
    });
  };

  window.submitAdminAddCategory = function () {
    const name = ($('adm-cat-name')?.value || '').trim();
    const description = ($('adm-cat-desc')?.value || '').trim();
    if (name.length < 2) return toast('Category name likhein');
    act(async () => {
      const res = await api('POST', '/admin/categories', { name, description });
      if (!CATS.includes(res.category.name)) CATS.push(res.category.name);
      await refresh();
      render();
      toast(res.message);
    });
  };

  window.toggleAdminCategory = function (id, is_active) {
    act(async () => {
      const res = await api('PUT', `/admin/categories/${id}`, { is_active: Boolean(is_active) });
      await refresh();
      render();
      toast(res.message);
    });
  };

  window.openAdminRefundModal = function (bookingId, userId) {
    S.admRefundBookingId = bookingId || '';
    S.admRefundUserId = userId || '';
    S.modal = 'adminRefund';
    render();
  };

  window.submitAdminRefund = function () {
    const booking_id = +$('adm-rf-bk')?.value || null;
    const user_id = +$('adm-rf-uid')?.value || null;
    const amount = +$('adm-rf-amt')?.value || 0;
    const reason = ($('adm-rf-reason')?.value || '').trim();
    if (!amount || amount <= 0) return toast('Valid refund amount daalein');
    if (reason.length < 3) return toast('Refund reason likhein');
    act(async () => {
      const res = await api('POST', '/admin/refunds', { booking_id, user_id, amount, reason });
      await refresh();
      closeModal();
      toast(res.message);
    });
  };

  window.moderateAdminReview = function (id, hidden) {
    act(async () => {
      const res = await api('POST', `/admin/reviews/${id}/moderate`, { hidden: Boolean(hidden) });
      await refresh();
      render();
      toast(res.message);
    });
  };

  window.deleteAdminReview = function (id) {
    if (!confirm('Kya aap is review ko permanently delete karna chahte hain?')) return;
    act(async () => {
      const res = await api('DELETE', `/admin/reviews/${id}`);
      await refresh();
      render();
      toast(res.message);
    });
  };

  window.sendAdminBroadcast = function () {
    const target = $('adm-bc-target')?.value || 'all';
    const title = ($('adm-bc-title')?.value || '').trim();
    const body = ($('adm-bc-body')?.value || '').trim();
    if (!title || body.length < 3) return toast('Title aur message likhein');
    act(async () => {
      const res = await api('POST', '/admin/notifications/broadcast', { target, title, body });
      await refresh();
      render();
      toast(res.message);
    });
  };

  window.saveAdminProfile = function () {
    const name = ($('adm-pf-name')?.value || '').trim();
    const email = ($('adm-pf-email')?.value || '').trim();
    const language = $('adm-pf-lang')?.value || 'en';
    act(async () => {
      const res = await api('PUT', '/me/profile', { name, email, language });
      S.user = res.user;
      if (res.user?.language && typeof setLang === 'function') await setLang(res.user.language, false);
      render();
      toast(res.message || t('val.profile_saved'));
    });
  };

  window.saveAdminPassword = function () {
    const current_password = $('adm-pw-cur')?.value || undefined;
    const new_password = ($('adm-pw-new')?.value || '').trim();
    if (new_password.length < 8) return toast('Password kam se kam 8 characters ka ho');
    act(async () => {
      const res = await api('PUT', '/me/password', { current_password, new_password });
      S.user.has_password = true;
      render();
      toast(res.message || 'Password updated');
    });
  };
})();
