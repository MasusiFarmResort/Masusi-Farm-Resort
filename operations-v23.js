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
function archiveTourRate(id){confirmModal('Archive Tour Rate','This rate will no longer be selectable for new Cottage + Ligo bookings. Existing bookings keep their saved price snapshot.',async()=>{const {error}=await sb.from('tour_rates').update({is_active:false}).eq('id',id);if(error)return toast(error.message,'error');closeModal();await getTable('tour_rates','tourRates');renderRatesPricing();toast('Tour rate archived.');},true)}

// Replace booking list so Cottage bookings visibly show Day/Night and applied discount.
renderBookingTypePage = async function(type){
  await Promise.all([getTable('bookings'),getTable('tour_rates','tourRates')]);
  const isCottage=type==='cottage_swim',rows=state.cache.bookings.filter(b=>(b.booking_type||((b.room_id)?'room':'cottage_swim'))===type);
  const id=isCottage?'cottage-bookings':'room-bookings',title=isCottage?'Cottage + Ligo Bookings':'Room Bookings';
  $(`#view-${id}`).innerHTML=`<div class="section-head"><div><p class="eyebrow">${isCottage?'DAY / NIGHT TOUR + SWIMMING':'ROOM ACCOMMODATION'}</p><h2>${title}</h2></div></div><div class="table-panel"><div class="table-toolbar"><input id="${id}Search" class="grow" type="search" placeholder="Search guest, booking no. or code..."><input id="${id}Month" type="month" value="${currentMonth()}"><select id="${id}Status"><option value="">All status</option><option>pending</option><option>confirmed</option><option>checked_in</option><option>checked_out</option><option>cancelled</option><option>no_show</option></select><button class="btn btn-soft" id="${id}Print">Print Month</button><button class="btn btn-primary" id="${id}Add">Add ${isCottage?'Cottage + Ligo':'Room'} Booking</button></div><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Booking</th><th>Guest</th><th>${isCottage?'Cottage / Tour':'Room'}</th><th>Check-in</th><th>Pax</th><th>Gross</th><th>Discount</th><th>Net Total</th><th>Balance</th><th>Actions</th></tr></thead><tbody id="${id}Body"></tbody></table></div></div>`;
  const draw=()=>{const q=$(`#${id}Search`).value.toLowerCase().trim(),m=$(`#${id}Month`).value,st=$(`#${id}Status`).value;const filtered=autoSortRows('bookings',rows.filter(b=>`${b.booking_number||''} ${b.booking_code||''} ${b.guest_name||''}`.toLowerCase().includes(q)&&(!m||String(b.check_in_date||b.booking_date||'').slice(0,7)===m)&&(!st||b.status===st)));$(`#${id}Body`).innerHTML=filtered.length?filtered.map((b,i)=>{const unit=isCottage?cottageById(b.cottage_id):roomById(b.room_id),pax=Number(b.adults||0)+Number(b.kids||0)+Number(b.babies||0),tour=isCottage?(tourRateById(b.tour_rate_id)?.name||b.tour_type||'Day Tour'):'';return `<tr><td><strong>${i+1}</strong></td><td><strong>${esc(b.booking_number)}</strong><br><small>${esc(b.booking_code||'')}</small></td><td>${esc(b.guest_name||'—')}</td><td>${esc(unit?.name||unit?.unit_number||'—')}${isCottage?`<br><small>${esc(tour)}</small>`:''}</td><td>${fmtDate(b.check_in_date)}</td><td>${pax}</td><td>${money(b.gross_amount||b.base_amount||0)}</td><td>${money(b.discount_amount||0)}<br><small>${esc(discountLabel(b))}</small></td><td>${money(b.total_amount||0)}</td><td>${money(b.balance||0)}</td><td><div class="row-actions"><button data-v23-view="${b.id}">View</button><button data-v23-code="${b.id}">Barcode / QR</button><button data-v23-edit="${b.id}">Edit</button><button data-v23-pay="${b.id}">Payment</button></div></td></tr>`}).join(''):`<tr><td colspan="11" class="empty-state">No ${title.toLowerCase()} found.</td></tr>`;$$('[data-v23-view]').forEach(x=>x.onclick=()=>openRecord('bookings',x.dataset.v23View));$$('[data-v23-code]').forEach(x=>x.onclick=()=>openCodesModal(state.cache.bookings.find(b=>b.id===x.dataset.v23Code)));$$('[data-v23-edit]').forEach(x=>x.onclick=()=>openBookingV21(type,x.dataset.v23Edit));$$('[data-v23-pay]').forEach(x=>x.onclick=()=>openPaymentModal(state.cache.bookings.find(b=>b.id===x.dataset.v23Pay)));};
  $(`#${id}Search`).oninput=draw;$(`#${id}Month`).onchange=draw;$(`#${id}Status`).onchange=draw;$(`#${id}Add`).onclick=()=>openBookingV21(type);$(`#${id}Print`).onclick=()=>printElementView(id);draw();
};

