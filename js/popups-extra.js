/* ============================================================
   PARAMOUNT E-MART — POPUPS EXTRA  v2.0
   Support popup, Courses popup, Receipt popup,
   Category share, Product share, all fixed & working
   ============================================================ */

'use strict';

/* ── SUPPORT POPUP ─────────────────────────────────────────── */

function openSupportPopup() {
  _clearSupportForm();
  openPopup('supportOverlay', 'supportPopup');
}
function closeSupportPopup() {
  closePopup('supportOverlay', 'supportPopup');
}

function _clearSupportForm() {
  ['spName','spEmail','spOrder','spDescription'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var cat = document.getElementById('spCategory');
  var pri = document.getElementById('spPriority');
  if (cat) cat.value = '';
  if (pri) pri.value = '';
  var msg = document.getElementById('spFormMsg');
  if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
}

function submitSupportTicket() {
  var name     = (document.getElementById('spName')?.value        || '').trim();
  var email    = (document.getElementById('spEmail')?.value       || '').trim();
  var category = (document.getElementById('spCategory')?.value    || '').trim();
  var priority = (document.getElementById('spPriority')?.value    || '').trim();
  var desc     = (document.getElementById('spDescription')?.value || '').trim();
  var order    = (document.getElementById('spOrder')?.value       || '').trim();

  var msg = document.getElementById('spFormMsg');

  function showMsg(text, type) {
    if (!msg) return;
    msg.style.display = 'block';
    msg.className = 'pes-form-msg pes-form-msg--' + type;
    msg.innerHTML = text;
  }

  if (!name)     { showMsg('⚠ Please enter your full name.', 'error');            return; }
  if (!email || !email.includes('@')) { showMsg('⚠ Please enter a valid email.', 'error'); return; }
  if (!category) { showMsg('⚠ Please select an issue category.', 'error');        return; }
  if (!priority) { showMsg('⚠ Please select a priority level.', 'error');         return; }
  if (desc.length < 20) { showMsg('⚠ Please describe your issue in more detail (at least 20 characters).', 'error'); return; }

  var ticketId = 'TKT-' + Date.now();
  var ticket = {
    id: ticketId, name: name, email: email,
    order: order, category: category, priority: priority,
    description: desc, status: 'Open',
    date: new Date().toISOString()
  };

  // Save to localStorage for admin
  try {
    var tickets = JSON.parse(localStorage.getItem('pes_support_tickets') || '[]');
    tickets.unshift(ticket);
    localStorage.setItem('pes_support_tickets', JSON.stringify(tickets));
  } catch(e) {}

  // Try Google Sheets
  var gasUrl = localStorage.getItem('pes_gsheet_url');
  if (gasUrl) {
    try {
      fetch(gasUrl, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheet: 'SupportTickets',
          timestamp: new Date().toISOString(),
          data: ticket
        })
      }).catch(function(){});
    } catch(e) {}
  }

  // Send WhatsApp notification to owner
  var waText = encodeURIComponent(
    '🎟 *Support Ticket — Paramount E-mart*\n' +
    '━━━━━━━━━━━━━━━━\n' +
    '*Ticket:* ' + ticketId + '\n' +
    '*Name:* ' + name + '\n' +
    '*Email:* ' + email + '\n' +
    (order ? '*Order:* ' + order + '\n' : '') +
    '*Category:* ' + category + '\n' +
    '*Priority:* ' + priority + '\n' +
    '━━━━━━━━━━━━━━━━\n' +
    '*Issue:*\n' + desc
  );
  var ownerPhone = (localStorage.getItem('pes_business_phone') || '2349160439848').replace(/[^0-9]/g, '');
  setTimeout(function() {
    window.open('https://wa.me/' + ownerPhone + '?text=' + waText, '_blank', 'noopener');
  }, 600);

  showMsg(
    '✓ <strong>Ticket ' + ticketId + ' submitted!</strong> Our team will respond within 24 hours. ' +
    'You may also have been redirected to WhatsApp — send the message to ensure fastest response.',
    'success'
  );

  // Clear form after success
  setTimeout(function() {
    _clearSupportForm();
    if (msg) msg.style.display = 'none';
  }, 6000);
}


/* ── COURSES POPUP ─────────────────────────────────────────── */

function openCoursesPopup() {
  renderCoursesGrid();
  openPopup('coursesOverlay', 'coursesPopup');
}
function closeCoursesPopup() {
  closePopup('coursesOverlay', 'coursesPopup');
}

