/* =============================================
   PARAMOUNT E-STORE — ADMIN JS
   Secure session auth + Google Sign-In + Forgot Password
   ============================================= */

// Default credential hashes (SHA-256). Override via .env ADMIN_USERNAME / ADMIN_PASSWORD.
// To change default: run SHA-256 of your new values and update here.
const _AUH = '2a9d6f592f38a64350c8cc07d8d1d65cc56cce7ea47d5131aaf4c4b04f18965b';
const _APH = 'ad7584ae5e41144c853b80b5d94f99c8cf89d742ba5e91aec3c7b9eef1d4522e';

async function _sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

let pendingDeleteId=null;
let currentImages=[];
let currentVideo='';
let currentCatImage='';

const SERVER = (location.protocol === 'file:') ? 'http://localhost:3000' : location.origin;

// ─── SESSION MANAGEMENT ──────────────────────
// Server issues a cryptographically random token; stored in sessionStorage only.
function _getSession()   { return sessionStorage.getItem('pes_admin_token'); }
function _setSession(t)  { sessionStorage.setItem('pes_admin_token', t); }
function _clearSession() { sessionStorage.removeItem('pes_admin_token'); sessionStorage.removeItem('pes_admin'); }

// Build headers for all admin API calls
function adminHeaders(extra) {
  const tok = _getSession();
  const h = { 'Content-Type': 'application/json' };
  if (tok) h['X-PDS-Session'] = tok;
  return Object.assign(h, extra || {});
}

// Auto-logout when tab closes
window.addEventListener('pagehide', _clearSession);

// ─── INIT ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Check for password reset token in URL
  const params = new URLSearchParams(location.search);
  const resetToken = params.get('reset');
  if (resetToken) {
    _handleResetFlow(resetToken);
    return;
  }
  if (_getSession()) {
    showDashboard();
  } else {
    document.getElementById('loginScreen').style.display = 'flex';
  }
});

// ─── FORGOT PASSWORD FLOW ────────────────────
function showForgotPasswordForm() {
  document.getElementById('loginFormInner').style.display = 'none';
  document.getElementById('forgotPasswordForm').style.display = 'block';
}

function hideForgotPasswordForm() {
  document.getElementById('forgotPasswordForm').style.display = 'none';
  document.getElementById('loginFormInner').style.display = 'block';
  document.getElementById('forgotEmail').value = '';
  document.getElementById('forgotMsg').textContent = '';
}

async function submitForgotPassword() {
  const email = document.getElementById('forgotEmail').value.trim();
  const msg   = document.getElementById('forgotMsg');
  const btn   = document.getElementById('forgotBtn');
  if (!email) { msg.style.color='#e53935'; msg.textContent='Please enter your admin email address.'; return; }
  btn.textContent = '…'; btn.disabled = true;
  try {
    const r = await fetch(SERVER + '/api/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const d = await r.json();
    msg.style.color = '#4caf50';
    msg.textContent = d.message || 'Reset link sent. Check your email.';
  } catch(e) {
    msg.style.color = '#e53935';
    msg.textContent = 'Network error. Please try again.';
  }
  btn.textContent = 'Send Reset Link'; btn.disabled = false;
}

async function _handleResetFlow(token) {
  // Validate token first
  try {
    const r = await fetch(SERVER + '/api/validate-reset?token=' + encodeURIComponent(token));
    const d = await r.json();
    if (!d.ok) {
      document.getElementById('loginScreen').style.display = 'flex';
      document.getElementById('loginFormInner').style.display = 'none';
      document.getElementById('forgotPasswordForm').style.display = 'none';
      document.getElementById('resetPasswordForm').style.display = 'none';
      const err = document.getElementById('loginError');
      if (err) { err.style.color='#e53935'; err.textContent='Password reset link is invalid or has expired. Please request a new one.'; }
      document.getElementById('loginScreen').style.display = 'flex';
      return;
    }
  } catch(e) {
    document.getElementById('loginScreen').style.display = 'flex';
    return;
  }
  // Show reset form
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('loginFormInner').style.display = 'none';
  document.getElementById('forgotPasswordForm').style.display = 'none';
  document.getElementById('resetPasswordForm').style.display = 'block';
  document.getElementById('resetPasswordForm').dataset.token = token;
}

async function submitResetPassword() {
  const form    = document.getElementById('resetPasswordForm');
  const token   = form.dataset.token;
  const newPass = document.getElementById('resetNewPass').value;
  const confPass= document.getElementById('resetConfPass').value;
  const msg     = document.getElementById('resetMsg');
  const btn     = document.getElementById('resetBtn');
  if (!newPass || newPass.length < 8) { msg.style.color='#e53935'; msg.textContent='Password must be at least 8 characters.'; return; }
  if (newPass !== confPass) { msg.style.color='#e53935'; msg.textContent='Passwords do not match.'; return; }
  btn.textContent='…'; btn.disabled=true;
  try {
    const hash = await _sha256(newPass);
    const r = await fetch(SERVER + '/api/apply-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPasswordHash: hash }),
    });
    const d = await r.json();
    if (d.ok) {
      msg.style.color='#4caf50';
      msg.textContent='Password updated! Redirecting to login…';
      setTimeout(() => {
        history.replaceState(null, '', location.pathname);
        location.reload();
      }, 2000);
    } else {
      msg.style.color='#e53935';
      msg.textContent = d.error || 'Reset failed. Request a new link.';
      btn.textContent='Set New Password'; btn.disabled=false;
    }
  } catch(e) {
    msg.style.color='#e53935'; msg.textContent='Network error.';
    btn.textContent='Set New Password'; btn.disabled=false;
  }
}

// ─── AUTH — Username / Password ──────────────
async function handleLogin() {
  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  const err  = document.getElementById('loginError');
  const btn  = document.querySelector('.login-btn');
  if (!user || !pass) { err.textContent='Please enter your username and password.'; return; }
  if (btn) { btn.textContent='…'; btn.disabled=true; }
  const [uh, ph] = await Promise.all([_sha256(user), _sha256(pass)]);
  if (btn) { btn.textContent='Access Dashboard'; btn.disabled=false; }

  // Try secure server-side login first (issues session token)
  try {
    const r = await fetch(SERVER + '/api/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameHash: uh, passwordHash: ph }),
    });
    const d = await r.json();
    if (d.ok && d.token) {
      _setSession(d.token);
      _logLoginEvent('Successful login (server-verified)');
      _grantAccess(); return;
    }
    if (d.ok && d.mode === 'client') {
      // Server has no .env creds — fall through to client-side check
    } else if (!d.ok) {
      err.textContent = 'Invalid username or password.';
      document.getElementById('loginPass').value = '';
      return;
    }
  } catch(e) { /* server offline — fall through */ }

  // Client-side fallback
  if (uh === _AUH && ph === _APH) {
    // Create a pseudo-session for offline mode
    _setSession('offline-' + Date.now());
    _logLoginEvent('Successful login (offline/client fallback)');
    _grantAccess();
  } else {
    err.textContent = 'Invalid username or password.';
    document.getElementById('loginPass').value = '';
  }
}

