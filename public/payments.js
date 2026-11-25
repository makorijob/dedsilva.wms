/* Payments: money received against invoices. Each invoice is Unpaid, Part-paid, Paid or Overdue (balance left after the due date).
   Loaded after client.js. payBox(o) is also shown inside each order on the Orders screen. */
ROLES.admin.push("payments");ROLES.manager.push("payments");views.push("payments");
var PSEL=null,PMSG={};

(function(){
  var sec=document.createElement("section");sec.id="v-payments";sec.className="hide";
  sec.innerHTML='<div class="panel"><h2>Money owed to us</h2><div class="tiles" id="ptiles"></div></div>'
   +'<div class="panel"><h2>Invoices</h2><div class="bar"><input id="payq" placeholder="Search invoice, customer or order"><select id="pfs"><option value="open">Not fully paid</option><option value="overdue">Overdue only</option><option value="part">Part-paid</option><option value="unpaid">Not paid, not yet due</option><option value="paid">Paid in full</option><option value="all">All invoices</option></select><button class="btn sm alt" id="pcsv">Download list (CSV)</button></div><div class="tablewrap" id="paylist"></div></div>'
   +'<div id="pdetail"></div>'
   +'<div class="panel"><h2>Latest payments received</h2><div class="tablewrap" id="prec"></div></div>';
  $("v-users").parentNode.appendChild(sec);
  $("payq").addEventListener("input",renderPayments);$("pfs").addEventListener("change",renderPayments);
})();

