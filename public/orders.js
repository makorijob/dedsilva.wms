/* Orders screen: request > quotation > order > (ordering) > Nairobi > barcodes > invoice > dispatch (OTP) > delivered.
   Loaded after client.js. */
var STAGES=[["request","New request"],["quoted","Quote sent"],["ordered","Order confirmed"],["sourcing","Getting the goods"],["in_nairobi","Goods arrived"],["barcoded","Stock set aside"],["invoiced","Invoiced"],["dispatched","Out for delivery"],["delivered","Delivered"]];
var OSEL=null,OMSG=null,LASTOTP={},INV={},OLCO=null;
ROLES.admin.push("orders");ROLES.manager.push("orders");ROLES.clerk.push("orders");ROLES.merchandiser.push("orders");views.push("orders");

(function(){
  var st=document.createElement("style");
  st.textContent=".stepper{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.stp{padding:4px 10px;border-radius:14px;background:var(--bg);color:var(--muted);font-size:12px;font-weight:600;border:1px solid var(--line)}.stp.done{background:var(--okbg);color:var(--ok);border-color:transparent}.stp.cur{background:var(--accent);color:var(--accent-ink);border-color:transparent}.stp.skip{opacity:.45;text-decoration:line-through}"
   +".otpbox{background:var(--warnbg);color:var(--ink);border:2px dashed var(--accent);border-radius:6px;padding:12px;margin:10px 0}.otpbox b{font:700 34px 'Barlow Condensed',monospace;letter-spacing:.2em}"
   +".kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin:8px 0}.kv span{display:block;color:var(--muted);font-size:12px}.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{padding:2px 8px;border-radius:4px;border:1px solid var(--line);font-size:12px}.chip.dispatched{background:var(--line);color:var(--muted)}.chip.in_stock{background:var(--okbg);color:var(--ok)}"
   +".oline{margin-bottom:8px}.tl{margin:8px 0 0;padding-left:18px;font-size:13px;color:var(--muted)}.tl b{color:var(--ink);font-weight:600}tr.sel td{background:var(--bg)}";
  document.head.appendChild(st);
  var sec=document.createElement("section");sec.id="v-orders";sec.className="hide";
  sec.innerHTML='<div class="panel" id="ocreate"><h2>New request</h2><div id="oqueue"></div>'
   +'<div class="row"><div><label for="ocu">Customer (start typing to pick a saved customer)</label><input id="ocu" list="custlist" autocomplete="off" placeholder="Customer or organisation"><datalist id="custlist"></datalist></div><div><label for="oph">Customer phone</label><input id="oph" placeholder="07..."></div><div><label for="oad">Delivery address</label><input id="oad" placeholder="Street, building, town"></div><div><label for="ono">Note (optional)</label><input id="ono"></div></div><div class="empty" id="ocinfo" style="padding:6px 0 0"></div>'
   +'<div id="olines" style="margin-top:12px"></div><div class="tabs"><button class="btn alt sm hide" id="orep"></button><button class="btn alt sm" id="oadd">Add item line</button><button class="btn" id="osave">Save request</button></div></div>'
   +'<div class="panel"><h2>Orders</h2><div class="bar"><input id="oq" placeholder="Search order, customer, LPO, invoice, rider"><select id="os"><option value="">All stages</option></select></div><div class="tablewrap" id="olist"></div></div>'
   +'<div id="odetail"></div>';
  $("v-users").parentNode.appendChild(sec);
  $("os").innerHTML+=STAGES.map(function(s){return'<option value="'+s[0]+'">'+s[1]+'</option>'}).join('')+'<option value="cancelled">Cancelled</option>';
  /* order picker on the Scan screen (used when Action = Dispatch) */
  var w=document.createElement("div");w.id="ordwrap";w.className="hide";
  w.innerHTML='<label for="ord">Order being dispatched</label><select id="ord"></select>';
  $("locwrap").parentNode.appendChild(w);
  $("act").addEventListener("change",function(){$("ordwrap").classList.toggle("hide",$("act").value!=="dispatch")});
})();

function ordList(){return S.orders||[]}
function ordById(id){return ordList().filter(function(o){return o.id===id})[0]}
function stLabel(k){for(var i=0;i<STAGES.length;i++)if(STAGES[i][0]===k)return STAGES[i][1];return k==="cancelled"?"Cancelled":k}
function stIdx(k){for(var i=0;i<STAGES.length;i++)if(STAGES[i][0]===k)return i;return -1}
function isMgr(){return role()==="admin"||role()==="manager"}
function isMer(){return role()==="merchandiser"}
function out(o){return o.codes.filter(function(c){return c.status==="dispatched"}).length}