// ─── AUTH — Google Sign-In callback ──────────
window._googleAdminSignIn = async function(response) {
  const err = document.getElementById('loginError');
  const btn = document.getElementById('googleSignInBtn');
  if (btn) { btn.style.opacity='0.6'; btn.style.pointerEvents='none'; }
  try {
    const r = await fetch(SERVER + '/api/admin-google-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });
    const d = await r.json();
    if (d.ok && d.token) {
      _setSession(d.token);
      _logLoginEvent('Successful Google login (' + (d.name || 'Admin') + ')');
      _grantAccess();
    } else {
      if (err) err.textContent = d.error || 'Google sign-in failed. Check admin Google email in .env';
    }
  } catch(e) {
    if (err) err.textContent = 'Network error during Google sign-in.';
  }
  if (btn) { btn.style.opacity='1'; btn.style.pointerEvents=''; }
};

function _grantAccess() {
  const err = document.getElementById('loginError');
  if (err) err.textContent = '';
  const ls = document.getElementById('loginScreen');
  if (ls) { ls.style.transition='opacity 0.4s'; ls.style.opacity='0'; }
  setTimeout(showDashboard, 400);
}

function showDashboard() {
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('adminDashboard').style.display='block';
  renderOverview(); populateCategorySelects();
}

function logout() {
  const token = _getSession();
  if (token) {
    fetch(SERVER + '/api/admin-logout', { method:'POST', headers: adminHeaders() }).catch(()=>{});
  }
  _clearSession();
  document.getElementById('adminDashboard').style.display='none';
  const ls = document.getElementById('loginScreen');
  ls.style.opacity='0';
  ls.style.display='flex';
  document.getElementById('loginFormInner').style.display='block';
  document.getElementById('forgotPasswordForm').style.display='none';
  document.getElementById('resetPasswordForm').style.display='none';
  requestAnimationFrame(() => { ls.style.transition='opacity 0.4s'; ls.style.opacity='1'; });
  document.getElementById('loginUser').value='';
  document.getElementById('loginPass').value='';
}

function aImg(src,alt,cls){
  cls=cls||'admin-prod-img';
  const s=(src&&(src.includes('/')||src.includes('.')||src.startsWith('data:')))?src:'images/logo.png';
  return `<img src="${s}" alt="${alt||''}" class="${cls}" onerror="this.src='images/logo.png'"/>`;
}

function copyAdminSerial(){
  const el=document.getElementById('fpSerialDisplay');
  if(!el) return;
  navigator.clipboard.writeText(el.value).then(()=>{
    showToast('Serial number copied!');
    const btn=document.getElementById('serialCopyBtn');
    if(btn){ btn.textContent='✓ Copied'; setTimeout(()=>{ btn.textContent='Copy'; },2000); }
  });
}

// ─── TABS ────────────────────────────────────
// showTab is defined as window.showTab below (after renderAdminShipments)
// to ensure all render functions are defined first

// ─── OVERVIEW ────────────────────────────────
function renderOverview(){
  const products=getProducts(), orders=getOrders(), cats=getCategories();
  const revenue=orders.filter(o=>o.status==='paid').reduce((a,b)=>a+b.total,0);
  document.getElementById('statProducts').textContent=products.length;
  document.getElementById('statCategories').textContent=cats.length;
  document.getElementById('statOrders').textContent=orders.length;
  document.getElementById('statRevenue').textContent=formatPrice(revenue);
  document.getElementById('recentProducts').innerHTML=products.slice(0,6).map(p=>`
    <div class="recent-item">
      <div class="recent-img-wrap">${aImg(getFirstImage(p),p.name,'recent-img')}</div>
      <div class="recent-info"><div class="recent-name">${p.name}</div><div class="recent-cat">${p.category}</div></div>
      ${p.badge?`<span class="recent-badge">${p.badge}</span>`:''}
      <div class="recent-price">${formatPrice(p.price)}</div>
    </div>`).join('');
}

function getFirstImage(p){
  if(Array.isArray(p.images)&&p.images.length) return p.images[0];
  return p.image||'images/logo.png';
}

// ─── ADMIN PRODUCTS ──────────────────────────
function renderAdminProducts(){
  const q=(document.getElementById('searchInput')?.value||'').toLowerCase();
  const cat=document.getElementById('filterCat')?.value||'All';
  let prods=getProducts();
  if(q) prods=prods.filter(p=>p.name.toLowerCase().includes(q)||p.category.toLowerCase().includes(q));
  if(cat!=='All') prods=prods.filter(p=>p.category===cat);
  const table=document.getElementById('adminProductsTable');
  if(!prods.length){ table.innerHTML=`<div style="text-align:center;padding:60px;color:var(--gray);font-size:14px;">No products found.</div>`; return; }
  const stockMap={'in-stock':'In Stock','limited':'Limited','out-of-stock':'Out of Stock'};
  const isMobile = window.innerWidth <= 700;
  if(isMobile){
    table.innerHTML=`<div class="ap-mobile-grid">`+prods.map((p,i)=>`
      <div class="ap-mobile-card" style="animation-delay:${i*0.04}s">
        <div class="ap-mobile-img-wrap">${aImg(getFirstImage(p),p.name,'ap-mobile-img')}</div>
        <div class="ap-mobile-body">
          <div class="ap-mobile-name">${p.name}</div>
          <div class="ap-mobile-meta"><span class="ap-mobile-cat">${p.category}</span><span class="ap-mobile-price">${formatPrice(p.price)}</span></div>
          <div class="ap-mobile-status-row">
            <span class="ap-stock ${p.stock||'in-stock'}">${stockMap[p.stock]||'In Stock'}</span>
            ${p.featured?'<span class="ap-mobile-featured">★ Featured</span>':''}
            ${p.badge?`<span class="ap-mobile-badge">${p.badge}</span>`:''}
          </div>
          <div class="ap-mobile-actions">
            <button class="ap-mobile-edit-btn" onclick="openEditModal(${p.id})">✏ Edit</button>
            <button class="ap-mobile-del-btn" onclick="openDeleteModal(${p.id},'${escStr(p.name)}')">🗑 Delete</button>
          </div>
        </div>
      </div>`).join('')+`</div>`;
  } else {
    table.innerHTML=prods.map((p,i)=>`
      <div class="admin-product-row" style="animation-delay:${i*0.03}s">
        <div class="ap-img-wrap">${aImg(getFirstImage(p),p.name,'ap-img')}</div>
        <div><div class="ap-name">${p.name}</div><div class="ap-cat">${p.category}</div></div>
        <div class="ap-price">${formatPrice(p.price)}</div>
        <div class="ap-stock ${p.stock||'in-stock'}">${stockMap[p.stock]||'In Stock'}</div>
        <div class="ap-badge">${p.badge?`<span>${p.badge}</span>`:'<span class="no-badge">—</span>'}</div>
        <div style="font-size:11px;color:${p.featured?'var(--white)':'var(--gray)'};">${p.featured?'★ Featured':'—'}</div>
        <div class="ap-actions">
          <button class="edit-btn" onclick="openEditModal(${p.id})">Edit</button>
          <button class="del-btn" onclick="openDeleteModal(${p.id},'${escStr(p.name)}')">Delete</button>
        </div>
      </div>`).join('');
  }
}
function escStr(s){ return String(s).replace(/'/g,"\\'"); }

function populateCategorySelects(){
  const cats=getCategories();
  const opts=cats.map(c=>`<option value="${c.name}">${c.name}</option>`).join('');
  const f=document.getElementById('filterCat'), fp=document.getElementById('fpCategory');
  if(f) f.innerHTML=`<option value="All">All Categories</option>`+opts;
  if(fp) fp.innerHTML=opts;
}

// ─── OPEN ADD / EDIT MODAL ───────────────────
function resetProductForm(){
  currentImages=[]; currentVideo='';
  document.getElementById('editId').value='';
  document.getElementById('fpName').value='';
  document.getElementById('fpPrice').value='';
  document.getElementById('fpDescRte').innerHTML='';
  document.getElementById('fpBadge').value='';
  document.getElementById('fpStock').value='in-stock';
  document.getElementById('fpFeatured').checked=false;
  if(document.getElementById('fpStockQty')) document.getElementById('fpStockQty').value='';
  const serialRow=document.getElementById('pfSerialRow');
  if(serialRow) serialRow.style.display='none';
  document.getElementById('fpImagePath').value='';
  document.getElementById('fpVideoPath').value='';
  document.getElementById('videoPreviewWrap').style.display='none';
  document.getElementById('videoDropzoneInner').style.display='flex';
  renderMediaGallery(); resetDropzone(); populateCategorySelects();
}

function openAddModal(){
  document.getElementById('productFormTitle').textContent='Add New Product';
  resetProductForm();
  document.getElementById('productFormModal').classList.add('open');
  document.getElementById('productFormOverlay').classList.add('open');
  document.body.style.overflow='hidden';
  const modalBody=document.querySelector('.pf-body');
  if(modalBody) modalBody.scrollTop=0;
  if(window.innerWidth<=700) setTimeout(()=>{ const f=document.getElementById('fpName'); if(f) f.focus(); },400);
}

function openEditModal(productId){
  const p=getProducts().find(x=>x.id===productId);
  if(!p) return;
  document.getElementById('productFormTitle').textContent='Edit Product';
  document.getElementById('editId').value=p.id;
  document.getElementById('fpName').value=p.name;
  document.getElementById('fpPrice').value=p.price;
  document.getElementById('fpDescRte').innerHTML=p.description||'';
  document.getElementById('fpBadge').value=p.badge||'';
  document.getElementById('fpStock').value=p.stock||'in-stock';
  document.getElementById('fpFeatured').checked=!!p.featured;
  if(document.getElementById('fpStockQty')) document.getElementById('fpStockQty').value=p.stockQty!==undefined?p.stockQty:'';
  const serial=typeof getProductSerial==='function'?getProductSerial(p):('PES-'+String(p.id).padStart(5,'0'));
  const shareLink=window.location.origin+'/index.html?p='+encodeURIComponent(serial);
  const serialRow=document.getElementById('pfSerialRow');
  if(serialRow) serialRow.style.display='block';
  const serialEl=document.getElementById('fpSerialDisplay');
  if(serialEl) serialEl.value=serial;
  const shareLinkEl=document.getElementById('fpShareLinkRow');
  if(shareLinkEl) shareLinkEl.innerHTML=`🔗 Share link: <span style="color:var(--white);">${shareLink}</span>`;
  document.getElementById('fpVideoPath').value=p.video||'';
  currentImages=Array.isArray(p.images)&&p.images.length?[...p.images]:(p.image?[p.image]:[]);
  currentVideo=p.video||'';
  resetDropzone(); renderMediaGallery(); populateCategorySelects();
  document.getElementById('fpCategory').value=p.category;
  if(currentVideo){
    document.getElementById('videoPreview').src=currentVideo;
    document.getElementById('videoPreviewWrap').style.display='block';
    document.getElementById('videoDropzoneInner').style.display='none';
  }
  document.getElementById('productFormModal').classList.add('open');
  document.getElementById('productFormOverlay').classList.add('open');
  document.body.style.overflow='hidden';
  const modalBody=document.querySelector('.pf-body');
  if(modalBody) modalBody.scrollTop=0;
  if(window.innerWidth<=700) setTimeout(()=>{ const f=document.getElementById('fpName'); if(f) f.focus(); },400);
}

function closeProductForm(){
  document.getElementById('productFormModal').classList.remove('open');
  document.getElementById('productFormOverlay').classList.remove('open');
  document.body.style.overflow='';
}

// ─── IMAGE HANDLING ──────────────────────────
function handleImgFiles(files){
  Array.from(files).forEach(file=>{
    if(!file.type.startsWith('image/')) return;
    _uploadImageToServer(file).then(url=>{ currentImages.push(url); renderMediaGallery(); updateDropzonePreview(); });
  });
}

async function _uploadImageToServer(file) {
  try {
    const formData=new FormData();
    formData.append('image',file,file.name);
    const tok=_getSession();
    const headers={};
    if(tok) headers['X-PDS-Session']=tok;
    const r=await fetch(SERVER+'/api/upload',{ method:'POST', headers, body:formData });
    if(r.ok){ const d=await r.json(); if(d.ok&&d.url){ showToast('Image uploaded ✓'); return d.url; } }
  } catch(e) {}
  return new Promise(resolve=>{ const reader=new FileReader(); reader.onload=e=>resolve(e.target.result); reader.readAsDataURL(file); });
}

function handleImgDrop(e){ e.preventDefault(); document.getElementById('imgDropzone').classList.remove('drag-over'); handleImgFiles(e.dataTransfer.files); }
function addImageFromPath(force){ const val=document.getElementById('fpImagePath').value.trim(); if(!val) return; if(force||val.includes('/')||val.includes('.')){ currentImages.push(val); renderMediaGallery(); updateDropzonePreview(); document.getElementById('fpImagePath').value=''; } }
function removeImage(i){ currentImages.splice(i,1); renderMediaGallery(); if(!currentImages.length) resetDropzone(); else updateDropzonePreview(); }

function renderMediaGallery(){
  const wrap=document.getElementById('mediaGalleryPreview');
  if(!currentImages.length){ wrap.innerHTML=''; }
  else {
    wrap.innerHTML=`<div class="media-gallery-grid">${currentImages.map((src,i)=>`<div class="media-thumb-wrap"><img src="${src}" class="media-thumb-img" onerror="this.src='images/logo.png'"/>${i===0?'<span class="media-primary-badge">Primary</span>':''}<button class="media-thumb-remove" onclick="removeImage(${i})">✕</button></div>`).join('')}</div><p class="media-gallery-hint">First image is primary. ${currentImages.length>1?'Multiple images = automatic slideshow on store.':''}</p>`;
  }
  renderSlideshowOrder(); updateMediaCount();
}

function updateDropzonePreview(){
  const inner=document.getElementById('dropzoneInner');
  if(currentImages.length){ inner.innerHTML=`<img src="${currentImages[0]}" class="dropzone-preview-img" onerror="this.src='images/logo.png'"/><p class="dropzone-text" style="margin-top:8px;">${currentImages.length} image${currentImages.length!==1?'s':''} added</p><button class="dropzone-btn" onclick="document.getElementById('imgFileInput').click()">Add More</button>`; }
}
function resetDropzone(){
  document.getElementById('dropzoneInner').innerHTML=`<div class="dropzone-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div><p class="dropzone-text">Drag & drop product image here</p><p class="dropzone-sub">or</p><button class="dropzone-btn" onclick="document.getElementById('imgFileInput').click()">Browse Files</button><p class="dropzone-formats">JPG, PNG, WEBP up to 10MB</p>`;
}

// ─── VIDEO HANDLING ──────────────────────────
function handleVideoFile(file){ if(!file||!file.type.startsWith('video/')) return; const reader=new FileReader(); reader.onload=e=>{ currentVideo=e.target.result; document.getElementById('videoPreview').src=currentVideo; document.getElementById('videoPreviewWrap').style.display='block'; document.getElementById('videoDropzoneInner').style.display='none'; }; reader.readAsDataURL(file); }
function handleVideoDrop(e){ e.preventDefault(); document.getElementById('videoDropzone').classList.remove('drag-over'); if(e.dataTransfer.files[0]) handleVideoFile(e.dataTransfer.files[0]); }
function addVideoFromPath(){ const val=document.getElementById('fpVideoPath').value.trim(); if(!val) return; currentVideo=val; document.getElementById('videoPreview').src=val; document.getElementById('videoPreviewWrap').style.display='block'; document.getElementById('videoDropzoneInner').style.display='none'; }
function removeVideo(){ currentVideo=''; document.getElementById('videoPreview').src=''; document.getElementById('videoPreviewWrap').style.display='none'; document.getElementById('videoDropzoneInner').style.display='flex'; }

// ─── RICH TEXT EDITOR ────────────────────────
function rteCmd(cmd){ document.execCommand(cmd,false,null); document.getElementById('fpDescRte').focus(); }

// ─── SAVE PRODUCT ────────────────────────────
function saveProduct(){
  const name=document.getElementById('fpName').value.trim();
  const price=parseFloat(document.getElementById('fpPrice').value);
  const descHtml=document.getElementById('fpDescRte').innerHTML.trim();
  const descText=document.getElementById('fpDescRte').innerText.trim();
  const category=document.getElementById('fpCategory').value;
  const badge=document.getElementById('fpBadge').value||null;
  const stock=document.getElementById('fpStock').value;
  const featured=document.getElementById('fpFeatured').checked;
  const stockQtyRaw=document.getElementById('fpStockQty')?.value;
  const stockQty=stockQtyRaw!==''&&stockQtyRaw!==undefined&&stockQtyRaw!==null?parseInt(stockQtyRaw):null;
  const editId=document.getElementById('editId').value;
  if(!name||isNaN(price)||price<0||!descText||!category){ showToast('Please fill in all required fields'); return; }
  const imgFallback=currentImages.length?null:'images/logo.png';
  const productData={ name,price,description:descHtml||descText,category,badge,stock,featured,image:currentImages[0]||imgFallback,images:currentImages.length?[...currentImages]:['images/logo.png'],video:currentVideo||null,stockQty:stockQty!==null?stockQty:undefined };
  let products=getProducts();
  if(editId){ products=products.map(p=>p.id===parseInt(editId)?{...p,...productData}:p); showToast('Product updated successfully'); }
  else { const newId=generateId(); products.push({id:newId,...productData}); showToast('Product added — Serial: PES-'+String(newId).padStart(5,'0')); }
  saveProducts(products); closeProductForm(); renderAdminProducts(); renderOverview();
}

// ─── DELETE ──────────────────────────────────
function openDeleteModal(id,name){ pendingDeleteId=id; document.getElementById('deleteProductName').textContent=name; document.getElementById('deleteModal').classList.add('open'); document.getElementById('deleteOverlay').classList.add('open'); document.body.style.overflow='hidden'; }
function closeDeleteModal(){ pendingDeleteId=null; document.getElementById('deleteModal').classList.remove('open'); document.getElementById('deleteOverlay').classList.remove('open'); document.body.style.overflow=''; }
function confirmDelete(){ if(!pendingDeleteId) return; saveProducts(getProducts().filter(p=>p.id!==pendingDeleteId)); closeDeleteModal(); renderAdminProducts(); renderOverview(); showToast('Product deleted'); }

// ─── ORDERS ──────────────────────────────────
function renderOrders(){
  const orders=getOrders(), filter=document.getElementById('orderStatusFilter')?.value || 'all';
  const filtered = filter === 'all' ? orders : orders.filter(o => o.status === filter);
  const table=document.getElementById('ordersTable');
  if(!table) return;
  
  if(!filtered.length){ 
    const tbody = document.getElementById('ordersTbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--gray);">No orders found.</td></tr>';
    return; 
  }
  
  const tbody = document.getElementById('ordersTbody');
  if (!tbody) return;
  
  tbody.innerHTML = filtered.map((o, idx) => {
    const itemCount = (o.items || []).length;
    const statusColor = o.status === 'paid' ? '#4caf50' : (o.status === 'delivered' ? '#2196f3' : '#f57c00');
    return `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
        <td style="padding:12px;"><strong>#${o.id || idx+1}</strong></td>
        <td style="padding:12px;">
          <div style="color:var(--white);font-weight:600;">${o.customer || 'Unknown'}</div>
          <div style="font-size:11px;color:var(--gray);">${o.email || ''}</div>
        </td>
        <td style="padding:12px;text-align:center;"><strong>${itemCount}</strong></td>
        <td style="padding:12px;"><strong style="color:var(--gold);">₦${(o.total || 0).toLocaleString('en-NG')}</strong></td>
        <td style="padding:12px;font-size:11px;color:var(--light-gray);">${o.gateway || 'Unknown'}</td>
        <td style="padding:12px;font-size:11px;color:var(--gray);">${o.date || new Date().toLocaleDateString('en-NG')}</td>
        <td style="padding:12px;"><span style="background:rgba(255,255,255,0.1);padding:4px 8px;border-radius:3px;font-size:10px;font-weight:600;color:${statusColor};">${(o.status || 'pending').toUpperCase()}</span></td>
        <td style="padding:12px;text-align:center;display:flex;gap:8px;justify-content:center;">
          <button onclick="downloadOrderReceipt('${o.id}')" style="background:var(--white);border:none;color:var(--black);padding:6px 10px;border-radius:3px;font-size:11px;font-weight:600;cursor:pointer;"><i class="fas fa-download"></i></button>
        </td>
      </tr>
    `;
  }).join('');
}

// ─── CATEGORIES ──────────────────────────────
function renderCatAdmin(){
  const cats=getCategories(), prods=getProducts();
  const sorted=[...cats].sort((a,b)=>{ if(a.ageRestricted&&!b.ageRestricted) return 1; if(!a.ageRestricted&&b.ageRestricted) return -1; return a.name.localeCompare(b.name); });
  document.getElementById('catAdminGrid').innerHTML=sorted.map(cat=>{
    const count=prods.filter(p=>p.category===cat.name).length, isRestricted=!!cat.ageRestricted;
    return `<div class="cat-admin-card${isRestricted?' cat-admin-restricted':''}"><button class="cat-admin-del" onclick="deleteCategory(${cat.id},'${escStr(cat.name)}')">✕</button><div class="cat-admin-img-wrap cat-admin-img-box">${isRestricted?'<span class=\"cat-admin-restricted-icon\">🔞</span>':aImg(cat.image,cat.name,'cat-admin-img')}</div><div class="cat-admin-name">${cat.name}${isRestricted?' <span class=\"cat-age-badge\">18+</span>':''}</div><div class="cat-admin-desc">${cat.description||''}</div><div class="cat-admin-count">${count} product${count!==1?'s':''}</div><div class="cat-admin-age-row"><span class="cat-admin-age-label">Age Verification</span><div class="cat-age-toggle-wrap"><button class="cat-age-btn${isRestricted?' cat-age-yes':''}" onclick="setCatAgeRestricted(${cat.id},true)">Yes</button><button class="cat-age-btn${!isRestricted?' cat-age-no':''}" onclick="setCatAgeRestricted(${cat.id},false)">No</button></div></div></div>`;
  }).join('');
}
function setCatAgeRestricted(id,restricted){ const cats=getCategories(), cat=cats.find(c=>c.id===id); if(!cat) return; cat.ageRestricted=restricted; saveCategories(cats); renderCatAdmin(); populateCategorySelects(); showToast('Age verification '+(restricted?'enabled':'disabled')+' for "'+cat.name+'"'); }
function deleteCategory(id,name){ pesDanger('Delete the <strong>'+name+'</strong> category? Products will not be deleted.','Delete Category',function(){ saveCategories(getCategories().filter(c=>c.id!==id)); renderCatAdmin(); populateCategorySelects(); pesSuccess('Category Deleted',name+' has been removed.'); },null,{title:'Delete Category?',icon:'🗂'}); }
function openAddCatModal(){ currentCatImage=''; document.getElementById('catName').value=''; document.getElementById('catImage').value=''; document.getElementById('catDesc').value=''; document.getElementById('catImgPreviewWrap').style.display='none'; setCatFormAge(false); document.getElementById('catFormModal').classList.add('open'); document.getElementById('catFormOverlay').classList.add('open'); document.body.style.overflow='hidden'; }
function setCatFormAge(restricted){ var yes=document.getElementById('catAgeYes'), no=document.getElementById('catAgeNo'), hidden=document.getElementById('catAgeRestricted'); if(yes) yes.className='cat-age-btn'+(restricted?' cat-age-yes':''); if(no) no.className='cat-age-btn'+(restricted?'':' cat-age-no'); if(hidden) hidden.value=restricted?'true':'false'; }
function handleCatFile(file){ if(!file||!file.type.startsWith('image/')) return; const reader=new FileReader(); reader.onload=e=>{ currentCatImage=e.target.result; document.getElementById('catImgPreview').src=currentCatImage; document.getElementById('catImgPreviewWrap').style.display='block'; document.getElementById('catDropzone').style.display='none'; }; reader.readAsDataURL(file); }
function handleCatImgDrop(e){ e.preventDefault(); document.getElementById('catDropzone').classList.remove('drag-over'); if(e.dataTransfer.files[0]) handleCatFile(e.dataTransfer.files[0]); }
function removeCatImg(){ currentCatImage=''; document.getElementById('catImgPreviewWrap').style.display='none'; document.getElementById('catDropzone').style.display='block'; }
function previewCatUrl(){ const val=document.getElementById('catImage').value.trim(); if(!val) return; currentCatImage=val; document.getElementById('catImgPreview').src=val; document.getElementById('catImgPreviewWrap').style.display='block'; }
function closeCatModal(){ document.getElementById('catFormModal').classList.remove('open'); document.getElementById('catFormOverlay').classList.remove('open'); document.body.style.overflow=''; }
function saveCategory(){
  var name = (document.getElementById('catName').value || '').trim();
  var desc = (document.getElementById('catDesc').value || '').trim();
  var urlVal = (document.getElementById('catImage').value || '').trim();
  var image = currentCatImage || urlVal || 'images/logo.png';
  var ageRestricted = document.getElementById('catAgeRestricted') ? document.getElementById('catAgeRestricted').value === 'true' : false;
  if (!name) { showToast('Please enter a category name'); return; }
  var cats = getCategories();
  if (cats.find(function(c){ return c.name.toLowerCase() === name.toLowerCase(); })) {
    showToast('Category "' + name + '" already exists'); return;
  }
  cats.push({ id: generateId(), name: name, image: image, description: desc, ageRestricted: ageRestricted });
  saveCategories(cats);
  closeCatModal();
  renderCatAdmin();
  populateCategorySelects();
  showToast('Category "' + name + '" added' + (ageRestricted ? ' — Age Restricted (18+)' : '') + ' successfully');
}

document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ closeProductForm(); closeCatModal(); closeDeleteModal(); } });

// ─── SHIPMENTS TAB ────────────────────────────
function renderAdminShipments(){
  const ships=getShipments(), table=document.getElementById('adminShipmentsTable');
  if(!table) return;
  const STATUS_COLORS={'Order Placed':'#555','Processing':'var(--white2)','Dispatched':'#81c784','In Transit':'var(--white)','Out for Delivery':'var(--white2)','Delivered':'#4caf50','Returned':'#ef5350'};
  const ALL_STEPS=['Order Placed','Processing','Dispatched','In Transit','Out for Delivery','Delivered'];
  if(!ships.length){ table.innerHTML=`<div style="text-align:center;padding:60px;color:var(--gray);">No shipments yet.</div>`; return; }
  table.innerHTML=ships.map(s=>{
    const color=STATUS_COLORS[s.status]||'#666';
    return `<div class="admin-product-row" style="flex-wrap:wrap;gap:12px;"><div style="min-width:140px;"><div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:var(--white);">${s.id}</div><div style="font-size:10px;color:var(--gray);">${s.orderId}</div></div><div style="flex:1;min-width:200px;"><div style="font-size:12px;color:var(--white);margin-bottom:4px;">${s.product}</div><div style="font-size:11px;color:var(--gray);">${s.customer} · ${s.carrier}</div></div><div style="min-width:180px;"><div style="font-size:11px;color:var(--gray);">${s.origin.city} → <strong style="color:var(--white);">${s.currentLocation.city}</strong> → ${s.destination.city}</div><div style="font-size:10px;color:var(--gray);margin-top:4px;">${s.type==='international'?'🌍 International':'🇳🇬 Domestic'} · ${s.weight||'TBC'}</div></div><div><span style="font-size:9px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;padding:5px 12px;background:${color}22;color:${color};border:1px solid ${color}44;">${s.status}</span><div style="font-size:10px;color:var(--gray);margin-top:6px;">Est: ${s.estimatedDelivery||'—'}</div></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;"><select onchange="updateShipmentStatus(${JSON.stringify(s.id).replace(/"/g,"'")},this.value)" style="background:var(--dark3);border:1px solid var(--dark3);color:var(--white);font-family:var(--font-body);font-size:11px;padding:8px 12px;outline:none;cursor:pointer;">${ALL_STEPS.map(st=>`<option value="${st}" ${st===s.status?'selected':''}>${st}</option>`).join('')}<option value="Returned" ${s.status==='Returned'?'selected':''}>Returned</option></select><a href="tracking.html?id=${s.id}" target="_blank" style="font-size:10px;color:var(--gray);text-decoration:none;border:1px solid var(--dark3);padding:8px 14px;letter-spacing:0.1em;">Track →</a></div></div>`;
  }).join('');
}

function updateShipmentStatus(shipmentId,newStatus){
  const ALL_STEPS=['Order Placed','Processing','Dispatched','In Transit','Out for Delivery','Delivered','Returned'];
  const ships=getShipments(), idx=ships.findIndex(s=>s.id===shipmentId);
  if(idx===-1) return;
  ships[idx].status=newStatus; ships[idx].statusIndex=ALL_STEPS.indexOf(newStatus);
  ships[idx].history.push({ status:newStatus, time:new Date().toLocaleString('en-NG'), location:ships[idx].currentLocation.city+', '+ships[idx].currentLocation.country, note:`Status updated to "${newStatus}" by admin.` });
  saveShipments(ships); showToast(`Shipment ${shipmentId} updated to "${newStatus}"`);
}

window.showTab = function(tab, btn) {
  // Hide all tabs
  document.querySelectorAll('.admin-tab').forEach(function(t) { t.style.display = 'none'; });
  document.querySelectorAll('.admin-nav-btn').forEach(function(b) { b.classList.remove('active'); });
  // Show target tab
  var tabEl = document.getElementById('tab-' + tab);
  if (tabEl) tabEl.style.display = 'block';
  if (btn) btn.classList.add('active');
  // Sync bottom dock active state
  document.querySelectorAll('.admin-dock-btn').forEach(function(b) { b.classList.remove('active'); });
  var dockBtn = document.getElementById('dockBtn-' + tab);
  if (dockBtn) dockBtn.classList.add('active');
  // Sync drawer active state
  document.querySelectorAll('.admin-mob-btn').forEach(function(b) { b.classList.remove('active'); });
  // Scroll tab content to top on mobile
  window.scrollTo({ top: 0, behavior: 'smooth' });
  // Run tab-specific renders
  if (tab === 'overview')    { renderOverview(); }
  if (tab === 'products')    { renderAdminProducts(); }
  if (tab === 'orders')      { renderOrders(); }
  if (tab === 'categories')  { renderCatAdmin(); }
  if (tab === 'promos')      { renderPromoCodesTable(); renderBulkTiersTable(); }
  if (tab === 'media')       { renderMediaLibrary(); }
  if (tab === 'shipments')   { renderAdminShipments(); }
  if (tab === 'integrations'){ if (typeof loadIntegrationFields === 'function') loadIntegrationFields(); if (typeof renderSessionInfo === 'function') renderSessionInfo(); if (typeof renderLoginLog === 'function') renderLoginLog(); }
};

// ─── SLIDESHOW MANAGEMENT ─────────────────────
function clearAllMedia(){ pesDanger('This will remove all uploaded images and video from this product.','Clear All Media',function(){ currentImages=[]; currentVideo=''; document.getElementById('videoPreview').src=''; document.getElementById('videoPreviewWrap').style.display='none'; document.getElementById('videoDropzoneInner').style.display='flex'; renderMediaGallery(); renderSlideshowOrder(); resetDropzone(); updateMediaCount(); },null,{title:'Clear All Media?',icon:'🖼'}); }
function updateMediaCount(){ const badge=document.getElementById('mediaCountBadge'); if(badge) badge.textContent=currentImages.length+(currentVideo?1:0); }
function renderSlideshowOrder(){ const wrap=document.getElementById('slideshowOrderWrap'), list=document.getElementById('slideshowOrderList'); if(!wrap||!list) return; if(currentImages.length<=1){ wrap.style.display='none'; return; } wrap.style.display='block'; list.innerHTML=currentImages.map((src,i)=>`<div class="slideshow-order-item" draggable="true" ondragstart="soDragStart(event,${i})" ondragover="event.preventDefault()" ondrop="soDrop(event,${i})"><span class="soi-handle">⠿</span><img src="${src}" class="soi-img" onerror="this.src='images/logo.png'"/><span class="soi-label">${i===0?'<strong style="color:var(--white);">Primary</strong> · Slide 1':`Slide ${i+1}`}</span><button onclick="removeImage(${i})" style="background:none;border:none;color:var(--gray);cursor:pointer;font-size:12px;" title="Remove">✕</button></div>`).join(''); if(currentVideo){ list.innerHTML+=`<div class="slideshow-order-item" style="opacity:0.6;cursor:default;"><span class="soi-handle">▶</span><div class="soi-img" style="background:var(--dark3);display:flex;align-items:center;justify-content:center;font-size:18px;">🎬</div><span class="soi-label">Video (last slide)</span></div>`; } }
let _soDragIdx=null;
function soDragStart(e,i){ _soDragIdx=i; e.dataTransfer.effectAllowed='move'; }
function soDrop(e,toIdx){ if(_soDragIdx===null||_soDragIdx===toIdx) return; const moved=currentImages.splice(_soDragIdx,1)[0]; currentImages.splice(toIdx,0,moved); _soDragIdx=null; renderMediaGallery(); renderSlideshowOrder(); updateDropzonePreview(); updateMediaCount(); }

// ─── LOGIN ACTIVITY LOG ───────────────────────
function _logLoginEvent(event){ try{ const log=JSON.parse(localStorage.getItem('pes_login_log')||'[]'); log.unshift({event,time:new Date().toLocaleString('en-NG'),ua:navigator.userAgent.substring(0,60)}); localStorage.setItem('pes_login_log',JSON.stringify(log.slice(0,20))); }catch(e){} }
function renderLoginLog(){ const el=document.getElementById('secLoginLog'); if(!el) return; try{ const log=JSON.parse(localStorage.getItem('pes_login_log')||'[]'); if(!log.length){ el.textContent='No login activity recorded yet.'; return; } el.innerHTML=log.map(e=>'<div style="padding:6px 0;border-bottom:1px solid var(--dark2);"><span style="color:var(--white);font-weight:600;">'+e.event+'</span> &nbsp;·&nbsp; '+e.time+'<div style="font-size:10px;color:var(--dark3);margin-top:2px;">'+e.ua+'</div></div>').join(''); }catch(e){ el.textContent='Could not load log.'; } }
function clearLoginLog(){ localStorage.removeItem('pes_login_log'); renderLoginLog(); showToast('Login log cleared'); }
function renderSessionInfo(){ const el=document.getElementById('secSessionInfo'); if(!el) return; const lastChange=localStorage.getItem('pes_admin_pass_changed'); el.innerHTML='<div>Session uses secure server-side token (expires in 8 hours)</div><div>Last password change: <strong>'+(lastChange?new Date(lastChange).toLocaleString('en-NG'):'Never (using default)')+'</strong></div><div>Browser: <span style="color:var(--light-gray);">'+navigator.userAgent.substring(0,80)+'</span></div>'; }

// Password change (now updates server via apply-reset pathway)
function checkPasswordStrength(val){ const el=document.getElementById('secPassStrength'); if(!el) return; if(!val){ el.textContent=''; return; } let score=0; if(val.length>=8) score++; if(val.length>=12) score++; if(/[A-Z]/.test(val)) score++; if(/[0-9]/.test(val)) score++; if(/[^A-Za-z0-9]/.test(val)) score++; const labels=['','Weak','Fair','Good','Strong','Very Strong'], colors=['','#e53935','#fb8c00','#fdd835','#43a047','#00897b']; el.textContent='Strength: '+(labels[score]||'Weak'); el.style.color=colors[score]||'#e53935'; }

async function changeAdminPassword(){
  const currentPass=document.getElementById('secCurrentPass').value, newPass=document.getElementById('secNewPass').value, confirmPass=document.getElementById('secConfirmPass').value, msg=document.getElementById('secPassMsg');
  msg.style.color='#e53935';
  if(!currentPass||!newPass||!confirmPass){ msg.textContent='Please fill in all three fields.'; return; }
  if(newPass.length<8){ msg.textContent='New password must be at least 8 characters.'; return; }
  if(newPass!==confirmPass){ msg.textContent='New passwords do not match.'; return; }
  const currentHash=await _sha256(currentPass), storedHash=localStorage.getItem('pes_admin_pass_hash'), validHash=storedHash||_APH;
  if(currentHash!==validHash){
    let serverApproved=false;
    try{ const r=await fetch(SERVER+'/api/admin-verify',{method:'POST',headers:adminHeaders(),body:JSON.stringify({usernameHash:_AUH,passwordHash:currentHash})}); const d=await r.json(); if(d.ok&&d.mode==='server') serverApproved=true; }catch(e){}
    if(!serverApproved){ msg.textContent='Current password is incorrect.'; return; }
  }
  const newHash=await _sha256(newPass);
  // Save on server
  try{
    const r=await fetch(SERVER+'/api/settings',{method:'POST',headers:adminHeaders(),body:JSON.stringify({adminPasswordHash:newHash})});
  }catch(e){}
  localStorage.setItem('pes_admin_pass_hash',newHash); localStorage.setItem('pes_admin_pass_changed',new Date().toISOString());
  msg.style.color='#4caf50'; msg.textContent='✓ Password updated successfully. Active from next login.';
  _logLoginEvent('Password changed successfully');
  setTimeout(()=>{ clearPasswordForm(); msg.textContent=''; },3000);
  pesSuccess('Password Updated','Your new password is active from next login.');
}

function clearPasswordForm(){ ['secCurrentPass','secNewPass','secConfirmPass'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; }); const s=document.getElementById('secPassStrength'); if(s) s.textContent=''; const m=document.getElementById('secPassMsg'); if(m) m.textContent=''; }

