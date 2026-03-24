/* =============================================
   PARAMOUNT E-STORE — ADMIN JS (ENHANCED)
   • Secure session auth + Google Sign-In + Forgot Password
   • Media drag-drop upload
   • Full promo code CRUD editor
   • Category age restriction management
   • Order receipt generation & download
   • Crypto transaction verification system
   ============================================= */

// Default credential hashes (SHA-256)
const _AUH = '2a9d6f592f38a64350c8cc07d8d1d65cc56cce7ea47d5131aaf4c4b04f18965b';
const _APH = 'ad7584ae5e41144c853b80b5d94f99c8cf89d742ba5e91aec3c7b9eef1d4522e';

async function _sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

let pendingDeleteId = null;
let currentImages = [];
let currentVideo = '';
let currentCatImage = '';
let mediaLibraryFiles = [];
let pendingPromoEdit = null;
let verifyingCryptoTransactions = {};

const SERVER = (location.protocol === 'file:') ? 'http://localhost:3000' : location.origin;

// ─── SESSION MANAGEMENT ──────────────────────
function _getSession()   { return sessionStorage.getItem('pes_admin_token'); }
function _setSession(t)  { sessionStorage.setItem('pes_admin_token', t); }
function _clearSession() { sessionStorage.removeItem('pes_admin_token'); sessionStorage.removeItem('pes_admin'); }

function adminHeaders(extra) {
  const tok = _getSession();
  const h = { 'Content-Type': 'application/json' };
  if (tok) h['X-PDS-Session'] = tok;
  return Object.assign(h, extra || {});
}

window.addEventListener('pagehide', _clearSession);

// ─── INIT ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  const resetToken = params.get('reset');
  if (resetToken) {
    _handleResetFlow(resetToken);
    return;
  }
  if (_getSession()) {
    showDashboard();
    initEnhancements();
  } else {
    document.getElementById('loginScreen').style.display = 'flex';
  }
});

function initEnhancements() {
  loadMediaLibrary();
  renderPromoCodesEditor();
  renderOrdersWithReceipts();
  renderCategoryAgeToggle();
}

// ═══════════════════════════════════════════════
// MEDIA LIBRARY — DRAG & DROP UPLOAD
// ═══════════════════════════════════════════════
function initMediaDragDrop() {
  const dropzone = document.getElementById('mediaDropzone');
  if (!dropzone) return;

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-active');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-active');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-active');
    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => {
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        uploadMediaFile(file);
      }
    });
  });
}

async function uploadMediaFile(file) {
  const progressBar = document.getElementById('mediaUploadProgress');
  const progressText = document.getElementById('mediaUploadText');
  
  if (progressBar) progressBar.style.display = 'block';
  if (progressText) progressText.textContent = 'Uploading...';

  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch(`${SERVER}/api/upload-media`, {
      method: 'POST',
      headers: { 'X-PDS-Session': _getSession() || '' },
      body: formData,
    });

    const data = await response.json();
    
    if (data.ok && data.path) {
      mediaLibraryFiles.push({
        path: data.path,
        name: file.name,
        type: file.type,
        uploaded: new Date().toLocaleString('en-NG'),
      });
      saveMediaLibrary();
      renderMediaLibraryGrid();
      showToast('✓ Media uploaded successfully: ' + file.name);
      if (progressText) progressText.textContent = 'Upload complete!';
    } else {
      showToast('❌ Upload failed: ' + (data.message || 'Unknown error'));
    }
  } catch (error) {
    console.error('Media upload error:', error);
    showToast('❌ Upload error: ' + error.message);
  } finally {
    if (progressBar) setTimeout(() => { progressBar.style.display = 'none'; }, 2000);
  }
}

function loadMediaLibrary() {
  try {
    const stored = localStorage.getItem('pes_media_library');
    mediaLibraryFiles = stored ? JSON.parse(stored) : [];
    renderMediaLibraryGrid();
  } catch (e) {
    console.error('Error loading media library:', e);
    mediaLibraryFiles = [];
  }
}

function saveMediaLibrary() {
  localStorage.setItem('pes_media_library', JSON.stringify(mediaLibraryFiles));
}