function renderCoursesGrid() {
  var grid = document.getElementById('coursesGridPopup');
  if (!grid) return;

  var courses = [];
  try { courses = JSON.parse(localStorage.getItem('pes_courses') || '[]'); } catch(e) {}

  if (!courses.length) {
    grid.innerHTML = [
      '<div style="grid-column:1/-1;text-align:center;padding:80px 32px;">',
        '<div style="font-size:56px;margin-bottom:20px;">🎓</div>',
        '<div style="font-family:var(--font-display);font-size:28px;font-weight:300;margin-bottom:12px;">No Courses Yet</div>',
        '<p style="color:var(--gray);font-size:13px;max-width:360px;margin:0 auto 24px;line-height:1.8;">',
          'We\'re working on exciting new courses. Check back soon or follow us on social media for updates.',
        '</p>',
        '<a href="https://wa.me/2349160439848?text=' + encodeURIComponent('Hi! I\'d like to know when new courses are available on Paramount E-mart.') + '"',
          ' target="_blank" rel="noopener" class="hero-cta" style="display:inline-block;">',
          'Get Notified on WhatsApp →',
        '</a>',
      '</div>'
    ].join('');
    return;
  }

  grid.innerHTML = courses.map(function(c, i) {
    return buildCourseCard(c, i);
  }).join('');
}

function buildCourseCard(c, i) {
  var levelColors = { Beginner: '#4caf50', Intermediate: '#ff9800', Advanced: '#e53935', 'All Levels': '#7986cb' };
  var levelColor = levelColors[c.level] || '#666';
  var thumb = c.thumbnail || c.image || 'images/logo.png';
  var price = c.price ? ('₦' + Number(c.price).toLocaleString()) : 'Free';
  var origPrice = c.originalPrice ? ('₦' + Number(c.originalPrice).toLocaleString()) : '';

  return [
    '<div class="course-card" style="animation-delay:' + (i * 0.05) + 's" onclick="openCourseDetail(' + JSON.stringify(c.id) + ')">',
      '<div class="course-thumb-wrap">',
        '<img src="' + thumb + '" alt="' + (c.title || '') + '" class="course-thumb" onerror="this.src=\'images/logo.png\'" loading="lazy"/>',
        c.level ? '<span class="course-level-badge" style="background:' + levelColor + '22;color:' + levelColor + ';border-color:' + levelColor + '44;">' + c.level + '</span>' : '',
        c.featured ? '<span class="course-featured-badge">⭐ Featured</span>' : '',
      '</div>',
      '<div class="course-info">',
        '<div class="course-category">' + (c.category || 'Online Course') + '</div>',
        '<div class="course-title">' + (c.title || '') + '</div>',
        '<div class="course-desc">' + ((c.description || '').replace(/<[^>]+>/g, '').substring(0, 100)) + (c.description && c.description.replace(/<[^>]+>/g,'').length > 100 ? '…' : '') + '</div>',
        '<div class="course-meta">',
          c.duration ? '<span>⏱ ' + c.duration + '</span>' : '',
          c.lessons  ? '<span>📖 ' + c.lessons + ' lessons</span>' : '',
          c.students ? '<span>👥 ' + Number(c.students).toLocaleString() + ' students</span>' : '',
        '</div>',
        '<div class="course-footer">',
          '<div class="course-price-wrap">',
            '<div class="course-price">' + price + '</div>',
            origPrice ? '<div class="course-orig-price">' + origPrice + '</div>' : '',
          '</div>',
          '<div class="course-actions" onclick="event.stopPropagation()">',
            '<button class="btn-add-cart course-enroll-btn" onclick="openCourseDetail(' + JSON.stringify(c.id) + ')">',
              'View Course',
            '</button>',
          '</div>',
        '</div>',
      '</div>',
    '</div>'
  ].join('');
}