// ── Admin nav hamburger ──
function toggleAdminMobileNav(){ const drawer=document.getElementById('adminMobDrawer'), overlay=document.getElementById('adminMobOverlay'), btn=document.getElementById('adminHamburger'); if(!drawer) return; const isOpen=drawer.classList.toggle('open'); if(overlay) overlay.classList.toggle('open',isOpen); if(btn) btn.classList.toggle('open',isOpen); document.body.style.overflow=isOpen?'hidden':''; }

// ── Re-render product list on resize ──
(function(){ let t=null; window.addEventListener('resize',function(){ clearTimeout(t); t=setTimeout(function(){ const tab=document.querySelector('.admin-nav-btn.active'); if(tab&&tab.textContent.includes('Products')) renderAdminProducts(); },250); }); })();

/* ════════════════════════════════════════════════════════════════
   ENHANCED ADMIN FUNCTIONS — Media, Promo, Categories, Orders
   ════════════════════════════════════════════════════════════════ */

// ═════════ MEDIA LIBRARY — DRAG & DROP UPLOAD ═════════
let mediaLibItems = JSON.parse(localStorage.getItem('mediaLibrary') || '{}');

function initMediaDragDrop() {
  const zone = document.getElementById('mediaDropZone');
  const input = document.getElementById('mediaLibUpload');
  if (!zone || !input) return;
  
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.style.background = 'rgba(255,255,255,0.08)';
    zone.style.borderColor = 'rgba(255,255,255,0.4)';
  });
  zone.addEventListener('dragleave', () => {
    zone.style.background = 'rgba(255,255,255,0.01)';
    zone.style.borderColor = 'rgba(255,255,255,0.2)';
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.style.background = 'rgba(255,255,255,0.01)';
    zone.style.borderColor = 'rgba(255,255,255,0.2)';
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) uploadMediaFiles(files);
  });
  
  input.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) uploadMediaFiles(files);
  });
  
  renderMediaLibrary();
}