function fdate(t){return t?new Date(t).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"}):"-"}
function payTag(o){
  var m={paid:["paid","Paid"],part:["part","Part-paid"],unpaid:["unpaid","Not paid"],overdue:["overdue","Overdue"+(o.days_overdue?" "+o.days_overdue+" d":"")]}[o.pay_status];
  return m?'<span class="tag '+m[0]+'">'+m[1]+'</span>'+(o.pay_status==="overdue"&&o.paid>0?' <span class="empty" style="font-size:12px">(part-paid)</span>':''):"";
}
function invoices(){return ordList().filter(function(o){return o.inv_no&&o.status!=="cancelled"&&o.pay_status})}

/* the payment panel for one invoice */
function payBox(o){
  if(!isMgr()||!o.inv_no||o.status==="cancelled"||!o.pay_status)return"";
  var today=new Date(Date.now()+3*3600e3).toISOString().slice(0,10),msg=PMSG[o.id];
  var rows=(o.payments||[]).map(function(p){
    return'<tr'+(p.voided?' style="opacity:.55;text-decoration:line-through"':'')+'><td>'+fdate(p.paid_at)+'</td><td class="money">'+money(p.amount)+'</td><td>'+esc(p.method)+'</td><td>'+esc(p.ref||"")+'</td><td>'+esc(p.received_by||"")+(p.note?' <span class="empty">'+esc(p.note)+'</span>':'')+'</td><td style="text-decoration:none">'
     +(p.voided?'<span class="empty" style="text-decoration:none">Cancelled: '+esc(p.void_reason||"")+'</span>':'<button class="btn sm alt" data-payvoid="'+p.id+'">Cancel</button>')+'</td></tr>'}).join("");
  var form=o.balance>0.004?'<div class="row" style="margin-top:10px"><div><label>Amount received (KES)</label><input data-pf="amount" type="number" step="0.01" min="0" value="'+o.balance+'"></div>'
    +'<div><label>How was it paid?</label><select data-pf="method"><option>M-Pesa</option><option>Bank transfer</option><option>Cash</option><option>Cheque</option><option>Other</option></select></div>'
    +'<div><label>M-Pesa code, bank reference or cheque no.</label><input data-pf="ref" autocomplete="off" placeholder="e.g. SJK29X1QWE"></div>'
    +'<div><label>Date received</label><input data-pf="date" type="date" max="'+today+'" value="'+today+'"></div>'
    +'<div><label>Note (optional)</label><input data-pf="note"></div></div><div class="tabs"><button class="btn" data-payadd>Record payment</button><button class="btn alt" data-payfull>Fill in the full balance</button></div>':'<p style="margin:10px 0 0"><b>This invoice is paid in full.</b></p>';
  return'<div data-paybox="'+o.id+'" style="border:1px solid var(--line);border-radius:6px;padding:12px;margin:14px 0 0"><p style="margin:0 0 8px"><b>Payments for '+esc(o.inv_no)+'</b> '+payTag(o)+'</p>'
   +'<div class="kv"><div><span>Invoice total (with VAT)</span><b>KES '+money(o.total)+'</b></div><div><span>Paid so far</span><b>KES '+money(o.paid)+'</b></div><div><span>Still owing</span><b'+(o.pay_status==="overdue"?' class="neg"':'')+'>KES '+money(o.balance)+'</b></div><div><span>Payment due</span><b>'+fdate(o.due_at)+'</b></div></div>'
   +(msg?'<div class="result '+msg.cls+'" style="margin:8px 0">'+esc(msg.text)+'</div>':'')+'<div data-pmsg></div>'
   +(rows?'<div class="tablewrap">'+table(["Date","Amount (KES)","How","Reference","Received by",""],[rows],"")+'</div>':'<p class="empty" style="margin:0">No payments recorded yet.</p>')+form+'</div>';
}
document.addEventListener("click",function(e){
  var t=e.target,box=t.closest?t.closest("[data-paybox]"):null;if(!box)return;
  var o=ordById(+box.dataset.paybox);if(!o)return;
  function q(n){var i=box.querySelector('[data-pf="'+n+'"]');return i?i.value:""}
  function say(cls,text){var m=box.querySelector("[data-pmsg]");if(m)m.innerHTML='<div class="result '+cls+'" style="margin:8px 0">'+esc(text)+'</div>'}
  if(t.hasAttribute("data-payfull")){box.querySelector('[data-pf="amount"]').value=o.balance;return}
  if(t.hasAttribute("data-payadd")){
    var amt=parseFloat(q("amount"));if(!(amt>0)){say("bad","Enter the amount received.");return}
    var send=function(dup){
      t.disabled=true;
      return api("POST","/payments",{order_id:o.id,amount:amt,method:q("method"),ref:q("ref"),paid_on:q("date"),note:q("note"),confirm_duplicate:dup||undefined}).then(function(r){
        PMSG[o.id]={cls:"ok",text:"Payment recorded. "+(r.balance<=0.004?"This invoice is now paid in full.":"Still owing: KES "+money(r.balance)+".")};return load();
      }).catch(function(err){
        t.disabled=false;
        if(err.status===409&&/already recorded/.test(err.message)){if(confirm(err.message+"\n\nRecord it again anyway? Only do this if one payment covers more than one invoice."))return send(true);return}
        if(err.status===401){fail(err);return}say("bad",err.message);
      });
    };
    send();return;
  }
  if(t.dataset.payvoid){
    var why=prompt("Why is this payment being cancelled? (This is kept in the record.)");if(!why)return;
    api("POST","/payments/"+t.dataset.payvoid+"/void",{reason:why}).then(function(){PMSG[o.id]={cls:"warn",text:"Payment cancelled. The balance has been put back."};return load()}).catch(function(err){if(err.status===401)fail(err);else say("bad",err.message)});
  }
});

function renderPayments(){
  if(!$("v-payments"))return;
  var all=invoices(),now=Date.now(),mstart=new Date(new Date(now+3*3600e3).toISOString().slice(0,7)+"-01T00:00:00+03:00").getTime();
  var owed=0,over=0,open=0,month=0;
  all.forEach(function(o){if(o.balance>0.004){owed+=o.balance;open++;if(o.pay_status==="overdue")over+=o.balance}(o.payments||[]).forEach(function(p){if(!p.voided&&p.paid_at>=mstart)month+=p.amount})});
  $("ptiles").innerHTML='<div class="tile"><b>KES '+money(owed)+'</b><span>Owed to us ('+open+' invoice'+(open===1?"":"s")+')</span></div><div class="tile '+(over>0?"bad":"")+'"><b>KES '+money(over)+'</b><span>of which overdue</span></div><div class="tile ok"><b>KES '+money(month)+'</b><span>Received this month</span></div>';
  var f=$("pfs").value,q=$("payq").value.trim().toLowerCase();
  var list=all.filter(function(o){
    if(f==="open"&&!(o.balance>0.004))return false;if(f!=="open"&&f!=="all"&&o.pay_status!==f)return false;
    return!q||(o.inv_no+" "+o.customer+" "+o.ref).toLowerCase().indexOf(q)>-1;
  }).sort(function(a,b){return(b.pay_status==="overdue")-(a.pay_status==="overdue")||(a.due_at||0)-(b.due_at||0)});
  $("paylist").innerHTML=table(["Invoice","Customer","Invoice date","Due","Total (KES)","Paid (KES)","Owing (KES)","Status",""],list.map(function(o){
    return'<tr'+(o.id===PSEL?' class="sel"':'')+'><td>'+esc(o.inv_no)+'</td><td>'+esc(o.customer)+'</td><td>'+fdate(o.inv_at)+'</td><td>'+fdate(o.due_at)+'</td><td class="money">'+money(o.total)+'</td><td class="money">'+money(o.paid)+'</td><td class="money">'+money(o.balance)+'</td><td>'+payTag(o)+'</td><td><button class="btn sm alt" data-popen="'+o.id+'">Payments</button></td></tr>'}),"Nothing to show here.");
  var sel=ordById(PSEL);
  $("pdetail").innerHTML=sel&&sel.pay_status?'<div class="panel"><h2>'+esc(sel.customer)+' &middot; '+esc(sel.inv_no)+'</h2><div class="tabs"><button class="btn sm alt" data-pgo="'+sel.id+'">Open the order</button><button class="btn sm alt" data-pclose>Close</button></div>'+payBox(sel)+'</div>':"";
  var recent=[];all.forEach(function(o){(o.payments||[]).forEach(function(p){if(!p.voided)recent.push({o:o,p:p})})});
  recent.sort(function(a,b){return b.p.paid_at-a.p.paid_at});
  $("prec").innerHTML=table(["Date","Customer","Invoice","Amount (KES)","How","Reference","Received by"],recent.slice(0,15).map(function(r){return'<tr><td>'+fdate(r.p.paid_at)+'</td><td>'+esc(r.o.customer)+'</td><td>'+esc(r.o.inv_no)+'</td><td class="money">'+money(r.p.amount)+'</td><td>'+esc(r.p.method)+'</td><td>'+esc(r.p.ref||"")+'</td><td>'+esc(r.p.received_by||"")+'</td></tr>'}),"No payments recorded yet.");
}
$("v-payments").addEventListener("click",function(e){
  var d=e.target.dataset;
  if(d.popen){PSEL=+d.popen;renderPayments();$("pdetail").scrollIntoView({behavior:"smooth",block:"start"})}
  if(d.pclose!==undefined){PSEL=null;renderPayments()}
  if(d.pgo){OSEL=+d.pgo;show("orders")}
});
$("pcsv").onclick=function(){
  var q=function(v){return'"'+String(v==null?"":v).replace(/"/g,'""')+'"'},rows=[["Invoice","Customer","Order","Invoice date","Due date","Total","Paid","Owing","Status"]];
  invoices().forEach(function(o){rows.push([o.inv_no,o.customer,o.ref,fdate(o.inv_at),fdate(o.due_at),o.total,o.paid,o.balance,{paid:"Paid",part:"Part-paid",unpaid:"Not paid",overdue:"Overdue"}[o.pay_status]])});
  var b=new Blob([rows.map(function(r){return r.map(q).join(",")}).join("\r\n")],{type:"text/csv"}),a=document.createElement("a");
  a.href=URL.createObjectURL(b);a.download="invoices-"+new Date().toISOString().slice(0,10)+".csv";document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1500);
};
var _renderPay=render;render=function(){_renderPay();renderPayments()};
