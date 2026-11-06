'use strict';
/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const R = n => Math.round((+n + Number.EPSILON) * 100) / 100;
const money = n => '₹' + R(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const fd = d => (d || '').split('-').reverse().join('-');
const fyOf = d => { const [y, m] = d.split('-').map(Number); const s = m >= 4 ? y : y - 1; return `${s}-${String(s + 1).slice(2)}`; };
const TS = () => firebase.firestore.FieldValue.serverTimestamp();
const tsStr = t => t && t.toDate ? t.toDate().toLocaleString('en-IN') : 'pending sync';
function words(n) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = x => x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : '');
  const three = x => (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '');
  let r = Math.floor(n), p = Math.round((n - r) * 100), s = '';
  [[1e7, 'Crore'], [1e5, 'Lakh'], [1e3, 'Thousand']].forEach(([d, nm]) => { if (r >= d) { s += three(Math.floor(r / d)) + ' ' + nm + ' '; r %= d; } });
  if (r) s += three(r) + ' ';
  return 'Rupees ' + (s.trim() || 'Zero') + (p ? ' and ' + two(p) + ' Paise' : '') + ' Only';
}
function calc(items) {
  const taxable = R(items.reduce((s, i) => s + R(i.qty * i.rate), 0));
  const cgst = R(taxable * 0.025), sgst = R(taxable * 0.025);
  return { subtotal: taxable, taxable, cgst, sgst, total: R(taxable + cgst + sgst) };
}
const paidOf = inv => R((inv.payments || []).reduce((s, p) => s + p.amount, 0));
const statusOf = inv => { const p = paidOf(inv); return p <= 0 ? 'UNPAID' : p >= inv.total - 0.005 ? 'PAID' : 'PARTIAL'; };
const balOf = inv => R(inv.total - paidOf(inv));
const custBal = c => R((c.opening || 0) + S.invoices.filter(i => i.customerId === c.id).reduce((s, i) => s + i.total - paidOf(i), 0));

/* ---------- firebase ---------- */
firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth(), db = firebase.firestore();
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
const S = { products: [], customers: [], invoices: [], moves: [], logs: [], settings: {} };
let unsubs = [], view = 'dashboard', chart = null;
const lowLimit = () => +(S.settings.lowStock ?? 10);
const log = (action, detail) => db.collection('activityLogs').add({ action, detail, at: TS() });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
const setNet = () => { const e = $('#sync'); e.textContent = navigator.onLine ? 'Online' : 'Offline · changes sync later'; e.className = 'pill' + (navigator.onLine ? '' : ' off'); };
addEventListener('online', setNet); addEventListener('offline', setNet);

/* ---------- auth ---------- */
auth.onAuthStateChanged(u => {
  unsubs.forEach(f => f()); unsubs = [];
  $('#login').classList.toggle('hidden', !!u); $('#app').classList.toggle('hidden', !u);
  if (!u) return;
  setNet();
  const listen = (col, key, q) => unsubs.push((q || db.collection(col)).onSnapshot(s => { S[key] = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, e => console.error(col, e)));
  listen('products', 'products'); listen('customers', 'customers'); listen('invoices', 'invoices');
  listen('stockMovements', 'moves', db.collection('stockMovements').orderBy('at', 'desc').limit(500));
  listen('activityLogs', 'logs', db.collection('activityLogs').orderBy('at', 'desc').limit(300));
  unsubs.push(db.collection('companySettings').doc('main').onSnapshot(d => { S.settings = d.data() || {}; render(); }));
  go(location.hash.slice(1) || 'dashboard');
  autoBackup();
});
$('#lBtn').onclick = async () => {
  const u = $('#lUser').value.trim().toLowerCase(), p = $('#lPass').value;
  $('#lErr').textContent = '';
  try { await auth.signInWithEmailAndPassword(`${u}@${LOGIN_DOMAIN}`, p); } catch (e) { $('#lErr').textContent = 'Incorrect username or password.'; }
};
$('#lPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#lBtn').click(); });
$('#logout').onclick = () => auth.signOut();
$('#menuBtn').onclick = () => $('#side').classList.toggle('open');

/* ---------- router ---------- */
const VIEWS = { dashboard: ['Dashboard', vDash], invoices: ['Invoices', vInv], products: ['Products', vProd], customers: ['Customers', vCust], stock: ['Inventory', vStock], ledger: ['Customer Ledger', vLedger], reports: ['Reports', vReports], activity: ['Activity Log', vAct], backup: ['Backup & Restore', vBackup], settings: ['Settings', vSet] };
$('#nav').innerHTML = Object.entries(VIEWS).map(([k, v]) => `<a href="#${k}" data-v="${k}">${v[0]}</a>`).join('');
function go(v) { view = VIEWS[v] ? v : 'dashboard'; location.hash = view; $('#side').classList.remove('open'); render(); }
addEventListener('hashchange', () => { if (location.hash.slice(1) !== view && auth.currentUser) go(location.hash.slice(1)); });
function render() {
  if (!auth.currentUser || $('#modal:not(.hidden)') && modalLock) return;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === view));
  $('#title').textContent = VIEWS[view][0];
  const keep = document.activeElement && document.activeElement.closest('#view') ? null : 0;
  if (view === 'ledger' && $('#view input:focus,#view select:focus')) return;
  if (['invoices', 'reports'].includes(view) && $('#view input:focus,#view select:focus')) return;
  VIEWS[view][1]();
}
let modalLock = false;
function modal(title, body, onSave, wide, saveText = 'Save') {
  modalLock = true;
  $('#sheet').className = 'sheet' + (wide ? ' wide' : '');
  $('#sheet').innerHTML = `<h2 style="margin-top:0">${esc(title)}</h2>${body}<div class="foot"><button class="btn" onclick="closeModal()">${onSave ? 'Cancel' : 'Close'}</button>${onSave ? `<button class="btn primary" id="mSave">${saveText}</button>` : ''}</div>`;
  $('#modal').classList.remove('hidden');
  if (onSave) $('#mSave').onclick = async e => { e.target.disabled = true; try { await onSave(); } catch (err) { alert(err.message || err); } e.target.disabled = false; };
}
function closeModal() { modalLock = false; $('#modal').classList.add('hidden'); $('#sheet').innerHTML = ''; render(); }
const val = id => $('#' + id).value.trim();
const tbl = (head, rows, empty = 'Nothing here yet.') => `<div class="tw"><table><tr>${head.map(h => `<th class="${/amount|rate|qty|total|bal|stock|price|₹/i.test(h) ? 'r' : ''}">${h}</th>`).join('')}</tr>${rows.length ? rows.join('') : `<tr><td colspan="${head.length}" class="muted">${empty}</td></tr>`}</table></div>`;
const tag = s => `<span class="tag ${s}">${s === 'PARTIAL' ? 'PARTIALLY PAID' : s}</span>`;
const sum = (a, f) => R(a.reduce((s, x) => s + f(x), 0));