async function uploadMediaFiles(files) {
  const progressDiv = document.getElementById('mediaUploadProgress');
  const progressBar = document.getElementById('mediaUploadBar');
  const progressPercent = document.getElementById('mediaUploadPercent');
  
  if (!progressDiv) return;
  
  progressDiv.style.display = 'block';
  let uploaded = 0;
  
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) {
      showToast('File ' + file.name + ' is too large (max 10MB)');
      continue;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const id = Date.now() + Math.random();
      mediaLibItems[id] = {
        name: file.name,
        data: e.target.result,
        size: file.size,
        uploaded: new Date().toLocaleString('en-NG')
      };
      uploaded++;
      const percent = Math.round((uploaded / files.length) * 100);
      progressPercent.textContent = percent;
      progressBar.style.width = percent + '%';
      
      if (uploaded === files.length) {
        localStorage.setItem('mediaLibrary', JSON.stringify(mediaLibItems));
        progressDiv.style.display = 'none';
        renderMediaLibrary();
        showToast('✓ ' + files.length + ' image(s) uploaded successfully');
      }
    };
    reader.readAsDataURL(file);
  }
}

function renderMediaLibrary() {
  const grid = document.getElementById('mediaLibGrid');
  const empty = document.getElementById('mediaLibEmpty');
  if (!grid) return;
  
  const items = Object.entries(mediaLibItems);
  if (items.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  
  if (empty) empty.style.display = 'none';
  grid.innerHTML = items.map(([id, item]) => `
    <div style="position:relative;border:1px solid rgba(255,255,255,0.1);border-radius:var(--radius);overflow:hidden;aspect-ratio:1;background:var(--dark3);">
      <img src="${item.data}" style="width:100%;height:100%;object-fit:cover;"/>
      <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);opacity:0;transition:opacity 0.2s;display:flex;align-items:center;justify-content:center;gap:8px;" class="media-hover">
        <button onclick="copyMediaLink('${id}')" style="background:var(--white);border:none;color:var(--black);padding:6px 10px;border-radius:3px;font-size:11px;font-weight:600;cursor:pointer;"><i class="fas fa-copy"></i></button>
        <button onclick="deleteMediaItem('${id}')" style="background:#e53935;border:none;color:white;padding:6px 10px;border-radius:3px;font-size:11px;font-weight:600;cursor:pointer;"><i class="fas fa-trash"></i></button>
      </div>
    </div>
  `).join('');
  
  document.querySelectorAll('.media-hover').forEach(el => {
    const parent = el.parentElement;
    parent.addEventListener('mouseenter', () => el.style.opacity = '1');
    parent.addEventListener('mouseleave', () => el.style.opacity = '0');
  });
}

function copyMediaLink(id) {
  if (!mediaLibItems[id]) return;
  const link = '/media/' + id;
  navigator.clipboard.writeText(link);
  showToast('Media link copied: ' + link);
}

function deleteMediaItem(id) {
  if (!mediaLibItems[id]) return;
  pesDanger('Remove this image from the library?', 'Delete Image', function() {
    delete mediaLibItems[id];
    localStorage.setItem('mediaLibrary', JSON.stringify(mediaLibItems));
    renderMediaLibrary();
    showToast('Image deleted');
  }, null, {title: 'Delete Image?', icon: '🗑️'});
}

// ═════════ PROMO CODES — FULL CRUD ═════════
let promoCodesData = {};
let bulkTiersData = [];

function loadPromoData() {
  try {
    const stored = localStorage.getItem('promoCodesData');
    promoCodesData = stored ? JSON.parse(stored) : {};
  } catch (e) {
    promoCodesData = {};
  }
  
  try {
    const stored = localStorage.getItem('bulkTiersData');
    bulkTiersData = stored ? JSON.parse(stored) : [];
  } catch (e) {
    bulkTiersData = [];
  }
}

function renderPromoCodesTable() {
  loadPromoData();
  const tbody = document.getElementById('promoCodesTbody');
  if (!tbody) return;
  
  if (Object.keys(promoCodesData).length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--gray);">No promo codes yet. Create your first one to get started.</td></tr>';
    return;
  }
  
  tbody.innerHTML = Object.entries(promoCodesData).map(([code, data]) => `
    <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
      <td style="padding:12px;"><strong style="color:var(--white);font-family:monospace;">${code}</strong></td>
      <td style="padding:12px;"><span style="background:var(--dark3);padding:4px 10px;border-radius:3px;font-size:11px;font-family:var(--font-sans);">${capitalizeFirst(data.type)}</span></td>
      <td style="padding:12px;"><strong>${data.type === 'shipping' ? 'Free' : data.value + (data.type === 'percent' ? '%' : '₦')}</strong></td>
      <td style="padding:12px;color:var(--light-gray);">${data.label || '—'}</td>
      <td style="padding:12px;text-align:center;"><input type="checkbox" ${data.active ? 'checked' : ''} onchange="togglePromoActive('${code}')" style="accent-color:var(--white);cursor:pointer;"/></td>
      <td style="padding:12px;text-align:center;"><button onclick="deletePromoCode('${code}')" style="background:none;border:none;color:#e53935;cursor:pointer;font-size:14px;"><i class="fas fa-trash"></i></button></td>
    </tr>
  `).join('');
}