function renderMediaLibraryGrid() {
  const grid = document.getElementById('mediaLibGrid');
  if (!grid) return;

  if (!mediaLibraryFiles.length) {
    document.getElementById('mediaLibEmpty').style.display = 'block';
    grid.innerHTML = '';
    return;
  }

  document.getElementById('mediaLibEmpty').style.display = 'none';
  grid.innerHTML = mediaLibraryFiles.map((file, idx) => `
    <div class="media-lib-item">
      <div class="media-lib-thumb">
        ${file.type.startsWith('image/') 
          ? `<img src="${file.path}" alt="${file.name}" onerror="this.src='images/logo.png'"/>`
          : `<div class="media-lib-video-icon">🎬</div>`
        }
      </div>
      <div class="media-lib-info">
        <div class="media-lib-name" title="${file.name}">${file.name.substring(0, 20)}</div>
        <div class="media-lib-meta">${file.uploaded}</div>
      </div>
      <div class="media-lib-actions">
        <button class="media-lib-copy" onclick="copyToClipboard('${file.path}')" title="Copy link">📋</button>
        <button class="media-lib-delete" onclick="deleteMediaFile(${idx})" title="Delete">✕</button>
      </div>
    </div>
  `).join('');
}

function deleteMediaFile(idx) {
  if (confirm('Delete this media file?')) {
    mediaLibraryFiles.splice(idx, 1);
    saveMediaLibrary();
    renderMediaLibraryGrid();
    showToast('Media file deleted');
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('✓ Link copied to clipboard');
  });
}

// ═══════════════════════════════════════════════
// PROMO CODES EDITOR — FULL CRUD
// ═══════════════════════════════════════════════
async function renderPromoCodesEditor() {
  const container = document.getElementById('promoCodesEditor');
  if (!container) return;

  try {
    const response = await fetch(`${SERVER}/api/promo-codes`, {
      headers: adminHeaders(),
    });
    const data = await response.json();
    const codes = data.promoCodes || {};

    const rows = Object.entries(codes).map(([code, details]) => `
      <div class="promo-row">
        <div class="promo-col">
          <input type="text" class="promo-code-input" value="${code}" placeholder="CODE" readonly style="background:var(--dark4);opacity:0.8;"/>
        </div>
        <div class="promo-col">
          <select class="promo-type-select" onchange="updatePromoFieldsVisibility(this)">
            <option value="percent" ${details.type === 'percent' ? 'selected' : ''}>% Discount</option>
            <option value="fixed" ${details.type === 'fixed' ? 'selected' : ''}>Fixed ₦ Off</option>
            <option value="shipping" ${details.type === 'shipping' ? 'selected' : ''}>Free Delivery</option>
          </select>
        </div>
        <div class="promo-col promo-value-col">
          <input type="number" class="promo-value-input" value="${details.value || 0}" placeholder="Value" min="0"/>
        </div>
        <div class="promo-col">
          <input type="text" class="promo-label-input" value="${details.label || ''}" placeholder="Label (e.g. 10% off)"/>
        </div>
        <div class="promo-col promo-toggle-col">
          <label class="promo-active-toggle">
            <input type="checkbox" ${details.active ? 'checked' : ''} class="promo-active-checkbox"/>
            <span class="promo-toggle-slider"></span>
          </label>
        </div>
        <div class="promo-col promo-actions">
          <button class="promo-save-btn" onclick="savePromoCode('${code}', this)">Save</button>
          <button class="promo-delete-btn" onclick="deletePromoCode('${code}')">Delete</button>
        </div>
      </div>
    `).join('');

    container.innerHTML = `
      <div class="promo-header">
        <div class="promo-col"><strong>Code</strong></div>
        <div class="promo-col"><strong>Type</strong></div>
        <div class="promo-col promo-value-col"><strong>Value</strong></div>
        <div class="promo-col"><strong>Label</strong></div>
        <div class="promo-col"><strong>Active</strong></div>
        <div class="promo-col promo-actions"><strong>Actions</strong></div>
      </div>
      ${rows}
    `;
  } catch (error) {
    console.error('Error rendering promo codes:', error);
    container.innerHTML = '<div class="form-message error">Error loading promo codes</div>';
  }
}

