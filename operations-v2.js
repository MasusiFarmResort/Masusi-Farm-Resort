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