function toggleAddPromoForm() {
  const form = document.getElementById('addPromoForm');
  const btn = document.getElementById('toggleAddPromoBtn');
  if (!form) return;
  
  const isHidden = form.style.display === 'none';
  form.style.display = isHidden ? 'block' : 'none';
  if (btn) btn.textContent = isHidden ? '✕ Cancel' : '<i class="fas fa-plus"></i> Add New Code';
}

function cancelAddPromo() {
  document.getElementById('addPromoForm').style.display = 'none';
  document.getElementById('toggleAddPromoBtn').textContent = '<i class="fas fa-plus"></i> Add New Code';
  clearPromoForm();
}

function clearPromoForm() {
  ['newPromoCode', 'newPromoValue', 'newPromoLabel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const typeEl = document.getElementById('newPromoType');
  if (typeEl) typeEl.value = 'percent';
  updatePromoValueLabel();
}

function updatePromoValueLabel() {
  const type = document.getElementById('newPromoType')?.value || 'percent';
  const label = document.getElementById('promoValueLabel');
  if (label) {
    label.textContent = type === 'shipping' ? 'N/A' : (type === 'percent' ? 'Discount %' : 'Amount (₦)');
  }
  const input = document.getElementById('newPromoValue');
  if (input) {
    input.disabled = (type === 'shipping');
    input.value = '';
  }
}

function confirmAddPromo() {
  const code = (document.getElementById('newPromoCode')?.value || '').trim().toUpperCase();
  const type = document.getElementById('newPromoType')?.value || 'percent';
  const value = parseInt(document.getElementById('newPromoValue')?.value || 0);
  const label = (document.getElementById('newPromoLabel')?.value || '').trim();
  const msg = document.getElementById('promoMsg');
  
  if (!code) {
    if (msg) { msg.style.display = 'block'; msg.className = 'form-message'; msg.style.background = 'rgba(229,57,53,0.1)'; msg.style.borderLeft = '3px solid #e53935'; msg.textContent = 'Please enter a promo code'; }
    return;
  }
  if (promoCodesData[code]) {
    if (msg) { msg.style.display = 'block'; msg.className = 'form-message'; msg.style.background = 'rgba(229,57,53,0.1)'; msg.style.borderLeft = '3px solid #e53935'; msg.textContent = 'Code "' + code + '" already exists'; }
    return;
  }
  if (type !== 'shipping' && value <= 0) {
    if (msg) { msg.style.display = 'block'; msg.className = 'form-message'; msg.style.background = 'rgba(229,57,53,0.1)'; msg.style.borderLeft = '3px solid #e53935'; msg.textContent = 'Please enter a valid discount value'; }
    return;
  }
  
  promoCodesData[code] = {
    type: type,
    value: type === 'shipping' ? 0 : value,
    label: label || (type === 'percent' ? value + '% off' : (type === 'shipping' ? 'Free Delivery' : '₦' + value + ' off')),
    active: true
  };
  
  saveAllPromoCodes();
  cancelAddPromo();
  if (msg) { msg.style.display = 'none'; }
  showToast('✓ Promo code "' + code + '" added');
}

function togglePromoActive(code) {
  if (!promoCodesData[code]) return;
  promoCodesData[code].active = !promoCodesData[code].active;
  renderPromoCodesTable();
}

function deletePromoCode(code) {
  if (!promoCodesData[code]) return;
  pesDanger('Delete promo code <strong>' + code + '</strong>? Existing orders will not be affected.', 'Delete Code', function() {
    delete promoCodesData[code];
    saveAllPromoCodes();
    showToast('Promo code deleted');
  }, null, {title: 'Delete Promo Code?', icon: '🗑️'});
}

function saveAllPromoCodes() {
  loadPromoData();
  localStorage.setItem('promoCodesData', JSON.stringify(promoCodesData));
  try {
    fetch(SERVER + '/api/promo-codes', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ promoCodes: promoCodesData })
    });
  } catch (e) {}
  renderPromoCodesTable();
  const msg = document.getElementById('promoMsg');
  if (msg) {
    msg.style.display = 'block';
    msg.className = 'form-message';
    msg.style.background = 'rgba(76,175,80,0.1)';
    msg.style.borderLeft = '3px solid #4caf50';
    msg.textContent = '✓ All promo codes saved successfully';
    setTimeout(() => { msg.style.display = 'none'; }, 3000);
  }
}