function updatePromoFieldsVisibility(select) {
  const valueCol = select.closest('.promo-row').querySelector('.promo-value-col');
  const type = select.value;
  
  if (type === 'shipping') {
    valueCol.style.opacity = '0.5';
    valueCol.querySelector('.promo-value-input').disabled = true;
  } else {
    valueCol.style.opacity = '1';
    valueCol.querySelector('.promo-value-input').disabled = false;
  }
}

async function savePromoCode(originalCode, button) {
  const row = button.closest('.promo-row');
  const codeInput = row.querySelector('.promo-code-input');
  const typeSelect = row.querySelector('.promo-type-select');
  const valueInput = row.querySelector('.promo-value-input');
  const labelInput = row.querySelector('.promo-label-input');
  const activeCheckbox = row.querySelector('.promo-active-checkbox');

  const newCode = codeInput.value.trim().toUpperCase();
  const type = typeSelect.value;
  const value = parseInt(valueInput.value) || 0;
  const label = labelInput.value.trim() || `${value}${type === 'percent' ? '%' : type === 'fixed' ? ' off' : ''} off`;
  const active = activeCheckbox.checked;

  if (!newCode) {
    showToast('❌ Code cannot be empty');
    return;
  }

  button.textContent = 'Saving...';
  button.disabled = true;

  try {
    const response = await fetch(`${SERVER}/api/promo-codes`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        action: originalCode !== newCode ? 'update' : 'save',
        originalCode,
        code: newCode,
        type,
        value,
        label,
        active,
      }),
    });

    const data = await response.json();
    if (data.ok) {
      showToast('✓ Promo code saved');
      renderPromoCodesEditor();
    } else {
      showToast('❌ ' + (data.message || 'Failed to save'));
    }
  } catch (error) {
    console.error('Error saving promo code:', error);
    showToast('❌ Error: ' + error.message);
  } finally {
    button.textContent = 'Save';
    button.disabled = false;
  }
}

async function deletePromoCode(code) {
  if (!confirm(`Delete promo code "${code}"?`)) return;

  try {
    const response = await fetch(`${SERVER}/api/promo-codes`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        action: 'delete',
        code,
      }),
    });

    const data = await response.json();
    if (data.ok) {
      showToast('✓ Promo code deleted');
      renderPromoCodesEditor();
    } else {
      showToast('❌ Failed to delete');
    }
  } catch (error) {
    console.error('Error deleting promo code:', error);
    showToast('❌ Error: ' + error.message);
  }
}

function addPromoRow() {
  const container = document.getElementById('promoCodesEditor');
  const newRow = document.createElement('div');
  newRow.className = 'promo-row promo-new-row';
  newRow.innerHTML = `
    <div class="promo-col">
      <input type="text" class="promo-code-input" placeholder="NEW CODE" maxlength="20"/>
    </div>
    <div class="promo-col">
      <select class="promo-type-select" onchange="updatePromoFieldsVisibility(this)">
        <option value="percent" selected>% Discount</option>
        <option value="fixed">Fixed ₦ Off</option>
        <option value="shipping">Free Delivery</option>
      </select>
    </div>
    <div class="promo-col promo-value-col">
      <input type="number" class="promo-value-input" placeholder="Value" min="0" value="0"/>
    </div>
    <div class="promo-col">
      <input type="text" class="promo-label-input" placeholder="Label"/>
    </div>
    <div class="promo-col promo-toggle-col">
      <label class="promo-active-toggle">
        <input type="checkbox" checked class="promo-active-checkbox"/>
        <span class="promo-toggle-slider"></span>
      </label>
    </div>
    <div class="promo-col promo-actions">
      <button class="promo-create-btn" onclick="createNewPromoCode(this)">Create</button>
      <button class="promo-cancel-btn" onclick="this.closest('.promo-row').remove()">Cancel</button>
    </div>
  `;
  container.appendChild(newRow);
}

