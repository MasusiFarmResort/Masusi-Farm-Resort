/* ============================================================================
   MASUSI FARM RESORT - CONSOLIDATED OPERATIONS
   Version 5.1 Clean Production Build

   This file replaces all previously loaded operations-v*.js patch files.

   IMPORTANT:
   - Source sections are kept in the EXACT SAME EXECUTION ORDER as V5.0.
   - No business logic has been intentionally removed.
   - Later function overrides still execute after earlier implementations,
     exactly as they did when each operations-v*.js file was loaded separately.
   - The goal of V5.1 is deployment/maintenance cleanup, not a feature rewrite.
   ============================================================================
*/


/* ========================================================================
   CONSOLIDATED SOURCE: operations-v2.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */

/* Masusi Farm Resort Operations V2
   Per-pax barcode access, cottage accounts, unified payments, services + POS inventory.
*/

state.cache.pax = state.cache.pax || [];
state.cache.services = state.cache.services || [];
state.cache.stockMovements = state.cache.stockMovements || [];
state.cache.charges = state.cache.charges || [];
state.activeScanPax = null;
state.activePosBooking = null;
state.activePosPax = null;

const originalPreload = preload;
preload = async function(){
  await originalPreload();
  await Promise.all([
    getTable('booking_pax','pax'),
    getTable('service_library','services'),
    getTable('stock_movements','stockMovements'),
    getTable('charges','charges')
  ]);
};

const originalRenderCurrent = renderCurrent;
renderCurrent = async function(){
  if(state.currentView === 'pos') return renderPOS();
  if(state.currentView === 'services') return renderServices();
  return originalRenderCurrent();
};

const originalNavigate = navigate;
navigate = function(view){
  originalNavigate(view);
  if(view==='pos') { $('#pageTitle').textContent='Store / POS'; renderPOS(); }
  if(view==='services') { $('#pageTitle').textContent='Services Library'; renderServices(); }
};

function uniqueCode(prefix='MFR-PAX'){
  const rand = Math.random().toString(36).slice(2,8).toUpperCase();
  return `${prefix}-${rand}`;
}
function bookingPax(bookingId){ return (state.cache.pax||[]).filter(p=>p.booking_id===bookingId && p.access_status!=='cancelled').sort((a,b)=>(a.pax_no||0)-(b.pax_no||0)); }
function activeBookingForPax(p){ return state.cache.bookings.find(b=>b.id===p.booking_id); }
function cottageById(id){ return state.cache.cottages.find(c=>c.id===id); }
function roomById(id){ return state.cache.rooms.find(c=>c.id===id); }
function bookingCharges(id){ return (state.cache.charges||[]).filter(x=>x.booking_id===id && x.is_void!==true); }
function bookingPayments(id){ return (state.cache.payments||[]).filter(x=>x.booking_id===id && x.is_void!==true); }
function bookingAccountTotals(b){
  const charges=bookingCharges(b.id).reduce((s,x)=>s+Number(x.amount||0)-Number(x.discount_amount||0),0);
  const payments=bookingPayments(b.id).reduce((s,x)=>s+Number(x.amount||0),0);
  const total=Number(b.base_amount??b.total_amount??0)+charges;
  return {base:Number(b.base_amount??b.total_amount??0),charges,payments,total,balance:Math.max(0,total-payments)};
}

async function refreshOperations(){
  await Promise.all([getTable('booking_pax','pax'),getTable('charges','charges'),getTable('payments'),getTable('inventory_items','inventory'),getTable('stock_movements','stockMovements'),getTable('service_library','services'),getTable('bookings')]);
}

// ---------- Smart barcode / QR scan ----------
const oldScanBarcode = scanBarcode;
scanBarcode = async function(){
  const code=$('#barcodeInput').value.trim(); if(!code)return;
  await refreshOperations();
  const pax=(state.cache.pax||[]).find(p=>p.code===code && p.access_status!=='cancelled');
  if(pax){ state.activeScanPax=pax; return handlePaxScan(pax); }
  const booking=state.cache.bookings.find(b=>b.booking_number===code || b.barcode===code);
  if(booking) return openBookingScanResult(booking);
  const {data:bc}=await sb.from('barcodes').select('*').eq('code',code).eq('is_active',true).maybeSingle();
  if(bc?.booking_id){ const b=state.cache.bookings.find(x=>x.id===bc.booking_id); if(b)return openBookingScanResult(b); }
  $('#barcodeResult').innerHTML=`<div class="empty-state"><strong>Code not found</strong><p>${esc(code)}</p><small>Scan a pax code, booking QR/barcode, or enter the booking code manually.</small></div>`;
};
$('#barcodeSearchBtn').onclick=scanBarcode;
$('#barcodeInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();scanBarcode()}};

function paxDisplayName(p){ return p.display_name || `${(p.pax_type||'Pax').toUpperCase()} ${String(p.pax_no||'').padStart(2,'0')}`; }

async function handlePaxScan(p){
  const b=activeBookingForPax(p); if(!b) return toast('Booking for this pax was not found.','error');
  const assigned = p.assigned_cottage_id ? cottageById(p.assigned_cottage_id) : null;
  if(!p.assigned_cottage_id && p.access_status==='not_checked_in') return openFirstEntryModal(p,b);
  const unit=assigned || (b.cottage_id?cottageById(b.cottage_id):null);
  const status=p.access_status||'not_checked_in';
  $('#barcodeResult').innerHTML=`<div class="report-kpis">
    <div class="report-kpi"><span>Pax</span><strong>${esc(paxDisplayName(p))}</strong></div>
    <div class="report-kpi"><span>Cottage</span><strong>${esc(unit?.name||unit?.unit_number||'—')}</strong></div>
    <div class="report-kpi"><span>Status</span><strong>${esc(status)}</strong></div>
    <div class="report-kpi"><span>Booking</span><strong>${esc(b.booking_number)}</strong></div>
  </div><div class="panel"><p>${esc(b.guest_name||'Guest')} · ${esc(p.pax_type||'pax')}</p>
  <div class="row-actions"><button class="btn btn-primary" id="paxAccountBtn">Cottage Account</button>${status==='inside'?'<button class="btn btn-soft" id="paxOutBtn">Mark OUT</button><button class="btn btn-soft" id="paxPurchaseBtn">Add Purchase</button>':''}${status==='outside'?'<button class="btn btn-primary" id="paxReturnBtn">Mark RETURNED</button>':''}</div></div>`;
  $('#paxAccountBtn').onclick=()=>openCottageAccount(b.id,p.id);
  if($('#paxOutBtn')) $('#paxOutBtn').onclick=()=>accessAction(p,'exit');
  if($('#paxReturnBtn')) $('#paxReturnBtn').onclick=()=>accessAction(p,'return');
  if($('#paxPurchaseBtn')) $('#paxPurchaseBtn').onclick=()=>openPOSForPax(p,b);
  $('#barcodeInput').select();
}

function openFirstEntryModal(p,b){
  const options=state.cache.cottages.filter(c=>c.is_active!==false && !['maintenance','damaged','inactive'].includes(c.status)).map(c=>`<option value="${c.id}" ${b.cottage_id===c.id?'selected':''}>${esc(c.name||c.unit_number)} · Capacity ${c.capacity||'—'}</option>`).join('');
  openModal({title:'Assign Cottage & Check In',eyebrow:'FIRST PAX SCAN',body:`<div class="panel"><strong>${esc(paxDisplayName(p))}</strong><p class="muted">${esc(b.booking_number)} · ${esc(b.guest_name||'Guest')}</p></div><form id="firstEntryForm" class="modal-form"><label class="full">Select Cottage<select name="cottage_id" required><option value="">Select cottage...</option>${options}</select></label></form>`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="confirmFirstEntry">Assign & Check In</button>`});
  $('[data-modal-cancel]').onclick=closeModal;
  $('#confirmFirstEntry').onclick=async()=>{
    const cottage_id=new FormData($('#firstEntryForm')).get('cottage_id'); if(!cottage_id)return toast('Select a cottage.','error');
    const now=new Date().toISOString();
    const {error}=await sb.from('booking_pax').update({assigned_cottage_id:cottage_id,access_status:'inside',first_check_in_at:now,last_return_at:now}).eq('id',p.id);
    if(error)return toast(error.message,'error');
    await sb.from('access_logs').insert({booking_id:b.id,pax_id:p.id,cottage_id,action:'check_in',scanned_code:p.code,performed_by:state.session.user.id});
    // Keep booking's primary cottage aligned with the first assigned pax if not set.
    if(!b.cottage_id) await sb.from('bookings').update({cottage_id,status:'checked_in'}).eq('id',b.id);
    else if(b.status!=='checked_in') await sb.from('bookings').update({status:'checked_in'}).eq('id',b.id);
    closeModal(); await refreshOperations(); toast(`${paxDisplayName(p)} checked in.`); const np=state.cache.pax.find(x=>x.id===p.id); handlePaxScan(np);
  };
}

async function accessAction(p,action){
  const b=activeBookingForPax(p), isExit=action==='exit';
  confirmModal(isExit?'Mark guest OUT':'Mark guest RETURNED',isExit?`${paxDisplayName(p)} will be marked outside the resort. Their cottage assignment remains active.`:`${paxDisplayName(p)} will be marked back inside the resort.`,async()=>{
    const now=new Date().toISOString(); const payload=isExit?{access_status:'outside',last_exit_at:now}:{access_status:'inside',last_return_at:now};
    const {error}=await sb.from('booking_pax').update(payload).eq('id',p.id); if(error)return toast(error.message,'error');
    await sb.from('access_logs').insert({booking_id:b.id,pax_id:p.id,cottage_id:p.assigned_cottage_id,action:isExit?'exit':'return',scanned_code:p.code,performed_by:state.session.user.id});
    closeModal(); await refreshOperations(); toast(isExit?'Guest marked OUT.':'Guest marked RETURNED.'); handlePaxScan(state.cache.pax.find(x=>x.id===p.id));
  });
}

function openBookingScanResult(b){
  const pax=bookingPax(b.id), inside=pax.filter(x=>x.access_status==='inside').length, outside=pax.filter(x=>x.access_status==='outside').length, a=bookingAccountTotals(b);
  $('#barcodeResult').innerHTML=`<div class="report-kpis"><div class="report-kpi"><span>Booking</span><strong>${esc(b.booking_number)}</strong></div><div class="report-kpi"><span>Pax</span><strong>${pax.length}</strong></div><div class="report-kpi"><span>Inside / Outside</span><strong>${inside} / ${outside}</strong></div><div class="report-kpi"><span>Balance</span><strong>${money(a.balance)}</strong></div></div><div class="panel"><strong>${esc(b.guest_name||'Guest')}</strong><p class="muted">${esc(b.status||'')}</p><div class="row-actions"><button class="btn btn-primary" id="bookingPayBtn">Add Payment</button><button class="btn btn-soft" id="bookingAccountBtn">View Account</button><button class="btn btn-soft" id="bookingCodesBtn">Print Codes</button></div></div>`;
  $('#bookingPayBtn').onclick=()=>openPaymentModal(b);
  $('#bookingAccountBtn').onclick=()=>openCottageAccount(b.id);
  $('#bookingCodesBtn').onclick=()=>openCodesModal(b);
  $('#barcodeInput').select();
}

function openCodesModal(b){
  const pax=bookingPax(b.id);
  openModal({title:'Booking & Pax Codes',eyebrow:'BARCODE / QR',wide:true,body:`<div class="panel"><h3>Booking Code</h3><p><strong>${esc(b.booking_number)}</strong></p><div id="bookingQr"></div><svg id="bookingBarcode"></svg></div><div class="table-panel" style="margin-top:14px"><div class="table-scroll"><table class="data-table"><thead><tr><th>Pax</th><th>Type</th><th>Code</th><th>Status</th></tr></thead><tbody>${autoSortRows('pax',pax).map((p,i)=>`<tr><td><strong>${i+1}</strong></td><td>${esc(paxDisplayName(p))}</td><td>${esc(p.pax_type)}</td><td>${esc(p.code)}</td><td>${esc(p.access_status)}</td></tr>`).join('')}</tbody></table></div></div>`,footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-primary" id="printCodesBtn">Print</button>`});
  $('[data-modal-cancel]').onclick=closeModal;
  try{new QRCode($('#bookingQr'),{text:b.booking_number,width:120,height:120});JsBarcode('#bookingBarcode',b.booking_number,{format:'CODE128',displayValue:true,height:55});}catch{}
  $('#printCodesBtn').onclick=()=>window.print();
}

// ---------- Cottage running account ----------
async function openCottageAccount(bookingId,paxId=null){
  await refreshOperations();
  const b=state.cache.bookings.find(x=>x.id===bookingId); if(!b)return;
  const pax=bookingPax(b.id), charges=bookingCharges(b.id), payments=bookingPayments(b.id), totals=bookingAccountTotals(b);
  const assignedCottageId=(paxId?state.cache.pax.find(x=>x.id===paxId)?.assigned_cottage_id:null)||b.cottage_id;
  const cottage=cottageById(assignedCottageId);
  openModal({title:cottage?.name||cottage?.unit_number||'Booking Account',eyebrow:`COTTAGE RUNNING ACCOUNT · ${b.booking_number}`,wide:true,body:`
    <div class="report-kpis"><div class="report-kpi"><span>Total Pax</span><strong>${pax.length}</strong></div><div class="report-kpi"><span>Inside</span><strong>${pax.filter(x=>x.access_status==='inside').length}</strong></div><div class="report-kpi"><span>Total Bill</span><strong>${money(totals.total)}</strong></div><div class="report-kpi"><span>Balance</span><strong>${money(totals.balance)}</strong></div></div>
    <div class="panel"><div class="panel-head"><h3>Guest Access</h3></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Pax</th><th>Type</th><th>Status</th><th>Cottage</th><th>Code</th></tr></thead><tbody>${autoSortRows('pax',pax).map((p,i)=>`<tr><td><strong>${i+1}</strong></td><td>${esc(paxDisplayName(p))}</td><td>${esc(p.pax_type)}</td><td><span class="badge">${esc(p.access_status)}</span></td><td>${esc(cottageById(p.assigned_cottage_id)?.name||'—')}</td><td>${esc(p.code)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="dashboard-grid" style="margin-top:14px"><div class="panel"><div class="panel-head"><h3>Charges</h3></div>${charges.length?charges.map(x=>`<div class="list-item"><div><strong>${esc(x.description||x.charge_type)}</strong><small>${fmtDate(x.charge_date)} · ${x.quantity||1} × ${money(x.unit_price||0)}</small></div><strong>${money(Number(x.amount||0)-Number(x.discount_amount||0))}</strong></div>`).join(''):'<div class="empty-state">No additional charges.</div>'}</div><div class="panel"><div class="panel-head"><h3>Payments</h3></div>${payments.length?payments.map(x=>`<div class="list-item"><div><strong>${esc(x.method||'Payment')}</strong><small>${fmtDate(x.payment_date)} · ${esc(x.reference_number||'')}</small></div><strong>${money(x.amount)}</strong></div>`).join(''):'<div class="empty-state">No payments yet.</div>'}</div></div>`,footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-soft" id="accountAddCharge">Add Charge</button><button class="btn btn-soft" id="accountPOS">Store / POS</button><button class="btn btn-primary" id="accountPayment">Add Payment</button>`});
  $('[data-modal-cancel]').onclick=closeModal;
  $('#accountAddCharge').onclick=()=>openServiceChargeModal(b);
  $('#accountPOS').onclick=()=>{closeModal(); state.activePosBooking=b; renderPOS(); navigate('pos');};
  $('#accountPayment').onclick=()=>openPaymentModal(b);
}

function openPaymentModal(b){
  const totals=bookingAccountTotals(b);
  openModal({title:'Add Payment',eyebrow:`${b.booking_number} · ${b.guest_name||'Guest'}`,body:`<div class="report-kpis"><div class="report-kpi"><span>Total</span><strong>${money(totals.total)}</strong></div><div class="report-kpi"><span>Paid</span><strong>${money(totals.payments)}</strong></div><div class="report-kpi"><span>Balance</span><strong>${money(totals.balance)}</strong></div></div><form id="paymentForm" class="modal-form"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" max="${totals.balance||999999}" required></label><label>Method<select name="method"><option>Cash</option><option>GCash</option><option>Maya</option><option>Bank Transfer</option><option>Card</option><option>Other</option></select></label><label>Reference Number<input name="reference_number"></label><label class="full">Notes<textarea name="notes" rows="2"></textarea></label></form>`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="savePaymentBtn">Save Payment</button>`});
  $('[data-modal-cancel]').onclick=closeModal;
  $('#savePaymentBtn').onclick=async()=>{
    const fd=new FormData($('#paymentForm')), amount=Number(fd.get('amount')||0); if(amount<=0)return toast('Enter a valid payment amount.','error');
    const {error}=await sb.from('payments').insert({booking_id:b.id,payment_date:today(),amount,method:fd.get('method'),reference_number:fd.get('reference_number')||null,notes:fd.get('notes')||null,created_by:state.session.user.id});
    if(error)return toast(error.message,'error');
    closeModal(); await refreshOperations(); toast('Payment saved. Booking, Payments, Reports and balance are now updated.');
    if(state.currentView==='payments') renderModule('payments');
  };
}

function openServiceChargeModal(b){
  const services=(state.cache.services||[]).filter(x=>x.is_active!==false);
  openModal({title:'Add Service / Extra Charge',eyebrow:b.booking_number,body:`<form id="serviceChargeForm" class="modal-form"><label class="full">Service<select name="service_id"><option value="">Custom charge</option>${services.map(s=>`<option value="${s.id}" data-price="${s.price}">${esc(s.name)} · ${money(s.price)}</option>`).join('')}</select></label><label>Description<input name="description" required></label><label>Quantity<input name="quantity" type="number" min="1" step="1" value="1"></label><label>Unit Price<input name="unit_price" type="number" min="0" step="0.01" value="0"></label><label>Discount<input name="discount_amount" type="number" min="0" step="0.01" value="0"></label></form>`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="saveServiceCharge">Add to Cottage Bill</button>`});
  $('[data-modal-cancel]').onclick=closeModal;
  const sel=$('#serviceChargeForm [name=service_id]'); sel.onchange=()=>{const s=services.find(x=>x.id===sel.value);if(s){$('#serviceChargeForm [name=description]').value=s.name;$('#serviceChargeForm [name=unit_price]').value=s.price;}};
  $('#saveServiceCharge').onclick=async()=>{
    const fd=new FormData($('#serviceChargeForm')), q=Number(fd.get('quantity')||1), price=Number(fd.get('unit_price')||0), discount=Number(fd.get('discount_amount')||0);
    const {error}=await sb.from('charges').insert({booking_id:b.id,charge_date:today(),charge_type:'service',service_id:fd.get('service_id')||null,description:fd.get('description'),quantity:q,unit_price:price,amount:q*price,discount_amount:discount,created_by:state.session.user.id});
    if(error)return toast(error.message,'error'); closeModal(); await refreshOperations(); toast('Service added to cottage bill.'); openCottageAccount(b.id);
  };
}

// ---------- Store / POS ----------
function openPOSForPax(p,b){ state.activePosPax=p; state.activePosBooking=b; closeModal(); navigate('pos'); }
function renderPOS(){
  const root=$('#view-pos'); if(!root)return;
  const b=state.activePosBooking, p=state.activePosPax;
  const items=(state.cache.inventory||[]).filter(x=>x.is_active!==false && x.condition!=='retired');
  root.innerHTML=`<div class="section-head"><div><p class="eyebrow">COTTAGE STORE CHARGES</p><h2>Store / POS</h2></div></div>
  <div class="dashboard-grid"><article class="panel"><div class="panel-head"><h3>Client / Cottage</h3></div>${b?`<strong>${esc(b.guest_name||'Guest')}</strong><p>${esc(b.booking_number)}</p><p class="muted">${p?esc(paxDisplayName(p))+' · ':''}${esc(cottageById(p?.assigned_cottage_id||b.cottage_id)?.name||'No cottage')}</p><button class="btn btn-soft" id="clearPOSContext">Clear</button>`:`<div class="empty-state">Scan a pax barcode first, or enter a booking code in Barcode Scanner, then choose Store / POS.</div>`}</article>
  <article class="panel"><div class="panel-head"><h3>Available Store Items</h3></div><input id="posSearch" type="search" class="barcode-input" placeholder="Search water, ice, drinks, food..."><div id="posItems" class="list-stack"></div></article></div>`;
  const draw=()=>{const q=($('#posSearch')?.value||'').toLowerCase();$('#posItems').innerHTML=items.filter(i=>`${i.name} ${i.category||''} ${i.sku||''}`.toLowerCase().includes(q)).map(i=>`<div class="list-item"><div><strong>${esc(i.name)}</strong><small>${esc(i.category||'Store')} · Stock ${Number(i.quantity||0)} · ${money(i.selling_price||i.cost||0)}</small></div><button class="btn btn-primary" data-pos-item="${i.id}" ${Number(i.quantity||0)<=0?'disabled':''}>Add</button></div>`).join('')||'<div class="empty-state">No inventory items found.</div>';$$('[data-pos-item]').forEach(btn=>btn.onclick=()=>addPOSItem(btn.dataset.posItem));};
  $('#posSearch')?.addEventListener('input',draw); draw(); if($('#clearPOSContext'))$('#clearPOSContext').onclick=()=>{state.activePosBooking=null;state.activePosPax=null;renderPOS();};
}
function addPOSItem(itemId){
  if(!state.activePosBooking)return toast('Scan/select a client booking first.','error');
  const item=state.cache.inventory.find(x=>x.id===itemId); if(!item)return;
  openModal({title:`Add ${item.name}`,eyebrow:`CHARGE TO ${state.activePosBooking.booking_number}`,body:`<form id="posQtyForm" class="modal-form"><label>Quantity<input name="quantity" type="number" min="1" max="${Number(item.quantity||0)}" value="1"></label><label>Unit Price<input name="unit_price" type="number" min="0" step="0.01" value="${Number(item.selling_price||item.cost||0)}"></label><label class="full">Notes<textarea name="notes"></textarea></label></form>`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="confirmPOSItem">Add to Cottage Bill</button>`});
  $('[data-modal-cancel]').onclick=closeModal;
  $('#confirmPOSItem').onclick=async()=>{
    const fd=new FormData($('#posQtyForm')), qty=Number(fd.get('quantity')||0), price=Number(fd.get('unit_price')||0); if(qty<=0||qty>Number(item.quantity||0))return toast('Invalid quantity.','error');
    const {error}=await sb.rpc('post_inventory_sale',{p_booking_id:state.activePosBooking.id,p_pax_id:state.activePosPax?.id||null,p_item_id:item.id,p_quantity:qty,p_unit_price:price,p_notes:fd.get('notes')||null});
    if(error)return toast(error.message,'error'); closeModal(); await refreshOperations(); toast(`${item.name} added to cottage bill and inventory deducted.`); renderPOS();
  };
}

// ---------- Services library ----------
function renderServices(){
  const root=$('#view-services'); if(!root)return; const rows=state.cache.services||[];
  root.innerHTML=`<div class="section-head"><div><p class="eyebrow">REUSABLE SERVICE LIBRARY</p><h2>Services Library</h2></div><button class="btn btn-primary" id="addServiceBtn">Add Service</button></div><div class="table-panel"><div class="table-toolbar"><input id="serviceSearch" class="grow" type="search" placeholder="Search services..."></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Service</th><th>Category</th><th>Price</th><th>Active</th><th>Actions</th></tr></thead><tbody id="serviceRows"></tbody></table></div></div>`;
  const draw=()=>{const q=$('#serviceSearch').value.toLowerCase();$('#serviceRows').innerHTML=rows.filter(s=>`${s.name} ${s.category||''}`.toLowerCase().includes(q)).map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.category||'—')}</td><td>${money(s.price)}</td><td>${s.is_active?'Yes':'No'}</td><td><div class="row-actions"><button data-edit-service="${s.id}">Edit</button><button data-archive-service="${s.id}">Archive</button></div></td></tr>`).join('')||'<tr><td colspan="5" class="empty-state">No services yet.</td></tr>';$$('[data-edit-service]').forEach(b=>b.onclick=()=>serviceModal(rows.find(x=>x.id===b.dataset.editService)));$$('[data-archive-service]').forEach(b=>b.onclick=()=>archiveService(b.dataset.archiveService));};
  $('#serviceSearch').oninput=draw; $('#addServiceBtn').onclick=()=>serviceModal(null); draw();
}
function serviceModal(rec){
  openModal({title:rec?'Edit Service':'Add Service',eyebrow:'SERVICES LIBRARY',body:`<form id="serviceForm" class="modal-form"><label>Service Name<input name="name" value="${esc(rec?.name||'')}" required></label><label>Category<input name="category" value="${esc(rec?.category||'')}"></label><label>Price<input name="price" type="number" min="0" step="0.01" value="${Number(rec?.price||0)}"></label><label>Active<select name="is_active"><option value="true" ${rec?.is_active!==false?'selected':''}>Yes</option><option value="false" ${rec?.is_active===false?'selected':''}>No</option></select></label><label class="full">Description<textarea name="description">${esc(rec?.description||'')}</textarea></label></form>`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="saveServiceBtn">Save</button>`});
  $('[data-modal-cancel]').onclick=closeModal; $('#saveServiceBtn').onclick=async()=>{const fd=new FormData($('#serviceForm')),payload={name:fd.get('name'),category:fd.get('category')||null,price:Number(fd.get('price')||0),is_active:fd.get('is_active')==='true',description:fd.get('description')||null};const q=rec?sb.from('service_library').update(payload).eq('id',rec.id):sb.from('service_library').insert(payload);const {error}=await q;if(error)return toast(error.message,'error');closeModal();await getTable('service_library','services');toast('Service saved.');renderServices();};
}
function archiveService(id){confirmModal('Archive Service','This service will no longer appear when adding new cottage charges.',async()=>{const {error}=await sb.from('service_library').update({is_active:false}).eq('id',id);if(error)return toast(error.message,'error');closeModal();await getTable('service_library','services');renderServices();toast('Service archived.');},true)}

// ---------- Enhance live cottage details with pax count and account ----------
const oldOpenUnitDetail=openUnitDetail;
openUnitDetail=async function(type,id,date){
  if(type!=='cottage') return oldOpenUnitDetail(type,id,date);
  await refreshOperations();
  const b=bookingForUnit(type,id,date); if(!b)return oldOpenUnitDetail(type,id,date);
  return openCottageAccount(b.id);
};

// ---------- Inventory module enhancement ----------
const oldModuleConfig=moduleConfig;
moduleConfig=function(name){
  if(name==='inventory') return {table:'inventory_items',title:'Inventory',date:'created_at',fields:[['item_code','Item Code','text'],['sku','SKU / Barcode','text'],['name','Item Name','text'],['category','Category','text'],['quantity','Stock Qty','number'],['unit','Unit','text'],['cost','Cost Price','number'],['selling_price','Selling Price','number'],['reorder_level','Reorder Level','number'],['location','Location','text'],['condition','Condition','select:good|damaged|repair|retired'],['notes','Notes','textarea'],['is_active','Active','boolean']]};
  return oldModuleConfig(name);
};

// More informative barcode intro.
const scannerPanel=$('.scanner-panel .muted');
if(scannerPanel) scannerPanel.textContent='Scan a pax barcode/QR for cottage assignment, exit/return tracking and POS. Scan a booking barcode/QR/code for payments, check-in and the complete cottage account.';

// Realtime operations tables.
if(sb){
  sb.channel('operations-v2-live')
    .on('postgres_changes',{event:'*',schema:'public',table:'booking_pax'},async()=>{await getTable('booking_pax','pax');if(['barcode','live'].includes(state.currentView))renderCurrent()})
    .on('postgres_changes',{event:'*',schema:'public',table:'charges'},async()=>{await getTable('charges','charges')})
    .on('postgres_changes',{event:'*',schema:'public',table:'payments'},async()=>{await getTable('payments')})
    .on('postgres_changes',{event:'*',schema:'public',table:'inventory_items'},async()=>{await getTable('inventory_items','inventory');if(state.currentView==='pos')renderPOS()})
    .subscribe();
}

// ---------- Booking module V2: base amount + payment/account controls ----------
const operationsModuleConfig = moduleConfig;
moduleConfig=function(name){
  if(name==='bookings') return {table:'bookings',title:'Bookings',date:'check_in_date',fields:[
    ['booking_number','Booking No.','text'],['guest_name','Guest Name','text'],['contact_number','Contact','text'],['booking_category_id','Category','category'],
    ['check_in_date','Check-in','date'],['check_out_date','Check-out','date'],['room_id','Room','room'],['cottage_id','Default Cottage','cottage'],
    ['adults','Adults','number'],['kids','Kids','number'],['babies','Babies','number'],['seniors','Senior','number'],['pwd','PWD','number'],
    ['status','Status','select:pending|confirmed|checked_in|checked_out|cancelled|no_show'],
    ['base_amount','Base Booking Amount','number'],['notes','Notes','textarea']
  ]};
  return operationsModuleConfig(name);
};

const originalOpenRecordV2 = openRecord;
openRecord = async function(name,id,edit=false){
  if(name!=='bookings' || edit || !id) return originalOpenRecordV2(name,id,edit);
  await refreshOperations();
  const b=state.cache.bookings.find(x=>x.id===id); if(!b)return originalOpenRecordV2(name,id,edit);
  const pax=bookingPax(b.id), totals=bookingAccountTotals(b), unit=b.cottage_id?cottageById(b.cottage_id):roomById(b.room_id);
  openModal({title:b.guest_name||'Booking',eyebrow:`BOOKING ${b.booking_number}`,wide:true,body:`
    <div class="report-kpis"><div class="report-kpi"><span>Status</span><strong>${esc(b.status)}</strong></div><div class="report-kpi"><span>Pax</span><strong>${pax.length}</strong></div><div class="report-kpi"><span>Total Paid</span><strong>${money(totals.payments)}</strong></div><div class="report-kpi"><span>Balance</span><strong>${money(totals.balance)}</strong></div></div>
    <div class="panel"><strong>${esc(unit?.name||unit?.unit_number||'No default unit')}</strong><p>${fmtDate(b.check_in_date)} to ${fmtDate(b.check_out_date)}</p><p>Adults ${b.adults||0} · Kids ${b.kids||0} · Babies ${b.babies||0} · Senior ${b.seniors||0} · PWD ${b.pwd||0}</p><p><strong>Base:</strong> ${money(totals.base)} · <strong>Extra Charges:</strong> ${money(totals.charges)} · <strong>Total:</strong> ${money(totals.total)}</p></div>
    <div class="panel" style="margin-top:14px"><div class="panel-head"><h3>Pax Codes / Access</h3></div><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Pax</th><th>Type</th><th>Code</th><th>Status</th><th>Cottage</th></tr></thead><tbody>${autoSortRows('pax',pax).map((p,i)=>`<tr><td><strong>${i+1}</strong></td><td>${esc(paxDisplayName(p))}</td><td>${esc(p.pax_type)}</td><td>${esc(p.code)}</td><td><span class="badge">${esc(p.access_status)}</span></td><td>${esc(cottageById(p.assigned_cottage_id)?.name||'—')}</td></tr>`).join('')}</tbody></table></div></div>
  `,footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-soft" id="editBookingV2">Edit</button><button class="btn btn-soft" id="codesBookingV2">Codes</button><button class="btn btn-soft" id="accountBookingV2">Account</button><button class="btn btn-primary" id="payBookingV2">Add Payment</button>`});
  $('[data-modal-cancel]').onclick=closeModal;
  $('#editBookingV2').onclick=()=>originalOpenRecordV2('bookings',id,true);
  $('#codesBookingV2').onclick=()=>openCodesModal(b);
  $('#accountBookingV2').onclick=()=>openCottageAccount(b.id);
  $('#payBookingV2').onclick=()=>openPaymentModal(b);
};

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v21.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */

/* Masusi Farm Resort V2.1
   Separate Cottage + Swimming and Room booking workflows.
   Booking numbers/codes are generated by Supabase.
*/

const v21RenderCurrent = renderCurrent;
renderCurrent = async function(){
  if(state.currentView==='cottage-bookings') return renderBookingTypePage('cottage_swim');
  if(state.currentView==='room-bookings') return renderBookingTypePage('room');
  return v21RenderCurrent();
};

const v21Navigate = navigate;
navigate = function(view){
  state.currentView=view;
  $$('.view').forEach(v=>v.classList.remove('active'));
  $(`#view-${view}`)?.classList.add('active');
  $$('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('#sidebar').classList.remove('open');
  const titles={
    dashboard:'Dashboard',live:'Live Rooms & Cottages',bookings:'All Bookings',
    'cottage-bookings':'Cottage + Swimming Bookings','room-bookings':'Room Bookings',
    availability:'Availability Calendar',rooms:'Rooms',cottages:'Cottages',guests:'Guests',barcode:'Barcode Scanner',billing:'Billing',payments:'Payments',invoices:'Invoices',expenses:'Expenses',damages:'Damages',repairs:'Repairs',inventory:'Inventory',pos:'Store / POS',services:'Services Library',reports:'Reports',users:'Users',audit:'Audit Logs',settings:'Settings'
  };
  $('#pageTitle').textContent=titles[view]||'Masusi Farm Resort';
  renderCurrent();
};

function v21Settings(){
  return {
    adult:Number(state.settings.adult_swim_rate||0),
    kid:Number(state.settings.kid_swim_rate||0),
    senior:Number(state.settings.senior_discount||0),
    pwd:Number(state.settings.pwd_discount||0)
  };
}
function calcCottageBooking({cottage_id,adults=0,kids=0,babies=0,seniors=0,pwd=0}){
  const c=state.cache.cottages.find(x=>x.id===cottage_id); const s=v21Settings();
  adults=Number(adults||0);kids=Number(kids||0);babies=Number(babies||0);seniors=Number(seniors||0);pwd=Number(pwd||0);
  const sr=Math.min(seniors,adults), pw=Math.min(pwd,Math.max(adults-sr,0)), regular=Math.max(adults-sr-pw,0);
  const cottage=Number(c?.base_rate||0);
  const swim=(regular*s.adult)+(sr*s.adult*(1-s.senior/100))+(pw*s.adult*(1-s.pwd/100))+(kids*s.kid);
  return {cottage,swim,total:cottage+swim,regular,sr,pw,babies};
}
function calcRoomBooking({room_id,check_in_date,check_out_date,adults=0,kids=0}){
  const r=state.cache.rooms.find(x=>x.id===room_id);
  let nights=1;
  if(check_in_date&&check_out_date){
    const a=new Date(check_in_date+'T00:00:00'),b=new Date(check_out_date+'T00:00:00');
    nights=Math.max(1,Math.round((b-a)/86400000));
  }
  const chargeable=Number(adults||0)+Number(kids||0), extra=Math.max(0,chargeable-Number(r?.capacity||0));
  const room=Number(r?.base_rate||0)*nights, extraFee=Number(r?.extra_person_rate||0)*extra*nights;
  return {nights,room,extra,extraFee,total:room+extraFee};
}

async function renderBookingTypePage(type){
  await getTable('bookings');
  const isCottage=type==='cottage_swim';
  const rows=state.cache.bookings.filter(b=>(b.booking_type||((b.room_id)?'room':'cottage_swim'))===type);
  const id=isCottage?'cottage-bookings':'room-bookings';
  const title=isCottage?'Cottage + Swimming Bookings':'Room Bookings';
  $(`#view-${id}`).innerHTML=`
    <div class="section-head"><div><p class="eyebrow">${isCottage?'DAY USE / SWIMMING':'OVERNIGHT / ROOM'}</p><h2>${title}</h2></div></div>
    <div class="table-panel">
      <div class="table-toolbar">
        <input id="${id}Search" class="grow" type="search" placeholder="Search guest, booking no. or booking code...">
        <input id="${id}Month" type="month" value="${currentMonth()}">
        <select id="${id}Status"><option value="">All status</option><option>pending</option><option>confirmed</option><option>checked_in</option><option>checked_out</option><option>cancelled</option><option>no_show</option></select>
        <button class="btn btn-soft" id="${id}Print">Print Month</button>
        <button class="btn btn-primary" id="${id}Add">Add ${isCottage?'Cottage + Swimming':'Room'} Booking</button>
      </div>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>Booking No.</th><th>Guest</th><th>${isCottage?'Cottage':'Room'}</th><th>Check-in</th><th>Pax</th><th>Base</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody id="${id}Body"></tbody></table></div>
    </div>`;
  const draw=()=>{
    const q=$(`#${id}Search`).value.toLowerCase().trim(),m=$(`#${id}Month`).value,st=$(`#${id}Status`).value;
    const filtered=rows.filter(b=>{
      const hay=`${b.booking_number||''} ${b.booking_code||b.barcode||''} ${b.guest_name||''} ${b.contact_number||''}`.toLowerCase();
      return hay.includes(q)&&(!m||String(b.check_in_date||b.booking_date||'').slice(0,7)===m)&&(!st||b.status===st);
    });
    $(`#${id}Body`).innerHTML=filtered.length?filtered.map(b=>{
      const unit=isCottage?cottageById(b.cottage_id):roomById(b.room_id), pax=Number(b.adults||0)+Number(b.kids||0)+Number(b.babies||0);
      return `<tr><td><strong>${esc(b.booking_number||'Auto')}</strong><br><small>${esc(b.booking_code||b.barcode||'')}</small></td><td>${esc(b.guest_name||'—')}<br><small>${esc(b.contact_number||'')}</small></td><td>${esc(unit?.name||unit?.unit_number||'—')}</td><td>${fmtDate(b.check_in_date)}</td><td>${pax}</td><td>${money(b.base_amount||0)}</td><td>${money(b.paid_amount||0)}</td><td>${money(b.balance||0)}</td><td><span class="badge">${esc(b.status||'pending')}</span></td><td><div class="row-actions"><button data-v21-view="${b.id}">View</button><button data-v21-code="${b.id}">Barcode / QR</button><button data-v21-edit="${b.id}">Edit</button><button data-v21-pay="${b.id}">Payment</button></div></td></tr>`;
    }).join(''):`<tr><td colspan="10" class="empty-state">No ${title.toLowerCase()} found.</td></tr>`;
    $$('[data-v21-view]').forEach(x=>x.onclick=()=>openRecord('bookings',x.dataset.v21View));
    $$('[data-v21-code]').forEach(x=>x.onclick=()=>openCodesModal(state.cache.bookings.find(b=>b.id===x.dataset.v21Code)));
    $$('[data-v21-edit]').forEach(x=>x.onclick=()=>openBookingV21(type,x.dataset.v21Edit));
    $$('[data-v21-pay]').forEach(x=>x.onclick=()=>openPaymentModal(state.cache.bookings.find(b=>b.id===x.dataset.v21Pay)));
  };
  $(`#${id}Search`).oninput=draw;$(`#${id}Month`).onchange=draw;$(`#${id}Status`).onchange=draw;$(`#${id}Add`).onclick=()=>openBookingV21(type);$(`#${id}Print`).onclick=()=>printElementView(id);draw();
}

function openBookingV21(type,id=null){
  const isCottage=type==='cottage_swim', b=id?state.cache.bookings.find(x=>x.id===id):null;
  const cottages=state.cache.cottages.filter(x=>x.is_active!==false&&!['maintenance','damaged','inactive'].includes(x.status));
  const rooms=state.cache.rooms.filter(x=>x.is_active!==false&&!['maintenance','damaged','inactive'].includes(x.status));
  const unitOptions=(isCottage?cottages:rooms).map(x=>`<option value="${x.id}" ${(isCottage?b?.cottage_id:b?.room_id)===x.id?'selected':''}>${esc(x.name||x.unit_number)} · ${money(x.base_rate||0)} · Capacity ${x.capacity||0}</option>`).join('');
  openModal({title:id?`Edit ${isCottage?'Cottage + Swimming':'Room'} Booking`:`New ${isCottage?'Cottage + Swimming':'Room'} Booking`,eyebrow:id?`BOOKING ${b?.booking_number||''}`:'AUTO BOOKING NUMBER',wide:true,body:`
    ${b ? `<div class="panel full" style="margin-bottom:14px"><div class="panel-head"><h3>Booking Barcode / QR</h3><button type="button" class="btn btn-soft" id="v22ShowBookingCode">View / Print Barcode & QR</button></div><p><strong>${esc(b.booking_code||b.barcode||'Generating...')}</strong></p><p class="tiny muted">This booking scan code is separate from the Booking Number and can be used for payment, lookup and check-in.</p></div>` : `<div class="panel full" style="margin-bottom:14px"><h3>Booking Barcode / QR</h3><p class="tiny muted">A unique Booking Scan Code, Barcode and QR Code will be generated automatically after you save this booking.</p></div>`}
    <form id="v21BookingForm" class="modal-form">
      <label>Guest / Client Name<input name="guest_name" required value="${esc(b?.guest_name||'')}"></label>
      <label>Contact Number<input name="contact_number" value="${esc(b?.contact_number||'')}"></label>
      <label>Check-in Date<input name="check_in_date" type="date" required value="${esc(b?.check_in_date||today())}"></label>
      <label>Check-out Date<input name="check_out_date" type="date" required value="${esc(b?.check_out_date||(isCottage?today():''))}"></label>
      <label class="full">${isCottage?'Cottage':'Room'}<select name="unit_id" required><option value="">Select ${isCottage?'cottage':'room'}...</option>${unitOptions}</select></label>
      <label>Adults<input name="adults" type="number" min="0" value="${b?.adults??0}"></label>
      <label>Kids<input name="kids" type="number" min="0" value="${b?.kids??0}"></label>
      <label>Babies (Free)<input name="babies" type="number" min="0" value="${b?.babies??0}"></label>
      <label>Senior (included in Adults)<input name="seniors" type="number" min="0" value="${b?.seniors??0}"></label>
      <label>PWD (included in Adults)<input name="pwd" type="number" min="0" value="${b?.pwd??0}"></label>
      <label>Status<select name="status"><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="checked_in">Checked In</option><option value="checked_out">Checked Out</option><option value="cancelled">Cancelled</option><option value="no_show">No Show</option></select></label>
      <label class="full">Notes<textarea name="notes" rows="3">${esc(b?.notes||'')}</textarea></label>
    </form>
    <div id="v21Calc" class="panel" style="margin-top:14px"></div>
  `,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v21SaveBooking">Save Booking</button>`});
  $('[data-modal-cancel]').onclick=closeModal;
  const f=$('#v21BookingForm'); if(b)f.elements.status.value=b.status||'pending';
  if(b && $('#v22ShowBookingCode')) $('#v22ShowBookingCode').onclick=()=>openCodesModal(b);
  const recalc=()=>{
    const fd=new FormData(f), data=Object.fromEntries(fd.entries());
    if(isCottage){
      const c=calcCottageBooking({cottage_id:data.unit_id,adults:data.adults,kids:data.kids,babies:data.babies,seniors:data.seniors,pwd:data.pwd});
      $('#v21Calc').innerHTML=`<div class="panel-head"><h3>Automatic Cottage + Swimming Computation</h3></div><div class="report-kpis"><div class="report-kpi"><span>Cottage Fee</span><strong>${money(c.cottage)}</strong></div><div class="report-kpi"><span>Ligo / Entrance</span><strong>${money(c.swim)}</strong></div><div class="report-kpi"><span>Baby</span><strong>FREE</strong></div><div class="report-kpi"><span>Base Total</span><strong>${money(c.total)}</strong></div></div><p class="tiny muted">Adults include Senior/PWD. Senior/PWD discounts use the percentages in Settings. Extra purchases/services are added later to the same running account.</p>`;
    }else{
      const r=calcRoomBooking({room_id:data.unit_id,check_in_date:data.check_in_date,check_out_date:data.check_out_date,adults:data.adults,kids:data.kids});
      $('#v21Calc').innerHTML=`<div class="panel-head"><h3>Automatic Room Computation</h3></div><div class="report-kpis"><div class="report-kpi"><span>Nights</span><strong>${r.nights}</strong></div><div class="report-kpi"><span>Room Fee</span><strong>${money(r.room)}</strong></div><div class="report-kpi"><span>Extra Pax</span><strong>${r.extra}</strong></div><div class="report-kpi"><span>Base Total</span><strong>${money(r.total)}</strong></div></div><p class="tiny muted">Formula: room rate × nights + extra-person rate × extra chargeable guests × nights. Babies are free for extra-person counting.</p>`;
    }
  };
  ['change','input'].forEach(ev=>f.addEventListener(ev,recalc)); recalc();
  $('#v21SaveBooking').onclick=async()=>{
    const fd=new FormData(f), d=Object.fromEntries(fd.entries());
    const adults=Number(d.adults||0),kids=Number(d.kids||0),babies=Number(d.babies||0),seniors=Number(d.seniors||0),pwd=Number(d.pwd||0);
    if(!d.guest_name.trim())return toast('Guest / client name is required.','error');
    if(!d.unit_id)return toast(`Select a ${isCottage?'cottage':'room'}.`,'error');
    if(seniors+pwd>adults)return toast('Senior + PWD cannot be greater than Adults.','error');
    const payload={booking_type:type,guest_name:d.guest_name.trim(),contact_number:d.contact_number||null,booking_date:b?.booking_date||today(),check_in_date:d.check_in_date,check_out_date:d.check_out_date,adults,kids,babies,seniors,pwd,status:d.status||'pending',notes:d.notes||null};
    if(isCottage){payload.cottage_id=d.unit_id;payload.room_id=null;}else{payload.room_id=d.unit_id;payload.cottage_id=null;}
    // Do not send booking_number/base/total/payment_status. Supabase V2.1 owns them.
    let res;
    if(id)res=await sb.from('bookings').update(payload).eq('id',id).select().single();
    else res=await sb.from('bookings').insert({...payload,created_by:state.session.user.id}).select().single();
    if(res.error)return toast(res.error.message,'error');
    closeModal();await refreshOperations();
    const savedBooking=state.cache.bookings.find(x=>x.id===res.data.id)||res.data;
    toast(`${isCottage?'Cottage + Swimming':'Room'} booking saved as ${savedBooking.booking_number}.`);
    renderBookingTypePage(type);
    // For a newly created booking, immediately show its scannable Booking Barcode + QR.
    // On edit, keep the user in the booking list.
    if(!id) setTimeout(()=>openCodesModal(savedBooking),80);
  };
}

// All Bookings should not expose booking number/status as nullable input fields anymore.
const v21ModuleConfig=moduleConfig;
moduleConfig=function(name){
  if(name==='bookings') return {table:'bookings',title:'All Bookings',date:'check_in_date',readonly:true,fields:[
    ['booking_number','Booking No.','text'],['booking_code','Booking Code','text'],['booking_type','Type','text'],['guest_name','Guest Name','text'],['contact_number','Contact','text'],['check_in_date','Check-in','date'],['check_out_date','Check-out','date'],['status','Status','text'],['total_amount','Total','number'],['paid_amount','Paid','number'],['balance','Balance','number']
  ]};
  return v21ModuleConfig(name);
};

// Settings fields should reflect database values when the settings page opens.
const v21ApplyBrand=applyBrand;
applyBrand=function(){
  v21ApplyBrand();
  const g=$('#generalSettingsForm'),r=$('#rulesSettingsForm');
  if(g){['resort_name','address','contact_number','email','invoice_footer'].forEach(k=>{if(g.elements[k])g.elements[k].value=state.settings[k]??''})}
  if(r){['adult_age','child_age','baby_age_max','senior_discount','pwd_discount','adult_swim_rate','kid_swim_rate'].forEach(k=>{if(r.elements[k])r.elements[k].value=state.settings[k]??0})}
};

// Ensure rule save updates the newly added rates too.
$('#rulesSettingsForm').onsubmit=async e=>{
  e.preventDefault(); const fd=new FormData(e.currentTarget), payload={id:1};
  for(const [k,v] of fd.entries())payload[k]=Number(v);
  const {error}=await sb.from('system_settings').upsert(payload,{onConflict:'id'});if(error)return toast(error.message,'error');
  state.settings={...state.settings,...payload};toast('Guest, discount and swimming rates saved.');
};

// V2.1 code card: Booking Number is the readable reference; Booking Code is the scan/payment/check-in code.
openCodesModal=function(b){
  if(!b)return;
  const pax=bookingPax(b.id), scanCode=b.booking_code||b.barcode||b.booking_number;
  openModal({title:'Booking Barcode / QR',eyebrow:b.booking_number,wide:true,body:`
    <div class="dashboard-grid">
      <div class="panel">
        <h3>Booking Number</h3>
        <p style="font-size:20px"><strong>${esc(b.booking_number)}</strong></p>
        <p class="tiny muted">Readable reservation reference. Use this for reports, invoice and manual search.</p>
      </div>
      <div class="panel">
        <h3>Booking Scan Code</h3>
        <p style="font-size:20px"><strong>${esc(scanCode)}</strong></p>
        <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:12px">
          <div id="bookingQr" style="background:#fff;padding:8px;border:1px solid var(--line);border-radius:10px"></div>
          <svg id="bookingBarcode" style="max-width:100%"></svg>
        </div>
        <p class="tiny muted">Scan this code for payment, booking lookup and check-in. It is generated automatically for both Cottage + Swimming and Room bookings.</p>
      </div>
    </div>
    <div class="table-panel" style="margin-top:14px">
      <div class="panel-head" style="padding:14px 14px 0"><h3>Pax Codes</h3><span class="muted tiny">${pax.length} pax</span></div>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>Pax</th><th>Type</th><th>Pax Code</th><th>Status</th></tr></thead><tbody>
        ${pax.length?pax.map(p=>`<tr><td>${esc(paxDisplayName(p))}</td><td>${esc(p.pax_type)}</td><td><strong>${esc(p.code)}</strong></td><td>${esc(p.access_status)}</td></tr>`).join(''):'<tr><td colspan="4" class="empty-state">Pax codes will appear here after pax records are generated.</td></tr>'}
      </tbody></table></div>
    </div>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-soft" id="copyBookingCodeBtn">Copy Code</button><button class="btn btn-primary" id="printCodesBtn">Print Barcode / QR</button>`});
  $('[data-modal-cancel]').onclick=closeModal;
  try{
    new QRCode($('#bookingQr'),{text:scanCode,width:150,height:150});
    JsBarcode('#bookingBarcode',scanCode,{format:'CODE128',displayValue:true,height:64,margin:8});
  }catch(e){ toast('Barcode renderer could not load. Check your internet connection for the barcode libraries.','error'); }
  $('#copyBookingCodeBtn').onclick=async()=>{
    try{await navigator.clipboard.writeText(scanCode);toast('Booking Scan Code copied.');}
    catch{toast(`Booking Scan Code: ${scanCode}`);}
  };
  $('#printCodesBtn').onclick=()=>window.print();
};

// Scan accepts Booking Number or Booking Scan Code.
scanBarcode=async function(){
  const code=$('#barcodeInput').value.trim(); if(!code)return;
  await refreshOperations();
  const pax=(state.cache.pax||[]).find(p=>p.code===code && p.access_status!=='cancelled');
  if(pax){state.activeScanPax=pax;return handlePaxScan(pax)}
  const booking=state.cache.bookings.find(b=>b.booking_number===code||b.booking_code===code||b.barcode===code);
  if(booking)return openBookingScanResult(booking);
  const {data:bc}=await sb.from('barcodes').select('*').eq('code',code).eq('is_active',true).maybeSingle();
  if(bc?.booking_id){const b=state.cache.bookings.find(x=>x.id===bc.booking_id);if(b)return openBookingScanResult(b)}
  $('#barcodeResult').innerHTML=`<div class="empty-state"><strong>Code not found</strong><p>${esc(code)}</p><small>Scan a Pax Code or Booking Scan Code, or manually enter the Booking Number.</small></div>`;
};
$('#barcodeSearchBtn').onclick=scanBarcode;
$('#barcodeInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();scanBarcode()}};



/* ============================================================
   MASUSI FARM RESORT V2.4
   PAX CODE MANAGER + CORRECT CHECK-IN SCAN FLOW
   Booking: auto-generated scan code
   Pax: manual/scan by default, optional auto-generate
   ============================================================ */

state.v24ScanTarget = null;

function v24Norm(v){ return String(v||'').trim(); }
function v24FindPaxByCode(code){
  const c=v24Norm(code).toLowerCase();
  return (state.cache.pax||[]).find(p=>v24Norm(p.code).toLowerCase()===c && p.access_status!=='cancelled');
}
function v24FindBookingByCode(code){
  const c=v24Norm(code).toLowerCase();
  return (state.cache.bookings||[]).find(b=>
    [b.booking_number,b.booking_code,b.barcode].some(v=>v24Norm(v).toLowerCase()===c)
  );
}
function v24RandomPaxCode(){
  const s=crypto.getRandomValues(new Uint32Array(2));
  return `MFR-PAX-${s[0].toString(36).toUpperCase()}${s[1].toString(36).toUpperCase()}`.slice(0,24);
}

// ---------- Override main scanner ----------
scanBarcode = async function(){
  const el=$('#barcodeInput'), code=v24Norm(el?.value);
  if(!code)return;
  await refreshOperations();

  const pax=v24FindPaxByCode(code);
  if(pax){ state.activeScanPax=pax; return handlePaxScanV24(pax); }

  const booking=v24FindBookingByCode(code);
  if(booking) return openBookingScanResult(booking);

  const {data:bc}=await sb.from('barcodes').select('*').ilike('code',code).eq('is_active',true).maybeSingle();
  if(bc?.booking_id){
    const b=state.cache.bookings.find(x=>x.id===bc.booking_id);
    if(b)return openBookingScanResult(b);
  }

  $('#barcodeResult').innerHTML=`<div class="empty-state">
    <strong>Code not found</strong>
    <p>${esc(code)}</p>
    <small>You can scan a Booking Scan Code, Booking Number, or a Pax Code assigned in Edit Booking.</small>
  </div>`;
  el?.select();
};
if($('#barcodeSearchBtn')) $('#barcodeSearchBtn').onclick=scanBarcode;
if($('#barcodeInput')) $('#barcodeInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();scanBarcode()}};

// ---------- PAX MANAGER ----------
async function openPaxManagerV24(booking){
  await refreshOperations();
  const pax=autoSortRows('pax',(state.cache.pax||[]).filter(p=>p.booking_id===booking.id && p.access_status!=='cancelled'));

  openModal({
    title:'Pax / Companion Barcode Manager',
    eyebrow:booking.booking_number,
    wide:true,
    body:`
      <div class="panel" style="margin-bottom:14px">
        <div class="panel-head">
          <div>
            <h3>${esc(booking.guest_name||'Guest')}</h3>
            <p class="muted">${esc(booking.booking_type||'booking')} · ${esc(booking.booking_number)}</p>
          </div>
          <button class="btn btn-primary" id="v24AddPaxBtn">Add Companion / Pax</button>
        </div>
        <p class="tiny muted">
          Booking barcode is generated automatically. Pax codes are manual by default.
          For each pax you can scan your own printed barcode, type a code, or use Auto Generate.
        </p>
      </div>

      <div class="table-panel">
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr>
              <th>#</th><th>Pax</th><th>Type</th><th>Current Code</th><th>Status</th><th>Actions</th>
            </tr></thead>
            <tbody id="v24PaxRows">
              ${pax.length?pax.map((p,i)=>`
                <tr>
                  <td><strong>${i+1}</strong></td>
                  <td>${esc(paxDisplayName(p)||`Pax ${i+1}`)}</td>
                  <td>${esc(p.pax_type||'adult')}</td>
                  <td><strong>${esc(p.code||'NO CODE')}</strong></td>
                  <td><span class="badge">${esc(p.access_status||'not_checked_in')}</span></td>
                  <td>
                    <div class="row-actions">
                      <button data-v24-manual="${p.id}">Manual Code</button>
                      <button data-v24-scan="${p.id}">Scan Code</button>
                      <button data-v24-auto="${p.id}">Auto Generate</button>
                      ${p.code?`<button data-v24-clear="${p.id}">Clear</button>`:''}
                    </div>
                  </td>
                </tr>`).join(''):`<tr><td colspan="6" class="empty-state">No pax records yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Close</button>`
  });

  $('[data-modal-cancel]').onclick=closeModal;
  $('#v24AddPaxBtn').onclick=()=>openAddPaxV24(booking);

  $$('[data-v24-manual]').forEach(btn=>btn.onclick=()=>{
    const p=state.cache.pax.find(x=>x.id===btn.dataset.v24Manual);
    openManualPaxCodeV24(booking,p);
  });
  $$('[data-v24-scan]').forEach(btn=>btn.onclick=()=>{
    const p=state.cache.pax.find(x=>x.id===btn.dataset.v24Scan);
    openScanPaxCodeV24(booking,p);
  });
  $$('[data-v24-auto]').forEach(btn=>btn.onclick=()=>{
    const p=state.cache.pax.find(x=>x.id===btn.dataset.v24Auto);
    autoGeneratePaxCodeV24(booking,p);
  });
  $$('[data-v24-clear]').forEach(btn=>btn.onclick=()=>{
    const p=state.cache.pax.find(x=>x.id===btn.dataset.v24Clear);
    clearPaxCodeV24(booking,p);
  });
}

function openManualPaxCodeV24(booking,p){
  openModal({
    title:'Enter Pax Code',
    eyebrow:paxDisplayName(p),
    body:`<form id="v24ManualPaxForm" class="modal-form">
      <label class="full">Barcode / QR / Code
        <input name="code" autocomplete="off" value="${esc(p.code||'')}" placeholder="Example: 123456789012 or your own code" required autofocus>
      </label>
      <p class="tiny muted full">This should match the code printed on the physical barcode/QR that you will give to this pax.</p>
    </form>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v24SaveManualCode">Save Code</button>`
  });
  $('[data-modal-cancel]').onclick=()=>openPaxManagerV24(booking);
  $('#v24SaveManualCode').onclick=async()=>{
    const code=v24Norm(new FormData($('#v24ManualPaxForm')).get('code'));
    if(!code)return toast('Enter a code.','error');
    await savePaxCodeV24(booking,p,code);
  };
}

function openScanPaxCodeV24(booking,p){
  openModal({
    title:'Scan Pax Barcode',
    eyebrow:paxDisplayName(p),
    body:`<div class="scanner-panel">
      <div class="scanner-icon">▥</div>
      <h3>Scan the physical barcode now</h3>
      <p class="muted">Your Bluetooth/USB scanner should type the code below and send Enter.</p>
      <input id="v24PaxScanInput" class="barcode-input" autocomplete="off" placeholder="Waiting for scanner..." autofocus>
      <p class="tiny muted">You can also type the code manually here and press Enter.</p>
    </div>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v24UseScannedCode">Use Code</button>`
  });
  $('[data-modal-cancel]').onclick=()=>openPaxManagerV24(booking);
  const input=$('#v24PaxScanInput');
  setTimeout(()=>input?.focus(),100);
  const use=async()=>{
    const code=v24Norm(input.value);
    if(!code)return toast('Scan or enter a code first.','error');
    await savePaxCodeV24(booking,p,code);
  };
  input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();use()}};
  $('#v24UseScannedCode').onclick=use;
}

async function autoGeneratePaxCodeV24(booking,p){
  confirmModal('Auto Generate Pax Code',
    `Generate a system Pax Code for ${paxDisplayName(p)}? You can print this code later.`,
    async()=>{
      const code=v24RandomPaxCode();
      closeModal();
      await savePaxCodeV24(booking,p,code);
    }
  );
}

async function savePaxCodeV24(booking,p,code){
  // uniqueness check
  const {data:dupe}=await sb.from('booking_pax').select('id,booking_id').eq('code',code).neq('id',p.id).maybeSingle();
  if(dupe)return toast('That Pax Code is already assigned to another pax.','error');

  const {error}=await sb.from('booking_pax').update({code}).eq('id',p.id);
  if(error)return toast(error.message,'error');

  await writeAudit('update','booking_pax',p.id,`Pax code assigned/changed to ${code}`);
  await refreshOperations();
  toast('Pax code saved.');
  openPaxManagerV24(state.cache.bookings.find(x=>x.id===booking.id)||booking);
}

async function clearPaxCodeV24(booking,p){
  confirmModal('Clear Pax Code',
    `Remove the current code from ${paxDisplayName(p)}? The pax will not be scannable until a new code is assigned.`,
    async()=>{
      const {error}=await sb.from('booking_pax').update({code:null}).eq('id',p.id);
      if(error)return toast(error.message,'error');
      closeModal(); await refreshOperations(); toast('Pax code cleared.');
      openPaxManagerV24(state.cache.bookings.find(x=>x.id===booking.id)||booking);
    },true
  );
}

function openAddPaxV24(booking){
  openModal({
    title:'Add Companion / Pax',
    eyebrow:booking.booking_number,
    body:`<form id="v24AddPaxForm" class="modal-form">
      <label>Pax Type
        <select name="pax_type">
          <option value="adult">Adult</option>
          <option value="kid">Kid</option>
          <option value="baby">Baby</option>
          <option value="senior">Senior</option>
          <option value="pwd">PWD</option>
        </select>
      </label>
      <label>Name / Label
        <input name="display_name" placeholder="Optional: Juan / Pax 11">
      </label>
      <label>Code Method
        <select name="code_method" id="v24CodeMethod">
          <option value="none">No code yet</option>
          <option value="manual">Manual / Scan my own code</option>
          <option value="auto">Auto Generate</option>
        </select>
      </label>
      <label>Barcode / QR / Code
        <input name="code" id="v24AddPaxCode" autocomplete="off" placeholder="Scan or type code">
      </label>
      <p class="tiny muted full">If you choose Manual, focus the code field and scan your printed barcode. If Auto Generate, the system will create the code.</p>
    </form>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v24SaveNewPax">Add Pax</button>`
  });
  $('[data-modal-cancel]').onclick=()=>openPaxManagerV24(booking);
  $('#v24CodeMethod').onchange=e=>{
    if(e.target.value==='auto') $('#v24AddPaxCode').value=v24RandomPaxCode();
    if(e.target.value==='none') $('#v24AddPaxCode').value='';
    if(e.target.value==='manual') setTimeout(()=>$('#v24AddPaxCode').focus(),50);
  };
  $('#v24AddPaxCode').onkeydown=e=>{
    if(e.key==='Enter'){e.preventDefault();$('#v24SaveNewPax').click()}
  };
  $('#v24SaveNewPax').onclick=async()=>{
    const fd=new FormData($('#v24AddPaxForm'));
    const code=v24Norm(fd.get('code'))||null;
    if(code){
      const {data:dupe}=await sb.from('booking_pax').select('id').eq('code',code).maybeSingle();
      if(dupe)return toast('That Pax Code is already assigned.','error');
    }
    const payload={
      booking_id:booking.id,
      pax_type:fd.get('pax_type'),
      display_name:v24Norm(fd.get('display_name'))||null,
      code,
      access_status:'not_checked_in'
    };
    const {error}=await sb.from('booking_pax').insert(payload);
    if(error)return toast(error.message,'error');
    await refreshOperations(); toast('Companion/Pax added.');
    openPaxManagerV24(state.cache.bookings.find(x=>x.id===booking.id)||booking);
  };
}

// ---------- Correct scan/check-in flow ----------
async function handlePaxScanV24(p){
  const b=activeBookingForPax(p);
  if(!b)return toast('Booking for this pax was not found.','error');

  if((p.access_status||'not_checked_in')==='not_checked_in'){
    const isRoom=b.booking_type==='room'||!!b.room_id;
    if(isRoom)return openFirstRoomEntryV24(p,b);
    return openFirstCottageEntryV24(p,b);
  }

  const isRoom=b.booking_type==='room'||!!b.room_id;
  const unit=isRoom
    ? roomById(p.assigned_room_id||b.room_id)
    : cottageById(p.assigned_cottage_id||b.cottage_id);

  $('#barcodeResult').innerHTML=`<div class="report-kpis">
    <div class="report-kpi"><span>Pax</span><strong>${esc(paxDisplayName(p))}</strong></div>
    <div class="report-kpi"><span>${isRoom?'Room':'Cottage'}</span><strong>${esc(unit?.name||unit?.unit_number||'—')}</strong></div>
    <div class="report-kpi"><span>Status</span><strong>${esc(p.access_status)}</strong></div>
    <div class="report-kpi"><span>Booking</span><strong>${esc(b.booking_number)}</strong></div>
  </div>
  <div class="panel">
    <p><strong>${esc(p.code||'NO CODE')}</strong></p>
    <div class="row-actions">
      <button class="btn btn-primary" id="v24AccountBtn">Booking Account</button>
      ${p.access_status==='inside'?'<button class="btn btn-soft" id="v24OutBtn">Mark OUT</button><button class="btn btn-soft" id="v24PurchaseBtn">Add Purchase</button>':''}
      ${p.access_status==='outside'?'<button class="btn btn-primary" id="v24ReturnBtn">Mark RETURNED</button>':''}
    </div>
  </div>`;

  $('#v24AccountBtn').onclick=()=>openCottageAccount(b.id,p.id);
  if($('#v24OutBtn')) $('#v24OutBtn').onclick=()=>accessActionV24(p,'exit');
  if($('#v24ReturnBtn')) $('#v24ReturnBtn').onclick=()=>accessActionV24(p,'return');
  if($('#v24PurchaseBtn')) $('#v24PurchaseBtn').onclick=()=>openPOSForPax(p,b);
  $('#barcodeInput')?.select();
}

function openFirstCottageEntryV24(p,b){
  const options=state.cache.cottages
    .filter(c=>c.is_active!==false && !['maintenance','damaged','inactive'].includes(c.status))
    .map(c=>`<option value="${c.id}" ${b.cottage_id===c.id?'selected':''}>${esc(c.name||c.unit_number)} · Capacity ${c.capacity||'—'}</option>`).join('');

  openModal({
    title:'Assign Cottage & Check In',
    eyebrow:'FIRST PAX SCAN',
    body:`<div class="panel">
      <strong>${esc(paxDisplayName(p))}</strong>
      <p class="muted">${esc(b.booking_number)} · ${esc(b.guest_name||'Guest')}</p>
      <p>Scanned Code: <strong>${esc(p.code)}</strong></p>
    </div>
    <form id="v24FirstCottageForm" class="modal-form">
      <label class="full">Select Cottage
        <select name="cottage_id" required><option value="">Select cottage...</option>${options}</select>
      </label>
    </form>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v24ConfirmCottageCheckin">Assign & Check In</button>`
  });
  $('[data-modal-cancel]').onclick=closeModal;
  $('#v24ConfirmCottageCheckin').onclick=async()=>{
    const cottage_id=new FormData($('#v24FirstCottageForm')).get('cottage_id');
    if(!cottage_id)return toast('Select a cottage.','error');
    const now=new Date().toISOString();
    const {error}=await sb.from('booking_pax').update({
      assigned_cottage_id:cottage_id,assigned_room_id:null,
      access_status:'inside',first_check_in_at:now,last_return_at:now
    }).eq('id',p.id);
    if(error)return toast(error.message,'error');

    await sb.from('access_logs').insert({
      booking_id:b.id,pax_id:p.id,cottage_id,room_id:null,
      action:'check_in',scanned_code:p.code,performed_by:state.session.user.id
    });
    const patch={status:'checked_in'};
    if(!b.cottage_id)patch.cottage_id=cottage_id;
    await sb.from('bookings').update(patch).eq('id',b.id);

    closeModal(); await refreshOperations();
    toast(`${paxDisplayName(p)} checked in.`);
    handlePaxScanV24(state.cache.pax.find(x=>x.id===p.id));
  };
}

function openFirstRoomEntryV24(p,b){
  const room=roomById(b.room_id);
  if(!room){
    openModal({
      title:'Room Not Assigned',eyebrow:'CHECK-IN BLOCKED',
      body:`<p>This Room Booking has no room selected. Edit the booking first and assign a room.</p>`,
      footer:`<button class="btn btn-primary" data-modal-cancel>Close</button>`
    });
    $('[data-modal-cancel]').onclick=closeModal;
    return;
  }

  openModal({
    title:'Confirm Room Check-In',
    eyebrow:'FIRST PAX SCAN',
    body:`<div class="report-kpis">
      <div class="report-kpi"><span>Pax</span><strong>${esc(paxDisplayName(p))}</strong></div>
      <div class="report-kpi"><span>Room</span><strong>${esc(room.name||room.unit_number)}</strong></div>
      <div class="report-kpi"><span>Booking</span><strong>${esc(b.booking_number)}</strong></div>
      <div class="report-kpi"><span>Code</span><strong>${esc(p.code)}</strong></div>
    </div>
    <p class="muted">This pax will check in to the room already assigned to the Room Booking.</p>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v24ConfirmRoomCheckin">Check In</button>`
  });
  $('[data-modal-cancel]').onclick=closeModal;
  $('#v24ConfirmRoomCheckin').onclick=async()=>{
    const now=new Date().toISOString();
    const {error}=await sb.from('booking_pax').update({
      assigned_room_id:b.room_id,assigned_cottage_id:null,
      access_status:'inside',first_check_in_at:now,last_return_at:now
    }).eq('id',p.id);
    if(error)return toast(error.message,'error');

    await sb.from('access_logs').insert({
      booking_id:b.id,pax_id:p.id,room_id:b.room_id,cottage_id:null,
      action:'check_in',scanned_code:p.code,performed_by:state.session.user.id
    });
    await sb.from('bookings').update({status:'checked_in'}).eq('id',b.id);
    closeModal(); await refreshOperations(); toast(`${paxDisplayName(p)} checked in to ${room.name||room.unit_number}.`);
    handlePaxScanV24(state.cache.pax.find(x=>x.id===p.id));
  };
}

async function accessActionV24(p,action){
  const b=activeBookingForPax(p); if(!b)return;
  const now=new Date().toISOString(), isExit=action==='exit';
  const patch=isExit
    ? {access_status:'outside',last_exit_at:now}
    : {access_status:'inside',last_return_at:now};

  const {error}=await sb.from('booking_pax').update(patch).eq('id',p.id);
  if(error)return toast(error.message,'error');

  await sb.from('access_logs').insert({
    booking_id:b.id,pax_id:p.id,
    cottage_id:p.assigned_cottage_id||b.cottage_id||null,
    room_id:p.assigned_room_id||b.room_id||null,
    action:isExit?'exit':'return',
    scanned_code:p.code,performed_by:state.session.user.id
  });
  await refreshOperations();
  toast(isExit?'Pax marked OUT.':'Pax marked RETURNED.');
  handlePaxScanV24(state.cache.pax.find(x=>x.id===p.id));
}

// ---------- Hook Pax Manager into booking UI ----------
document.addEventListener('click',e=>{
  const btn=e.target.closest('[data-v24-pax-manager]');
  if(!btn)return;
  const b=state.cache.bookings.find(x=>x.id===btn.dataset.v24PaxManager);
  if(b)openPaxManagerV24(b);
});

// Add a visible Pax Manager button to booking detail modal after it opens.
// This wraps the existing openRecord only for bookings.
const _v24OpenRecordBase = openRecord;
openRecord = async function(name,id,edit=false){
  if(name!=='bookings') return _v24OpenRecordBase(name,id,edit);
  const result=await _v24OpenRecordBase(name,id,edit);
  if(id){
    const b=state.cache.bookings.find(x=>x.id===id);
    if(b){
      setTimeout(()=>{
        const footer=$('#modalFooter');
        if(footer && !footer.querySelector('[data-v24-pax-manager]')){
          const btn=document.createElement('button');
          btn.className='btn btn-soft';
          btn.type='button';
          btn.dataset.v24PaxManager=b.id;
          btn.textContent='Pax / Companion Codes';
          footer.insertBefore(btn,footer.firstChild);
        }
      },20);
    }
  }
  return result;
};

// Also hook into V2.1 typed booking edit modal if present.
const _v24OpenBookingV21 = typeof openBookingV21==='function' ? openBookingV21 : null;
if(_v24OpenBookingV21){
  openBookingV21 = async function(type,id=null){
    const result=await _v24OpenBookingV21(type,id);
    if(id){
      const b=state.cache.bookings.find(x=>x.id===id);
      if(b){
        setTimeout(()=>{
          const footer=$('#modalFooter');
          if(footer && !footer.querySelector('[data-v24-pax-manager]')){
            const btn=document.createElement('button');
            btn.className='btn btn-soft';
            btn.type='button';
            btn.dataset.v24PaxManager=b.id;
            btn.textContent='Pax / Companion Codes';
            footer.insertBefore(btn,footer.firstChild);
          }
        },20);
      }
    }
    return result;
  };
}

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v23.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */

/* Masusi Farm Resort V2.3
   Day/Night Tour rates + one-discount-per-bill engine.
*/
state.cache.tourRates = state.cache.tourRates || [];

const v23PreloadBase = preload;
preload = async function(){
  await v23PreloadBase();
  await getTable('tour_rates','tourRates');
};

const v23RefreshBase = refreshOperations;
refreshOperations = async function(){
  await v23RefreshBase();
  await getTable('tour_rates','tourRates');
};

const v23RenderBase = renderCurrent;
renderCurrent = async function(){
  if(state.currentView==='rates') return renderRatesPricing();
  return v23RenderBase();
};

const v23NavigateBase = navigate;
navigate = function(view){
  if(view==='rates'){
    state.currentView='rates';
    $$('.view').forEach(v=>v.classList.remove('active'));
    $('#view-rates')?.classList.add('active');
    $$('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.view==='rates'));
    $('#sidebar').classList.remove('open');
    $('#pageTitle').textContent='Rates & Pricing';
    return renderRatesPricing();
  }
  return v23NavigateBase(view);
};

function tourRateById(id){ return (state.cache.tourRates||[]).find(x=>x.id===id); }
function activeTourRates(){ return (state.cache.tourRates||[]).filter(x=>x.is_active!==false).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)); }
function discountLabel(b){
  if(!b || b.discount_type==='none' || b.discount_mode==='none') return 'No Discount';
  const who=b.discount_type==='senior'?'Senior':'PWD';
  return `${who} · ${b.discount_mode==='whole_bill'?'Whole Bill':'One Qualified Person'} · ${Number(b.discount_rate||0)}%`;
}

// The database remains the source of truth. This is only the live UI preview.
function calcDiscountPreview({gross=0,discount_type='none',discount_mode='none',rate=0,eligible=0}){
  gross=Number(gross||0); rate=Number(rate||0); eligible=Number(eligible||0);
  if(discount_type==='none'||discount_mode==='none') return {discount:0,net:gross};
  const basis=discount_mode==='whole_bill'?gross:Math.min(gross,eligible);
  const discount=Math.round((basis*rate/100)*100)/100;
  return {discount,net:Math.max(0,gross-discount),basis};
}

calcCottageBooking = function({cottage_id,tour_rate_id,adults=0,kids=0,babies=0,discount_type='none',discount_mode='none'}){
  const c=state.cache.cottages.find(x=>x.id===cottage_id), tr=tourRateById(tour_rate_id)||activeTourRates()[0];
  adults=Number(adults||0);kids=Number(kids||0);babies=Number(babies||0);
  const cottage=Number(c?.base_rate||0), adultRate=Number(tr?.adult_rate||0), kidRate=Number(tr?.kid_rate||0), babyRate=Number(tr?.baby_rate||0);
  const swim=adults*adultRate+kids*kidRate+babies*babyRate, gross=cottage+swim;
  const rate=discount_type==='senior'?Number(state.settings.senior_discount||0):discount_type==='pwd'?Number(state.settings.pwd_discount||0):0;
  const eligible=(discount_mode==='person_only'&&discount_type!=='none')?adultRate:0;
  const d=calcDiscountPreview({gross,discount_type,discount_mode,rate,eligible});
  return {tour:tr,cottage,swim,gross,discount:d.discount,total:d.net,eligible,adultRate,kidRate,babyRate};
};

calcRoomBooking = function({room_id,check_in_date,check_out_date,adults=0,kids=0,discount_type='none',discount_mode='none'}){
  const r=state.cache.rooms.find(x=>x.id===room_id); let nights=1;
  if(check_in_date&&check_out_date){const a=new Date(check_in_date+'T00:00:00'),b=new Date(check_out_date+'T00:00:00');nights=Math.max(1,Math.round((b-a)/86400000));}
  const chargeable=Number(adults||0)+Number(kids||0),extra=Math.max(0,chargeable-Number(r?.capacity||0));
  const room=Number(r?.base_rate||0)*nights,extraFee=Number(r?.extra_person_rate||0)*extra*nights,gross=room+extraFee;
  const rate=discount_type==='senior'?Number(state.settings.senior_discount||0):discount_type==='pwd'?Number(state.settings.pwd_discount||0):0;
  const eligible=(discount_mode==='person_only'&&discount_type!=='none')?gross/Math.max(chargeable,1):0;
  const d=calcDiscountPreview({gross,discount_type,discount_mode,rate,eligible});
  return {nights,room,extra,extraFee,gross,discount:d.discount,total:d.net,eligible};
};

async function renderRatesPricing(){
  await getTable('tour_rates','tourRates');
  const root=$('#view-rates'); if(!root)return;
  const rows=state.cache.tourRates||[];
  root.innerHTML=`
    <div class="section-head"><div><p class="eyebrow">CENTRAL RATE LIBRARY</p><h2>Rates & Pricing</h2><p class="muted">Manage Day Tour and Night Tour swimming/entrance prices here. Cottage and Room base rates remain editable in their own unit pages.</p></div><button class="btn btn-primary" id="addTourRateBtn">Add Tour Rate</button></div>
    <div class="table-panel"><div class="table-toolbar"><input id="tourRateSearch" class="grow" type="search" placeholder="Search Day Tour, Night Tour..."></div><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Rate Type</th><th>Code</th><th>Adult</th><th>Kids</th><th>Baby</th><th>Active</th><th>Actions</th></tr></thead><tbody id="tourRateRows"></tbody></table></div></div>
    <div class="panel" style="margin-top:16px"><div class="panel-head"><h3>Discount Rule</h3></div><p>Senior and PWD percentage is configured in Settings. During booking, staff chooses <b>Whole Bill</b> or <b>One Qualified Person Only</b>. Even if there are several Seniors/PWDs, a selected whole-bill discount is applied only once to that booking.</p></div>`;
  const draw=()=>{
    const q=$('#tourRateSearch').value.toLowerCase().trim();
    $('#tourRateRows').innerHTML=autoSortRows('tourRates',rows.filter(r=>`${r.name} ${r.code}`.toLowerCase().includes(q))).map((r,i)=>`<tr><td><strong>${i+1}</strong></td><td><strong>${esc(r.name)}</strong></td><td>${esc(r.code)}</td><td>${money(r.adult_rate)}</td><td>${money(r.kid_rate)}</td><td>${Number(r.baby_rate||0)===0?'FREE':money(r.baby_rate)}</td><td>${r.is_active?'Yes':'No'}</td><td><div class="row-actions"><button data-edit-tour-rate="${r.id}">Edit</button><button data-archive-tour-rate="${r.id}">Archive</button></div></td></tr>`).join('')||'<tr><td colspan="8" class="empty-state">No tour rates found.</td></tr>';
    $$('[data-edit-tour-rate]').forEach(x=>x.onclick=()=>tourRateModal(rows.find(r=>r.id===x.dataset.editTourRate)));
    $$('[data-archive-tour-rate]').forEach(x=>x.onclick=()=>archiveTourRate(x.dataset.archiveTourRate));
  };
  $('#tourRateSearch').oninput=draw;$('#addTourRateBtn').onclick=()=>tourRateModal(null);draw();
}

function tourRateModal(rec){
  openModal({title:rec?'Edit Tour Rate':'Add Tour Rate',eyebrow:'RATES & PRICING',body:`<form id="tourRateForm" class="modal-form">
    <label>Rate Name<input name="name" required value="${esc(rec?.name||'')}"></label>
    <label>Code<input name="code" required value="${esc(rec?.code||'') }" placeholder="day / night / special_event"></label>
    <label>Adult Rate<input name="adult_rate" type="number" min="0" step="0.01" value="${Number(rec?.adult_rate||0)}"></label>
    <label>Kids Rate<input name="kid_rate" type="number" min="0" step="0.01" value="${Number(rec?.kid_rate||0)}"></label>
    <label>Baby Rate<input name="baby_rate" type="number" min="0" step="0.01" value="${Number(rec?.baby_rate||0)}"></label>
    <label>Active<select name="is_active"><option value="true" ${rec?.is_active!==false?'selected':''}>Yes</option><option value="false" ${rec?.is_active===false?'selected':''}>No</option></select></label>
    <label>Sort Order<input name="sort_order" type="number" value="${Number(rec?.sort_order||0)}"></label>
  </form>`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="saveTourRateBtn">Save Rate</button>`});
  $('[data-modal-cancel]').onclick=closeModal;
  $('#saveTourRateBtn').onclick=async()=>{const fd=new FormData($('#tourRateForm'));const payload={name:String(fd.get('name')||'').trim(),code:String(fd.get('code')||'').trim().toLowerCase().replace(/\s+/g,'_'),adult_rate:Number(fd.get('adult_rate')||0),kid_rate:Number(fd.get('kid_rate')||0),baby_rate:Number(fd.get('baby_rate')||0),is_active:fd.get('is_active')==='true',sort_order:Number(fd.get('sort_order')||0)};if(!payload.name||!payload.code)return toast('Rate name and code are required.','error');const q=rec?sb.from('tour_rates').update(payload).eq('id',rec.id):sb.from('tour_rates').insert(payload);const {error}=await q;if(error)return toast(error.message,'error');closeModal();await getTable('tour_rates','tourRates');toast('Tour rate saved.');renderRatesPricing();};
}
function archiveTourRate(id){confirmModal('Archive Tour Rate','This rate will no longer be selectable for new Cottage + Swimming bookings. Existing bookings keep their saved price snapshot.',async()=>{const {error}=await sb.from('tour_rates').update({is_active:false}).eq('id',id);if(error)return toast(error.message,'error');closeModal();await getTable('tour_rates','tourRates');renderRatesPricing();toast('Tour rate archived.');},true)}

// Replace booking list so Cottage bookings visibly show Day/Night and applied discount.
renderBookingTypePage = async function(type){
  await Promise.all([getTable('bookings'),getTable('tour_rates','tourRates')]);
  const isCottage=type==='cottage_swim',rows=state.cache.bookings.filter(b=>(b.booking_type||((b.room_id)?'room':'cottage_swim'))===type);
  const id=isCottage?'cottage-bookings':'room-bookings',title=isCottage?'Cottage + Swimming Bookings':'Room Bookings';
  $(`#view-${id}`).innerHTML=`<div class="section-head"><div><p class="eyebrow">${isCottage?'DAY / NIGHT TOUR + SWIMMING':'ROOM ACCOMMODATION'}</p><h2>${title}</h2></div></div><div class="table-panel"><div class="table-toolbar"><input id="${id}Search" class="grow" type="search" placeholder="Search guest, booking no. or code..."><input id="${id}Month" type="month" value="${currentMonth()}"><select id="${id}Status"><option value="">All status</option><option>pending</option><option>confirmed</option><option>checked_in</option><option>checked_out</option><option>cancelled</option><option>no_show</option></select><button class="btn btn-soft" id="${id}Print">Print Month</button><button class="btn btn-primary" id="${id}Add">Add ${isCottage?'Cottage + Swimming':'Room'} Booking</button></div><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Booking</th><th>Guest</th><th>${isCottage?'Cottage / Tour':'Room'}</th><th>Check-in</th><th>Pax</th><th>Gross</th><th>Discount</th><th>Net Total</th><th>Balance</th><th>Actions</th></tr></thead><tbody id="${id}Body"></tbody></table></div></div>`;
  const draw=()=>{const q=$(`#${id}Search`).value.toLowerCase().trim(),m=$(`#${id}Month`).value,st=$(`#${id}Status`).value;const filtered=autoSortRows('bookings',rows.filter(b=>`${b.booking_number||''} ${b.booking_code||''} ${b.guest_name||''}`.toLowerCase().includes(q)&&(!m||String(b.check_in_date||b.booking_date||'').slice(0,7)===m)&&(!st||b.status===st)));$(`#${id}Body`).innerHTML=filtered.length?filtered.map((b,i)=>{const unit=isCottage?cottageById(b.cottage_id):roomById(b.room_id),pax=Number(b.adults||0)+Number(b.kids||0)+Number(b.babies||0),tour=isCottage?(tourRateById(b.tour_rate_id)?.name||b.tour_type||'Day Tour'):'';return `<tr><td><strong>${i+1}</strong></td><td><strong>${esc(b.booking_number)}</strong><br><small>${esc(b.booking_code||'')}</small></td><td>${esc(b.guest_name||'—')}</td><td>${esc(unit?.name||unit?.unit_number||'—')}${isCottage?`<br><small>${esc(tour)}</small>`:''}</td><td>${fmtDate(b.check_in_date)}</td><td>${pax}</td><td>${money(b.gross_amount||b.base_amount||0)}</td><td>${money(b.discount_amount||0)}<br><small>${esc(discountLabel(b))}</small></td><td>${money(b.total_amount||0)}</td><td>${money(b.balance||0)}</td><td><div class="row-actions"><button data-v23-view="${b.id}">View</button><button data-v23-code="${b.id}">Barcode / QR</button><button data-v23-edit="${b.id}">Edit</button><button data-v23-pay="${b.id}">Payment</button></div></td></tr>`}).join(''):`<tr><td colspan="11" class="empty-state">No ${title.toLowerCase()} found.</td></tr>`;$$('[data-v23-view]').forEach(x=>x.onclick=()=>openRecord('bookings',x.dataset.v23View));$$('[data-v23-code]').forEach(x=>x.onclick=()=>openCodesModal(state.cache.bookings.find(b=>b.id===x.dataset.v23Code)));$$('[data-v23-edit]').forEach(x=>x.onclick=()=>openBookingV21(type,x.dataset.v23Edit));$$('[data-v23-pay]').forEach(x=>x.onclick=()=>openPaymentModal(state.cache.bookings.find(b=>b.id===x.dataset.v23Pay)));};
  $(`#${id}Search`).oninput=draw;$(`#${id}Month`).onchange=draw;$(`#${id}Status`).onchange=draw;$(`#${id}Add`).onclick=()=>openBookingV21(type);$(`#${id}Print`).onclick=()=>printElementView(id);draw();
};

openBookingV21 = function(type,id=null){
  const isCottage=type==='cottage_swim',b=id?state.cache.bookings.find(x=>x.id===id):null;
  const cottages=state.cache.cottages.filter(x=>x.is_active!==false&&!['maintenance','damaged','inactive'].includes(x.status));
  const rooms=state.cache.rooms.filter(x=>x.is_active!==false&&!['maintenance','damaged','inactive'].includes(x.status));
  const unitOptions=(isCottage?cottages:rooms).map(x=>`<option value="${x.id}" ${(isCottage?b?.cottage_id:b?.room_id)===x.id?'selected':''}>${esc(x.name||x.unit_number)} · ${money(x.base_rate||0)} · Capacity ${x.capacity||0}</option>`).join('');
  const rates=activeTourRates(), rateOptions=rates.map(x=>`<option value="${x.id}" ${b?.tour_rate_id===x.id?'selected':''}>${esc(x.name)} · Adult ${money(x.adult_rate)} · Kids ${money(x.kid_rate)}${Number(x.baby_rate||0)===0?' · Baby FREE':` · Baby ${money(x.baby_rate)}`}</option>`).join('');
  openModal({title:id?`Edit ${isCottage?'Cottage + Swimming':'Room'} Booking`:`New ${isCottage?'Cottage + Swimming':'Room'} Booking`,eyebrow:id?`BOOKING ${b?.booking_number||''}`:'AUTO BOOKING NUMBER + BARCODE',wide:true,body:`
    ${b?`<div class="panel full" style="margin-bottom:14px"><div class="panel-head"><h3>Booking Barcode / QR</h3><button type="button" class="btn btn-soft" id="v23ShowCode">View / Print</button></div><strong>${esc(b.booking_code||b.barcode||'')}</strong></div>`:`<div class="panel full" style="margin-bottom:14px"><h3>Automatic Booking ID</h3><p class="tiny muted">Booking Number, Booking Scan Code, Barcode and QR are generated automatically after Save.</p></div>`}
    <form id="v23BookingForm" class="modal-form">
      <label>Guest / Client Name<input name="guest_name" required value="${esc(b?.guest_name||'')}"></label><label>Contact Number<input name="contact_number" value="${esc(b?.contact_number||'')}"></label>
      <label>Check-in Date<input name="check_in_date" type="date" required value="${esc(b?.check_in_date||today())}"></label><label>Check-out Date<input name="check_out_date" type="date" required value="${esc(b?.check_out_date||(isCottage?today():''))}"></label>
      <label class="full">${isCottage?'Cottage':'Room'}<select name="unit_id" required><option value="">Select ${isCottage?'cottage':'room'}...</option>${unitOptions}</select></label>
      ${isCottage?`<label class="full">Tour / Swimming / Event Rate<select name="tour_rate_id" required><option value="">Select Day, Night, or Special Event Rate...</option>${rateOptions}</select></label>`:''}
      <label>Adults<input name="adults" type="number" min="0" value="${Number(b?.adults||0)}"></label><label>Kids<input name="kids" type="number" min="0" value="${Number(b?.kids||0)}"></label><label>Babies<input name="babies" type="number" min="0" value="${Number(b?.babies||0)}"></label><label>Senior Count<input name="seniors" type="number" min="0" value="${Number(b?.seniors||0)}"></label><label>PWD Count<input name="pwd" type="number" min="0" value="${Number(b?.pwd||0)}"></label>
      <label>Discount Type<select name="discount_type"><option value="none">No Discount</option><option value="senior">Senior</option><option value="pwd">PWD</option></select></label>
      <label>Discount Mode<select name="discount_mode"><option value="none">No Discount</option><option value="whole_bill">Whole Bill — apply once</option><option value="person_only">One Qualified Person Only</option></select></label>
      <label>Status<select name="status"><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="checked_in">Checked In</option><option value="checked_out">Checked Out</option><option value="cancelled">Cancelled</option><option value="no_show">No Show</option></select></label>
      <label class="full">Notes<textarea name="notes" rows="3">${esc(b?.notes||'')}</textarea></label>
    </form><div id="v23Calc" class="panel" style="margin-top:14px"></div>`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v23SaveBooking">Save Booking</button>`});
  $('[data-modal-cancel]').onclick=closeModal;const f=$('#v23BookingForm');if(b){f.elements.status.value=b.status||'pending';f.elements.discount_type.value=b.discount_type||'none';f.elements.discount_mode.value=b.discount_mode||'none';}if(b&&$('#v23ShowCode'))$('#v23ShowCode').onclick=()=>openCodesModal(b);
  const recalc=()=>{const d=Object.fromEntries(new FormData(f).entries()),ad=Number(d.adults||0),ki=Number(d.kids||0),ba=Number(d.babies||0),se=Number(d.seniors||0),pw=Number(d.pwd||0);let warning='';if(d.discount_type==='senior'&&se<1)warning='Add at least one Senior to use Senior discount.';if(d.discount_type==='pwd'&&pw<1)warning='Add at least one PWD to use PWD discount.';if(isCottage){const c=calcCottageBooking({cottage_id:d.unit_id,tour_rate_id:d.tour_rate_id,adults:ad,kids:ki,babies:ba,discount_type:d.discount_type,discount_mode:d.discount_mode});$('#v23Calc').innerHTML=`<div class="panel-head"><h3>Automatic ${esc(c.tour?.name||'Tour')} Computation</h3></div><div class="report-kpis"><div class="report-kpi"><span>Cottage</span><strong>${money(c.cottage)}</strong></div><div class="report-kpi"><span>Ligo / Entrance</span><strong>${money(c.swim)}</strong></div><div class="report-kpi"><span>Gross Base</span><strong>${money(c.gross)}</strong></div><div class="report-kpi"><span>Discount</span><strong>-${money(c.discount)}</strong></div></div><p><strong>Estimated Net Base: ${money(c.total)}</strong></p><p class="tiny muted">Rates: Adult ${money(c.adultRate)} · Kids ${money(c.kidRate)} · Baby ${c.babyRate===0?'FREE':money(c.babyRate)}. Whole Bill discount is applied once to the running bill, including later eligible charges. Person Only applies once to one qualified adult tour fee.</p>${warning?`<p class="form-message">${esc(warning)}</p>`:''}`;}else{const r=calcRoomBooking({room_id:d.unit_id,check_in_date:d.check_in_date,check_out_date:d.check_out_date,adults:ad,kids:ki,discount_type:d.discount_type,discount_mode:d.discount_mode});$('#v23Calc').innerHTML=`<div class="panel-head"><h3>Automatic Room Computation</h3></div><div class="report-kpis"><div class="report-kpi"><span>Nights</span><strong>${r.nights}</strong></div><div class="report-kpi"><span>Room + Extra Pax</span><strong>${money(r.gross)}</strong></div><div class="report-kpi"><span>Discount</span><strong>-${money(r.discount)}</strong></div><div class="report-kpi"><span>Estimated Net</span><strong>${money(r.total)}</strong></div></div><p class="tiny muted">For Person Only discount on a room booking, the system uses one equal share of the room base among chargeable guests. Whole Bill applies the selected percentage once to the running bill.</p>${warning?`<p class="form-message">${esc(warning)}</p>`:''}`;}};
  ['change','input'].forEach(ev=>f.addEventListener(ev,recalc));recalc();
  $('#v23SaveBooking').onclick=async()=>{const d=Object.fromEntries(new FormData(f).entries()),adults=Number(d.adults||0),kids=Number(d.kids||0),babies=Number(d.babies||0),seniors=Number(d.seniors||0),pwd=Number(d.pwd||0);if(!String(d.guest_name||'').trim())return toast('Guest / client name is required.','error');if(!d.unit_id)return toast(`Select a ${isCottage?'cottage':'room'}.`,'error');if(isCottage&&!d.tour_rate_id)return toast('Select Day Tour or Night Tour rate.','error');if(seniors+pwd>adults)return toast('Senior + PWD cannot be greater than Adults.','error');if(d.discount_type==='senior'&&seniors<1)return toast('Senior discount requires at least one Senior.','error');if(d.discount_type==='pwd'&&pwd<1)return toast('PWD discount requires at least one PWD.','error');if(d.discount_type==='none')d.discount_mode='none';if(d.discount_mode==='none')d.discount_type='none';const payload={booking_type:type,guest_name:String(d.guest_name).trim(),contact_number:d.contact_number||null,booking_date:b?.booking_date||today(),check_in_date:d.check_in_date,check_out_date:d.check_out_date,adults,kids,babies,seniors,pwd,status:d.status||'pending',discount_type:d.discount_type||'none',discount_mode:d.discount_mode||'none',notes:d.notes||null};if(isCottage){payload.cottage_id=d.unit_id;payload.room_id=null;payload.tour_rate_id=d.tour_rate_id;}else{payload.room_id=d.unit_id;payload.cottage_id=null;payload.tour_rate_id=null;}const res=id?await sb.from('bookings').update(payload).eq('id',id).select().single():await sb.from('bookings').insert({...payload,created_by:state.session.user.id}).select().single();if(res.error)return toast(res.error.message,'error');closeModal();await refreshOperations();const saved=state.cache.bookings.find(x=>x.id===res.data.id)||res.data;toast(`${isCottage?'Cottage + Swimming':'Room'} booking saved as ${saved.booking_number}.`);renderBookingTypePage(type);if(!id)setTimeout(()=>openCodesModal(saved),80);};
};

// Running account now explicitly shows Gross -> Booking Discount -> Net -> Payments -> Balance.
bookingAccountTotals = function(b){
  const charges=bookingCharges(b.id).reduce((s,x)=>s+Number(x.amount||0)-Number(x.discount_amount||0),0);
  const payments=bookingPayments(b.id).reduce((s,x)=>s+Number(x.amount||0),0);
  const base=Number(b.base_amount||0),gross=Number(b.gross_amount ?? (base+charges));
  const discount=Number(b.discount_amount||0),total=Number(b.total_amount ?? Math.max(0,gross-discount)),balance=Math.max(0,total-payments);
  return {base,charges,gross,discount,payments,total,balance};
};

openCottageAccount = async function(bookingId,paxId=null){
  await refreshOperations();const b=state.cache.bookings.find(x=>x.id===bookingId);if(!b)return;const pax=bookingPax(b.id),charges=bookingCharges(b.id),payments=bookingPayments(b.id),t=bookingAccountTotals(b);const assigned=(paxId?state.cache.pax.find(x=>x.id===paxId)?.assigned_cottage_id:null)||b.cottage_id;const unit=b.booking_type==='room'?roomById(b.room_id):cottageById(assigned);
  openModal({title:unit?.name||unit?.unit_number||'Booking Account',eyebrow:`RUNNING ACCOUNT · ${b.booking_number}`,wide:true,body:`<div class="report-kpis"><div class="report-kpi"><span>Gross Bill</span><strong>${money(t.gross)}</strong></div><div class="report-kpi"><span>${esc(discountLabel(b))}</span><strong>-${money(t.discount)}</strong></div><div class="report-kpi"><span>Net Total</span><strong>${money(t.total)}</strong></div><div class="report-kpi"><span>Balance</span><strong>${money(t.balance)}</strong></div></div><div class="panel"><p><strong>Base Booking:</strong> ${money(t.base)} · <strong>Additional Charges:</strong> ${money(t.charges)} · <strong>Paid:</strong> ${money(t.payments)}</p><p class="tiny muted">${esc(discountLabel(b))}. The database recalculates this account whenever a service, POS item or payment is posted.</p></div><div class="dashboard-grid" style="margin-top:14px"><div class="panel"><div class="panel-head"><h3>Charges</h3></div>${charges.length?charges.map(x=>`<div class="list-item"><div><strong>${esc(x.description||x.charge_type)}</strong><small>${fmtDate(x.charge_date)} · ${x.quantity||1} × ${money(x.unit_price||0)}</small></div><strong>${money(Number(x.amount||0)-Number(x.discount_amount||0))}</strong></div>`).join(''):'<div class="empty-state">No additional charges.</div>'}</div><div class="panel"><div class="panel-head"><h3>Payments</h3></div>${payments.length?payments.map(x=>`<div class="list-item"><div><strong>${esc(x.method||'Payment')}</strong><small>${fmtDate(x.payment_date)} · ${esc(x.reference_number||'')}</small></div><strong>${money(x.amount)}</strong></div>`).join(''):'<div class="empty-state">No payments yet.</div>'}</div></div>`,footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-soft" id="accountAddCharge">Add Charge</button><button class="btn btn-soft" id="accountPOS">Store / POS</button><button class="btn btn-primary" id="accountPayment">Add Payment</button>`});
  $('[data-modal-cancel]').onclick=closeModal;$('#accountAddCharge').onclick=()=>openServiceChargeModal(b);$('#accountPOS').onclick=()=>{closeModal();state.activePosBooking=b;renderPOS();navigate('pos');};$('#accountPayment').onclick=()=>openPaymentModal(b);
};

openPaymentModal = function(b){
  const t=bookingAccountTotals(b);openModal({title:'Add Payment',eyebrow:`${b.booking_number} · ${b.guest_name||'Guest'}`,body:`<div class="report-kpis"><div class="report-kpi"><span>Gross</span><strong>${money(t.gross)}</strong></div><div class="report-kpi"><span>Discount</span><strong>-${money(t.discount)}</strong></div><div class="report-kpi"><span>Net Total</span><strong>${money(t.total)}</strong></div><div class="report-kpi"><span>Balance</span><strong>${money(t.balance)}</strong></div></div><form id="paymentForm" class="modal-form"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" max="${t.balance||999999}" required></label><label>Method<select name="method"><option>Cash</option><option>GCash</option><option>Maya</option><option>Bank Transfer</option><option>Card</option><option>Other</option></select></label><label>Reference Number<input name="reference_number"></label><label class="full">Notes<textarea name="notes" rows="2"></textarea></label></form>`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="savePaymentBtn">Save Payment</button>`});$('[data-modal-cancel]').onclick=closeModal;$('#savePaymentBtn').onclick=async()=>{const fd=new FormData($('#paymentForm')),amount=Number(fd.get('amount')||0);if(amount<=0)return toast('Enter a valid payment amount.','error');if(amount>t.balance+0.001)return toast('Payment cannot be greater than the current balance.','error');const {error}=await sb.from('payments').insert({booking_id:b.id,payment_date:today(),amount,method:fd.get('method'),reference_number:fd.get('reference_number')||null,notes:fd.get('notes')||null,created_by:state.session.user.id});if(error)return toast(error.message,'error');closeModal();await refreshOperations();toast('Payment saved and all connected balances were updated.');if(state.currentView==='payments')renderModule('payments');};
};

// Fill Settings using current values; Day/Night prices are no longer duplicated there.
const v23ApplyBase = applyBrand;
applyBrand = function(){
  v23ApplyBase();
  const r=$('#rulesSettingsForm');if(r){['adult_age','child_age','baby_age_max','senior_discount','pwd_discount'].forEach(k=>{if(r.elements[k])r.elements[k].value=state.settings[k]??0});}
};

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v25.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V2.5
   ROOM CHECK-IN / CHECK-OUT TIME POLICY
   Default: 2:00 PM check-in, 11:00 AM check-out, PHP150/started hour
   ============================================================ */

function v25TimeSetting(key,fallback){
  let v=String(state.settings?.[key] ?? fallback ?? '');
  if(v.length>=5)return v.slice(0,5);
  return fallback;
}
function v25MoneySetting(key,fallback){ return Number(state.settings?.[key] ?? fallback ?? 0); }
function v25LocalDateTime(dateStr,timeStr){
  const t=(timeStr||'00:00').slice(0,5);
  return new Date(`${dateStr}T${t}:00`);
}
function v25StartedHours(ms){
  if(ms<=0)return 0;
  return Math.max(1,Math.ceil(ms/3600000));
}
function v25FormatClock(d){
  return d.toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit'});
}
function v25FormatDateTime(d){
  return d.toLocaleString('en-PH',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
function v25IsRoomBooking(b){ return b && (b.booking_type==='room' || !!b.room_id); }

function v25RoomCheckinAssessment(b,now=new Date()){
  const checkInTime=v25TimeSetting('room_check_in_time','14:00');
  const checkOutTime=v25TimeSetting('room_check_out_time','11:00');
  const hourly=v25MoneySetting('early_late_hourly_fee',150);
  if(!b?.check_in_date)return {kind:'invalid',allowed:false,label:'Missing check-in date',fee:0};

  const scheduled=v25LocalDateTime(b.check_in_date,checkInTime);
  const finalCheckout=v25LocalDateTime(b.check_out_date||b.check_in_date,checkOutTime);

  const nowDate=isoDate(now);
  if(nowDate < b.check_in_date){
    return {kind:'too_early',allowed:false,label:'Not Yet Allowed',fee:0,scheduled,finalCheckout,
      message:`Check-in is scheduled on ${fmtDate(b.check_in_date)} at ${v25FormatClock(scheduled)}.`};
  }
  if(now > finalCheckout){
    return {kind:'expired',allowed:false,label:'Booking Check-in Window Expired',fee:0,scheduled,finalCheckout,
      message:`The scheduled check-out time (${v25FormatDateTime(finalCheckout)}) has already passed.`};
  }
  if(now < scheduled){
    const hours=v25StartedHours(scheduled-now), fee=hours*hourly;
    return {kind:'early',allowed:true,label:'Early Check-in',hours,fee,scheduled,finalCheckout,
      message:`Guest is ${hours} started hour${hours>1?'s':''} early. Early check-in fee: ${money(fee)}.`};
  }

  const lateMs=now-scheduled;
  // Any arrival after scheduled check-in is recorded as late arrival; no late-arrival fee.
  if(lateMs>60000){
    return {kind:'late_arrival',allowed:true,label:'Late Arrival',fee:0,scheduled,finalCheckout,
      hoursLate:Math.floor(lateMs/3600000),
      message:`Scheduled check-in was ${v25FormatClock(scheduled)}. Guest is arriving after the scheduled check-in time. No late-arrival fee is added.`};
  }

  return {kind:'on_time',allowed:true,label:'On-time Check-in',fee:0,scheduled,finalCheckout,
    message:`Guest may check in now. Scheduled check-in is ${v25FormatClock(scheduled)}.`};
}

function v25RoomCheckoutAssessment(b,now=new Date()){
  const checkOutTime=v25TimeSetting('room_check_out_time','11:00');
  const hourly=v25MoneySetting('early_late_hourly_fee',150);
  const scheduled=v25LocalDateTime(b.check_out_date||b.check_in_date,checkOutTime);

  if(now<=scheduled){
    return {kind:'on_time',label:'On-time / Early Check-out',hours:0,fee:0,scheduled,
      message:`No late check-out fee. Scheduled check-out is ${v25FormatClock(scheduled)}.`};
  }
  const hours=v25StartedHours(now-scheduled),fee=hours*hourly;
  return {kind:'late',label:'Late Check-out',hours,fee,scheduled,
    message:`Guest is ${hours} started hour${hours>1?'s':''} late. Late check-out fee: ${money(fee)}.`};
}

async function v25EnsureTimingCharge(b,type,amount,hours){
  amount=Number(amount||0);
  if(amount<=0)return {added:false};
  const chargeType=type==='early'?'early_checkin':'late_checkout';
  const {data:existing,error:findErr}=await sb.from('charges')
    .select('id,amount,is_void')
    .eq('booking_id',b.id).eq('charge_type',chargeType).eq('is_void',false)
    .maybeSingle();
  if(findErr && findErr.code!=='PGRST116') return {error:findErr};
  if(existing)return {added:false,existing};

  const label=type==='early'?'Early Check-in Fee':'Late Check-out Fee';
  const rate=v25MoneySetting('early_late_hourly_fee',150);
  const {error}=await sb.from('charges').insert({
    booking_id:b.id,
    charge_date:today(),
    charge_type:chargeType,
    description:`${label} · ${hours} started hour${hours>1?'s':''} × ${money(rate)}`,
    quantity:hours,
    unit_price:rate,
    amount,
    discount_amount:0,
    notes:'Automatically computed from Room time policy.',
    created_by:state.session.user.id
  });
  return {added:!error,error};
}

function v25TimingBadge(a){
  const cls=a.kind==='early'||a.kind==='late'||a.kind==='late_arrival'?'badge':'badge';
  return `<span class="${cls}">${esc(a.label)}</span>`;
}

/* Fill the new settings controls with database values. */
const v25ApplyBrandBase=applyBrand;
applyBrand=function(){
  v25ApplyBrandBase();
  const f=$('#rulesSettingsForm');
  if(!f)return;
  if(f.elements.room_check_in_time) f.elements.room_check_in_time.value=v25TimeSetting('room_check_in_time','14:00');
  if(f.elements.room_check_out_time) f.elements.room_check_out_time.value=v25TimeSetting('room_check_out_time','11:00');
  if(f.elements.early_late_hourly_fee) f.elements.early_late_hourly_fee.value=v25MoneySetting('early_late_hourly_fee',150);
};

/* app.js stores every rulesSettingsForm field as Number().
   Override just this form because time values must remain strings. */
const v25RulesForm=$('#rulesSettingsForm');
if(v25RulesForm){
  v25RulesForm.onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    const payload={
      id:1,
      adult_age:Number(fd.get('adult_age')||13),
      child_age:Number(fd.get('child_age')||4),
      baby_age_max:Number(fd.get('baby_age_max')||3),
      senior_discount:Number(fd.get('senior_discount')||0),
      pwd_discount:Number(fd.get('pwd_discount')||0),
      room_check_in_time:String(fd.get('room_check_in_time')||'14:00'),
      room_check_out_time:String(fd.get('room_check_out_time')||'11:00'),
      early_late_hourly_fee:Number(fd.get('early_late_hourly_fee')||150)
    };
    const {error}=await sb.from('system_settings').upsert(payload,{onConflict:'id'});
    if(error)return toast(error.message,'error');
    state.settings={...state.settings,...payload};
    toast('Guest, discount and room time policies saved.');
  };
}

/* Correct V2.4 first ROOM pax scan and add time-policy assessment. */
openFirstRoomEntryV24 = function(p,b){
  const room=roomById(b.room_id);
  if(!room){
    openModal({
      title:'Room Not Assigned',eyebrow:'CHECK-IN BLOCKED',
      body:`<p>This Room Booking has no room selected. Edit the booking first and assign a room.</p>`,
      footer:`<button class="btn btn-primary" data-modal-cancel>Close</button>`
    });
    $('[data-modal-cancel]').onclick=closeModal;
    return;
  }

  const firstBookingEntry=!b.actual_check_in_at;
  const a=firstBookingEntry?v25RoomCheckinAssessment(b):{
    kind:'additional_pax',allowed:true,label:'Additional Pax Check-in',fee:0,
    message:'The Room Booking is already checked in. This pax may be checked in to the assigned room.'
  };

  openModal({
    title:a.allowed?'Confirm Room Check-In':'Room Check-In Not Allowed',
    eyebrow:a.label.toUpperCase(),
    body:`
      <div class="report-kpis">
        <div class="report-kpi"><span>Pax</span><strong>${esc(paxDisplayName(p))}</strong></div>
        <div class="report-kpi"><span>Room</span><strong>${esc(room.name||room.unit_number)}</strong></div>
        <div class="report-kpi"><span>Booking</span><strong>${esc(b.booking_number)}</strong></div>
        <div class="report-kpi"><span>Timing</span><strong>${esc(a.label)}</strong></div>
      </div>
      <div class="panel">
        <p>${esc(a.message||'')}</p>
        ${a.scheduled?`<p class="tiny muted">Scheduled check-in: ${v25FormatDateTime(a.scheduled)}</p>`:''}
        ${a.fee>0?`<p><strong>Additional Early Check-in Fee: ${money(a.fee)}</strong></p><p class="tiny muted">${a.hours} started hour${a.hours>1?'s':''} × ${money(v25MoneySetting('early_late_hourly_fee',150))}/hour</p>`:''}
      </div>`,
    footer:a.allowed
      ? `<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v25ConfirmRoomCheckin">${a.fee>0?'Add Fee & Check In':'Check In'}</button>`
      : `<button class="btn btn-primary" data-modal-cancel>Close</button>`
  });
  $('[data-modal-cancel]').onclick=closeModal;
  if(!a.allowed)return;

  $('#v25ConfirmRoomCheckin').onclick=async()=>{
    const now=new Date(),nowIso=now.toISOString();

    if(firstBookingEntry && a.fee>0){
      const feeRes=await v25EnsureTimingCharge(b,'early',a.fee,a.hours);
      if(feeRes.error)return toast(feeRes.error.message,'error');
    }

    const {error}=await sb.from('booking_pax').update({
      assigned_room_id:b.room_id,assigned_cottage_id:null,
      access_status:'inside',first_check_in_at:p.first_check_in_at||nowIso,last_return_at:nowIso
    }).eq('id',p.id);
    if(error)return toast(error.message,'error');

    await sb.from('access_logs').insert({
      booking_id:b.id,pax_id:p.id,room_id:b.room_id,cottage_id:null,
      action:'check_in',scanned_code:p.code,performed_by:state.session.user.id
    });

    const bookingPatch={status:'checked_in'};
    if(firstBookingEntry){
      bookingPatch.actual_check_in_at=nowIso;
      bookingPatch.checkin_timing_status=a.kind;
      bookingPatch.early_checkin_fee=Number(a.fee||0);
    }
    await sb.from('bookings').update(bookingPatch).eq('id',b.id);

    closeModal();await refreshOperations();
    toast(a.fee>0?`${paxDisplayName(p)} checked in. ${money(a.fee)} early check-in fee added.`:`${paxDisplayName(p)} checked in to ${room.name||room.unit_number}.`);
    handlePaxScanV24(state.cache.pax.find(x=>x.id===p.id));
  };
};

/* Booking-level time status modal from a scanned Booking Code. */
function v25OpenRoomTimingStatus(b){
  const checkin=b.actual_check_in_at?null:v25RoomCheckinAssessment(b);
  const checkout=b.actual_check_in_at&&b.status!=='checked_out'?v25RoomCheckoutAssessment(b):null;
  openModal({
    title:'Room Time Status',
    eyebrow:b.booking_number,
    body:`<div class="panel">
      <p><strong>Check-in:</strong> ${v25TimeSetting('room_check_in_time','14:00')}</p>
      <p><strong>Check-out:</strong> ${v25TimeSetting('room_check_out_time','11:00')} on final booking day</p>
      <p><strong>Early/Late Fee:</strong> ${money(v25MoneySetting('early_late_hourly_fee',150))} per started hour</p>
    </div>
    ${checkin?`<div class="panel" style="margin-top:12px"><h3>${esc(checkin.label)}</h3><p>${esc(checkin.message)}</p>${checkin.fee?`<strong>${money(checkin.fee)}</strong>`:''}</div>`:''}
    ${checkout?`<div class="panel" style="margin-top:12px"><h3>${esc(checkout.label)}</h3><p>${esc(checkout.message)}</p>${checkout.fee?`<strong>${money(checkout.fee)}</strong>`:''}</div>`:''}
    ${b.actual_check_in_at?`<p class="tiny muted">Actual check-in: ${new Date(b.actual_check_in_at).toLocaleString('en-PH')}</p>`:''}
    ${b.actual_check_out_at?`<p class="tiny muted">Actual check-out: ${new Date(b.actual_check_out_at).toLocaleString('en-PH')}</p>`:''}`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Close</button>${b.status==='checked_in'?`<button class="btn btn-primary" id="v25TimingCheckoutBtn">Check Out Room</button>`:''}`
  });
  $('[data-modal-cancel]').onclick=closeModal;
  if($('#v25TimingCheckoutBtn'))$('#v25TimingCheckoutBtn').onclick=()=>v25OpenRoomCheckout(b);
}

/* Checkout calculation + automatic late fee. */
async function v25OpenRoomCheckout(b){
  await refreshOperations();
  b=state.cache.bookings.find(x=>x.id===b.id)||b;
  const room=roomById(b.room_id),a=v25RoomCheckoutAssessment(b);
  const totals=bookingAccountTotals(b);

  openModal({
    title:'Room Check-Out',
    eyebrow:a.label.toUpperCase(),
    body:`<div class="report-kpis">
      <div class="report-kpi"><span>Room</span><strong>${esc(room?.name||room?.unit_number||'—')}</strong></div>
      <div class="report-kpi"><span>Scheduled</span><strong>${v25FormatClock(a.scheduled)}</strong></div>
      <div class="report-kpi"><span>Timing</span><strong>${esc(a.label)}</strong></div>
      <div class="report-kpi"><span>Current Balance</span><strong>${money(totals.balance)}</strong></div>
    </div>
    <div class="panel">
      <p>${esc(a.message)}</p>
      ${a.fee>0?`<p><strong>Late Check-out Fee to Add: ${money(a.fee)}</strong></p><p class="tiny muted">${a.hours} started hour${a.hours>1?'s':''} × ${money(v25MoneySetting('early_late_hourly_fee',150))}/hour</p>`:''}
      ${totals.balance>0?`<p class="form-message"><strong>Note:</strong> This booking currently has an unpaid balance of ${money(totals.balance)} before any new late fee.</p>`:''}
    </div>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v25ConfirmCheckout">${a.fee>0?'Add Fee & Check Out':'Confirm Check-Out'}</button>`
  });
  $('[data-modal-cancel]').onclick=closeModal;
  $('#v25ConfirmCheckout').onclick=async()=>{
    if(a.fee>0){
      const feeRes=await v25EnsureTimingCharge(b,'late',a.fee,a.hours);
      if(feeRes.error)return toast(feeRes.error.message,'error');
    }
    const nowIso=new Date().toISOString();

    const {error}=await sb.from('bookings').update({
      status:'checked_out',
      actual_check_out_at:nowIso,
      checkout_timing_status:a.kind,
      late_checkout_fee:Number(a.fee||0)
    }).eq('id',b.id);
    if(error)return toast(error.message,'error');

    // Mark all active pax as checked out.
    await sb.from('booking_pax').update({access_status:'checked_out'}).eq('booking_id',b.id).neq('access_status','cancelled');

    await writeAudit('check_out','bookings',b.id,`${a.label}; fee ${Number(a.fee||0)}`);
    closeModal();await refreshOperations();
    toast(a.fee>0?`Room checked out. ${money(a.fee)} late check-out fee added.`:'Room checked out on time.');
    if(state.currentView==='room-bookings')renderBookingTypePage('room');
  };
}

/* Add Check Out button to Room Booking list after V2.3 renders it. */
const v25RenderBookingTypeBase=renderBookingTypePage;
renderBookingTypePage=async function(type){
  await v25RenderBookingTypeBase(type);
  if(type!=='room')return;

  $$('[data-v23-view]').forEach(viewBtn=>{
    const id=viewBtn.dataset.v23View;
    const b=state.cache.bookings.find(x=>x.id===id);
    const actions=viewBtn.closest('.row-actions');
    if(!actions||!b)return;

    // Timing status button
    if(!actions.querySelector(`[data-v25-time="${id}"]`)){
      const t=document.createElement('button');
      t.dataset.v25Time=id;t.textContent='Time Status';
      actions.appendChild(t);
      t.onclick=()=>v25OpenRoomTimingStatus(b);
    }
    if(b.status==='checked_in'&&!actions.querySelector(`[data-v25-checkout="${id}"]`)){
      const c=document.createElement('button');
      c.dataset.v25Checkout=id;c.textContent='Check Out';
      actions.appendChild(c);
      c.onclick=()=>v25OpenRoomCheckout(b);
    }
  });
};

/* Re-apply Pax Manager + Room Time controls after V2.3 overwrote openRecord/openBookingV21. */
const v25OpenRecordBase=openRecord;
openRecord=async function(name,id,edit=false){
  const result=await v25OpenRecordBase(name,id,edit);
  if(name==='bookings'&&id){
    const b=state.cache.bookings.find(x=>x.id===id);
    setTimeout(()=>{
      const footer=$('#modalFooter');if(!footer||!b)return;

      if(!footer.querySelector('[data-v24-pax-manager]')){
        const p=document.createElement('button');
        p.className='btn btn-soft';p.type='button';p.dataset.v24PaxManager=b.id;p.textContent='Pax / Companion Codes';
        p.onclick=()=>openPaxManagerV24(b);
        footer.insertBefore(p,footer.firstChild);
      }
      if(v25IsRoomBooking(b)&&!footer.querySelector('[data-v25-room-time]')){
        const t=document.createElement('button');
        t.className='btn btn-soft';t.type='button';t.dataset.v25RoomTime=b.id;t.textContent='Room Time Status';
        t.onclick=()=>v25OpenRoomTimingStatus(b);
        footer.insertBefore(t,footer.firstChild);
      }
      if(v25IsRoomBooking(b)&&b.status==='checked_in'&&!footer.querySelector('[data-v25-room-checkout]')){
        const c=document.createElement('button');
        c.className='btn btn-primary';c.type='button';c.dataset.v25RoomCheckout=b.id;c.textContent='Check Out Room';
        c.onclick=()=>v25OpenRoomCheckout(b);
        footer.appendChild(c);
      }
    },30);
  }
  return result;
};

const v25OpenBookingBase=openBookingV21;
openBookingV21=async function(type,id=null){
  const result=await v25OpenBookingBase(type,id);
  if(id){
    const b=state.cache.bookings.find(x=>x.id===id);
    setTimeout(()=>{
      const footer=$('#modalFooter');if(!footer||!b)return;
      if(!footer.querySelector('[data-v24-pax-manager]')){
        const p=document.createElement('button');
        p.className='btn btn-soft';p.type='button';p.dataset.v24PaxManager=b.id;p.textContent='Pax / Companion Codes';
        p.onclick=()=>openPaxManagerV24(b);
        footer.insertBefore(p,footer.firstChild);
      }
      if(type==='room'&&!footer.querySelector('[data-v25-room-time]')){
        const t=document.createElement('button');
        t.className='btn btn-soft';t.type='button';t.dataset.v25RoomTime=b.id;t.textContent='Room Time Status';
        t.onclick=()=>v25OpenRoomTimingStatus(b);
        footer.insertBefore(t,footer.firstChild);
      }
    },30);
  }
  return result;
};

/* Enhance scanned Booking result with Room timing information. */
const v25OpenBookingScanBase=openBookingScanResult;
openBookingScanResult=function(b){
  v25OpenBookingScanBase(b);
  if(!v25IsRoomBooking(b))return;
  setTimeout(()=>{
    const panel=$('#barcodeResult .panel');
    if(!panel)return;
    const a=b.actual_check_in_at?v25RoomCheckoutAssessment(b):v25RoomCheckinAssessment(b);
    const box=document.createElement('div');
    box.className='panel';
    box.style.marginTop='12px';
    box.innerHTML=`<div class="panel-head"><h3>Room Time Status</h3><button class="btn btn-soft" id="v25ScanTimeDetails">View Details</button></div>
      <p><strong>${esc(a.label)}</strong></p><p class="muted">${esc(a.message||'')}</p>`;
    $('#barcodeResult').appendChild(box);
    $('#v25ScanTimeDetails').onclick=()=>v25OpenRoomTimingStatus(b);
  },20);
};

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v27.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V2.7
   SAVE BOOKING BARCODE / QR AS IMAGE (CLIENT-READY PNG)
   ============================================================ */

function v27UnitLabel(b){
  if(!b) return '—';
  if((b.booking_type||'')==='room' || b.room_id){
    const r=roomById(b.room_id);
    return r ? (r.name||r.unit_number||'Room') : 'Room';
  }
  const c=cottageById(b.cottage_id);
  return c ? (c.name||c.unit_number||'Cottage') : 'Cottage';
}
function v27BookingTypeLabel(b){
  return ((b.booking_type||'')==='room' || b.room_id) ? 'Room Booking' : 'Cottage + Swimming Booking';
}
function v27FilenameSafe(v){
  return String(v||'booking').replace(/[^a-z0-9-_]+/gi,'_').replace(/^_+|_+$/g,'');
}
function v27LoadImage(src){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.crossOrigin='anonymous';
    img.onload=()=>resolve(img);
    img.onerror=reject;
    img.src=src;
  });
}
function v27GetQrDataUrl(){
  const holder=$('#bookingQr');
  if(!holder) return null;
  const img=holder.querySelector('img');
  if(img?.src) return img.src;
  const canvas=holder.querySelector('canvas');
  try{ if(canvas) return canvas.toDataURL('image/png'); }catch(e){}
  return null;
}
function v27GetBarcodeSvgDataUrl(){
  const svg=$('#bookingBarcode');
  if(!svg) return null;
  try{
    const copy=svg.cloneNode(true);
    copy.setAttribute('xmlns','http://www.w3.org/2000/svg');
    const textNodes=copy.querySelectorAll('text');
    textNodes.forEach(t=>{ if(!t.getAttribute('font-size')) t.setAttribute('font-size','18'); if(!t.getAttribute('font-family')) t.setAttribute('font-family','Arial, sans-serif'); });
    const xml=new XMLSerializer().serializeToString(copy);
    return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(xml);
  }catch(e){ return null; }
}
function v27DownloadCanvas(canvas, filename){
  const link=document.createElement('a');
  link.download=filename;
  link.href=canvas.toDataURL('image/png');
  document.body.appendChild(link);
  link.click();
  link.remove();
}
async function v27SaveBookingCodeImage(b){
  if(!b) return;
  const scanCode=b.booking_code||b.barcode||b.booking_number;
  const qrUrl=v27GetQrDataUrl();
  const barcodeUrl=v27GetBarcodeSvgDataUrl();
  if(!qrUrl || !barcodeUrl){
    toast('Barcode / QR preview is not ready yet. Please open the Barcode / QR modal again and wait a moment.','error');
    return;
  }

  const resortName=state.settings?.resort_name || (window.MASUSI_CONFIG?.DEFAULT_RESORT_NAME) || 'Masusi Farm Resort';
  const unitLabel=v27UnitLabel(b);
  const typeLabel=v27BookingTypeLabel(b);
  const checkIn=b.check_in_date ? fmtDate(b.check_in_date) : '—';
  const checkOut=b.check_out_date ? fmtDate(b.check_out_date) : null;
  const guest=b.guest_name || 'Guest';
  const filename=`${v27FilenameSafe(b.booking_number||scanCode)}_barcode.png`;

  try{
    const [qrImg, barcodeImg] = await Promise.all([v27LoadImage(qrUrl), v27LoadImage(barcodeUrl)]);
    let logoImg=null;
    try{
      if(state.settings?.logo_url){ logoImg=await v27LoadImage(state.settings.logo_url); }
      else{ logoImg=await v27LoadImage('assets/logo-placeholder.svg'); }
    }catch(e){ logoImg=null; }

    const canvas=document.createElement('canvas');
    canvas.width=1200;
    canvas.height=900;
    const ctx=canvas.getContext('2d');

    // background
    ctx.fillStyle='#f5f7fb';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // outer card shadow block
    ctx.fillStyle='rgba(12, 41, 61, 0.08)';
    roundRect(ctx,52,52,1096,796,26,true,false);
    ctx.fillStyle='#ffffff';
    roundRect(ctx,40,40,1096,796,26,true,false);

    // top accent
    ctx.fillStyle='#0f6a4d';
    roundRect(ctx,40,40,1096,120,26,true,false);
    ctx.fillStyle='#ffffff';

    // logo
    if(logoImg){
      try{ ctx.drawImage(logoImg,72,64,72,72); }catch(e){}
    }
    ctx.font='700 34px Arial';
    ctx.fillText(resortName,160,92);
    ctx.font='500 18px Arial';
    ctx.fillText('Client Booking Barcode / QR',160,122);

    // left info panel
    ctx.fillStyle='#eef5f1';
    roundRect(ctx,72,188,448,568,18,true,false);
    ctx.fillStyle='#0f172a';
    ctx.font='700 18px Arial';
    ctx.fillText('BOOKING DETAILS',96,226);

    const rows=[
      ['Booking Number', b.booking_number || '—'],
      ['Booking Code', scanCode],
      ['Booking Type', typeLabel],
      ['Guest / Client', guest],
      [((b.booking_type||'')==='room' || b.room_id)?'Room':'Cottage', unitLabel],
      ['Check-in Date', checkIn],
      ['Check-out Date', checkOut || '—']
    ];
    let y=272;
    rows.forEach(([label,val])=>{
      ctx.fillStyle='#475569';
      ctx.font='600 15px Arial';
      ctx.fillText(label,96,y);
      y+=26;
      ctx.fillStyle='#0f172a';
      ctx.font='700 24px Arial';
      wrapText(ctx,String(val||'—'),96,y,390,30);
      y+=58;
    });

    // right content area
    ctx.fillStyle='#ffffff';
    ctx.strokeStyle='#d9e4da';
    roundRect(ctx,558,188,540,568,18,true,true);

    // qr block
    ctx.fillStyle='#ffffff';
    roundRect(ctx,594,228,220,220,16,true,true);
    ctx.drawImage(qrImg,614,248,180,180);
    ctx.fillStyle='#0f172a';
    ctx.font='700 16px Arial';
    ctx.fillText('QR CODE',664,474);

    // barcode block
    ctx.fillStyle='#ffffff';
    roundRect(ctx,840,228,220,220,16,true,true);
    fitImage(ctx, barcodeImg, 856, 292, 188, 84);
    ctx.fillStyle='#0f172a';
    ctx.font='700 16px Arial';
    ctx.fillText('BARCODE',910,474);

    // reminder panel
    ctx.fillStyle='#f8fafc';
    roundRect(ctx,594,516,466,188,16,true,true);
    ctx.fillStyle='#0f172a';
    ctx.font='700 18px Arial';
    ctx.fillText('CLIENT REMINDER',616,548);
    ctx.font='500 18px Arial';
    wrapText(ctx,'Please present this Booking Barcode / QR during payment, check-in, or whenever requested by resort staff.',616,582,420,28);
    ctx.fillStyle='#475569';
    ctx.font='500 16px Arial';
    wrapText(ctx,'Tip: Save this image on your phone and keep the barcode/QR clear and readable.',616,656,420,24);

    // footer
    ctx.fillStyle='#64748b';
    ctx.font='500 14px Arial';
    ctx.fillText('Generated by Masusi Farm Resort Management System',72,810);
    ctx.textAlign='right';
    ctx.fillText(new Date().toLocaleString('en-PH'),1092,810);
    ctx.textAlign='left';

    v27DownloadCanvas(canvas, filename);
    toast('Booking barcode image saved as PNG.');
  }catch(e){
    console.error(e);
    toast('Could not save barcode image. Please try again.','error');
  }
}

function roundRect(ctx,x,y,w,h,r,fill,stroke){
  if (typeof r==='number') r={tl:r,tr:r,br:r,bl:r};
  ctx.beginPath();
  ctx.moveTo(x+r.tl,y);
  ctx.lineTo(x+w-r.tr,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r.tr);
  ctx.lineTo(x+w,y+h-r.br);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r.br,y+h);
  ctx.lineTo(x+r.bl,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r.bl);
  ctx.lineTo(x,y+r.tl);
  ctx.quadraticCurveTo(x,y,x+r.tl,y);
  ctx.closePath();
  if(fill) ctx.fill();
  if(stroke) ctx.stroke();
}
function wrapText(ctx,text,x,y,maxWidth,lineHeight){
  const words=String(text||'').split(/\s+/); let line='';
  for(let n=0;n<words.length;n++){
    const test=line ? line+' '+words[n] : words[n];
    if(ctx.measureText(test).width>maxWidth && line){ ctx.fillText(line,x,y); line=words[n]; y+=lineHeight; }
    else line=test;
  }
  if(line) ctx.fillText(line,x,y);
}
function fitImage(ctx,img,x,y,w,h){
  const ratio=Math.min(w/img.width,h/img.height);
  const iw=img.width*ratio, ih=img.height*ratio;
  const ix=x+(w-iw)/2, iy=y+(h-ih)/2;
  ctx.drawImage(img,ix,iy,iw,ih);
}

// Override V2.1/V2.2 code modal to add Save as Image for client sending.
openCodesModal=function(b){
  if(!b)return;
  const pax=bookingPax(b.id), scanCode=b.booking_code||b.barcode||b.booking_number;
  openModal({title:'Booking Barcode / QR',eyebrow:b.booking_number,wide:true,body:`
    <div class="dashboard-grid">
      <div class="panel">
        <h3>Booking Number</h3>
        <p style="font-size:20px"><strong>${esc(b.booking_number)}</strong></p>
        <p class="tiny muted">Readable reservation reference. Use this for reports, invoice and manual search.</p>
      </div>
      <div class="panel">
        <h3>Booking Scan Code</h3>
        <p style="font-size:20px"><strong>${esc(scanCode)}</strong></p>
        <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:12px">
          <div id="bookingQr" style="background:#fff;padding:8px;border:1px solid var(--line);border-radius:10px"></div>
          <svg id="bookingBarcode" style="max-width:100%"></svg>
        </div>
        <p class="tiny muted">Scan this code for payment, booking lookup and check-in. You can also save this card as a PNG image and send it to the client.</p>
      </div>
    </div>
    <div class="table-panel" style="margin-top:14px">
      <div class="panel-head" style="padding:14px 14px 0"><h3>Pax Codes</h3><span class="muted tiny">${pax.length} pax</span></div>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Pax</th><th>Type</th><th>Pax Code</th><th>Status</th></tr></thead><tbody>
        ${pax.length?autoSortRows('pax',pax).map((p,i)=>`<tr><td><strong>${i+1}</strong></td><td>${esc(paxDisplayName(p))}</td><td>${esc(p.pax_type)}</td><td><strong>${esc(p.code||'NO CODE')}</strong></td><td>${esc(p.access_status)}</td></tr>`).join(''):'<tr><td colspan="5" class="empty-state">Pax codes will appear here after pax records are generated.</td></tr>'}
      </tbody></table></div>
    </div>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-soft" id="copyBookingCodeBtn">Copy Code</button><button class="btn btn-soft" id="saveBookingImageBtn">Save as Image</button><button class="btn btn-primary" id="printCodesBtn">Print Barcode / QR</button>`});
  $('[data-modal-cancel]').onclick=closeModal;
  try{
    new QRCode($('#bookingQr'),{text:scanCode,width:150,height:150});
    JsBarcode('#bookingBarcode',scanCode,{format:'CODE128',displayValue:true,height:64,margin:8});
  }catch(e){ toast('Barcode renderer could not load. Check your internet connection for the barcode libraries.','error'); }
  $('#copyBookingCodeBtn').onclick=async()=>{
    try{await navigator.clipboard.writeText(scanCode);toast('Booking Scan Code copied.');}
    catch{toast(`Booking Scan Code: ${scanCode}`);}
  };
  $('#saveBookingImageBtn').onclick=()=>v27SaveBookingCodeImage(b);
  $('#printCodesBtn').onclick=()=>window.print();
};

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v28.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V2.8
   CAMERA SCANNER + CLIENT/INTERNAL BOOKING IMAGE EXPORT
   ============================================================ */

let v28CameraScanner=null;
let v28CameraRunning=false;

async function v28StopCamera(){
  try{
    if(v28CameraScanner && v28CameraRunning){
      await v28CameraScanner.stop();
      await v28CameraScanner.clear();
    }
  }catch(e){}
  v28CameraRunning=false;
  v28CameraScanner=null;
}

async function v28OpenCameraScanner(){
  if(typeof Html5Qrcode==='undefined'){
    openModal({title:'Camera Scanner Unavailable',eyebrow:'CAMERA SCAN',body:`<p>The camera scanner library did not load. Check your internet connection and reload the page.</p>`,footer:`<button class="btn btn-primary" data-modal-cancel>Close</button>`});
    $('[data-modal-cancel]').onclick=closeModal;
    return;
  }
  openModal({
    title:'Scan with Phone / Tablet Camera',eyebrow:'CAMERA BARCODE / QR',wide:true,
    body:`<div class="panel">
      <p class="muted">Point the rear camera at the client Booking QR/Barcode or Pax code. The system will stop the camera automatically after a successful scan.</p>
      <div id="v28CameraReader" style="width:100%;max-width:720px;margin:0 auto;border-radius:16px;overflow:hidden"></div>
      <p class="tiny muted">Camera access normally requires HTTPS. GitHub Pages is HTTPS, so this works well when the system is published online.</p>
    </div>`,
    footer:`<button class="btn btn-soft" id="v28StopCameraBtn">Close Camera</button>`
  });
  $('#v28StopCameraBtn').onclick=async()=>{await v28StopCamera();closeModal();};
  const oldClose=$('#modalCloseBtn').onclick;
  $('#modalCloseBtn').onclick=async()=>{await v28StopCamera();closeModal();};
  try{
    v28CameraScanner=new Html5Qrcode('v28CameraReader');
    const cameras=await Html5Qrcode.getCameras();
    if(!cameras?.length) throw new Error('No camera detected on this device.');
    const preferred=cameras.find(c=>/back|rear|environment/i.test(c.label)) || cameras[cameras.length-1];
    v28CameraRunning=true;
    await v28CameraScanner.start(
      preferred.id,
      {fps:10,qrbox:{width:280,height:180},aspectRatio:1.777778},
      async decodedText=>{
        const code=String(decodedText||'').trim();
        if(!code)return;
        await v28StopCamera();
        closeModal();
        const input=$('#barcodeInput');
        if(input)input.value=code;
        toast(`Code scanned: ${code}`);
        setTimeout(()=>scanBarcode(),80);
      },
      ()=>{}
    );
  }catch(e){
    console.error(e);
    await v28StopCamera();
    $('#modalBody').innerHTML=`<div class="empty-state"><strong>Unable to open camera</strong><p>${esc(e.message||'Please allow camera access and try again.')}</p><p class="tiny muted">You can still type the code manually or use a Bluetooth/USB scanner.</p></div>`;
  }
}

if($('#cameraScanBtn')) $('#cameraScanBtn').onclick=v28OpenCameraScanner;

function v28BookingImageInfo(b){
  const scanCode=b.booking_code||b.barcode||b.booking_number;
  const resortName=state.settings?.resort_name || window.MASUSI_CONFIG?.DEFAULT_RESORT_NAME || 'Masusi Farm Resort';
  const isRoom=(b.booking_type||'')==='room'||!!b.room_id;
  const unit=v27UnitLabel(b);
  const type=v27BookingTypeLabel(b);
  const checkIn=b.check_in_date?fmtDate(b.check_in_date):'—';
  const checkOut=b.check_out_date?fmtDate(b.check_out_date):'—';
  const totals=typeof bookingAccountTotals==='function' ? bookingAccountTotals(b) : null;
  return {scanCode,resortName,isRoom,unit,type,checkIn,checkOut,totals};
}

async function v28GetCodeImages(){
  const qrUrl=v27GetQrDataUrl(), barcodeUrl=v27GetBarcodeSvgDataUrl();
  if(!qrUrl||!barcodeUrl) throw new Error('Barcode / QR preview is not ready yet.');
  return Promise.all([v27LoadImage(qrUrl),v27LoadImage(barcodeUrl)]);
}

async function v28LoadLogo(){
  try{return await v27LoadImage(state.settings?.logo_url||'assets/logo-placeholder.svg');}catch(e){return null;}
}

async function v28SaveClientImage(b){
  try{
    const info=v28BookingImageInfo(b), [qr,barcode]=await v28GetCodeImages(), logo=await v28LoadLogo();
    const c=document.createElement('canvas'); c.width=1080;c.height=1350; const x=c.getContext('2d');
    x.fillStyle='#f2f7f4';x.fillRect(0,0,c.width,c.height);
    x.fillStyle='#fff';roundRect(x,54,54,972,1242,30,true,false);
    x.fillStyle='#0f6a4d';roundRect(x,54,54,972,180,30,true,false);
    if(logo)try{x.drawImage(logo,90,90,100,100)}catch(e){}
    x.fillStyle='#fff';x.font='700 40px Arial';x.fillText(info.resortName,220,125);
    x.font='500 21px Arial';x.fillText('Booking Pass',220,166);

    x.fillStyle='#0f172a';x.textAlign='center';
    x.font='700 28px Arial';x.fillText('Present this code during check-in or payment',540,300);
    x.font='700 30px Arial';x.fillText(b.booking_number||'—',540,350);
    x.fillStyle='#64748b';x.font='500 18px Arial';x.fillText(info.scanCode,540,382);

    x.fillStyle='#fff';x.strokeStyle='#d5e2da';roundRect(x,220,430,300,300,20,true,true);x.drawImage(qr,250,460,240,240);
    x.fillStyle='#fff';roundRect(x,560,430,300,300,20,true,true);fitImage(x,barcode,590,520,240,100);
    x.fillStyle='#0f172a';x.font='700 18px Arial';x.fillText('QR CODE',370,765);x.fillText('BARCODE',710,765);

    x.textAlign='left';x.fillStyle='#eef5f1';roundRect(x,120,820,840,300,22,true,false);
    const rows=[['Guest / Client',b.guest_name||'Guest'],[info.isRoom?'Room':'Cottage',info.unit],['Booking Type',info.type],['Check-in',info.checkIn],['Check-out',info.checkOut]];
    let y=870;
    rows.forEach(([lab,val])=>{x.fillStyle='#64748b';x.font='600 16px Arial';x.fillText(lab,160,y);x.fillStyle='#0f172a';x.font='700 22px Arial';x.fillText(String(val||'—'),390,y);y+=50;});
    x.fillStyle='#475569';x.font='500 18px Arial';wrapText(x,'Keep this image on your phone and show it to resort staff when requested.',120,1190,840,28);
    x.fillStyle='#64748b';x.font='500 14px Arial';x.textAlign='center';x.fillText('Masusi Farm Resort · Client Copy',540,1260);
    v27DownloadCanvas(c,`${v27FilenameSafe(b.booking_number||info.scanCode)}_CLIENT.png`);
    toast('Client Version saved as PNG.');
  }catch(e){console.error(e);toast(e.message||'Could not save Client Version.','error');}
}

async function v28SaveInternalImage(b){
  try{
    const info=v28BookingImageInfo(b), [qr,barcode]=await v28GetCodeImages(), logo=await v28LoadLogo();
    const pax=autoSortRows('pax',bookingPax(b.id));
    const c=document.createElement('canvas');c.width=1400;c.height=1600;const x=c.getContext('2d');
    x.fillStyle='#eef3f7';x.fillRect(0,0,c.width,c.height);x.fillStyle='#fff';roundRect(x,50,50,1300,1500,28,true,false);
    x.fillStyle='#173f33';roundRect(x,50,50,1300,150,28,true,false);
    if(logo)try{x.drawImage(logo,88,82,86,86)}catch(e){}
    x.fillStyle='#fff';x.font='700 38px Arial';x.fillText(info.resortName,205,110);x.font='500 20px Arial';x.fillText('Internal Booking Barcode / QR',205,148);

    x.fillStyle='#0f172a';x.font='700 24px Arial';x.fillText('BOOKING IDENTIFICATION',90,250);
    const detailRows=[
      ['Booking Number',b.booking_number||'—'],['Booking Scan Code',info.scanCode],['Booking Type',info.type],['Guest',b.guest_name||'—'],
      [info.isRoom?'Room':'Cottage',info.unit],['Check-in',info.checkIn],['Check-out',info.checkOut],['Status',b.status||'—'],['Payment Status',b.payment_status||'—']
    ];
    let y=300;
    detailRows.forEach(([lab,val],i)=>{const col=i%2,row=Math.floor(i/2);const px=90+col*600,py=300+row*78;x.fillStyle='#64748b';x.font='600 15px Arial';x.fillText(lab,px,py);x.fillStyle='#0f172a';x.font='700 22px Arial';wrapText(x,String(val||'—'),px,py+28,520,25);});

    x.fillStyle='#fff';x.strokeStyle='#d7e2dc';roundRect(x,90,720,300,300,18,true,true);x.drawImage(qr,120,750,240,240);
    x.fillStyle='#fff';roundRect(x,430,720,440,300,18,true,true);fitImage(x,barcode,470,820,360,110);

    x.fillStyle='#f7faf8';roundRect(x,910,720,400,300,18,true,false);x.fillStyle='#0f172a';x.font='700 20px Arial';x.fillText('ACCOUNT SUMMARY',940,760);
    if(info.totals){
      const acct=[['Gross',money(info.totals.gross||info.totals.total||0)],['Discount',money(info.totals.discount||0)],['Net Total',money(info.totals.netTotal||info.totals.total||0)],['Paid',money(info.totals.paid||0)],['Balance',money(info.totals.balance||0)]];
      let ay=806;acct.forEach(([l,v])=>{x.fillStyle='#64748b';x.font='600 15px Arial';x.fillText(l,940,ay);x.fillStyle='#0f172a';x.font='700 20px Arial';x.textAlign='right';x.fillText(v,1275,ay);x.textAlign='left';ay+=42;});
    }else{x.fillStyle='#64748b';x.font='500 17px Arial';wrapText(x,'Account totals unavailable in this view.',940,810,320,26);}

    x.fillStyle='#0f172a';x.font='700 22px Arial';x.fillText(`PAX / COMPANIONS (${pax.length})`,90,1090);
    x.fillStyle='#f3f6f4';roundRect(x,90,1120,1220,310,16,true,false);
    const shown=pax.slice(0,10);let py=1160;
    shown.forEach((p,i)=>{x.fillStyle='#0f172a';x.font='700 17px Arial';x.fillText(`${i+1}. ${paxDisplayName(p)}`,120,py);x.fillStyle='#64748b';x.font='500 15px Arial';x.fillText(`${p.pax_type||''} · ${p.code||'NO CODE'} · ${p.access_status||''}`,520,py);py+=28;});
    if(pax.length>10){x.fillStyle='#64748b';x.font='500 15px Arial';x.fillText(`+ ${pax.length-10} more pax not shown on image`,120,py+10);}
    x.fillStyle='#64748b';x.font='500 14px Arial';x.fillText('Internal use only · Contains operational booking details',90,1500);
    v27DownloadCanvas(c,`${v27FilenameSafe(b.booking_number||info.scanCode)}_INTERNAL.png`);
    toast('Internal Version saved as PNG.');
  }catch(e){console.error(e);toast(e.message||'Could not save Internal Version.','error');}
}

// Override the booking code modal again: separate Client/Internal export actions.
openCodesModal=function(b){
  if(!b)return;
  const pax=bookingPax(b.id), scanCode=b.booking_code||b.barcode||b.booking_number;
  openModal({title:'Booking Barcode / QR',eyebrow:b.booking_number,wide:true,body:`
    <div class="dashboard-grid">
      <div class="panel"><h3>Booking Number</h3><p style="font-size:20px"><strong>${esc(b.booking_number)}</strong></p><p class="tiny muted">Readable reservation reference.</p></div>
      <div class="panel"><h3>Booking Scan Code</h3><p style="font-size:20px"><strong>${esc(scanCode)}</strong></p><div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:12px"><div id="bookingQr" style="background:#fff;padding:8px;border:1px solid var(--line);border-radius:10px"></div><svg id="bookingBarcode" style="max-width:100%"></svg></div><p class="tiny muted">Use for payment, booking lookup and check-in.</p></div>
    </div>
    <div class="panel" style="margin-top:14px">
      <h3>Image Export</h3>
      <p class="muted">Client Version is clean and send-ready. Internal Version includes more operational details for staff.</p>
      <div class="row-actions"><button class="btn btn-primary" id="saveClientVersionBtn">Save Client Version</button><button class="btn btn-soft" id="saveInternalVersionBtn">Save Internal Version</button></div>
    </div>
    <div class="table-panel" style="margin-top:14px"><div class="panel-head" style="padding:14px 14px 0"><h3>Pax Codes</h3><span class="muted tiny">${pax.length} pax</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Pax</th><th>Type</th><th>Pax Code</th><th>Status</th></tr></thead><tbody>${pax.length?autoSortRows('pax',pax).map((p,i)=>`<tr><td><strong>${i+1}</strong></td><td>${esc(paxDisplayName(p))}</td><td>${esc(p.pax_type)}</td><td><strong>${esc(p.code||'NO CODE')}</strong></td><td>${esc(p.access_status)}</td></tr>`).join(''):'<tr><td colspan="5" class="empty-state">No pax codes yet.</td></tr>'}</tbody></table></div></div>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-soft" id="copyBookingCodeBtn">Copy Code</button><button class="btn btn-primary" id="printCodesBtn">Print Barcode / QR</button>`});
  $('[data-modal-cancel]').onclick=closeModal;
  try{new QRCode($('#bookingQr'),{text:scanCode,width:150,height:150});JsBarcode('#bookingBarcode',scanCode,{format:'CODE128',displayValue:true,height:64,margin:8});}catch(e){toast('Barcode renderer could not load.','error')}
  $('#copyBookingCodeBtn').onclick=async()=>{try{await navigator.clipboard.writeText(scanCode);toast('Booking Scan Code copied.')}catch{toast(`Booking Scan Code: ${scanCode}`)}};
  $('#saveClientVersionBtn').onclick=()=>v28SaveClientImage(b);
  $('#saveInternalVersionBtn').onclick=()=>v28SaveInternalImage(b);
  $('#printCodesBtn').onclick=()=>window.print();
};

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v29.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V2.9
   ROLES / PAGE ACCESS / SECURE USER MANAGEMENT
   Permissions: view, add, edit, delete, delete_all
   ============================================================ */

const V29_PAGES=[
  ['dashboard','Dashboard'],['live','Live Rooms & Cottages'],['cottage-bookings','Cottage + Swimming Bookings'],
  ['room-bookings','Room Bookings'],['bookings','All Bookings'],['availability','Availability Calendar'],
  ['rooms','Rooms'],['cottages','Cottages'],['guests','Guests'],['barcode','Barcode Scanner'],
  ['pos','Store / POS'],['services','Services Library'],['rates','Rates & Pricing'],['billing','Billing / Charges'],
  ['payments','Payments'],['invoices','Invoices'],['expenses','Expenses'],['damages','Damages'],['repairs','Repairs'],
  ['inventory','Inventory'],['reports','Reports'],['users','Users'],['roles','Roles & Access'],['audit','Audit Logs'],['settings','Settings']
];
const V29_ACTIONS=['view','add','edit','delete','delete_all'];
state.permissions={};state.roles=[];state.rolePermissions=[];

function v29Perm(page,action='view'){
  if(state.profile?.role==='admin')return true;
  return !!state.permissions?.[page]?.[action];
}
function v29PermissionLabel(action){return ({view:'View',add:'Add',edit:'Edit / Update',delete:'Delete',delete_all:'Delete All'})[action]||action;}
function v29PageLabel(page){return V29_PAGES.find(x=>x[0]===page)?.[1]||page;}

async function v29LoadAccess(){
  if(!state.session?.user?.id)return;
  const {data:profile}=await sb.from('profiles').select('*,roles(id,name,code,is_system)').eq('id',state.session.user.id).maybeSingle();
  if(profile){state.profile={...state.profile,...profile};}
  let roleId=state.profile?.role_id||state.profile?.roles?.id||null;
  let perms=[];
  if(roleId){
    const {data}=await sb.from('role_permissions').select('*').eq('role_id',roleId);perms=data||[];
  }
  state.permissions={};
  perms.forEach(p=>state.permissions[p.page_key]={view:p.can_view,add:p.can_add,edit:p.can_edit,delete:p.can_delete,delete_all:p.can_delete_all});
  if(state.profile?.role==='admin')V29_PAGES.forEach(([k])=>state.permissions[k]={view:true,add:true,edit:true,delete:true,delete_all:true});
  v29ApplyNavPermissions();
  const roleName=state.profile?.roles?.name||state.profile?.role||'staff';
  if($('#sidebarUserRole'))$('#sidebarUserRole').textContent=roleName;
}
function v29ApplyNavPermissions(){
  $$('.nav-link[data-view]').forEach(btn=>{
    const page=btn.dataset.view;
    btn.classList.toggle('hidden',!v29Perm(page,'view'));
  });
  // legacy admin-only should no longer override explicit permissions
  $$('.admin-only[data-view]').forEach(btn=>btn.classList.toggle('hidden',!v29Perm(btn.dataset.view,'view')));
}
function v29Denied(page){
  const view=$(`#view-${page}`);if(view)view.innerHTML=`<div class="permission-denied"><p class="eyebrow">ACCESS DENIED</p><h2>No permission for ${esc(v29PageLabel(page))}</h2><p class="muted">Your assigned role does not have View access to this page. Contact an administrator if access is required.</p></div>`;
  toast('You do not have permission to view this page.','error');
}

// Load permissions after successful login.
const v29AfterLoginBase=afterLogin;
afterLogin=async function(){
  state.session=(await sb.auth.getSession()).data.session;
  if(!state.session){showLogin();return;}
  await loadProfile();await v29LoadAccess();await loadSettings();await preload();setupRealtime();showApp();
  const first=V29_PAGES.find(([p])=>v29Perm(p,'view'))?.[0]||'dashboard';
  navigate(first);
};

// Last-layer navigation permission guard.
const v29NavigateBase=navigate;
navigate=function(view){
  if(!v29Perm(view,'view')){
    state.currentView=view;$$('.view').forEach(v=>v.classList.remove('active'));$(`#view-${view}`)?.classList.add('active');v29Denied(view);return;
  }
  v29NavigateBase(view);
};

const v29RenderCurrentBase=renderCurrent;
renderCurrent=async function(){
  if(!v29Perm(state.currentView,'view'))return v29Denied(state.currentView);
  if(state.currentView==='roles')return v29RenderRoles();
  if(state.currentView==='users')return v29RenderUsers();
  return v29RenderCurrentBase();
};

// ---------- USERS ----------
async function v29LoadRoles(){
  const {data,error}=await sb.from('roles').select('*').order('name');
  if(error){toast(error.message,'error');return [];}state.roles=data||[];return state.roles;
}
async function v29LoadUsers(){
  const {data,error}=await sb.from('profiles').select('*,roles(id,name,code)').order('created_at',{ascending:false});
  if(error){toast(error.message,'error');return [];}return data||[];
}
async function v29RenderUsers(){
  if(!v29Perm('users','view'))return v29Denied('users');
  const [roles,users]=await Promise.all([v29LoadRoles(),v29LoadUsers()]);
  const el=$('#view-users');
  el.innerHTML=`<div class="section-head"><div><p class="eyebrow">SECURE USER MANAGEMENT</p><h2>Users</h2></div><div class="filter-strip compact"><input id="v29UserSearch" type="search" placeholder="Search user..."><select id="v29UserRoleFilter"><option value="">All roles</option>${roles.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>${v29Perm('users','add')?'<button class="btn btn-primary" id="v29AddUserBtn">Add User</button>':''}</div></div>
  <div class="table-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody id="v29UsersBody"></tbody></table></div></div>`;
  const draw=()=>{
    const q=$('#v29UserSearch').value.toLowerCase().trim(),rf=$('#v29UserRoleFilter').value;
    const filtered=users.filter(u=>`${u.full_name||''} ${u.email||''} ${u.roles?.name||u.role||''}`.toLowerCase().includes(q)&&(!rf||u.role_id===rf));
    $('#v29UsersBody').innerHTML=filtered.length?filtered.map((u,i)=>`<tr><td><strong>${i+1}</strong></td><td>${esc(u.full_name||'—')}</td><td>${esc(u.email||'—')}</td><td>${esc(u.roles?.name||u.role||'—')}</td><td><span class="badge">${u.is_active?'Active':'Inactive'}</span></td><td>${u.created_at?new Date(u.created_at).toLocaleDateString('en-PH'):'—'}</td><td><div class="row-actions"><button data-user-view="${u.id}">View</button>${v29Perm('users','edit')?`<button data-user-edit="${u.id}">Edit</button>`:''}${v29Perm('users','delete')&&u.id!==state.session.user.id?`<button data-user-disable="${u.id}">${u.is_active?'Disable':'Enable'}</button>`:''}</div></td></tr>`).join(''):'<tr><td colspan="7" class="empty-state">No users found.</td></tr>';
    $$('[data-user-view]').forEach(b=>b.onclick=()=>v29OpenUser(users.find(x=>x.id===b.dataset.userView),false));
    $$('[data-user-edit]').forEach(b=>b.onclick=()=>v29OpenUser(users.find(x=>x.id===b.dataset.userEdit),true));
    $$('[data-user-disable]').forEach(b=>b.onclick=()=>v29ToggleUser(users.find(x=>x.id===b.dataset.userDisable)));
  };
  $('#v29UserSearch').oninput=draw;$('#v29UserRoleFilter').onchange=draw;draw();
  if($('#v29AddUserBtn'))$('#v29AddUserBtn').onclick=()=>v29AddUserModal();
}
function v29RoleOptions(selected=''){return state.roles.map(r=>`<option value="${r.id}" ${selected===r.id?'selected':''}>${esc(r.name)}</option>`).join('');}
function v29AddUserModal(){
  if(!v29Perm('users','add'))return toast('No Add User permission.','error');
  openModal({title:'Add User',eyebrow:'CREATE STAFF ACCOUNT',body:`<form id="v29UserForm" class="modal-form"><label>Full Name<input name="full_name" required></label><label>Email<input name="email" type="email" required></label><label>Password<input name="password" type="password" minlength="8" required></label><label>Role<select name="role_id" required><option value="">Select role...</option>${v29RoleOptions()}</select></label><p class="tiny muted full">The account is created securely through a Supabase Edge Function. The service role key is never stored in this website.</p></form>`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v29CreateUserBtn">Create User</button>`});
  $('[data-modal-cancel]').onclick=closeModal;
  $('#v29CreateUserBtn').onclick=async()=>{
    const d=Object.fromEntries(new FormData($('#v29UserForm')).entries());
    if(!d.full_name||!d.email||!d.password||!d.role_id)return toast('Complete all required fields.','error');
    const {data,error}=await sb.functions.invoke('create-resort-user',{body:d});
    if(error)return toast(error.message||'Unable to create user.','error');
    if(data?.error)return toast(data.error,'error');
    closeModal();await writeAudit('create_user','profiles',data?.user_id||'',`Created user ${d.email}`);toast('User created successfully.');v29RenderUsers();
  };
}
function v29OpenUser(u,edit=false){
  if(!u)return;
  if(!edit){openModal({title:u.full_name||u.email,eyebrow:'USER DETAILS',body:`<div class="modal-form"><label>Email<div>${esc(u.email||'—')}</div></label><label>Role<div>${esc(u.roles?.name||u.role||'—')}</div></label><label>Status<div>${u.is_active?'Active':'Inactive'}</div></label><label>Created<div>${u.created_at?new Date(u.created_at).toLocaleString('en-PH'):'—'}</div></label></div>`,footer:`<button class="btn btn-soft" data-modal-cancel>Close</button>${v29Perm('users','edit')?'<button class="btn btn-primary" id="v29EditUserFromView">Edit</button>':''}`});$('[data-modal-cancel]').onclick=closeModal;if($('#v29EditUserFromView'))$('#v29EditUserFromView').onclick=()=>v29OpenUser(u,true);return;}
  if(!v29Perm('users','edit'))return toast('No Edit User permission.','error');
  openModal({title:'Edit User',eyebrow:u.email||'',body:`<form id="v29EditUserForm" class="modal-form"><label>Full Name<input name="full_name" value="${esc(u.full_name||'')}"></label><label>Role<select name="role_id">${v29RoleOptions(u.role_id)}</select></label><label>Status<select name="is_active"><option value="true" ${u.is_active?'selected':''}>Active</option><option value="false" ${!u.is_active?'selected':''}>Inactive</option></select></label></form>`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v29SaveUserBtn">Save Changes</button>`});
  $('[data-modal-cancel]').onclick=closeModal;$('#v29SaveUserBtn').onclick=async()=>{const d=Object.fromEntries(new FormData($('#v29EditUserForm')).entries());const role=state.roles.find(r=>r.id===d.role_id);const {error}=await sb.from('profiles').update({full_name:d.full_name||null,role_id:d.role_id,is_active:d.is_active==='true',role:role?.code||'staff'}).eq('id',u.id);if(error)return toast(error.message,'error');closeModal();await writeAudit('update_user','profiles',u.id,'User profile/role updated');toast('User updated.');v29RenderUsers();};
}
function v29ToggleUser(u){
  if(!u||!v29Perm('users','delete'))return;
  const next=!u.is_active;
  confirmModal(next?'Enable User':'Disable User',`${next?'Enable':'Disable'} ${u.full_name||u.email}?`,async()=>{const {error}=await sb.from('profiles').update({is_active:next}).eq('id',u.id);if(error)return toast(error.message,'error');closeModal();await writeAudit(next?'enable_user':'disable_user','profiles',u.id,u.email||'');toast(`User ${next?'enabled':'disabled'}.`);v29RenderUsers();},!next);
}

// ---------- ROLES & PERMISSION MATRIX ----------
async function v29RenderRoles(){
  if(!v29Perm('roles','view'))return v29Denied('roles');
  const roles=await v29LoadRoles();
  const {data:rp,error}=await sb.from('role_permissions').select('*');if(error)return toast(error.message,'error');state.rolePermissions=rp||[];
  $('#view-roles').innerHTML=`<div class="section-head"><div><p class="eyebrow">ROLE-BASED ACCESS CONTROL</p><h2>Roles & Access</h2></div>${v29Perm('roles','add')?'<button class="btn btn-primary" id="v29AddRoleBtn">Add Role</button>':''}</div><div class="role-card-grid">${roles.map(r=>{const count=state.rolePermissions.filter(p=>p.role_id===r.id&&p.can_view).length;return `<article class="role-card"><div class="panel-head"><div><h3>${esc(r.name)}</h3><div class="meta">${esc(r.code)} · ${count} pages visible</div></div><span class="badge">${r.is_system?'System':'Custom'}</span></div><p class="muted">${esc(r.description||'No description')}</p><div class="row-actions"><button data-role-access="${r.id}">Access Checklist</button>${v29Perm('roles','edit')?`<button data-role-edit="${r.id}">Edit</button>`:''}${v29Perm('roles','delete')&&!r.is_system?`<button data-role-delete="${r.id}">Delete</button>`:''}</div></article>`}).join('')}</div>`;
  if($('#v29AddRoleBtn'))$('#v29AddRoleBtn').onclick=()=>v29RoleForm();
  $$('[data-role-access]').forEach(b=>b.onclick=()=>v29PermissionMatrix(roles.find(r=>r.id===b.dataset.roleAccess)));
  $$('[data-role-edit]').forEach(b=>b.onclick=()=>v29RoleForm(roles.find(r=>r.id===b.dataset.roleEdit)));
  $$('[data-role-delete]').forEach(b=>b.onclick=()=>v29DeleteRole(roles.find(r=>r.id===b.dataset.roleDelete)));
}
function v29RoleForm(role=null){
  if(role&&!v29Perm('roles','edit'))return;if(!role&&!v29Perm('roles','add'))return;
  openModal({title:role?'Edit Role':'Add Role',eyebrow:'ROLE LIBRARY',body:`<form id="v29RoleForm" class="modal-form"><label>Role Name<input name="name" required value="${esc(role?.name||'')}"></label><label>Role Code<input name="code" required value="${esc(role?.code||'')}" placeholder="example: front_desk"></label><label class="full">Description<textarea name="description" rows="3">${esc(role?.description||'')}</textarea></label></form>`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v29SaveRoleBtn">Save Role</button>`});
  $('[data-modal-cancel]').onclick=closeModal;$('#v29SaveRoleBtn').onclick=async()=>{const d=Object.fromEntries(new FormData($('#v29RoleForm')).entries());d.code=String(d.code||'').toLowerCase().replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'');if(!d.name||!d.code)return toast('Role Name and Code are required.','error');const q=role?sb.from('roles').update(d).eq('id',role.id):sb.from('roles').insert(d).select().single();const {data,error}=await q;if(error)return toast(error.message,'error');closeModal();await writeAudit(role?'update_role':'add_role','roles',role?.id||data?.id||'',d.name);toast('Role saved.');v29RenderRoles();};
}
function v29PermissionMatrix(role){
  const current=state.rolePermissions.filter(p=>p.role_id===role.id);const get=(page,act)=>!!current.find(p=>p.page_key===page)?.[`can_${act}`];
  openModal({title:`${role.name} Access`,eyebrow:'PER-PAGE CHECKLIST',wide:true,body:`<div class="panel"><div class="panel-head"><div><h3>${esc(role.name)}</h3><p class="muted">Check exactly what this role is allowed to do on every page.</p></div></div><div class="bulk-select"><label><input class="permission-check" type="checkbox" id="v29SelectAllView"> View All</label><label><input class="permission-check" type="checkbox" id="v29SelectAllAdd"> Add All</label><label><input class="permission-check" type="checkbox" id="v29SelectAllEdit"> Edit All</label><label><input class="permission-check" type="checkbox" id="v29SelectAllDelete"> Delete All Pages</label><label><input class="permission-check" type="checkbox" id="v29SelectAllDeleteAll"> Grant Delete All</label></div></div><div class="table-scroll"><table class="permission-table"><thead><tr><th>Page</th>${V29_ACTIONS.map(a=>`<th>${v29PermissionLabel(a)}</th>`).join('')}</tr></thead><tbody>${V29_PAGES.map(([page,label])=>`<tr><td><strong>${esc(label)}</strong><br><small class="muted">${esc(page)}</small></td>${V29_ACTIONS.map(a=>`<td><input class="permission-check v29perm" type="checkbox" data-page="${page}" data-action="${a}" ${get(page,a)?'checked':''} ${role.code==='admin'?'disabled':''}></td>`).join('')}</tr>`).join('')}</tbody></table></div>${role.code==='admin'?'<p class="tiny muted">Administrator is permanently granted full access for system recovery and cannot be restricted here.</p>':''}`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button>${v29Perm('roles','edit')&&role.code!=='admin'?'<button class="btn btn-primary" id="v29SavePermsBtn">Save Access</button>':''}`});
  $('[data-modal-cancel]').onclick=closeModal;
  [['#v29SelectAllView','view'],['#v29SelectAllAdd','add'],['#v29SelectAllEdit','edit'],['#v29SelectAllDelete','delete'],['#v29SelectAllDeleteAll','delete_all']].forEach(([sel,act])=>{if($(sel))$(sel).onchange=e=>$$(`.v29perm[data-action="${act}"]`).forEach(c=>{if(!c.disabled)c.checked=e.target.checked;});});
  if($('#v29SavePermsBtn'))$('#v29SavePermsBtn').onclick=async()=>{const rows=V29_PAGES.map(([page])=>{const o={role_id:role.id,page_key:page};V29_ACTIONS.forEach(a=>o[`can_${a}`]=!!$(`.v29perm[data-page="${page}"][data-action="${a}"]`)?.checked);return o;});const {error}=await sb.from('role_permissions').upsert(rows,{onConflict:'role_id,page_key'});if(error)return toast(error.message,'error');closeModal();await writeAudit('update_permissions','role_permissions',role.id,`Updated access for ${role.name}`);toast('Role permissions saved.');if(role.id===state.profile?.role_id)await v29LoadAccess();v29RenderRoles();};
}
function v29DeleteRole(role){
  if(!v29Perm('roles','delete')||role.is_system)return;
  confirmModal('Delete Role',`Delete custom role "${role.name}"? Users assigned to this role must be reassigned first.`,async()=>{const {error}=await sb.from('roles').delete().eq('id',role.id);if(error)return toast(error.message,'error');closeModal();await writeAudit('delete_role','roles',role.id,role.name);toast('Role deleted.');v29RenderRoles();},true);
}

// ---------- PERMISSION-AWARE GENERIC MODULE ACTIONS ----------
const v29RenderModuleBase=renderModule;
renderModule=async function(name){
  if(name==='users')return v29RenderUsers();
  if(!v29Perm(name,'view'))return v29Denied(name);
  await v29RenderModuleBase(name);
  const root=$(`#view-${name}`);if(!root)return;
  const add=root.querySelector(`[data-add-module="${name}"]`);if(add&&!v29Perm(name,'add'))add.remove();
  root.querySelectorAll(`[data-edit-record="${name}"]`).forEach(b=>{if(!v29Perm(name,'edit'))b.remove();});
  root.querySelectorAll(`[data-delete-record="${name}"]`).forEach(b=>{if(!v29Perm(name,'delete'))b.remove();});
  const toolbar=root.querySelector('.table-toolbar');
  if(toolbar&&v29Perm(name,'delete_all')&&!['audit'].includes(name)&&!toolbar.querySelector('[data-v29-delete-all]')){
    const btn=document.createElement('button');btn.className='btn btn-danger';btn.dataset.v29DeleteAll=name;btn.textContent='Delete All';toolbar.appendChild(btn);btn.onclick=()=>v29DeleteAllModule(name);
  }
};

const v29OpenRecordBase=openRecord;
openRecord=async function(name,id,edit=false){
  if(edit && id && !v29Perm(name,'edit'))return toast('No Edit permission for this page.','error');
  if(edit && !id && !v29Perm(name,'add'))return toast('No Add permission for this page.','error');
  if(!edit && !v29Perm(name,'view'))return toast('No View permission for this page.','error');
  return v29OpenRecordBase(name,id,edit);
};
const v29ArchiveRecordBase=archiveRecord;
archiveRecord=function(name,id){if(!v29Perm(name,'delete'))return toast('No Delete permission for this page.','error');return v29ArchiveRecordBase(name,id);};

async function v29DeleteAllModule(name){
  if(!v29Perm(name,'delete_all'))return toast('No Delete All permission.','error');
  const c=moduleConfig(name);if(!c)return;
  openModal({title:`Delete All ${c.title}`,eyebrow:'DANGEROUS ACTION',body:`<div class="danger-zone"><h3>This affects ALL records on this page.</h3><p>For operational/financial history, the system uses archive/void/cancel states where possible rather than permanently removing audit history.</p><label>Type <strong>DELETE ALL</strong> to continue<input id="v29DeleteAllConfirm" autocomplete="off" placeholder="DELETE ALL"></label></div>`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-danger" id="v29ConfirmDeleteAll">Delete All</button>`});
  $('[data-modal-cancel]').onclick=closeModal;
  $('#v29ConfirmDeleteAll').onclick=async()=>{
    if($('#v29DeleteAllConfirm').value.trim()!=='DELETE ALL')return toast('Type DELETE ALL exactly.','error');
    let error=null;
    if(name==='bookings')({error}=await sb.from(c.table).update({status:'cancelled'}).neq('status','cancelled'));
    else if(name==='inventory')({error}=await sb.from(c.table).update({is_active:false,condition:'retired'}).eq('is_active',true));
    else if(['rooms','cottages'].includes(name))({error}=await sb.from(c.table).update({is_active:false,status:'inactive'}).eq('is_active',true));
    else if(name==='users')return toast('Use individual Disable for users. Auth users are intentionally not mass-deleted.','error');
    else if(['payments','invoices','expenses','damages','repairs','billing'].includes(name))return toast('Mass permanent deletion of financial/history records is blocked. Use void/archive workflows instead.','error');
    else ({error}=await sb.from(c.table).delete().not('id','is',null));
    if(error)return toast(error.message,'error');
    closeModal();await writeAudit('delete_all',c.table,'*',`Delete All executed on ${name}`);toast(`${c.title} cleared/archived according to record policy.`);await preload();renderModule(name);
  };
}

// Reapply nav permissions after any later UI changes.
setTimeout(()=>{if(state.session)v29LoadAccess();},250);

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v30.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V3.0
   Minimal Booking Print Card + Special Event labels + GitHub-ready notes
   ============================================================ */

function v30MinimalCardData(b){
  const scanCode=b.booking_code||b.barcode||b.booking_number;
  const isRoom=(b.booking_type||'')==='room'||!!b.room_id;
  const unit=v27UnitLabel(b);
  return {
    scanCode,
    guest:b.guest_name||'Guest',
    unitLabel:isRoom?'Room':'Cottage',
    unitValue:unit||'—',
    isRoom
  };
}

function v30MinimalCardHtml(b, qrUrl, barcodeUrl){
  const d=v30MinimalCardData(b);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(d.scanCode)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;padding:24px;background:#fff;font-family:Inter,Arial,sans-serif;color:#1f3a31}
  .print-wrap{max-width:760px;margin:0 auto}
  .card{border:1px solid #d8e1da;border-radius:22px;padding:28px 30px;background:#fff}
  h1{font-size:18px;margin:0 0 22px;font-weight:800;color:#1d3d33}
  .code{font-size:32px;font-weight:800;margin:0 0 18px;letter-spacing:.01em;color:#102b22}
  .meta{display:grid;gap:8px;margin:0 0 22px}
  .meta p{margin:0;font-size:17px;line-height:1.35;color:#334d43}
  .meta strong{color:#102b22}
  .qr{width:170px;height:170px;object-fit:contain;border:1px solid #d7dfd9;border-radius:14px;padding:8px;background:#fff;display:block}
  .barcode-wrap{margin:26px 0 10px;display:flex;justify-content:flex-start}
  .barcode{width:100%;max-width:520px;height:auto;display:block}
  .code-label{font-size:20px;font-weight:700;text-align:left;color:#102b22;letter-spacing:.02em;margin:8px 0 0 8px}
  .note{font-size:16px;color:#6a7b73;margin:18px 0 0}
  @media print{
    body{padding:0}
    .print-wrap{max-width:none;margin:0}
    .card{border:none;border-radius:0;padding:18mm 16mm;box-shadow:none}
  }
</style></head><body>
<div class="print-wrap">
  <div class="card">
    <h1>Booking Scan Code</h1>
    <div class="code">${esc(d.scanCode)}</div>
    <div class="meta">
      <p><strong>Name:</strong> ${esc(d.guest)}</p>
      <p><strong>${esc(d.unitLabel)}:</strong> ${esc(d.unitValue)}</p>
    </div>
    <img class="qr" src="${qrUrl}" alt="Booking QR Code">
    <div class="barcode-wrap"><img class="barcode" src="${barcodeUrl}" alt="Booking Barcode"></div>
    <div class="code-label">${esc(d.scanCode)}</div>
    <p class="note">Use for payment, booking lookup and check-in.</p>
  </div>
</div>
<script>window.onload=()=>{setTimeout(()=>window.print(),150)};<\/script>
</body></html>`;
}

function v30OpenPrintWindow(html){
  const w=window.open('','_blank','width=900,height=900');
  if(!w){ toast('Print window was blocked by the browser. Please allow pop-ups and try again.','error'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
}

function v30PrintBookingCard(b){
  const qrUrl=v27GetQrDataUrl();
  const barcodeUrl=v27GetBarcodeSvgDataUrl();
  if(!qrUrl || !barcodeUrl){
    toast('Barcode / QR preview is not ready yet. Please wait a moment and try again.','error');
    return;
  }
  v30OpenPrintWindow(v30MinimalCardHtml(b, qrUrl, barcodeUrl));
}

// Override code modal: print button now prints ONLY the clean card requested by the user.
openCodesModal=function(b){
  if(!b)return;
  const pax=bookingPax(b.id), scanCode=b.booking_code||b.barcode||b.booking_number;
  const info=v30MinimalCardData(b);
  openModal({title:'Booking Barcode / QR',eyebrow:b.booking_number,wide:true,body:`
    <div class="panel">
      <h3>Print Preview</h3>
      <div style="border:1px solid var(--line);border-radius:18px;padding:24px;background:#fff;max-width:520px">
        <h4 style="margin:0 0 18px;font-size:18px;color:var(--brand)">Booking Scan Code</h4>
        <p style="font-size:20px;font-weight:800;margin:0 0 12px">${esc(scanCode)}</p>
        <p style="margin:0 0 6px"><strong>Name:</strong> ${esc(info.guest)}</p>
        <p style="margin:0 0 18px"><strong>${esc(info.unitLabel)}:</strong> ${esc(info.unitValue)}</p>
        <div id="bookingQr" style="background:#fff;padding:8px;border:1px solid var(--line);border-radius:10px;width:max-content"></div>
        <div style="margin-top:20px"><svg id="bookingBarcode" style="max-width:100%"></svg></div>
        <p class="tiny muted" style="margin-top:12px">Use for payment, booking lookup and check-in.</p>
      </div>
    </div>
    <div class="panel" style="margin-top:14px">
      <h3>Image Export</h3>
      <p class="muted">Client Version is clean and send-ready. Internal Version includes more operational details for staff.</p>
      <div class="row-actions"><button class="btn btn-primary" id="saveClientVersionBtn">Save Client Version</button><button class="btn btn-soft" id="saveInternalVersionBtn">Save Internal Version</button></div>
    </div>
    <div class="table-panel" style="margin-top:14px"><div class="panel-head" style="padding:14px 14px 0"><h3>Pax Codes</h3><span class="muted tiny">${pax.length} pax</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Pax</th><th>Type</th><th>Pax Code</th><th>Status</th></tr></thead><tbody>${pax.length?autoSortRows('pax',pax).map((p,i)=>`<tr><td><strong>${i+1}</strong></td><td>${esc(paxDisplayName(p))}</td><td>${esc(p.pax_type)}</td><td><strong>${esc(p.code||'NO CODE')}</strong></td><td>${esc(p.access_status)}</td></tr>`).join(''):'<tr><td colspan="5" class="empty-state">No pax codes yet.</td></tr>'}</tbody></table></div></div>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-soft" id="copyBookingCodeBtn">Copy Code</button><button class="btn btn-primary" id="printCodesBtn">Print Only This Card</button>`});

  $('[data-modal-cancel]').onclick=closeModal;
  try{
    new QRCode($('#bookingQr'),{text:scanCode,width:170,height:170});
    JsBarcode('#bookingBarcode',scanCode,{format:'CODE128',displayValue:true,height:72,margin:8});
  }catch(e){toast('Barcode renderer could not load.','error')}
  $('#copyBookingCodeBtn').onclick=async()=>{try{await navigator.clipboard.writeText(scanCode);toast('Booking Scan Code copied.')}catch{toast(`Booking Scan Code: ${scanCode}`)}};
  $('#saveClientVersionBtn').onclick=()=>v28SaveClientImage(b);
  $('#saveInternalVersionBtn').onclick=()=>v28SaveInternalImage(b);
  $('#printCodesBtn').onclick=()=>v30PrintBookingCard(b);
};

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v31.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V3.1
   QR/Barcode PNG export + professional print card
   ============================================================ */

function v31CanvasDownload(canvas, filename){
  const link=document.createElement('a');
  link.download=filename;
  link.href=canvas.toDataURL('image/png');
  document.body.appendChild(link);
  link.click();
  link.remove();
}
function v31SvgToCanvas(svgDataUrl, width=1100, height=260){
  return new Promise(async (resolve,reject)=>{
    try{
      const img=await v27LoadImage(svgDataUrl);
      const c=document.createElement('canvas'); c.width=width; c.height=height;
      const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,width,height);
      fitImage(x,img,25,25,width-50,height-50);
      resolve(c);
    }catch(e){reject(e)}
  });
}
async function v31SaveQrPng(b){
  try{
    const qrUrl=v27GetQrDataUrl();
    if(!qrUrl) throw new Error('QR preview is not ready yet.');
    const qr=await v27LoadImage(qrUrl);
    const info=v30MinimalCardData(b);
    const resortName=state.settings?.resort_name || window.MASUSI_CONFIG?.DEFAULT_RESORT_NAME || 'Masusi Farm Resort';
    const c=document.createElement('canvas'); c.width=900; c.height=980; const x=c.getContext('2d');
    x.fillStyle='#f4f7f5'; x.fillRect(0,0,c.width,c.height);
    x.fillStyle='#fff'; roundRect(x,40,40,820,900,28,true,false);
    x.fillStyle='#0f6a4d'; roundRect(x,40,40,820,150,28,true,false);
    x.fillStyle='#fff'; x.font='700 34px Arial'; x.fillText(resortName,72,98);
    x.font='500 19px Arial'; x.fillText('Booking QR Code',72,130);
    x.fillStyle='#0f172a'; x.font='700 24px Arial'; x.fillText('BOOKING SCAN CODE',72,240);
    x.font='700 36px Arial'; x.fillText(info.scanCode,72,288);
    x.fillStyle='#64748b'; x.font='600 18px Arial'; x.fillText(`Name: ${info.guest}`,72,340);
    x.fillText(`${info.unitLabel}: ${info.unitValue}`,72,372);
    x.fillStyle='#fff'; x.strokeStyle='#d7dfda'; roundRect(x,225,430,450,450,22,true,true);
    x.drawImage(qr,275,480,350,350);
    x.fillStyle='#6b7c74'; x.font='500 18px Arial'; x.textAlign='center';
    x.fillText('Present this QR Code during check-in, payment, or booking lookup.',450,900);
    x.textAlign='left';
    v31CanvasDownload(c,`${v27FilenameSafe(info.scanCode)}_QR.png`);
    toast('QR Code saved as PNG.');
  }catch(e){console.error(e);toast(e.message||'Could not save QR PNG.','error');}
}
async function v31SaveBarcodePng(b){
  try{
    const barcodeUrl=v27GetBarcodeSvgDataUrl();
    if(!barcodeUrl) throw new Error('Barcode preview is not ready yet.');
    const info=v30MinimalCardData(b);
    const resortName=state.settings?.resort_name || window.MASUSI_CONFIG?.DEFAULT_RESORT_NAME || 'Masusi Farm Resort';
    const base=await v31SvgToCanvas(barcodeUrl,1120,280);
    const barcodeImg=await v27LoadImage(base.toDataURL('image/png'));
    const c=document.createElement('canvas'); c.width=1200; c.height=760; const x=c.getContext('2d');
    x.fillStyle='#f4f7f5'; x.fillRect(0,0,c.width,c.height);
    x.fillStyle='#fff'; roundRect(x,40,40,1120,680,28,true,false);
    x.fillStyle='#173f33'; roundRect(x,40,40,1120,140,28,true,false);
    x.fillStyle='#fff'; x.font='700 36px Arial'; x.fillText(resortName,72,96);
    x.font='500 19px Arial'; x.fillText('Booking Barcode',72,126);
    x.fillStyle='#0f172a'; x.font='700 24px Arial'; x.fillText('BOOKING SCAN CODE',72,238);
    x.font='700 38px Arial'; x.fillText(info.scanCode,72,286);
    x.fillStyle='#64748b'; x.font='600 18px Arial'; x.fillText(`Name: ${info.guest}`,72,336);
    x.fillText(`${info.unitLabel}: ${info.unitValue}`,72,368);
    x.drawImage(barcodeImg,80,410,1040,240);
    x.fillStyle='#6b7c74'; x.font='500 18px Arial'; x.textAlign='center'; x.fillText('Present this barcode during check-in, payment, or booking lookup.',600,690); x.textAlign='left';
    v31CanvasDownload(c,`${v27FilenameSafe(info.scanCode)}_BARCODE.png`);
    toast('Barcode saved as PNG.');
  }catch(e){console.error(e);toast(e.message||'Could not save Barcode PNG.','error');}
}
function v31ProfessionalPrintHtml(b, qrUrl, barcodeUrl){
  const d=v30MinimalCardData(b);
  const resortName=state.settings?.resort_name || window.MASUSI_CONFIG?.DEFAULT_RESORT_NAME || 'Masusi Farm Resort';
  const logo=state.settings?.logo_url || 'assets/logo-placeholder.svg';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(d.scanCode)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;padding:0;background:#fff;font-family:Arial,sans-serif;color:#15362b}
  .page{padding:12mm}
  .card{border:1px solid #d8e2dc;border-radius:20px;overflow:hidden;background:#fff}
  .header{background:#0f6a4d;color:#fff;padding:18px 22px;display:flex;align-items:center;gap:14px}
  .header img{width:56px;height:56px;object-fit:contain;background:#fff;border-radius:50%;padding:4px}
  .title{font-size:28px;font-weight:800;line-height:1.1}
  .subtitle{font-size:14px;opacity:.95;margin-top:4px}
  .body{padding:24px}
  .label{font-size:15px;font-weight:700;color:#4a645a;text-transform:uppercase;letter-spacing:.05em}
  .code{font-size:26px;font-weight:800;color:#102b22;margin:6px 0 14px}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:12px 20px;margin-bottom:18px}
  .meta-box{background:#f6faf7;border:1px solid #dce8e2;border-radius:14px;padding:12px 14px}
  .meta-box .small{font-size:13px;color:#5f746b;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
  .meta-box .big{font-size:20px;color:#102b22;font-weight:800;margin-top:5px;word-break:break-word}
  .codes{display:grid;grid-template-columns:240px 1fr;gap:22px;align-items:center;margin-top:16px}
  .qr-box{border:1px solid #dce6e0;border-radius:16px;padding:10px;background:#fff;display:flex;align-items:center;justify-content:center;height:240px}
  .qr-box img{max-width:100%;max-height:100%}
  .bar-box{border:1px solid #dce6e0;border-radius:16px;padding:14px 16px;background:#fff;min-height:240px;display:flex;flex-direction:column;justify-content:center}
  .bar-box img{width:100%;height:auto;display:block}
  .bar-code-label{font-size:22px;font-weight:800;text-align:center;color:#102b22;margin-top:10px}
  .note{margin-top:18px;font-size:15px;color:#667a72}
  @media print{
    @page{size:auto;margin:10mm}
    body{background:#fff}
    .page{padding:0}
  }
</style></head><body>
<div class="page"><div class="card">
  <div class="header">
    <img src="${logo}" alt="Logo" onerror="this.style.display='none'">
    <div><div class="title">${esc(resortName)}</div><div class="subtitle">Booking Barcode / QR Card</div></div>
  </div>
  <div class="body">
    <div class="label">Booking Scan Code</div>
    <div class="code">${esc(d.scanCode)}</div>
    <div class="meta">
      <div class="meta-box"><div class="small">Name</div><div class="big">${esc(d.guest)}</div></div>
      <div class="meta-box"><div class="small">${esc(d.unitLabel)}</div><div class="big">${esc(d.unitValue)}</div></div>
    </div>
    <div class="codes">
      <div class="qr-box"><img src="${qrUrl}" alt="QR"></div>
      <div class="bar-box"><img src="${barcodeUrl}" alt="Barcode"><div class="bar-code-label">${esc(d.scanCode)}</div></div>
    </div>
    <div class="note">Use for payment, booking lookup and check-in.</div>
  </div>
</div></div>
<script>window.onload=()=>setTimeout(()=>window.print(),180);<\/script>
</body></html>`;
}
function v31PrintProfessionalCard(b){
  const qrUrl=v27GetQrDataUrl();
  const barcodeUrl=v27GetBarcodeSvgDataUrl();
  if(!qrUrl||!barcodeUrl){ toast('Barcode / QR preview is not ready yet. Please wait a moment and try again.','error'); return; }
  v30OpenPrintWindow(v31ProfessionalPrintHtml(b, qrUrl, barcodeUrl));
}

// Final code modal override with dedicated PNG export buttons.
openCodesModal=function(b){
  if(!b)return;
  const pax=bookingPax(b.id), scanCode=b.booking_code||b.barcode||b.booking_number, info=v30MinimalCardData(b);
  openModal({title:'Booking Barcode / QR',eyebrow:b.booking_number,wide:true,body:`
    <div class="panel">
      <h3>Professional Print Preview</h3>
      <div style="border:1px solid var(--line);border-radius:20px;padding:24px;background:#fff;max-width:560px">
        <div style="font-size:18px;font-weight:800;color:var(--brand);margin-bottom:14px">Booking Scan Code</div>
        <div style="font-size:22px;font-weight:800;margin-bottom:10px">${esc(scanCode)}</div>
        <p style="margin:0 0 6px"><strong>Name:</strong> ${esc(info.guest)}</p>
        <p style="margin:0 0 18px"><strong>${esc(info.unitLabel)}:</strong> ${esc(info.unitValue)}</p>
        <div id="bookingQr" style="background:#fff;padding:8px;border:1px solid var(--line);border-radius:10px;width:max-content"></div>
        <div style="margin-top:20px"><svg id="bookingBarcode" style="max-width:100%"></svg></div>
        <p class="tiny muted" style="margin-top:12px">Use for payment, booking lookup and check-in.</p>
      </div>
    </div>
    <div class="panel" style="margin-top:14px">
      <h3>Export Options</h3>
      <p class="muted">Client Version is send-ready. Internal Version includes more operational details. You can also save only the QR Code or only the Barcode as PNG.</p>
      <div class="row-actions">
        <button class="btn btn-primary" id="saveClientVersionBtn">Save Client Version</button>
        <button class="btn btn-soft" id="saveInternalVersionBtn">Save Internal Version</button>
        <button class="btn btn-soft" id="saveQrOnlyBtn">Save QR PNG</button>
        <button class="btn btn-soft" id="saveBarcodeOnlyBtn">Save Barcode PNG</button>
      </div>
    </div>
    <div class="table-panel" style="margin-top:14px"><div class="panel-head" style="padding:14px 14px 0"><h3>Pax Codes</h3><span class="muted tiny">${pax.length} pax</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Pax</th><th>Type</th><th>Pax Code</th><th>Status</th></tr></thead><tbody>${pax.length?autoSortRows('pax',pax).map((p,i)=>`<tr><td><strong>${i+1}</strong></td><td>${esc(paxDisplayName(p))}</td><td>${esc(p.pax_type)}</td><td><strong>${esc(p.code||'NO CODE')}</strong></td><td>${esc(p.access_status)}</td></tr>`).join(''):'<tr><td colspan="5" class="empty-state">No pax codes yet.</td></tr>'}</tbody></table></div></div>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-soft" id="copyBookingCodeBtn">Copy Code</button><button class="btn btn-primary" id="printCodesBtn">Professional Print</button>`});
  $('[data-modal-cancel]').onclick=closeModal;
  try{new QRCode($('#bookingQr'),{text:scanCode,width:170,height:170});JsBarcode('#bookingBarcode',scanCode,{format:'CODE128',displayValue:true,height:78,margin:10});}catch(e){toast('Barcode renderer could not load.','error')}
  $('#copyBookingCodeBtn').onclick=async()=>{try{await navigator.clipboard.writeText(scanCode);toast('Booking Scan Code copied.')}catch{toast(`Booking Scan Code: ${scanCode}`)}};
  $('#saveClientVersionBtn').onclick=()=>v28SaveClientImage(b);
  $('#saveInternalVersionBtn').onclick=()=>v28SaveInternalImage(b);
  $('#saveQrOnlyBtn').onclick=()=>v31SaveQrPng(b);
  $('#saveBarcodeOnlyBtn').onclick=()=>v31SaveBarcodePng(b);
  $('#printCodesBtn').onclick=()=>v31PrintProfessionalCard(b);
};

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v32.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V3.2
   PAX SHOW QR + LIVE VIEW BOOKING/PAX BARCODE SHORTCUTS
   ============================================================ */

function v32PaxCodeImages(p){
  const code=String(p?.code||'').trim();
  if(!code)return {code:null};
  return {code};
}

function v32DownloadSimpleCanvas(canvas, filename){
  const a=document.createElement('a');
  a.download=filename;
  a.href=canvas.toDataURL('image/png');
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function v32SafeName(v){ return String(v||'code').replace(/[^a-z0-9-_]+/gi,'_').replace(/^_+|_+$/g,''); }

function v32RenderPaxQrAndBarcode(p){
  const code=String(p?.code||'').trim();
  if(!code)return;
  try{
    const qrEl=$('#v32PaxQr');
    const barEl=$('#v32PaxBarcode');
    if(qrEl){ qrEl.innerHTML=''; new QRCode(qrEl,{text:code,width:190,height:190}); }
    if(barEl){ JsBarcode('#v32PaxBarcode',code,{format:'CODE128',displayValue:true,height:70,margin:8}); }
  }catch(e){ toast('QR/Barcode renderer could not load.','error'); }
}

function v32GetPaxQrDataUrl(){
  const holder=$('#v32PaxQr');
  if(!holder)return null;
  const img=holder.querySelector('img');
  if(img?.src)return img.src;
  const canvas=holder.querySelector('canvas');
  try{ if(canvas)return canvas.toDataURL('image/png'); }catch(e){}
  return null;
}

function v32GetPaxBarcodeDataUrl(){
  const svg=$('#v32PaxBarcode');
  if(!svg)return null;
  try{
    const copy=svg.cloneNode(true);
    copy.setAttribute('xmlns','http://www.w3.org/2000/svg');
    const xml=new XMLSerializer().serializeToString(copy);
    return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(xml);
  }catch(e){return null;}
}

async function v32SavePaxQrPng(p){
  try{
    const url=v32GetPaxQrDataUrl();
    if(!url)throw new Error('QR preview is not ready yet.');
    const img=await v27LoadImage(url);
    const code=String(p.code||'NO CODE');
    const c=document.createElement('canvas'); c.width=760; c.height=900;
    const x=c.getContext('2d');
    x.fillStyle='#f4f7f5'; x.fillRect(0,0,c.width,c.height);
    x.fillStyle='#fff'; roundRect(x,36,36,688,828,28,true,false);
    x.fillStyle='#0f6a4d'; roundRect(x,36,36,688,130,28,true,false);
    x.fillStyle='#fff'; x.font='700 30px Arial'; x.fillText('Masusi Farm Resort',68,88);
    x.font='500 17px Arial'; x.fillText('Pax / Companion QR Code',68,118);
    x.fillStyle='#0f172a'; x.font='700 22px Arial'; x.fillText('PAX CODE',68,224);
    x.font='700 32px Arial'; x.fillText(code,68,268);
    x.fillStyle='#64748b'; x.font='600 18px Arial'; x.fillText(`Pax: ${paxDisplayName(p)}`,68,320);
    x.fillText(`Type: ${p.pax_type||'—'}`,68,350);
    x.fillStyle='#fff'; x.strokeStyle='#d7e2dc'; roundRect(x,180,410,400,400,22,true,true);
    x.drawImage(img,220,450,320,320);
    x.fillStyle='#64748b'; x.font='500 16px Arial'; x.textAlign='center';
    x.fillText('Use for entrance, exit, return, and cottage/room lookup.',380,825);
    x.textAlign='left';
    v32DownloadSimpleCanvas(c,`${v32SafeName(code)}_PAX_QR.png`);
    toast('Pax QR saved as PNG.');
  }catch(e){ console.error(e); toast(e.message||'Could not save Pax QR.','error'); }
}

function v32PrintPaxCode(p){
  const qr=v32GetPaxQrDataUrl();
  const bar=v32GetPaxBarcodeDataUrl();
  if(!qr||!bar)return toast('Pax QR/Barcode preview is not ready yet.','error');
  const code=String(p.code||'NO CODE');
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>${esc(code)}</title>
  <style>
    body{font-family:Arial,sans-serif;margin:0;padding:18mm;color:#15362b;background:#fff}
    .card{border:1px solid #d8e2dc;border-radius:18px;padding:22px;max-width:620px}
    h1{font-size:20px;margin:0 0 18px;color:#15362b}
    .code{font-size:26px;font-weight:800;margin:8px 0 16px}
    .meta{font-size:17px;margin:5px 0}
    .qr{width:190px;height:190px;border:1px solid #d8e2dc;border-radius:12px;padding:8px;object-fit:contain;margin-top:16px}
    .bar{display:block;width:100%;max-width:480px;margin:20px 0 0}
    .note{font-size:14px;color:#64748b;margin-top:18px}
    @media print{@page{margin:10mm}body{padding:0}.card{border:none}}
  </style></head><body><div class="card">
    <h1>Pax / Companion Code</h1>
    <div class="code">${esc(code)}</div>
    <p class="meta"><strong>Pax:</strong> ${esc(paxDisplayName(p))}</p>
    <p class="meta"><strong>Type:</strong> ${esc(p.pax_type||'—')}</p>
    <img class="qr" src="${qr}">
    <img class="bar" src="${bar}">
    <p class="note">Use for entrance, exit, return, and cottage/room lookup.</p>
  </div><script>window.onload=()=>setTimeout(()=>window.print(),150);<\/script></body></html>`;
  v30OpenPrintWindow(html);
}

function v32OpenPaxQrModal(p,booking=null){
  if(!p)return;
  if(!String(p.code||'').trim()){
    openModal({
      title:'No Pax Code Yet',
      eyebrow:paxDisplayName(p),
      body:`<p>This pax has no assigned code yet. Use Manual Code, Scan Code, or Auto Generate first.</p>`,
      footer:`<button class="btn btn-primary" data-modal-cancel>Close</button>`
    });
    $('[data-modal-cancel]').onclick=closeModal;
    return;
  }
  openModal({
    title:'Pax QR / Barcode',
    eyebrow:booking?.booking_number || 'PAX CODE',
    wide:true,
    body:`<div class="dashboard-grid">
      <div class="panel">
        <h3>${esc(paxDisplayName(p))}</h3>
        <p style="font-size:20px"><strong>${esc(p.code)}</strong></p>
        <p class="muted">Type: ${esc(p.pax_type||'—')} · Status: ${esc(p.access_status||'not_checked_in')}</p>
        ${booking?`<p class="muted">Booking: ${esc(booking.booking_number||'')}</p>`:''}
        <p class="tiny muted">This code is used for individual pax entrance, exit, return, and locating assigned room/cottage.</p>
      </div>
      <div class="panel">
        <h3>QR / Barcode Preview</h3>
        <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:12px">
          <div id="v32PaxQr" style="background:#fff;padding:8px;border:1px solid var(--line);border-radius:10px"></div>
          <svg id="v32PaxBarcode" style="max-width:100%"></svg>
        </div>
      </div>
    </div>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-soft" id="v32CopyPaxCode">Copy Code</button><button class="btn btn-soft" id="v32SavePaxQr">Save QR PNG</button><button class="btn btn-primary" id="v32PrintPax">Print Pax Code</button>`
  });
  $('[data-modal-cancel]').onclick=closeModal;
  setTimeout(()=>v32RenderPaxQrAndBarcode(p),20);
  $('#v32CopyPaxCode').onclick=async()=>{
    try{await navigator.clipboard.writeText(p.code);toast('Pax Code copied.')}catch{toast(`Pax Code: ${p.code}`)}
  };
  $('#v32SavePaxQr').onclick=()=>v32SavePaxQrPng(p);
  $('#v32PrintPax').onclick=()=>v32PrintPaxCode(p);
}

async function v32OpenBookingPaxQrList(booking){
  await refreshOperations();
  const pax=autoSortRows('pax',bookingPax(booking.id));
  openModal({
    title:'Booking Pax Barcodes',
    eyebrow:booking.booking_number,
    wide:true,
    body:`<div class="panel" style="margin-bottom:14px">
      <div class="panel-head"><div><h3>${esc(booking.guest_name||'Guest')}</h3><p class="muted">${esc(booking.booking_number||'')} · ${pax.length} pax</p></div><button class="btn btn-primary" id="v32OpenBookingCode">View Booking Barcode</button></div>
      <p class="tiny muted">Open or print individual Pax QR/Barcode codes from here.</p>
    </div>
    <div class="table-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Pax</th><th>Type</th><th>Code</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      ${pax.length?pax.map((p,i)=>`<tr><td><strong>${i+1}</strong></td><td>${esc(paxDisplayName(p))}</td><td>${esc(p.pax_type||'—')}</td><td><strong>${esc(p.code||'NO CODE')}</strong></td><td><span class="badge">${esc(p.access_status||'not_checked_in')}</span></td><td><div class="row-actions">${p.code?`<button data-v32-show-pax="${p.id}">Show QR</button>`:`<button data-v32-manage-pax="${p.id}">Add Code</button>`}</div></td></tr>`).join(''):'<tr><td colspan="6" class="empty-state">No pax records found.</td></tr>'}
    </tbody></table></div></div>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-primary" id="v32ManagePaxCodes">Manage Pax Codes</button>`
  });
  $('[data-modal-cancel]').onclick=closeModal;
  $('#v32OpenBookingCode').onclick=()=>openCodesModal(booking);
  $('#v32ManagePaxCodes').onclick=()=>openPaxManagerV24(booking);
  $$('[data-v32-show-pax]').forEach(btn=>btn.onclick=()=>{
    const p=state.cache.pax.find(x=>x.id===btn.dataset.v32ShowPax);
    v32OpenPaxQrModal(p,booking);
  });
  $$('[data-v32-manage-pax]').forEach(btn=>btn.onclick=()=>openPaxManagerV24(booking));
}

/* Override Pax Manager to include Show QR button on every pax that has a code. */
openPaxManagerV24 = async function(booking){
  await refreshOperations();
  const pax=autoSortRows('pax',(state.cache.pax||[]).filter(p=>p.booking_id===booking.id && p.access_status!=='cancelled'));

  openModal({
    title:'Pax / Companion Barcode Manager',
    eyebrow:booking.booking_number,
    wide:true,
    body:`
      <div class="panel" style="margin-bottom:14px">
        <div class="panel-head">
          <div>
            <h3>${esc(booking.guest_name||'Guest')}</h3>
            <p class="muted">${esc(booking.booking_type||'booking')} · ${esc(booking.booking_number)}</p>
          </div>
          <button class="btn btn-primary" id="v24AddPaxBtn">Add Companion / Pax</button>
        </div>
        <p class="tiny muted">
          Booking barcode is generated automatically. Pax codes may be manual, scanned from your printed barcode, or auto-generated.
        </p>
      </div>

      <div class="table-panel">
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr>
              <th>#</th><th>Pax</th><th>Type</th><th>Current Code</th><th>Status</th><th>Actions</th>
            </tr></thead>
            <tbody id="v24PaxRows">
              ${pax.length?pax.map((p,i)=>`
                <tr>
                  <td><strong>${i+1}</strong></td>
                  <td>${esc(paxDisplayName(p)||`Pax ${i+1}`)}</td>
                  <td>${esc(p.pax_type||'adult')}</td>
                  <td><strong>${esc(p.code||'NO CODE')}</strong></td>
                  <td><span class="badge">${esc(p.access_status||'not_checked_in')}</span></td>
                  <td>
                    <div class="row-actions">
                      ${p.code?`<button data-v32-show-pax="${p.id}">Show QR</button>`:''}
                      <button data-v24-manual="${p.id}">Manual Code</button>
                      <button data-v24-scan="${p.id}">Scan Code</button>
                      <button data-v24-auto="${p.id}">Auto Generate</button>
                      ${p.code?`<button data-v24-clear="${p.id}">Clear</button>`:''}
                    </div>
                  </td>
                </tr>`).join(''):`<tr><td colspan="6" class="empty-state">No pax records yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-primary" id="v32BookingBarcodeFromPax">Booking Barcode</button>`
  });

  $('[data-modal-cancel]').onclick=closeModal;
  $('#v24AddPaxBtn').onclick=()=>openAddPaxV24(booking);
  $('#v32BookingBarcodeFromPax').onclick=()=>openCodesModal(booking);

  $$('[data-v32-show-pax]').forEach(btn=>btn.onclick=()=>{
    const p=state.cache.pax.find(x=>x.id===btn.dataset.v32ShowPax);
    v32OpenPaxQrModal(p,booking);
  });
  $$('[data-v24-manual]').forEach(btn=>btn.onclick=()=>{
    const p=state.cache.pax.find(x=>x.id===btn.dataset.v24Manual);
    openManualPaxCodeV24(booking,p);
  });
  $$('[data-v24-scan]').forEach(btn=>btn.onclick=()=>{
    const p=state.cache.pax.find(x=>x.id===btn.dataset.v24Scan);
    openScanPaxCodeV24(booking,p);
  });
  $$('[data-v24-auto]').forEach(btn=>btn.onclick=()=>{
    const p=state.cache.pax.find(x=>x.id===btn.dataset.v24Auto);
    autoGeneratePaxCodeV24(booking,p);
  });
  $$('[data-v24-clear]').forEach(btn=>btn.onclick=()=>{
    const p=state.cache.pax.find(x=>x.id===btn.dataset.v24Clear);
    clearPaxCodeV24(booking,p);
  });
};

/* Override Live Unit Detail to add Booking Barcode + Pax Barcodes buttons. */
openUnitDetail = function(type,id,date){
  const u=(type==="room"?state.cache.rooms:state.cache.cottages).find(x=>x.id===id), b=bookingForUnit(type,id,date);
  const total=b?Number(b.adults||0)+Number(b.kids||0)+Number(b.babies||0):0;
  const pax=b?autoSortRows('pax',bookingPax(b.id)):[];
  openModal({title:u.name||u.unit_number,eyebrow:`${type.toUpperCase()} LIVE DETAILS`,wide:true,body:`
    <div class="report-kpis">
      <div class="report-kpi"><span>Status</span><strong>${esc(unitStatus(type,u,date))}</strong></div>
      <div class="report-kpi"><span>Guests</span><strong>${total}</strong></div>
      <div class="report-kpi"><span>Capacity</span><strong>${u.capacity||"—"}</strong></div>
      <div class="report-kpi"><span>Balance</span><strong>${money(b?.balance||0)}</strong></div>
    </div>
    ${b?`<div class="panel"><strong>${esc(b.guest_name||"Guest")}</strong><p class="muted">${esc(b.booking_number||"")} · ${fmtDate(b.check_in_date)} to ${fmtDate(b.check_out_date)}</p><p>Adults: ${b.adults||0} · Kids: ${b.kids||0} · Babies: ${b.babies||0} · Senior: ${b.seniors||0} · PWD: ${b.pwd||0}</p></div>
    <div class="table-panel" style="margin-top:14px"><div class="panel-head" style="padding:14px 14px 0"><h3>Pax Codes</h3><span class="muted tiny">${pax.length} pax</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Pax</th><th>Code</th><th>Status</th><th>Action</th></tr></thead><tbody>${pax.length?pax.map((p,i)=>`<tr><td><strong>${i+1}</strong></td><td>${esc(paxDisplayName(p))}</td><td><strong>${esc(p.code||'NO CODE')}</strong></td><td><span class="badge">${esc(p.access_status||'not_checked_in')}</span></td><td>${p.code?`<button class="btn btn-soft" data-v32-show-pax="${p.id}">View Pax QR</button>`:`<button class="btn btn-soft" data-v32-manage-pax="${p.id}">Add Code</button>`}</td></tr>`).join(''):'<tr><td colspan="5" class="empty-state">No pax records found.</td></tr>'}</tbody></table></div></div>`:`<div class="empty-state">This unit is currently available.</div>`}
  `,footer:`<button class="btn btn-soft" data-modal-cancel>Close</button>${b?`<button class="btn btn-soft" id="v32LiveBookingBarcode">View Booking Barcode</button><button class="btn btn-soft" id="v32LivePaxBarcodes">View Pax Barcodes</button><button class="btn btn-primary" data-open-booking="${b.id}">View Booking</button>`:""}`});
  $("[data-modal-cancel]").onclick=closeModal;
  if(b){
    $("[data-open-booking]").onclick=()=>{closeModal();navigate("bookings");setTimeout(()=>openRecord("bookings",b.id),50)};
    $('#v32LiveBookingBarcode').onclick=()=>openCodesModal(b);
    $('#v32LivePaxBarcodes').onclick=()=>v32OpenBookingPaxQrList(b);
    $$('[data-v32-show-pax]').forEach(btn=>btn.onclick=()=>{
      const p=state.cache.pax.find(x=>x.id===btn.dataset.v32ShowPax);
      v32OpenPaxQrModal(p,b);
    });
    $$('[data-v32-manage-pax]').forEach(btn=>btn.onclick=()=>openPaxManagerV24(b));
  }
};

/* Add barcode buttons to Running Account modal too. */
const v32BaseOpenCottageAccount = openCottageAccount;
openCottageAccount = async function(bookingId,paxId=null){
  await v32BaseOpenCottageAccount(bookingId,paxId);
  const b=state.cache.bookings.find(x=>x.id===bookingId);
  setTimeout(()=>{
    const footer=$('#modalFooter');
    if(!footer||!b)return;
    if(!footer.querySelector('#v32AccountBookingBarcode')){
      const btn=document.createElement('button');
      btn.className='btn btn-soft';
      btn.id='v32AccountBookingBarcode';
      btn.textContent='View Booking Barcode';
      btn.onclick=()=>openCodesModal(b);
      footer.insertBefore(btn,footer.firstChild);
    }
    if(!footer.querySelector('#v32AccountPaxBarcodes')){
      const btn=document.createElement('button');
      btn.className='btn btn-soft';
      btn.id='v32AccountPaxBarcodes';
      btn.textContent='View Pax Barcodes';
      btn.onclick=()=>v32OpenBookingPaxQrList(b);
      footer.insertBefore(btn,footer.firstChild);
    }
  },30);
};

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v35.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V3.5
   PAX DEMOGRAPHICS / AREA + ROOM KEY ID DEPOSIT
   ============================================================ */

const V35_CAVITE_AREAS=[
  'Alfonso','Amadeo','General Emilio Aguinaldo','General Mariano Alvarez (GMA)','Indang','Kawit','Magallanes','Maragondon','Mendez','Naic','Noveleta','Rosario','Silang','Tanza','Ternate'
];
const V35_GENDERS=['Male','Female','LGBTQIA+'];

function v35AreaOptions(selected=''){
  const opts=V35_CAVITE_AREAS.map(a=>`<option value="${esc(a)}" ${selected===a?'selected':''}>${esc(a)}</option>`).join('');
  return `<option value="">Select area...</option>${opts}<option value="Other" ${selected==='Other'?'selected':''}>Other / Outside listed areas</option>`;
}
function v35GenderOptions(selected=''){
  return `<option value="">Not specified</option>${V35_GENDERS.map(g=>`<option value="${g}" ${selected===g?'selected':''}>${g}</option>`).join('')}`;
}
function v35EffectiveArea(p){
  const area=String(p?.area||'').trim();
  if(area==='Other') return String(p?.area_other||'Other').trim()||'Other';
  return area||'Not specified';
}

function v35PaxInfoFormHtml(p={}){
  const isOther=p.area==='Other';
  return `<form id="v35PaxInfoForm" class="modal-form">
    <label>Name / Nickname
      <input name="display_name" value="${esc(p.display_name||'')}" placeholder="e.g. Juan, Ana, Guest 1">
    </label>
    <label>Gender
      <select name="gender">${v35GenderOptions(p.gender||'')}</select>
    </label>
    <label>Area
      <select name="area" id="v35PaxArea">${v35AreaOptions(p.area||'')}</select>
    </label>
    <label id="v35OtherAreaWrap" class="${isOther?'':'hidden'}">Other Area / City / Province
      <input name="area_other" value="${esc(p.area_other||'')}" placeholder="Type city, municipality, province, etc.">
    </label>
    <p class="tiny muted full">Full legal name is not required. Area is used only for resort statistics/reports. Choose Other when the guest is from a place not listed above.</p>
  </form>`;
}
function v35WireAreaOther(){
  const area=$('#v35PaxArea'), wrap=$('#v35OtherAreaWrap');
  if(!area||!wrap)return;
  const sync=()=>wrap.classList.toggle('hidden',area.value!=='Other');
  area.onchange=sync;sync();
}
async function v35OpenPaxInfo(booking,p){
  openModal({title:'Edit Pax Information',eyebrow:`${booking.booking_number} · ${paxDisplayName(p)}`,body:v35PaxInfoFormHtml(p),footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v35SavePaxInfo">Save Pax Info</button>`});
  $('[data-modal-cancel]').onclick=()=>openPaxManagerV24(booking);v35WireAreaOther();
  $('#v35SavePaxInfo').onclick=async()=>{
    const d=Object.fromEntries(new FormData($('#v35PaxInfoForm')).entries());
    const payload={display_name:String(d.display_name||'').trim()||null,gender:d.gender||null,area:d.area||null,area_other:d.area==='Other'?(String(d.area_other||'').trim()||null):null};
    if(payload.area==='Other'&&!payload.area_other)return toast('Type the Other Area / City / Province.','error');
    const {error}=await sb.from('booking_pax').update(payload).eq('id',p.id);if(error)return toast(error.message,'error');
    await refreshOperations();toast('Pax information updated.');openPaxManagerV24(state.cache.bookings.find(x=>x.id===booking.id)||booking);
  };
}

// Override Add Pax with demographic fields.
openAddPaxV24=function(booking){
  openModal({title:'Add Companion / Pax',eyebrow:booking.booking_number,body:`<form id="v24AddPaxForm" class="modal-form">
    <label>Pax Type<select name="pax_type"><option value="adult">Adult</option><option value="kid">Kid</option><option value="baby">Baby</option><option value="senior">Senior</option><option value="pwd">PWD</option></select></label>
    <label>Name / Nickname<input name="display_name" placeholder="Full name not required"></label>
    <label>Gender<select name="gender">${v35GenderOptions('')}</select></label>
    <label>Area<select name="area" id="v35PaxArea">${v35AreaOptions('')}</select></label>
    <label id="v35OtherAreaWrap" class="hidden">Other Area / City / Province<input name="area_other" placeholder="Type location"></label>
    <label>Code Method<select name="code_method" id="v24CodeMethod"><option value="none">No code yet</option><option value="manual">Manual / Scan my own code</option><option value="auto">Auto Generate</option></select></label>
    <label>Barcode / QR / Code<input name="code" id="v24AddPaxCode" autocomplete="off" placeholder="Scan or type code"></label>
    <p class="tiny muted full">Area and gender are used for resort reports. If Other is selected, type the guest's city/municipality/province.</p>
  </form>`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v24SaveNewPax">Add Pax</button>`});
  $('[data-modal-cancel]').onclick=()=>openPaxManagerV24(booking);v35WireAreaOther();
  $('#v24CodeMethod').onchange=e=>{if(e.target.value==='auto')$('#v24AddPaxCode').value=v24RandomPaxCode();if(e.target.value==='none')$('#v24AddPaxCode').value='';if(e.target.value==='manual')setTimeout(()=>$('#v24AddPaxCode').focus(),50)};
  $('#v24AddPaxCode').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('#v24SaveNewPax').click()}};
  $('#v24SaveNewPax').onclick=async()=>{
    const fd=new FormData($('#v24AddPaxForm')),code=v24Norm(fd.get('code'))||null;
    if(code){const {data:dupe}=await sb.from('booking_pax').select('id').eq('code',code).maybeSingle();if(dupe)return toast('That Pax Code is already assigned.','error')}
    const area=fd.get('area')||null,areaOther=area==='Other'?(String(fd.get('area_other')||'').trim()||null):null;
    if(area==='Other'&&!areaOther)return toast('Type the Other Area / City / Province.','error');
    const payload={booking_id:booking.id,pax_type:fd.get('pax_type'),display_name:v24Norm(fd.get('display_name'))||null,gender:fd.get('gender')||null,area,area_other:areaOther,code,access_status:'not_checked_in'};
    const {error}=await sb.from('booking_pax').insert(payload);if(error)return toast(error.message,'error');
    await refreshOperations();toast('Companion/Pax added.');openPaxManagerV24(state.cache.bookings.find(x=>x.id===booking.id)||booking);
  };
};

// Override Pax Manager: demographics visible + Edit Info.
const v35PrevPaxManager=openPaxManagerV24;
openPaxManagerV24=async function(booking){
  await refreshOperations();
  const pax=autoSortRows('pax',(state.cache.pax||[]).filter(p=>p.booking_id===booking.id&&p.access_status!=='cancelled'));
  openModal({title:'Pax / Companion Barcode Manager',eyebrow:booking.booking_number,wide:true,body:`
    <div class="panel" style="margin-bottom:14px"><div class="panel-head"><div><h3>${esc(booking.guest_name||'Guest')}</h3><p class="muted">${esc(booking.booking_type||'booking')} · ${esc(booking.booking_number)}</p></div><button class="btn btn-primary" id="v24AddPaxBtn">Add Companion / Pax</button></div><p class="tiny muted">Name does not need to be a full legal name. Gender and Area feed the Pax Demographics report.</p></div>
    <div class="table-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Pax</th><th>Type</th><th>Gender</th><th>Area</th><th>Current Code</th><th>Status</th><th>Actions</th></tr></thead><tbody>
    ${pax.length?pax.map((p,i)=>`<tr><td><strong>${i+1}</strong></td><td>${esc(paxDisplayName(p)||`Pax ${i+1}`)}</td><td>${esc(p.pax_type||'adult')}</td><td>${esc(p.gender||'—')}</td><td>${esc(v35EffectiveArea(p))}</td><td><strong>${esc(p.code||'NO CODE')}</strong></td><td><span class="badge">${esc(p.access_status||'not_checked_in')}</span></td><td><div class="row-actions"><button data-v35-edit-info="${p.id}">Edit Info</button>${p.code?`<button data-v32-show-pax="${p.id}">Show QR</button>`:''}<button data-v24-manual="${p.id}">Manual Code</button><button data-v24-scan="${p.id}">Scan Code</button><button data-v24-auto="${p.id}">Auto Generate</button>${p.code?`<button data-v24-clear="${p.id}">Clear</button>`:''}</div></td></tr>`).join(''):'<tr><td colspan="8" class="empty-state">No pax records yet.</td></tr>'}
    </tbody></table></div></div>`,footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-primary" id="v32BookingBarcodeFromPax">Booking Barcode</button>`});
  $('[data-modal-cancel]').onclick=closeModal;$('#v24AddPaxBtn').onclick=()=>openAddPaxV24(booking);$('#v32BookingBarcodeFromPax').onclick=()=>openCodesModal(booking);
  $$('[data-v35-edit-info]').forEach(btn=>btn.onclick=()=>v35OpenPaxInfo(booking,state.cache.pax.find(x=>x.id===btn.dataset.v35EditInfo)));
  $$('[data-v32-show-pax]').forEach(btn=>btn.onclick=()=>v32OpenPaxQrModal(state.cache.pax.find(x=>x.id===btn.dataset.v32ShowPax),booking));
  $$('[data-v24-manual]').forEach(btn=>btn.onclick=()=>openManualPaxCodeV24(booking,state.cache.pax.find(x=>x.id===btn.dataset.v24Manual)));
  $$('[data-v24-scan]').forEach(btn=>btn.onclick=()=>openScanPaxCodeV24(booking,state.cache.pax.find(x=>x.id===btn.dataset.v24Scan)));
  $$('[data-v24-auto]').forEach(btn=>btn.onclick=()=>autoGeneratePaxCodeV24(booking,state.cache.pax.find(x=>x.id===btn.dataset.v24Auto)));
  $$('[data-v24-clear]').forEach(btn=>btn.onclick=()=>clearPaxCodeV24(booking,state.cache.pax.find(x=>x.id===btn.dataset.v24Clear)));
};

// ---------- ROOM KEY / ID DEPOSIT ----------
const V35_PRIMARY_IDS=['PhilSys National ID','Passport','Driver’s License','PRC ID','UMID'];
const V35_SECONDARY_IDS=['Postal ID','Voter’s ID','Senior Citizen ID','PWD ID','PhilHealth ID','TIN ID','School ID','Company ID','NBI Clearance','Police Clearance','Barangay ID / Certificate','PSA Birth Certificate','Marriage Certificate'];
function v35IdOptions(selected=''){
  const group=(label,arr)=>`<optgroup label="${label}">${arr.map(x=>`<option value="${esc(x)}" ${selected===x?'selected':''}>${esc(x)}</option>`).join('')}</optgroup>`;
  return `<option value="">No ID recorded</option>${group('Primary ID',V35_PRIMARY_IDS)}${group('Secondary ID',V35_SECONDARY_IDS)}<option value="Other" ${selected==='Other'?'selected':''}>Other ID</option>`;
}
function v35RoomDepositFields(b){
  return `<div class="panel full" style="margin-top:6px"><div class="panel-head"><div><h3>Room Key & ID Deposit</h3><p class="muted tiny">Record only the ID type, not the ID number. The client's ID may be held as security for the issued room key.</p></div></div><div class="modal-form">
    <label>Type of ID Provided<select name="id_provided_type" id="v35IdType">${v35IdOptions(b?.id_provided_type||'')}</select></label>
    <label id="v35OtherIdWrap" class="${b?.id_provided_type==='Other'?'':'hidden'}">Other ID Type<input name="id_provided_other" value="${esc(b?.id_provided_other||'')}" placeholder="Type ID name"></label>
    <label>Room Key Issued<input name="room_key_issued" value="${esc(b?.room_key_issued||'')}" placeholder="e.g. Room 2 Key A / Key #2"></label>
    <label>ID Deposit Status<select name="id_deposit_status"><option value="not_received">Not Received</option><option value="received">ID Received / Held</option><option value="returned">ID Returned</option></select></label>
    <label>Room Key Status<select name="room_key_status"><option value="not_issued">Not Issued</option><option value="issued">Key Issued</option><option value="returned">Key Returned</option><option value="lost">Key Lost</option></select></label>
  </div></div>`;
}

// Override Room/Cottage booking form by wrapping previous renderer and injecting room deposit controls before save.
const v35BaseOpenBooking=openBookingV21;
openBookingV21=function(type,id=null){
  v35BaseOpenBooking(type,id);
  if(type!=='room')return;
  const b=id?state.cache.bookings.find(x=>x.id===id):null,f=$('#v23BookingForm');if(!f)return;
  const holder=document.createElement('div');holder.className='full';holder.innerHTML=v35RoomDepositFields(b);f.appendChild(holder);
  const idType=$('#v35IdType'),otherWrap=$('#v35OtherIdWrap');
  const sync=()=>otherWrap?.classList.toggle('hidden',idType?.value!=='Other');if(idType){idType.onchange=sync;sync()}
  if(b){
    if(f.elements.id_deposit_status)f.elements.id_deposit_status.value=b.id_deposit_status||'not_received';
    if(f.elements.room_key_status)f.elements.room_key_status.value=b.room_key_status||'not_issued';
  }
  const oldSave=$('#v23SaveBooking').onclick;
  $('#v23SaveBooking').onclick=async()=>{
    // Run existing save first, but attach room-deposit fields by temporarily wrapping Supabase insert/update is avoided.
    // We perform a second update after the base save by locating the saved/current booking.
    const d=Object.fromEntries(new FormData(f).entries());
    const roomMeta={id_provided_type:d.id_provided_type||null,id_provided_other:d.id_provided_type==='Other'?(String(d.id_provided_other||'').trim()||null):null,room_key_issued:String(d.room_key_issued||'').trim()||null,id_deposit_status:d.id_deposit_status||'not_received',room_key_status:d.room_key_status||'not_issued'};
    if(roomMeta.id_provided_type==='Other'&&!roomMeta.id_provided_other)return toast('Type the Other ID Type.','error');
    // For edits, save metadata directly before original handler closes modal.
    if(id){const {error}=await sb.from('bookings').update(roomMeta).eq('id',id);if(error)return toast(error.message,'error');return oldSave();}
    // For new booking, let base handler create it then patch newest booking for this user/guest/date.
    await oldSave();
    setTimeout(async()=>{
      await refreshOperations();
      const candidates=(state.cache.bookings||[]).filter(x=>(x.booking_type==='room'||x.room_id)&&x.guest_name===String(d.guest_name||'').trim()&&x.check_in_date===d.check_in_date).sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
      const saved=candidates[0];if(saved){const {error}=await sb.from('bookings').update(roomMeta).eq('id',saved.id);if(!error){Object.assign(saved,roomMeta)}}
    },250);
  };
};

// ---------- PAX DEMOGRAPHICS REPORT ----------
function v35ReportPeriodPax(month){
  const year=String(month||currentMonth()).slice(0,4);
  const bookingMap=new Map((state.cache.bookings||[]).map(b=>[b.id,b]));
  const valid=(state.cache.pax||[]).filter(p=>p.access_status!=='cancelled'&&bookingMap.has(p.booking_id));
  const monthRows=valid.filter(p=>String(bookingMap.get(p.booking_id)?.check_in_date||bookingMap.get(p.booking_id)?.booking_date||'').slice(0,7)===month);
  const yearRows=valid.filter(p=>String(bookingMap.get(p.booking_id)?.check_in_date||bookingMap.get(p.booking_id)?.booking_date||'').slice(0,4)===year);
  return {monthRows,yearRows,bookingMap,year};
}
function v35GenderCounts(rows){const r={Male:0,Female:0,'LGBTQIA+':0,'Not specified':0};rows.forEach(p=>{const g=V35_GENDERS.includes(p.gender)?p.gender:'Not specified';r[g]++});return r}
function v35AreaCounts(rows){
  const map=new Map();rows.forEach(p=>{const a=v35EffectiveArea(p);map.set(a,(map.get(a)||0)+1)});return [...map.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
}
function v35OutsideNaic(rows){return rows.filter(p=>{const a=String(p.area||'').trim();return a&&a!=='Naic'}).length}
function v35DemographicReport(month){
  const {monthRows,yearRows,bookingMap,year}=v35ReportPeriodPax(month),mg=v35GenderCounts(monthRows),yg=v35GenderCounts(yearRows),areas=v35AreaCounts(monthRows);
  const monthBookings=new Set(monthRows.map(p=>p.booking_id)).size,yearBookings=new Set(yearRows.map(p=>p.booking_id)).size;
  $('#reportContent').innerHTML=`<div class="report-sheet">
    <div class="report-header"><div><p class="eyebrow">MASUSI FARM RESORT</p><h2>Pax Demographics & Area Report</h2><p class="muted">Selected month: ${esc(month)} · Year: ${esc(year)}</p></div><div><strong>Generated</strong><br>${new Date().toLocaleString('en-PH')}</div></div>
    <div class="report-kpis"><div class="report-kpi"><span>Pax This Month</span><strong>${monthRows.length}</strong><small>${monthBookings} bookings</small></div><div class="report-kpi"><span>Pax This Year</span><strong>${yearRows.length}</strong><small>${yearBookings} bookings</small></div><div class="report-kpi"><span>Outside Naic — Month</span><strong>${v35OutsideNaic(monthRows)}</strong><small>Known areas excluding Naic</small></div><div class="report-kpi"><span>Outside Naic — Year</span><strong>${v35OutsideNaic(yearRows)}</strong><small>Known areas excluding Naic</small></div></div>
    <div class="dashboard-grid" style="margin-top:16px"><div class="panel"><h3>Gender — Selected Month</h3><div class="report-kpis"><div class="report-kpi"><span>Male</span><strong>${mg.Male}</strong></div><div class="report-kpi"><span>Female</span><strong>${mg.Female}</strong></div><div class="report-kpi"><span>LGBTQIA+</span><strong>${mg['LGBTQIA+']}</strong></div><div class="report-kpi"><span>Not Specified</span><strong>${mg['Not specified']}</strong></div></div></div><div class="panel"><h3>Gender — ${esc(year)}</h3><div class="report-kpis"><div class="report-kpi"><span>Male</span><strong>${yg.Male}</strong></div><div class="report-kpi"><span>Female</span><strong>${yg.Female}</strong></div><div class="report-kpi"><span>LGBTQIA+</span><strong>${yg['LGBTQIA+']}</strong></div><div class="report-kpi"><span>Not Specified</span><strong>${yg['Not specified']}</strong></div></div></div></div>
    <div class="table-panel" style="margin-top:16px"><div class="panel-head" style="padding:14px 14px 0"><h3>Area Breakdown — Selected Month</h3><span class="muted tiny">All booked pax are counted, even if not yet checked in.</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Area</th><th>Pax</th><th>Naic / Outside Naic</th></tr></thead><tbody>${areas.length?areas.map(([a,n],i)=>`<tr><td>${i+1}</td><td><strong>${esc(a)}</strong></td><td>${n}</td><td>${a==='Naic'?'Naic':a==='Not specified'?'Unknown':'Outside Naic'}</td></tr>`).join(''):'<tr><td colspan="4" class="empty-state">No pax data for selected month.</td></tr>'}</tbody></table></div></div>
    <div class="table-panel" style="margin-top:16px"><div class="panel-head" style="padding:14px 14px 0"><h3>Pax Detail — Selected Month</h3></div><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Name</th><th>Type</th><th>Gender</th><th>Area</th><th>Booking</th><th>Check-in Date</th></tr></thead><tbody>${monthRows.length?monthRows.map((p,i)=>{const b=bookingMap.get(p.booking_id);return `<tr><td>${i+1}</td><td>${esc(paxDisplayName(p))}</td><td>${esc(p.pax_type||'—')}</td><td>${esc(p.gender||'Not specified')}</td><td>${esc(v35EffectiveArea(p))}</td><td>${esc(b?.booking_number||'—')}</td><td>${fmtDate(b?.check_in_date||b?.booking_date)}</td></tr>`}).join(''):'<tr><td colspan="7" class="empty-state">No pax data.</td></tr>'}</tbody></table></div></div>
  </div>`;
}

const v35BaseRunReport=runReport;
runReport=async function(){
  if($('#reportType')?.value==='pax_demographics'){
    await refreshOperations();return v35DemographicReport($('#reportsMonth').value||currentMonth());
  }
  return v35BaseRunReport();
};
$('#runReportBtn').onclick=runReport;$('#reportsMonth').onchange=runReport;$('#reportType').onchange=runReport;

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v36.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V3.6
   Professional Invoice and Report Printing
   ============================================================ */

function v36OpenPrintWindow(html){
  if(typeof v30OpenPrintWindow==='function') return v30OpenPrintWindow(html);
  const w=window.open('','_blank','width=1100,height=900');
  if(!w) return toast('Allow pop-ups first to print the document.','error');
  w.document.write(html); w.document.close();
}
function v36ResortName(){ return state.settings?.resort_name || window.MASUSI_CONFIG?.DEFAULT_RESORT_NAME || 'Masusi Farm Resort'; }
function v36LogoUrl(){ return state.settings?.logo_url || 'assets/logo-placeholder.svg'; }
function v36UnitForBooking(b){
  if(!b) return {label:'Unit', value:'—'};
  if(b.room_id){ const r=roomById(b.room_id); return {label:'Room', value:r?.name||r?.unit_number||'—'}; }
  if(b.cottage_id){ const c=cottageById(b.cottage_id); return {label:'Cottage', value:c?.name||c?.unit_number||'—'}; }
  return {label:'Unit', value:'—'};
}
function v36DocStyles(title='Document'){
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
  <style>
    :root{--brand:#0f6a4d;--brand2:#153f33;--line:#d7e2dc;--soft:#f5f9f6;--text:#17362d;--muted:#5f746b}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;background:#eef3ef;color:var(--text);font-family:Arial,sans-serif}
    .page{max-width:960px;margin:0 auto;padding:14mm}
    .sheet{background:#fff;border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 10px 34px rgba(18,44,35,.06)}
    .hero{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding:22px 26px;background:linear-gradient(180deg,#0f6a4d,#14513c);color:#fff}
    .brand{display:flex;gap:14px;align-items:center;min-width:0}
    .brand img{width:58px;height:58px;border-radius:50%;background:#fff;object-fit:contain;padding:5px}
    .brand h1{margin:0;font-size:28px;line-height:1.15}
    .brand p{margin:6px 0 0;font-size:14px;opacity:.95}
    .doc-meta{text-align:right;font-size:14px;line-height:1.5;min-width:220px}
    .doc-meta strong{display:block;font-size:13px;text-transform:uppercase;letter-spacing:.08em;opacity:.9}
    .content{padding:24px 26px}
    .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .card{border:1px solid var(--line);border-radius:14px;background:var(--soft);padding:14px 16px}
    .card .label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700}
    .card .value{font-size:21px;font-weight:800;color:#102b22;margin-top:6px;word-break:break-word}
    .section{margin-top:22px}
    .section h2{margin:0 0 12px;font-size:18px;color:#15362b}
    table{width:100%;border-collapse:collapse}
    thead th{background:#eff6f1;color:#456158;font-size:12px;text-transform:uppercase;letter-spacing:.05em;text-align:left;padding:11px 12px;border-bottom:1px solid var(--line)}
    tbody td{padding:11px 12px;border-bottom:1px solid #edf2ee;vertical-align:top}
    tbody tr:last-child td{border-bottom:none}
    .num{text-align:right;white-space:nowrap}
    .summary{margin-left:auto;max-width:360px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fcfefd}
    .summary-row{display:flex;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid #ebf1ed}
    .summary-row:last-child{border-bottom:none}
    .summary-row.total{background:#0f6a4d;color:#fff;font-weight:800;font-size:18px}
    .summary-row.total small{color:#fff;opacity:.9}
    .muted{color:var(--muted)}
    .badge{display:inline-block;padding:6px 10px;border-radius:999px;background:#eaf3ed;color:#1c4e3c;font-size:12px;font-weight:700;text-transform:uppercase}
    .kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:18px}
    .kpi{border:1px solid var(--line);border-radius:14px;background:#fbfdfb;padding:14px}
    .kpi span{display:block;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:700}
    .kpi strong{display:block;margin-top:7px;font-size:24px;color:#102b22}
    .note{border:1px dashed #c9d8d0;background:#fbfdfb;border-radius:12px;padding:12px 14px;color:#536961;margin-top:14px}
    .sign-row{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:32px}
    .sign-box{padding-top:32px;border-top:1px solid #bccdc4;font-size:14px;color:#5f746b;text-align:center}
    .footer-note{font-size:13px;color:#6a7d75;text-align:center;padding:16px 26px 24px}
    @media print{
      @page{size:auto;margin:10mm}
      html,body{background:#fff}
      .page{padding:0;max-width:none}
      .sheet{border:none;border-radius:0;box-shadow:none}
      .hero{print-color-adjust:exact;-webkit-print-color-adjust:exact}
      thead th{print-color-adjust:exact;-webkit-print-color-adjust:exact}
      .summary-row.total{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    }
  </style></head><body>`;
}

function v36InvoiceHtml(inv){
  const b=(state.cache.bookings||[]).find(x=>x.id===inv.booking_id);
  const unit=v36UnitForBooking(b);
  const charges=b?bookingCharges(b.id):[];
  const payments=b?bookingPayments(b.id):[];
  const base=Number(inv.subtotal||b?.base_amount||b?.total_amount||0);
  const discount=Number(inv.discount_total||b?.discount_amount||0);
  const total=Number(inv.total_amount||Math.max(0, base-discount));
  const paid=Number(inv.paid_amount||payments.reduce((s,x)=>s+Number(x.amount||0),0));
  const balance=Number(inv.balance||Math.max(0,total-paid));
  const bookingType=b?.booking_type==='room' ? 'Room Booking' : b?.booking_type==='cottage_swim' ? 'Cottage + Swimming Booking' : 'Booking';
  const baseLabel=b?.booking_type==='room' ? 'Room Accommodation' : 'Base Booking';
  const lineRows=[];
  lineRows.push({item:baseLabel, desc:`${bookingType}${b?.check_in_date?` · ${fmtDate(b.check_in_date)}`:''}${b?.check_out_date?` to ${fmtDate(b.check_out_date)}`:''}`, qty:1, unit:base, amount:base});
  charges.forEach((c,i)=> lineRows.push({item:c.charge_type||`Charge ${i+1}`, desc:c.description||'Additional charge', qty:Number(c.quantity||1), unit:Number(c.unit_price||c.amount||0), amount:Number(c.amount||0)-Number(c.discount_amount||0)}));
  const paymentRows=payments.map((p,i)=>({no:i+1,date:p.payment_date,method:p.method||'Payment',ref:p.reference_number||'',amount:Number(p.amount||0)}));
  return `${v36DocStyles(inv.invoice_number||'Invoice')}
  <div class="page"><div class="sheet">
    <div class="hero">
      <div class="brand">
        <img src="${v36LogoUrl()}" alt="Logo" onerror="this.style.display='none'">
        <div>
          <h1>${esc(v36ResortName())}</h1>
          <p>Professional Guest Invoice</p>
        </div>
      </div>
      <div class="doc-meta">
        <strong>Invoice Number</strong>
        <div>${esc(inv.invoice_number||'—')}</div>
        <strong style="margin-top:10px">Invoice Date</strong>
        <div>${fmtDate(inv.invoice_date||today())}</div>
        <strong style="margin-top:10px">Status</strong>
        <div><span class="badge">${esc(inv.status||'open')}</span></div>
      </div>
    </div>
    <div class="content">
      <div class="grid-2">
        <div class="card"><div class="label">Billed To</div><div class="value">${esc(b?.guest_name||'Guest')}</div><div class="muted">${esc(b?.booking_number||'No Booking Number')}</div></div>
        <div class="card"><div class="label">${esc(unit.label)}</div><div class="value">${esc(unit.value)}</div><div class="muted">${esc(bookingType)}</div></div>
      </div>
      <div class="kpis">
        <div class="kpi"><span>Subtotal</span><strong>${money(base)}</strong></div>
        <div class="kpi"><span>Discount</span><strong>${money(discount)}</strong></div>
        <div class="kpi"><span>Paid</span><strong>${money(paid)}</strong></div>
        <div class="kpi"><span>Balance</span><strong>${money(balance)}</strong></div>
      </div>
      <div class="section">
        <h2>Invoice Items</h2>
        <table>
          <thead><tr><th style="width:28%">Item</th><th>Description</th><th class="num">Qty</th><th class="num">Unit Price</th><th class="num">Amount</th></tr></thead>
          <tbody>
            ${lineRows.map(r=>`<tr><td><strong>${esc(r.item)}</strong></td><td>${esc(r.desc||'—')}</td><td class="num">${esc(r.qty)}</td><td class="num">${money(r.unit)}</td><td class="num"><strong>${money(r.amount)}</strong></td></tr>`).join('') || '<tr><td colspan="5">No charge items found.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="section" style="display:flex;justify-content:space-between;gap:20px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1 1 360px">
          <h2>Payment History</h2>
          ${paymentRows.length ? `<table><thead><tr><th>#</th><th>Date</th><th>Method</th><th>Reference</th><th class="num">Amount</th></tr></thead><tbody>${paymentRows.map(r=>`<tr><td>${r.no}</td><td>${fmtDate(r.date)}</td><td>${esc(r.method)}</td><td>${esc(r.ref||'—')}</td><td class="num"><strong>${money(r.amount)}</strong></td></tr>`).join('')}</tbody></table>` : '<div class="note">No payments have been recorded for this invoice yet.</div>'}
          ${inv.notes ? `<div class="note"><strong>Notes:</strong> ${esc(inv.notes)}</div>` : ''}
        </div>
        <div class="summary">
          <div class="summary-row"><span>Subtotal</span><strong>${money(base)}</strong></div>
          <div class="summary-row"><span>Discount</span><strong>- ${money(discount)}</strong></div>
          <div class="summary-row"><span>Total Amount</span><strong>${money(total)}</strong></div>
          <div class="summary-row"><span>Paid Amount</span><strong>${money(paid)}</strong></div>
          <div class="summary-row total"><span>Balance Due</span><strong>${money(balance)}</strong></div>
        </div>
      </div>
      <div class="sign-row">
        <div class="sign-box">Prepared by</div>
        <div class="sign-box">Received by Guest</div>
      </div>
    </div>
    <div class="footer-note">This invoice was generated by ${esc(v36ResortName())}. Please keep this document for your records.</div>
  </div></div><script>window.onload=()=>setTimeout(()=>window.print(),180);<\/script></body></html>`;
}

function v36PrintInvoice(inv){
  if(!inv) return toast('Invoice not found.','error');
  v36OpenPrintWindow(v36InvoiceHtml(inv));
}

function v36ReportData(type,m){
  let rows=[], title='';
  if(type==='bookings'){ rows=state.cache.bookings.filter(x=>(x.check_in_date||x.booking_date||'').slice(0,7)===m); title='Booking Report'; }
  if(type==='payments'){ rows=state.cache.payments.filter(x=>(x.payment_date||'').slice(0,7)===m && x.is_void!==true); title='Payment Report'; }
  if(type==='expenses'){ rows=state.cache.expenses.filter(x=>(x.expense_date||'').slice(0,7)===m); title='Expense Report'; }
  if(type==='damages'){ rows=state.cache.damages.filter(x=>(x.damage_date||'').slice(0,7)===m); title='Damage Report'; }
  if(type==='repairs'){ rows=state.cache.repairs.filter(x=>(x.repair_date||'').slice(0,7)===m); title='Repair Report'; }
  if(type==='occupancy'){ rows=state.cache.bookings.filter(x=>(x.check_in_date||'').slice(0,7)===m); title='Occupancy Report'; }
  if(type==='pax_demographics'){
    const {monthRows,yearRows,bookingMap,year}=v35ReportPeriodPax(m), mg=v35GenderCounts(monthRows), areas=v35AreaCounts(monthRows);
    return {
      type,title:'Pax Demographics & Area Report',month:m,rows:monthRows,
      kpis:[
        {label:'Pax This Month', value:monthRows.length, note:`${new Set(monthRows.map(p=>p.booking_id)).size} bookings`},
        {label:'Pax This Year', value:yearRows.length, note:`${new Set(yearRows.map(p=>p.booking_id)).size} bookings`},
        {label:'Outside Naic', value:v35OutsideNaic(monthRows), note:'Selected month'},
        {label:'Year', value:year, note:'Report year'}
      ],
      sections:[
        {title:'Gender Summary', table:{cols:['Category','Count'], rows:[['Male',mg.Male],['Female',mg.Female],['LGBTQIA+',mg['LGBTQIA+']],['Not Specified',mg['Not specified']]]}},
        {title:'Area Summary', table:{cols:['Area','Count'], rows:Object.entries(areas).sort((a,b)=>b[1]-a[1])}},
        {title:'Pax Details', table:{cols:['Pax Name','Gender','Area','Booking','Guest'], rows:monthRows.map(p=>[p.display_name||paxDisplayName(p), p.gender||'Not specified', p.area_name || p.area || 'Not specified', bookingMap[p.booking_id]?.booking_number||'—', bookingMap[p.booking_id]?.guest_name||'Guest'])}}
      ]
    };
  }
  const amount = type==='payments' ? rows.reduce((s,x)=>s+Number(x.amount||0),0)
               : type==='expenses' ? rows.reduce((s,x)=>s+Number(x.amount||0),0)
               : type==='bookings' ? rows.reduce((s,x)=>s+Number(x.total_amount||0),0)
               : 0;
  let cols=[];
  if(type==='bookings') cols=['booking_number','guest_name','status','check_in_date','check_out_date','adults','kids','babies','total_amount','balance'];
  else if(type==='payments') cols=['payment_date','booking_id','method','reference_number','amount','notes'];
  else if(type==='expenses') cols=['expense_date','category','description','paid_to','reference_number','amount'];
  else if(type==='damages') cols=['damage_number','damage_date','unit_type','unit_reference','guest_name','status','actual_cost','guest_charge'];
  else if(type==='repairs') cols=['repair_date','description','technician','status','labor_cost','material_cost'];
  else if(type==='occupancy') cols=['booking_number','guest_name','status','check_in_date','check_out_date','room_id','cottage_id','adults','kids','babies'];
  return {type,title,month:m,rows,amount,cols,
    kpis:[
      {label:'Records', value:rows.length, note:title},
      {label:'Amount', value:money(amount), note:type==='payments'?'Total collections':type==='expenses'?'Total expenses':type==='bookings'?'Booked amount':'No amount summary'},
      {label:'Generated', value:new Date().toLocaleDateString('en-PH'), note:'Print date'},
      {label:'Period', value:m, note:'Selected month'}
    ]
  };
}

function v36FormatReportCell(type,col,row){
  let v=row[col];
  if(v===null||v===undefined||v==='') return '—';
  if(col==='room_id'){ const r=roomById(v); return esc(r?.name||r?.unit_number||'—'); }
  if(col==='cottage_id'){ const c=cottageById(v); return esc(c?.name||c?.unit_number||'—'); }
  if(col==='booking_id'){ const b=(state.cache.bookings||[]).find(x=>x.id===v); return esc(b?.booking_number||String(v)); }
  if(/date/.test(col)) return fmtDate(v);
  if(/amount|cost|balance|rate|total/.test(col)) return money(v);
  return esc(v);
}

function v36ReportHtml(data){
  const sectionHtml = data.type==='pax_demographics'
    ? data.sections.map(sec=>`<div class="section"><h2>${esc(sec.title)}</h2><table><thead><tr>${sec.table.cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${sec.table.rows.length?sec.table.rows.map(r=>`<tr>${r.map((c,i)=>`<td${i===sec.table.rows[0].length-1&&typeof c==='number'?' class="num"':''}>${esc(c)}</td>`).join('')}</tr>`).join(''):'<tr><td colspan="99">No data for selected month.</td></tr>'}</tbody></table></div>`).join('')
    : `<div class="section"><h2>${esc(data.title)} Details</h2><table><thead><tr>${data.cols.map(c=>`<th>${esc(c.replaceAll('_',' '))}</th>`).join('')}</tr></thead><tbody>${data.rows.length?data.rows.map(r=>`<tr>${data.cols.map(c=>`<td>${v36FormatReportCell(data.type,c,r)}</td>`).join('')}</tr>`).join(''):'<tr><td colspan="99">No records found for selected month.</td></tr>'}</tbody></table></div>`;
  return `${v36DocStyles(data.title)}
  <div class="page"><div class="sheet">
    <div class="hero">
      <div class="brand"><img src="${v36LogoUrl()}" alt="Logo" onerror="this.style.display='none'"><div><h1>${esc(v36ResortName())}</h1><p>Professional Management Report</p></div></div>
      <div class="doc-meta"><strong>Report Title</strong><div>${esc(data.title)}</div><strong style="margin-top:10px">Month</strong><div>${esc(data.month)}</div><strong style="margin-top:10px">Generated</strong><div>${new Date().toLocaleString('en-PH')}</div></div>
    </div>
    <div class="content">
      <div class="kpis">${(data.kpis||[]).map(k=>`<div class="kpi"><span>${esc(k.label)}</span><strong>${esc(k.value)}</strong><div class="muted" style="margin-top:6px;font-size:12px">${esc(k.note||'')}</div></div>`).join('')}</div>
      ${sectionHtml}
      <div class="sign-row"><div class="sign-box">Prepared by</div><div class="sign-box">Checked / Approved by</div></div>
    </div>
    <div class="footer-note">This report was generated from the ${esc(v36ResortName())} management system.</div>
  </div></div><script>window.onload=()=>setTimeout(()=>window.print(),180);<\/script></body></html>`;
}

async function v36PrintCurrentReport(){
  await refreshOperations();
  const type=$('#reportType')?.value || 'bookings';
  const month=$('#reportsMonth')?.value || currentMonth();
  const data=v36ReportData(type,month);
  v36OpenPrintWindow(v36ReportHtml(data));
}

// Make Reports use a proper print document instead of printing the screen section.
setTimeout(()=>{
  if($('#printReportBtn')){
    $('#printReportBtn').textContent='Professional Print';
    $('#printReportBtn').onclick=v36PrintCurrentReport;
  }
},0);

// Override invoice view modal to provide a professional invoice preview + print.
const v36BaseOpenRecord = openRecord;
openRecord = async function(name,id,edit=false){
  if(name==='invoices' && !edit){
    const rec=(state.cache.invoices||[]).find(x=>x.id===id);
    if(!rec) return toast('Invoice record not found.','error');
    const b=(state.cache.bookings||[]).find(x=>x.id===rec.booking_id);
    const unit=v36UnitForBooking(b);
    const charges=b?bookingCharges(b.id):[];
    const payments=b?bookingPayments(b.id):[];
    openModal({
      title:rec.invoice_number || 'Invoice',
      eyebrow:'PROFESSIONAL INVOICE PREVIEW',
      wide:true,
      body:`<div class="dashboard-grid">
        <div class="panel">
          <div class="panel-head"><h3>Invoice Summary</h3></div>
          <p><strong>Invoice No.:</strong> ${esc(rec.invoice_number||'—')}</p>
          <p><strong>Invoice Date:</strong> ${fmtDate(rec.invoice_date||today())}</p>
          <p><strong>Guest:</strong> ${esc(b?.guest_name||'Guest')}</p>
          <p><strong>Booking No.:</strong> ${esc(b?.booking_number||'—')}</p>
          <p><strong>${esc(unit.label)}:</strong> ${esc(unit.value)}</p>
          <p><strong>Status:</strong> <span class="badge">${esc(rec.status||'open')}</span></p>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>Amounts</h3></div>
          <div class="report-kpis">
            <div class="report-kpi"><span>Subtotal</span><strong>${money(rec.subtotal||0)}</strong></div>
            <div class="report-kpi"><span>Discount</span><strong>${money(rec.discount_total||0)}</strong></div>
            <div class="report-kpi"><span>Total</span><strong>${money(rec.total_amount||0)}</strong></div>
            <div class="report-kpi"><span>Balance</span><strong>${money(rec.balance||0)}</strong></div>
          </div>
          <p class="tiny muted" style="margin-top:10px">Use Professional Print to generate the formal invoice document.</p>
        </div>
      </div>
      <div class="dashboard-grid" style="margin-top:14px">
        <div class="table-panel"><div class="panel-head" style="padding:14px 14px 0"><h3>Charges</h3></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody>${charges.length?charges.map(c=>`<tr><td>${esc(c.description||c.charge_type||'Charge')}</td><td>${esc(c.quantity||1)}</td><td>${money(c.unit_price||c.amount||0)}</td><td><strong>${money(Number(c.amount||0)-Number(c.discount_amount||0))}</strong></td></tr>`).join(''):`<tr><td colspan="4" class="empty-state">No additional charges.</td></tr>`}</tbody></table></div></div>
        <div class="table-panel"><div class="panel-head" style="padding:14px 14px 0"><h3>Payments</h3></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead><tbody>${payments.length?payments.map(p=>`<tr><td>${fmtDate(p.payment_date)}</td><td>${esc(p.method||'Payment')}</td><td>${esc(p.reference_number||'—')}</td><td><strong>${money(p.amount||0)}</strong></td></tr>`).join(''):`<tr><td colspan="4" class="empty-state">No payments yet.</td></tr>`}</tbody></table></div></div>
      </div>
      ${rec.notes?`<div class="panel" style="margin-top:14px"><div class="panel-head"><h3>Notes</h3></div><p>${esc(rec.notes)}</p></div>`:''}`,
      footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-soft" id="v36OpenBookingFromInvoice">Open Booking</button><button class="btn btn-primary" id="v36PrintInvoiceBtn">Professional Print</button>`
    });
    $('[data-modal-cancel]').onclick=closeModal;
    $('#v36PrintInvoiceBtn').onclick=()=>v36PrintInvoice(rec);
    $('#v36OpenBookingFromInvoice').onclick=()=>{ closeModal(); if(b){ navigate('bookings'); setTimeout(()=>openRecord('bookings', b.id), 50); } };
    return;
  }
  return v36BaseOpenRecord(name,id,edit);
};

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v37.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V3.7
   SYSTEM-WIDE PROFESSIONAL REPORTS
   Monthly + Whole-Year report periods
   ============================================================ */

const V37_PAGE_TITLES = {
  dashboard:'Dashboard Management Report',
  live:'Live Rooms & Cottages Report',
  availability:'Availability Report',
  'cottage-bookings':'Cottage + Swimming Booking Report',
  'room-bookings':'Room Booking Report',
  bookings:'All Bookings Report',
  rooms:'Rooms Report',
  cottages:'Cottages Report',
  guests:'Guest Report',
  barcode:'Barcode / Access Report',
  pos:'Store / POS Report',
  services:'Services Library Report',
  rates:'Rates & Pricing Report',
  billing:'Billing / Charges Report',
  payments:'Payment Report',
  invoices:'Invoice Report',
  expenses:'Expense Report',
  damages:'Damage Report',
  repairs:'Repair Report',
  inventory:'Inventory Report',
  users:'Users Report',
  roles:'Roles & Access Report',
  audit:'Audit Log Report',
  reports:'Management Report',
  settings:'Settings Summary'
};

function v37CurrentYear(){ return String(new Date().getFullYear()); }
function v37MonthValue(){ return $('#reportsMonth')?.value || currentMonth(); }
function v37YearValue(){ return $('#reportsYear')?.value || v37MonthValue().slice(0,4) || v37CurrentYear(); }
function v37Period(mode='month', month=v37MonthValue(), year=v37YearValue()){
  if(mode==='year'){
    const y=String(year||v37CurrentYear());
    return {mode:'year',start:`${y}-01-01`,end:`${y}-12-31`,label:`Whole Year ${y}`,year:y,month:null};
  }
  const m=String(month||currentMonth());
  const [y,mo]=m.split('-').map(Number);
  const last=new Date(y,mo,0).getDate();
  return {mode:'month',start:`${m}-01`,end:`${m}-${String(last).padStart(2,'0')}`,label:new Date(`${m}-01T00:00:00`).toLocaleDateString('en-PH',{month:'long',year:'numeric'}),year:String(y),month:m};
}
function v37DateInPeriod(value,p){
  if(!value)return false;
  const s=String(value).slice(0,10);
  return s>=p.start && s<=p.end;
}
function v37Money(v){ return money(Number(v||0)); }
function v37CleanLabel(k){ return String(k||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase()); }

function v37PopulateYears(){
  const sel=$('#reportsYear'); if(!sel)return;
  const years=new Set([v37CurrentYear()]);
  (state.cache.bookings||[]).forEach(b=>{
    const d=b.check_in_date||b.booking_date||b.created_at;
    if(d)years.add(String(d).slice(0,4));
  });
  (state.cache.payments||[]).forEach(x=>{ if(x.payment_date)years.add(String(x.payment_date).slice(0,4)); });
  (state.cache.expenses||[]).forEach(x=>{ if(x.expense_date)years.add(String(x.expense_date).slice(0,4)); });
  const arr=[...years].filter(Boolean).sort((a,b)=>Number(b)-Number(a));
  const current=sel.value||v37CurrentYear();
  sel.innerHTML=arr.map(y=>`<option value="${y}" ${y===current?'selected':''}>${y}</option>`).join('');
}

function v37SyncReportPeriodControls(){
  const mode=$('#reportPeriodMode')?.value||'month';
  if($('#reportsMonth')) $('#reportsMonth').style.display=mode==='month'?'':'none';
  if($('#reportsYear')) $('#reportsYear').style.display=mode==='year'?'':'none';
}

async function v37Fetch(table){
  try{
    const {data,error}=await sb.from(table).select('*');
    if(error) return [];
    return data||[];
  }catch(e){ return []; }
}

function v37BookingUnit(b){
  if(b?.room_id){const r=roomById(b.room_id);return r?.name||r?.unit_number||'—';}
  if(b?.cottage_id){const c=cottageById(b.cottage_id);return c?.name||c?.unit_number||'—';}
  return '—';
}

async function v37GetPageReport(page,p){
  const bookingRows=(state.cache.bookings||[]).filter(b=>v37DateInPeriod(b.check_in_date||b.booking_date,p));
  const paymentRows=(state.cache.payments||[]).filter(x=>x.is_void!==true && v37DateInPeriod(x.payment_date||x.created_at,p));
  const expenseRows=(state.cache.expenses||[]).filter(x=>v37DateInPeriod(x.expense_date||x.created_at,p));

  if(page==='dashboard'){
    const pax=bookingRows.reduce((s,b)=>s+Number(b.adults||0)+Number(b.kids||0)+Number(b.babies||0),0);
    const collections=paymentRows.reduce((s,x)=>s+Number(x.amount||0),0);
    const expenses=expenseRows.reduce((s,x)=>s+Number(x.amount||0),0);
    return {
      title:V37_PAGE_TITLES[page],period:p,
      kpis:[
        ['Bookings',bookingRows.length,'Selected period'],
        ['Booked Pax',pax,'Adults + Kids + Babies'],
        ['Collections',v37Money(collections),'Payments received'],
        ['Net Cash',v37Money(collections-expenses),'Collections less expenses']
      ],
      tables:[
        {title:'Bookings Summary',cols:['Booking No.','Guest','Unit','Check-in','Status','Pax','Total','Balance'],rows:bookingRows.map(b=>[
          b.booking_number||'—',b.guest_name||'Guest',v37BookingUnit(b),fmtDate(b.check_in_date),b.status||'—',
          Number(b.adults||0)+Number(b.kids||0)+Number(b.babies||0),v37Money(b.total_amount||0),v37Money(b.balance||0)
        ])}
      ]
    };
  }

  if(['bookings','cottage-bookings','room-bookings'].includes(page)){
    let rows=bookingRows;
    if(page==='cottage-bookings') rows=rows.filter(b=>(b.booking_type||(!b.room_id?'cottage_swim':''))==='cottage_swim');
    if(page==='room-bookings') rows=rows.filter(b=>(b.booking_type|| (b.room_id?'room':''))==='room');
    const total=rows.reduce((s,b)=>s+Number(b.total_amount||0),0);
    const balance=rows.reduce((s,b)=>s+Number(b.balance||0),0);
    const pax=rows.reduce((s,b)=>s+Number(b.adults||0)+Number(b.kids||0)+Number(b.babies||0),0);
    return {
      title:V37_PAGE_TITLES[page],period:p,
      kpis:[['Bookings',rows.length,'Selected period'],['Pax',pax,'Booked pax'],['Booked Amount',v37Money(total),'Net booking totals'],['Outstanding',v37Money(balance),'Open balance']],
      tables:[{title:'Booking Details',cols:['#','Booking No.','Guest','Room / Cottage','Check-in','Check-out','Status','Pax','Total','Balance'],
        rows:rows.map((b,i)=>[i+1,b.booking_number||'—',b.guest_name||'Guest',v37BookingUnit(b),fmtDate(b.check_in_date),fmtDate(b.check_out_date),b.status||'—',Number(b.adults||0)+Number(b.kids||0)+Number(b.babies||0),v37Money(b.total_amount||0),v37Money(b.balance||0)])}]
    };
  }

  if(page==='payments'){
    const total=paymentRows.reduce((s,x)=>s+Number(x.amount||0),0);
    const methods={};paymentRows.forEach(x=>methods[x.method||'Other']=(methods[x.method||'Other']||0)+Number(x.amount||0));
    return {
      title:V37_PAGE_TITLES[page],period:p,
      kpis:[['Payments',paymentRows.length,'Transactions'],['Collections',v37Money(total),'Selected period'],['Methods',Object.keys(methods).length,'Payment methods'],['Average',v37Money(paymentRows.length?total/paymentRows.length:0),'Per payment']],
      tables:[
        {title:'Payment Transactions',cols:['#','Date','Booking','Method','Reference','Amount'],rows:paymentRows.map((x,i)=>{const b=(state.cache.bookings||[]).find(b=>b.id===x.booking_id);return[i+1,fmtDate(x.payment_date),b?.booking_number||'—',x.method||'—',x.reference_number||'—',v37Money(x.amount)]})},
        {title:'Payment Method Summary',cols:['Method','Amount'],rows:Object.entries(methods).map(([k,v])=>[k,v37Money(v)])}
      ]
    };
  }

  if(page==='expenses'){
    const total=expenseRows.reduce((s,x)=>s+Number(x.amount||0),0);
    const cats={};expenseRows.forEach(x=>cats[x.category||'Uncategorized']=(cats[x.category||'Uncategorized']||0)+Number(x.amount||0));
    return {
      title:V37_PAGE_TITLES[page],period:p,
      kpis:[['Expenses',expenseRows.length,'Transactions'],['Total Expenses',v37Money(total),'Selected period'],['Categories',Object.keys(cats).length,'Expense categories'],['Average',v37Money(expenseRows.length?total/expenseRows.length:0),'Per expense']],
      tables:[
        {title:'Expense Transactions',cols:['#','Date','Category','Description','Paid To','Reference','Amount'],rows:expenseRows.map((x,i)=>[i+1,fmtDate(x.expense_date),x.category||'—',x.description||'—',x.paid_to||'—',x.reference_number||'—',v37Money(x.amount)])},
        {title:'Category Summary',cols:['Category','Amount'],rows:Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,v37Money(v)])}
      ]
    };
  }

  if(page==='invoices'){
    const all=state.cache.invoices||await v37Fetch('invoices');
    const rows=all.filter(x=>v37DateInPeriod(x.invoice_date||x.created_at,p));
    const total=rows.reduce((s,x)=>s+Number(x.total_amount||0),0), paid=rows.reduce((s,x)=>s+Number(x.paid_amount||0),0), bal=rows.reduce((s,x)=>s+Number(x.balance||0),0);
    return {
      title:V37_PAGE_TITLES[page],period:p,
      kpis:[['Invoices',rows.length,'Selected period'],['Invoice Total',v37Money(total),'Gross invoiced'],['Paid',v37Money(paid),'Recorded paid'],['Balance',v37Money(bal),'Outstanding']],
      tables:[{title:'Invoice Register',cols:['#','Invoice No.','Date','Booking','Status','Total','Paid','Balance'],rows:rows.map((x,i)=>{const b=(state.cache.bookings||[]).find(b=>b.id===x.booking_id);return[i+1,x.invoice_number||'—',fmtDate(x.invoice_date),b?.booking_number||'—',x.status||'—',v37Money(x.total_amount),v37Money(x.paid_amount),v37Money(x.balance)]})}]
    };
  }

  if(page==='billing'){
    const all=state.cache.charges||await v37Fetch('charges');
    const rows=all.filter(x=>v37DateInPeriod(x.charge_date||x.created_at,p));
    const total=rows.reduce((s,x)=>s+Number(x.amount||0)-Number(x.discount_amount||0),0);
    return {
      title:V37_PAGE_TITLES[page],period:p,
      kpis:[['Charges',rows.length,'Billing lines'],['Net Charges',v37Money(total),'After charge discounts'],['Bookings',new Set(rows.map(x=>x.booking_id).filter(Boolean)).size,'Affected bookings'],['Average',v37Money(rows.length?total/rows.length:0),'Per charge']],
      tables:[{title:'Charge Register',cols:['#','Date','Booking','Type','Description','Qty','Unit Price','Net Amount'],rows:rows.map((x,i)=>{const b=(state.cache.bookings||[]).find(b=>b.id===x.booking_id);return[i+1,fmtDate(x.charge_date),b?.booking_number||'—',x.charge_type||'—',x.description||'—',x.quantity||1,v37Money(x.unit_price),v37Money(Number(x.amount||0)-Number(x.discount_amount||0))]})}]
    };
  }

  if(page==='damages'){
    const all=state.cache.damages||[];
    const rows=all.filter(x=>v37DateInPeriod(x.damage_date||x.created_at,p));
    return {
      title:V37_PAGE_TITLES[page],period:p,
      kpis:[['Damage Reports',rows.length,'Selected period'],['Estimated Cost',v37Money(rows.reduce((s,x)=>s+Number(x.estimated_cost||0),0)),'Total estimate'],['Actual Cost',v37Money(rows.reduce((s,x)=>s+Number(x.actual_cost||0),0)),'Total actual'],['Guest Charges',v37Money(rows.reduce((s,x)=>s+Number(x.guest_charge||0),0)),'Chargeable to guests']],
      tables:[{title:'Damage Register',cols:['#','Damage No.','Date','Unit','Guest','Description','Status','Actual Cost','Guest Charge'],rows:rows.map((x,i)=>[i+1,x.damage_number||'—',fmtDate(x.damage_date),x.unit_reference||x.unit_type||'—',x.guest_name||'—',x.description||'—',x.status||'—',v37Money(x.actual_cost),v37Money(x.guest_charge)])}]
    };
  }

  if(page==='repairs'){
    const all=state.cache.repairs||[];
    const rows=all.filter(x=>v37DateInPeriod(x.repair_date||x.created_at,p));
    const labor=rows.reduce((s,x)=>s+Number(x.labor_cost||0),0),mat=rows.reduce((s,x)=>s+Number(x.material_cost||0),0);
    return {
      title:V37_PAGE_TITLES[page],period:p,
      kpis:[['Repairs',rows.length,'Selected period'],['Labor',v37Money(labor),'Labor cost'],['Materials',v37Money(mat),'Material cost'],['Total Cost',v37Money(labor+mat),'Combined']],
      tables:[{title:'Repair Register',cols:['#','Date','Description','Technician','Status','Labor','Materials','Total'],rows:rows.map((x,i)=>[i+1,fmtDate(x.repair_date),x.description||'—',x.technician||'—',x.status||'—',v37Money(x.labor_cost),v37Money(x.material_cost),v37Money(Number(x.labor_cost||0)+Number(x.material_cost||0))])}]
    };
  }

  if(page==='rooms' || page==='cottages'){
    const rows=(page==='rooms'?state.cache.rooms:state.cache.cottages)||[];
    return {
      title:V37_PAGE_TITLES[page],period:null,
      kpis:[['Total Units',rows.length,'Current master list'],['Active',rows.filter(x=>x.is_active!==false).length,'Active units'],['Available',rows.filter(x=>x.status==='available').length,'Current status'],['Capacity',rows.reduce((s,x)=>s+Number(x.capacity||0),0),'Combined capacity']],
      tables:[{title:'Current Unit Register',cols:['#','Unit','Type','Capacity','Base Rate','Extra Person Rate','Status','Active'],rows:rows.map((x,i)=>[i+1,x.name||x.unit_number||'—',x.room_type||x.cottage_type||'—',x.capacity||0,v37Money(x.base_rate),v37Money(x.extra_person_rate),x.status||'—',x.is_active===false?'No':'Yes'])}]
    };
  }

  if(page==='inventory'){
    const rows=state.cache.inventory||[];
    const totalCost=rows.reduce((s,x)=>s+Number(x.quantity||0)*Number(x.cost||0),0);
    return {
      title:V37_PAGE_TITLES[page],period:null,
      kpis:[['Items',rows.length,'Inventory lines'],['Total Qty',rows.reduce((s,x)=>s+Number(x.quantity||0),0),'All units'],['Damaged/Repair',rows.filter(x=>['damaged','repair'].includes(x.condition)).length,'Needs attention'],['Stock Value',v37Money(totalCost),'Qty × cost']],
      tables:[{title:'Inventory Register',cols:['#','Code','Item','Category','Qty','Unit','Location','Condition','Cost'],rows:rows.map((x,i)=>[i+1,x.item_code||'—',x.name||'—',x.category||'—',x.quantity||0,x.unit||'—',x.location||'—',x.condition||'—',v37Money(x.cost)])}]
    };
  }

  if(page==='services'){
    const rows=state.cache.services||await v37Fetch('service_library');
    return {
      title:V37_PAGE_TITLES[page],period:null,
      kpis:[['Services',rows.length,'Library items'],['Active',rows.filter(x=>x.is_active!==false).length,'Available services'],['Inactive',rows.filter(x=>x.is_active===false).length,'Archived/inactive'],['Average Rate',v37Money(rows.length?rows.reduce((s,x)=>s+Number(x.price||x.rate||0),0)/rows.length:0),'Library average']],
      tables:[{title:'Service Library',cols:['#','Service','Category','Rate','Active'],rows:rows.map((x,i)=>[i+1,x.name||x.service_name||'—',x.category||'—',v37Money(x.price||x.rate||0),x.is_active===false?'No':'Yes'])}]
    };
  }

  if(page==='rates'){
    const rows=state.cache.tourRates||await v37Fetch('tour_rates');
    return {
      title:V37_PAGE_TITLES[page],period:null,
      kpis:[['Rate Types',rows.length,'Configured rates'],['Active',rows.filter(x=>x.is_active!==false).length,'Selectable'],['Inactive',rows.filter(x=>x.is_active===false).length,'Archived'],['Special Event',rows.filter(x=>String(x.code||'').includes('special')).length,'Special rate types']],
      tables:[{title:'Rate Register',cols:['#','Rate Type','Code','Adult','Kids','Baby','Active'],rows:rows.map((x,i)=>[i+1,x.name||'—',x.code||'—',v37Money(x.adult_rate),v37Money(x.kid_rate),Number(x.baby_rate||0)===0?'FREE':v37Money(x.baby_rate),x.is_active===false?'No':'Yes'])}]
    };
  }

  if(page==='guests'){
    const all=state.cache.guests||await v37Fetch('guests');
    const rows=all.filter(x=>!x.created_at || v37DateInPeriod(x.created_at,p));
    return {
      title:V37_PAGE_TITLES[page],period:p,
      kpis:[['Guests',rows.length,'Created in period'],['Senior',rows.filter(x=>x.is_senior).length,'Guest records'],['PWD',rows.filter(x=>x.is_pwd).length,'Guest records'],['With Contact',rows.filter(x=>x.contact_number).length,'Contact available']],
      tables:[{title:'Guest Register',cols:['#','Name','Contact','Email','Address','Senior','PWD','Created'],rows:rows.map((x,i)=>[i+1,x.full_name||'—',x.contact_number||'—',x.email||'—',x.address||'—',x.is_senior?'Yes':'No',x.is_pwd?'Yes':'No',x.created_at?new Date(x.created_at).toLocaleDateString('en-PH'):'—'])}]
    };
  }

  if(page==='users'){
    const rows=await v37Fetch('profiles');
    return {
      title:V37_PAGE_TITLES[page],period:null,
      kpis:[['Users',rows.length,'All accounts'],['Active',rows.filter(x=>x.is_active!==false).length,'Enabled'],['Inactive',rows.filter(x=>x.is_active===false).length,'Disabled'],['Admins',rows.filter(x=>x.role==='admin').length,'Administrator accounts']],
      tables:[{title:'User Register',cols:['#','Name','Email','Legacy Role','Active','Created'],rows:rows.map((x,i)=>[i+1,x.full_name||'—',x.email||'—',x.role||'—',x.is_active===false?'No':'Yes',x.created_at?new Date(x.created_at).toLocaleDateString('en-PH'):'—'])}]
    };
  }

  if(page==='roles'){
    const roles=await v37Fetch('roles'), perms=await v37Fetch('role_permissions');
    return {
      title:V37_PAGE_TITLES[page],period:null,
      kpis:[['Roles',roles.length,'Configured roles'],['System Roles',roles.filter(x=>x.is_system).length,'Protected roles'],['Custom Roles',roles.filter(x=>!x.is_system).length,'User-defined'],['Permission Rows',perms.length,'Page permission records']],
      tables:[{title:'Role Register',cols:['#','Role','Code','Type','Visible Pages'],rows:roles.map((x,i)=>[i+1,x.name||'—',x.code||'—',x.is_system?'System':'Custom',perms.filter(p=>p.role_id===x.id&&p.can_view).length])}]
    };
  }

  if(page==='audit' || page==='barcode'){
    const all=page==='audit' ? await v37Fetch('audit_logs') : await v37Fetch('access_logs');
    const field=page==='audit'?'created_at':'created_at';
    const rows=all.filter(x=>!x[field] || v37DateInPeriod(x[field],p));
    return {
      title:V37_PAGE_TITLES[page],period:p,
      kpis:[[page==='audit'?'Audit Entries':'Access Logs',rows.length,'Selected period'],['Users',new Set(rows.map(x=>x.user_email||x.user_id).filter(Boolean)).size,'Unique users'],['Actions',new Set(rows.map(x=>x.action||x.event_type).filter(Boolean)).size,'Action types'],['Generated',new Date().toLocaleDateString('en-PH'),'Report date']],
      tables:[{title:page==='audit'?'Audit Trail':'Access Log',cols:page==='audit'?['#','Date/Time','User','Action','Table','Record','Details']:['#','Date/Time','Booking/Pax','Action','Notes'],
        rows:rows.map((x,i)=>page==='audit'?[i+1,x.created_at?new Date(x.created_at).toLocaleString('en-PH'):'—',x.user_email||'—',x.action||'—',x.table_name||'—',x.record_id||'—',x.details||'—']:[i+1,x.created_at?new Date(x.created_at).toLocaleString('en-PH'):'—',x.booking_id||x.pax_id||'—',x.action||x.event_type||'—',x.notes||'—'])}]
    };
  }

  if(page==='live'){
    const date=$('#liveDate')?.value||today();
    const units=[
      ...state.cache.rooms.map(x=>({...x,unit_type:'room'})),
      ...state.cache.cottages.map(x=>({...x,unit_type:'cottage'}))
    ].filter(x=>x.is_active!==false);
    const rows=units.map((u,i)=>{
      const b=bookingForUnit(u.unit_type,u.id,date);
      return [i+1,u.unit_type,u.name||u.unit_number||'—',unitStatus(u.unit_type,u,date),b?.guest_name||'—',b?Number(b.adults||0)+Number(b.kids||0)+Number(b.babies||0):0,b?v37Money(b.balance||0):'—'];
    });
    return {
      title:V37_PAGE_TITLES[page],period:{label:`Snapshot: ${fmtDate(date)}`},
      kpis:[['Units',units.length,'Current active units'],['Available',rows.filter(x=>x[3]==='available').length,'Snapshot'],['Occupied',rows.filter(x=>x[3]==='occupied').length,'Snapshot'],['Reserved',rows.filter(x=>x[3]==='reserved').length,'Snapshot']],
      tables:[{title:'Live Unit Status',cols:['#','Type','Unit','Status','Guest','Pax','Balance'],rows}]
    };
  }

  if(page==='availability'){
    const days=Array.from({length:14},(_,i)=>{const d=new Date();d.setDate(d.getDate()+i);return isoDate(d)});
    const units=[...state.cache.rooms.map(x=>({...x,t:'room'})),...state.cache.cottages.map(x=>({...x,t:'cottage'}))].filter(x=>x.is_active!==false);
    return {
      title:V37_PAGE_TITLES[page],period:{label:'Next 14 Days'},
      kpis:[['Units',units.length,'Rooms + cottages'],['Days',14,'Forward window'],['Rooms',state.cache.rooms.filter(x=>x.is_active!==false).length,'Active rooms'],['Cottages',state.cache.cottages.filter(x=>x.is_active!==false).length,'Active cottages']],
      tables:[{title:'14-Day Availability',cols:['Unit','Type',...days.map(fmtDate)],rows:units.map(u=>[u.name||u.unit_number||'—',u.t,...days.map(d=>unitStatus(u.t,u,d))])}]
    };
  }

  if(page==='pos'){
    const rows=await v37Fetch('stock_movements');
    const filtered=rows.filter(x=>!x.created_at||v37DateInPeriod(x.created_at,p));
    return {
      title:V37_PAGE_TITLES[page],period:p,
      kpis:[['Movements',filtered.length,'Selected period'],['Items',new Set(filtered.map(x=>x.inventory_item_id).filter(Boolean)).size,'Unique stock items'],['Qty Movement',filtered.reduce((s,x)=>s+Math.abs(Number(x.quantity||x.qty||0)),0),'Absolute units moved'],['Generated',new Date().toLocaleDateString('en-PH'),'Report date']],
      tables:[{title:'Stock / POS Movements',cols:['#','Date/Time','Item ID','Type','Quantity','Notes'],rows:filtered.map((x,i)=>[i+1,x.created_at?new Date(x.created_at).toLocaleString('en-PH'):'—',x.inventory_item_id||'—',x.movement_type||x.type||'—',x.quantity||x.qty||0,x.notes||'—'])}]
    };
  }

  if(page==='settings'){
    return {
      title:V37_PAGE_TITLES[page],period:null,
      kpis:[['Resort',v36ResortName(),'Current branding'],['Rooms',state.cache.rooms.length,'Configured'],['Cottages',state.cache.cottages.length,'Configured'],['Report Date',new Date().toLocaleDateString('en-PH'),'Configuration snapshot']],
      tables:[{title:'Non-sensitive Configuration Summary',cols:['Setting','Value'],rows:[
        ['Resort Name',state.settings?.resort_name||'Masusi Farm Resort'],
        ['Address',state.settings?.address||'—'],
        ['Contact Number',state.settings?.contact_number||'—'],
        ['Email',state.settings?.email||'—'],
        ['Storage Bucket',window.MASUSI_CONFIG?.STORAGE_BUCKET||'resort-assets']
      ]}]
    };
  }

  return {title:V37_PAGE_TITLES[page]||'System Report',period:p,kpis:[['Status','Available','Professional page report'],['Period',p.label,'Selected period'],['Generated',new Date().toLocaleDateString('en-PH'),'Report date'],['Page',page,'System module']],tables:[]};
}

function v37ProfessionalReportHtml(r){
  const periodLabel=r.period?.label||'Current Snapshot';
  return `${v36DocStyles(r.title)}
  <div class="page"><div class="sheet">
    <div class="hero">
      <div class="brand">
        <img src="${v36LogoUrl()}" alt="Logo" onerror="this.style.display='none'">
        <div><h1>${esc(v36ResortName())}</h1><p>Professional System Report</p></div>
      </div>
      <div class="doc-meta">
        <strong>Report</strong><div>${esc(r.title)}</div>
        <strong style="margin-top:10px">Period</strong><div>${esc(periodLabel)}</div>
        <strong style="margin-top:10px">Generated</strong><div>${new Date().toLocaleString('en-PH')}</div>
      </div>
    </div>
    <div class="content">
      <div class="kpis">
        ${(r.kpis||[]).map(k=>`<div class="kpi"><span>${esc(k[0])}</span><strong>${esc(k[1])}</strong><div class="muted" style="font-size:12px;margin-top:6px">${esc(k[2]||'')}</div></div>`).join('')}
      </div>
      ${(r.tables||[]).map(t=>`<div class="section"><h2>${esc(t.title)}</h2><table><thead><tr>${t.cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${t.rows.length?t.rows.map(row=>`<tr>${row.map(cell=>`<td>${esc(cell)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${t.cols.length}">No records found.</td></tr>`}</tbody></table></div>`).join('')}
      <div class="sign-row"><div class="sign-box">Prepared by</div><div class="sign-box">Checked / Approved by</div></div>
    </div>
    <div class="footer-note">${esc(v36ResortName())} · ${esc(r.title)} · ${esc(periodLabel)}</div>
  </div></div><script>window.onload=()=>setTimeout(()=>window.print(),180);<\/script></body></html>`;
}

function v37ReportPeriodModal(page){
  const nowMonth=currentMonth(), nowYear=v37CurrentYear();
  openModal({
    title:`${V37_PAGE_TITLES[page]||'Page Report'}`,
    eyebrow:'REPORT PERIOD',
    body:`<form id="v37PeriodForm" class="modal-form">
      <label>Report Period<select name="mode" id="v37PeriodMode"><option value="month">Selected Month</option><option value="year">Whole Year</option></select></label>
      <label id="v37MonthWrap">Month<input name="month" type="month" value="${nowMonth}"></label>
      <label id="v37YearWrap" class="hidden">Year<input name="year" type="number" min="2020" max="2100" value="${nowYear}"></label>
      <p class="tiny muted full">Choose Selected Month for a monthly report, or Whole Year to include January through December of the selected year.</p>
    </form>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v37GeneratePageReport">Generate Professional Report</button>`
  });
  $('[data-modal-cancel]').onclick=closeModal;
  $('#v37PeriodMode').onchange=()=>{
    const yr=$('#v37PeriodMode').value==='year';
    $('#v37MonthWrap').classList.toggle('hidden',yr);
    $('#v37YearWrap').classList.toggle('hidden',!yr);
  };
  $('#v37GeneratePageReport').onclick=async()=>{
    const fd=new FormData($('#v37PeriodForm'));
    const p=v37Period(fd.get('mode'),fd.get('month'),fd.get('year'));
    closeModal();
    const report=await v37GetPageReport(page,p);
    v36OpenPrintWindow(v37ProfessionalReportHtml(report));
  };
}

async function v37PrintPageReport(page,period=null){
  const p=period||v37Period('month',currentMonth(),v37CurrentYear());
  const r=await v37GetPageReport(page,p);
  v36OpenPrintWindow(v37ProfessionalReportHtml(r));
}

// SYSTEM-WIDE: any legacy Print Month / Print button that calls printElementView
// now opens a professional period chooser instead of printing the screen.
printElementView = function(name){
  if(['rooms','cottages','inventory','services','rates','users','roles','settings','live','availability'].includes(name)){
    v37PrintPageReport(name,v37Period('month',currentMonth(),v37CurrentYear()));
    return;
  }
  v37ReportPeriodModal(name);
};

// Global Page Report button — available on every page.
setTimeout(()=>{
  if($('#pageReportBtn')) $('#pageReportBtn').onclick=()=>{
    const page=state.currentView||'dashboard';
    if(page==='reports') return v37PrintCentralReport();
    if(['rooms','cottages','inventory','services','rates','users','roles','settings','live','availability'].includes(page)){
      return v37PrintPageReport(page,v37Period('month',currentMonth(),v37CurrentYear()));
    }
    v37ReportPeriodModal(page);
  };
},0);

// CENTRAL REPORTS: Month or Whole Year
async function v37PrintCentralReport(){
  await refreshOperations();
  const type=$('#reportType')?.value||'bookings';
  const mode=$('#reportPeriodMode')?.value||'month';
  const p=v37Period(mode,v37MonthValue(),v37YearValue());

  if(type==='pax_demographics'){
    const base=await v37GetPageReport('bookings',p);
    const bookingMap=Object.fromEntries((state.cache.bookings||[]).map(b=>[b.id,b]));
    const rows=(state.cache.pax||[]).filter(px=>{
      const b=bookingMap[px.booking_id];
      return b && v37DateInPeriod(b.check_in_date||b.booking_date,p) && px.access_status!=='cancelled';
    });
    const genders={Male:0,Female:0,'LGBTQIA+':0,'Not specified':0};
    rows.forEach(px=>genders[px.gender]!==undefined?genders[px.gender]++:genders['Not specified']++);
    const areas={}; rows.forEach(px=>{const a=px.area_name||px.area||'Not specified';areas[a]=(areas[a]||0)+1});
    const outside=rows.filter(px=>String(px.area_name||px.area||'').trim().toLowerCase()!=='naic' && String(px.area_name||px.area||'').trim()).length;
    const r={
      title:'Pax Demographics & Area Report',period:p,
      kpis:[['Pax',rows.length,'Booked pax in period'],['Male',genders.Male,'Gender count'],['Female',genders.Female,'Gender count'],['Outside Naic',outside,'Known areas excluding Naic']],
      tables:[
        {title:'Gender Summary',cols:['Gender','Count'],rows:Object.entries(genders)},
        {title:'Area Summary',cols:['Area','Count'],rows:Object.entries(areas).sort((a,b)=>b[1]-a[1])},
        {title:'Pax Details',cols:['#','Pax','Gender','Area','Booking','Client'],rows:rows.map((px,i)=>[i+1,px.display_name||paxDisplayName(px),px.gender||'Not specified',px.area_name||px.area||'Not specified',bookingMap[px.booking_id]?.booking_number||'—',bookingMap[px.booking_id]?.guest_name||'Guest'])}
      ]
    };
    return v36OpenPrintWindow(v37ProfessionalReportHtml(r));
  }

  const pageMap={bookings:'bookings',payments:'payments',expenses:'expenses',damages:'damages',repairs:'repairs',occupancy:'bookings'};
  const report=await v37GetPageReport(pageMap[type]||'bookings',p);
  if(type==='occupancy') report.title='Occupancy Report';
  v36OpenPrintWindow(v37ProfessionalReportHtml(report));
}

function v37RenderCentralReportPreview(){
  const mode=$('#reportPeriodMode')?.value||'month';
  const p=v37Period(mode,v37MonthValue(),v37YearValue());
  const type=$('#reportType')?.value||'bookings';
  $('#reportContent').innerHTML=`<div class="report-sheet">
    <div class="report-header">
      <div><p class="eyebrow">${esc(v36ResortName().toUpperCase())}</p><h2>${esc($('#reportType option:checked')?.textContent||'Management Report')}</h2><p class="muted">${esc(p.label)}</p></div>
      <div><strong>Professional Report</strong><br><span class="muted">Use Professional Print to generate the formal document.</span></div>
    </div>
    <div class="panel" style="margin-top:16px">
      <h3>Report Period</h3>
      <p><strong>${esc(p.label)}</strong></p>
      <p class="muted">The report can now cover either one selected month or the complete selected year.</p>
    </div>
  </div>`;
}

// Override central Generate and Print handlers.
setTimeout(()=>{
  v37PopulateYears();
  v37SyncReportPeriodControls();
  if($('#reportPeriodMode')) $('#reportPeriodMode').onchange=()=>{v37SyncReportPeriodControls();v37RenderCentralReportPreview();};
  if($('#reportsMonth')) $('#reportsMonth').onchange=v37RenderCentralReportPreview;
  if($('#reportsYear')) $('#reportsYear').onchange=v37RenderCentralReportPreview;
  if($('#reportType')) $('#reportType').onchange=v37RenderCentralReportPreview;
  if($('#runReportBtn')) $('#runReportBtn').onclick=v37RenderCentralReportPreview;
  if($('#printReportBtn')){
    $('#printReportBtn').textContent='Professional Print';
    $('#printReportBtn').onclick=v37PrintCentralReport;
  }
  v37RenderCentralReportPreview();
},20);

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v38.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V3.8
   FULL INVOICE STANDARDIZATION + ALL-PAGE MONTH/YEAR REPORTING
   ============================================================ */

state.cache.invoices = state.cache.invoices || [];

const v38PreloadBase = preload;
preload = async function(){
  await v38PreloadBase();
  await getTable('invoices');
};

const v38RefreshOperationsBase = refreshOperations;
refreshOperations = async function(){
  await v38RefreshOperationsBase();
  await getTable('invoices');
};

function v38InvoiceStatus(total,paid,voided=false){
  if(voided)return 'void';
  total=Number(total||0);paid=Number(paid||0);
  if(total<=0)return 'paid';
  if(paid<=0)return 'unpaid';
  if(paid+0.001>=total)return 'paid';
  return 'partial';
}
function v38InvoiceModel(inv,b=null){
  b=b || (state.cache.bookings||[]).find(x=>x.id===inv?.booking_id);
  const unit=v36UnitForBooking(b);
  const charges=b?bookingCharges(b.id):[];
  const payments=b?bookingPayments(b.id):[];
  const t=b && typeof bookingAccountTotals==='function' ? bookingAccountTotals(b) : null;

  const subtotal=t ? Number(t.gross||t.base||0) : Number(inv?.subtotal||0);
  const discount=t ? Number(t.discount||0) : Number(inv?.discount_total||0);
  const total=t ? Number(t.total||0) : Number(inv?.total_amount||0);
  const paid=t ? Number(t.payments||0) : Number(inv?.paid_amount||0);
  const balance=Math.max(0,total-paid);
  const status=v38InvoiceStatus(total,paid,inv?.status==='void');

  const baseAmount=Number(b?.base_amount||0);
  const bookingLabel=(b?.booking_type==='room' || b?.room_id) ? 'Room Accommodation' : 'Cottage + Swimming Booking';
  const lines=[];
  if(b){
    lines.push({
      item:bookingLabel,
      description:`${unit.label}: ${unit.value}${b.check_in_date?` · ${fmtDate(b.check_in_date)}`:''}${b.check_out_date?` to ${fmtDate(b.check_out_date)}`:''}`,
      qty:1,
      unit_price:baseAmount || Number(b.total_amount||0),
      discount:0,
      amount:baseAmount || Number(b.total_amount||0)
    });
    charges.forEach(c=>lines.push({
      item:c.charge_type||'Additional Charge',
      description:c.description||'Additional resort charge',
      qty:Number(c.quantity||1),
      unit_price:Number(c.unit_price||c.amount||0),
      discount:Number(c.discount_amount||0),
      amount:Number(c.amount||0)-Number(c.discount_amount||0)
    }));
  }

  return {
    inv,b,unit,charges,payments,lines,
    invoice_number:inv?.invoice_number||'UNSAVED INVOICE',
    invoice_date:inv?.invoice_date||today(),
    guest:b?.guest_name||'Guest',
    contact:b?.contact_number||'',
    booking_number:b?.booking_number||'—',
    booking_type:b?.booking_type==='room'?'Room Booking':'Cottage + Swimming Booking',
    subtotal,discount,total,paid,balance,status,
    notes:inv?.notes||''
  };
}

function v38InvoiceHtml(inv){
  const m=v38InvoiceModel(inv);
  return `${v36DocStyles(m.invoice_number)}
  <div class="page"><div class="sheet">
    <div class="hero">
      <div class="brand">
        <img src="${v36LogoUrl()}" alt="Logo" onerror="this.style.display='none'">
        <div><h1>${esc(v36ResortName())}</h1><p>OFFICIAL GUEST INVOICE</p></div>
      </div>
      <div class="doc-meta">
        <strong>Invoice Number</strong><div>${esc(m.invoice_number)}</div>
        <strong style="margin-top:10px">Invoice Date</strong><div>${fmtDate(m.invoice_date)}</div>
        <strong style="margin-top:10px">Status</strong><div><span class="badge">${esc(m.status)}</span></div>
      </div>
    </div>
    <div class="content">
      <div class="grid-2">
        <div class="card">
          <div class="label">Billed To</div><div class="value">${esc(m.guest)}</div>
          <div class="muted">${esc(m.contact||'No contact number')}</div>
        </div>
        <div class="card">
          <div class="label">Booking Reference</div><div class="value">${esc(m.booking_number)}</div>
          <div class="muted">${esc(m.booking_type)} · ${esc(m.unit.label)}: ${esc(m.unit.value)}</div>
        </div>
      </div>

      <div class="section">
        <h2>Charges & Services</h2>
        <table>
          <thead><tr><th>#</th><th>Item</th><th>Description</th><th class="num">Qty</th><th class="num">Unit Price</th><th class="num">Discount</th><th class="num">Amount</th></tr></thead>
          <tbody>
            ${m.lines.length?m.lines.map((r,i)=>`<tr><td>${i+1}</td><td><strong>${esc(r.item)}</strong></td><td>${esc(r.description)}</td><td class="num">${esc(r.qty)}</td><td class="num">${money(r.unit_price)}</td><td class="num">${r.discount?`- ${money(r.discount)}`:'—'}</td><td class="num"><strong>${money(r.amount)}</strong></td></tr>`).join(''):`<tr><td colspan="7">No charge lines found.</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="section" style="display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1 1 420px">
          <h2>Payment History</h2>
          ${m.payments.length?`<table><thead><tr><th>#</th><th>Date</th><th>Method</th><th>Reference</th><th class="num">Amount</th></tr></thead><tbody>${m.payments.map((p,i)=>`<tr><td>${i+1}</td><td>${fmtDate(p.payment_date)}</td><td>${esc(p.method||'Payment')}</td><td>${esc(p.reference_number||'—')}</td><td class="num"><strong>${money(p.amount)}</strong></td></tr>`).join('')}</tbody></table>`:`<div class="note">No payment has been recorded yet.</div>`}
          ${m.notes?`<div class="note"><strong>Invoice Notes:</strong> ${esc(m.notes)}</div>`:''}
        </div>

        <div class="summary">
          <div class="summary-row"><span>Gross / Subtotal</span><strong>${money(m.subtotal)}</strong></div>
          <div class="summary-row"><span>Discount</span><strong>- ${money(m.discount)}</strong></div>
          <div class="summary-row"><span>Net Total</span><strong>${money(m.total)}</strong></div>
          <div class="summary-row"><span>Total Paid</span><strong>${money(m.paid)}</strong></div>
          <div class="summary-row total"><span>Balance Due</span><strong>${money(m.balance)}</strong></div>
        </div>
      </div>

      <div class="note" style="margin-top:24px">
        ${esc(state.settings?.invoice_footer || 'Thank you for choosing Masusi Farm Resort. Please keep this invoice for your records.')}
      </div>
      <div class="sign-row"><div class="sign-box">Prepared by / Cashier</div><div class="sign-box">Guest / Client Acknowledgment</div></div>
    </div>
    <div class="footer-note">${esc(v36ResortName())} · ${esc(m.invoice_number)} · Generated ${new Date().toLocaleString('en-PH')}</div>
  </div></div><script>window.onload=()=>setTimeout(()=>window.print(),180);<\/script></body></html>`;
}
v36InvoiceHtml = v38InvoiceHtml;
v36PrintInvoice = function(inv){ if(inv)v36OpenPrintWindow(v38InvoiceHtml(inv)); };

async function v38SaveInvoicePng(inv){
  const m=v38InvoiceModel(inv);
  try{
    const logo=await v28LoadLogo().catch(()=>null);
    const lines=m.lines.slice(0,12);
    const pay=m.payments.slice(0,8);
    const h=1180 + lines.length*54 + pay.length*46;
    const c=document.createElement('canvas');c.width=1400;c.height=h;
    const x=c.getContext('2d');
    x.fillStyle='#eef4f0';x.fillRect(0,0,c.width,c.height);
    x.fillStyle='#fff';roundRect(x,50,50,1300,h-100,28,true,false);
    x.fillStyle='#0f6a4d';roundRect(x,50,50,1300,170,28,true,false);
    if(logo)try{x.drawImage(logo,88,88,92,92)}catch(e){}
    x.fillStyle='#fff';x.font='700 38px Arial';x.fillText(v36ResortName(),210,112);
    x.font='600 19px Arial';x.fillText('OFFICIAL GUEST INVOICE',210,150);
    x.textAlign='right';x.font='700 22px Arial';x.fillText(m.invoice_number,1310,108);
    x.font='500 17px Arial';x.fillText(fmtDate(m.invoice_date),1310,142);x.textAlign='left';

    x.fillStyle='#0f172a';x.font='700 23px Arial';x.fillText('BILLED TO',90,280);
    x.font='700 30px Arial';x.fillText(m.guest,90,322);
    x.fillStyle='#64748b';x.font='500 18px Arial';x.fillText(`${m.booking_number} · ${m.unit.label}: ${m.unit.value}`,90,357);

    let y=420;
    x.fillStyle='#eef5f1';roundRect(x,90,y,1220,50,8,true,false);
    x.fillStyle='#334d43';x.font='700 15px Arial';
    ['#','ITEM','DESCRIPTION','QTY','UNIT PRICE','AMOUNT'].forEach((t,i)=>x.fillText(t,[105,155,430,930,1025,1190][i],y+31));
    y+=66;
    lines.forEach((r,i)=>{
      x.fillStyle='#0f172a';x.font='600 16px Arial';x.fillText(String(i+1),105,y);
      x.fillText(String(r.item).slice(0,24),155,y);
      x.font='500 15px Arial';x.fillText(String(r.description).slice(0,48),430,y);
      x.textAlign='right';x.fillText(String(r.qty),970,y);x.fillText(money(r.unit_price),1150,y);x.font='700 16px Arial';x.fillText(money(r.amount),1290,y);x.textAlign='left';
      x.strokeStyle='#e7eee9';x.beginPath();x.moveTo(90,y+18);x.lineTo(1310,y+18);x.stroke();
      y+=54;
    });
    y+=20;
    x.fillStyle='#0f172a';x.font='700 22px Arial';x.fillText('PAYMENTS',90,y);y+=38;
    if(pay.length){
      pay.forEach((p,i)=>{x.font='500 16px Arial';x.fillStyle='#334d43';x.fillText(`${fmtDate(p.payment_date)} · ${p.method||'Payment'} · ${p.reference_number||'No reference'}`,100,y);x.textAlign='right';x.font='700 16px Arial';x.fillText(money(p.amount),1290,y);x.textAlign='left';y+=46;});
    }else{x.fillStyle='#64748b';x.font='500 16px Arial';x.fillText('No payment recorded.',100,y);y+=46;}

    const sy=Math.max(y+30,h-430);
    x.fillStyle='#f7faf8';roundRect(x,820,sy,490,290,16,true,false);
    const sums=[['Gross / Subtotal',m.subtotal],['Discount',-m.discount],['Net Total',m.total],['Paid',m.paid],['BALANCE DUE',m.balance]];
    sums.forEach((r,i)=>{x.fillStyle=i===4?'#0f6a4d':'#64748b';x.font=i===4?'700 22px Arial':'600 17px Arial';x.fillText(r[0],850,sy+48+i*47);x.textAlign='right';x.fillStyle=i===4?'#0f6a4d':'#0f172a';x.font=i===4?'700 25px Arial':'700 18px Arial';x.fillText((r[1]<0?'- ':'')+money(Math.abs(r[1])),1275,sy+48+i*47);x.textAlign='left';});
    x.fillStyle='#64748b';x.font='500 15px Arial';wrapText(x,state.settings?.invoice_footer||'Thank you for choosing Masusi Farm Resort.',90,h-110,650,22);
    v31CanvasDownload(c,`${v27FilenameSafe(m.invoice_number)}_INVOICE.png`);
    toast('Professional invoice saved as PNG.');
  }catch(e){console.error(e);toast('Could not save invoice PNG.','error');}
}

async function v38CreateOrRefreshInvoice(b,existing=null){
  if(!b)return;
  await refreshOperations();
  b=(state.cache.bookings||[]).find(x=>x.id===b.id)||b;
  const t=bookingAccountTotals(b);
  const payload={
    booking_id:b.id,
    invoice_date:existing?.invoice_date||today(),
    subtotal:Number(t.gross||t.base||0),
    discount_total:Number(t.discount||0),
    total_amount:Number(t.total||0),
    paid_amount:Number(t.payments||0),
    balance:Number(t.balance||0),
    status:v38InvoiceStatus(t.total,t.payments,existing?.status==='void'),
    notes:existing?.notes||null
  };
  let res;
  if(existing){
    res=await sb.from('invoices').update(payload).eq('id',existing.id).select().single();
  }else{
    res=await sb.from('invoices').insert(payload).select().single();
  }
  if(res.error)return toast(res.error.message,'error');
  await getTable('invoices');
  toast(existing?'Invoice refreshed from live booking account.':'Invoice generated.');
  return res.data;
}

function v38SelectBookingForInvoice(){
  const bookings=autoSortRows('bookings',(state.cache.bookings||[]).filter(b=>b.status!=='cancelled'));
  openModal({
    title:'Generate Invoice',
    eyebrow:'BOOKING → INVOICE',
    wide:true,
    body:`<form id="v38InvoiceBookingForm" class="modal-form">
      <label class="full">Booking<select name="booking_id" required><option value="">Select booking...</option>${bookings.map(b=>`<option value="${b.id}">${esc(b.booking_number)} · ${esc(b.guest_name||'Guest')} · ${esc(v37BookingUnit(b))}</option>`).join('')}</select></label>
      <p class="tiny muted full">The invoice will automatically use the booking account, additional charges, discounts, payments, and current balance. You do not need to type totals manually.</p>
    </form>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v38GenerateInvoiceBtn">Generate Invoice</button>`
  });
  $('[data-modal-cancel]').onclick=closeModal;
  $('#v38GenerateInvoiceBtn').onclick=async()=>{
    const id=new FormData($('#v38InvoiceBookingForm')).get('booking_id');
    if(!id)return toast('Select a booking.','error');
    const b=state.cache.bookings.find(x=>x.id===id);
    const existing=(state.cache.invoices||[]).find(x=>x.booking_id===id && x.status!=='void');
    const inv=await v38CreateOrRefreshInvoice(b,existing||null);
    if(inv){closeModal();setTimeout(()=>v38OpenInvoice(inv.id),50);}
  };
}

async function v38OpenInvoice(id){
  await getTable('invoices');
  const inv=(state.cache.invoices||[]).find(x=>x.id===id);
  if(!inv)return toast('Invoice not found.','error');
  const m=v38InvoiceModel(inv);
  openModal({
    title:m.invoice_number,
    eyebrow:'UNIFORM PROFESSIONAL INVOICE',
    wide:true,
    body:`<div class="dashboard-grid">
      <div class="panel"><div class="panel-head"><h3>Client / Booking</h3></div>
        <p><strong>${esc(m.guest)}</strong></p>
        <p class="muted">${esc(m.booking_number)} · ${esc(m.unit.label)}: ${esc(m.unit.value)}</p>
        <p>Invoice Date: <strong>${fmtDate(m.invoice_date)}</strong></p>
        <p>Status: <span class="badge">${esc(m.status)}</span></p>
      </div>
      <div class="panel"><div class="panel-head"><h3>Invoice Summary</h3></div>
        <div class="report-kpis"><div class="report-kpi"><span>Gross</span><strong>${money(m.subtotal)}</strong></div><div class="report-kpi"><span>Discount</span><strong>${money(m.discount)}</strong></div><div class="report-kpi"><span>Paid</span><strong>${money(m.paid)}</strong></div><div class="report-kpi"><span>Balance</span><strong>${money(m.balance)}</strong></div></div>
      </div>
    </div>
    <div class="table-panel" style="margin-top:14px"><div class="panel-head" style="padding:14px 14px 0"><h3>Charges & Services</h3></div><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Item</th><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody>${m.lines.length?m.lines.map((r,i)=>`<tr><td>${i+1}</td><td><strong>${esc(r.item)}</strong></td><td>${esc(r.description)}</td><td>${r.qty}</td><td>${money(r.unit_price)}</td><td><strong>${money(r.amount)}</strong></td></tr>`).join(''):'<tr><td colspan="6" class="empty-state">No charges found.</td></tr>'}</tbody></table></div></div>
    <div class="table-panel" style="margin-top:14px"><div class="panel-head" style="padding:14px 14px 0"><h3>Payment History</h3></div><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead><tbody>${m.payments.length?m.payments.map((p,i)=>`<tr><td>${i+1}</td><td>${fmtDate(p.payment_date)}</td><td>${esc(p.method||'Payment')}</td><td>${esc(p.reference_number||'—')}</td><td><strong>${money(p.amount)}</strong></td></tr>`).join(''):'<tr><td colspan="5" class="empty-state">No payment recorded.</td></tr>'}</tbody></table></div></div>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-soft" id="v38RefreshInvoice">Refresh Totals</button><button class="btn btn-soft" id="v38SaveInvoicePng">Save PNG</button><button class="btn btn-primary" id="v38PrintInvoice">Professional Print</button>`
  });
  $('[data-modal-cancel]').onclick=closeModal;
  $('#v38RefreshInvoice').onclick=async()=>{const refreshed=await v38CreateOrRefreshInvoice(m.b,inv);if(refreshed)v38OpenInvoice(refreshed.id);};
  $('#v38SaveInvoicePng').onclick=()=>v38SaveInvoicePng(inv);
  $('#v38PrintInvoice').onclick=()=>v36PrintInvoice(inv);
}

async function v38VoidInvoice(id){
  const inv=(state.cache.invoices||[]).find(x=>x.id===id);
  if(!inv)return;
  confirmModal('Void Invoice',`Void invoice ${inv.invoice_number}? The invoice will remain in history but will no longer be treated as active.`,async()=>{
    const {error}=await sb.from('invoices').update({status:'void'}).eq('id',id);
    if(error)return toast(error.message,'error');
    closeModal();await getTable('invoices');renderInvoicesV38();toast('Invoice voided.');
  },true);
}

function v38InvoiceYears(rows){
  const set=new Set([v37CurrentYear()]);
  rows.forEach(x=>{const d=x.invoice_date||x.created_at;if(d)set.add(String(d).slice(0,4));});
  return [...set].sort((a,b)=>Number(b)-Number(a));
}

async function renderInvoicesV38(){
  await getTable('invoices');
  const rows=state.cache.invoices||[];
  const root=$('#view-invoices');if(!root)return;
  root.innerHTML=`<div class="section-head"><div><p class="eyebrow">CLIENT BILLING DOCUMENTS</p><h2>Invoices</h2><p class="muted">All invoices use one uniform professional format and live booking-account totals.</p></div><button class="btn btn-primary" id="v38AddInvoice">Generate Invoice</button></div>
  <div class="table-panel"><div class="table-toolbar">
    <input id="v38InvoiceSearch" class="grow" type="search" placeholder="Search invoice, booking, guest...">
    <select id="v38InvoicePeriod"><option value="month">Selected Month</option><option value="year">Whole Year</option></select>
    <input id="v38InvoiceMonth" type="month" value="${currentMonth()}">
    <select id="v38InvoiceYear">${v38InvoiceYears(rows).map(y=>`<option value="${y}">${y}</option>`).join('')}</select>
    <select id="v38InvoiceStatus"><option value="">All status</option><option value="open">Open</option><option value="partial">Partial</option><option value="paid">Paid</option><option value="void">Void</option></select>
    <button class="btn btn-soft" id="v38InvoiceReport">Professional Report</button>
  </div><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Invoice</th><th>Date</th><th>Booking</th><th>Guest</th><th>Room / Cottage</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody id="v38InvoiceBody"></tbody></table></div></div>`;

  const sync=()=>{$('#v38InvoiceMonth').style.display=$('#v38InvoicePeriod').value==='month'?'':'none';$('#v38InvoiceYear').style.display=$('#v38InvoicePeriod').value==='year'?'':'none';};
  const draw=()=>{
    const q=$('#v38InvoiceSearch').value.toLowerCase().trim(),mode=$('#v38InvoicePeriod').value;
    const p=v37Period(mode,$('#v38InvoiceMonth').value,$('#v38InvoiceYear').value);
    const st=$('#v38InvoiceStatus').value;
    const filtered=autoSortRows('invoices',rows.filter(inv=>{
      const m=v38InvoiceModel(inv);
      return v37DateInPeriod(inv.invoice_date||inv.created_at,p) &&
        (!st||m.status===st) &&
        `${inv.invoice_number||''} ${m.booking_number} ${m.guest} ${m.unit.value}`.toLowerCase().includes(q);
    }));
    $('#v38InvoiceBody').innerHTML=filtered.length?filtered.map((inv,i)=>{
      const m=v38InvoiceModel(inv);
      return `<tr><td><strong>${i+1}</strong></td><td><strong>${esc(inv.invoice_number||'—')}</strong></td><td>${fmtDate(inv.invoice_date)}</td><td>${esc(m.booking_number)}</td><td>${esc(m.guest)}</td><td>${esc(m.unit.value)}</td><td>${money(m.total)}</td><td>${money(m.paid)}</td><td><strong>${money(m.balance)}</strong></td><td><span class="badge">${esc(m.status)}</span></td><td><div class="row-actions"><button data-v38-view="${inv.id}">View</button><button class="btn btn-soft" data-v38-print="${inv.id}">Print</button><button class="btn btn-soft" data-v38-png="${inv.id}">Save PNG</button>${inv.status!=='void'?`<button data-v38-refresh="${inv.id}">Refresh</button><button class="btn btn-danger" data-v38-void="${inv.id}">Void</button>`:''}</div></td></tr>`;
    }).join(''):`<tr><td colspan="11" class="empty-state">No invoices found for selected period.</td></tr>`;
    $$('[data-v38-view]').forEach(x=>x.onclick=()=>v38OpenInvoice(x.dataset.v38View));
    $$('[data-v38-print]').forEach(x=>x.onclick=()=>v36PrintInvoice(rows.find(r=>r.id===x.dataset.v38Print)));
    $$('[data-v38-png]').forEach(x=>x.onclick=()=>v38SaveInvoicePng(rows.find(r=>r.id===x.dataset.v38Png)));
    $$('[data-v38-refresh]').forEach(x=>x.onclick=async()=>{const inv=rows.find(r=>r.id===x.dataset.v38Refresh),b=state.cache.bookings.find(b=>b.id===inv.booking_id);await v38CreateOrRefreshInvoice(b,inv);renderInvoicesV38();});
    $$('[data-v38-void]').forEach(x=>x.onclick=()=>v38VoidInvoice(x.dataset.v38Void));
  };

  $('#v38AddInvoice').onclick=v38SelectBookingForInvoice;
  $('#v38InvoicePeriod').onchange=()=>{sync();draw();};
  $('#v38InvoiceMonth').onchange=draw;$('#v38InvoiceYear').onchange=draw;$('#v38InvoiceStatus').onchange=draw;$('#v38InvoiceSearch').oninput=draw;
  $('#v38InvoiceReport').onclick=()=>{
    const p=v37Period($('#v38InvoicePeriod').value,$('#v38InvoiceMonth').value,$('#v38InvoiceYear').value);
    v37PrintPageReport('invoices',p);
  };
  sync();draw();
}

// Invoice page override
const v38RenderCurrentBase=renderCurrent;
renderCurrent=async function(){
  if(state.currentView==='invoices')return renderInvoicesV38();
  const r=await v38RenderCurrentBase();
  if(state.currentView==='bookings')setTimeout(v38EnhanceGenericBookings,20);
  return r;
};
const v38NavigateBase=navigate;
navigate=function(view){
  if(view==='invoices'){
    state.currentView='invoices';
    $$('.view').forEach(v=>v.classList.remove('active'));
    $('#view-invoices')?.classList.add('active');
    $$('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.view==='invoices'));
    $('#sidebar').classList.remove('open');
    $('#pageTitle').textContent='Invoices';
    return renderInvoicesV38();
  }
  return v38NavigateBase(view);
};

// Put Invoice action into booking tables.
function v38EnhanceGenericBookings(){
  $$('[data-view-record="bookings"]').forEach(btn=>{
    const id=btn.dataset.id;
    const actions=btn.closest('.row-actions');
    if(actions&&!actions.querySelector(`[data-v38-booking-invoice="${id}"]`)){
      const b=document.createElement('button');b.className='btn btn-soft';b.dataset.v38BookingInvoice=id;b.textContent='Invoice';
      b.onclick=()=>v38OpenBookingInvoiceById(id);actions.appendChild(b);
    }
  });
}
async function v38OpenBookingInvoiceById(id){
  await getTable('invoices');
  const booking=state.cache.bookings.find(x=>x.id===id);if(!booking)return;
  let inv=(state.cache.invoices||[]).find(x=>x.booking_id===id && x.status!=='void');
  if(!inv)inv=await v38CreateOrRefreshInvoice(booking,null);
  if(inv)v38OpenInvoice(inv.id);
}

const v38RenderBookingTypeBase=renderBookingTypePage;
renderBookingTypePage=async function(type){
  const r=await v38RenderBookingTypeBase(type);
  setTimeout(()=>{
    $$('[data-v23-view]').forEach(btn=>{
      const id=btn.dataset.v23View,actions=btn.closest('.row-actions');
      if(actions&&!actions.querySelector(`[data-v38-booking-invoice="${id}"]`)){
        const b=document.createElement('button');b.className='btn btn-soft';b.dataset.v38BookingInvoice=id;b.textContent='Invoice';b.onclick=()=>v38OpenBookingInvoiceById(id);actions.appendChild(b);
      }
    });
  },20);
  return r;
};

// Running Account gets a standardized Invoice button.
const v38AccountBase=openCottageAccount;
openCottageAccount=async function(bookingId,paxId=null){
  await v38AccountBase(bookingId,paxId);
  setTimeout(()=>{
    const footer=$('#modalFooter');if(!footer||footer.querySelector('#v38AccountInvoice'))return;
    const btn=document.createElement('button');btn.id='v38AccountInvoice';btn.className='btn btn-soft';btn.textContent='Invoice';
    btn.onclick=()=>v38OpenBookingInvoiceById(bookingId);
    footer.insertBefore(btn,footer.firstChild);
  },40);
};

/* ---------- ALL-PAGE MONTH / YEAR REPORTING ---------- */

const v38GetPageReportBase=v37GetPageReport;
v37GetPageReport=async function(page,p){
  // Master/operational pages now produce period-specific activity instead of an unfiltered snapshot.
  if(page==='rooms'||page==='cottages'){
    const units=(page==='rooms'?state.cache.rooms:state.cache.cottages)||[];
    const type=page==='rooms'?'room':'cottage';
    const created=units.filter(x=>v37DateInPeriod(x.created_at,p));
    const bookings=(state.cache.bookings||[]).filter(b=>{
      const unitOk=type==='room'?!!b.room_id:!!b.cottage_id;
      if(!unitOk)return false;
      const start=String(b.check_in_date||b.booking_date||'').slice(0,10),end=String(b.check_out_date||start).slice(0,10);
      return start<=p.end && end>=p.start;
    });
    const pax=bookings.reduce((s,b)=>s+Number(b.adults||0)+Number(b.kids||0)+Number(b.babies||0),0);
    const revenue=bookings.reduce((s,b)=>s+Number(b.total_amount||0),0);
    return {title:page==='rooms'?'Rooms Activity Report':'Cottages Activity Report',period:p,
      kpis:[['Units Created',created.length,'Added in selected period'],['Bookings',bookings.length,'Bookings overlapping period'],['Booked Pax',pax,'Across units'],['Booked Amount',v37Money(revenue),'Booking totals']],
      tables:[
        {title:'Units Added During Period',cols:['#','Unit','Type','Capacity','Base Rate','Status','Created'],rows:created.map((x,i)=>[i+1,x.name||x.unit_number||'—',x.room_type||x.cottage_type||'—',x.capacity||0,v37Money(x.base_rate),x.status||'—',x.created_at?new Date(x.created_at).toLocaleDateString('en-PH'):'—'])},
        {title:'Bookings Using These '+(page==='rooms'?'Rooms':'Cottages'),cols:['#','Booking','Guest','Unit','Check-in','Check-out','Pax','Amount'],rows:bookings.map((b,i)=>[i+1,b.booking_number||'—',b.guest_name||'Guest',v37BookingUnit(b),fmtDate(b.check_in_date),fmtDate(b.check_out_date),Number(b.adults||0)+Number(b.kids||0)+Number(b.babies||0),v37Money(b.total_amount)])}
      ]};
  }

  if(page==='inventory'||page==='pos'){
    const movements=await v37Fetch('stock_movements');
    const rows=movements.filter(x=>v37DateInPeriod(x.created_at,p));
    const items=state.cache.inventory||[];
    const itemMap=Object.fromEntries(items.map(x=>[x.id,x]));
    const qty=rows.reduce((s,x)=>s+Math.abs(Number(x.quantity||0)),0);
    const value=rows.reduce((s,x)=>s+Math.abs(Number(x.quantity||0))*Number(x.unit_cost||0),0);
    return {title:page==='inventory'?'Inventory Movement Report':'POS / Stock Movement Report',period:p,
      kpis:[['Movements',rows.length,'Selected period'],['Items',new Set(rows.map(x=>x.inventory_item_id)).size,'Unique items'],['Qty Moved',qty,'Absolute units'],['Movement Value',v37Money(value),'Qty × unit cost']],
      tables:[{title:'Stock Movements',cols:['#','Date/Time','Item','Type','Quantity','Unit Cost','Value','Notes'],rows:rows.map((x,i)=>[i+1,x.created_at?new Date(x.created_at).toLocaleString('en-PH'):'—',itemMap[x.inventory_item_id]?.name||x.inventory_item_id||'—',x.movement_type||'—',x.quantity||0,v37Money(x.unit_cost),v37Money(Math.abs(Number(x.quantity||0))*Number(x.unit_cost||0)),x.notes||'—'])}]};
  }

  if(page==='services'){
    const all=state.cache.services||await v37Fetch('service_library');
    const rows=all.filter(x=>v37DateInPeriod(x.created_at||x.updated_at,p));
    return {title:'Services Report',period:p,kpis:[['Service Records',rows.length,'Created/recorded in period'],['Active',rows.filter(x=>x.is_active!==false).length,'Active'],['Inactive',rows.filter(x=>x.is_active===false).length,'Inactive'],['Average Rate',v37Money(rows.length?rows.reduce((s,x)=>s+Number(x.price||x.rate||0),0)/rows.length:0),'Average']],
      tables:[{title:'Services',cols:['#','Service','Category','Rate','Active','Created'],rows:rows.map((x,i)=>[i+1,x.name||x.service_name||'—',x.category||'—',v37Money(x.price||x.rate),x.is_active===false?'No':'Yes',x.created_at?new Date(x.created_at).toLocaleDateString('en-PH'):'—'])}]};
  }

  if(page==='rates'){
    const all=state.cache.tourRates||await v37Fetch('tour_rates');
    const rows=all.filter(x=>v37DateInPeriod(x.created_at||x.updated_at,p));
    return {title:'Rates & Pricing Report',period:p,kpis:[['Rate Records',rows.length,'Created/changed in period'],['Active',rows.filter(x=>x.is_active!==false).length,'Active'],['Special Event',rows.filter(x=>String(x.code||'').includes('special')).length,'Special event rates'],['Generated',new Date().toLocaleDateString('en-PH'),'Report date']],
      tables:[{title:'Rate Records',cols:['#','Rate Type','Code','Adult','Kids','Baby','Active'],rows:rows.map((x,i)=>[i+1,x.name||'—',x.code||'—',v37Money(x.adult_rate),v37Money(x.kid_rate),Number(x.baby_rate||0)===0?'FREE':v37Money(x.baby_rate),x.is_active===false?'No':'Yes'])}]};
  }

  if(page==='users'){
    const all=await v37Fetch('profiles'),rows=all.filter(x=>v37DateInPeriod(x.created_at,p));
    return {title:'Users Report',period:p,kpis:[['Users Created',rows.length,'Selected period'],['Active',rows.filter(x=>x.is_active!==false).length,'Currently active'],['Inactive',rows.filter(x=>x.is_active===false).length,'Currently inactive'],['Admins',rows.filter(x=>x.role==='admin').length,'Admin users']],
      tables:[{title:'Users Created in Period',cols:['#','Name','Email','Role','Active','Created'],rows:rows.map((x,i)=>[i+1,x.full_name||'—',x.email||'—',x.role||'—',x.is_active===false?'No':'Yes',x.created_at?new Date(x.created_at).toLocaleString('en-PH'):'—'])}]};
  }

  if(page==='roles'){
    const roles=await v37Fetch('roles'),perms=await v37Fetch('role_permissions');
    const rows=roles.filter(x=>v37DateInPeriod(x.created_at||x.updated_at,p));
    return {title:'Roles & Access Report',period:p,kpis:[['Role Records',rows.length,'Created/changed in period'],['System Roles',rows.filter(x=>x.is_system).length,'System'],['Custom Roles',rows.filter(x=>!x.is_system).length,'Custom'],['Permissions',perms.filter(pm=>rows.some(r=>r.id===pm.role_id)).length,'Permission rows']],
      tables:[{title:'Role Records',cols:['#','Role','Code','Type','Visible Pages','Created'],rows:rows.map((x,i)=>[i+1,x.name||'—',x.code||'—',x.is_system?'System':'Custom',perms.filter(pm=>pm.role_id===x.id&&pm.can_view).length,x.created_at?new Date(x.created_at).toLocaleDateString('en-PH'):'—'])}]};
  }

  if(page==='settings'){
    const audit=await v37Fetch('audit_logs');
    const rows=audit.filter(x=>v37DateInPeriod(x.created_at,p)&&String(x.table_name||'')==='system_settings');
    return {title:'Settings Change Report',period:p,kpis:[['Changes',rows.length,'Settings audit entries'],['Users',new Set(rows.map(x=>x.user_email).filter(Boolean)).size,'Users making changes'],['Current Resort',v36ResortName(),'Current branding'],['Generated',new Date().toLocaleDateString('en-PH'),'Report date']],
      tables:[{title:'Settings Changes',cols:['#','Date/Time','User','Action','Details'],rows:rows.map((x,i)=>[i+1,x.created_at?new Date(x.created_at).toLocaleString('en-PH'):'—',x.user_email||'—',x.action||'—',x.details||'—'])}]};
  }

  if(page==='live'||page==='availability'){
    const bookings=(state.cache.bookings||[]).filter(b=>{
      const start=String(b.check_in_date||b.booking_date||'').slice(0,10),end=String(b.check_out_date||start).slice(0,10);
      return start<=p.end&&end>=p.start;
    });
    const roomBookings=bookings.filter(b=>b.room_id),cottageBookings=bookings.filter(b=>b.cottage_id);
    const pax=bookings.reduce((s,b)=>s+Number(b.adults||0)+Number(b.kids||0)+Number(b.babies||0),0);
    return {title:page==='live'?'Rooms & Cottages Utilization Report':'Availability / Utilization Report',period:p,kpis:[['Bookings',bookings.length,'Overlapping selected period'],['Room Bookings',roomBookings.length,'Room stays'],['Cottage Bookings',cottageBookings.length,'Cottage use'],['Pax',pax,'Booked pax']],
      tables:[{title:'Unit Utilization',cols:['#','Booking','Guest','Unit','Check-in','Check-out','Status','Pax'],rows:bookings.map((b,i)=>[i+1,b.booking_number||'—',b.guest_name||'Guest',v37BookingUnit(b),fmtDate(b.check_in_date),fmtDate(b.check_out_date),b.status||'—',Number(b.adults||0)+Number(b.kids||0)+Number(b.babies||0)])}]};
  }

  return v38GetPageReportBase(page,p);
};

// Every page now ALWAYS asks Month or Whole Year.
printElementView=function(name){v37ReportPeriodModal(name);};

setTimeout(()=>{
  if($('#pageReportBtn'))$('#pageReportBtn').onclick=()=>v37ReportPeriodModal(state.currentView||'dashboard');
},30);

// Central Reports maps every option to its professional page report.
v37PrintCentralReport=async function(){
  await refreshOperations();
  const type=$('#reportType')?.value||'bookings';
  const mode=$('#reportPeriodMode')?.value||'month';
  const p=v37Period(mode,v37MonthValue(),v37YearValue());

  if(type==='pax_demographics'){
    const bookingMap=Object.fromEntries((state.cache.bookings||[]).map(b=>[b.id,b]));
    const rows=(state.cache.pax||[]).filter(px=>{
      const b=bookingMap[px.booking_id];
      return b&&v37DateInPeriod(b.check_in_date||b.booking_date,p)&&px.access_status!=='cancelled';
    });
    const genders={Male:0,Female:0,'LGBTQIA+':0,'Not specified':0};
    rows.forEach(px=>genders[px.gender]!==undefined?genders[px.gender]++:genders['Not specified']++);
    const areas={};rows.forEach(px=>{const a=px.area_name||px.area||'Not specified';areas[a]=(areas[a]||0)+1;});
    const outside=rows.filter(px=>{const a=String(px.area_name||px.area||'').trim();return a&&a.toLowerCase()!=='naic';}).length;
    const r={title:'Pax Demographics & Area Report',period:p,
      kpis:[['Pax',rows.length,'Booked pax'],['Male',genders.Male,'Gender'],['Female',genders.Female,'Gender'],['Outside Naic',outside,'Selected period']],
      tables:[
        {title:'Gender Summary',cols:['Gender','Count'],rows:Object.entries(genders)},
        {title:'Area Summary',cols:['Area','Count'],rows:Object.entries(areas).sort((a,b)=>b[1]-a[1])},
        {title:'Pax Details',cols:['#','Pax','Gender','Area','Booking','Client'],rows:rows.map((px,i)=>[i+1,px.display_name||paxDisplayName(px),px.gender||'Not specified',px.area_name||px.area||'Not specified',bookingMap[px.booking_id]?.booking_number||'—',bookingMap[px.booking_id]?.guest_name||'Guest'])}
      ]};
    return v36OpenPrintWindow(v37ProfessionalReportHtml(r));
  }
  const map={occupancy:'availability'};
  const r=await v37GetPageReport(map[type]||type,p);
  if(type==='occupancy')r.title='Occupancy Report';
  v36OpenPrintWindow(v37ProfessionalReportHtml(r));
};

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v39.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V3.9
   COUPONS & VOUCHERS
   ============================================================ */

state.cache.coupons = state.cache.coupons || [];
state.cache.couponRedemptions = state.cache.couponRedemptions || [];

// Make Coupons a real role/permission page.
if(typeof V29_PAGES!=='undefined' && !V29_PAGES.some(x=>x[0]==='coupons')){
  const ratesIndex=V29_PAGES.findIndex(x=>x[0]==='rates');
  V29_PAGES.splice(ratesIndex>=0?ratesIndex+1:V29_PAGES.length,0,['coupons','Coupons & Vouchers']);
}

const v39PreloadBase=preload;
preload=async function(){
  await v39PreloadBase();
  await Promise.all([
    getTable('coupon_codes','coupons'),
    getTable('coupon_redemptions','couponRedemptions')
  ]);
};

const v39RefreshBase=refreshOperations;
refreshOperations=async function(){
  await v39RefreshBase();
  await Promise.all([
    getTable('coupon_codes','coupons'),
    getTable('coupon_redemptions','couponRedemptions')
  ]);
};

function v39CouponUsage(couponId){
  return (state.cache.couponRedemptions||[]).filter(x=>x.coupon_id===couponId && x.status==='applied').length;
}
function v39CouponStatus(c){
  const d=today();
  if(c.is_active===false)return 'inactive';
  if(c.valid_from && d<c.valid_from)return 'scheduled';
  if(c.valid_until && d>c.valid_until)return 'expired';
  if(c.max_uses && v39CouponUsage(c.id)>=Number(c.max_uses))return 'used_up';
  return 'active';
}
function v39CouponDiscountText(c){
  if(c.discount_type==='fixed')return money(c.discount_value);
  return `${Number(c.discount_value||0)}%${c.max_discount?` · Max ${money(c.max_discount)}`:''}`;
}
function v39GenerateCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let x='MFR-';
  for(let i=0;i<8;i++)x+=chars[Math.floor(Math.random()*chars.length)];
  return x;
}
function v39Can(page,act){ return typeof v29Perm==='function'?v29Perm(page,act):true; }

async function renderCouponsV39(){
  await Promise.all([getTable('coupon_codes','coupons'),getTable('coupon_redemptions','couponRedemptions')]);
  const root=$('#view-coupons');if(!root)return;
  const coupons=state.cache.coupons||[];
  root.innerHTML=`<div class="section-head">
    <div><p class="eyebrow">DISCOUNT CODE LIBRARY</p><h2>Coupons & Vouchers</h2><p class="muted">Generate controlled coupon codes for resort bookings. Usage and discount amounts are recorded automatically.</p></div>
    ${v39Can('coupons','add')?'<button class="btn btn-primary" id="v39AddCoupon">Generate Coupon</button>':''}
  </div>
  <div class="stats-grid small">
    <div class="stat-card"><span>Total Coupons</span><strong>${coupons.length}</strong><small>Coupon library</small></div>
    <div class="stat-card"><span>Active</span><strong>${coupons.filter(c=>v39CouponStatus(c)==='active').length}</strong><small>Usable today</small></div>
    <div class="stat-card"><span>Redemptions</span><strong>${(state.cache.couponRedemptions||[]).filter(x=>x.status==='applied').length}</strong><small>Currently applied</small></div>
    <div class="stat-card"><span>Discount Given</span><strong>${money((state.cache.couponRedemptions||[]).filter(x=>x.status==='applied').reduce((s,x)=>s+Number(x.discount_amount||0),0))}</strong><small>Active redemptions</small></div>
  </div>
  <div class="table-panel" style="margin-top:16px">
    <div class="table-toolbar">
      <input id="v39CouponSearch" class="grow" type="search" placeholder="Search coupon code or name...">
      <select id="v39CouponStatus"><option value="">All Status</option><option value="active">Active</option><option value="scheduled">Scheduled</option><option value="expired">Expired</option><option value="used_up">Used Up</option><option value="inactive">Inactive</option></select>
      <button class="btn btn-soft" id="v39CouponReport">Coupon Report</button>
    </div>
    <div class="table-scroll"><table class="data-table">
      <thead><tr><th>#</th><th>Coupon Code</th><th>Name</th><th>Discount</th><th>Min. Spend</th><th>Validity</th><th>Usage</th><th>Stack</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody id="v39CouponBody"></tbody>
    </table></div>
  </div>`;

  const draw=()=>{
    const q=$('#v39CouponSearch').value.toLowerCase().trim(),st=$('#v39CouponStatus').value;
    const filtered=coupons.filter(c=>`${c.code} ${c.name}`.toLowerCase().includes(q)&&(!st||v39CouponStatus(c)===st))
      .sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
    $('#v39CouponBody').innerHTML=filtered.length?filtered.map((c,i)=>`<tr>
      <td><strong>${i+1}</strong></td>
      <td><strong>${esc(c.code)}</strong></td>
      <td>${esc(c.name)}</td>
      <td>${esc(v39CouponDiscountText(c))}</td>
      <td>${money(c.minimum_spend||0)}</td>
      <td>${fmtDate(c.valid_from)}${c.valid_until?`<br><small>to ${fmtDate(c.valid_until)}</small>`:'<br><small>No expiry</small>'}</td>
      <td>${v39CouponUsage(c.id)} / ${c.max_uses||'∞'}</td>
      <td>${c.stack_with_other_discount?'Allowed':'No'}</td>
      <td><span class="badge">${esc(v39CouponStatus(c))}</span></td>
      <td><div class="row-actions">
        <button data-v39-copy="${c.id}">Copy Code</button>
        <button data-v39-view="${c.id}">View</button>
        ${v39Can('coupons','edit')?`<button data-v39-edit="${c.id}">Edit</button><button data-v39-toggle="${c.id}">${c.is_active===false?'Activate':'Deactivate'}</button>`:''}
      </div></td>
    </tr>`).join(''):'<tr><td colspan="10" class="empty-state">No coupons found.</td></tr>';
    $$('[data-v39-copy]').forEach(x=>x.onclick=async()=>{const c=coupons.find(c=>c.id===x.dataset.v39Copy);try{await navigator.clipboard.writeText(c.code);toast('Coupon code copied.')}catch{toast(c.code)}});
    $$('[data-v39-view]').forEach(x=>x.onclick=()=>v39CouponDetails(coupons.find(c=>c.id===x.dataset.v39View)));
    $$('[data-v39-edit]').forEach(x=>x.onclick=()=>v39CouponModal(coupons.find(c=>c.id===x.dataset.v39Edit)));
    $$('[data-v39-toggle]').forEach(x=>x.onclick=async()=>{const c=coupons.find(c=>c.id===x.dataset.v39Toggle);const {error}=await sb.from('coupon_codes').update({is_active:c.is_active===false,updated_at:new Date().toISOString()}).eq('id',c.id);if(error)return toast(error.message,'error');await getTable('coupon_codes','coupons');renderCouponsV39();toast(c.is_active===false?'Coupon activated.':'Coupon deactivated.');});
  };
  $('#v39CouponSearch').oninput=draw;$('#v39CouponStatus').onchange=draw;
  if($('#v39AddCoupon'))$('#v39AddCoupon').onclick=()=>v39CouponModal(null);
  $('#v39CouponReport').onclick=()=>v37ReportPeriodModal('coupons');
  draw();
}

function v39CouponModal(c=null){
  const generated=c?.code||v39GenerateCode();
  openModal({
    title:c?'Edit Coupon':'Generate Coupon',
    eyebrow:'COUPON / VOUCHER',
    wide:true,
    body:`<form id="v39CouponForm" class="modal-form">
      <label>Coupon Name<input name="name" required value="${esc(c?.name||'')}" placeholder="Example: Rainy Day Promo"></label>
      <label>Coupon Code<div style="display:flex;gap:7px"><input id="v39CouponCode" name="code" required value="${esc(generated)}" style="flex:1"><button type="button" class="btn btn-soft" id="v39RegenCode">Generate</button></div></label>
      <label>Discount Type<select name="discount_type"><option value="percent" ${c?.discount_type!=='fixed'?'selected':''}>Percentage (%)</option><option value="fixed" ${c?.discount_type==='fixed'?'selected':''}>Fixed Amount (₱)</option></select></label>
      <label>Discount Value<input name="discount_value" type="number" min="0" step="0.01" required value="${Number(c?.discount_value||0)}"></label>
      <label>Maximum Discount <span class="tiny muted">(optional for %)</span><input name="max_discount" type="number" min="0" step="0.01" value="${c?.max_discount??''}" placeholder="No cap"></label>
      <label>Minimum Spend<input name="minimum_spend" type="number" min="0" step="0.01" value="${Number(c?.minimum_spend||0)}"></label>
      <label>Valid From<input name="valid_from" type="date" required value="${c?.valid_from||today()}"></label>
      <label>Valid Until<input name="valid_until" type="date" value="${c?.valid_until||''}"></label>
      <label>Maximum Uses<input name="max_uses" type="number" min="1" step="1" value="${c?.max_uses??''}" placeholder="Unlimited"></label>
      <label>Can Combine with Senior/PWD?<select name="stack_with_other_discount"><option value="false" ${!c?.stack_with_other_discount?'selected':''}>No</option><option value="true" ${c?.stack_with_other_discount?'selected':''}>Yes</option></select></label>
      <label>Active<select name="is_active"><option value="true" ${c?.is_active!==false?'selected':''}>Yes</option><option value="false" ${c?.is_active===false?'selected':''}>No</option></select></label>
      <label class="full">Notes<textarea name="notes" rows="3">${esc(c?.notes||'')}</textarea></label>
      <p class="tiny muted full">Only one coupon can be active on a booking at a time. If stacking is disabled, the coupon cannot be combined with an existing Senior/PWD booking discount.</p>
    </form>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v39SaveCoupon">${c?'Save Changes':'Create Coupon'}</button>`
  });
  $('[data-modal-cancel]').onclick=closeModal;
  $('#v39RegenCode').onclick=()=>$('#v39CouponCode').value=v39GenerateCode();
  $('#v39SaveCoupon').onclick=async()=>{
    const fd=new FormData($('#v39CouponForm'));
    const type=fd.get('discount_type'),value=Number(fd.get('discount_value')||0);
    if(!String(fd.get('name')||'').trim())return toast('Coupon name is required.','error');
    if(!String(fd.get('code')||'').trim())return toast('Coupon code is required.','error');
    if(value<=0)return toast('Discount value must be greater than zero.','error');
    if(type==='percent'&&value>100)return toast('Percentage discount cannot exceed 100%.','error');
    const payload={
      name:String(fd.get('name')).trim(),
      code:String(fd.get('code')).trim().toUpperCase().replace(/\s+/g,'-'),
      discount_type:type,discount_value:value,
      max_discount:fd.get('max_discount')===''?null:Number(fd.get('max_discount')),
      minimum_spend:Number(fd.get('minimum_spend')||0),
      valid_from:fd.get('valid_from')||today(),
      valid_until:fd.get('valid_until')||null,
      max_uses:fd.get('max_uses')===''?null:Number(fd.get('max_uses')),
      stack_with_other_discount:fd.get('stack_with_other_discount')==='true',
      is_active:fd.get('is_active')==='true',
      notes:fd.get('notes')||null,
      updated_at:new Date().toISOString()
    };
    if(!c)payload.created_by=state.session.user.id;
    const res=c?await sb.from('coupon_codes').update(payload).eq('id',c.id):await sb.from('coupon_codes').insert(payload);
    if(res.error)return toast(res.error.message,'error');
    closeModal();await getTable('coupon_codes','coupons');await writeAudit(c?'update':'insert','coupon_codes',c?.id||'',`${payload.code} coupon`);toast(c?'Coupon updated.':'Coupon generated.');renderCouponsV39();
  };
}

function v39CouponDetails(c){
  const uses=(state.cache.couponRedemptions||[]).filter(x=>x.coupon_id===c.id);
  openModal({
    title:c.code,
    eyebrow:'COUPON DETAILS',
    wide:true,
    body:`<div class="report-kpis">
      <div class="report-kpi"><span>Discount</span><strong>${esc(v39CouponDiscountText(c))}</strong></div>
      <div class="report-kpi"><span>Minimum Spend</span><strong>${money(c.minimum_spend||0)}</strong></div>
      <div class="report-kpi"><span>Uses</span><strong>${v39CouponUsage(c.id)} / ${c.max_uses||'∞'}</strong></div>
      <div class="report-kpi"><span>Status</span><strong>${esc(v39CouponStatus(c))}</strong></div>
    </div>
    <div class="panel" style="margin-top:14px"><h3>${esc(c.name)}</h3><p>Valid: ${fmtDate(c.valid_from)} ${c.valid_until?`to ${fmtDate(c.valid_until)}`:'with no expiry date'}</p><p>Senior/PWD stacking: <strong>${c.stack_with_other_discount?'Allowed':'Not allowed'}</strong></p>${c.notes?`<p class="muted">${esc(c.notes)}</p>`:''}</div>
    <div class="table-panel" style="margin-top:14px"><div class="panel-head" style="padding:14px 14px 0"><h3>Redemption History</h3></div><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Booking</th><th>Status</th><th>Discount</th><th>Applied</th></tr></thead><tbody>${uses.length?uses.map((r,i)=>{const b=state.cache.bookings.find(b=>b.id===r.booking_id);return`<tr><td>${i+1}</td><td>${esc(b?.booking_number||r.booking_id)}</td><td>${esc(r.status)}</td><td>${money(r.discount_amount||0)}</td><td>${r.applied_at?new Date(r.applied_at).toLocaleString('en-PH'):'—'}</td></tr>`}).join(''):'<tr><td colspan="5" class="empty-state">No redemption history.</td></tr>'}</tbody></table></div></div>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-primary" id="v39CopyCoupon">Copy Coupon Code</button>`
  });
  $('[data-modal-cancel]').onclick=closeModal;
  $('#v39CopyCoupon').onclick=async()=>{try{await navigator.clipboard.writeText(c.code);toast('Coupon code copied.')}catch{toast(c.code)}};
}

function v39CouponLabel(b){
  return b?.coupon_code ? `${b.coupon_code} · -${money(b.coupon_discount_amount||0)}` : 'No coupon';
}

function v39ApplyCouponModal(b){
  openModal({
    title:'Apply Coupon',
    eyebrow:`${b.booking_number} · ${b.guest_name||'Guest'}`,
    body:`<form id="v39ApplyCouponForm" class="modal-form">
      <label class="full">Coupon Code<input name="code" autocomplete="off" required placeholder="Enter coupon / voucher code"></label>
      <div class="panel full"><p><strong>Current Total:</strong> ${money(b.total_amount||0)}</p><p><strong>Current Coupon:</strong> ${esc(v39CouponLabel(b))}</p></div>
      <p class="tiny muted full">Coupon validity, expiry, usage limit, minimum spend, and stacking rule are checked by the database before the discount is accepted.</p>
    </form>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button>${b.coupon_code?'<button class="btn btn-danger" id="v39RemoveCoupon">Remove Current Coupon</button>':''}<button class="btn btn-primary" id="v39ApplyCoupon">Apply Coupon</button>`
  });
  $('[data-modal-cancel]').onclick=closeModal;
  $('#v39ApplyCoupon').onclick=async()=>{
    const code=String(new FormData($('#v39ApplyCouponForm')).get('code')||'').trim();
    if(!code)return toast('Enter a coupon code.','error');
    const {data,error}=await sb.rpc('apply_coupon_to_booking',{p_booking_id:b.id,p_code:code});
    if(error)return toast(error.message,'error');
    const result=Array.isArray(data)?data[0]:data;
    if(!result?.ok)return toast(result?.message||'Coupon could not be applied.','error');
    closeModal();await refreshOperations();toast(`${result.coupon_code} applied: ${money(result.discount_amount)} discount.`);
    if(state.currentView==='invoices')renderInvoicesV38();else renderCurrent();
  };
  if($('#v39RemoveCoupon'))$('#v39RemoveCoupon').onclick=async()=>{
    const {data,error}=await sb.rpc('remove_coupon_from_booking',{p_booking_id:b.id});
    if(error)return toast(error.message,'error');
    const result=Array.isArray(data)?data[0]:data;
    if(!result?.ok)return toast(result?.message||'Coupon could not be removed.','error');
    closeModal();await refreshOperations();toast('Coupon removed.');renderCurrent();
  };
}

// Coupon page routing.
const v39RenderCurrentBase=renderCurrent;
renderCurrent=async function(){
  if(state.currentView==='coupons')return renderCouponsV39();
  const r=await v39RenderCurrentBase();
  setTimeout(v39EnhanceBookingCouponActions,30);
  return r;
};
const v39NavigateBase=navigate;
navigate=function(view){
  if(view==='coupons'){
    if(typeof v29Perm==='function'&&!v29Perm('coupons','view'))return v29Denied('coupons');
    state.currentView='coupons';
    $$('.view').forEach(v=>v.classList.remove('active'));$('#view-coupons')?.classList.add('active');
    $$('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.view==='coupons'));$('#sidebar').classList.remove('open');
    $('#pageTitle').textContent='Coupons & Vouchers';return renderCouponsV39();
  }
  return v39NavigateBase(view);
};

// Booking list buttons.
function v39EnhanceBookingCouponActions(){
  $$('[data-view-record="bookings"],[data-v23-view]').forEach(btn=>{
    const id=btn.dataset.id||btn.dataset.v23View,actions=btn.closest('.row-actions');
    if(!id||!actions||actions.querySelector(`[data-v39-coupon="${id}"]`))return;
    const b=document.createElement('button');b.className='btn btn-soft';b.dataset.v39Coupon=id;b.textContent='Coupon';
    b.onclick=()=>{const booking=state.cache.bookings.find(x=>x.id===id);if(booking)v39ApplyCouponModal(booking);};actions.appendChild(b);
  });
}

// Running Account: show coupon and add button.
const v39AccountBase=openCottageAccount;
openCottageAccount=async function(bookingId,paxId=null){
  await v39AccountBase(bookingId,paxId);
  const b=state.cache.bookings.find(x=>x.id===bookingId);
  setTimeout(()=>{
    if(!b)return;
    const footer=$('#modalFooter');
    if(footer&&!footer.querySelector('#v39AccountCoupon')){
      const btn=document.createElement('button');btn.id='v39AccountCoupon';btn.className='btn btn-soft';btn.textContent=b.coupon_code?'Change Coupon':'Apply Coupon';btn.onclick=()=>v39ApplyCouponModal(b);footer.insertBefore(btn,footer.firstChild);
    }
    const body=$('#modalBody');
    if(body&&!body.querySelector('#v39CouponSummary')){
      const div=document.createElement('div');div.id='v39CouponSummary';div.className='panel';div.style.marginTop='14px';
      div.innerHTML=`<div class="panel-head"><h3>Coupon / Voucher</h3></div><p><strong>${esc(b.coupon_code||'No coupon applied')}</strong></p><p class="muted">${b.coupon_code?`Coupon Discount: -${money(b.coupon_discount_amount||0)}`:'Enter a valid coupon code to apply a promotional discount.'}</p>`;
      body.insertBefore(div,body.children[1]||null);
    }
  },50);
};

// Invoice model and professional invoice include coupon separately.
const v39InvoiceModelBase=v38InvoiceModel;
v38InvoiceModel=function(inv,b=null){
  const m=v39InvoiceModelBase(inv,b);
  m.coupon_code=m.b?.coupon_code||null;
  m.coupon_discount=Number(m.b?.coupon_discount_amount||0);
  m.total=Math.max(0,Number(m.subtotal||0)-Number(m.discount||0)-m.coupon_discount);
  m.balance=Math.max(0,m.total-Number(m.paid||0));
  m.status=v38InvoiceStatus(m.total,m.paid,inv?.status==='void');
  return m;
};

v38InvoiceHtml=function(inv){
  const m=v38InvoiceModel(inv);
  return `${v36DocStyles(m.invoice_number)}
  <div class="page"><div class="sheet">
    <div class="hero"><div class="brand"><img src="${v36LogoUrl()}" alt="Logo" onerror="this.style.display='none'"><div><h1>${esc(v36ResortName())}</h1><p>OFFICIAL GUEST INVOICE</p></div></div><div class="doc-meta"><strong>Invoice Number</strong><div>${esc(m.invoice_number)}</div><strong style="margin-top:10px">Invoice Date</strong><div>${fmtDate(m.invoice_date)}</div><strong style="margin-top:10px">Status</strong><div><span class="badge">${esc(m.status)}</span></div></div></div>
    <div class="content">
      <div class="grid-2"><div class="card"><div class="label">Billed To</div><div class="value">${esc(m.guest)}</div><div class="muted">${esc(m.contact||'No contact number')}</div></div><div class="card"><div class="label">Booking Reference</div><div class="value">${esc(m.booking_number)}</div><div class="muted">${esc(m.booking_type)} · ${esc(m.unit.label)}: ${esc(m.unit.value)}</div></div></div>
      <div class="section"><h2>Charges & Services</h2><table><thead><tr><th>#</th><th>Item</th><th>Description</th><th class="num">Qty</th><th class="num">Unit Price</th><th class="num">Discount</th><th class="num">Amount</th></tr></thead><tbody>${m.lines.length?m.lines.map((r,i)=>`<tr><td>${i+1}</td><td><strong>${esc(r.item)}</strong></td><td>${esc(r.description)}</td><td class="num">${esc(r.qty)}</td><td class="num">${money(r.unit_price)}</td><td class="num">${r.discount?`- ${money(r.discount)}`:'—'}</td><td class="num"><strong>${money(r.amount)}</strong></td></tr>`).join(''):'<tr><td colspan="7">No charge lines found.</td></tr>'}</tbody></table></div>
      <div class="section" style="display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1 1 420px"><h2>Payment History</h2>${m.payments.length?`<table><thead><tr><th>#</th><th>Date</th><th>Method</th><th>Reference</th><th class="num">Amount</th></tr></thead><tbody>${m.payments.map((p,i)=>`<tr><td>${i+1}</td><td>${fmtDate(p.payment_date)}</td><td>${esc(p.method||'Payment')}</td><td>${esc(p.reference_number||'—')}</td><td class="num"><strong>${money(p.amount)}</strong></td></tr>`).join('')}</tbody></table>`:'<div class="note">No payment has been recorded yet.</div>'}${m.notes?`<div class="note"><strong>Invoice Notes:</strong> ${esc(m.notes)}</div>`:''}</div>
        <div class="summary"><div class="summary-row"><span>Gross / Subtotal</span><strong>${money(m.subtotal)}</strong></div><div class="summary-row"><span>Senior/PWD Discount</span><strong>- ${money(m.discount)}</strong></div>${m.coupon_code?`<div class="summary-row"><span>Coupon ${esc(m.coupon_code)}</span><strong>- ${money(m.coupon_discount)}</strong></div>`:''}<div class="summary-row"><span>Net Total</span><strong>${money(m.total)}</strong></div><div class="summary-row"><span>Total Paid</span><strong>${money(m.paid)}</strong></div><div class="summary-row total"><span>Balance Due</span><strong>${money(m.balance)}</strong></div></div>
      </div>
      <div class="note" style="margin-top:24px">${esc(state.settings?.invoice_footer||'Thank you for choosing Masusi Farm Resort. Please keep this invoice for your records.')}</div>
      <div class="sign-row"><div class="sign-box">Prepared by / Cashier</div><div class="sign-box">Guest / Client Acknowledgment</div></div>
    </div><div class="footer-note">${esc(v36ResortName())} · ${esc(m.invoice_number)} · Generated ${new Date().toLocaleString('en-PH')}</div>
  </div></div><script>window.onload=()=>setTimeout(()=>window.print(),180);<\/script></body></html>`;
};
v36InvoiceHtml=v38InvoiceHtml;
v36PrintInvoice=function(inv){if(inv)v36OpenPrintWindow(v38InvoiceHtml(inv));};

// Coupon report.
const v39GetPageReportBase=v37GetPageReport;
v37GetPageReport=async function(page,p){
  if(page==='coupons'){
    await Promise.all([getTable('coupon_codes','coupons'),getTable('coupon_redemptions','couponRedemptions')]);
    const reds=(state.cache.couponRedemptions||[]).filter(x=>v37DateInPeriod(x.applied_at,p));
    const couponMap=Object.fromEntries((state.cache.coupons||[]).map(c=>[c.id,c]));
    const bookingMap=Object.fromEntries((state.cache.bookings||[]).map(b=>[b.id,b]));
    const applied=reds.filter(x=>x.status==='applied');
    const total=applied.reduce((s,x)=>s+Number(x.discount_amount||0),0);
    return {title:'Coupon / Voucher Report',period:p,
      kpis:[['Redemptions',reds.length,'Applied/removed records'],['Active Applied',applied.length,'Currently applied'],['Discount Given',money(total),'Current applied redemptions'],['Coupon Codes',new Set(reds.map(x=>x.coupon_id)).size,'Used in period']],
      tables:[{title:'Coupon Redemption Register',cols:['#','Applied','Coupon','Campaign','Booking','Client','Status','Discount'],rows:reds.map((r,i)=>[i+1,r.applied_at?new Date(r.applied_at).toLocaleString('en-PH'):'—',r.coupon_code||'—',couponMap[r.coupon_id]?.name||'—',bookingMap[r.booking_id]?.booking_number||'—',bookingMap[r.booking_id]?.guest_name||'Guest',r.status||'—',money(r.discount_amount||0)])}]};
  }
  return v39GetPageReportBase(page,p);
};

// Add Coupon Report to central report dropdown at runtime.
setTimeout(()=>{
  const sel=$('#reportType');
  if(sel&&!sel.querySelector('option[value="coupons"]')){
    const o=document.createElement('option');o.value='coupons';o.textContent='Coupon / Voucher Report';sel.appendChild(o);
  }
},40);

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v40.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V4.0
   RESPONSIVE UI HARDENING + STAFF QR-FIRST HOME
   ============================================================ */

function v40RoleCode(){
  return String(state.profile?.roles?.code || state.profile?.role || '').trim().toLowerCase();
}
function v40IsStaff(){
  return v40RoleCode()==='staff';
}
function v40BestLandingPage(){
  if(v40IsStaff() && v29Perm('barcode','view')) return 'barcode';
  return V29_PAGES.find(([p])=>v29Perm(p,'view'))?.[0] || 'dashboard';
}

/* Final login layer:
   Staff opens directly on Barcode Scanner.
   Other roles keep permission-based first page.
*/
const v40AfterLoginBase=afterLogin;
afterLogin=async function(){
  state.session=(await sb.auth.getSession()).data.session;
  if(!state.session){showLogin();return;}
  await loadProfile();
  await v29LoadAccess();
  await loadSettings();
  await preload();
  setupRealtime();
  showApp();
  navigate(v40BestLandingPage());

  // On phones/tablets, place focus on the scanner input for staff.
  if(v40IsStaff() && v29Perm('barcode','view')){
    setTimeout(()=>{
      const input=$('#barcodeInput');
      if(input && window.innerWidth>900) input.focus();
    },150);
  }
};

/* Add data-label attributes to all rendered table cells.
   Mobile CSS uses these labels to turn wide tables into vertical cards,
   eliminating left/right table scrolling on phone/tablet.
*/
function v40LabelTable(table){
  if(!table)return;
  const headers=[...table.querySelectorAll('thead th')].map(th=>
    String(th.textContent||'').replace(/\s+/g,' ').trim()
  );
  table.querySelectorAll('tbody tr').forEach(tr=>{
    [...tr.children].forEach((td,i)=>{
      if(td.tagName==='TD' && !td.hasAttribute('data-label')){
        td.setAttribute('data-label',headers[i]||`Field ${i+1}`);
      }
    });
  });
}
function v40LabelAllTables(root=document){
  root.querySelectorAll('table').forEach(v40LabelTable);
}
const v40TableObserver=new MutationObserver(mutations=>{
  let needs=false;
  for(const m of mutations){
    if(m.addedNodes?.length){needs=true;break;}
  }
  if(needs) requestAnimationFrame(()=>v40LabelAllTables(document));
});
v40TableObserver.observe(document.body,{childList:true,subtree:true});
document.addEventListener('DOMContentLoaded',()=>v40LabelAllTables(document));
setTimeout(()=>v40LabelAllTables(document),400);

/* Mobile navigation safety:
   drawer closes after selection and whenever screen grows back to desktop.
*/
document.addEventListener('click',e=>{
  const nav=e.target.closest('.nav-link[data-view]');
  if(nav && window.innerWidth<=1024) $('#sidebar')?.classList.remove('open');
});
window.addEventListener('resize',()=>{
  if(window.innerWidth>1024) $('#sidebar')?.classList.remove('open');
});

/* Prevent accidental horizontal drag caused by leftover inline/min-width values. */
function v40SanitizeResponsiveWidths(){
  if(window.innerWidth>1024)return;
  document.querySelectorAll('.view.active [style]').forEach(el=>{
    const s=el.getAttribute('style')||'';
    if(/min-width\s*:\s*[6-9]\d{2}px|min-width\s*:\s*\d{4,}px/i.test(s)){
      el.style.minWidth='0';
      el.style.maxWidth='100%';
    }
  });
  v40LabelAllTables(document);
}
const v40RenderCurrentBase=renderCurrent;
renderCurrent=async function(){
  const r=await v40RenderCurrentBase();
  requestAnimationFrame(v40SanitizeResponsiveWidths);
  return r;
};

/* Staff scanner helper banner. */
function v40EnhanceBarcodePage(){
  const root=$('#view-barcode');
  if(!root || root.querySelector('.v40-staff-scan-banner'))return;
  const first=root.querySelector('.section-head');
  if(v40IsStaff()){
    const box=document.createElement('div');
    box.className='panel v40-staff-scan-banner';
    box.innerHTML=`<div class="panel-head"><div><p class="eyebrow">STAFF QUICK START</p><h3>Scan Guest QR / Barcode</h3></div></div>
      <p class="muted">This is your default screen after login. Use the phone/tablet camera or a USB/Bluetooth scanner.</p>`;
    first?.after(box);
  }
}
const v40NavigateBase=navigate;
navigate=function(view){
  const r=v40NavigateBase(view);
  if(view==='barcode')setTimeout(v40EnhanceBarcodePage,30);
  return r;
};

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v41.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V4.1
   PAX-FIRST BOOKING FLOW
   Booker is Pax #1; category is assigned later / on scan.
   ============================================================ */

function v41PaxCategory(p){
  if(!p || p.category_confirmed===false || p.pax_type==='unclassified')return 'Not classified';
  if(p.is_senior)return 'Senior';
  if(p.is_pwd)return 'PWD';
  if(p.pax_type==='kid')return 'Kid';
  if(p.pax_type==='baby')return 'Baby';
  return 'Adult';
}
function v41ActivePax(bookingId){
  return autoSortRows('pax',(state.cache.pax||[]).filter(p=>p.booking_id===bookingId&&p.access_status!=='cancelled'));
}
function v41CountPax(bookingId){
  const rows=v41ActivePax(bookingId);
  return {
    total:rows.length,
    classified:rows.filter(p=>p.category_confirmed!==false&&p.pax_type!=='unclassified').length,
    pending:rows.filter(p=>p.category_confirmed===false||p.pax_type==='unclassified').length
  };
}

/* ---------- SIMPLIFIED BOOKING FORM ---------- */
openBookingV21 = async function(type,id=null){
  await refreshOperations();
  const isCottage=type==='cottage_swim';
  const b=id?state.cache.bookings.find(x=>x.id===id):null;
  const units=isCottage?state.cache.cottages:state.cache.rooms;
  const activeUnits=units.filter(x=>x.is_active!==false);
  const tourRates=typeof activeTourRates==='function'?activeTourRates():[];

  openModal({
    title:id?`Edit ${isCottage?'Cottage + Swimming':'Room'} Booking`:`Add ${isCottage?'Cottage + Swimming':'Room'} Booking`,
    eyebrow:id?b?.booking_number:'NEW BOOKING',
    wide:true,
    body:`<form id="v41BookingForm" class="modal-form">
      ${b?`<div class="panel full"><div class="panel-head"><div><h3>Booking Barcode / QR</h3><p><strong>${esc(b.booking_code||b.barcode||'')}</strong></p></div><button type="button" class="btn btn-soft" id="v41BookingCode">View / Print</button></div></div>`:''}

      <label>Guest / Client Name
        <input name="guest_name" required value="${esc(b?.guest_name||'')}" placeholder="Booker name">
      </label>
      <label>Contact Number
        <input name="contact_number" value="${esc(b?.contact_number||'')}" placeholder="Optional">
      </label>

      <label>Check-in Date
        <input name="check_in_date" type="date" required value="${b?.check_in_date||today()}">
      </label>
      <label>Check-out Date
        <input name="check_out_date" type="date" required value="${b?.check_out_date||b?.check_in_date||today()}">
      </label>

      <label class="full">${isCottage?'Cottage':'Room'}
        <select name="unit_id" required>
          <option value="">Select ${isCottage?'cottage':'room'}...</option>
          ${activeUnits.map(u=>`<option value="${u.id}" ${(isCottage?b?.cottage_id:b?.room_id)===u.id?'selected':''}>${esc(u.name||u.unit_number)} · ${money(u.base_rate||0)} · Capacity ${u.capacity||'—'}</option>`).join('')}
        </select>
      </label>

      ${isCottage?`<label class="full">Tour / Swimming / Event Rate
        <select name="tour_rate_id" required>
          <option value="">Select rate...</option>
          ${tourRates.map(r=>`<option value="${r.id}" ${b?.tour_rate_id===r.id?'selected':''}>${esc(r.name)} · Adult ${money(r.adult_rate)} · Kids ${money(r.kid_rate)} · Baby ${Number(r.baby_rate||0)===0?'FREE':money(r.baby_rate)}</option>`).join('')}
        </select>
      </label>`:''}

      <div class="panel full">
        <div class="panel-head"><div><h3>Pax will be added separately</h3><p class="muted tiny">Do not enter Adult/Kid/Senior counts during booking.</p></div></div>
        <p><strong>The booker is automatically created as Pax #1.</strong></p>
        <p class="muted">After saving, add companions from Pax Manager. Their Adult/Kid/Baby/Senior/PWD category is assigned when their code is scanned, or manually from Pax Manager.</p>
        ${b?(()=>{const c=v41CountPax(b.id);return `<p><strong>${c.total} pax records</strong> · ${c.classified} classified · ${c.pending} waiting for category</p>`})():''}
      </div>

      <label>Status
        <select name="status">
          ${['pending','confirmed','checked_in','checked_out','cancelled','no_show'].map(s=>`<option value="${s}" ${(b?.status||'pending')===s?'selected':''}>${esc(s.replace('_',' '))}</option>`).join('')}
        </select>
      </label>
      <label class="full">Notes<textarea name="notes" rows="3">${esc(b?.notes||'')}</textarea></label>

      ${!isCottage && typeof v35RoomDepositFields==='function'?v35RoomDepositFields(b):''}
    </form>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button>${b?`<button class="btn btn-soft" id="v41ManagePax">Manage Pax</button>`:''}<button class="btn btn-primary" id="v41SaveBooking">Save Booking</button>`
  });

  $('[data-modal-cancel]').onclick=closeModal;
  if($('#v41BookingCode'))$('#v41BookingCode').onclick=()=>openCodesModal(b);
  if($('#v41ManagePax'))$('#v41ManagePax').onclick=()=>openPaxManagerV24(b);

  if(!isCottage && $('#v35IdType')){
    const sync=()=>$('#v35OtherIdWrap')?.classList.toggle('hidden',$('#v35IdType').value!=='Other');
    $('#v35IdType').onchange=sync;sync();
    if(b){
      if($('#v41BookingForm').elements.id_deposit_status)$('#v41BookingForm').elements.id_deposit_status.value=b.id_deposit_status||'not_received';
      if($('#v41BookingForm').elements.room_key_status)$('#v41BookingForm').elements.room_key_status.value=b.room_key_status||'not_issued';
    }
  }

  $('#v41SaveBooking').onclick=async()=>{
    const f=$('#v41BookingForm'),d=Object.fromEntries(new FormData(f).entries());
    if(!String(d.guest_name||'').trim())return toast('Guest / client name is required.','error');
    if(!d.unit_id)return toast(`Select a ${isCottage?'cottage':'room'}.`,'error');
    if(isCottage&&!d.tour_rate_id)return toast('Select the Tour / Swimming / Event Rate.','error');

    const payload={
      booking_type:type,
      guest_name:String(d.guest_name).trim(),
      contact_number:String(d.contact_number||'').trim()||null,
      booking_date:b?.booking_date||today(),
      check_in_date:d.check_in_date,
      check_out_date:d.check_out_date,
      status:d.status||'pending',
      notes:d.notes||null
    };

    if(isCottage){
      payload.cottage_id=d.unit_id;
      payload.room_id=null;
      payload.tour_rate_id=d.tour_rate_id;
    }else{
      payload.room_id=d.unit_id;
      payload.cottage_id=null;
      payload.tour_rate_id=null;
      payload.id_provided_type=d.id_provided_type||null;
      payload.id_provided_other=d.id_provided_type==='Other'?(String(d.id_provided_other||'').trim()||null):null;
      payload.room_key_issued=String(d.room_key_issued||'').trim()||null;
      payload.id_deposit_status=d.id_deposit_status||'not_received';
      payload.room_key_status=d.room_key_status||'not_issued';
      if(payload.id_provided_type==='Other'&&!payload.id_provided_other)return toast('Type the Other ID Type.','error');
    }

    if(!id){
      // Counts are deliberately zero at booking. Pax categories become the source of truth.
      Object.assign(payload,{adults:0,kids:0,babies:0,seniors:0,pwd:0,discount_type:'none',discount_mode:'none'});
    }

    const res=id
      ? await sb.from('bookings').update(payload).eq('id',id).select().single()
      : await sb.from('bookings').insert({...payload,created_by:state.session.user.id}).select().single();

    if(res.error)return toast(res.error.message,'error');

    await refreshOperations();
    const saved=state.cache.bookings.find(x=>x.id===res.data.id)||res.data;
    toast(id?'Booking updated.':'Booking saved. Booker was automatically added as Pax #1.');
    closeModal();

    if(state.currentView==='cottage-bookings'||state.currentView==='room-bookings')renderBookingTypePage(type);
    else renderCurrent();

    if(!id)setTimeout(()=>openPaxManagerV24(saved),80);
  };
};

/* ---------- ADD PAX: NO CATEGORY YET ---------- */
openAddPaxV24=function(booking){
  openModal({
    title:'Add Pax / Companion',
    eyebrow:booking.booking_number,
    body:`<form id="v41AddPaxForm" class="modal-form">
      <label>Name / Nickname<input name="display_name" placeholder="Name does not need to be complete"></label>
      <label>Gender<select name="gender">${v35GenderOptions('')}</select></label>
      <label>Area<select name="area" id="v35PaxArea">${v35AreaOptions('')}</select></label>
      <label id="v35OtherAreaWrap" class="hidden">Other Area / City / Province<input name="area_other" placeholder="Type location"></label>
      <label>Code Method<select name="code_method" id="v41CodeMethod"><option value="none">No code yet</option><option value="manual">Manual / Scan own code</option><option value="auto">Auto Generate</option></select></label>
      <label>Barcode / QR / Code<input name="code" id="v41PaxCode" autocomplete="off" placeholder="Optional"></label>
      <div class="panel full"><strong>Category is intentionally not asked here.</strong><p class="muted tiny">Adult / Kid / Baby / Senior / PWD will be selected when this pax is scanned, or by using Set Category in Pax Manager.</p></div>
    </form>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v41AddPaxSave">Add Pax</button>`
  });
  $('[data-modal-cancel]').onclick=()=>openPaxManagerV24(booking);
  v35WireAreaOther();
  $('#v41CodeMethod').onchange=e=>{
    if(e.target.value==='auto')$('#v41PaxCode').value=v24RandomPaxCode();
    if(e.target.value==='none')$('#v41PaxCode').value='';
    if(e.target.value==='manual')setTimeout(()=>$('#v41PaxCode').focus(),30);
  };
  $('#v41AddPaxSave').onclick=async()=>{
    const d=Object.fromEntries(new FormData($('#v41AddPaxForm')).entries());
    if(d.area==='Other'&&!String(d.area_other||'').trim())return toast('Type the Other Area / City / Province.','error');
    const {data,error}=await sb.rpc('add_unclassified_booking_pax_v41',{
      p_booking_id:booking.id,
      p_display_name:String(d.display_name||'').trim()||null,
      p_gender:d.gender||null,
      p_area:d.area||null,
      p_area_other:String(d.area_other||'').trim()||null,
      p_code:v24Norm(d.code)||null
    });
    if(error)return toast(error.message,'error');
    await refreshOperations();toast('Pax added. Category will be selected when scanned.');openPaxManagerV24(state.cache.bookings.find(x=>x.id===booking.id)||booking);
  };
};

/* ---------- CLASSIFICATION ---------- */
function v41OpenClassifyPax(booking,p,continueAfter=false){
  openModal({
    title:p.is_booker?'Classify Booker':'Classify Pax',
    eyebrow:`${booking.booking_number} · ${paxDisplayName(p)}`,
    body:`<form id="v41ClassifyForm" class="modal-form">
      <label>Category<select name="category" required>
        <option value="">Select category...</option>
        <option value="adult" ${v41PaxCategory(p)==='Adult'?'selected':''}>Adult</option>
        <option value="kid" ${v41PaxCategory(p)==='Kid'?'selected':''}>Kid</option>
        <option value="baby" ${v41PaxCategory(p)==='Baby'?'selected':''}>Baby</option>
        <option value="senior" ${v41PaxCategory(p)==='Senior'?'selected':''}>Senior</option>
        <option value="pwd" ${v41PaxCategory(p)==='PWD'?'selected':''}>PWD</option>
      </select></label>
      <label>Gender<select name="gender">${v35GenderOptions(p.gender||'')}</select></label>
      <label>Area<select name="area" id="v35PaxArea">${v35AreaOptions(p.area||'')}</select></label>
      <label id="v35OtherAreaWrap" class="${p.area==='Other'?'':'hidden'}">Other Area / City / Province<input name="area_other" value="${esc(p.area_other||'')}"></label>
      <div class="panel full"><p><strong>This category updates the booking counts and bill automatically.</strong></p><p class="tiny muted">Senior/PWD are counted as adults, with their Senior/PWD flag recorded separately.</p></div>
    </form>`,
    footer:`<button class="btn btn-soft" id="v41ClassifyCancel">Cancel</button><button class="btn btn-primary" id="v41ClassifySave">Save Category${continueAfter?' & Continue Scan':''}</button>`
  });
  $('#v41ClassifyCancel').onclick=()=>continueAfter?closeModal():openPaxManagerV24(booking);
  v35WireAreaOther();
  $('#v41ClassifySave').onclick=async()=>{
    const d=Object.fromEntries(new FormData($('#v41ClassifyForm')).entries());
    if(!d.category)return toast('Select Adult, Kid, Baby, Senior, or PWD.','error');
    if(d.area==='Other'&&!String(d.area_other||'').trim())return toast('Type the Other Area / City / Province.','error');
    const {data,error}=await sb.rpc('classify_booking_pax_v41',{
      p_pax_id:p.id,
      p_category:d.category,
      p_gender:d.gender||null,
      p_area:d.area||null,
      p_area_other:String(d.area_other||'').trim()||null
    });
    if(error)return toast(error.message,'error');
    const result=Array.isArray(data)?data[0]:data;
    if(!result?.ok)return toast(result?.message||'Could not classify pax.','error');
    await refreshOperations();
    const fresh=state.cache.pax.find(x=>x.id===p.id);
    toast(`${paxDisplayName(fresh)} classified as ${v41PaxCategory(fresh)}.`);
    if(continueAfter){
      closeModal();
      setTimeout(()=>v41OriginalHandlePaxScan(fresh),40);
    }else{
      openPaxManagerV24(state.cache.bookings.find(x=>x.id===booking.id)||booking);
    }
  };
}

/* Scan interception: unknown category is requested BEFORE check-in/exit logic. */
const v41OriginalHandlePaxScan=handlePaxScanV24;
handlePaxScanV24=async function(p){
  await refreshOperations();
  const fresh=state.cache.pax.find(x=>x.id===p.id)||p;
  const booking=state.cache.bookings.find(x=>x.id===fresh.booking_id);
  if(!booking)return toast('Booking not found for this pax.','error');
  if(fresh.category_confirmed===false || fresh.pax_type==='unclassified'){
    return v41OpenClassifyPax(booking,fresh,true);
  }
  return v41OriginalHandlePaxScan(fresh);
};

/* ---------- DISCOUNT SETTINGS (keeps old Senior/PWD function without cluttering booking creation) ---------- */
function v41OpenDiscountSettings(booking){
  const b=state.cache.bookings.find(x=>x.id===booking.id)||booking;
  openModal({
    title:'Booking Discount',
    eyebrow:b.booking_number,
    body:`<form id="v41DiscountForm" class="modal-form">
      <label>Discount Type<select name="discount_type">
        <option value="none" ${b.discount_type==='none'?'selected':''}>No Discount</option>
        <option value="senior" ${b.discount_type==='senior'?'selected':''}>Senior</option>
        <option value="pwd" ${b.discount_type==='pwd'?'selected':''}>PWD</option>
      </select></label>
      <label>Discount Mode<select name="discount_mode">
        <option value="none" ${b.discount_mode==='none'?'selected':''}>No Discount</option>
        <option value="person_only" ${b.discount_mode==='person_only'?'selected':''}>One Qualified Person Only</option>
        <option value="whole_bill" ${b.discount_mode==='whole_bill'?'selected':''}>Whole Bill</option>
      </select></label>
      <div class="panel full"><p>Current classified count: Adults ${b.adults||0} · Kids ${b.kids||0} · Babies ${b.babies||0} · Senior ${b.seniors||0} · PWD ${b.pwd||0}</p></div>
    </form>`,
    footer:`<button class="btn btn-soft" id="v41DiscountCancel">Cancel</button><button class="btn btn-primary" id="v41DiscountSave">Save Discount</button>`
  });
  $('#v41DiscountCancel').onclick=()=>openPaxManagerV24(b);
  $('#v41DiscountSave').onclick=async()=>{
    const d=Object.fromEntries(new FormData($('#v41DiscountForm')).entries());
    if(d.discount_type==='senior'&&Number(b.seniors||0)<1)return toast('Classify at least one Senior first.','error');
    if(d.discount_type==='pwd'&&Number(b.pwd||0)<1)return toast('Classify at least one PWD first.','error');
    if(d.discount_type==='none')d.discount_mode='none';
    if(d.discount_mode==='none')d.discount_type='none';
    const {error}=await sb.from('bookings').update({discount_type:d.discount_type,discount_mode:d.discount_mode}).eq('id',b.id);
    if(error)return toast(error.message,'error');
    await refreshOperations();toast('Booking discount updated.');openPaxManagerV24(state.cache.bookings.find(x=>x.id===b.id)||b);
  };
}

/* ---------- PAX MANAGER ---------- */
openPaxManagerV24=async function(booking){
  await refreshOperations();
  booking=state.cache.bookings.find(x=>x.id===booking.id)||booking;
  const pax=v41ActivePax(booking.id),counts=v41CountPax(booking.id);
  openModal({
    title:'Pax / Companion Manager',
    eyebrow:booking.booking_number,
    wide:true,
    body:`<div class="panel" style="margin-bottom:14px">
      <div class="panel-head"><div><h3>${esc(booking.guest_name||'Guest')}</h3><p class="muted">${pax.length} pax · ${counts.classified} classified · ${counts.pending} waiting for category</p></div><button class="btn btn-primary" id="v41AddPaxBtn">Add Pax</button></div>
      <div class="report-kpis">
        <div class="report-kpi"><span>Adult</span><strong>${booking.adults||0}</strong></div>
        <div class="report-kpi"><span>Kids</span><strong>${booking.kids||0}</strong></div>
        <div class="report-kpi"><span>Babies</span><strong>${booking.babies||0}</strong></div>
        <div class="report-kpi"><span>Senior / PWD</span><strong>${booking.seniors||0} / ${booking.pwd||0}</strong></div>
      </div>
      <p class="tiny muted" style="margin-top:10px">The booking count comes from classified pax records. The booker is Pax #1 automatically.</p>
    </div>
    <div class="table-panel"><div class="table-scroll"><table class="data-table"><thead><tr>
      <th>#</th><th>Pax</th><th>Booker</th><th>Category</th><th>Gender</th><th>Area</th><th>Code</th><th>Access</th><th>Actions</th>
    </tr></thead><tbody>
      ${pax.length?pax.map((p,i)=>`<tr>
        <td><strong>${i+1}</strong></td>
        <td><strong>${esc(paxDisplayName(p))}</strong></td>
        <td>${p.is_booker?'<span class="badge">BOOKER</span>':'—'}</td>
        <td><span class="badge">${esc(v41PaxCategory(p))}</span></td>
        <td>${esc(p.gender||'—')}</td>
        <td>${esc(v35EffectiveArea(p))}</td>
        <td><strong>${esc(p.code||'NO CODE')}</strong></td>
        <td><span class="badge">${esc(p.access_status||'not_checked_in')}</span></td>
        <td><div class="row-actions">
          <button data-v41-classify="${p.id}">${p.category_confirmed===false||p.pax_type==='unclassified'?'Set Category':'Change Category'}</button>
          <button data-v35-edit-info="${p.id}">Edit Info</button>
          ${p.code?`<button data-v32-show-pax="${p.id}">Show QR</button>`:''}
          <button data-v24-manual="${p.id}">Manual Code</button>
          <button data-v24-scan="${p.id}">Scan Code</button>
          <button data-v24-auto="${p.id}">Auto Generate</button>
          ${p.code?`<button data-v24-clear="${p.id}">Clear</button>`:''}
        </div></td>
      </tr>`).join(''):'<tr><td colspan="9" class="empty-state">No pax records found.</td></tr>'}
    </tbody></table></div></div>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-soft" id="v41DiscountBtn">Discount Settings</button><button class="btn btn-primary" id="v32BookingBarcodeFromPax">Booking Barcode</button>`
  });

  $('[data-modal-cancel]').onclick=closeModal;
  $('#v41AddPaxBtn').onclick=()=>openAddPaxV24(booking);
  $('#v41DiscountBtn').onclick=()=>v41OpenDiscountSettings(booking);
  $('#v32BookingBarcodeFromPax').onclick=()=>openCodesModal(booking);

  $$('[data-v41-classify]').forEach(x=>x.onclick=()=>v41OpenClassifyPax(booking,state.cache.pax.find(p=>p.id===x.dataset.v41Classify),false));
  $$('[data-v35-edit-info]').forEach(x=>x.onclick=()=>v35OpenPaxInfo(booking,state.cache.pax.find(p=>p.id===x.dataset.v35EditInfo)));
  $$('[data-v32-show-pax]').forEach(x=>x.onclick=()=>v32OpenPaxQrModal(state.cache.pax.find(p=>p.id===x.dataset.v32ShowPax),booking));
  $$('[data-v24-manual]').forEach(x=>x.onclick=()=>openManualPaxCodeV24(booking,state.cache.pax.find(p=>p.id===x.dataset.v24Manual)));
  $$('[data-v24-scan]').forEach(x=>x.onclick=()=>openScanPaxCodeV24(booking,state.cache.pax.find(p=>p.id===x.dataset.v24Scan)));
  $$('[data-v24-auto]').forEach(x=>x.onclick=()=>autoGeneratePaxCodeV24(booking,state.cache.pax.find(p=>p.id===x.dataset.v24Auto)));
  $$('[data-v24-clear]').forEach(x=>x.onclick=()=>clearPaxCodeV24(booking,state.cache.pax.find(p=>p.id===x.dataset.v24Clear)));
};

/* Live/booking total display should use real pax records when available. */
function v41BookingPaxTotal(b){
  const rows=v41ActivePax(b.id);
  return rows.length || Number(b.adults||0)+Number(b.kids||0)+Number(b.babies||0);
}

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v42.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V4.2
   UX SIMPLIFICATION + UNIFIED PAX EDITOR
   Desktop + Mobile + Tablet + iPhone + iPad
   No business functions removed.
   ============================================================ */

function v42PaxEditModal(booking,p){
  const currentCategory=v41PaxCategory(p);
  openModal({
    title:p.is_booker?'Edit Booker / Pax':'Edit Pax',
    eyebrow:`${booking.booking_number} · ${paxDisplayName(p)}`,
    wide:true,
    body:`<form id="v42PaxEditForm" class="modal-form">
      <label>Name / Nickname
        <input name="display_name" value="${esc(p.display_name||'')}" placeholder="Name does not need to be complete">
      </label>
      <label>Category
        <select name="category" required>
          <option value="">Select category...</option>
          <option value="adult" ${currentCategory==='Adult'?'selected':''}>Adult</option>
          <option value="kid" ${currentCategory==='Kid'?'selected':''}>Kid</option>
          <option value="baby" ${currentCategory==='Baby'?'selected':''}>Baby</option>
          <option value="senior" ${currentCategory==='Senior'?'selected':''}>Senior</option>
          <option value="pwd" ${currentCategory==='PWD'?'selected':''}>PWD</option>
        </select>
      </label>
      <label>Gender
        <select name="gender">${v35GenderOptions(p.gender||'')}</select>
      </label>
      <label>Area
        <select name="area" id="v35PaxArea">${v35AreaOptions(p.area||'')}</select>
      </label>
      <label id="v35OtherAreaWrap" class="${p.area==='Other'?'':'hidden'}">Other Area / City / Province
        <input name="area_other" value="${esc(p.area_other||'')}">
      </label>
      <div class="panel full">
        <div class="panel-head"><h3>Pax Details</h3></div>
        <p><strong>${p.is_booker?'Booker / Pax #1':'Companion Pax'}</strong></p>
        <p class="muted">Changing Adult/Kid/Baby/Senior/PWD automatically updates the booking counts and bill.</p>
      </div>
    </form>`,
    footer:`<button class="btn btn-soft" id="v42PaxCancel">Cancel</button><button class="btn btn-primary" id="v42PaxSave">Save Pax</button>`
  });

  $('#v42PaxCancel').onclick=()=>openPaxManagerV24(booking);
  v35WireAreaOther();

  $('#v42PaxSave').onclick=async()=>{
    const d=Object.fromEntries(new FormData($('#v42PaxEditForm')).entries());
    if(!d.category)return toast('Select Adult, Kid, Baby, Senior, or PWD.','error');
    if(d.area==='Other'&&!String(d.area_other||'').trim())return toast('Type the Other Area / City / Province.','error');

    const {data,error}=await sb.rpc('classify_booking_pax_v41',{
      p_pax_id:p.id,
      p_category:d.category,
      p_gender:d.gender||null,
      p_area:d.area||null,
      p_area_other:String(d.area_other||'').trim()||null
    });
    if(error)return toast(error.message,'error');
    const result=Array.isArray(data)?data[0]:data;
    if(!result?.ok)return toast(result?.message||'Could not save pax category.','error');

    const name=String(d.display_name||'').trim();
    const {error:nameErr}=await sb.from('booking_pax').update({display_name:name||null}).eq('id',p.id);
    if(nameErr)return toast(nameErr.message,'error');

    if(p.is_booker && name && name!==booking.guest_name){
      const {error:bErr}=await sb.from('bookings').update({guest_name:name}).eq('id',booking.id);
      if(bErr)return toast(bErr.message,'error');
    }

    await refreshOperations();
    toast('Pax information updated.');
    openPaxManagerV24(state.cache.bookings.find(x=>x.id===booking.id)||booking);
  };
}

/* Simplified Pax Manager:
   Important actions are visible. Code-maintenance actions are inside More. */
openPaxManagerV24=async function(booking){
  await refreshOperations();
  booking=state.cache.bookings.find(x=>x.id===booking.id)||booking;
  const pax=v41ActivePax(booking.id),counts=v41CountPax(booking.id);

  openModal({
    title:'Pax / Companion Manager',
    eyebrow:booking.booking_number,
    wide:true,
    body:`<div class="panel v42-summary-panel" style="margin-bottom:14px">
      <div class="panel-head">
        <div>
          <h3>${esc(booking.guest_name||'Guest')}</h3>
          <p class="muted">${pax.length} total pax · ${counts.classified} classified · ${counts.pending} waiting for category</p>
        </div>
        <button class="btn btn-primary" id="v41AddPaxBtn">Add Pax</button>
      </div>
      <div class="report-kpis">
        <div class="report-kpi"><span>Adult</span><strong>${booking.adults||0}</strong></div>
        <div class="report-kpi"><span>Kids</span><strong>${booking.kids||0}</strong></div>
        <div class="report-kpi"><span>Babies</span><strong>${booking.babies||0}</strong></div>
        <div class="report-kpi"><span>Senior / PWD</span><strong>${booking.seniors||0} / ${booking.pwd||0}</strong></div>
      </div>
      <p class="tiny muted" style="margin-top:10px">Booker is automatically Pax #1. Use Edit Pax to set or change Adult, Kid, Baby, Senior, PWD, Gender, and Area.</p>
    </div>

    <div class="table-panel">
      <div class="table-scroll"><table class="data-table"><thead><tr>
        <th>#</th><th>Pax</th><th>Role</th><th>Category</th><th>Gender</th><th>Area</th><th>Code</th><th>Access</th><th>Actions</th>
      </tr></thead><tbody>
        ${pax.length?pax.map((p,i)=>`<tr>
          <td><strong>${i+1}</strong></td>
          <td><strong>${esc(paxDisplayName(p))}</strong></td>
          <td>${p.is_booker?'<span class="badge">BOOKER</span>':'Companion'}</td>
          <td><span class="badge">${esc(v41PaxCategory(p))}</span></td>
          <td>${esc(p.gender||'—')}</td>
          <td>${esc(v35EffectiveArea(p))}</td>
          <td><strong>${esc(p.code||'NO CODE')}</strong></td>
          <td><span class="badge">${esc(p.access_status||'not_checked_in')}</span></td>
          <td>
            <div class="row-actions v42-pax-actions">
              <button class="btn btn-primary" data-v42-edit-pax="${p.id}">Edit Pax</button>
              ${p.code?`<button class="btn btn-soft" data-v32-show-pax="${p.id}">View QR</button>`:''}
              <details class="action-more">
                <summary>More</summary>
                <div class="action-more-menu">
                  <button data-v24-manual="${p.id}">Manual Code</button>
                  <button data-v24-scan="${p.id}">Scan Code</button>
                  <button data-v24-auto="${p.id}">Auto Generate Code</button>
                  ${p.code?`<button data-v24-clear="${p.id}" class="danger-text">Clear Code</button>`:''}
                </div>
              </details>
            </div>
          </td>
        </tr>`).join(''):'<tr><td colspan="9" class="empty-state">No pax records found.</td></tr>'}
      </tbody></table></div>
    </div>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-soft" id="v41DiscountBtn">Discount Settings</button><button class="btn btn-primary" id="v32BookingBarcodeFromPax">Booking Barcode</button>`
  });

  $('[data-modal-cancel]').onclick=closeModal;
  $('#v41AddPaxBtn').onclick=()=>openAddPaxV24(booking);
  $('#v41DiscountBtn').onclick=()=>v41OpenDiscountSettings(booking);
  $('#v32BookingBarcodeFromPax').onclick=()=>openCodesModal(booking);

  $$('[data-v42-edit-pax]').forEach(x=>x.onclick=()=>v42PaxEditModal(booking,state.cache.pax.find(p=>p.id===x.dataset.v42EditPax)));
  $$('[data-v32-show-pax]').forEach(x=>x.onclick=()=>v32OpenPaxQrModal(state.cache.pax.find(p=>p.id===x.dataset.v32ShowPax),booking));
  $$('[data-v24-manual]').forEach(x=>x.onclick=()=>openManualPaxCodeV24(booking,state.cache.pax.find(p=>p.id===x.dataset.v24Manual)));
  $$('[data-v24-scan]').forEach(x=>x.onclick=()=>openScanPaxCodeV24(booking,state.cache.pax.find(p=>p.id===x.dataset.v24Scan)));
  $$('[data-v24-auto]').forEach(x=>x.onclick=()=>autoGeneratePaxCodeV24(booking,state.cache.pax.find(p=>p.id===x.dataset.v24Auto)));
  $$('[data-v24-clear]').forEach(x=>x.onclick=()=>clearPaxCodeV24(booking,state.cache.pax.find(p=>p.id===x.dataset.v24Clear)));
};

/* Move excessive row buttons into one More menu without recreating buttons,
   so existing click handlers remain intact. */
function v42SimplifyActionRows(root=document){
  root.querySelectorAll('.row-actions:not(.v42-pax-actions)').forEach(row=>{
    if(row.dataset.v42Simplified==='1')return;
    const buttons=[...row.children].filter(el=>el.matches('button,.btn'));
    if(row.querySelector(':scope > details.action-more') || buttons.length<=3){
      row.dataset.v42Simplified='1';return;
    }
    const details=document.createElement('details');
    details.className='action-more';
    const summary=document.createElement('summary');
    summary.textContent='More';
    const menu=document.createElement('div');
    menu.className='action-more-menu';
    buttons.slice(2).forEach(btn=>menu.appendChild(btn));
    details.append(summary,menu);
    row.appendChild(details);
    row.dataset.v42Simplified='1';
  });
}
const v42ActionObserver=new MutationObserver(()=>requestAnimationFrame(()=>v42SimplifyActionRows(document)));
v42ActionObserver.observe(document.body,{childList:true,subtree:true});
setTimeout(()=>v42SimplifyActionRows(document),150);

document.addEventListener('click',e=>{
  document.querySelectorAll('details.action-more[open]').forEach(d=>{
    if(!d.contains(e.target))d.removeAttribute('open');
  });
});

/* Top bar: hide utility clutter under Tools. */
function v42SimplifyTopbar(){
  const bar=document.querySelector('.topbar-actions');
  if(!bar || bar.querySelector('.v42-top-tools'))return;
  const candidates=[...bar.children].filter(el=>{
    const t=String(el.textContent||'').trim().toLowerCase();
    return t.includes('page report')||t.includes('second screen')||t.includes('full screen');
  });
  if(candidates.length<2)return;
  const details=document.createElement('details');
  details.className='action-more v42-top-tools';
  const summary=document.createElement('summary');summary.textContent='Tools';
  const menu=document.createElement('div');menu.className='action-more-menu';
  candidates.forEach(el=>menu.appendChild(el));
  details.append(summary,menu);bar.prepend(details);
}
setTimeout(v42SimplifyTopbar,200);

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v43.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V4.3
   ACTION MENU OVERFLOW FIX
   Makes "More" menus float above scroll containers.
   ============================================================ */

let v43FloatingMenu=null;
let v43SourceDetails=null;

function v43CloseFloatingMenu(){
  if(v43FloatingMenu){
    v43FloatingMenu.remove();
    v43FloatingMenu=null;
  }
  if(v43SourceDetails){
    v43SourceDetails.removeAttribute('open');
    v43SourceDetails=null;
  }
}

function v43OpenFloatingMenu(details){
  const menu=details.querySelector(':scope > .action-more-menu');
  const summary=details.querySelector(':scope > summary');
  if(!menu||!summary)return;

  v43CloseFloatingMenu();

  const floating=document.createElement('div');
  floating.className='action-more-menu v43-floating-action-menu';

  // Clone visual content, but re-trigger the ORIGINAL buttons so no function is lost.
  [...menu.children].forEach(original=>{
    const clone=original.cloneNode(true);
    clone.removeAttribute('id');
    clone.onclick=(e)=>{
      e.preventDefault();
      e.stopPropagation();
      v43CloseFloatingMenu();
      original.click();
    };
    floating.appendChild(clone);
  });

  document.body.appendChild(floating);
  v43FloatingMenu=floating;
  v43SourceDetails=details;

  const r=summary.getBoundingClientRect();
  const mw=Math.min(300, Math.max(190, floating.offsetWidth||190));
  let left=r.right-mw;
  let top=r.bottom+6;

  if(left<8)left=8;
  if(left+mw>window.innerWidth-8)left=window.innerWidth-mw-8;

  const mh=floating.offsetHeight||200;
  if(top+mh>window.innerHeight-8){
    top=Math.max(8,r.top-mh-6);
  }

  floating.style.left=`${left}px`;
  floating.style.top=`${top}px`;
  floating.style.width=`${mw}px`;
}

document.addEventListener('click',e=>{
  const summary=e.target.closest('details.action-more > summary');
  if(summary){
    const details=summary.parentElement;
    // Desktop/laptop: use floating menu so it never gets trapped inside table-scroll.
    if(window.innerWidth>1024){
      e.preventDefault();
      e.stopPropagation();
      if(v43SourceDetails===details && v43FloatingMenu){
        v43CloseFloatingMenu();
      }else{
        details.setAttribute('open','');
        v43OpenFloatingMenu(details);
      }
      return;
    }
  }

  if(v43FloatingMenu && !v43FloatingMenu.contains(e.target)){
    v43CloseFloatingMenu();
  }
},true);

window.addEventListener('scroll',()=>{
  if(v43FloatingMenu)v43CloseFloatingMenu();
},true);

window.addEventListener('resize',v43CloseFloatingMenu);

/* Also ensure old "More" details cannot enlarge the horizontal table-scroll area. */
function v43MarkScrollableTables(){
  document.querySelectorAll('.table-scroll').forEach(x=>x.classList.add('v43-table-scroll'));
}
const v43Obs=new MutationObserver(()=>requestAnimationFrame(v43MarkScrollableTables));
v43Obs.observe(document.body,{childList:true,subtree:true});
setTimeout(v43MarkScrollableTables,100);

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v44.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V4.4
   PAX DEMOGRAPHICS REPORT: CATEGORY COUNTS
   Adds Adult / Kid / Baby / Senior / PWD breakdown.
   ============================================================ */

function v44PaxCategoryCounts(rows){
  const out={Adult:0,Kid:0,Baby:0,Senior:0,PWD:0,'Not classified':0};
  rows.forEach(p=>{
    if(p.category_confirmed===false || p.pax_type==='unclassified'){
      out['Not classified']++; return;
    }
    if(p.is_senior){out.Senior++;return;}
    if(p.is_pwd){out.PWD++;return;}
    if(p.pax_type==='kid'){out.Kid++;return;}
    if(p.pax_type==='baby'){out.Baby++;return;}
    out.Adult++;
  });
  return out;
}

const v44CentralPrintBase=v37PrintCentralReport;
v37PrintCentralReport=async function(){
  await refreshOperations();
  const type=$('#reportType')?.value||'bookings';
  if(type!=='pax_demographics') return v44CentralPrintBase();

  const mode=$('#reportPeriodMode')?.value||'month';
  const p=v37Period(mode,v37MonthValue(),v37YearValue());
  const bookingMap=Object.fromEntries((state.cache.bookings||[]).map(b=>[b.id,b]));
  const rows=(state.cache.pax||[]).filter(px=>{
    const b=bookingMap[px.booking_id];
    return b&&v37DateInPeriod(b.check_in_date||b.booking_date,p)&&px.access_status!=='cancelled';
  });

  const genders={Male:0,Female:0,'LGBTQIA+':0,'Not specified':0};
  rows.forEach(px=>genders[px.gender]!==undefined?genders[px.gender]++:genders['Not specified']++);

  const areas={};
  rows.forEach(px=>{
    const a=px.area_name||px.area||'Not specified';
    areas[a]=(areas[a]||0)+1;
  });

  const cats=v44PaxCategoryCounts(rows);
  const outside=rows.filter(px=>{
    const a=String(px.area_name||px.area||'').trim();
    return a&&a.toLowerCase()!=='naic';
  }).length;

  const r={
    title:'Pax Demographics & Area Report',
    period:p,
    kpis:[
      ['Pax',rows.length,'Booked pax'],
      ['Adult',cats.Adult,'Regular adult'],
      ['Senior',cats.Senior,'Senior pax'],
      ['PWD',cats.PWD,'PWD pax'],
      ['Kids',cats.Kid,'Kid pax'],
      ['Babies',cats.Baby,'Baby pax'],
      ['Outside Naic',outside,'Selected period'],
      ['Not Classified',cats['Not classified'],'Pending category']
    ],
    tables:[
      {title:'Pax Category Summary',cols:['Category','Count'],rows:[
        ['Adult',cats.Adult],
        ['Senior',cats.Senior],
        ['PWD',cats.PWD],
        ['Kid',cats.Kid],
        ['Baby',cats.Baby],
        ['Not Classified',cats['Not classified']]
      ]},
      {title:'Gender Summary',cols:['Gender','Count'],rows:Object.entries(genders)},
      {title:'Area Summary',cols:['Area','Count'],rows:Object.entries(areas).sort((a,b)=>b[1]-a[1])},
      {title:'Pax Details',cols:['#','Pax','Category','Gender','Area','Booking','Client'],rows:rows.map((px,i)=>[
        i+1,
        px.display_name||paxDisplayName(px),
        typeof v41PaxCategory==='function'?v41PaxCategory(px):(px.pax_type||'Not classified'),
        px.gender||'Not specified',
        px.area_name||px.area||'Not specified',
        bookingMap[px.booking_id]?.booking_number||'—',
        bookingMap[px.booking_id]?.guest_name||'Guest'
      ])}
    ]
  };

  v36OpenPrintWindow(v37ProfessionalReportHtml(r));
};

// Also update the on-screen demographics preview used by V3.5.
const v44DemographicBase=typeof v35DemographicReport==='function'?v35DemographicReport:null;
if(v44DemographicBase){
  v35DemographicReport=function(month){
    const {monthRows,yearRows,bookingMap,year}=v35ReportPeriodPax(month);
    const mg=v35GenderCounts(monthRows),yg=v35GenderCounts(yearRows),areas=v35AreaCounts(monthRows);
    const mc=v44PaxCategoryCounts(monthRows),yc=v44PaxCategoryCounts(yearRows);
    const monthBookings=new Set(monthRows.map(p=>p.booking_id)).size;
    const yearBookings=new Set(yearRows.map(p=>p.booking_id)).size;

    $('#reportContent').innerHTML=`<div class="report-sheet">
      <div class="report-header"><div><p class="eyebrow">MASUSI FARM RESORT</p><h2>Pax Demographics & Area Report</h2><p class="muted">Selected month: ${esc(month)} · Year: ${esc(year)}</p></div><div><strong>Generated</strong><br>${new Date().toLocaleString('en-PH')}</div></div>

      <div class="report-kpis">
        <div class="report-kpi"><span>Pax This Month</span><strong>${monthRows.length}</strong><small>${monthBookings} bookings</small></div>
        <div class="report-kpi"><span>Adult</span><strong>${mc.Adult}</strong><small>Selected month</small></div>
        <div class="report-kpi"><span>Senior</span><strong>${mc.Senior}</strong><small>Selected month</small></div>
        <div class="report-kpi"><span>PWD</span><strong>${mc.PWD}</strong><small>Selected month</small></div>
        <div class="report-kpi"><span>Kids</span><strong>${mc.Kid}</strong><small>Selected month</small></div>
        <div class="report-kpi"><span>Babies</span><strong>${mc.Baby}</strong><small>Selected month</small></div>
        <div class="report-kpi"><span>Outside Naic</span><strong>${v35OutsideNaic(monthRows)}</strong><small>Selected month</small></div>
        <div class="report-kpi"><span>Not Classified</span><strong>${mc['Not classified']}</strong><small>Pending category</small></div>
      </div>

      <div class="dashboard-grid" style="margin-top:16px">
        <div class="panel">
          <h3>Pax Category — Selected Month</h3>
          <div class="report-kpis">
            <div class="report-kpi"><span>Adult</span><strong>${mc.Adult}</strong></div>
            <div class="report-kpi"><span>Senior</span><strong>${mc.Senior}</strong></div>
            <div class="report-kpi"><span>PWD</span><strong>${mc.PWD}</strong></div>
            <div class="report-kpi"><span>Kid</span><strong>${mc.Kid}</strong></div>
            <div class="report-kpi"><span>Baby</span><strong>${mc.Baby}</strong></div>
            <div class="report-kpi"><span>Not Classified</span><strong>${mc['Not classified']}</strong></div>
          </div>
        </div>
        <div class="panel">
          <h3>Pax Category — ${esc(year)}</h3>
          <div class="report-kpis">
            <div class="report-kpi"><span>Adult</span><strong>${yc.Adult}</strong></div>
            <div class="report-kpi"><span>Senior</span><strong>${yc.Senior}</strong></div>
            <div class="report-kpi"><span>PWD</span><strong>${yc.PWD}</strong></div>
            <div class="report-kpi"><span>Kid</span><strong>${yc.Kid}</strong></div>
            <div class="report-kpi"><span>Baby</span><strong>${yc.Baby}</strong></div>
            <div class="report-kpi"><span>Not Classified</span><strong>${yc['Not classified']}</strong></div>
          </div>
        </div>
      </div>

      <div class="dashboard-grid" style="margin-top:16px">
        <div class="panel"><h3>Gender — Selected Month</h3><div class="report-kpis"><div class="report-kpi"><span>Male</span><strong>${mg.Male}</strong></div><div class="report-kpi"><span>Female</span><strong>${mg.Female}</strong></div><div class="report-kpi"><span>LGBTQIA+</span><strong>${mg['LGBTQIA+']}</strong></div><div class="report-kpi"><span>Not Specified</span><strong>${mg['Not specified']}</strong></div></div></div>
        <div class="panel"><h3>Gender — ${esc(year)}</h3><div class="report-kpis"><div class="report-kpi"><span>Male</span><strong>${yg.Male}</strong></div><div class="report-kpi"><span>Female</span><strong>${yg.Female}</strong></div><div class="report-kpi"><span>LGBTQIA+</span><strong>${yg['LGBTQIA+']}</strong></div><div class="report-kpi"><span>Not Specified</span><strong>${yg['Not specified']}</strong></div></div></div>
      </div>

      <div class="panel" style="margin-top:16px"><h3>Area Summary — Selected Month</h3><div class="table-scroll"><table class="data-table"><thead><tr><th>Area</th><th>Count</th></tr></thead><tbody>${Object.entries(areas).sort((a,b)=>b[1]-a[1]).map(([a,c])=>`<tr><td>${esc(a)}</td><td>${c}</td></tr>`).join('')||'<tr><td colspan="2" class="empty-state">No area data.</td></tr>'}</tbody></table></div></div>

      <div class="panel" style="margin-top:16px"><h3>Pax Details — Selected Month</h3><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Pax</th><th>Category</th><th>Gender</th><th>Area</th><th>Booking</th><th>Client</th></tr></thead><tbody>${monthRows.map((p,i)=>`<tr><td>${i+1}</td><td>${esc(p.display_name||paxDisplayName(p))}</td><td>${esc(v41PaxCategory(p))}</td><td>${esc(p.gender||'Not specified')}</td><td>${esc(v35EffectiveArea(p))}</td><td>${esc(bookingMap[p.booking_id]?.booking_number||'—')}</td><td>${esc(bookingMap[p.booking_id]?.guest_name||'Guest')}</td></tr>`).join('')||'<tr><td colspan="7" class="empty-state">No pax records.</td></tr>'}</tbody></table></div></div>
    </div>`;
  };
}

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v45.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V4.5
   COUPON IN ADD/EDIT BOOKING + ADD PAYMENT
   Uses the existing V3.9 coupon database/RPC functions.
   ============================================================ */

function v45CouponSummary(b){
  if(!b?.coupon_code){
    return `<span class="muted">No coupon applied</span>`;
  }
  return `<strong>${esc(b.coupon_code)}</strong> · <span class="v45-coupon-saving">-${money(b.coupon_discount_amount||0)}</span>`;
}

async function v45ApplyOrRemoveCoupon(bookingId,code,currentCode=''){
  const normalized=String(code||'').trim();
  const had=String(currentCode||'').trim();

  if(normalized){
    const {data,error}=await sb.rpc('apply_coupon_to_booking',{
      p_booking_id:bookingId,
      p_code:normalized
    });
    if(error)return {ok:false,message:error.message};
    const result=Array.isArray(data)?data[0]:data;
    return result||{ok:false,message:'Coupon could not be applied.'};
  }

  if(had){
    const {data,error}=await sb.rpc('remove_coupon_from_booking',{
      p_booking_id:bookingId
    });
    if(error)return {ok:false,message:error.message};
    const result=Array.isArray(data)?data[0]:data;
    return result||{ok:false,message:'Coupon could not be removed.'};
  }

  return {ok:true,message:'No coupon change.'};
}

/* ------------------------------------------------------------
   BOOKING FORM
   Coupon field is visible during Add Booking / Edit Booking.
   New booking is saved first, then the coupon is validated by DB.
   ------------------------------------------------------------ */
openBookingV21 = async function(type,id=null){
  await refreshOperations();

  const isCottage=type==='cottage_swim';
  const b=id?state.cache.bookings.find(x=>x.id===id):null;
  const units=isCottage?state.cache.cottages:state.cache.rooms;
  const activeUnits=units.filter(x=>x.is_active!==false);
  const tourRates=typeof activeTourRates==='function'?activeTourRates():[];

  openModal({
    title:id?`Edit ${isCottage?'Cottage + Swimming':'Room'} Booking`:`Add ${isCottage?'Cottage + Swimming':'Room'} Booking`,
    eyebrow:id?b?.booking_number:'NEW BOOKING',
    wide:true,
    body:`<form id="v45BookingForm" class="modal-form">
      ${b?`<div class="panel full">
        <div class="panel-head">
          <div><h3>Booking Barcode / QR</h3><p><strong>${esc(b.booking_code||b.barcode||'')}</strong></p></div>
          <button type="button" class="btn btn-soft" id="v45BookingCode">View / Print</button>
        </div>
      </div>`:''}

      <label>Guest / Client Name
        <input name="guest_name" required value="${esc(b?.guest_name||'')}" placeholder="Booker name">
      </label>
      <label>Contact Number
        <input name="contact_number" value="${esc(b?.contact_number||'')}" placeholder="Optional">
      </label>

      <label>Check-in Date
        <input name="check_in_date" type="date" required value="${b?.check_in_date||today()}">
      </label>
      <label>Check-out Date
        <input name="check_out_date" type="date" required value="${b?.check_out_date||b?.check_in_date||today()}">
      </label>

      <label class="full">${isCottage?'Cottage':'Room'}
        <select name="unit_id" required>
          <option value="">Select ${isCottage?'cottage':'room'}...</option>
          ${activeUnits.map(u=>`<option value="${u.id}" ${(isCottage?b?.cottage_id:b?.room_id)===u.id?'selected':''}>${esc(u.name||u.unit_number)} · ${money(u.base_rate||0)} · Capacity ${u.capacity||'—'}</option>`).join('')}
        </select>
      </label>

      ${isCottage?`<label class="full">Tour / Swimming / Event Rate
        <select name="tour_rate_id" required>
          <option value="">Select rate...</option>
          ${tourRates.map(r=>`<option value="${r.id}" ${b?.tour_rate_id===r.id?'selected':''}>${esc(r.name)} · Adult ${money(r.adult_rate)} · Kids ${money(r.kid_rate)} · Baby ${Number(r.baby_rate||0)===0?'FREE':money(r.baby_rate)}</option>`).join('')}
        </select>
      </label>`:''}

      <div class="panel full v45-coupon-box">
        <div class="panel-head">
          <div>
            <h3>Coupon / Voucher</h3>
            <p class="muted tiny">Optional. Enter the coupon code supplied by the guest.</p>
          </div>
          ${b?.coupon_code?`<span class="badge">Applied</span>`:''}
        </div>
        <div class="v45-coupon-entry">
          <label>Coupon Code
            <input name="coupon_code" value="${esc(b?.coupon_code||'')}" placeholder="Example: MFR-ABCD1234" autocomplete="off">
          </label>
          <div class="v45-current-coupon">
            <span class="tiny muted">Current Coupon</span>
            <div>${v45CouponSummary(b)}</div>
          </div>
        </div>
        <p class="tiny muted">Validity, expiry, minimum spend, usage limit and Senior/PWD stacking rules are checked automatically by Supabase.</p>
      </div>

      <div class="panel full">
        <div class="panel-head"><div><h3>Pax will be added separately</h3><p class="muted tiny">Do not enter Adult/Kid/Senior counts during booking.</p></div></div>
        <p><strong>The booker is automatically created as Pax #1.</strong></p>
        <p class="muted">After saving, add companions from Pax Manager. Their Adult/Kid/Baby/Senior/PWD category is assigned when their code is scanned, or manually from Pax Manager.</p>
        ${b?(()=>{const c=v41CountPax(b.id);return `<p><strong>${c.total} pax records</strong> · ${c.classified} classified · ${c.pending} waiting for category</p>`})():''}
      </div>

      <label>Status
        <select name="status">
          ${['pending','confirmed','checked_in','checked_out','cancelled','no_show'].map(s=>`<option value="${s}" ${(b?.status||'pending')===s?'selected':''}>${esc(s.replace('_',' '))}</option>`).join('')}
        </select>
      </label>
      <label class="full">Notes<textarea name="notes" rows="3">${esc(b?.notes||'')}</textarea></label>

      ${!isCottage && typeof v35RoomDepositFields==='function'?v35RoomDepositFields(b):''}
    </form>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button>${b?`<button class="btn btn-soft" id="v45ManagePax">Manage Pax</button>`:''}<button class="btn btn-primary" id="v45SaveBooking">Save Booking</button>`
  });

  $('[data-modal-cancel]').onclick=closeModal;
  if($('#v45BookingCode'))$('#v45BookingCode').onclick=()=>openCodesModal(b);
  if($('#v45ManagePax'))$('#v45ManagePax').onclick=()=>openPaxManagerV24(b);

  if(!isCottage && $('#v35IdType')){
    const sync=()=>$('#v35OtherIdWrap')?.classList.toggle('hidden',$('#v35IdType').value!=='Other');
    $('#v35IdType').onchange=sync;sync();
    if(b){
      if($('#v45BookingForm').elements.id_deposit_status)$('#v45BookingForm').elements.id_deposit_status.value=b.id_deposit_status||'not_received';
      if($('#v45BookingForm').elements.room_key_status)$('#v45BookingForm').elements.room_key_status.value=b.room_key_status||'not_issued';
    }
  }

  $('#v45SaveBooking').onclick=async()=>{
    const f=$('#v45BookingForm');
    const d=Object.fromEntries(new FormData(f).entries());

    if(!String(d.guest_name||'').trim())return toast('Guest / client name is required.','error');
    if(!d.unit_id)return toast(`Select a ${isCottage?'cottage':'room'}.`,'error');
    if(isCottage&&!d.tour_rate_id)return toast('Select the Tour / Swimming / Event Rate.','error');

    const payload={
      booking_type:type,
      guest_name:String(d.guest_name).trim(),
      contact_number:String(d.contact_number||'').trim()||null,
      booking_date:b?.booking_date||today(),
      check_in_date:d.check_in_date,
      check_out_date:d.check_out_date,
      status:d.status||'pending',
      notes:d.notes||null
    };

    if(isCottage){
      payload.cottage_id=d.unit_id;
      payload.room_id=null;
      payload.tour_rate_id=d.tour_rate_id;
    }else{
      payload.room_id=d.unit_id;
      payload.cottage_id=null;
      payload.tour_rate_id=null;
      payload.id_provided_type=d.id_provided_type||null;
      payload.id_provided_other=d.id_provided_type==='Other'?(String(d.id_provided_other||'').trim()||null):null;
      payload.room_key_issued=String(d.room_key_issued||'').trim()||null;
      payload.id_deposit_status=d.id_deposit_status||'not_received';
      payload.room_key_status=d.room_key_status||'not_issued';
      if(payload.id_provided_type==='Other'&&!payload.id_provided_other)return toast('Type the Other ID Type.','error');
    }

    if(!id){
      Object.assign(payload,{
        adults:0,kids:0,babies:0,seniors:0,pwd:0,
        discount_type:'none',discount_mode:'none'
      });
    }

    const res=id
      ? await sb.from('bookings').update(payload).eq('id',id).select().single()
      : await sb.from('bookings').insert({...payload,created_by:state.session.user.id}).select().single();

    if(res.error)return toast(res.error.message,'error');

    const couponResult=await v45ApplyOrRemoveCoupon(
      res.data.id,
      d.coupon_code,
      b?.coupon_code||''
    );

    await refreshOperations();
    const saved=state.cache.bookings.find(x=>x.id===res.data.id)||res.data;

    closeModal();

    if(!couponResult?.ok){
      toast(`Booking saved, but coupon was not applied: ${couponResult?.message||'Invalid coupon.'}`,'error');
    }else if(String(d.coupon_code||'').trim()){
      toast(`Booking saved. Coupon ${String(d.coupon_code).trim().toUpperCase()} applied.`);
    }else if(b?.coupon_code){
      toast('Booking saved. Coupon removed.');
    }else{
      toast(id?'Booking updated.':'Booking saved. Booker was automatically added as Pax #1.');
    }

    if(state.currentView==='cottage-bookings'||state.currentView==='room-bookings'){
      renderBookingTypePage(type);
    }else{
      renderCurrent();
    }

    if(!id)setTimeout(()=>openPaxManagerV24(saved),80);
  };
};

/* ------------------------------------------------------------
   ADD PAYMENT
   Coupon is visible and may be applied/removed BEFORE payment.
   ------------------------------------------------------------ */
openPaymentModal = async function(b){
  await refreshOperations();
  b=state.cache.bookings.find(x=>x.id===b.id)||b;

  const t=bookingAccountTotals(b);
  const couponDiscount=Number(b.coupon_discount_amount||0);
  const bookingDiscount=Number(b.discount_amount||0);

  openModal({
    title:'Add Payment',
    eyebrow:`${b.booking_number} · ${b.guest_name||'Guest'}`,
    wide:true,
    body:`
      <div class="report-kpis">
        <div class="report-kpi"><span>Gross</span><strong>${money(t.gross)}</strong></div>
        <div class="report-kpi"><span>Senior/PWD Discount</span><strong>-${money(bookingDiscount)}</strong></div>
        <div class="report-kpi"><span>Coupon Discount</span><strong>-${money(couponDiscount)}</strong></div>
        <div class="report-kpi"><span>Balance</span><strong>${money(t.balance)}</strong></div>
      </div>

      <div class="panel v45-coupon-box" style="margin-top:14px">
        <div class="panel-head">
          <div>
            <h3>Coupon / Voucher</h3>
            <p class="muted tiny">Apply a coupon before recording payment.</p>
          </div>
          ${b.coupon_code?'<span class="badge">Applied</span>':''}
        </div>
        <div class="v45-payment-coupon-row">
          <label>Coupon Code
            <input id="v45PaymentCouponCode" value="${esc(b.coupon_code||'')}" placeholder="Enter coupon code">
          </label>
          <div class="v45-payment-coupon-actions">
            <button type="button" class="btn btn-soft" id="v45PaymentApplyCoupon">${b.coupon_code?'Change / Reapply':'Apply Coupon'}</button>
            ${b.coupon_code?'<button type="button" class="btn btn-danger" id="v45PaymentRemoveCoupon">Remove Coupon</button>':''}
          </div>
        </div>
        <p class="tiny muted">Current: ${v45CouponSummary(b)}</p>
      </div>

      <form id="paymentForm" class="modal-form" style="margin-top:14px">
        <label>Amount
          <input name="amount" type="number" min="0.01" step="0.01" max="${t.balance||999999}" required>
        </label>
        <label>Method
          <select name="method">
            <option>Cash</option><option>GCash</option><option>Maya</option>
            <option>Bank Transfer</option><option>Card</option><option>Other</option>
          </select>
        </label>
        <label>Reference Number<input name="reference_number"></label>
        <label class="full">Notes<textarea name="notes" rows="2"></textarea></label>
      </form>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="savePaymentBtn">Save Payment</button>`
  });

  $('[data-modal-cancel]').onclick=closeModal;

  $('#v45PaymentApplyCoupon').onclick=async()=>{
    const code=String($('#v45PaymentCouponCode').value||'').trim();
    if(!code)return toast('Enter a coupon code.','error');

    const result=await v45ApplyOrRemoveCoupon(b.id,code,b.coupon_code||'');
    if(!result?.ok)return toast(result?.message||'Coupon could not be applied.','error');

    await refreshOperations();
    toast(`${String(result.coupon_code||code).toUpperCase()} applied. Discount: ${money(result.discount_amount||0)}`);
    openPaymentModal(state.cache.bookings.find(x=>x.id===b.id)||b);
  };

  if($('#v45PaymentRemoveCoupon')){
    $('#v45PaymentRemoveCoupon').onclick=async()=>{
      const result=await v45ApplyOrRemoveCoupon(b.id,'',b.coupon_code||'');
      if(!result?.ok)return toast(result?.message||'Coupon could not be removed.','error');

      await refreshOperations();
      toast('Coupon removed.');
      openPaymentModal(state.cache.bookings.find(x=>x.id===b.id)||b);
    };
  }

  $('#savePaymentBtn').onclick=async()=>{
    const fresh=state.cache.bookings.find(x=>x.id===b.id)||b;
    const totals=bookingAccountTotals(fresh);
    const fd=new FormData($('#paymentForm'));
    const amount=Number(fd.get('amount')||0);

    if(amount<=0)return toast('Enter a valid payment amount.','error');
    if(amount>totals.balance+0.001)return toast('Payment cannot be greater than the current balance.','error');

    const {error}=await sb.from('payments').insert({
      booking_id:fresh.id,
      payment_date:today(),
      amount,
      method:fd.get('method'),
      reference_number:fd.get('reference_number')||null,
      notes:fd.get('notes')||null,
      created_by:state.session.user.id
    });
    if(error)return toast(error.message,'error');

    closeModal();
    await refreshOperations();
    toast('Payment saved. Coupon, discounts and balance are updated.');
    if(state.currentView==='payments')renderModule('payments');
    else renderCurrent();
  };
};

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v46.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V4.6
   Invoice status constraint fix + Availability color highlights
   ============================================================ */

/* Database invoices.status only accepts:
   open | paid | void
   UI may still DISPLAY partial/unpaid based on live totals. */
function v46InvoiceDbStatus(total,paid,voided=false){
  if(voided)return 'void';
  total=Number(total||0);
  paid=Number(paid||0);
  return paid+0.001>=total ? 'paid' : 'open';
}

/* Override invoice create/refresh so it never sends "unpaid" or "partial"
   into the invoices.status database column. */
v38CreateOrRefreshInvoice = async function(b,existing=null){
  if(!b)return;
  await refreshOperations();
  b=(state.cache.bookings||[]).find(x=>x.id===b.id)||b;

  const t=bookingAccountTotals(b);
  const total=Number(t.total||0);
  const paid=Number(t.payments||0);

  const payload={
    booking_id:b.id,
    invoice_date:existing?.invoice_date||today(),
    subtotal:Number(t.gross||t.base||0),
    discount_total:Number(t.discount||0),
    total_amount:total,
    paid_amount:paid,
    balance:Number(t.balance||0),
    status:v46InvoiceDbStatus(total,paid,existing?.status==='void'),
    notes:existing?.notes||null
  };

  let res;
  if(existing){
    res=await sb.from('invoices').update(payload).eq('id',existing.id).select().single();
  }else{
    res=await sb.from('invoices').insert(payload).select().single();
  }

  if(res.error){
    console.error('V4.6 invoice save error:',res.error);
    return toast(res.error.message,'error');
  }

  await getTable('invoices');
  toast(existing?'Invoice refreshed from live booking account.':'Invoice generated.');
  return res.data;
};

/* UI display remains more informative:
   open DB status can appear as Unpaid or Partial depending on payments. */
function v46InvoiceDisplayStatus(inv){
  if(inv?.status==='void')return 'void';
  const m=v38InvoiceModel(inv);
  if(Number(m.balance||0)<=0)return 'paid';
  if(Number(m.paid||0)>0)return 'partial';
  return 'unpaid';
}

/* Rebuild Invoice page with display status but database-safe values. */
const v46RenderInvoicesBase=renderInvoicesV38;
renderInvoicesV38=async function(){
  await getTable('invoices');
  const rows=state.cache.invoices||[];
  const root=$('#view-invoices');
  if(!root)return;

  root.innerHTML=`<div class="section-head"><div><p class="eyebrow">CLIENT BILLING DOCUMENTS</p><h2>Invoices</h2><p class="muted">All invoices use one uniform professional format and live booking-account totals.</p></div><button class="btn btn-primary" id="v38AddInvoice">Generate Invoice</button></div>
  <div class="table-panel"><div class="table-toolbar">
    <input id="v38InvoiceSearch" class="grow" type="search" placeholder="Search invoice, booking, guest...">
    <select id="v38InvoicePeriod"><option value="month">Selected Month</option><option value="year">Whole Year</option></select>
    <input id="v38InvoiceMonth" type="month" value="${currentMonth()}">
    <select id="v38InvoiceYear">${v38InvoiceYears(rows).map(y=>`<option value="${y}">${y}</option>`).join('')}</select>
    <select id="v38InvoiceStatus"><option value="">All status</option><option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="paid">Paid</option><option value="void">Void</option></select>
    <button class="btn btn-soft" id="v38InvoiceReport">Professional Report</button>
  </div><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Invoice</th><th>Date</th><th>Booking</th><th>Guest</th><th>Room / Cottage</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody id="v38InvoiceBody"></tbody></table></div></div>`;

  const sync=()=>{
    $('#v38InvoiceMonth').style.display=$('#v38InvoicePeriod').value==='month'?'':'none';
    $('#v38InvoiceYear').style.display=$('#v38InvoicePeriod').value==='year'?'':'none';
  };

  const draw=()=>{
    const q=$('#v38InvoiceSearch').value.toLowerCase().trim();
    const mode=$('#v38InvoicePeriod').value;
    const p=v37Period(mode,$('#v38InvoiceMonth').value,$('#v38InvoiceYear').value);
    const st=$('#v38InvoiceStatus').value;

    const filtered=autoSortRows('invoices',rows.filter(inv=>{
      const m=v38InvoiceModel(inv);
      const displayStatus=v46InvoiceDisplayStatus(inv);
      return v37DateInPeriod(inv.invoice_date||inv.created_at,p) &&
        (!st||displayStatus===st) &&
        `${inv.invoice_number||''} ${m.booking_number} ${m.guest} ${m.unit.value}`.toLowerCase().includes(q);
    }));

    $('#v38InvoiceBody').innerHTML=filtered.length?filtered.map((inv,i)=>{
      const m=v38InvoiceModel(inv);
      const displayStatus=v46InvoiceDisplayStatus(inv);
      return `<tr>
        <td><strong>${i+1}</strong></td>
        <td><strong>${esc(inv.invoice_number||'—')}</strong></td>
        <td>${fmtDate(inv.invoice_date)}</td>
        <td>${esc(m.booking_number)}</td>
        <td>${esc(m.guest)}</td>
        <td>${esc(m.unit.value)}</td>
        <td>${money(m.total)}</td>
        <td>${money(m.paid)}</td>
        <td><strong>${money(m.balance)}</strong></td>
        <td><span class="badge invoice-status-${esc(displayStatus)}">${esc(displayStatus)}</span></td>
        <td><div class="row-actions">
          <button data-v38-view="${inv.id}">View</button>
          <button class="btn btn-soft" data-v38-print="${inv.id}">Print</button>
          <button class="btn btn-soft" data-v38-png="${inv.id}">Save PNG</button>
          ${inv.status!=='void'?`<button data-v38-refresh="${inv.id}">Refresh</button><button class="btn btn-danger" data-v38-void="${inv.id}">Void</button>`:''}
        </div></td>
      </tr>`;
    }).join(''):`<tr><td colspan="11" class="empty-state">No invoices found for selected period.</td></tr>`;

    $$('[data-v38-view]').forEach(x=>x.onclick=()=>v38OpenInvoice(x.dataset.v38View));
    $$('[data-v38-print]').forEach(x=>x.onclick=()=>v36PrintInvoice(rows.find(r=>r.id===x.dataset.v38Print)));
    $$('[data-v38-png]').forEach(x=>x.onclick=()=>v38SaveInvoicePng(rows.find(r=>r.id===x.dataset.v38Png)));
    $$('[data-v38-refresh]').forEach(x=>x.onclick=async()=>{
      const inv=rows.find(r=>r.id===x.dataset.v38Refresh);
      const b=state.cache.bookings.find(b=>b.id===inv.booking_id);
      await v38CreateOrRefreshInvoice(b,inv);
      renderInvoicesV38();
    });
    $$('[data-v38-void]').forEach(x=>x.onclick=()=>v38VoidInvoice(x.dataset.v38Void));
  };

  $('#v38AddInvoice').onclick=v38SelectBookingForInvoice;
  $('#v38InvoicePeriod').onchange=()=>{sync();draw();};
  $('#v38InvoiceMonth').onchange=draw;
  $('#v38InvoiceYear').onchange=draw;
  $('#v38InvoiceStatus').onchange=draw;
  $('#v38InvoiceSearch').oninput=draw;
  $('#v38InvoiceReport').onclick=()=>{
    const p=v37Period($('#v38InvoicePeriod').value,$('#v38InvoiceMonth').value,$('#v38InvoiceYear').value);
    v37PrintPageReport('invoices',p);
  };
  sync();
  draw();
};

/* ============================================================
   AVAILABILITY CALENDAR
   Occupied = RED, Reserved = AMBER, Available = GREEN.
   ============================================================ */
renderAvailability = function(){
  const days=Array.from({length:14},(_,i)=>{
    const d=new Date();
    d.setDate(d.getDate()+i);
    return isoDate(d);
  });

  const units=[
    ...state.cache.rooms.map(x=>({...x,t:'room'})),
    ...state.cache.cottages.map(x=>({...x,t:'cottage'}))
  ].filter(x=>x.is_active!==false);

  $('#view-availability').innerHTML=`
    <div class="section-head">
      <div><p class="eyebrow">14-DAY OPERATIONS CALENDAR</p><h2>Availability Calendar</h2></div>
      <div class="availability-legend">
        <span><i class="availability-dot available"></i>Available</span>
        <span><i class="availability-dot reserved"></i>Reserved</span>
        <span><i class="availability-dot occupied"></i>Occupied</span>
        <span><i class="availability-dot unavailable"></i>Cleaning / Maintenance</span>
      </div>
    </div>
    <div class="table-panel">
      <div class="table-scroll">
        <table class="data-table availability-table">
          <thead><tr><th>Unit</th>${days.map(d=>`<th>${fmtDate(d)}</th>`).join('')}</tr></thead>
          <tbody>
            ${units.map(u=>`<tr>
              <td><strong>${esc(u.name||u.unit_number)}</strong><br><small>${esc(u.t)}</small></td>
              ${days.map(d=>{
                const s=unitStatus(u.t,u,d);
                const cls=s==='occupied'?'occupied':s==='reserved'?'reserved':s==='available'?'available':'unavailable';
                const booking=bookingForUnit(u.t,u.id,d);
                return `<td class="availability-cell ${cls}" title="${booking?esc(`${booking.booking_number||''} · ${booking.guest_name||'Guest'}`):esc(s)}">
                  <span class="availability-status">${esc(s)}</span>
                  ${booking?`<small>${esc(booking.guest_name||'Guest')}</small>`:''}
                </td>`;
              }).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  if(typeof v40LabelAllTables==='function')v40LabelAllTables($('#view-availability'));
};

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v48.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V4.8
   AVAILABILITY CALENDAR REDESIGN
   - Unit names remain horizontal, never vertical
   - Reserved/Occupied show guest/client name
   - Occupied = red, Reserved = amber, Available = green
   - Desktop calendar scrolls only inside its own area
   - Tablet/iPad/phone use stacked unit cards with no page-level left scroll
   ============================================================ */

function v48AvailabilityStatusClass(status){
  if(status==='occupied') return 'occupied';
  if(status==='reserved') return 'reserved';
  if(status==='available') return 'available';
  return 'unavailable';
}

function v48GuestInfo(type,unitId,date){
  const b=bookingForUnit(type,unitId,date);
  if(!b)return '';
  return `<div class="v48-booked-guest">${esc(b.guest_name||'Guest')}</div>
          <div class="v48-booking-no">${esc(b.booking_number||'')}</div>`;
}

function v48DesktopAvailability(units,days){
  return `<div class="table-panel v48-availability-panel">
    <div class="v48-calendar-scroll">
      <table class="v48-availability-table">
        <thead>
          <tr>
            <th class="v48-unit-col">Unit</th>
            ${days.map(d=>`<th>${fmtDate(d)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${units.map(u=>`<tr>
            <td class="v48-unit-col">
              <div class="v48-unit-name">${esc(u.name||u.unit_number)}</div>
              <div class="v48-unit-type">${esc(u.t==='room'?'Room':'Cottage')}</div>
            </td>
            ${days.map(d=>{
              const s=unitStatus(u.t,u,d);
              const cls=v48AvailabilityStatusClass(s);
              const b=bookingForUnit(u.t,u.id,d);
              return `<td class="v48-calendar-cell ${cls}" ${b?`title="${esc(`${b.guest_name||'Guest'} · ${b.booking_number||''}`)}"`:''}>
                <span class="v48-status-pill">${esc(s)}</span>
                ${v48GuestInfo(u.t,u.id,d)}
              </td>`;
            }).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

function v48CompactAvailability(units,days){
  return `<div class="v48-mobile-calendar">
    ${units.map(u=>`
      <section class="panel v48-mobile-unit">
        <div class="v48-unit-header">
          <div class="v48-unit-header-main">
            <span class="v48-unit-kind">${esc(u.t==='room'?'ROOM':'COTTAGE')}</span>
            <strong class="v48-unit-title">${esc(u.name||u.unit_number)}</strong>
          </div>
        </div>
        <div class="v48-mobile-days">
          ${days.map(d=>{
            const s=unitStatus(u.t,u,d);
            const cls=v48AvailabilityStatusClass(s);
            const b=bookingForUnit(u.t,u.id,d);
            return `<div class="v48-mobile-day ${cls}">
              <div class="v48-mobile-date">${fmtDate(d)}</div>
              <div class="v48-mobile-info">
                <span class="v48-status-pill">${esc(s)}</span>
                ${b?`<strong class="v48-booked-guest">${esc(b.guest_name||'Guest')}</strong>
                     <small class="v48-booking-no">${esc(b.booking_number||'')}</small>`:''}
              </div>
            </div>`;
          }).join('')}
        </div>
      </section>
    `).join('')}
  </div>`;
}

renderAvailability=function(){
  const days=Array.from({length:14},(_,i)=>{
    const d=new Date();
    d.setDate(d.getDate()+i);
    return isoDate(d);
  });

  const units=[
    ...state.cache.rooms.map(x=>({...x,t:'room'})),
    ...state.cache.cottages.map(x=>({...x,t:'cottage'}))
  ].filter(x=>x.is_active!==false);

  const compact=window.innerWidth<=1024;

  $('#view-availability').innerHTML=`
    <div class="section-head v48-availability-head">
      <div>
        <p class="eyebrow">14-DAY OPERATIONS CALENDAR</p>
        <h2>Availability Calendar</h2>
        <p class="muted">Reserved and occupied dates show the guest/client name.</p>
      </div>
      <div class="availability-legend">
        <span><i class="availability-dot available"></i>Available</span>
        <span><i class="availability-dot reserved"></i>Reserved</span>
        <span><i class="availability-dot occupied"></i>Occupied</span>
        <span><i class="availability-dot unavailable"></i>Cleaning / Maintenance</span>
      </div>
    </div>
    ${units.length
      ? (compact?v48CompactAvailability(units,days):v48DesktopAvailability(units,days))
      : '<div class="empty-state">No active rooms or cottages found.</div>'}
  `;
};

let v48WasCompact=window.innerWidth<=1024;
window.addEventListener('resize',()=>{
  const compact=window.innerWidth<=1024;
  if(compact!==v48WasCompact){
    v48WasCompact=compact;
    if(state.currentView==='availability')renderAvailability();
  }
});

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v49.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V4.9
   AVAILABILITY TOP SCROLLBAR
   Adds a synchronized horizontal scrollbar ABOVE the calendar
   so users do not need to go to the bottom to scroll dates.
   ============================================================ */

function v49SetupAvailabilityScroll(){
  const main=$('.v48-calendar-scroll');
  const top=$('.v49-top-scroll');
  const spacer=$('.v49-top-scroll-spacer');
  if(!main||!top||!spacer)return;

  const table=main.querySelector('.v48-availability-table');
  if(!table)return;

  const syncWidth=()=>{
    spacer.style.width=`${table.scrollWidth}px`;
  };
  syncWidth();

  let syncing=false;
  top.addEventListener('scroll',()=>{
    if(syncing)return;
    syncing=true;
    main.scrollLeft=top.scrollLeft;
    requestAnimationFrame(()=>syncing=false);
  });
  main.addEventListener('scroll',()=>{
    if(syncing)return;
    syncing=true;
    top.scrollLeft=main.scrollLeft;
    requestAnimationFrame(()=>syncing=false);
  });

  if('ResizeObserver' in window){
    const ro=new ResizeObserver(syncWidth);
    ro.observe(table);
  }else{
    window.addEventListener('resize',syncWidth);
  }
}

/* Wrap the desktop calendar with a top scrollbar.
   Tablet/mobile card layout is unchanged. */
const v49DesktopAvailabilityBase=v48DesktopAvailability;
v48DesktopAvailability=function(units,days){
  const calendar=v49DesktopAvailabilityBase(units,days);
  return `<div class="v49-availability-desktop">
    <div class="v49-scroll-label">Scroll dates</div>
    <div class="v49-top-scroll" aria-label="Scroll availability dates horizontally">
      <div class="v49-top-scroll-spacer"></div>
    </div>
    ${calendar}
  </div>`;
};

const v49RenderAvailabilityBase=renderAvailability;
renderAvailability=function(){
  const r=v49RenderAvailabilityBase();
  if(window.innerWidth>1024){
    requestAnimationFrame(()=>requestAnimationFrame(v49SetupAvailabilityScroll));
  }
  return r;
};

/* ========================================================================
   CONSOLIDATED SOURCE: operations-v50.js
   Preserved in the same execution order as V5.0.
   ======================================================================== */


/* ============================================================
   MASUSI FARM RESORT V5.0
   FINAL RESPONSIVE UI PASS
   No business logic changes.
   ============================================================ */

function v50ResponsiveSweep(){
  const compact=window.innerWidth<=1024;
  document.documentElement.classList.toggle('v50-compact',compact);
  document.documentElement.classList.toggle('v50-phone',window.innerWidth<=700);

  // Ensure all active tables have mobile labels.
  if(typeof v40LabelAllTables==='function')v40LabelAllTables(document);

  // Prevent accidental fixed/min widths from forcing the page wider.
  if(compact){
    document.querySelectorAll('.view.active [style]').forEach(el=>{
      const s=el.getAttribute('style')||'';
      if(/min-width\s*:\s*(?:[6-9]\d{2}|\d{4,})px/i.test(s)){
        el.style.minWidth='0';
        el.style.maxWidth='100%';
      }
    });
  }
}

window.addEventListener('resize',()=>requestAnimationFrame(v50ResponsiveSweep));
document.addEventListener('DOMContentLoaded',()=>setTimeout(v50ResponsiveSweep,80));
setTimeout(v50ResponsiveSweep,250);

const v50RenderCurrentBase=renderCurrent;
renderCurrent=async function(){
  const result=await v50RenderCurrentBase();
  requestAnimationFrame(v50ResponsiveSweep);
  return result;
};

const v50OpenModalBase=openModal;
openModal=function(opts){
  const r=v50OpenModalBase(opts);
  requestAnimationFrame(v50ResponsiveSweep);
  return r;
};

/* ============================================================================
   MASUSI FARM RESORT V5.2
   REPORTS PAGE — FULL ON-SCREEN REPORT PREVIEW
   Generate now renders the actual selected report inside the Reports page.
   Professional Print uses the same report dataset.
   ============================================================================ */

async function v52BuildCentralReport(){
  await refreshOperations();

  const type=$('#reportType')?.value||'bookings';
  const mode=$('#reportPeriodMode')?.value||'month';
  const p=v37Period(mode,v37MonthValue(),v37YearValue());

  if(type==='pax_demographics'){
    const bookingMap=Object.fromEntries((state.cache.bookings||[]).map(b=>[b.id,b]));
    const rows=(state.cache.pax||[]).filter(px=>{
      const b=bookingMap[px.booking_id];
      return b &&
        v37DateInPeriod(b.check_in_date||b.booking_date,p) &&
        px.access_status!=='cancelled';
    });

    const genders={Male:0,Female:0,'LGBTQIA+':0,'Not specified':0};
    rows.forEach(px=>{
      if(genders[px.gender]!==undefined)genders[px.gender]++;
      else genders['Not specified']++;
    });

    const areas={};
    rows.forEach(px=>{
      const area=px.area_name||px.area||'Not specified';
      areas[area]=(areas[area]||0)+1;
    });

    const cats=typeof v44PaxCategoryCounts==='function'
      ? v44PaxCategoryCounts(rows)
      : {Adult:0,Kid:0,Baby:0,Senior:0,PWD:0,'Not classified':0};

    const outside=rows.filter(px=>{
      const a=String(px.area_name||px.area||'').trim();
      return a && a.toLowerCase()!=='naic';
    }).length;

    return {
      title:'Pax Demographics & Area Report',
      period:p,
      kpis:[
        ['Pax',rows.length,'Booked pax'],
        ['Adult',cats.Adult,'Regular adult'],
        ['Senior',cats.Senior,'Senior pax'],
        ['PWD',cats.PWD,'PWD pax'],
        ['Kids',cats.Kid,'Kid pax'],
        ['Babies',cats.Baby,'Baby pax'],
        ['Outside Naic',outside,'Selected period'],
        ['Not Classified',cats['Not classified'],'Pending category']
      ],
      tables:[
        {title:'Pax Category Summary',cols:['Category','Count'],rows:[
          ['Adult',cats.Adult],
          ['Senior',cats.Senior],
          ['PWD',cats.PWD],
          ['Kid',cats.Kid],
          ['Baby',cats.Baby],
          ['Not Classified',cats['Not classified']]
        ]},
        {title:'Gender Summary',cols:['Gender','Count'],rows:Object.entries(genders)},
        {title:'Area Summary',cols:['Area','Count'],rows:Object.entries(areas).sort((a,b)=>b[1]-a[1])},
        {title:'Pax Details',cols:['#','Pax','Category','Gender','Area','Booking','Client'],rows:rows.map((px,i)=>[
          i+1,
          px.display_name||paxDisplayName(px),
          typeof v41PaxCategory==='function'?v41PaxCategory(px):(px.pax_type||'Not classified'),
          px.gender||'Not specified',
          px.area_name||px.area||'Not specified',
          bookingMap[px.booking_id]?.booking_number||'—',
          bookingMap[px.booking_id]?.guest_name||'Guest'
        ])}
      ]
    };
  }

  const page=type==='occupancy'?'bookings':type;
  const report=await v37GetPageReport(page,p);
  if(type==='occupancy')report.title='Occupancy Report';
  return report;
}

function v52OnScreenReportHtml(r){
  const periodLabel=r.period?.label||'Current Snapshot';

  return `<div class="report-sheet v52-screen-report">
    <div class="report-header v52-report-header">
      <div class="v52-report-brand">
        ${v36LogoUrl()?`<img src="${esc(v36LogoUrl())}" alt="Resort Logo" onerror="this.style.display='none'">`:''}
        <div>
          <p class="eyebrow">${esc(v36ResortName().toUpperCase())}</p>
          <h2>${esc(r.title||'Management Report')}</h2>
          <p class="muted">${esc(periodLabel)}</p>
        </div>
      </div>
      <div class="v52-report-meta">
        <strong>Generated</strong>
        <span>${new Date().toLocaleString('en-PH')}</span>
      </div>
    </div>

    ${(r.kpis||[]).length?`
      <div class="report-kpis v52-report-kpis">
        ${(r.kpis||[]).map(k=>`
          <div class="report-kpi">
            <span>${esc(k[0])}</span>
            <strong>${esc(k[1])}</strong>
            ${k[2]?`<small>${esc(k[2])}</small>`:''}
          </div>`).join('')}
      </div>`:''}

    ${(r.tables||[]).map(t=>`
      <section class="panel v52-report-section">
        <div class="panel-head">
          <div>
            <h3>${esc(t.title)}</h3>
            <p class="muted tiny">${t.rows?.length||0} record${(t.rows?.length||0)===1?'':'s'}</p>
          </div>
        </div>
        <div class="v52-report-table-scroll">
          <table class="v52-report-table">
            <thead>
              <tr>${(t.cols||[]).map(c=>`<th>${esc(c)}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${(t.rows||[]).length
                ? t.rows.map(row=>`<tr>${row.map(cell=>`<td>${esc(cell)}</td>`).join('')}</tr>`).join('')
                : `<tr><td colspan="${Math.max(1,(t.cols||[]).length)}" class="empty-state">No records found for this period.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>`).join('')}

    <div class="v52-report-footer">
      <span>${esc(v36ResortName())}</span>
      <span>${esc(r.title||'Management Report')} · ${esc(periodLabel)}</span>
    </div>
  </div>`;
}

async function v52GenerateCentralReportPreview(){
  const root=$('#reportContent');
  const btn=$('#runReportBtn');
  if(!root)return;

  const oldText=btn?.textContent||'Generate';
  if(btn){
    btn.disabled=true;
    btn.textContent='Generating...';
  }

  root.innerHTML=`<div class="panel v52-report-loading">
    <strong>Generating report...</strong>
    <p class="muted">Please wait while the selected records are prepared.</p>
  </div>`;

  try{
    const report=await v52BuildCentralReport();
    root.innerHTML=v52OnScreenReportHtml(report);
    root.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(err){
    console.error('V5.2 report preview error:',err);
    root.innerHTML=`<div class="panel">
      <h3>Unable to generate report</h3>
      <p class="form-message">${esc(err?.message||'An unexpected error occurred.')}</p>
    </div>`;
    toast(err?.message||'Unable to generate report.','error');
  }finally{
    if(btn){
      btn.disabled=false;
      btn.textContent=oldText;
    }
  }
}

/* Professional Print now uses exactly the same report builder as screen preview. */
v37PrintCentralReport=async function(){
  try{
    const report=await v52BuildCentralReport();
    v36OpenPrintWindow(v37ProfessionalReportHtml(report));
  }catch(err){
    console.error('V5.2 print report error:',err);
    toast(err?.message||'Unable to prepare report for printing.','error');
  }
};

function v52ReportSelectionChanged(){
  v37SyncReportPeriodControls();
  const mode=$('#reportPeriodMode')?.value||'month';
  const p=v37Period(mode,v37MonthValue(),v37YearValue());
  const root=$('#reportContent');
  if(!root)return;

  root.innerHTML=`<div class="report-sheet v52-report-placeholder">
    <div class="report-header">
      <div>
        <p class="eyebrow">${esc(v36ResortName().toUpperCase())}</p>
        <h2>${esc($('#reportType option:checked')?.textContent||'Management Report')}</h2>
        <p class="muted">${esc(p.label)}</p>
      </div>
      <div><strong>Ready to Generate</strong></div>
    </div>
    <div class="panel" style="margin-top:16px">
      <h3>Selected Report</h3>
      <p><strong>${esc($('#reportType option:checked')?.textContent||'Management Report')}</strong></p>
      <p class="muted">Click <strong>Generate</strong> to display the complete report here. Printing is optional.</p>
    </div>
  </div>`;
}

/* Re-bind Reports controls after all older version handlers. */
setTimeout(()=>{
  v37PopulateYears();
  v37SyncReportPeriodControls();

  if($('#runReportBtn')){
    $('#runReportBtn').textContent='Generate';
    $('#runReportBtn').onclick=v52GenerateCentralReportPreview;
  }

  if($('#printReportBtn')){
    $('#printReportBtn').textContent='Professional Print';
    $('#printReportBtn').onclick=v37PrintCentralReport;
  }

  if($('#reportPeriodMode'))$('#reportPeriodMode').onchange=v52ReportSelectionChanged;
  if($('#reportsMonth'))$('#reportsMonth').onchange=v52ReportSelectionChanged;
  if($('#reportsYear'))$('#reportsYear').onchange=v52ReportSelectionChanged;
  if($('#reportType'))$('#reportType').onchange=v52ReportSelectionChanged;

  v52ReportSelectionChanged();
},120);

/* ============================================================================
   MASUSI FARM RESORT V5.3
   BOOKING ACTION PRIORITY
   Payment stays visible outside. Coupon goes inside More.
   ============================================================================ */

function v53IsPaymentButton(btn){
  if(!btn || btn.tagName!=='BUTTON')return false;
  const t=(btn.textContent||'').trim().toLowerCase();
  return !!(
    btn.dataset?.v21Pay ||
    btn.dataset?.v23Pay ||
    btn.dataset?.pay ||
    t==='payment' ||
    t==='add payment'
  );
}

function v53IsCouponButton(btn){
  if(!btn || btn.tagName!=='BUTTON')return false;
  const t=(btn.textContent||'').trim().toLowerCase();
  return !!(
    btn.dataset?.v39Coupon ||
    t==='coupon' ||
    t==='apply coupon' ||
    t==='change coupon'
  );
}

function v53PrioritizePaymentActions(){
  document.querySelectorAll('.row-actions').forEach(actions=>{
    const more=actions.querySelector(':scope > details.action-more');
    if(!more)return;

    const menu=more.querySelector(':scope > .action-more-menu');
    if(!menu)return;

    const directButtons=[...actions.children].filter(x=>x.tagName==='BUTTON');
    const directCoupon=directButtons.find(v53IsCouponButton);
    const directPayment=directButtons.find(v53IsPaymentButton);

    const menuButtons=[...menu.querySelectorAll(':scope > button')];
    const menuPayment=menuButtons.find(v53IsPaymentButton);
    const menuCoupon=menuButtons.find(v53IsCouponButton);

    /* Main requested case:
       Coupon was appended after the old More grouping, so Coupon is visible
       while Payment remained inside More. Swap their locations. */
    if(directCoupon && menuPayment){
      actions.insertBefore(menuPayment, more);
      menu.appendChild(directCoupon);
      directCoupon.classList.remove('btn-primary');
      if(!directCoupon.classList.contains('btn-soft'))directCoupon.classList.add('btn-soft');
      if(!menuPayment.classList.contains('btn-primary'))menuPayment.classList.add('btn-primary');
      return;
    }

    /* If Payment is already visible, make sure Coupon is not also taking
       a primary outside slot when a More menu exists. */
    if(directPayment && directCoupon){
      menu.appendChild(directCoupon);
      return;
    }

    /* If both are inside More and there is room to promote Payment, move it
       outside directly before More. */
    if(!directPayment && menuPayment && !directCoupon){
      actions.insertBefore(menuPayment, more);
      if(!menuPayment.classList.contains('btn-primary'))menuPayment.classList.add('btn-primary');
    }

    /* If coupon is inside More already, keep it there. */
    if(menuCoupon){
      menuCoupon.classList.remove('btn-primary');
      if(!menuCoupon.classList.contains('btn-soft'))menuCoupon.classList.add('btn-soft');
    }
  });
}

let v53ActionSweepQueued=false;
function v53QueueActionSweep(){
  if(v53ActionSweepQueued)return;
  v53ActionSweepQueued=true;
  requestAnimationFrame(()=>{
    v53ActionSweepQueued=false;
    v53PrioritizePaymentActions();
  });
}

const v53ActionObserver=new MutationObserver(v53QueueActionSweep);
v53ActionObserver.observe(document.body,{childList:true,subtree:true});

document.addEventListener('DOMContentLoaded',()=>setTimeout(v53PrioritizePaymentActions,150));
setTimeout(v53PrioritizePaymentActions,300);

/* ============================================================================
   MASUSI FARM RESORT V5.4
   ADD PAX — PROVIDED QR/BARCODE FIRST
   Manual/provided code is the default and priority flow.
   Auto-generated code remains available as a secondary option.
   ============================================================================ */

let v54AddPaxScanner=null;
let v54AddPaxScannerRunning=false;

async function v54StopAddPaxScanner(){
  try{
    if(v54AddPaxScanner && v54AddPaxScannerRunning){
      await v54AddPaxScanner.stop();
      await v54AddPaxScanner.clear();
    }
  }catch(e){}
  v54AddPaxScanner=null;
  v54AddPaxScannerRunning=false;
}

async function v54StartAddPaxCamera(){
  const reader=$('#v54AddPaxReader');
  const panel=$('#v54AddPaxCameraPanel');
  const codeInput=$('#v54PaxCode');

  if(!reader||!panel||!codeInput)return;

  if(typeof Html5Qrcode==='undefined'){
    return toast('Camera scanner library did not load. You can type or use a USB/Bluetooth scanner instead.','error');
  }

  panel.classList.remove('hidden');
  $('#v54ScanProvidedBtn').disabled=true;

  try{
    v54AddPaxScanner=new Html5Qrcode('v54AddPaxReader');
    const cameras=await Html5Qrcode.getCameras();
    if(!cameras?.length)throw new Error('No camera detected.');

    const preferred=
      cameras.find(c=>/back|rear|environment/i.test(c.label)) ||
      cameras[cameras.length-1];

    v54AddPaxScannerRunning=true;

    await v54AddPaxScanner.start(
      preferred.id,
      {fps:10,qrbox:{width:260,height:180},aspectRatio:1.333333},
      async decodedText=>{
        const code=v24Norm(decodedText);
        if(!code)return;

        codeInput.value=code;
        codeInput.dataset.source='provided';
        $('#v54CodeSource').textContent='Provided QR / Barcode scanned';
        $('#v54CodeSource').className='v54-code-source provided';

        await v54StopAddPaxScanner();
        panel.classList.add('hidden');
        $('#v54ScanProvidedBtn').disabled=false;

        toast(`Provided code scanned: ${code}`);
        codeInput.focus();
      },
      ()=>{}
    );
  }catch(err){
    console.error(err);
    await v54StopAddPaxScanner();
    panel.classList.add('hidden');
    $('#v54ScanProvidedBtn').disabled=false;
    toast(err?.message||'Unable to open camera.','error');
  }
}

function v54SetAutoPaxCode(){
  const input=$('#v54PaxCode');
  if(!input)return;
  input.value=v24RandomPaxCode();
  input.dataset.source='auto';
  $('#v54CodeSource').textContent='System-generated code';
  $('#v54CodeSource').className='v54-code-source auto';
  input.focus();
}

function v54ClearPaxCode(){
  const input=$('#v54PaxCode');
  if(!input)return;
  input.value='';
  input.dataset.source='provided';
  $('#v54CodeSource').textContent='Waiting for provided QR / Barcode';
  $('#v54CodeSource').className='v54-code-source provided';
  input.focus();
}

/* Latest Add Pax flow */
openAddPaxV24=function(booking){
  openModal({
    title:'Add Pax / Companion',
    eyebrow:booking.booking_number,
    wide:true,
    body:`<form id="v54AddPaxForm" class="modal-form">
      <label>Name / Nickname
        <input name="display_name" placeholder="Name does not need to be complete">
      </label>

      <label>Gender
        <select name="gender">${v35GenderOptions('')}</select>
      </label>

      <label>Area
        <select name="area" id="v35PaxArea">${v35AreaOptions('')}</select>
      </label>

      <label id="v35OtherAreaWrap" class="hidden">
        Other Area / City / Province
        <input name="area_other" placeholder="Type location">
      </label>

      <div class="panel full v54-code-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">PAX QR / BARCODE</p>
            <h3>Use Provided Code</h3>
            <p class="muted tiny">Priority: scan or enter the physical QR/barcode that you will give to this pax.</p>
          </div>
          <span id="v54CodeSource" class="v54-code-source provided">Waiting for provided QR / Barcode</span>
        </div>

        <label class="full v54-code-input-label">
          Barcode / QR / Code
          <input
            name="code"
            id="v54PaxCode"
            class="barcode-input"
            autocomplete="off"
            placeholder="Scan with handheld scanner or type the provided code"
            required
            autofocus>
        </label>

        <div class="v54-code-actions full">
          <button type="button" class="btn btn-primary" id="v54ScanProvidedBtn">Scan Provided QR / Barcode</button>
          <button type="button" class="btn btn-soft" id="v54AutoCodeBtn">Auto Generate Code</button>
          <button type="button" class="btn btn-soft" id="v54ClearCodeBtn">Clear</button>
        </div>

        <div id="v54AddPaxCameraPanel" class="full v54-camera-panel hidden">
          <div class="panel-head">
            <div>
              <h3>Camera Scanner</h3>
              <p class="muted tiny">Point the phone/tablet camera at the provided QR or barcode.</p>
            </div>
            <button type="button" class="btn btn-soft" id="v54StopPaxCameraBtn">Close Camera</button>
          </div>
          <div id="v54AddPaxReader"></div>
        </div>

        <p class="tiny muted full">
          USB/Bluetooth barcode scanner: click the code field, then scan.
          Phone/tablet: use <strong>Scan Provided QR / Barcode</strong>.
          Use <strong>Auto Generate Code</strong> only when no pre-printed code is available.
        </p>
      </div>

      <div class="panel full">
        <strong>Category is selected later.</strong>
        <p class="muted tiny">Adult / Kid / Baby / Senior / PWD will be selected when the pax is scanned for entry, or from Edit Pax in Pax Manager.</p>
      </div>
    </form>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v54AddPaxSave">Add Pax</button>`
  });

  v35WireAreaOther();

  const codeInput=$('#v54PaxCode');
  codeInput.dataset.source='provided';

  /* Handheld scanners commonly send Enter. Keep the scanned value,
     but do not accidentally submit before the user reviews the pax details. */
  codeInput.onkeydown=e=>{
    if(e.key==='Enter'){
      e.preventDefault();
      const code=v24Norm(codeInput.value);
      if(code){
        codeInput.value=code;
        codeInput.dataset.source='provided';
        $('#v54CodeSource').textContent='Provided QR / Barcode entered';
        $('#v54CodeSource').className='v54-code-source provided';
        toast(`Code captured: ${code}`);
      }
    }
  };

  codeInput.oninput=()=>{
    if(codeInput.dataset.source!=='auto'){
      codeInput.dataset.source='provided';
      $('#v54CodeSource').textContent=codeInput.value.trim()
        ? 'Provided QR / Barcode entered'
        : 'Waiting for provided QR / Barcode';
      $('#v54CodeSource').className='v54-code-source provided';
    }
  };

  $('#v54ScanProvidedBtn').onclick=v54StartAddPaxCamera;
  $('#v54AutoCodeBtn').onclick=v54SetAutoPaxCode;
  $('#v54ClearCodeBtn').onclick=v54ClearPaxCode;

  $('#v54StopPaxCameraBtn').onclick=async()=>{
    await v54StopAddPaxScanner();
    $('#v54AddPaxCameraPanel').classList.add('hidden');
    $('#v54ScanProvidedBtn').disabled=false;
  };

  $('[data-modal-cancel]').onclick=async()=>{
    await v54StopAddPaxScanner();
    openPaxManagerV24(booking);
  };

  if($('#modalCloseBtn')){
    $('#modalCloseBtn').onclick=async()=>{
      await v54StopAddPaxScanner();
      closeModal();
    };
  }

  $('#v54AddPaxSave').onclick=async()=>{
    const d=Object.fromEntries(new FormData($('#v54AddPaxForm')).entries());

    if(d.area==='Other'&&!String(d.area_other||'').trim()){
      return toast('Type the Other Area / City / Province.','error');
    }

    const code=v24Norm(d.code);
    if(!code){
      return toast('Scan or enter the provided Pax QR/Barcode, or use Auto Generate Code.','error');
    }

    /* Fast duplicate feedback before the RPC. */
    const {data:dupe,error:dupeError}=await sb
      .from('booking_pax')
      .select('id,display_name')
      .eq('code',code)
      .maybeSingle();

    if(dupeError)return toast(dupeError.message,'error');
    if(dupe)return toast('That QR / Barcode code is already assigned to another pax.','error');

    await v54StopAddPaxScanner();

    const {data,error}=await sb.rpc('add_unclassified_booking_pax_v41',{
      p_booking_id:booking.id,
      p_display_name:String(d.display_name||'').trim()||null,
      p_gender:d.gender||null,
      p_area:d.area||null,
      p_area_other:String(d.area_other||'').trim()||null,
      p_code:code
    });

    if(error)return toast(error.message,'error');

    const result=Array.isArray(data)?data[0]:data;
    if(result?.ok===false)return toast(result.message||'Could not add pax.','error');

    await refreshOperations();

    const source=codeInput.dataset.source==='auto'?'system-generated':'provided';
    toast(`Pax added with ${source} code: ${code}`);

    openPaxManagerV24(
      state.cache.bookings.find(x=>x.id===booking.id)||booking
    );
  };

  setTimeout(()=>codeInput?.focus(),120);
};

/* ============================================================================
   MASUSI FARM RESORT V5.5
   MULTI-MODE BARCODE / QR WORKFLOW
   Scan modes:
   1) Existing Pax
   2) Booking
   3) Assign Pax QR
   4) Auto Detect
   ============================================================================ */

state.v55ScanMode=state.v55ScanMode||'pax';

function v55ActiveBookings(){
  return (state.cache.bookings||[]).filter(b=>
    !['cancelled','checked_out','no_show'].includes(String(b.status||'').toLowerCase())
  );
}

function v55UnitNameForBooking(b){
  if(!b)return '—';
  if(b.room_id){
    const r=(state.cache.rooms||[]).find(x=>x.id===b.room_id);
    return r?.name||r?.unit_number||'Room';
  }
  if(b.cottage_id){
    const c=(state.cache.cottages||[]).find(x=>x.id===b.cottage_id);
    return c?.name||c?.unit_number||'Cottage';
  }
  return 'Not assigned';
}

function v55SetScanMode(mode){
  state.v55ScanMode=mode;
  document.querySelectorAll('[data-v55-scan-mode]').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.v55ScanMode===mode);
  });

  const title=$('#v55ScanModeTitle');
  const help=$('#v55ScanModeHelp');
  const search=$('#barcodeSearchBtn');
  const input=$('#barcodeInput');

  const data={
    pax:{
      title:'Scan Existing Pax',
      help:'Use this when the QR/barcode is already assigned to a pax. The system will open that pax for check-in, OUT, RETURN, account, or purchase.',
      button:'Scan Existing Pax',
      placeholder:'Scan assigned Pax QR / Barcode'
    },
    booking:{
      title:'Scan Booking',
      help:'Use this for a Booking QR, Booking Barcode, Booking Scan Code, or Booking Number.',
      button:'Scan Booking',
      placeholder:'Scan Booking QR / Barcode'
    },
    assign:{
      title:'Assign Printed QR to Pax',
      help:'Use this for a new pre-printed QR/barcode. After scanning, choose the booking, choose the pax, and choose the room/cottage assignment.',
      button:'Scan & Assign QR',
      placeholder:'Scan NEW provided Pax QR / Barcode'
    },
    auto:{
      title:'Auto Detect',
      help:'The system will first look for an existing Pax code, then a Booking code. If the code is unknown, you can assign it as a new Pax QR.',
      button:'Detect Code',
      placeholder:'Scan Pax or Booking QR / Barcode'
    }
  }[mode]||{};

  if(title)title.textContent=data.title||'Barcode Scanner';
  if(help)help.textContent=data.help||'';
  if(search)search.textContent=data.button||'Scan';
  if(input){
    input.placeholder=data.placeholder||'Scan or enter code';
    input.value='';
    setTimeout(()=>input.focus(),30);
  }
  if($('#barcodeResult')){
    $('#barcodeResult').innerHTML=`<div class="empty-state"><strong>${esc(data.title||'Ready to scan')}</strong><p>${esc(data.help||'')}</p></div>`;
  }
}

function v55SetupScannerModes(){
  const panel=$('#view-barcode .scanner-panel');
  if(!panel||panel.querySelector('#v55ScanModes'))return;

  const h3=panel.querySelector('h3');
  const p=h3?.nextElementSibling;

  if(h3){
    h3.id='v55ScanModeTitle';
    h3.textContent='Scan Existing Pax';
  }
  if(p){
    p.id='v55ScanModeHelp';
    p.textContent='Use this when the QR/barcode is already assigned to a pax.';
  }

  const modes=document.createElement('div');
  modes.id='v55ScanModes';
  modes.className='v55-scan-modes';
  modes.innerHTML=`
    <button type="button" class="v55-scan-mode active" data-v55-scan-mode="pax">
      <strong>Existing Pax</strong><small>Assigned QR</small>
    </button>
    <button type="button" class="v55-scan-mode" data-v55-scan-mode="booking">
      <strong>Booking</strong><small>Booking QR</small>
    </button>
    <button type="button" class="v55-scan-mode" data-v55-scan-mode="assign">
      <strong>Assign Pax QR</strong><small>New printed QR</small>
    </button>
    <button type="button" class="v55-scan-mode" data-v55-scan-mode="auto">
      <strong>Auto Detect</strong><small>Pax or Booking</small>
    </button>`;

  const input=$('#barcodeInput');
  panel.insertBefore(modes,input);

  modes.querySelectorAll('[data-v55-scan-mode]').forEach(btn=>{
    btn.onclick=()=>v55SetScanMode(btn.dataset.v55ScanMode);
  });

  v55SetScanMode(state.v55ScanMode||'pax');
}

function v55UnknownCodeResult(code,canAssign=true){
  $('#barcodeResult').innerHTML=`<div class="empty-state">
    <strong>Code not found</strong>
    <p>${esc(code)}</p>
    <small>This code is not currently assigned to a pax or booking.</small>
    ${canAssign?`<div style="margin-top:12px"><button class="btn btn-primary" id="v55AssignUnknownCode">Assign This QR to Pax</button></div>`:''}
  </div>`;
  if($('#v55AssignUnknownCode'))$('#v55AssignUnknownCode').onclick=()=>v55OpenAssignPaxQr(code);
}

/* ---------- ASSIGN A PRE-PRINTED CODE ---------- */

async function v55OpenAssignPaxQr(code){
  code=v24Norm(code);
  if(!code)return toast('Scan or enter a QR / Barcode first.','error');

  await refreshOperations();

  const existing=v24FindPaxByCode(code);
  if(existing){
    const b=state.cache.bookings.find(x=>x.id===existing.booking_id);
    openModal({
      title:'QR Already Assigned',
      eyebrow:'DUPLICATE CODE',
      body:`<div class="panel">
        <p><strong>${esc(code)}</strong></p>
        <p>This QR / Barcode is already assigned to <strong>${esc(paxDisplayName(existing))}</strong>.</p>
        <p class="muted">${esc(b?.booking_number||'')} · ${esc(b?.guest_name||'')}</p>
      </div>`,
      footer:`<button class="btn btn-soft" data-modal-cancel>Close</button><button class="btn btn-primary" id="v55OpenExistingPax">Open Existing Pax</button>`
    });
    $('[data-modal-cancel]').onclick=closeModal;
    $('#v55OpenExistingPax').onclick=()=>{closeModal();handlePaxScanV24(existing);};
    return;
  }

  const bookingMatch=v24FindBookingByCode(code);
  if(bookingMatch){
    return toast('This code belongs to a Booking. Use Scan Booking mode.','error');
  }

  const bookings=v55ActiveBookings();
  if(!bookings.length)return toast('No active booking is available for Pax assignment.','error');

  openModal({
    title:'Assign Printed QR to Pax',
    eyebrow:code,
    wide:true,
    body:`<form id="v55AssignQrForm" class="modal-form">
      <div class="panel full v55-scanned-code-card">
        <span class="tiny muted">SCANNED QR / BARCODE</span>
        <strong>${esc(code)}</strong>
        <p class="muted tiny">This exact printed code will become the pax code.</p>
      </div>

      <label class="full">1. Assign to Booking
        <select name="booking_id" id="v55AssignBooking" required>
          <option value="">Select booking...</option>
          ${bookings.map(b=>`<option value="${b.id}">${esc(b.booking_number)} · ${esc(b.guest_name||'Guest')} · ${esc(v55UnitNameForBooking(b))}</option>`).join('')}
        </select>
      </label>

      <label class="full">2. Assign to Pax
        <select name="pax_id" id="v55AssignPax" required disabled>
          <option value="">Select booking first...</option>
        </select>
      </label>

      <div id="v55NewPaxFields" class="panel full hidden">
        <h3>New Pax / Companion</h3>
        <div class="modal-form">
          <label>Name / Nickname
            <input name="new_pax_name" placeholder="Name or nickname">
          </label>
          <label>Gender
            <select name="new_pax_gender">${v35GenderOptions('')}</select>
          </label>
          <label>Area
            <select name="new_pax_area" id="v55NewPaxArea">${v35AreaOptions('')}</select>
          </label>
          <label id="v55NewPaxOtherWrap" class="hidden">Other Area / City / Province
            <input name="new_pax_area_other" placeholder="Type location">
          </label>
        </div>
        <p class="tiny muted">Category remains unclassified until first entry scan or Edit Pax.</p>
      </div>

      <label class="full">3. Unit Assignment
        <select name="unit_id" id="v55AssignUnit" required disabled>
          <option value="">Select booking first...</option>
        </select>
      </label>

      <div class="panel full">
        <strong>Assignment only — no automatic check-in yet.</strong>
        <p class="muted tiny">After this QR is assigned, scan it again using <strong>Existing Pax</strong> mode to continue normal check-in / OUT / RETURN flow.</p>
      </div>
    </form>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v55SaveQrAssignment">Assign QR to Pax</button>`
  });

  $('[data-modal-cancel]').onclick=closeModal;

  const bookingSelect=$('#v55AssignBooking');
  const paxSelect=$('#v55AssignPax');
  const unitSelect=$('#v55AssignUnit');
  const newFields=$('#v55NewPaxFields');
  const newArea=$('#v55NewPaxArea');
  const newOther=$('#v55NewPaxOtherWrap');

  if(newArea)newArea.onchange=()=>newOther?.classList.toggle('hidden',newArea.value!=='Other');

  function populateAssignment(){
    const b=state.cache.bookings.find(x=>x.id===bookingSelect.value);

    if(!b){
      paxSelect.disabled=true;
      unitSelect.disabled=true;
      paxSelect.innerHTML='<option value="">Select booking first...</option>';
      unitSelect.innerHTML='<option value="">Select booking first...</option>';
      newFields.classList.add('hidden');
      return;
    }

    const pax=(state.cache.pax||[]).filter(p=>
      p.booking_id===b.id &&
      p.access_status!=='cancelled'
    );

    const unassigned=pax.filter(p=>!v24Norm(p.code));
    const currentlyAssigned=pax.filter(p=>v24Norm(p.code));

    paxSelect.disabled=false;
    paxSelect.innerHTML=`
      <option value="">Select pax...</option>
      ${unassigned.map(p=>`<option value="${p.id}">${esc(paxDisplayName(p))} · NO CODE</option>`).join('')}
      <option value="__new__">+ Create New Pax / Companion</option>
      ${currentlyAssigned.length?`<optgroup label="Already has QR — unavailable">${currentlyAssigned.map(p=>`<option disabled>${esc(paxDisplayName(p))} · ${esc(p.code)}</option>`).join('')}</optgroup>`:''}
    `;

    const isRoom=b.booking_type==='room'||!!b.room_id;
    unitSelect.disabled=false;

    if(isRoom){
      const room=(state.cache.rooms||[]).find(r=>r.id===b.room_id);
      unitSelect.innerHTML=b.room_id
        ? `<option value="${b.room_id}">${esc(room?.name||room?.unit_number||'Assigned Room')}</option>`
        : '<option value="">Booking has no room assigned</option>';
      if(b.room_id)unitSelect.value=b.room_id;
    }else{
      const cottages=(state.cache.cottages||[]).filter(c=>
        c.is_active!==false &&
        !['maintenance','damaged','inactive'].includes(String(c.status||'').toLowerCase())
      );
      unitSelect.innerHTML=`<option value="">Select cottage...</option>${cottages.map(c=>`<option value="${c.id}" ${c.id===b.cottage_id?'selected':''}>${esc(c.name||c.unit_number)} · Capacity ${c.capacity||'—'}</option>`).join('')}`;
      if(b.cottage_id)unitSelect.value=b.cottage_id;
    }
  }

  bookingSelect.onchange=populateAssignment;
  paxSelect.onchange=()=>{
    newFields.classList.toggle('hidden',paxSelect.value!=='__new__');
  };

  $('#v55SaveQrAssignment').onclick=async()=>{
    const d=Object.fromEntries(new FormData($('#v55AssignQrForm')).entries());
    const b=state.cache.bookings.find(x=>x.id===d.booking_id);
    if(!b)return toast('Select the booking.','error');
    if(!d.pax_id)return toast('Select the pax to receive this QR.','error');
    if(!d.unit_id)return toast('Select the room / cottage assignment.','error');

    /* Re-check just before save in case another staff user assigned it. */
    const {data:dupe,error:dupeError}=await sb
      .from('booking_pax')
      .select('id,display_name,booking_id')
      .eq('code',code)
      .maybeSingle();
    if(dupeError)return toast(dupeError.message,'error');
    if(dupe)return toast('This QR / Barcode was already assigned by another action. Scan it as Existing Pax.','error');

    let paxId=d.pax_id;

    if(paxId==='__new__'){
      if(d.new_pax_area==='Other'&&!String(d.new_pax_area_other||'').trim()){
        return toast('Type the Other Area / City / Province.','error');
      }

      const {data,error}=await sb.rpc('add_unclassified_booking_pax_v41',{
        p_booking_id:b.id,
        p_display_name:String(d.new_pax_name||'').trim()||null,
        p_gender:d.new_pax_gender||null,
        p_area:d.new_pax_area||null,
        p_area_other:String(d.new_pax_area_other||'').trim()||null,
        p_code:code
      });

      if(error)return toast(error.message,'error');
      const result=Array.isArray(data)?data[0]:data;
      if(result?.ok===false)return toast(result.message||'Could not create pax.','error');

      await refreshOperations();
      const created=(state.cache.pax||[]).find(p=>p.booking_id===b.id&&v24Norm(p.code).toLowerCase()===code.toLowerCase());
      if(!created)return toast('Pax was created but could not be reloaded. Refresh and try again.','error');
      paxId=created.id;
    }else{
      const target=(state.cache.pax||[]).find(p=>p.id===paxId&&p.booking_id===b.id);
      if(!target)return toast('Selected pax was not found.','error');
      if(v24Norm(target.code))return toast('Selected pax already has a QR / Barcode.','error');

      const patch={code};
      if(b.booking_type==='room'||b.room_id){
        patch.assigned_room_id=d.unit_id;
        patch.assigned_cottage_id=null;
      }else{
        patch.assigned_cottage_id=d.unit_id;
        patch.assigned_room_id=null;
      }

      const {error}=await sb.from('booking_pax').update(patch).eq('id',paxId);
      if(error)return toast(error.message,'error');
    }

    /* For a newly created pax, add the unit assignment after RPC creation. */
    if(d.pax_id==='__new__'){
      const patch=(b.booking_type==='room'||b.room_id)
        ? {assigned_room_id:d.unit_id,assigned_cottage_id:null}
        : {assigned_cottage_id:d.unit_id,assigned_room_id:null};

      const {error}=await sb.from('booking_pax').update(patch).eq('id',paxId);
      if(error)return toast(error.message,'error');
    }

    await refreshOperations();
    const assigned=state.cache.pax.find(p=>p.id===paxId);
    const unitName=(b.booking_type==='room'||b.room_id)
      ? ((state.cache.rooms||[]).find(r=>r.id===d.unit_id)?.name||(state.cache.rooms||[]).find(r=>r.id===d.unit_id)?.unit_number||'Room')
      : ((state.cache.cottages||[]).find(c=>c.id===d.unit_id)?.name||(state.cache.cottages||[]).find(c=>c.id===d.unit_id)?.unit_number||'Cottage');

    closeModal();

    $('#barcodeResult').innerHTML=`<div class="v55-assignment-success">
      <div class="v55-success-icon">✓</div>
      <h3>QR Assigned Successfully</h3>
      <div class="report-kpis">
        <div class="report-kpi"><span>Pax</span><strong>${esc(paxDisplayName(assigned))}</strong></div>
        <div class="report-kpi"><span>Booking</span><strong>${esc(b.booking_number)}</strong></div>
        <div class="report-kpi"><span>${b.room_id?'Room':'Cottage'}</span><strong>${esc(unitName)}</strong></div>
        <div class="report-kpi"><span>QR / Barcode</span><strong>${esc(code)}</strong></div>
      </div>
      <div class="row-actions v55-success-actions">
        <button class="btn btn-primary" id="v55ScanAssignedPaxNow">Scan as Existing Pax</button>
        <button class="btn btn-soft" id="v55AssignAnotherQr">Assign Another QR</button>
      </div>
    </div>`;

    $('#v55ScanAssignedPaxNow').onclick=()=>{
      v55SetScanMode('pax');
      $('#barcodeInput').value=code;
      scanBarcode();
    };
    $('#v55AssignAnotherQr').onclick=()=>{
      v55SetScanMode('assign');
      $('#barcodeInput').focus();
    };

    toast(`${code} assigned to ${paxDisplayName(assigned)}.`);
  };
}

/* ---------- MODE-AWARE SCAN ---------- */

scanBarcode=async function(){
  const input=$('#barcodeInput');
  const code=v24Norm(input?.value);
  if(!code)return;

  await refreshOperations();

  const mode=state.v55ScanMode||'pax';
  const pax=v24FindPaxByCode(code);
  const booking=v24FindBookingByCode(code);

  let barcodeBooking=null;
  if(!booking && (mode==='booking'||mode==='auto')){
    const {data:bc}=await sb.from('barcodes')
      .select('*')
      .ilike('code',code)
      .eq('is_active',true)
      .maybeSingle();
    if(bc?.booking_id)barcodeBooking=state.cache.bookings.find(x=>x.id===bc.booking_id);
  }

  if(mode==='pax'){
    if(pax){
      state.activeScanPax=pax;
      return handlePaxScanV24(pax);
    }
    if(booking||barcodeBooking){
      $('#barcodeResult').innerHTML=`<div class="empty-state">
        <strong>This is a Booking Code</strong>
        <p>${esc(code)}</p>
        <small>Switch to <strong>Booking</strong> or <strong>Auto Detect</strong> mode.</small>
        <div style="margin-top:12px"><button class="btn btn-primary" id="v55SwitchBookingMode">Open as Booking</button></div>
      </div>`;
      $('#v55SwitchBookingMode').onclick=()=>{
        v55SetScanMode('booking');
        $('#barcodeInput').value=code;
        scanBarcode();
      };
      return;
    }
    return v55UnknownCodeResult(code,true);
  }

  if(mode==='booking'){
    const b=booking||barcodeBooking;
    if(b)return openBookingScanResult(b);
    if(pax){
      $('#barcodeResult').innerHTML=`<div class="empty-state">
        <strong>This is an Existing Pax Code</strong>
        <p>${esc(code)}</p>
        <small>Switch to <strong>Existing Pax</strong> mode.</small>
        <div style="margin-top:12px"><button class="btn btn-primary" id="v55SwitchPaxMode">Open Pax</button></div>
      </div>`;
      $('#v55SwitchPaxMode').onclick=()=>{
        v55SetScanMode('pax');
        $('#barcodeInput').value=code;
        scanBarcode();
      };
      return;
    }
    return v55UnknownCodeResult(code,false);
  }

  if(mode==='assign'){
    return v55OpenAssignPaxQr(code);
  }

  /* AUTO DETECT */
  if(pax){
    state.activeScanPax=pax;
    return handlePaxScanV24(pax);
  }
  if(booking||barcodeBooking)return openBookingScanResult(booking||barcodeBooking);
  return v55UnknownCodeResult(code,true);
};

if($('#barcodeSearchBtn'))$('#barcodeSearchBtn').onclick=scanBarcode;
if($('#barcodeInput'))$('#barcodeInput').onkeydown=e=>{
  if(e.key==='Enter'){
    e.preventDefault();
    scanBarcode();
  }
};

/* Existing camera scanner already writes into #barcodeInput and calls scanBarcode().
   Because scanBarcode is now mode-aware, camera scanning automatically follows the
   selected Existing Pax / Booking / Assign Pax QR / Auto Detect mode. */

document.addEventListener('DOMContentLoaded',()=>setTimeout(v55SetupScannerModes,180));
setTimeout(v55SetupScannerModes,350);

const v55NavigateBase=navigate;
navigate=function(view){
  const r=v55NavigateBase(view);
  if(view==='barcode'){
    setTimeout(()=>{
      v55SetupScannerModes();
      v55SetScanMode(state.v55ScanMode||'pax');
    },80);
  }
  return r;
};