/* ---- product lines: type to search ---- */
function prodLabel(p){return p.name+" ("+p.sku+")"}
function fillProdList(){var dl=$("odl");if(!dl){dl=document.createElement("datalist");dl.id="odl";document.body.appendChild(dl)}dl.innerHTML=S.products.map(function(p){return'<option value="'+esc(prodLabel(p))+'">'}).join("")}
function pidOf(txt){
  txt=(txt||"").trim().toLowerCase();if(!txt)return 0;
  var m=S.products.filter(function(p){return prodLabel(p).toLowerCase()===txt});
  if(!m.length)m=S.products.filter(function(p){return String(p.sku).toLowerCase()===txt});
  if(!m.length){var f=S.products.filter(function(p){return prodLabel(p).toLowerCase().indexOf(txt)>=0});if(f.length===1)m=f}
  return m.length?m[0].id:0;
}
/* Quantities are kept in PACKS. For products that come in cartons the line can be entered in cartons and is converted. */
function lineProd(d){var id=pidOf(d.querySelector(".lp").value);return S.products.filter(function(p){return p.id===id})[0]||null}
function lineSync(d,unit){
  var p=lineProd(d),cq=p&&p.carton_qty>0?p.carton_qty:0,sel=d.querySelector(".lun"),h=d.querySelector(".lhint"),q=+d.querySelector(".lq").value||0;
  d.querySelector(".luw").classList.toggle("hide",!cq);
  if(unit){sel.value=unit;d.dataset.unitSet="1"}
  else if(cq&&!d.dataset.unitSet){sel.value="carton";d.dataset.unitSet="1"}   /* cartons first for products that come in cartons */
  if(!cq){h.textContent="";return}
  h.textContent=sel.value==="carton"?"= "+(q*cq).toLocaleString()+" packs ("+cq+" packs in each carton)":(q%cq===0&&q>=cq?"= "+(q/cq)+" carton"+(q/cq>1?"s":"")+" of "+cq+" packs":"= "+q+" loose pack"+(q===1?"":"s")+" (cartons hold "+cq+")");
}
function addLine(pid,qty,unit){
  fillProdList();
  var p=pid?S.products.filter(function(x){return x.id===pid})[0]:null;
  var d=document.createElement("div");d.className="row oline";
  d.innerHTML='<div><label>Product (type to search)</label><input class="lp" list="odl" autocomplete="off" placeholder="Start typing a name or SKU" value="'+(p?esc(prodLabel(p)):"")+'"></div><div><label>Quantity</label><input class="lq" type="number" min="1" inputmode="numeric" value="'+(qty||1)+'"></div><div class="luw hide"><label>Counted in</label><select class="lun"><option value="carton">Cartons</option><option value="pack">Packs</option></select></div><div><button class="btn alt sm lx">Remove</button></div><div class="lhint hint" style="flex-basis:100%;margin:-4px 0 4px"></div>';
  $("olines").appendChild(d);
  lineSync(d,unit);
  return d;
}
$("oadd").onclick=function(){var d=addLine();d.querySelector(".lp").focus()};
$("olines").addEventListener("input",function(e){   /* a product picked from the list: jump to its quantity */
  if(e.target.classList.contains("lp")){var t=e.target.value.trim().toLowerCase(),hit=S.products.some(function(p){return prodLabel(p).toLowerCase()===t});if(hit){var q=e.target.closest(".oline").querySelector(".lq");q.focus();q.select()}}
});
$("olines").addEventListener("input",function(e){var d=e.target.closest(".oline");if(d)lineSync(d)});
$("olines").addEventListener("change",function(e){var d=e.target.closest(".oline");if(!d)return;if(e.target.classList.contains("lun"))d.dataset.unitSet="1";lineSync(d)});
function readLines(){
  var out=[],bad=0;
  [].forEach.call($("olines").querySelectorAll(".oline"),function(d){
    var t=d.querySelector(".lp").value.trim(),q=+d.querySelector(".lq").value;if(!t)return;
    var pid=pidOf(t);if(!pid){bad++;d.querySelector(".lp").style.outline="2px solid var(--accent)";return}
    d.querySelector(".lp").style.outline="";
    var pr=lineProd(d),cq=pr&&pr.carton_qty>0?pr.carton_qty:0,packs=(cq&&d.querySelector(".lun").value==="carton")?q*cq:q;   /* cartons are converted to packs */
    if(packs>0)out.push({pid:pid,qty:packs});
  });
  return{items:out,bad:bad};
}