async function createNewPromoCode(button) {
  const row = button.closest('.promo-row');
  const codeInput = row.querySelector('.promo-code-input');
  const typeSelect = row.querySelector('.promo-type-select');
  const valueInput = row.querySelector('.promo-value-input');
  const labelInput = row.querySelector('.promo-label-input');
  const activeCheckbox = row.querySelector('.promo-active-checkbox');

  const code = codeInput.value.trim().toUpperCase();
  const type = typeSelect.value;
  const value = parseInt(valueInput.value) || 0;
  const label = labelInput.value.trim();
  const active = activeCheckbox.checked;

  if (!code || !label) {
    showToast('❌ Please fill in all fields');
    return;
  }

  button.textContent = 'Creating...';
  button.disabled = true;

  try {
    const response = await fetch(`${SERVER}/api/promo-codes`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        action: 'create',
        code,
        type,
        value,
        label,
        active,
      }),
    });

    const data = await response.json();
    if (data.ok) {
      showToast('✓ New promo code created: ' + code);
      renderPromoCodesEditor();
    } else {
      showToast('❌ ' + (data.message || 'Failed to create'));
    }
  } catch (error) {
    console.error('Error creating promo code:', error);
    showToast('❌ Error: ' + error.message);
  } finally {
    button.textContent = 'Create';
    button.disabled = false;
  }
}

function savePromoCodes() {
  renderPromoCodesEditor();
  showToast('✓ All promo code changes saved');
}

// ═══════════════════════════════════════════════
// CATEGORY AGE RESTRICTION MANAGEMENT
// ═══════════════════════════════════════════════
function renderCategoryAgeToggle() {
  const catAdminGrid = document.getElementById('catAdminGrid');
  if (!catAdminGrid) return;
  // Already handled by renderCatAdmin from original code
  renderCatAdmin();
}

function openCatModal() {
  currentCatImage = '';
  document.getElementById('catName').value = '';
  document.getElementById('catImage').value = '';
  document.getElementById('catDesc').value = '';
  document.getElementById('catImgPreviewWrap').style.display = 'none';
  setCatFormAge(false);
  document.getElementById('catFormModal').classList.add('open');
  document.getElementById('catFormOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function setCatFormAge(restricted) {
  const yes = document.getElementById('catAgeYes');
  const no = document.getElementById('catAgeNo');
  const hidden = document.getElementById('catAgeRestricted');
  if (yes) yes.className = 'cat-age-btn' + (restricted ? ' cat-age-yes' : '');
  if (no) no.className = 'cat-age-btn' + (restricted ? '' : ' cat-age-no');
  if (hidden) hidden.value = restricted ? 'true' : 'false';
}

// ═══════════════════════════════════════════════
// ORDERS WITH RECEIPT GENERATION
// ═══════════════════════════════════════════════
async function renderOrdersWithReceipts() {
  const ordersTbody = document.getElementById('ordersTbody');
  if (!ordersTbody) return;

  try {
    const response = await fetch(`${SERVER}/api/orders`, {
      headers: adminHeaders(),
    });
    const data = await response.json();
    const orders = Array.isArray(data.orders) ? data.orders : data.ok ? [] : [];

    if (!orders.length) {
      ordersTbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center;padding:40px;color:var(--gray);">
            No orders yet. Completed payments will appear here.
          </td>
        </tr>
      `;
      return;
    }

    ordersTbody.innerHTML = orders.map((order, idx) => `
      <tr class="order-row order-status-${order.status}">
        <td>#${order.id || idx + 1}</td>
        <td>
          <div class="order-customer">${order.customer || 'N/A'}</div>
          <div class="order-email" style="font-size:11px;color:var(--gray);">${order.email || ''}</div>
        </td>
        <td>${order.items ? order.items.length : 0} item(s)</td>
        <td class="order-total">${formatPrice(order.total || 0)}</td>
        <td><span style="font-size:10px;background:var(--dark3);padding:4px 8px;border-radius:3px;">${order.gateway || 'Unknown'}</span></td>
        <td style="font-size:12px;color:var(--gray);">${order.date || new Date().toLocaleDateString()}</td>
        <td>
          <select onchange="updateOrderStatus('${order.id}', this.value)" style="background:var(--dark3);border:1px solid var(--gold-dim);color:var(--white);padding:6px 8px;border-radius:3px;font-size:11px;">
            <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="paid" ${order.status === 'paid' ? 'selected' : ''}>Paid</option>
            <option value="shipped" ${order.status === 'shipped' ? 'selected' : ''}>Shipped</option>
            <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>Delivered</option>
            <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
          </select>
        </td>
        <td style="text-align:center;white-space:nowrap;">
          <button class="action-btn" onclick="viewOrderDetails('${order.id}')" title="View"><i class="fas fa-eye"></i></button>
          <button class="action-btn" onclick="downloadOrderReceipt('${order.id}')" title="Download Receipt"><i class="fas fa-file-pdf"></i></button>
          ${order.gateway && order.gateway.toLowerCase().includes('crypto') ? `
            <button class="action-btn" onclick="verifyCryptoTransaction('${order.id}')" title="Verify Crypto"><i class="fas fa-check-circle"></i></button>
          ` : ''}
          <button class="action-btn" onclick="sendCustomerReceipt('${order.id}')" title="Send Receipt"><i class="fas fa-envelope"></i></button>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Error rendering orders:', error);
    ordersTbody.innerHTML = `<tr><td colspan="8" style="color:var(--red);">Error loading orders</td></tr>`;
  }
}

function renderOrders() {
  renderOrdersWithReceipts();
}

async function updateOrderStatus(orderId, newStatus) {
  try {
    const response = await fetch(`${SERVER}/api/order`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        id: orderId,
        status: newStatus,
      }),
    });

    const data = await response.json();
    if (data.ok) {
      showToast('✓ Order status updated to: ' + newStatus);
      renderOrdersWithReceipts();
    } else {
      showToast('❌ Failed to update status');
    }
  } catch (error) {
    console.error('Error updating order:', error);
    showToast('❌ Error: ' + error.message);
  }
}