/* ---------- dashboard ---------- */
function vDash() {
  const t = today(), m = t.slice(0, 7), I = S.invoices, pays = I.flatMap(i => (i.payments || []).map(p => ({ ...p, inv: i })));
  const low = S.products.filter(p => (p.stock || 0) <= lowLimit());
  const card = (l, v) => `<div class="card"><small>${l}</small><b>${v}</b></div>`;
  $('#view').innerHTML = `<div class="bar"><button class="btn primary" onclick="invForm()">+ New invoice</button></div>
  <div class="cards">${card("Today's sales", money(sum(I.filter(i => i.date === t), i => i.total)))}${card('Monthly sales', money(sum(I.filter(i => i.date.startsWith(m)), i => i.total)))}
  ${card('Total outstanding', money(sum(S.customers, custBal)))}${card('Cash received', money(sum(pays.filter(p => p.method === 'Cash'), p => p.amount)))}
  ${card('UPI received', money(sum(pays.filter(p => p.method === 'UPI'), p => p.amount)))}${card('Credit sales', money(sum(I, balOf)))}
  ${card('Customers', S.customers.length)}${card('Products', S.products.length)}${card('Available stock (boxes)', S.products.reduce((s, p) => s + (p.stock || 0), 0))}${card('Low stock products', low.length)}</div>
  <div class="panel"><h3>Monthly sales (last 12 months)</h3><canvas id="ch" height="90"></canvas></div>
  <div class="grid2">
   <div class="panel"><h3>Recent invoices</h3>${tbl(['Invoice', 'Customer', 'Total'], [...I].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)).slice(0, 6).map(i => `<tr><td>${esc(i.number)}</td><td>${esc(i.customerName)}</td><td class="r">${money(i.total)}</td></tr>`))}</div>
   <div class="panel"><h3>Recent payments</h3>${tbl(['Date', 'Customer', 'Method', 'Amount'], pays.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map(p => `<tr><td>${fd(p.date)}</td><td>${esc(p.inv.customerName)}</td><td>${p.method}</td><td class="r">${money(p.amount)}</td></tr>`))}</div>
   <div class="panel"><h3>Latest customer activity</h3>${tbl(['Customer', 'Last invoice', 'Balance'], S.customers.map(c => ({ c, d: S.invoices.filter(i => i.customerId === c.id).map(i => i.date).sort().pop() })).filter(x => x.d).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 6).map(x => `<tr><td>${esc(x.c.name)}</td><td>${fd(x.d)}</td><td class="r">${money(custBal(x.c))}</td></tr>`))}</div>
   <div class="panel"><h3>Low-stock notifications</h3>${tbl(['Product', 'Stock'], low.map(p => `<tr><td>${esc(p.name)} ${esc(p.size)}</td><td class="r ${p.stock < 0 ? 'neg' : ''}">${p.stock || 0}</td></tr>`), 'All products are well stocked.')}</div></div>`;
  const labels = [], data = [], d0 = new Date(); d0.setDate(1);
  for (let k = 11; k >= 0; k--) { const d = new Date(d0.getFullYear(), d0.getMonth() - k, 1), key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; labels.push(key); data.push(sum(I.filter(i => i.date.startsWith(key)), i => i.total)); }
  if (chart) { chart.destroy(); chart = null; }
  if (typeof Chart === 'undefined') { $('#ch').insertAdjacentHTML('afterend', '<p class="muted">Chart could not be loaded (check your internet connection).</p>'); $('#ch').remove(); return; }
  chart = new Chart($('#ch'), { type: 'bar', data: { labels, datasets: [{ data, backgroundColor: '#1d4ed8', borderRadius: 4 }] }, options: { plugins: { legend: { display: false } } } });
}

