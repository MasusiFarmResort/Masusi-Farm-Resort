
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