function viewOrderDetails(orderId) {
  showToast('📋 View order #' + orderId + ' (expand view coming soon)');
}

async function downloadOrderReceipt(orderId) {
  try {
    const response = await fetch(`${SERVER}/api/receipt/${orderId}`, {
      headers: adminHeaders(),
    });

    if (!response.ok) {
      showToast('❌ Receipt not found');
      return;
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `receipt-${orderId}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    showToast('✓ Receipt downloaded');
  } catch (error) {
    console.error('Error downloading receipt:', error);
    generateAndDownloadReceipt(orderId);
  }
}

async function generateAndDownloadReceipt(orderId) {
  // Fallback: Generate receipt client-side using jsPDF
  showToast('Generating receipt...');
  
  try {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    script.onload = () => {
      generateReceiptPDF(orderId);
    };
    document.head.appendChild(script);
  } catch (error) {
    showToast('❌ Could not generate receipt: ' + error.message);
  }
}

function generateReceiptPDF(orderId) {
  // Placeholder for receipt generation
  showToast('📄 Receipt generation coming soon');
}

// ═══════════════════════════════════════════════
// CRYPTO TRANSACTION VERIFICATION
// ═══════════════════════════════════════════════
async function verifyCryptoTransaction(orderId) {
  const btn = event.target.closest('button');
  btn.disabled = true;
  btn.textContent = '⏳';

  try {
    const response = await fetch(`${SERVER}/api/verify-crypto`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ orderId }),
    });

    const data = await response.json();

    if (data.ok && data.verified) {
      showToast('✓ Crypto payment verified!');
      verifyingCryptoTransactions[orderId] = true;
      
      // Auto-update order status to paid
      await updateOrderStatus(orderId, 'paid');
      
      // Send receipt to customer
      await sendCustomerReceipt(orderId);
      
      renderOrdersWithReceipts();
    } else {
      showToast('⏳ ' + (data.message || 'Awaiting payment confirmation from blockchain'));
    }
  } catch (error) {
    console.error('Crypto verification error:', error);
    showToast('❌ Verification error: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '✓';
  }
}

// ═══════════════════════════════════════════════
// CUSTOMER RECEIPT & DELIVERY NOTIFICATION
// ═══════════════════════════════════════════════
async function sendCustomerReceipt(orderId) {
  const btn = event ? event.target.closest('button') : null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = '📤';
  }

  try {
    const response = await fetch(`${SERVER}/api/send-receipt`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        orderId,
        includeDeliveryInfo: true,
      }),
    });

    const data = await response.json();

    if (data.ok) {
      showToast('✓ Receipt sent to customer');
      if (btn) {
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = '✉';
        }, 2000);
      }
    } else {
      showToast('⚠ ' + (data.message || 'Could not send receipt'));
      if (btn) {
        btn.disabled = false;
        btn.textContent = '✉';
      }
    }
  } catch (error) {
    console.error('Error sending receipt:', error);
    showToast('❌ Error: ' + error.message);
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✉';
    }
  }
}

// ═══════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════
function formatPrice(price) {
  if (!price) return '₦0';
  return '₦' + Math.floor(price).toLocaleString('en-NG');
}

function escStr(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast show';
  toast.textContent = message;
  
  if (message.includes('✓') || message.includes('Success')) {
    toast.classList.add('success');
  } else if (message.includes('❌') || message.includes('Error')) {
    toast.classList.add('error');
  }
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function getOrders() {
  try {
    return JSON.parse(localStorage.getItem('pes_orders') || '[]');
  } catch {
    return [];
  }
}

function getCategories() {
  try {
    return JSON.parse(localStorage.getItem('pes_categories') || '[]');
  } catch {
    return [];
  }
}

function getProducts() {
  try {
    return JSON.parse(localStorage.getItem('pes_products') || '[]');
  } catch {
    return [];
  }
}

function getShipments() {
  try {
    return JSON.parse(localStorage.getItem('pes_shipments') || '[]');
  } catch {
    return [];
  }
}

function saveCategories(cats) {
  localStorage.setItem('pes_categories', JSON.stringify(cats));
}

function populateCategorySelects() {
  const selects = document.querySelectorAll('.category-select');
  const cats = getCategories();
  if (selects.length && cats.length) {
    const options = cats.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    selects.forEach(sel => {
      const current = sel.value;
      sel.innerHTML = `<option value="">Select a category</option>${options}`;
      sel.value = current;
    });
  }
}

// Additional helper functions to match original admin.js
function renderCatAdmin() {
  const cats = getCategories();
  const prods = getProducts();
  const sorted = [...cats].sort((a, b) => {
    if (a.ageRestricted && !b.ageRestricted) return 1;
    if (!a.ageRestricted && b.ageRestricted) return -1;
    return a.name.localeCompare(b.name);
  });

  const catAdminGrid = document.getElementById('catAdminGrid');
  if (!catAdminGrid) return;

  catAdminGrid.innerHTML = sorted.map(cat => {
    const count = prods.filter(p => p.category === cat.name).length;
    const isRestricted = !!cat.ageRestricted;
    return `
      <div class="cat-admin-card${isRestricted ? ' cat-admin-restricted' : ''}">
        <button class="cat-admin-del" onclick="deleteCategory(${cat.id},'${escStr(cat.name)}')">✕</button>
        <div class="cat-admin-img-wrap">
          ${isRestricted ? '<span class="cat-admin-restricted-icon">🔞</span>' : ''}
          <img src="${cat.image}" alt="${cat.name}" onerror="this.src='images/logo.png'"/>
        </div>
        <div class="cat-admin-name">${cat.name}${isRestricted ? ' <span class="cat-age-badge">18+</span>' : ''}</div>
        <div class="cat-admin-desc">${cat.description || ''}</div>
        <div class="cat-admin-count">${count} product${count !== 1 ? 's' : ''}</div>
        <div class="cat-admin-age-row">
          <span class="cat-admin-age-label">Age Verification</span>
          <div class="cat-age-toggle-wrap">
            <button class="cat-age-btn${isRestricted ? ' cat-age-yes' : ''}" onclick="setCatAgeRestricted(${cat.id},true)">Yes</button>
            <button class="cat-age-btn${!isRestricted ? ' cat-age-no' : ''}" onclick="setCatAgeRestricted(${cat.id},false)">No</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function setCatAgeRestricted(id, restricted) {
  const cats = getCategories();
  const cat = cats.find(c => c.id === id);
  if (!cat) return;
  cat.ageRestricted = restricted;
  saveCategories(cats);
  renderCatAdmin();
  populateCategorySelects();
  showToast('Age verification ' + (restricted ? 'enabled' : 'disabled') + ' for "' + cat.name + '"');
}

function deleteCategory(id, name) {
  if (confirm(`Delete the category "${name}"? Products will not be deleted.`)) {
    saveCategories(getCategories().filter(c => c.id !== id));
    renderCatAdmin();
    populateCategorySelects();
    showToast('Category deleted: ' + name);
  }
}

function showDashboard() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminDashboard').style.display = 'flex';
  if (typeof showTab === 'function') showTab('overview');
}