function openCourseDetail(courseId) {
  var courses = [];
  try { courses = JSON.parse(localStorage.getItem('pes_courses') || '[]'); } catch(e) {}
  var c = courses.find(function(x) { return x.id === courseId || String(x.id) === String(courseId); });
  if (!c) { showToast('Course not found'); return; }

  var thumb = c.thumbnail || c.image || 'images/logo.png';
  var price = c.price ? ('₦' + Number(c.price).toLocaleString()) : 'Free';
  var origPrice = c.originalPrice ? ('₦' + Number(c.originalPrice).toLocaleString()) : '';
  var levelColors = { Beginner: '#4caf50', Intermediate: '#ff9800', Advanced: '#e53935', 'All Levels': '#7986cb' };
  var levelColor = levelColors[c.level] || '#666';

  // Payment link logic
  var paymentLink = c.paymentLink || '';
  var isFree = !c.price || Number(c.price) === 0;
  var payBtnHtml;
  if (isFree) {
    payBtnHtml = '<a href="' + (paymentLink || '#') + '" target="_blank" rel="noopener" class="hero-cta" style="display:inline-block;width:100%;text-align:center;box-sizing:border-box;">Enroll Free →</a>';
  } else if (paymentLink) {
    payBtnHtml = '<a href="' + paymentLink + '" target="_blank" rel="noopener" class="hero-cta" style="display:inline-block;width:100%;text-align:center;box-sizing:border-box;">Pay &amp; Enroll — ' + price + ' →</a>';
  } else {
    // Use WhatsApp to enroll
    var waMsg = encodeURIComponent('Hi! I\'d like to enroll in the course: ' + c.title + ' (' + price + '). Please guide me on payment.');
    payBtnHtml = '<a href="https://wa.me/2349160439848?text=' + waMsg + '" target="_blank" rel="noopener" class="hero-cta" style="display:inline-block;width:100%;text-align:center;box-sizing:border-box;">Enroll via WhatsApp →</a>';
  }

  // Share link
  var shareUrl = window.location.origin + window.location.pathname + '?course=' + encodeURIComponent(c.id);
  var waShareText = encodeURIComponent('🎓 *' + c.title + '*\n' + price + '\n\nEnroll here:\n' + shareUrl);

  var body = document.getElementById('courseDetailBody');
  if (!body) return;

  body.innerHTML = [
    '<div class="course-detail-inner">',
      '<div class="course-detail-media">',
        '<img src="' + thumb + '" alt="' + (c.title || '') + '" class="course-detail-thumb" onerror="this.src=\'images/logo.png\'"/>',
        c.level ? '<div class="course-detail-level" style="color:' + levelColor + ';">' + c.level + '</div>' : '',
      '</div>',
      '<div class="course-detail-info">',
        '<div class="course-detail-category">' + (c.category || 'Online Course') + '</div>',
        '<h2 class="course-detail-title">' + (c.title || '') + '</h2>',
        '<div class="course-detail-meta">',
          c.duration ? '<span>⏱ ' + c.duration + '</span>' : '',
          c.lessons  ? '<span>📖 ' + c.lessons + ' lessons</span>' : '',
          c.students ? '<span>👥 ' + Number(c.students).toLocaleString() + ' enrolled</span>' : '',
          c.rating   ? '<span>★ ' + c.rating + '/5</span>' : '',
        '</div>',
        '<div class="course-detail-desc">' + (c.description || 'No description available.') + '</div>',
        c.whatYouLearn && c.whatYouLearn.length ? [
          '<div class="course-what-learn">',
            '<h4>What You\'ll Learn</h4>',
            '<ul>' + c.whatYouLearn.map(function(item) { return '<li>' + item + '</li>'; }).join('') + '</ul>',
          '</div>'
        ].join('') : '',
        '<div class="course-detail-price-row">',
          '<div>',
            '<div class="course-detail-price">' + price + '</div>',
            origPrice ? '<div class="course-detail-orig">' + origPrice + ' <span style="color:#4caf50;font-size:11px;">SAVE ' + Math.round((1 - c.price/c.originalPrice)*100) + '%</span></div>' : '',
          '</div>',
          '<div class="course-detail-share">',
            '<button class="modal-share-btn" onclick="shareCourse(' + JSON.stringify(c.id) + ')">',
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
              ' Share',
            '</button>',
          '</div>',
        '</div>',
        '<div class="course-detail-enroll">',
          payBtnHtml,
        '</div>',
        '<div id="courseSharePanel_' + c.id + '"></div>',
      '</div>',
    '</div>'
  ].join('');

  document.getElementById('courseDetailModal').classList.add('open');
  document.getElementById('courseDetailOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCourseDetail() {
  var modal = document.getElementById('courseDetailModal');
  var overlay = document.getElementById('courseDetailOverlay');
  if (modal) modal.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

function shareCourse(courseId) {
  var courses = [];
  try { courses = JSON.parse(localStorage.getItem('pes_courses') || '[]'); } catch(e) {}
  var c = courses.find(function(x) { return x.id === courseId || String(x.id) === String(courseId); });
  if (!c) return;

  var shareUrl = window.location.origin + window.location.pathname + '?course=' + encodeURIComponent(c.id);
  var price = c.price ? ('₦' + Number(c.price).toLocaleString()) : 'Free';
  var waText = encodeURIComponent('🎓 *' + c.title + '*\n' + price + ' · ' + (c.level || 'All Levels') + '\n\n' + (c.description || '').replace(/<[^>]+>/g, '').substring(0, 120) + '\n\nEnroll here:\n' + shareUrl);
  var xText = encodeURIComponent('🎓 ' + c.title + ' — ' + price + ' at Paramount E-mart ' + shareUrl);

  var panelId = 'courseSharePanel_' + c.id;
  var existing = document.getElementById(panelId);
  if (!existing) return;

  if (existing.innerHTML.trim()) { existing.innerHTML = ''; return; }

  existing.innerHTML = [
    '<div class="product-share-panel" style="margin-top:16px;">',
      '<div class="psp-head">',
        '<span class="psp-title">Share This Course</span>',
        '<button class="psp-close" onclick="document.getElementById(\'' + panelId + '\').innerHTML=\'\'">✕</button>',
      '</div>',
      '<div class="psp-link-row">',
        '<input class="psp-link-input" type="text" value="' + shareUrl + '" readonly onclick="this.select()"/>',
        '<button class="psp-copy-btn" onclick="copyShareLink(\'' + shareUrl + '\')">Copy</button>',
      '</div>',
      '<div class="psp-channels">',
        '<a class="psp-channel psp-wa" href="https://wa.me/?text=' + waText + '" target="_blank" rel="noopener">',
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2.07 21.5l4.43-1.393A9.953 9.953 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.95 7.95 0 01-4.073-1.117l-.292-.174-3.03.953.947-2.96-.19-.305A7.96 7.96 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/></svg>',
          ' WhatsApp',
        '</a>',
        '<a class="psp-channel psp-x" href="https://twitter.com/intent/tweet?text=' + xText + '" target="_blank" rel="noopener">',
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
          ' Post on X',
        '</a>',
        '<button class="psp-channel psp-copy2" onclick="copyShareLink(\'' + shareUrl + '\')">',
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
          ' Copy Link',
        '</button>',
      '</div>',
    '</div>'
  ].join('');
}

function openCourseCatalogueShare() {
  var shareUrl = window.location.origin + window.location.pathname + '?courses=all';
  var waText = encodeURIComponent('🎓 Browse all courses at Paramount E-mart:\n' + shareUrl);
  var xText  = encodeURIComponent('Browse all online courses at Paramount E-mart ' + shareUrl);

  // Reuse the catalogue share popup if available
  var inp = document.getElementById('catalogueLinkInput');
  var sel = document.getElementById('catShareSelect');
  if (inp && sel) {
    inp.value = shareUrl;
    var title = document.querySelector('#catalogueSharePopup .popup-title');
    if (title) title.textContent = 'Share Courses Catalogue';
    var ch = document.getElementById('catShareChannels');
    if (ch) {
      ch.innerHTML =
        '<a class="psp-channel psp-wa" href="https://wa.me/?text=' + waText + '" target="_blank" rel="noopener">WhatsApp</a>' +
        '<a class="psp-channel psp-x" href="https://twitter.com/intent/tweet?text=' + xText + '" target="_blank" rel="noopener">Post on X</a>' +
        '<button class="psp-channel psp-copy2" onclick="copyShareLink(\'' + shareUrl + '\')">Copy Link</button>';
    }
    openPopup('catalogueShareOverlay', 'catalogueSharePopup');
  } else {
    copyShareLink(shareUrl);
  }
}

// Handle ?course= URL param
function handleCourseLinkParam() {
  var params = new URLSearchParams(window.location.search);
  var courseParam = params.get('course');
  if (!courseParam) return;
  setTimeout(function() {
    openCoursesPopup();
    setTimeout(function() { openCourseDetail(decodeURIComponent(courseParam)); }, 300);
  }, 600);
}


/* ── RECEIPT POPUP ──────────────────────────────────────────── */

function openReceiptPopup(orderId) {
  var orders = typeof getOrders === 'function' ? getOrders() : [];
  var order = orders.find(function(o) { return o.id === orderId; });
  if (!order) { showToast('Receipt not found'); return; }
  _renderReceipt(order);
  openPopup('receiptOverlay', 'receiptPopup');
}
function closeReceiptPopup() {
  closePopup('receiptOverlay', 'receiptPopup');
}

function _renderReceipt(o) {
  var body = document.getElementById('receiptPopupBody');
  if (!body) return;
  var items = (o.items || []).map(function(i) {
    return [
      '<div class="rcpt-item">',
        '<div class="rcpt-item-name">' + i.name + ' <span style="color:var(--gray);">×' + i.qty + '</span></div>',
        '<div class="rcpt-item-price">' + (typeof formatPrice === 'function' ? formatPrice(i.price * i.qty) : '₦' + (i.price * i.qty).toLocaleString()) + '</div>',
      '</div>'
    ].join('');
  }).join('');

  body.innerHTML = [
    '<div class="rcpt-inner">',
      '<div class="rcpt-brand-row">',
        '<img src="images/logo.png" alt="Paramount E-mart" style="height:36px;object-fit:contain;" onerror="this.style.display=\'none\'"/>',
        '<div class="rcpt-badge"><div class="rcpt-badge-dot"></div>PAYMENT CONFIRMED</div>',
      '</div>',
      '<div class="rcpt-title">Order Receipt</div>',
      '<div class="rcpt-subtitle">' + o.date + ' · Ref: ' + (o.reference || o.id) + '</div>',
      '<div class="rcpt-section">',
        '<div class="rcpt-section-title">Customer Details</div>',
        '<div class="rcpt-detail-row"><span>Name</span><span>' + o.customer + '</span></div>',
        '<div class="rcpt-detail-row"><span>Email</span><span>' + o.email + '</span></div>',
        o.phone ? '<div class="rcpt-detail-row"><span>Phone</span><span>' + o.phone + '</span></div>' : '',
        o.address ? '<div class="rcpt-detail-row"><span>Delivery Address</span><span>' + o.address + '</span></div>' : '',
      '</div>',
      '<div class="rcpt-section">',
        '<div class="rcpt-section-title">Items Ordered</div>',
        items,
      '</div>',
      '<div class="rcpt-section rcpt-totals">',
        o.deliveryFee ? '<div class="rcpt-detail-row"><span>Delivery</span><span>' + (typeof formatPrice === 'function' ? formatPrice(o.deliveryFee) : '₦' + o.deliveryFee.toLocaleString()) + '</span></div>' : '',
        o.promoCode ? '<div class="rcpt-detail-row" style="color:#4caf50;"><span>Promo (' + o.promoCode + ')</span><span>Applied</span></div>' : '',
        '<div class="rcpt-total-row"><span>Total Paid</span><span>' + (typeof formatPrice === 'function' ? formatPrice(o.total) : '₦' + o.total.toLocaleString()) + '</span></div>',
      '</div>',
      o.trackingId ? [
        '<div class="rcpt-tracking-box">',
          '<div class="rcpt-tracking-label">Your Tracking ID</div>',
          '<div class="rcpt-tracking-id">' + o.trackingId + '</div>',
          '<a href="tracking.html?id=' + o.trackingId + '" class="rcpt-track-btn">Track My Order →</a>',
        '</div>'
      ].join('') : '',
      '<p class="rcpt-footer-note">Thank you for shopping with Paramount E-mart. Questions? Call +234 916 043 9848 or WhatsApp us anytime.</p>',
    '</div>'
  ].join('');
}

function printReceipt() {
  var body = document.getElementById('receiptPopupBody');
  if (!body) return;
  var win = window.open('', '_blank');
  win.document.write([
    '<!DOCTYPE html><html><head><meta charset="UTF-8"/>',
    '<title>Receipt — Paramount E-mart</title>',
    '<style>',
    'body{font-family:Arial,sans-serif;color:#111;padding:32px;max-width:600px;margin:0 auto;}',
    '.rcpt-brand-row{display:flex;justify-content:space-between;margin-bottom:24px;}',
    '.rcpt-title{font-size:24px;font-weight:bold;margin-bottom:4px;}',
    '.rcpt-subtitle{font-size:12px;color:#666;margin-bottom:24px;}',
    '.rcpt-section{margin-bottom:20px;border-bottom:1px solid #eee;padding-bottom:16px;}',
    '.rcpt-section-title{font-size:10px;font-weight:bold;letter-spacing:0.2em;text-transform:uppercase;color:#666;margin-bottom:12px;}',
    '.rcpt-detail-row,.rcpt-item{display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;}',
    '.rcpt-total-row{display:flex;justify-content:space-between;font-size:16px;font-weight:bold;margin-top:8px;}',
    '.rcpt-tracking-box{background:#f0f9f0;border:1px solid #4caf50;padding:16px;margin:20px 0;text-align:center;}',
    '.rcpt-tracking-id{font-size:22px;font-weight:bold;margin:8px 0;}',
    '.rcpt-footer-note{font-size:11px;color:#666;margin-top:20px;text-align:center;}',
    '@media print{body{padding:16px;}}',
    '</style>',
    '</head><body>',
    body.innerHTML,
    '</body></html>'
  ].join(''));
  win.document.close();
  setTimeout(function() { win.print(); }, 400);
}


/* ── ENHANCED PRODUCT SHARE ─────────────────────────────────── */

// Improved shareProduct that works inside or outside modal
window.shareProduct = function(id) {
  var p = typeof getProducts === 'function' ? getProducts().find(function(x) { return x.id === id; }) : null;
  if (!p) return;
  var serial = typeof getProductSerial === 'function' ? getProductSerial(p) : 'P' + id;
  var link = window.location.origin + window.location.pathname + '?p=' + encodeURIComponent(serial);
  var waText = encodeURIComponent('🛒 *' + p.name + '*\n' + (typeof formatPrice === 'function' ? formatPrice(p.price) : '₦' + p.price) + '\n\nView & order here:\n' + link);
  var xText  = encodeURIComponent('Check out ' + p.name + ' — ' + (typeof formatPrice === 'function' ? formatPrice(p.price) : '₦' + p.price) + ' at Paramount E-mart ' + link);

  // Inject into product modal info if open
  var info = document.querySelector('#modalBody .modal-product-info');
  if (info) {
    var existing = document.getElementById('productSharePanel');
    if (existing) { existing.remove(); return; }
    var panel = document.createElement('div');
    panel.id = 'productSharePanel';
    panel.className = 'product-share-panel';
    panel.innerHTML = _buildSharePanel(serial, link, waText, xText, 'productSharePanel');
    info.appendChild(panel);
    return;
  }

  // Fallback: copy link and show toast
  if (navigator.clipboard) {
    navigator.clipboard.writeText(link).then(function() {
      showToast('Product link copied! Share it anywhere.');
    });
  } else {
    showToast('Share link: ' + link);
  }
};

function _buildSharePanel(serial, link, waText, xText, panelId) {
  return [
    '<div class="psp-head">',
      '<span class="psp-title">Share This Product</span>',
      '<button class="psp-close" onclick="document.getElementById(\'' + panelId + '\').remove()">✕</button>',
    '</div>',
    serial ? '<div class="psp-serial-row"><span class="psp-serial-label">Serial No.</span><span class="psp-serial">' + serial + '</span></div>' : '',
    '<div class="psp-link-row">',
      '<input class="psp-link-input" id="pspLinkInput" type="text" value="' + link + '" readonly onclick="this.select()"/>',
      '<button class="psp-copy-btn" onclick="copyShareLink(\'' + link.replace(/'/g, "\\'") + '\')">Copy</button>',
    '</div>',
    '<div class="psp-channels">',
      '<a class="psp-channel psp-wa" href="https://wa.me/?text=' + waText + '" target="_blank" rel="noopener">',
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2.07 21.5l4.43-1.393A9.953 9.953 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.95 7.95 0 01-4.073-1.117l-.292-.174-3.03.953.947-2.96-.19-.305A7.96 7.96 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/></svg>',
        ' WhatsApp',
      '</a>',
      '<a class="psp-channel psp-x" href="https://twitter.com/intent/tweet?text=' + xText + '" target="_blank" rel="noopener">',
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
        ' Post on X',
      '</a>',
      '<button class="psp-channel psp-copy2" onclick="copyShareLink(\'' + link.replace(/'/g, "\\'") + '\')">',
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
        ' Copy Link',
      '</button>',
    '</div>'
  ].join('');
}


/* ── CATEGORY SHARE BUTTONS ─────────────────────────────────── */

// Injects a "Share Category" button into each popup category card
function enhanceCategoryCards() {
  document.querySelectorAll('#popupCatsGrid .popup-cat-card').forEach(function(card) {
    if (card.querySelector('.cat-share-btn')) return; // already has button
    var catName = (card.querySelector('.popup-cat-name') || {}).textContent || '';
    if (!catName) return;
    var btn = document.createElement('button');
    btn.className = 'cat-share-btn';
    btn.title = 'Share ' + catName;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
    btn.onclick = function(e) {
      e.stopPropagation();
      openCatalogueShare('categories');
      setTimeout(function() {
        var sel = document.getElementById('catShareSelect');
        if (sel) { sel.value = catName; updateCatalogueLink(); }
      }, 100);
    };
    card.appendChild(btn);
  });
}

// Patch openCategoriesPopup to add share buttons after render
(function() {
  var _origOpen = window.openCategoriesPopup;
  if (typeof _origOpen === 'function') {
    window.openCategoriesPopup = function() {
      _origOpen();
      setTimeout(enhanceCategoryCards, 80);
    };
  }
})();


/* ── POPUP CLOSE ON ESC ──────────────────────────────────────── */

(function() {
  var _origKeydown = document.onkeydown;
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    if (document.getElementById('supportPopup')?.classList.contains('open'))      { closeSupportPopup(); return; }
    if (document.getElementById('coursesPopup')?.classList.contains('open'))      { closeCoursesPopup(); return; }
    if (document.getElementById('courseDetailModal')?.classList.contains('open')) { closeCourseDetail(); return; }
    if (document.getElementById('receiptPopup')?.classList.contains('open'))      { closeReceiptPopup(); return; }
  });
})();


/* ── HANDLE URL PARAMS (courses, products, catalogues) ────────── */

document.addEventListener('DOMContentLoaded', function() {
  handleCourseLinkParam();
});


/* ── CSS FOR NEW POPUPS (injected at runtime) ────────────────── */

(function injectPopupCSS() {
  var style = document.createElement('style');
  style.textContent = [

    /* ── Support popup ── */
    '.support-popup-body { padding: 0; overflow-y: auto; }',
    '.support-quick-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; background: var(--dark2); border-bottom: 1px solid var(--dark2); }',
    '@media(max-width:640px) { .support-quick-row { grid-template-columns: 1fr 1fr; } }',
    '.support-quick-opt { background: var(--dark); padding: 20px 16px; text-align: center; }',
    '.sqo-icon { font-size: 24px; margin-bottom: 8px; }',
    '.sqo-label { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: var(--white); margin-bottom: 6px; }',
    '.sqo-desc { font-size: 12px; color: var(--gray); line-height: 1.6; }',
    '.sqo-desc a { color: var(--white); text-decoration: none; border-bottom: 1px solid var(--mid); }',
    '.sqo-desc a:hover { border-color: var(--white); }',
    '.support-form-sidebar-grid { display: grid; grid-template-columns: 1fr 340px; gap: 0; padding: 40px; align-items: start; }',
    '@media(max-width:900px) { .support-form-sidebar-grid { grid-template-columns: 1fr; padding: 24px 20px; } }',
    '.support-ticket-form h3 { font-family: var(--font-display); font-size: 24px; font-weight: 300; margin-bottom: 8px; }',
    '.support-ticket-form > p { font-size: 12px; color: var(--gray); margin-bottom: 24px; line-height: 1.7; }',
    '.sf-group { margin-bottom: 16px; }',
    '.sf-group label { display: block; font-family: var(--font-body); font-size: 9px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: var(--gray); margin-bottom: 8px; }',
    '.sf-group input, .sf-group select, .sf-group textarea { width: 100%; background: var(--black); border: 1px solid var(--dark3); color: var(--white); font-family: var(--font-body); font-size: 13px; padding: 12px 14px; outline: none; transition: border-color 0.2s; appearance: none; }',
    '.sf-group input:focus, .sf-group select:focus, .sf-group textarea:focus { border-color: var(--mid); }',
    '.sf-group textarea { resize: vertical; min-height: 120px; }',
    '.sf-group select { background-image: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23666\' stroke-width=\'2\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 14px center; padding-right: 36px; cursor: pointer; }',
    '.sf-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }',
    '@media(max-width:560px) { .sf-row { grid-template-columns: 1fr; } }',
    '.sf-hint { font-size: 10px; color: var(--gray); margin-top: 5px; }',
    '.support-sidebar-panel { padding-left: 32px; display: flex; flex-direction: column; gap: 2px; }',
    '@media(max-width:900px) { .support-sidebar-panel { padding-left: 0; margin-top: 24px; } }',
    '.support-info-card, .support-faq-card { background: var(--dark); border: 1px solid var(--dark3); padding: 24px; }',
    '.support-info-card h4, .support-faq-card h4 { font-family: var(--font-body); font-size: 9px; font-weight: 700; letter-spacing: 0.25em; text-transform: uppercase; color: var(--gray); margin-bottom: 16px; }',
    '.sic-item { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 14px; }',
    '.sic-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }',
    '.sic-label { font-family: var(--font-body); font-size: 9px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: var(--gray); margin-bottom: 3px; }',
    '.sic-value { display: block; font-size: 12px; color: var(--white); text-decoration: none; border-bottom: 1px solid transparent; }',
    '.sic-value:hover { border-color: var(--mid); }',
    '.sic-note { font-size: 10px; color: var(--gray); margin-top: 2px; }',
    '.support-faq-card { margin-top: 2px; }',
    '.faq-item { border-bottom: 1px solid var(--dark3); padding: 12px 0; }',
    '.faq-item:last-child { border-bottom: none; }',
    '.faq-q { font-family: var(--font-body); font-size: 12px; font-weight: 600; color: var(--white); cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 8px; }',
    '.faq-q::after { content: "+"; color: var(--gray); font-size: 16px; flex-shrink: 0; transition: transform 0.2s; }',
    '.faq-item.open .faq-q::after { transform: rotate(45deg); }',
    '.faq-a { font-family: var(--font-body); font-size: 12px; color: var(--gray); line-height: 1.7; margin-top: 10px; display: none; }',
    '.faq-a a { color: var(--white); }',
    '.faq-item.open .faq-a { display: block; }',
    '.pes-form-msg { padding: 12px 16px; font-family: var(--font-body); font-size: 12px; line-height: 1.6; margin-bottom: 16px; }',
    '.pes-form-msg--success { background: rgba(76,175,80,0.08); border: 1px solid rgba(76,175,80,0.3); color: #81c784; }',
    '.pes-form-msg--error   { background: rgba(229,57,53,0.08); border: 1px solid rgba(229,57,53,0.3); color: #ef9a9a; }',

    /* ── Courses popup ── */
    '.courses-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 2px; }',
    '.course-card { background: var(--dark); border: 1px solid var(--dark2); cursor: pointer; transition: border-color 0.2s; display: flex; flex-direction: column; animation: fadeUp 0.4s ease both; }',
    '.course-card:hover { border-color: var(--mid); }',
    '.course-thumb-wrap { position: relative; aspect-ratio: 16/9; overflow: hidden; background: var(--dark2); }',
    '.course-thumb { width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s; }',
    '.course-card:hover .course-thumb { transform: scale(1.04); }',
    '.course-level-badge { position: absolute; top: 10px; left: 10px; font-family: var(--font-body); font-size: 9px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; padding: 4px 10px; border: 1px solid; }',
    '.course-featured-badge { position: absolute; top: 10px; right: 10px; background: rgba(196,162,64,0.9); color: #000; font-family: var(--font-body); font-size: 9px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; padding: 4px 10px; }',
    '.course-info { padding: 20px; flex: 1; display: flex; flex-direction: column; gap: 8px; }',
    '.course-category { font-family: var(--font-body); font-size: 9px; font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; color: var(--gray); }',
    '.course-title { font-family: var(--font-display); font-size: 18px; font-weight: 400; color: var(--white); line-height: 1.3; }',
    '.course-desc { font-size: 12px; color: var(--gray); line-height: 1.7; flex: 1; }',
    '.course-meta { display: flex; gap: 12px; flex-wrap: wrap; }',
    '.course-meta span { font-family: var(--font-body); font-size: 10px; color: var(--gray); }',
    '.course-footer { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-top: auto; padding-top: 12px; border-top: 1px solid var(--dark2); }',
    '.course-price-wrap {}',
    '.course-price { font-family: var(--font-display); font-size: 20px; font-weight: 400; color: var(--white); }',
    '.course-orig-price { font-size: 11px; color: var(--gray); text-decoration: line-through; margin-top: 2px; }',
    '.course-enroll-btn { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; background: var(--white); color: var(--black); border: none; padding: 10px 16px; cursor: pointer; transition: background 0.2s; white-space: nowrap; }',
    '.course-enroll-btn:hover { background: var(--off-white); }',

    /* ── Course detail modal ── */
    '.course-detail-modal { max-width: 900px; }',
    '.course-detail-inner { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }',
    '@media(max-width:700px) { .course-detail-inner { grid-template-columns: 1fr; } }',
    '.course-detail-media { background: var(--black); }',
    '.course-detail-thumb { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; }',
    '.course-detail-level { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; padding: 10px 16px; }',
    '.course-detail-info { padding: 32px; overflow-y: auto; max-height: 90vh; }',
    '.course-detail-category { font-family: var(--font-body); font-size: 9px; font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; color: var(--gray); margin-bottom: 8px; }',
    '.course-detail-title { font-family: var(--font-display); font-size: 26px; font-weight: 300; color: var(--white); line-height: 1.25; margin-bottom: 12px; }',
    '.course-detail-meta { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }',
    '.course-detail-meta span { font-family: var(--font-body); font-size: 11px; color: var(--gray); }',
    '.course-detail-desc { font-size: 13px; color: var(--light-gray); line-height: 1.8; margin-bottom: 20px; }',
    '.course-what-learn { margin-bottom: 20px; }',
    '.course-what-learn h4 { font-family: var(--font-body); font-size: 9px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: var(--gray); margin-bottom: 12px; }',
    '.course-what-learn ul { list-style: none; padding: 0; }',
    '.course-what-learn li { font-size: 12px; color: var(--light-gray); padding: 6px 0; padding-left: 20px; position: relative; border-bottom: 1px solid var(--dark2); }',
    '.course-what-learn li::before { content: "✓"; position: absolute; left: 0; color: #4caf50; font-weight: bold; }',
    '.course-detail-price-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding: 16px 0; border-top: 1px solid var(--dark2); border-bottom: 1px solid var(--dark2); }',
    '.course-detail-price { font-family: var(--font-display); font-size: 28px; font-weight: 300; color: var(--white); }',
    '.course-detail-orig { font-size: 12px; color: var(--gray); text-decoration: line-through; }',
    '.course-detail-enroll { margin-top: 16px; }',
    '.course-detail-share button { display: inline-flex; align-items: center; gap: 6px; }',

    /* ── Receipt popup ── */
    '.receipt-popup { max-width: 640px; }',
    '.rcpt-inner { padding: 32px; }',
    '.rcpt-brand-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }',
    '.rcpt-badge { display: flex; align-items: center; gap: 8px; background: rgba(76,175,80,0.1); border: 1px solid rgba(76,175,80,0.3); padding: 6px 14px; font-family: var(--font-body); font-size: 9px; font-weight: 700; letter-spacing: 0.2em; color: #4caf50; }',
    '.rcpt-badge-dot { width: 7px; height: 7px; background: #4caf50; border-radius: 50%; }',
    '.rcpt-title { font-family: var(--font-display); font-size: 32px; font-weight: 300; margin-bottom: 4px; }',
    '.rcpt-subtitle { font-family: var(--font-body); font-size: 11px; color: var(--gray); letter-spacing: 0.1em; margin-bottom: 28px; }',
    '.rcpt-section { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--dark2); }',
    '.rcpt-section-title { font-family: var(--font-body); font-size: 9px; font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; color: var(--gray); margin-bottom: 12px; }',
    '.rcpt-detail-row, .rcpt-item { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px; color: var(--light-gray); }',
    '.rcpt-totals { border-top: 2px solid var(--dark3); }',
    '.rcpt-total-row { display: flex; justify-content: space-between; font-family: var(--font-display); font-size: 22px; font-weight: 300; margin-top: 12px; }',
    '.rcpt-tracking-box { background: var(--dark); border: 1px solid rgba(76,175,80,0.3); padding: 24px; margin: 20px 0; text-align: center; }',
    '.rcpt-tracking-label { font-family: var(--font-body); font-size: 9px; font-weight: 700; letter-spacing: 0.35em; text-transform: uppercase; color: #4caf50; margin-bottom: 8px; }',
    '.rcpt-tracking-id { font-family: var(--font-body); font-size: 20px; font-weight: 700; letter-spacing: 0.1em; color: var(--white); margin-bottom: 12px; }',
    '.rcpt-track-btn { display: inline-block; background: #4caf50; color: #000; font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; padding: 12px 24px; text-decoration: none; }',
    '.rcpt-footer-note { font-family: var(--font-body); font-size: 11px; color: var(--gray); text-align: center; line-height: 1.6; margin-top: 16px; }',
    '.btn-ghost-sm { display: inline-flex; align-items: center; gap: 6px; background: none; border: 1px solid var(--dark3); color: var(--gray); font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.1em; padding: 8px 14px; cursor: pointer; transition: all 0.2s; }',
    '.btn-ghost-sm:hover { border-color: var(--mid); color: var(--white); }',

    /* ── Cat share button on cat cards ── */
    '.popup-cat-card { position: relative; }',
    '.cat-share-btn { position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.6); width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 50%; opacity: 0; transition: opacity 0.2s; backdrop-filter: blur(4px); }',
    '.popup-cat-card:hover .cat-share-btn { opacity: 1; }',
    '.cat-share-btn:hover { background: rgba(255,255,255,0.15); color: #fff; }',

  ].join('\n');
  document.head.appendChild(style);
})();