// ═════════ BULK TIERS — FULL CRUD ═════════
function renderBulkTiersTable() {
  loadPromoData();
  const tbody = document.getElementById('bulkTiersTbody');
  if (!tbody) return;
  
  if (bulkTiersData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--gray);">No bulk tiers yet. Create your first tier for automatic quantity discounts.</td></tr>';
    return;
  }
  
  tbody.innerHTML = bulkTiersData.map((tier, idx) => `
    <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
      <td style="padding:12px;"><strong>${tier.minQty}</strong></td>
      <td style="padding:12px;"><strong>${tier.maxQty || '∞'}</strong></td>
      <td style="padding:12px;"><span style="background:var(--dark3);padding:4px 10px;border-radius:3px;font-size:11px;font-family:var(--font-sans);">${capitalizeFirst(tier.type)}</span></td>
      <td style="padding:12px;"><strong>${tier.value + (tier.type === 'percent' ? '%' : '₦')}</strong></td>
      <td style="padding:12px;text-align:center;"><input type="checkbox" ${tier.active ? 'checked' : ''} onchange="toggleBulkTierActive(${idx})" style="accent-color:var(--white);cursor:pointer;"/></td>
      <td style="padding:12px;text-align:center;"><button onclick="deleteBulkTier(${idx})" style="background:none;border:none;color:#e53935;cursor:pointer;font-size:14px;"><i class="fas fa-trash"></i></button></td>
    </tr>
  `).join('');
}