openBookingV21 = function(type,id=null){
  const isCottage=type==='cottage_swim',b=id?state.cache.bookings.find(x=>x.id===id):null;
  const cottages=state.cache.cottages.filter(x=>x.is_active!==false&&!['maintenance','damaged','inactive'].includes(x.status));
  const rooms=state.cache.rooms.filter(x=>x.is_active!==false&&!['maintenance','damaged','inactive'].includes(x.status));
  const unitOptions=(isCottage?cottages:rooms).map(x=>`<option value="${x.id}" ${(isCottage?b?.cottage_id:b?.room_id)===x.id?'selected':''}>${esc(x.name||x.unit_number)} · ${money(x.base_rate||0)} · Capacity ${x.capacity||0}</option>`).join('');
  const rates=activeTourRates(), rateOptions=rates.map(x=>`<option value="${x.id}" ${b?.tour_rate_id===x.id?'selected':''}>${esc(x.name)} · Adult ${money(x.adult_rate)} · Kids ${money(x.kid_rate)}${Number(x.baby_rate||0)===0?' · Baby FREE':` · Baby ${money(x.baby_rate)}`}</option>`).join('');
  openModal({title:id?`Edit ${isCottage?'Cottage + Ligo':'Room'} Booking`:`New ${isCottage?'Cottage + Ligo':'Room'} Booking`,eyebrow:id?`BOOKING ${b?.booking_number||''}`:'AUTO BOOKING NUMBER + BARCODE',wide:true,body:`
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
  $('#v23SaveBooking').onclick=async()=>{const d=Object.fromEntries(new FormData(f).entries()),adults=Number(d.adults||0),kids=Number(d.kids||0),babies=Number(d.babies||0),seniors=Number(d.seniors||0),pwd=Number(d.pwd||0);if(!String(d.guest_name||'').trim())return toast('Guest / client name is required.','error');if(!d.unit_id)return toast(`Select a ${isCottage?'cottage':'room'}.`,'error');if(isCottage&&!d.tour_rate_id)return toast('Select Day Tour or Night Tour rate.','error');if(seniors+pwd>adults)return toast('Senior + PWD cannot be greater than Adults.','error');if(d.discount_type==='senior'&&seniors<1)return toast('Senior discount requires at least one Senior.','error');if(d.discount_type==='pwd'&&pwd<1)return toast('PWD discount requires at least one PWD.','error');if(d.discount_type==='none')d.discount_mode='none';if(d.discount_mode==='none')d.discount_type='none';const payload={booking_type:type,guest_name:String(d.guest_name).trim(),contact_number:d.contact_number||null,booking_date:b?.booking_date||today(),check_in_date:d.check_in_date,check_out_date:d.check_out_date,adults,kids,babies,seniors,pwd,status:d.status||'pending',discount_type:d.discount_type||'none',discount_mode:d.discount_mode||'none',notes:d.notes||null};if(isCottage){payload.cottage_id=d.unit_id;payload.room_id=null;payload.tour_rate_id=d.tour_rate_id;}else{payload.room_id=d.unit_id;payload.cottage_id=null;payload.tour_rate_id=null;}const res=id?await sb.from('bookings').update(payload).eq('id',id).select().single():await sb.from('bookings').insert({...payload,created_by:state.session.user.id}).select().single();if(res.error)return toast(res.error.message,'error');closeModal();await refreshOperations();const saved=state.cache.bookings.find(x=>x.id===res.data.id)||res.data;toast(`${isCottage?'Cottage + Ligo':'Room'} booking saved as ${saved.booking_number}.`);renderBookingTypePage(type);if(!id)setTimeout(()=>openCodesModal(saved),80);};
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
