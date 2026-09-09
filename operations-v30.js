
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
