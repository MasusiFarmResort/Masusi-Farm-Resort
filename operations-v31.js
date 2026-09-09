
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
