
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
