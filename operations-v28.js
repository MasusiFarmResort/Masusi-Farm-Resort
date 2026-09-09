
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