/* ---- drafts (survive a closed tab or a dead battery) and the offline outbox ---- */
function uKey(){return(ME&&ME.id)||"u"}
function lsGet(k,d){try{var v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function lsDel(k){try{localStorage.removeItem(k)}catch(e){}}
function newId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,10)}
function draftKey(){return"wms-draft:"+uKey()+":"+COID}
function outKey(){return"wms-outbox:"+uKey()}
var DRAFTED={},DTIMER=null,FLUSHING=false;
function saveDraft(){
  var L=[].map.call($("olines").querySelectorAll(".oline"),function(d){return{t:d.querySelector(".lp").value,q:d.querySelector(".lq").value,u:d.querySelector(".lun").value}});
  var d={c:$("ocu").value,p:$("oph").value,a:$("oad").value,n:$("ono").value,l:L};
  if(!d.c&&!d.p&&!d.a&&!d.n&&!L.some(function(x){return x.t}))lsDel(draftKey());else lsSet(draftKey(),d);
}
function clearDraft(){clearTimeout(DTIMER);lsDel(draftKey())}
function restoreDraft(){
  var k=draftKey();if(DRAFTED[k])return;DRAFTED[k]=1;
  var d=lsGet(k,null);if(!d)return;
  $("ocu").value=d.c||"";ocPick();$("oph").value=d.p||"";$("oad").value=d.a||"";$("ono").value=d.n||"";
  (d.l||[]).forEach(function(x){var r=addLine();r.querySelector(".lp").value=x.t||"";r.querySelector(".lq").value=x.q||1;lineSync(r,x.u||null)});
  if(d.c||(d.l||[]).length)$("ocinfo").textContent="Your unfinished order was restored.";
}
$("ocreate").addEventListener("input",function(){clearTimeout(DTIMER);DTIMER=setTimeout(saveDraft,400)});
$("ocreate").addEventListener("click",function(e){if(e.target.classList.contains("lx"))setTimeout(saveDraft,0)});
function resetOrderForm(){$("ocu").value="";$("oph").value="";$("oad").value="";$("ono").value="";$("ocinfo").textContent="";OCUST=null;$("olines").innerHTML="";clearDraft()}
function queueOrder(p){var q=lsGet(outKey(),[]);q.push(p);lsSet(outKey(),q);resetOrderForm();OMSG={cls:"warn",text:"No connection. The order for "+p.customer+" is saved on this phone and will be sent automatically when you are back online."};renderOrders()}
function flushOutbox(){
  if(!ME||FLUSHING)return;var q=lsGet(outKey(),[]);if(!q.length)return;
  FLUSHING=true;var p=q[0];
  api("POST","/orders",p).then(function(){
    lsSet(outKey(),lsGet(outKey(),[]).filter(function(x){return x.client_id!==p.client_id}));FLUSHING=false;
    OMSG={cls:"ok",text:"The order for "+p.customer+" that was waiting has been sent."};load().catch(function(){});flushOutbox();
  }).catch(function(e){
    FLUSHING=false;if(!e.status||e.status===401||e.status===429)return;   /* still offline, signed out or slowed down: try again later */
    lsSet(outKey(),lsGet(outKey(),[]).filter(function(x){return x.client_id!==p.client_id}));
    alert("A saved order for "+p.customer+" could not be sent: "+e.message);flushOutbox();
  });
}
window.addEventListener("online",flushOutbox);setInterval(flushOutbox,30000);