/* ---------- products ---------- */
let pq = '';
function vProd() {
  const rows = S.products.filter(p => (p.name + p.brand + p.size + p.sku).toLowerCase().includes(pq.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  $('#view').innerHTML = `<div class="bar"><input class="grow" placeholder="Search products" value="${esc(pq)}" oninput="pq=this.value;vProd();this.focus()" id="pqIn"><button class="btn primary" onclick="prodForm()">+ Add product</button>${S.products.length ? '' : '<button class="btn" onclick="defaultProducts()">Add default sizes</button>'}</div>
  <div class="panel">${tbl(['Product', 'Brand', 'Size', 'SKU', 'HSN', 'Price', 'Cost', 'Stock', ''], rows.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.brand)}</td><td>${esc(p.size)}</td><td>${esc(p.sku)}</td><td>${esc(p.hsn)}</td><td class="r">${money(p.price)}</td><td class="r">${p.cost ? money(p.cost) : '-'}</td><td class="r ${p.stock < 0 ? 'neg' : ''}">${p.stock || 0} ${esc(p.unit || 'Box')}${p.stock < 0 ? ' (negative)' : ''}</td>
  <td><button class="btn sm" onclick="prodForm('${p.id}')">Edit</button> <button class="btn sm" onclick="prodHist('${p.id}')">History</button> <button class="btn sm danger" onclick="delProd('${p.id}')">Delete</button></td></tr>`), 'No products. Add one or use the default sizes.')}</div>`;
  const i = $('#pqIn'); if (i && pq) { i.focus(); i.setSelectionRange(pq.length, pq.length); }
}
async function defaultProducts() {
  const b = db.batch();
  ['8×10', '10×12', '11×14', '14×17'].forEach(s => { b.set(db.collection('products').doc(), { name: 'X-Ray Film ' + s, brand: '', size: s, sku: 'XRF-' + s.replace('×', 'x'), hsn: '37011000', unit: 'Box', gst: 5, price: 0, cost: 0, opening: 0, stock: 0, createdAt: TS() }); });
  await b.commit(); log('Product created', 'Default X-Ray film sizes added');
}
function prodForm(id) {
  const p = S.products.find(x => x.id === id) || {};
  const f = (i, l, v, t = 'text', x = '') => `<label>${l}<input id="${i}" type="${t}" value="${esc(v ?? '')}" ${x}></label>`;
  modal(id ? 'Edit product' : 'Add product', `<div class="form">${f('pN', 'Product name', p.name)}${f('pB', 'Brand', p.brand)}${f('pS', 'Size', p.size)}${f('pK', 'Product code / SKU', p.sku)}${f('pH', 'HSN code', p.hsn || '37011000')}${f('pU', 'Unit', 'Box', 'text', 'readonly')}
  ${f('pP', 'Selling price (excl. GST)', p.price, 'number', 'step="0.01" min="0"')}${f('pC', 'Cost price (optional)', p.cost, 'number', 'step="0.01" min="0"')}
  ${id ? f('pCur', 'Current stock (use Inventory to change)', p.stock, 'number', 'readonly') : f('pO', 'Opening stock', 0, 'number', 'step="1"')}</div><p class="muted">GST is fixed at 5% (CGST 2.5% + SGST 2.5%).</p>`, async () => {
    const d = { name: val('pN'), brand: val('pB'), size: val('pS'), sku: val('pK'), hsn: val('pH'), unit: 'Box', gst: 5, price: R(val('pP') || 0), cost: R(val('pC') || 0) };
    if (!d.name) throw new Error('Product name is required.');
    if (d.price < 0) throw new Error('Price cannot be negative.');
    if (S.products.some(x => x.id !== id && d.sku && x.sku === d.sku)) throw new Error('SKU already exists.');
    if (id) { await db.collection('products').doc(id).update(d); log('Product edited', d.name); }
    else { const o = +val('pO') || 0, ref = db.collection('products').doc(); const b = db.batch(); b.set(ref, { ...d, opening: o, stock: o, createdAt: TS() }); if (o) b.set(db.collection('stockMovements').doc(), { productId: ref.id, productName: d.name, qty: o, type: 'opening', ref: '', date: today(), at: TS() }); await b.commit(); log('Product created', d.name); }
    closeModal();
  });
}
async function delProd(id) {
  const p = S.products.find(x => x.id === id);
  if (S.invoices.some(i => i.items.some(x => x.productId === id))) return alert('This product is used in invoices and cannot be deleted.');
  if (!confirm(`Delete ${p.name}?`)) return;
  await db.collection('products').doc(id).delete(); log('Product deleted', p.name);
}
function prodHist(id) {
  const p = S.products.find(x => x.id === id);
  modal('History · ' + p.name, tbl(['Date', 'Type', 'Ref', 'Qty'], S.moves.filter(m => m.productId === id).map(m => `<tr><td>${fd(m.date)}</td><td>${m.type}</td><td>${esc(m.ref)}</td><td class="r">${m.qty > 0 ? '+' : ''}${m.qty}</td></tr>`)), null, true);
}

/* ---------- customers ---------- */
let cq = '';
function vCust() {
  const rows = S.customers.filter(c => (c.name + c.gstin).toLowerCase().includes(cq.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  $('#view').innerHTML = `<div class="bar"><input class="grow" id="cqIn" placeholder="Search customers" value="${esc(cq)}" oninput="cq=this.value;vCust()"><button class="btn primary" onclick="custForm()">+ Add customer</button></div>
  <div class="panel">${tbl(['Customer', 'GSTIN', 'Address', 'Total sales', 'Outstanding', ''], rows.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.gstin)}</td><td>${esc(c.address)}</td><td class="r">${money(sum(S.invoices.filter(i => i.customerId === c.id), i => i.total))}</td><td class="r">${money(custBal(c))}</td>
  <td><button class="btn sm" onclick="custForm('${c.id}')">Edit</button> <button class="btn sm" onclick="ledgerFor='${c.id}';go('ledger')">Ledger</button> <button class="btn sm danger" onclick="delCust('${c.id}')">Delete</button></td></tr>`), 'No customers yet.')}</div>`;
  const i = $('#cqIn'); if (i && cq) { i.focus(); i.setSelectionRange(cq.length, cq.length); }
}
function custForm(id) {
  const c = S.customers.find(x => x.id === id) || {};
  modal(id ? 'Edit customer' : 'Add customer', `<div class="form"><label class="full">Customer / hospital name<input id="cN" value="${esc(c.name)}"></label><label>GSTIN<input id="cG" value="${esc(c.gstin)}" maxlength="15"></label><label>Opening balance (₹)<input id="cO" type="number" step="0.01" value="${c.opening || 0}"></label><label class="full">Address<textarea id="cA" rows="3">${esc(c.address)}</textarea></label></div>`, async () => {
    const d = { name: val('cN'), gstin: val('cG').toUpperCase(), address: val('cA'), opening: R(val('cO') || 0) };
    if (!d.name) throw new Error('Name is required.');
    if (d.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(d.gstin)) throw new Error('GSTIN format is invalid.');
    if (id) { await db.collection('customers').doc(id).update(d); log('Customer edited', d.name); } else { await db.collection('customers').add({ ...d, createdAt: TS() }); log('Customer created', d.name); }
    closeModal();
  });
}
async function delCust(id) {
  const c = S.customers.find(x => x.id === id);
  if (S.invoices.some(i => i.customerId === id) || c.opening) return alert('Customer has invoices or an opening balance, so it cannot be deleted. Delete or clear those first.');
  if (confirm(`Delete ${c.name}?`)) { await db.collection('customers').doc(id).delete(); log('Customer deleted', c.name); }
}