function toggleAddBulkTierForm() {
  const form = document.getElementById('addBulkTierForm');
  const btn = document.getElementById('toggleAddBulkTierBtn');
  if (!form) return;
  
  const isHidden = form.style.display === 'none';
  form.style.display = isHidden ? 'block' : 'none';
  if (btn) btn.textContent = isHidden ? '✕ Cancel' : '<i class="fas fa-plus"></i> Add Tier';
}

function cancelAddBulkTier() {
  document.getElementById('addBulkTierForm').style.display = 'none';
  document.getElementById('toggleAddBulkTierBtn').textContent = '<i class="fas fa-plus"></i> Add Tier';
  clearBulkTierForm();
}

function clearBulkTierForm() {
  ['newBulkMinQty', 'newBulkMaxQty', 'newBulkValue'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function confirmAddBulkTier() {
  const minQty = parseInt(document.getElementById('newBulkMinQty')?.value || 0);
  const maxQty = parseInt(document.getElementById('newBulkMaxQty')?.value || 0);
  const type = document.getElementById('newBulkType')?.value || 'percent';
  const value = parseInt(document.getElementById('newBulkValue')?.value || 0);
  const msg = document.getElementById('bulkMsg');
  
  if (minQty < 1 || maxQty < minQty) {
    if (msg) { msg.style.display = 'block'; msg.className = 'form-message'; msg.style.background = 'rgba(229,57,53,0.1)'; msg.style.borderLeft = '3px solid #e53935'; msg.textContent = 'Invalid quantity range'; }
    return;
  }
  if (value <= 0) {
    if (msg) { msg.style.display = 'block'; msg.className = 'form-message'; msg.style.background = 'rgba(229,57,53,0.1)'; msg.style.borderLeft = '3px solid #e53935'; msg.textContent = 'Please enter a valid discount value'; }
    return;
  }
  
  bulkTiersData.push({
    minQty: minQty,
    maxQty: maxQty,
    type: type,
    value: value,
    active: true
  });
  
  saveAllBulkTiers();
  cancelAddBulkTier();
  if (msg) { msg.style.display = 'none'; }
  showToast('✓ Bulk tier added (₦' + minQty + '-' + maxQty + ')');
}

function toggleBulkTierActive(idx) {
  if (!bulkTiersData[idx]) return;
  bulkTiersData[idx].active = !bulkTiersData[idx].active;
  renderBulkTiersTable();
}

function deleteBulkTier(idx) {
  if (!bulkTiersData[idx]) return;
  const tier = bulkTiersData[idx];
  pesDanger('Delete bulk tier for ' + tier.minQty + '-' + tier.maxQty + ' units?', 'Delete Tier', function() {
    bulkTiersData.splice(idx, 1);
    saveAllBulkTiers();
    showToast('Bulk tier deleted');
  }, null, {title: 'Delete Bulk Tier?', icon: '🗑️'});
}

function saveAllBulkTiers() {
  localStorage.setItem('bulkTiersData', JSON.stringify(bulkTiersData));
  try {
    fetch(SERVER + '/api/bulk-tiers', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ bulkTiers: bulkTiersData })
    });
  } catch (e) {}
  renderBulkTiersTable();
  const msg = document.getElementById('bulkMsg');
  if (msg) {
    msg.style.display = 'block';
    msg.className = 'form-message';
    msg.style.background = 'rgba(76,175,80,0.1)';
    msg.style.borderLeft = '3px solid #4caf50';
    msg.textContent = '✓ All bulk tiers saved successfully';
    setTimeout(() => { msg.style.display = 'none'; }, 3000);
  }
}

