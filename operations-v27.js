
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
  return ((b.booking_type||'')==='room' || b.room_id) ? 'Room Booking' : 'Cottage + Ligo Booking';
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