/* ---------- invoices ---------- */
let F = { items: [], pays: [] }, ifilter = { q: '', st: '', from: '', to: '' };
function vInv() {
  const f = ifilter, rows = S.invoices.filter(i => (!f.q || (i.number + i.customerName).toLowerCase().includes(f.q.toLowerCase())) && (!f.st || statusOf(i) === f.st) && (!f.from || i.date >= f.from) && (!f.to || i.date <= f.to)).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  $('#view').innerHTML = `<div class="bar"><input class="grow" placeholder="Invoice no. or customer" value="${esc(f.q)}" oninput="ifilter.q=this.value;vInv()" id="iq"><select onchange="ifilter.st=this.value;vInv()"><option value="">All status</option>${['PAID', 'PARTIAL', 'UNPAID'].map(s => `<option ${f.st === s ? 'selected' : ''} value="${s}">${s}</option>`).join('')}</select>
  <input type="date" value="${f.from}" onchange="ifilter.from=this.value;vInv()"><input type="date" value="${f.to}" onchange="ifilter.to=this.value;vInv()"><button class="btn primary" onclick="invForm()">+ New invoice</button></div>
  <div class="panel">${tbl(['Invoice', 'Date', 'Customer', 'Total', 'Paid', 'Balance', 'Status', ''], rows.map(i => `<tr><td>${esc(i.number)}</td><td>${fd(i.date)}</td><td>${esc(i.customerName)}</td><td class="r">${money(i.total)}</td><td class="r">${money(paidOf(i))}</td><td class="r">${money(balOf(i))}</td><td>${tag(statusOf(i))}</td>
  <td><button class="btn sm" onclick="invView('${i.id}')">View</button> <button class="btn sm" onclick="addPay('${i.id}')">+ Payment</button> <button class="btn sm" onclick="editInv('${i.id}')">Edit</button> <button class="btn sm danger" onclick="delInv('${i.id}')">Delete</button></td></tr>`), 'No invoices found.')}</div>`;
  const e = $('#iq'); if (e && f.q) { e.focus(); e.setSelectionRange(f.q.length, f.q.length); }
}
function editInv(id) { if (confirm('Edit this invoice? GST, stock and customer balance will be recalculated and the change recorded.')) invForm(S.invoices.find(i => i.id === id)); }
function invForm(old) {
  F = { id: old?.id || db.collection('invoices').doc().id, items: old ? JSON.parse(JSON.stringify(old.items)) : [{ productId: '', qty: 1, rate: 0 }], pays: old ? JSON.parse(JSON.stringify(old.payments || [])) : [] };
  const o = old || {};
  modal(old ? 'Edit invoice ' + old.number : 'New invoice', `<div class="form"><label>Invoice number<input readonly value="${old ? esc(old.number) : 'Assigned on save'}"></label><label>Invoice date<input type="date" id="iD" value="${o.date || today()}"></label>
  <label class="full">Customer<select id="iC" onchange="pickCust()"><option value="">Walk-in / type details below</option>${S.customers.map(c => `<option value="${c.id}" ${o.customerId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
  <label>Customer name<input id="iN" value="${esc(o.customerName)}"></label><label>GSTIN<input id="iG" value="${esc(o.gstin)}"></label><label class="full">Address<textarea id="iA" rows="2">${esc(o.address)}</textarea></label></div>
  <h3>Products</h3><div class="tw"><table id="itb"></table></div><button class="btn sm" onclick="F.items.push({productId:'',qty:1,rate:0});drawF()">+ Add product</button>
  <h3>Payments received</h3><div class="tw"><table id="ptb"></table></div><button class="btn sm" onclick="F.pays.push({id:crypto.randomUUID(),date:val('iD'),method:'Cash',amount:0});drawF()">+ Add payment</button>
  <p class="muted">Any unpaid amount stays as credit/outstanding on the customer.</p><div class="tot" id="tot"></div>`, saveInv, true, old ? 'Save changes' : 'Create invoice');
  drawF();
}
function pickCust() { const c = S.customers.find(x => x.id === val('iC')); if (c) { $('#iN').value = c.name; $('#iG').value = c.gstin || ''; $('#iA').value = c.address || ''; } }
function drawF() {
  $('#itb').innerHTML = `<tr><th>#</th><th>Product</th><th>Size</th><th>Qty (boxes)</th><th>Rate</th><th class="r">Amount</th><th></th></tr>` + F.items.map((it, k) => {
    const p = S.products.find(x => x.id === it.productId);
    return `<tr><td>${k + 1}</td><td><select onchange="selP(${k},this.value)"><option value="">Select</option>${S.products.map(x => `<option value="${x.id}" ${x.id === it.productId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></td><td>${esc(p?.size || '')}</td>
    <td><input type="number" min="1" step="1" value="${it.qty}" style="width:80px" oninput="F.items[${k}].qty=+this.value;tot()"></td><td><input type="number" min="0" step="0.01" value="${it.rate}" style="width:110px" oninput="F.items[${k}].rate=+this.value;tot()"></td><td class="r" id="am${k}"></td><td>${F.items.length > 1 ? `<button class="btn sm danger" onclick="F.items.splice(${k},1);drawF()">×</button>` : ''}</td></tr>`;
  }).join('');
  $('#ptb').innerHTML = F.pays.map((p, k) => `<tr><td><input type="date" value="${p.date}" onchange="F.pays[${k}].date=this.value"></td><td><select onchange="F.pays[${k}].method=this.value">${['Cash', 'UPI', 'Bank Transfer', 'Cheque'].map(m => `<option ${m === p.method ? 'selected' : ''}>${m}</option>`).join('')}</select></td><td><input type="number" min="0" step="0.01" value="${p.amount}" oninput="F.pays[${k}].amount=+this.value;tot()"></td><td><button class="btn sm danger" onclick="F.pays.splice(${k},1);drawF()">×</button></td></tr>`).join('');
  tot();
}
function selP(k, id) { const p = S.products.find(x => x.id === id); F.items[k].productId = id; F.items[k].rate = p ? p.price : 0; drawF(); }
function tot() {
  F.items.forEach((it, k) => { const e = $('#am' + k); if (e) e.textContent = money(R(it.qty * it.rate)); });
  const c = calc(F.items), paid = R(F.pays.reduce((s, p) => s + (+p.amount || 0), 0));
  $('#tot').innerHTML = [['Subtotal', c.subtotal], ['Taxable amount', c.taxable], ['CGST 2.5%', c.cgst], ['SGST 2.5%', c.sgst], ['<b>Grand total</b>', c.total], ['Amount received', paid], ['<b>Outstanding</b>', R(c.total - paid)]].map(([l, v]) => `<div><span>${l}</span><span>${money(v)}</span></div>`).join('');
}
async function saveInv() {
  const date = val('iD'), name = val('iN');
  if (!date) throw new Error('Invoice date is required.'); if (!name) throw new Error('Customer name is required.');
  const items = F.items.map(it => { const p = S.products.find(x => x.id === it.productId); if (!p) throw new Error('Select a product on every row.'); if (!(it.qty > 0) || !Number.isInteger(+it.qty)) throw new Error('Quantity must be a whole number above 0.'); if (it.rate < 0) throw new Error('Rate cannot be negative.'); return { productId: p.id, name: p.name, size: p.size, qty: +it.qty, rate: R(it.rate), amount: R(it.qty * it.rate), cost: p.cost || 0 }; });
  const pays = F.pays.filter(p => p.amount > 0).map(p => ({ ...p, amount: R(p.amount) }));
  const c = calc(items), paid = R(pays.reduce((s, p) => s + p.amount, 0));
  if (paid > c.total + 0.005 && !confirm('Payments exceed the invoice total. Continue?')) return;
  const old = S.invoices.find(i => i.id === F.id);
  const need = {}; items.forEach(i => need[i.productId] = (need[i.productId] || 0) + i.qty); (old?.items || []).forEach(i => need[i.productId] = (need[i.productId] || 0) - i.qty);
  const short = Object.entries(need).filter(([id, q]) => (S.products.find(p => p.id === id)?.stock || 0) - q < 0).map(([id]) => S.products.find(p => p.id === id).name);
  if (short.length && !confirm(`Insufficient stock for: ${short.join(', ')}.\nProceed and create negative stock?`)) return;
  const inv = { id: F.id, date, customerId: val('iC'), customerName: name, gstin: val('iG').toUpperCase(), address: val('iA'), items, ...c, payments: pays, paid, balance: R(c.total - paid) };
  if (old) inv.history = [...(old.history || []), { at: new Date().toISOString(), prevTotal: old.total, prevDate: old.date, prevItems: old.items.map(i => `${i.name} x${i.qty} @${i.rate}`).join('; ') }];
  const num = await saveInvoice(inv, old);
  closeModal(); if (!old) invView(F.id, num);
}
async function saveInvoice(inv, old) {
  const iref = db.collection('invoices').doc(inv.id), cref = db.collection('invoiceCounters').doc(fyOf(inv.date)); let number;
  await db.runTransaction(async t => {
    const isNew = !old, ids = [...new Set([...(old?.items || []), ...inv.items].map(i => i.productId))];
    const [cs, is, ...ps] = await Promise.all([t.get(cref), t.get(iref), ...ids.map(id => t.get(db.collection('products').doc(id)))]);
    if (isNew && is.exists) throw new Error('This invoice was already saved.');
    if (!isNew && !is.exists) throw new Error('Invoice no longer exists.');
    const last = cs.exists ? cs.data().last : 0;
    number = isNew ? `APEX/${fyOf(inv.date)}/${String(last + 1).padStart(3, '0')}` : old.number;
    const d = {}; (old?.items || []).forEach(i => d[i.productId] = (d[i.productId] || 0) + i.qty); inv.items.forEach(i => d[i.productId] = (d[i.productId] || 0) - i.qty);
    ps.forEach(p => { const x = d[p.id] || 0; if (!x) return; if (!p.exists) { if (x < 0) throw new Error('A product on this invoice was deleted.'); return; } t.update(p.ref, { stock: (p.data().stock || 0) + x }); t.set(db.collection('stockMovements').doc(), { productId: p.id, productName: p.data().name, qty: x, type: isNew ? 'sale' : 'sale-edit', ref: number, date: inv.date, at: TS() }); });
    if (isNew) t.set(cref, { last: last + 1 });
    t.set(iref, { ...inv, number, createdAt: isNew ? TS() : (old.createdAt || TS()), updatedAt: TS() });
    t.set(db.collection('activityLogs').doc(), { action: isNew ? 'Invoice created' : 'Invoice edited', detail: `${number} · ${inv.customerName} · ${money(inv.total)}`, at: TS() });
  });
  return number;
}
async function delInv(id) {
  const old = S.invoices.find(i => i.id === id);
  if (!confirm(`Permanently delete ${old.number}? Stock will be restored and the customer balance recalculated.`)) return;
  await db.runTransaction(async t => {
    const ids = [...new Set(old.items.map(i => i.productId))], ps = await Promise.all(ids.map(p => t.get(db.collection('products').doc(p))));
    ps.forEach(p => { if (!p.exists) return; const q = old.items.filter(i => i.productId === p.id).reduce((s, i) => s + i.qty, 0); t.update(p.ref, { stock: (p.data().stock || 0) + q }); t.set(db.collection('stockMovements').doc(), { productId: p.id, productName: p.data().name, qty: q, type: 'sale-deleted', ref: old.number, date: today(), at: TS() }); });
    t.delete(db.collection('invoices').doc(id));
    t.set(db.collection('activityLogs').doc(), { action: 'Invoice deleted', detail: `${old.number} · ${old.customerName} · ${money(old.total)} (stock restored, ${paidOf(old) ? money(paidOf(old)) + ' payments removed' : 'no payments'})`, at: TS() });
  });
}
function addPay(id) {
  const i = S.invoices.find(x => x.id === id);
  modal('Record payment · ' + i.number, `<p>Outstanding: <b>${money(balOf(i))}</b></p><div class="form"><label>Date<input type="date" id="yD" value="${today()}"></label><label>Method<select id="yM">${['Cash', 'UPI', 'Bank Transfer', 'Cheque'].map(m => `<option>${m}</option>`).join('')}</select></label><label>Amount<input type="number" id="yA" step="0.01" min="0" value="${balOf(i)}"></label></div>`, async () => {
    const amt = R(val('yA')); if (!(amt > 0)) throw new Error('Enter an amount above 0.');
    await db.runTransaction(async t => {
      const s = await t.get(db.collection('invoices').doc(id)); const cur = s.data(), pays = [...(cur.payments || []), { id: crypto.randomUUID(), date: val('yD'), method: val('yM'), amount: amt }];
      const paid = R(pays.reduce((a, p) => a + p.amount, 0));
      t.update(s.ref, { payments: pays, paid, balance: R(cur.total - paid) });
      t.set(db.collection('activityLogs').doc(), { action: 'Payment received', detail: `${cur.number} · ${val('yM')} · ${money(amt)}`, at: TS() });
    });
    closeModal();
  });
}

/* ---------- invoice PDF ---------- */
function invPDF(inv) {
  const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'mm', format: 'a4' }), s = S.settings, B = [29, 78, 216], W = 210;
  let y = 14;
  if (s.logo) { try { doc.addImage(s.logo, /png/i.test(s.logo) ? 'PNG' : 'JPEG', 14, y - 4, 22, 22); } catch (e) {} }
  const x0 = s.logo ? 40 : 14;
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...B).text(s.name || 'Company Name', x0, y + 2);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(60);
  const addr = doc.splitTextToSize(s.address || '', 100); doc.text(addr, x0, y + 8);
  doc.text(`Mobile: ${s.mobile || ''}   GSTIN: ${s.gstin || ''}`, x0, y + 8 + addr.length * 4);
  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...B).text('TAX INVOICE', W - 14, y + 2, { align: 'right' });
  doc.setFontSize(9).setTextColor(40).text(`Invoice No: ${inv.number}`, W - 14, y + 9, { align: 'right' }).text(`Date: ${fd(inv.date)}`, W - 14, y + 14, { align: 'right' });
  y += 30; doc.setDrawColor(...B).setLineWidth(.6).line(14, y, W - 14, y); y += 6;
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...B).text('BILL TO', 14, y);
  doc.setTextColor(30).setFontSize(10).text(inv.customerName, 14, y + 5); doc.setFont('helvetica', 'normal').setFontSize(9);
  const ca = doc.splitTextToSize(inv.address || '', 110); doc.text(ca, 14, y + 10); doc.text(inv.gstin ? 'GSTIN: ' + inv.gstin : '', 14, y + 10 + ca.length * 4);
  y += 20 + ca.length * 4;
  const f = n => R(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  doc.autoTable({ startY: y, head: [['Sl.', 'Product Name', 'Size', 'Qty', 'Rate', 'Amount']], body: inv.items.map((i, k) => [k + 1, i.name, i.size, i.qty, f(i.rate), f(i.amount)]), theme: 'grid', headStyles: { fillColor: B, textColor: 255 }, styles: { fontSize: 9, lineColor: [220, 224, 230] }, columnStyles: { 0: { cellWidth: 12 }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } } });
  y = doc.lastAutoTable.finalY + 4;
  doc.autoTable({ startY: y, margin: { left: 110 }, body: [['Taxable Amount', f(inv.taxable)], ['CGST @ 2.5%', f(inv.cgst)], ['SGST @ 2.5%', f(inv.sgst)], ['Grand Total', f(inv.total)]], theme: 'plain', styles: { fontSize: 9.5 }, columnStyles: { 1: { halign: 'right' } }, didParseCell: d => { if (d.row.index === 3) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = B; } } });
  y = doc.lastAutoTable.finalY + 8;
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(30).text('Amount in words:', 14, y); doc.setFont('helvetica', 'normal').text(doc.splitTextToSize(words(inv.total), W - 28), 14, y + 5);
  y += 16; doc.setFont('helvetica', 'bold').setTextColor(...B).text('Bank details', 14, y); doc.setFont('helvetica', 'normal').setTextColor(50);
  doc.text([`A/c Name: ${s.bankAccName || ''}`, `Bank: ${s.bankName || ''}   Branch: ${s.branch || ''}`, `A/c No: ${s.accNo || ''}   IFSC: ${s.ifsc || ''}`], 14, y + 5);
  return doc;
}
const safe = s => String(s).replace(/[^\w\-]+/g, '_');
const pdfName = i => `${safe(i.customerName)}_${safe(i.number)}_${i.date}.pdf`;
function invView(id, num) {
  const inv = S.invoices.find(i => i.id === id); if (!inv) return setTimeout(() => invView(id), 600);
  const url = invPDF(inv).output('bloburl');
  modal('Invoice ' + inv.number, `<iframe src="${url}"></iframe><div class="foot" style="justify-content:flex-start"><button class="btn" onclick="invDl('${id}')">Download PDF</button><button class="btn" onclick="invPrint('${id}')">Print A4</button><button class="btn" onclick="invWA('${id}')">Share on WhatsApp</button></div>
  ${(inv.history || []).length ? `<h3>Modification history</h3>${tbl(['When', 'Previous total', 'Previous items'], inv.history.map(h => `<tr><td>${new Date(h.at).toLocaleString('en-IN')}</td><td class="r">${money(h.prevTotal)}</td><td>${esc(h.prevItems)}</td></tr>`))}` : ''}`, null, true);
}
const invDl = id => { const i = S.invoices.find(x => x.id === id); invPDF(i).save(pdfName(i)); };
const invPrint = id => { const d = invPDF(S.invoices.find(x => x.id === id)); d.autoPrint(); window.open(d.output('bloburl')); };
function invWA(id) {
  const i = S.invoices.find(x => x.id === id); invDl(id);
  const t = `Hello ${i.customerName}, your invoice ${i.number} dated ${fd(i.date)} for ${money(i.total)} from ${S.settings.name || 'APEX'}. I am sending the PDF in this chat.`;
  alert('The PDF has been downloaded. WhatsApp will open next: attach the downloaded file to the chat and send.');
  window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank');
}

/* ---------- inventory ---------- */
function vStock() {
  $('#view').innerHTML = `<div class="bar"><button class="btn primary" onclick="stockForm('add')">+ Add stock</button><button class="btn" onclick="stockForm('adjust')">Adjust stock</button></div>
  <div class="panel"><h3>Current stock</h3>${tbl(['Product', 'Size', 'Stock', 'Status'], S.products.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.size)}</td><td class="r ${p.stock < 0 ? 'neg' : ''}">${p.stock || 0}</td><td>${p.stock < 0 ? '<span class="neg">NEGATIVE</span>' : p.stock <= lowLimit() ? 'Low' : 'OK'}</td></tr>`))}</div>
  <div class="panel"><h3>Stock movement history</h3>${tbl(['Date', 'Product', 'Type', 'Ref', 'Qty'], S.moves.slice(0, 200).map(m => `<tr><td>${fd(m.date)}</td><td>${esc(m.productName)}</td><td>${m.type}</td><td>${esc(m.ref)}</td><td class="r">${m.qty > 0 ? '+' : ''}${m.qty}</td></tr>`))}</div>`;
}
function stockForm(kind) {
  modal(kind === 'add' ? 'Add stock' : 'Adjust stock', `<div class="form"><label>Product<select id="sP">${S.products.map(p => `<option value="${p.id}">${esc(p.name)} (stock ${p.stock || 0})</option>`).join('')}</select></label><label>Date<input type="date" id="sD" value="${today()}"></label><label>${kind === 'add' ? 'Quantity to add' : 'Change (+/−)'}<input type="number" id="sQ" step="1"></label><label class="full">Notes<input id="sN"></label></div>`, async () => {
    const q = parseInt(val('sQ')); if (!q || (kind === 'add' && q < 0)) throw new Error('Enter a valid quantity.');
    await db.runTransaction(async t => { const ref = db.collection('products').doc(val('sP')), p = await t.get(ref); t.update(ref, { stock: (p.data().stock || 0) + q }); t.set(db.collection('stockMovements').doc(), { productId: ref.id, productName: p.data().name, qty: q, type: kind === 'add' ? 'stock-in' : 'adjustment', ref: val('sN'), date: val('sD'), at: TS() }); t.set(db.collection('activityLogs').doc(), { action: kind === 'add' ? 'Stock added' : 'Stock adjusted', detail: `${p.data().name} ${q > 0 ? '+' : ''}${q} ${val('sN')}`, at: TS() }); });
    closeModal();
  });
}

/* ---------- ledger ---------- */
let ledgerFor = '', lf = { from: '', to: '' };
function ledgerRows(c) {
  const ev = []; S.invoices.filter(i => i.customerId === c.id).forEach(i => { ev.push({ d: i.date, o: 0, ref: i.number, desc: 'Invoice', dr: i.total, cr: 0 }); (i.payments || []).forEach(p => ev.push({ d: p.date, o: 1, ref: i.number, desc: 'Payment · ' + p.method, dr: 0, cr: p.amount })); });
  ev.sort((a, b) => a.d.localeCompare(b.d) || a.o - b.o);
  let bal = c.opening || 0; if (lf.from) ev.filter(e => e.d < lf.from).forEach(e => bal += e.dr - e.cr);
  const open = R(bal), rows = ev.filter(e => (!lf.from || e.d >= lf.from) && (!lf.to || e.d <= lf.to)).map(e => { bal = R(bal + e.dr - e.cr); return { ...e, bal }; });
  return { open, rows, close: R(bal) };
}
function vLedger() {
  const c = S.customers.find(x => x.id === ledgerFor);
  $('#view').innerHTML = `<div class="bar"><select id="lc" onchange="ledgerFor=this.value;vLedger()"><option value="">Select customer</option>${S.customers.map(x => `<option value="${x.id}" ${x.id === ledgerFor ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
  <input type="date" value="${lf.from}" onchange="lf.from=this.value;vLedger()"><input type="date" value="${lf.to}" onchange="lf.to=this.value;vLedger()">${c ? '<button class="btn primary" onclick="stmtPDF()">Download statement (PDF)</button>' : ''}</div>
  <div class="panel">${c ? (() => { const L = ledgerRows(c); return tbl(['Date', 'Particulars', 'Ref', 'Debit ₹', 'Credit ₹', 'Balance ₹'], [`<tr><td></td><td>Opening balance</td><td></td><td></td><td></td><td class="r">${money(L.open)}</td></tr>`, ...L.rows.map(e => `<tr><td>${fd(e.d)}</td><td>${esc(e.desc)}</td><td>${esc(e.ref)}</td><td class="r">${e.dr ? money(e.dr) : ''}</td><td class="r">${e.cr ? money(e.cr) : ''}</td><td class="r">${money(e.bal)}</td></tr>`), `<tr><td></td><td><b>Closing balance</b></td><td></td><td></td><td></td><td class="r"><b>${money(L.close)}</b></td></tr>`]); })() : '<p class="muted">Choose a customer to see the ledger.</p>'}</div>`;
}
function stmtPDF() {
  const c = S.customers.find(x => x.id === ledgerFor), L = ledgerRows(c), { jsPDF } = window.jspdf, d = new jsPDF();
  d.setFontSize(15).setTextColor(29, 78, 216).text(S.settings.name || 'APEX', 14, 16); d.setFontSize(10).setTextColor(40).text(`Statement of account: ${c.name}`, 14, 24).text(`Period: ${lf.from ? fd(lf.from) : 'start'} to ${lf.to ? fd(lf.to) : fd(today())}`, 14, 30);
  const f = n => R(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  d.autoTable({ startY: 36, head: [['Date', 'Particulars', 'Ref', 'Debit', 'Credit', 'Balance']], body: [['', 'Opening balance', '', '', '', f(L.open)], ...L.rows.map(e => [fd(e.d), e.desc, e.ref, e.dr ? f(e.dr) : '', e.cr ? f(e.cr) : '', f(e.bal)]), ['', 'Closing balance', '', '', '', f(L.close)]], headStyles: { fillColor: [29, 78, 216] }, styles: { fontSize: 8.5 }, columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } } });
  d.save(`Statement_${safe(c.name)}_${today()}.pdf`);
}

/* ---------- reports ---------- */
let rp = { type: 'daily', from: today().slice(0, 8) + '01', to: today() }, repData = null;
const REPS = { daily: 'Daily sales', weekly: 'Weekly sales', monthly: 'Monthly sales', yearly: 'Yearly sales', customer: 'Customer-wise sales', product: 'Product-wise sales', gst: 'GST collection', payment: 'Payment methods', outstanding: 'Outstanding', stock: 'Stock', profit: 'Profit (estimated gross)' };
function groupBy(list, key) { const m = {}; list.forEach(i => (m[key(i)] ||= []).push(i)); return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)); }
function buildReport() {
  const I = S.invoices.filter(i => i.date >= rp.from && i.date <= rp.to), n = x => R(x);
  const sales = (k, lab) => ({ head: [lab, 'Invoices', 'Taxable ₹', 'GST ₹', 'Total ₹'], rows: groupBy(I, k).map(([g, l]) => [g, l.length, sum(l, i => i.taxable), sum(l, i => i.cgst + i.sgst), sum(l, i => i.total)]) });
  switch (rp.type) {
    case 'daily': return sales(i => i.date, 'Date');
    case 'weekly': return sales(i => { const d = new Date(i.date); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return 'Week of ' + d.toISOString().slice(0, 10); }, 'Week');
    case 'monthly': return sales(i => i.date.slice(0, 7), 'Month');
    case 'yearly': return sales(i => fyOf(i.date), 'Financial year');
    case 'customer': return sales(i => i.customerName, 'Customer');
    case 'product': { const m = {}; I.forEach(i => i.items.forEach(x => { const r = m[x.name + ' ' + x.size] ||= [0, 0]; r[0] += x.qty; r[1] += x.amount; })); return { head: ['Product', 'Boxes', 'Amount ₹'], rows: Object.entries(m).map(([k, v]) => [k, v[0], n(v[1])]) }; }
    case 'gst': return { head: ['Invoice', 'Date', 'Customer', 'Taxable ₹', 'CGST ₹', 'SGST ₹', 'Total ₹'], rows: I.sort((a, b) => a.date.localeCompare(b.date)).map(i => [i.number, i.date, i.customerName, i.taxable, i.cgst, i.sgst, i.total]) };
    case 'payment': { const m = {}; I.flatMap(i => i.payments || []).filter(p => p.date >= rp.from && p.date <= rp.to).forEach(p => m[p.method] = n((m[p.method] || 0) + p.amount)); return { head: ['Method', 'Received ₹'], rows: Object.entries(m) }; }
    case 'outstanding': return { head: ['Customer', 'Balance ₹'], rows: S.customers.map(c => [c.name, custBal(c)]).filter(r => Math.abs(r[1]) > .004) };
    case 'stock': return { head: ['Product', 'Size', 'Stock', 'Price ₹'], rows: S.products.map(p => [p.name, p.size, p.stock || 0, p.price]) };
    case 'profit': { const m = {}; I.forEach(i => i.items.forEach(x => { const r = m[x.name + ' ' + x.size] ||= [0, 0, 0]; r[0] += x.qty; r[1] += x.amount; r[2] += x.qty * (x.cost || 0); })); const rows = Object.entries(m).map(([k, v]) => [k, v[0], n(v[1]), n(v[2]), n(v[1] - v[2])]); rows.push(['TOTAL', sum(rows, r => r[1]), sum(rows, r => r[2]), sum(rows, r => r[3]), sum(rows, r => r[4])]); return { head: ['Product', 'Boxes', 'Sales ₹', 'Est. cost ₹', 'Est. gross profit ₹'], rows, note: 'Estimated gross profit = sales (ex-GST) minus manually entered cost prices. It is not accounting profit.' }; }
  }
}
function vReports() {
  repData = buildReport();
  const fmt = v => typeof v === 'number' && !Number.isInteger(v) || /₹/.test('') ? money(v) : esc(v);
  $('#view').innerHTML = `<div class="bar"><select onchange="rp.type=this.value;vReports()">${Object.entries(REPS).map(([k, v]) => `<option value="${k}" ${rp.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select><input type="date" value="${rp.from}" onchange="rp.from=this.value;vReports()"><input type="date" value="${rp.to}" onchange="rp.to=this.value;vReports()"><button class="btn" onclick="repX('pdf')">PDF</button><button class="btn" onclick="repX('xlsx')">Excel</button></div>
  <div class="panel"><h3>${REPS[rp.type]}</h3>${tbl(repData.head, repData.rows.map(r => `<tr>${r.map((v, k) => `<td class="${repData.head[k].includes('₹') || typeof v === 'number' ? 'r' : ''}">${typeof v === 'number' && repData.head[k].includes('₹') ? money(v) : esc(v)}</td>`).join('')}</tr>`), 'No data for this period.')}${repData.note ? `<p class="muted">${repData.note}</p>` : ''}</div>`;
}
function repX(kind) {
  const d = repData, name = `${rp.type}_${rp.from}_${rp.to}`;
  if (kind === 'xlsx') { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([d.head, ...d.rows]), 'Report'); XLSX.writeFile(wb, name + '.xlsx'); }
  else { const doc = new window.jspdf.jsPDF(); doc.setFontSize(13).text(`${REPS[rp.type]} (${fd(rp.from)} to ${fd(rp.to)})`, 14, 15); doc.autoTable({ startY: 20, head: [d.head], body: d.rows, headStyles: { fillColor: [29, 78, 216] }, styles: { fontSize: 8.5 } }); if (d.note) doc.setFontSize(8).text(d.note, 14, doc.lastAutoTable.finalY + 6); doc.save(name + '.pdf'); }
}

/* ---------- activity / settings / backup ---------- */
function vAct() { $('#view').innerHTML = `<div class="panel">${tbl(['When', 'Action', 'Details'], S.logs.map(l => `<tr><td>${tsStr(l.at)}</td><td>${esc(l.action)}</td><td>${esc(l.detail)}</td></tr>`))}</div>`; }
function vSet() {
  const s = S.settings, f = (i, l, v, c = '') => `<label class="${c}">${l}<input id="${i}" value="${esc(v)}"></label>`;
  $('#view').innerHTML = `<div class="panel"><h3>Company details</h3><div class="form">${f('sN', 'Company name', s.name)}${f('sM', 'Mobile number', s.mobile)}${f('sG', 'GSTIN', s.gstin)}${f('sE', 'Email', s.email)}${f('sAd', 'Address', s.address, 'full')}
  <label>Company logo<input type="file" id="sL" accept="image/png,image/jpeg"></label>${f('sLow', 'Low-stock limit (boxes)', s.lowStock ?? 10)}</div>${s.logo ? `<img src="${s.logo}" height="50" alt="logo">` : ''}
  <h3>Bank details</h3><div class="form">${f('sBA', 'Account name', s.bankAccName)}${f('sBN', 'Bank name', s.bankName)}${f('sAN', 'Account number', s.accNo)}${f('sIF', 'IFSC code', s.ifsc)}${f('sBR', 'Branch', s.branch)}</div>
  <div class="foot"><button class="btn primary" onclick="saveSet()">Save settings</button></div></div>
  <div class="panel"><h3>Change password</h3><div class="form"><label>Current password<input type="password" id="pwO"></label><label>New password (min 8 characters)<input type="password" id="pwN"></label></div><div class="foot"><button class="btn" onclick="chPw()">Change password</button></div></div>`;
}
async function saveSet() {
  const d = { name: val('sN'), mobile: val('sM'), gstin: val('sG').toUpperCase(), email: val('sE'), address: val('sAd'), bankAccName: val('sBA'), bankName: val('sBN'), accNo: val('sAN'), ifsc: val('sIF').toUpperCase(), branch: val('sBR'), lowStock: +val('sLow') || 0 };
  const file = $('#sL').files[0];
  if (file) { if (file.size > 300000) return alert('Logo must be under 300 KB.'); d.logo = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); }); }
  await db.collection('companySettings').doc('main').set(d, { merge: true }); log('Company settings changed', d.name); alert('Settings saved.');
}
async function chPw() {
  const n = val('pwN'); if (n.length < 8) return alert('New password needs at least 8 characters.');
  try { const u = auth.currentUser; await u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(u.email, $('#pwO').value)); await u.updatePassword(n); alert('Password changed.'); } catch (e) { alert('Could not change password: check your current password.'); }
}
const COLS = ['products', 'customers', 'invoices', 'stockMovements', 'companySettings', 'invoiceCounters'];
async function snapshotAll() { const o = { app: 'APEX', version: 1, at: new Date().toISOString(), data: {} }; for (const c of COLS) o.data[c] = (await db.collection(c).get()).docs.map(d => ({ id: d.id, ...d.data() })); return JSON.parse(JSON.stringify(o, (k, v) => v && v.toDate ? v.toDate().toISOString() : v)); }
async function cloudBackup(kind) { const o = await snapshotAll(), json = JSON.stringify(o); if (json.length > 950000) throw new Error('Data is too large for a single cloud backup. Use the JSON download.'); await db.collection('backups').doc(`${kind}-${Date.now()}`).set({ kind, date: today(), at: TS(), json }); }
async function autoBackup() { try { const s = await db.collection('backups').where('date', '==', today()).limit(1).get(); if (s.empty && navigator.onLine) await cloudBackup('auto'); } catch (e) {} }
let backups = [];
async function vBackup() {
  $('#view').innerHTML = `<div class="panel"><h3>Backup</h3><div class="bar"><button class="btn primary" onclick="doBackup()">Create cloud backup</button><button class="btn" onclick="dlJSON()">Download JSON</button><button class="btn" onclick="dlXLSX()">Export Excel</button><label class="btn">Restore from JSON file<input type="file" accept=".json" hidden onchange="restoreFile(this.files[0])"></label></div><p class="muted">A cloud backup is taken automatically once a day when the app is opened.</p></div><div class="panel"><h3>Backup history</h3><div id="bh">Loading…</div></div>`;
  const s = await db.collection('backups').orderBy('at', 'desc').limit(30).get(); backups = s.docs.map(d => ({ id: d.id, ...d.data() }));
  if ($('#bh')) $('#bh').innerHTML = tbl(['When', 'Type', ''], backups.map(b => `<tr><td>${tsStr(b.at)}</td><td>${b.kind}</td><td><button class="btn sm" onclick="restoreCloud('${b.id}')">Restore</button></td></tr>`), 'No backups yet.');
}
async function doBackup() { try { await cloudBackup('manual'); vBackup(); } catch (e) { alert(e.message); } }
async function dlJSON() { const o = await snapshotAll(), a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(o, null, 1)], { type: 'application/json' })); a.download = `APEX_backup_${today()}.json`; a.click(); }
function dlXLSX() { const wb = XLSX.utils.book_new(); const add = (n, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), n); add('Products', S.products.map(({ id, createdAt, ...r }) => r)); add('Customers', S.customers.map(c => ({ name: c.name, gstin: c.gstin, address: c.address, opening: c.opening, outstanding: custBal(c) }))); add('Invoices', S.invoices.map(i => ({ number: i.number, date: i.date, customer: i.customerName, taxable: i.taxable, cgst: i.cgst, sgst: i.sgst, total: i.total, paid: paidOf(i), balance: balOf(i) }))); XLSX.writeFile(wb, `APEX_data_${today()}.xlsx`); }
function validBackup(o) { return o && o.app === 'APEX' && o.data && ['products', 'customers', 'invoices'].every(k => Array.isArray(o.data[k])) && o.data.invoices.every(i => i.id && i.number && typeof i.total === 'number' && Array.isArray(i.items)) && o.data.products.every(p => p.id && typeof p.price === 'number'); }
async function restoreObj(o) {
  if (!validBackup(o)) return alert('This file is not a valid APEX backup.');
  if (prompt('Restoring REPLACES all current data. Type RESTORE to confirm.') !== 'RESTORE') return;
  await cloudBackup('pre-restore').catch(() => {});
  let ops = []; for (const c of COLS) { const cur = await db.collection(c).get(); cur.docs.forEach(d => ops.push(b => b.delete(d.ref))); (o.data[c] || []).forEach(({ id, ...r }) => ops.push(b => b.set(db.collection(c).doc(id), r))); }
  for (let k = 0; k < ops.length; k += 400) { const b = db.batch(); ops.slice(k, k + 400).forEach(f => f(b)); await b.commit(); }
  log('Backup restored', o.at); alert('Restore complete.');
}
async function restoreFile(f) { if (!f) return; try { await restoreObj(JSON.parse(await f.text())); } catch (e) { alert('Could not read the backup: ' + e.message); } }
async function restoreCloud(id) { await restoreObj(JSON.parse(backups.find(b => b.id === id).json)); }