// ═════════ ORDERS — RECEIPT DOWNLOAD ═════════
function exportOrdersCSV() {
  const orders = getOrders() || [];
  if (orders.length === 0) {
    showToast('No orders to export');
    return;
  }
  
  const headers = ['Order ID', 'Customer', 'Email', 'Phone', 'Items', 'Total (₦)', 'Payment Gateway', 'Status', 'Date'];
  const rows = orders.map(o => [
    o.id || '',
    o.customer || '',
    o.email || '',
    o.phone || '',
    (o.items || []).length,
    o.total || 0,
    o.gateway || 'Unknown',
    o.status || 'pending',
    o.date || ''
  ]);
  
  let csv = headers.join(',') + '\n';
  rows.forEach(row => {
    csv += row.map(cell => {
      if (typeof cell === 'string' && (cell.includes(',') || cell.includes('"'))) {
        return '"' + cell.replace(/"/g, '""') + '"';
      }
      return cell;
    }).join(',') + '\n';
  });
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'orders-' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
  window.URL.revokeObjectURL(url);
  showToast('✓ Orders exported: ' + orders.length + ' orders');
}

function downloadOrderReceipt(orderId) {
  const orders = getOrders() || [];
  const order = orders.find(o => o.id === orderId);
  if (!order) {
    showToast('Order not found');
    return;
  }
  
  const receiptHTML = generateReceiptHTML(order);
  const printWindow = window.open('', '', 'width=800,height=600');
  printWindow.document.write(receiptHTML);
  printWindow.document.close();
  printWindow.print();
}

function generateReceiptHTML(order) {
  const items = (order.items || []).map(i => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #ddd;">${i.name || ''}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd;text-align:center;">×${i.qty || 1}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd;text-align:right;">₦${((i.price || 0) * (i.qty || 1)).toLocaleString()}</td>
    </tr>
  `).join('');
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Order Receipt - ${order.id}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
        .receipt { max-width: 600px; margin: 0 auto; border: 1px solid #ddd; padding: 30px; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
        .header h1 { margin: 0; font-size: 28px; }
        .header p { margin: 5px 0; color: #666; }
        .section { margin-bottom: 20px; }
        .section-title { font-weight: bold; border-bottom: 1px solid #ddd; padding-bottom: 10px; margin-bottom: 10px; }
        .info-row { display: flex; justify-content: space-between; padding: 5px 0; }
        table { width: 100%; }
        .total { text-align: right; font-weight: bold; font-size: 18px; padding: 15px 0; border-top: 2px solid #333; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        @media print { body { margin: 0; } }
      </style>
    </head>
    <body>
      <div class="receipt">
        <div class="header">
          <h1>RECEIPT</h1>
          <p>Order ID: <strong>${order.id}</strong></p>
          <p>Date: ${order.date || new Date().toLocaleDateString('en-NG')}</p>
        </div>
        
        <div class="section">
          <div class="section-title">Customer Information</div>
          <div class="info-row"><span>Name:</span><strong>${order.customer || 'N/A'}</strong></div>
          <div class="info-row"><span>Email:</span><strong>${order.email || 'N/A'}</strong></div>
          <div class="info-row"><span>Phone:</span><strong>${order.phone || 'N/A'}</strong></div>
        </div>
        
        <div class="section">
          <div class="section-title">Items Ordered</div>
          <table>
            <thead>
              <tr style="background:#f5f5f5;">
                <th style="text-align:left;padding:8px;">Product</th>
                <th style="text-align:center;padding:8px;">Qty</th>
                <th style="text-align:right;padding:8px;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${items}
            </tbody>
          </table>
        </div>
        
        <div class="section">
          <div class="section-title">Order Summary</div>
          <div class="info-row"><span>Subtotal:</span><strong>₦${(order.total || 0).toLocaleString()}</strong></div>
          <div class="info-row"><span>Shipping:</span><strong>₦${(order.shipping || 0).toLocaleString()}</strong></div>
          <div class="info-row"><span>Discount:</span><strong>-₦${(order.discount || 0).toLocaleString()}</strong></div>
          <div class="info-row total"><span>Total Amount:</span><strong>₦${(order.total || 0).toLocaleString()}</strong></div>
        </div>
        
        <div class="section">
          <div class="section-title">Payment & Status</div>
          <div class="info-row"><span>Payment Gateway:</span><strong>${order.gateway || 'Unknown'}</strong></div>
          <div class="info-row"><span>Payment Status:</span><strong style="color:${order.status === 'paid' ? '#4caf50' : '#f57c00'}">${(order.status || 'pending').toUpperCase()}</strong></div>
        </div>
        
        <div class="footer">
          <p>Thank you for your purchase!</p>
          <p>This is a system-generated receipt. Please keep for your records.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// ═════════ CATEGORIES — ENHANCED WITH STATS ═════════
function renderCatAdminEnhanced() {
  const cats = getCategories();
  const prods = getProducts();
  const totalRestricted = cats.filter(c => c.ageRestricted).length;
  
  document.getElementById('totalCatCount').textContent = cats.length;
  document.getElementById('restrictedCatCount').textContent = totalRestricted;
  document.getElementById('totalProdCount').textContent = prods.length;
  
  const sorted = [...cats].sort((a, b) => {
    if (a.ageRestricted && !b.ageRestricted) return -1;
    if (!a.ageRestricted && b.ageRestricted) return 1;
    return a.name.localeCompare(b.name);
  });
  
  const grid = document.getElementById('catAdminGrid');
  if (!grid) return;
  
  grid.innerHTML = sorted.map(cat => {
    const count = prods.filter(p => p.category === cat.name).length;
    const isRestricted = !!cat.ageRestricted;
    return `
      <div style="background:var(--dark2);border:1px solid rgba(255,255,255,0.07);border-radius:var(--radius);padding:20px;position:relative;overflow:hidden;transition:all 0.3s;">
        <button onclick="deleteCategory(${cat.id},'${escStr(cat.name)}')" style="position:absolute;top:10px;right:10px;background:rgba(229,57,53,0.2);border:none;color:#e53935;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;">✕</button>
        
        <div style="background:var(--dark3);border-radius:var(--radius);overflow:hidden;height:100px;margin-bottom:16px;display:flex;align-items:center;justify-content:center;">
          ${isRestricted ? '<div style="font-size:48px;">🔞</div>' : '<img src="' + cat.image + '" style="width:100%;height:100%;object-fit:cover;" onerror="this.src=\'images/logo.png\'"/>'}
        </div>
        
        <div style="margin-bottom:12px;">
          <h4 style="margin:0 0 6px 0;font-size:16px;color:var(--white);">
            ${cat.name}
            ${isRestricted ? '<span style="background:#ffc107;color:#000;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;margin-left:8px;">18+</span>' : ''}
          </h4>
          <p style="margin:0;color:var(--gray);font-size:12px;line-height:1.5;">${cat.description || 'No description'}</p>
        </div>
        
        <div style="background:var(--dark3);padding:10px;border-radius:var(--radius);margin-bottom:16px;text-align:center;font-weight:600;color:var(--white);">
          ${count} product${count !== 1 ? 's' : ''}
        </div>
        
        <div style="background:var(--dark3);padding:12px;border-radius:var(--radius);">
          <div style="font-family:var(--font-sans);font-size:9px;font-weight:700;color:var(--gray);letter-spacing:0.1em;margin-bottom:10px;">AGE RESTRICTION</div>
          <div style="display:flex;gap:8px;">
            <button onclick="setCatAgeRestricted(${cat.id},true)" style="flex:1;padding:8px;background:${isRestricted ? 'var(--white)' : 'var(--dark2)'};color:${isRestricted ? 'var(--black)' : 'var(--gray)'};border:none;border-radius:3px;font-weight:600;cursor:pointer;transition:all 0.2s;font-size:12px;">Yes</button>
            <button onclick="setCatAgeRestricted(${cat.id},false)" style="flex:1;padding:8px;background:${!isRestricted ? 'var(--white)' : 'var(--dark2)'};color:${!isRestricted ? 'var(--black)' : 'var(--gray)'};border:none;border-radius:3px;font-weight:600;cursor:pointer;transition:all 0.2s;font-size:12px;">No</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ═════════ INITIALIZATION & HELPER FUNCTIONS ═════════
function capitalizeFirst(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function initAdminEnhancements() {
  initMediaDragDrop();
  loadPromoData();
  renderPromoCodesTable();
  renderBulkTiersTable();
  renderCatAdminEnhanced();
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (document.getElementById('mediaDropZone')) {
      initAdminEnhancements();
    }
  }, 500);
});

// Override the old renderCatAdmin with the enhanced version
const oldRenderCatAdmin = renderCatAdmin;
renderCatAdmin = renderCatAdminEnhanced;