/* ---- repeat the last order for this customer ---- */
function lastOrderFor(name){
  name=(name||"").trim().toLowerCase();if(!name)return null;var best=null;
  (S.orders||[]).forEach(function(o){if((o.customer||"").toLowerCase()===name&&o.items&&o.items.length&&o.status!=="cancelled"&&(!best||o.id>best.id))best=o});
  return best;
}
function updateRepeat(){
  var b=$("orep"),o=lastOrderFor($("ocu").value);if(!b)return;
  if(!o){b.classList.add("hide");return}
  b.classList.remove("hide");
  b.textContent="Repeat last order ("+o.items.slice(0,2).map(function(i){return qtyText(i.pid,i.qty)+" x "+pname(i.pid)}).join(", ")+(o.items.length>2?", ...":"")+")";
}
var OCUST=null;
function custByName(n){n=(n||"").trim().toLowerCase();return(S.customers||[]).filter(function(c){return c.name.toLowerCase()===n})[0]}
function ocPick(){
  var c=custByName($("ocu").value),prev=OCUST;OCUST=c?c.id:null;updateRepeat();
  if(c&&c.id!==prev){$("oph").value=c.phone||"";$("oad").value=c.address||""}
  $("ocinfo").textContent=c&&isMer()?"Saved customer. Phone and address filled in; you can change them for this order.":c?"Saved customer. "+c.orders+" earlier order"+(c.orders===1?"":"s")+(c.balance>0?"; owes KES "+money(c.balance)+(c.overdue>0?" (some overdue)":""):"")+". Phone and address filled in; you can change them for this order.":($("ocu").value.trim()?"New customer. They will be saved to the customer list when you save this request.":"");
}
$("ocu").addEventListener("input",ocPick);$("ocu").addEventListener("change",ocPick);
function money(n){return Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
$("olines").addEventListener("click",function(e){if(e.target.classList.contains("lx")){e.target.closest(".oline").remove()}});
$("osave").onclick=function(){
  var L=readLines();if(L.bad){alert("Pick each product from the list: start typing its name, then tap it.");return}
  var items=L.items,cid=newId();
  var payload={customer:$("ocu").value,customer_id:OCUST||undefined,phone:$("oph").value,address:$("oad").value,note:$("ono").value,items:items,company_id:COID,client_id:cid};
  api("POST","/orders",payload).then(function(r){
    $("ocu").value="";$("oph").value="";$("oad").value="";$("ono").value="";$("ocinfo").textContent="";OCUST=null;$("olines").innerHTML="";clearDraft();OSEL=isMer()?null:r.id;OMSG={cls:"ok",text:isMer()?"":"Request "+r.ref+" saved. Next: enter the prices and issue the proforma invoice / quotation."};if(isMer())alert("Order "+r.ref+" saved. The office will price it and send the quotation.");
    return load();
  }).catch(function(e){if(e&&!e.status){queueOrder(payload)}else fail(e)});
};
$("oq").addEventListener("input",function(){renderOrders()});$("os").addEventListener("change",function(){renderOrders()});

function renderOrders(){
  if(!$("v-orders"))return;
  var list=ordList(),m=!!isMgr(),mer=isMer(),canNew=m||mer;
  $("ocreate").classList.toggle("hide",!canNew);
  var h2=$("ocreate").querySelector("h2");if(h2)h2.textContent=mer?"Take an order":"New request";
  var lh=$("olist").parentNode.querySelector("h2");if(lh)lh.textContent=mer?"Orders I have taken":"Orders";
  $("os").classList.toggle("hide",mer);
  if(OLCO!==COID){$("olines").innerHTML="";OLCO=COID}   /* product lists belong to one company: rebuild the lines when it changes */
  fillProdList();
  if(canNew&&!$("olines").children.length&&S.products.length){restoreDraft();if(!$("olines").children.length)addLine()}
  updateRepeat();
  var pend=lsGet(outKey(),[]).length;$("oqueue").innerHTML=pend?'<div class="result warn">'+pend+" order"+(pend===1?"":"s")+' waiting to be sent (no connection). They send by themselves when the signal returns. <button class="btn sm alt" id="oretry">Try now</button></div>':"";
  var t=$("oq").value.trim().toLowerCase(),sf=$("os").value;
  var rows=list.filter(function(o){
    if(sf&&o.status!==sf)return false;
    return !t||[o.ref,o.customer,o.phone,o.lpo_no,o.quote_no,o.inv_no,o.rider,o.receiver_name].join(" ").toLowerCase().indexOf(t)>-1;
  }).map(function(o){
    var sum=o.items.map(function(i){return pname(i.pid)+" \u00d7 "+qtyText(i.pid,i.qty)}).join(", ");if(sum.length>70)sum=sum.slice(0,70)+"...";
    return'<tr class="'+(o.id===OSEL?"sel":"")+'"><td><b>'+o.ref+'</b></td><td>'+esc(o.customer)+'</td><td>'+esc(sum)+'</td><td><span class="tag '+(o.status==="delivered"?"in_stock":o.status==="cancelled"?"dispatched":"printed")+'">'+stLabel(o.status)+'</span></td>'+(mer?'':'<td>'+(typeof payTag==="function"&&o.pay_status?payTag(o):"")+'</td>')+'<td>'+fmt(mer?o.created:o.updated)+'</td><td><button class="btn sm alt" data-open="'+o.id+'">Open</button></td></tr>';
  });
  $("olist").innerHTML=mer?table(["Order","Customer","Items","Status","Taken"],rows,"You have not taken any orders yet."):table(["Order","Customer","Items","Stage","Payment","Updated",""],rows,"No orders yet.");
  $("custlist").innerHTML=(S.customers||[]).map(function(c){return'<option value="'+esc(c.name)+'">'+esc(c.phone||"")+'</option>'}).join("");
  var ready=list.filter(function(o){return o.status==="invoiced"}),cur=$("ord").value;
  $("ord").innerHTML='<option value="">No order (stock not on an order)</option>'+ready.map(function(o){return'<option value="'+o.id+'">'+o.ref+" \u00b7 "+esc(o.customer)+" ("+out(o)+" of "+o.codes.length+" scanned)</option>"}).join('');
  $("ord").value=cur;
  var o=mer?null:ordById(OSEL);$("odetail").innerHTML=o?detail(o):"";
}
var _renderBase=render;render=function(){_renderBase();renderOrders()};
$("orep").onclick=function(){var o=lastOrderFor($("ocu").value);if(!o)return;$("olines").innerHTML="";o.items.forEach(function(i){var p=S.products.filter(function(x){return x.id===i.pid})[0],cq=p&&p.carton_qty>0?p.carton_qty:0;if(cq&&i.qty>=cq&&i.qty%cq===0)addLine(i.pid,i.qty/cq,"carton");else addLine(i.pid,i.qty,"pack")});saveDraft()};
$("oqueue").addEventListener("click",function(e){if(e.target.id==="oretry")flushOutbox()});
$("olist").addEventListener("click",function(e){var id=e.target.dataset.open;if(id){OSEL=+id;OMSG=null;renderOrders();if($("odetail").scrollIntoView)$("odetail").scrollIntoView({behavior:"smooth"})}});

function fld(label,f,ph,type,val){return'<div><label>'+label+'</label><input data-f="'+f+'" placeholder="'+(ph||"")+'"'+(type?' type="'+type+'"':'')+(type==="number"?' step="any" min="0"':'')+(val!=null&&val!==""?' value="'+esc(val)+'"':'')+'></div>'}
function qtyText(pid,q){var p=S.products.filter(function(x){return x.id===pid})[0],cq=p&&p.carton_qty>0?p.carton_qty:0;if(!cq)return String(q);return q.toLocaleString()+" packs"+(q>=cq&&q%cq===0?" ("+(q/cq)+" carton"+(q/cq>1?"s":"")+")":"")}
function itemVat(i){if(i.vat===0)return false;if(i.vat===1)return true;var p=S.products.filter(function(x){return x.id===i.pid})[0];return!(p&&p.vat===0)}
function priceFields(o){return o.items.map(function(i){var pp=S.products.filter(function(x){return x.id===i.pid})[0];return fld((pp&&pp.carton_qty>0?"Price per pack":"Price each")+" (KES, before VAT): "+esc(pname(i.pid))+" ("+qtyText(i.pid,i.qty)+")"+(itemVat(i)?"":" [NO VAT]"),"price_"+i.pid,"0.00","number",i.price||"")}).join('')
  +'<div><label>Charge VAT on this order?</label><select data-f="vat_on"><option value="yes"'+(o.vat_rate===0?"":" selected")+'>Yes: on goods marked VAT</option><option value="no"'+(o.vat_rate===0?" selected":"")+'>No VAT on this order</option></select></div>'+fld("VAT rate % (when charged)","vat_rate","","number",o.vat_rate>0?o.vat_rate:cur().vat)+fld("Days the customer has to pay","terms_days","","number",o.terms_days!=null?o.terms_days:(cur().termsDays!=null?cur().termsDays:30))}
function btn(act,label,alt){return'<button class="btn'+(alt?' alt':'')+'" data-act="'+act+'">'+label+'</button> '}
function whatNext(o){
  var s=o.status,m=isMgr();
  if(!m)return s==="dispatched"?"The goods are out. When the receiver gives the rider the delivery code, type it in below to finish.":"";
  var t={request:"Enter the price of each item and issue the quotation. A proforma invoice PDF is made for you to print or send.",
   quoted:"Print the proforma below and send it to the customer. When they agree, record their LPO number or who gave the go-ahead.",
   ordered:"There is not enough stock. Order or make the goods, or scan in stock you already have and press check again.",
   sourcing:"Waiting for the goods. When they arrive in Nairobi, press Goods arrived.",
   in_nairobi:"Print item labels (Labels screen), then scan the goods in (Scan screen, Receive new stock). Then set the stock aside for this order.",
   barcoded:"Check the prices and payment days, then issue the invoice and delivery note.",
   invoiced:"Print the delivery note for the driver. Then scan every item out (Scan screen, Send out, choose this order). Fill in the receiver and driver and press Send out. Record payments below as they arrive.",
   dispatched:"The goods are out. When the receiver gives the rider the delivery code, type it in to finish. Record payments below as they arrive.",
   delivered:o.balance>0.004?"Delivered. Record payments below as they arrive.":"Delivered and paid in full. Nothing more to do.",
   cancelled:"This order was cancelled."}[s];
  return t?'<div class="hint" style="margin:10px 0"><div><h3>What to do next</h3>'+esc(t)+'</div></div>':"";
}
function nextStep(o){
  var s=o.status,h="";
  if(!isMgr()){
    if(s==="dispatched")return'<p>Type the delivery code the receiver gives you at hand-over (they got it by SMS).</p><div class="row">'+fld("Delivery code","otp","6 digits")+'</div>'+btn("deliver","Confirm delivery");
    return"";
  }
  var needPrices=o.items.some(function(i){return!(i.price>0)});
  if(s==="request")h='<p>Enter the price of each item. Then the proforma invoice / quotation can be printed.</p><div class="row">'+priceFields(o)+fld("Quote is valid for (days)","valid_days","","number",14)+fld("Quotation no. (blank = automatic)","quote_no","QT-...")+'</div>'+btn("quote","Issue quotation");
  else if(s==="quoted"){
    h='<p>The customer has agreed. Record how they confirmed the order.</p><div class="row"><div><label>How did they confirm?</label><select data-f="auth_type"><option value="LPO">LPO (purchase order) number</option><option value="Verbal">They told us (verbal)</option><option value="Email">Email</option></select></div>'+fld("LPO number (blank = automatic)","lpo_no","Automatic")+fld("Name of person (if not an LPO)","authorized_by","")+'</div>'+btn("confirm","Confirm order and check stock");
    if(needPrices)h='<p><b>No prices are saved on this order yet.</b> Enter them so the proforma can be printed.</p><div class="row">'+priceFields(o)+'</div>'+btn("prices","Save prices")+'<hr style="border:0;border-top:1px solid var(--line);margin:14px 0">'+h;
  }
  else if(s==="ordered")h='<p>Stock is short, so the goods must be ordered or made. Already have stock? Scan it in, then check again.</p>'+btn("source","Start ordering / making the goods")+btn("allocate","Check stock again",1);
  else if(s==="sourcing")h='<div class="row">'+fld("Supplier or delivery note ref (optional)","supplier_ref","")+'</div>'+btn("arrived","Goods arrived in Nairobi");
  else if(s==="in_nairobi")h='<p>Print labels (Labels screen) and scan the goods in (Scan screen, Receive new stock). Then set the stock aside for this order.</p>'+btn("allocate","Set stock aside for this order");
  else if(s==="barcoded")h='<p>Check the prices (before VAT) and how many days the customer has to pay. The invoice and delivery note are then made.</p><div class="row">'+priceFields(o)+fld("Invoice no. (blank = automatic)","inv_no","automatic")+'</div>'+btn("invoice","Issue invoice and delivery note");
  else if(s==="invoiced")h='<p>Scan every item out: <b>Scan screen, Send out, choose this order</b>. Scanned out so far: <b>'+out(o)+' of '+o.codes.length+'</b>.</p><div class="row">'+fld("Receiver name","receiver_name")+fld("Receiver phone (gets the delivery code)","receiver_phone","07...")+fld("Rider / driver","rider")+fld("Rider phone","rider_phone")+fld("Who allowed the rider to take the goods","rider_auth_by")+fld("Vehicle registration","vehicle")+fld("Carrier / route","carrier")+'</div>'+btn("dispatch","Send out and make delivery code");
  else if(s==="dispatched")h='<p>Type the delivery code the receiver gives you at hand-over (they got it by SMS).</p><div class="row">'+fld("Delivery code","otp","6 digits")+'</div>'+btn("deliver","Confirm delivery")+btn("newotp","Send a new code",1)+'<div class="row" style="margin-top:12px">'+fld("Reason for finishing without the code","reason","e.g. receiver phone off, confirmed by call")+'</div>'+btn("override","Mark delivered without the code",1);
  if(["request","quoted","ordered","sourcing","in_nairobi","barcoded","invoiced"].indexOf(s)>-1)h+='<div class="row" style="margin-top:14px">'+fld("Reason for cancelling","reason")+'</div>'+btn("cancel","Cancel order",1);
  return h;
}
function docsBox(o){
  var b="";
  if(isMgr()&&o.quote_no&&o.items.some(function(i){return i.price>0}))b+='<button class="btn alt" data-doc="proforma-pdf">Print proforma / quotation (PDF)</button> ';
  if(o.dn_no&&o.status!=="cancelled")b+='<button class="btn alt" data-doc="delivery-note-pdf">Print delivery note (PDF)</button> ';
  return b?'<div style="margin:10px 0"><p style="margin:0 0 6px"><b>Documents to print</b></p>'+b+'</div>':"";
}
function detail(o){
  var cur=stIdx(o.status),can=o.status==="cancelled";
  var steps=STAGES.map(function(s,i){
    var cls=can?"":(i<cur?"done":i===cur?"cur":""),skip=(s[0]==="sourcing"||s[0]==="in_nairobi")&&cur>=stIdx("barcoded")&&!o.events.some(function(e){return/Ordering \/ manufacturing started/.test(e.text)});
    return'<span class="stp '+cls+(skip?" skip":"")+'">'+s[1]+'</span>';
  }).join('')+(can?'<span class="stp" style="background:var(--badbg);color:var(--bad)">Cancelled</span>':'');
  var kv=[["Customer",o.customer+(o.phone?" \u00b7 "+o.phone:"")],["Quotation",o.quote_no?o.quote_no+(o.quote_amount?" ("+o.quote_amount+")":""):""],["Authorisation",o.auth_type?(o.auth_type==="LPO"?"LPO "+o.lpo_no:o.auth_type+": "+o.authorized_by):""],["Invoice / delivery note",o.inv_no?o.inv_no+" / "+o.dn_no:""],
    ["Receiver",o.receiver_name?o.receiver_name+" \u00b7 "+o.receiver_phone:""],["Rider / driver",o.rider?o.rider+(o.rider_phone?" \u00b7 "+o.rider_phone:"")+(o.vehicle?" \u00b7 "+o.vehicle:""):""],["Rider authorised by",o.rider_auth_by||""],["Carrier / route",o.carrier||""],["Note",o.note||""]]
    .filter(function(p){return p[1]}).map(function(p){return'<div><span>'+p[0]+'</span>'+esc(p[1])+'</div>'}).join('');
  var items=table(isMgr()?["Product","Ordered","Set aside","Free stock now","Price each (KES)"]:["Product","Ordered","Set aside","Free stock now"],o.items.map(function(i){return'<tr><td>'+esc(pname(i.pid))+'</td><td>'+qtyText(i.pid,i.qty)+'</td><td>'+i.alloc.toLocaleString()+'</td><td>'+i.free.toLocaleString()+'</td>'+(isMgr()?'<td>'+(i.price?money(i.price):"-")+'</td>':'')+'</tr>'}),"")
    +(isMgr()&&o.total>0?'<p style="text-align:right;margin:6px 0">'+(o.vat_rate===0?'No VAT on this order &middot; ':o.exempt>0.004?(o.taxable>0.004?'Subtotal KES '+money(o.subtotal)+' &middot; VAT ('+o.vat_rate+'% on KES '+money(o.taxable)+') KES '+money(o.vat_amount)+' &middot; ':'No VAT charged &middot; '):'VAT ('+o.vat_rate+'%) KES '+money(o.vat_amount)+' &middot; ')+'Total: <b>KES '+money(o.total)+'</b></p>':'');
  var chips=o.codes.length?'<div class="chips">'+o.codes.map(function(c){return'<span class="chip '+c.status+'">'+c.code+'</span>'}).join('')+'</div>':'<div class="empty">No stock set aside yet.</div>';
  var tl=o.events.slice().reverse().map(function(e){return'<li><b>'+fmt(e.at)+'</b> \u00b7 '+esc(e.by)+': '+esc(e.text)+'</li>'}).join('');
  /* The delivery code goes to the RECEIVER by SMS and is not shown here (the rider must not see it). The receiver reads it out at hand-over. */
  var L=LASTOTP[o.id],otp=L&&o.status==="dispatched"?(L.smsSent
    ?'<div class="otpbox" style="border-style:solid"><b style="font:700 15px Barlow,sans-serif;letter-spacing:0">Delivery code sent</b><br>A one-time code was sent by SMS to the receiver ('+esc(L.smsTo||o.receiver_phone)+'). Ask the receiver for it when the goods are handed over, then enter it below. '+(L.otp?'<br>Test mode: <b>'+L.otp+'</b><br>':'')+'<button class="btn sm alt" data-dismiss="1">Hide</button></div>'
    :'<div class="otpbox"><b style="font:700 15px Barlow,sans-serif;letter-spacing:0">The SMS did not go through</b><br>'+(L.smsConfigured?'The code could not be sent to '+esc(L.smsTo||o.receiver_phone)+(L.smsError?' ('+esc(L.smsError)+')':'')+'. Check the phone number, then press <b>Send a new code</b> below.':'SMS is not set up on the server, so the code cannot reach the receiver. Ask the administrator to set it up, or a manager can override with a reason.')+(L.otp?'<br>Test mode: <b>'+L.otp+'</b><br>':'')+' <button class="btn sm alt" data-dismiss="1">Hide</button></div>'):'';
  var msg=OMSG?'<div class="result '+OMSG.cls+'">'+esc(OMSG.text)+'</div>':'';
  var ns=nextStep(o);
  return'<div class="panel" id="oform"><h2>'+o.ref+' \u00b7 '+esc(o.customer)+'</h2><div class="stepper">'+steps+'</div>'+msg+otp+'<div class="kv">'+kv+'</div>'+whatNext(o)+items+docsBox(o)+(o.inv_no?invBox(o):'')+(o.inv_no&&typeof payBox==="function"?payBox(o):'')+'<p style="margin-bottom:4px"><b>Items set aside (barcodes)</b></p>'+chips
    +(ns?'<h2 style="margin-top:16px">Next step</h2>'+ns:'')+'<h2 style="margin-top:16px">History</h2><ul class="tl">'+tl+'</ul></div>';
}
/* Invoice download: the person names who authorises it, a one-time code goes to the company email,
   and the PDF is only produced by the server once that code is entered. */
function invBox(o){
  var v=INV[o.id]||{},h='<div class="otpbox" style="background:var(--bg);border-style:solid"><b style="font:700 15px Barlow,sans-serif;letter-spacing:0">Download invoice (PDF)</b>';
  if(v.msg)h+='<div class="result '+v.msg.cls+'" style="margin:8px 0">'+esc(v.msg.text)+'</div>';
  if(!v.sent){
    h+='<p style="margin:6px 0">Someone must authorise this download. A code is sent to the company email and company WhatsApp; type it here to download the invoice.</p><div class="row">'
     +'<div><label>Authorised by (full name)</label><input data-i="auth" value="'+esc(v.auth||"")+'" placeholder="Person authorising the download"></div></div>'
     +'<button class="btn" data-dl="send">Send code to company</button>';
  }else{
    h+='<p style="margin:6px 0">Authorised by <b>'+esc(v.auth)+'</b>. Enter the 6-digit code from the company email.</p><div class="row">'
     +'<div><label>Code from the email</label><input data-i="otp" inputmode="numeric" maxlength="6" placeholder="6 digits" autocomplete="one-time-code"></div></div>'
     +'<button class="btn" data-dl="get">Download invoice (PDF)</button> <button class="btn alt" data-dl="resend">Send a new code</button> <button class="btn alt" data-dl="cancel">Change authoriser</button>';
  }
  return'<div style="margin:10px 0">'+h+'</div></div>';
}
function invVal(k){var el=$("odetail").querySelector('[data-i="'+k+'"]');return el?el.value.trim():""}
function invAct(o,what,btn){
  var v=INV[o.id]=INV[o.id]||{};
  if(what==="cancel"){v.sent=false;v.msg=null;renderOrders();return}
  if(what==="send"||what==="resend"){
    var who=what==="send"?invVal("auth"):v.auth;v.auth=who;
    if(who.length<3){v.msg={cls:"bad",text:"Enter the name of the person authorising this download."};renderOrders();return}
    btn.disabled=true;
    api("POST","/orders/"+o.id+"/invoice-otp",{authorized_by:who}).then(function(r){
      var ch=r.channels||{},ok=[];if(ch.email&&ch.email.ok)ok.push("email "+ch.email.to);if(ch.whatsapp&&ch.whatsapp.ok)ok.push("WhatsApp "+ch.whatsapp.to);
      var miss=(ch.email&&!ch.email.ok?"email":"")+(ch.email&&!ch.email.ok&&ch.whatsapp&&!ch.whatsapp.ok?" and ":"")+(ch.whatsapp&&!ch.whatsapp.ok?"WhatsApp":"");
      v.sent=true;v.msg=r.sent?{cls:ok.length>1?"ok":"warn",text:"Code sent to "+ok.join(" and ")+". It works once and expires in "+r.minutes+" minutes."+(miss?" ("+miss+" did not go through; ask the administrator to check it.)":"")}
        :{cls:"bad",text:"The code could not be sent by email or WhatsApp. Ask the administrator to check the notification settings on the server, then try again."};
      return load();
    }).catch(function(err){v.msg={cls:"bad",text:err.message};btn.disabled=false;if(err.status===401)fail(err);else renderOrders()});
    return;
  }
  var otp=invVal("otp");if(!/^\d{6}$/.test(otp)){v.msg={cls:"bad",text:"Enter the 6-digit code."};renderOrders();return}
  btn.disabled=true;
  fetch("/api/orders/"+o.id+"/invoice-pdf",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+DSTOKEN},body:JSON.stringify({otp:otp})}).then(function(r){
    if(!r.ok)return r.json().catch(function(){return{}}).then(function(j){var e=new Error(j.error||"Download failed");e.status=r.status;throw e});
    return r.blob();
  }).then(function(blob){
    var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=(cur().short||"Invoice")+"-"+o.inv_no+".pdf";document.body.appendChild(a);a.click();
    setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1500);
    INV[o.id]={msg:{cls:"ok",text:"Invoice downloaded. The authorisation was recorded in the order history."}};return load();
  }).catch(function(err){
    if(err.status===401){fail(err);return}
    v.msg={cls:"bad",text:err.message};
    if(/expired|Too many|Request a code/.test(err.message))v.sent=false;
    renderOrders();
  });
}
$("odetail").addEventListener("click",function(e){
  if(e.target.dataset.doc){var od0=ordById(OSEL);if(!od0)return;var bt=e.target;bt.disabled=true;
    dlPdf("/orders/"+od0.id+"/"+bt.dataset.doc,{}).then(function(){return load()}).catch(function(err){OMSG={cls:"bad",text:err.message};if(err.status===401)fail(err);else renderOrders()}).then(function(){bt.disabled=false});return}
  if(e.target.dataset.dl){var od=ordById(OSEL);if(od)invAct(od,e.target.dataset.dl,e.target);return}
  if(e.target.dataset.dismiss){delete LASTOTP[OSEL];renderOrders();return}
  var act=e.target.dataset.act;if(!act)return;
  var o=ordById(OSEL);if(!o)return;
  var body={};[].forEach.call($("oform").querySelectorAll("[data-f]"),function(i){body[i.dataset.f]=i.value});
  e.target.disabled=true;
  api("POST","/orders/"+o.id+"/"+act,body).then(function(r){
    OMSG=null;
    if(act==="confirm")OMSG=r.allocated?{cls:"ok",text:"Stock is available: the stock has been set aside. Next: issue the invoice and delivery note."}:{cls:"warn",text:(r.msg||"Stock is short.")+" Next: order or make the goods."};
    if(act==="dispatch"||act==="newotp"){LASTOTP[o.id]={otp:r.otp,smsSent:r.smsSent,smsTo:r.smsTo,smsConfigured:r.smsConfigured,smsError:r.smsError};OMSG=r.smsSent?{cls:"ok",text:(act==="dispatch"?"Sent out. ":"")+"The delivery code was sent by SMS to the receiver ("+r.smsTo+")."}:{cls:"warn",text:(act==="dispatch"?"Sent out, but t":"T")+"he delivery code could not be sent by SMS. See the note below."}}
    if(act==="quote")OMSG={cls:"ok",text:"Quotation issued. Press Print proforma / quotation below to get the PDF."};
    if(act==="invoice")OMSG={cls:"ok",text:"Invoice and delivery note issued. Print the delivery note for the driver."};
    if(act==="deliver")OMSG={cls:"ok",text:"Delivery confirmed. Order complete."};
    return load();
  }).catch(function(err){OMSG={cls:"bad",text:err.message};e.target.disabled=false;if(err.status===401)fail(err);else renderOrders()});
});
renderOrders();
