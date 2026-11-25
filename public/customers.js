/* Customers: a saved list per company. New orders fill in name, phone and address from it; each customer shows their order
   history, what they owe, and a printable statement. Loaded after client.js. */
ROLES.admin.push("customers");ROLES.manager.push("customers");views.push("customers");
var CSEL=null,CHIST={},CMSG=null;

(function(){
  var sec=document.createElement("section");sec.id="v-customers";sec.className="hide";
  sec.innerHTML='<div class="panel"><h2>Customers</h2><div class="bar"><input id="custq" placeholder="Search by name, phone or address"><button class="btn sm" id="cnew">Add a customer</button></div><div class="tablewrap" id="clist"></div></div>'
   +'<div class="panel hide" id="cadd"><h2>Add a customer</h2><div class="row"><div><label>Name</label><input data-n="name"></div><div><label>Phone</label><input data-n="phone" placeholder="07..."></div><div><label>Email (optional)</label><input data-n="email"></div><div><label>Delivery address</label><input data-n="address"></div><div><label>KRA PIN (optional)</label><input data-n="kra_pin"></div></div><div class="tabs"><button class="btn" id="csave">Save customer</button><button class="btn alt" id="ccancel">Cancel</button></div><div id="cadderr" style="color:var(--bad);margin-top:6px"></div></div>'
   +'<div id="cdetail"></div>';
  $("v-users").parentNode.appendChild(sec);
})();

function renderCustomers(){
  if(!$("v-customers"))return;
  var q=$("custq").value.trim().toLowerCase(),list=(S.customers||[]).filter(function(c){return!q||[c.name,c.phone,c.address,c.email,c.acc_no].join(" ").toLowerCase().indexOf(q)>-1});
  $("clist").innerHTML=table(["Customer","Phone","Orders","Owes us (KES)","Overdue (KES)",""],list.map(function(c){
    return'<tr'+(c.id===CSEL?' class="sel"':'')+'><td>'+esc(c.name)+'<div class="empty" style="font-size:12px">'+esc(c.acc_no)+'</div></td><td>'+esc(c.phone||"")+'</td><td>'+c.orders+'</td><td class="money">'+(c.balance>0?money(c.balance):"-")+'</td><td class="money'+(c.overdue>0?' neg':'')+'">'+(c.overdue>0?money(c.overdue):"-")+'</td><td><button class="btn sm alt" data-copen="'+c.id+'">Open</button></td></tr>'}),
    (S.customers||[]).length?"No customer matches your search.":"No customers yet. They are saved automatically when you save an order, or press Add a customer.");
  var c=(S.customers||[]).filter(function(x){return x.id===CSEL})[0];
  if(!c){$("cdetail").innerHTML="";return}
  var h=CHIST[c.id],f=function(n,l,v){return'<div><label>'+l+'</label><input data-e="'+n+'" value="'+esc(v||"")+'"></div>'};
  var orders=h?table(["Order","Date","Items","Stage","Invoice","Total (KES)","Paid (KES)","Owing (KES)","Payment",""],h.orders.map(function(o){
    return'<tr><td>'+esc(o.ref)+'</td><td>'+fdate(o.created)+'</td><td style="white-space:normal;max-width:240px">'+esc(o.items)+'</td><td>'+esc(stLabel(o.status))+'</td><td>'+esc(o.inv_no||"-")+'</td><td class="money">'+(o.inv_no?money(o.total):"-")+'</td><td class="money">'+(o.inv_no?money(o.paid):"-")+'</td><td class="money">'+(o.balance>0.004?money(o.balance):"-")+'</td><td>'+(o.pay_status?payTag(o):"")+'</td><td><button class="btn sm alt" data-cord="'+o.id+'">Open</button></td></tr>'}),"No orders yet."):'<div class="empty">Loading order history...</div>';
  $("cdetail").innerHTML='<div class="panel"><h2>'+esc(c.name)+'</h2>'+(CMSG?'<div class="result '+CMSG.cls+'">'+esc(CMSG.text)+'</div>':'')
   +'<div class="tiles"><div class="tile"><b>'+c.orders+'</b><span>Orders</span></div><div class="tile"><b>KES '+money(c.billed)+'</b><span>Invoiced in total</span></div><div class="tile ok"><b>KES '+money(c.paid)+'</b><span>Paid</span></div><div class="tile '+(c.overdue>0?'bad':c.balance>0?'warn':'')+'"><b>KES '+money(c.balance)+'</b><span>Owes us'+(c.overdue>0?' (KES '+money(c.overdue)+' overdue)':'')+'</span></div></div>'
   +'<div class="tabs" style="margin-top:12px"><button class="btn" data-cneworder>New order for this customer</button></div>'
   +'<h3 style="margin:18px 0 6px;font:700 18px \'Barlow Condensed\',sans-serif">Statement of account</h3><p class="empty" style="margin:0 0 6px">Shows every invoice and payment with a running balance and how late unpaid invoices are. Leave the dates empty for everything.</p>'
   +'<div class="row"><div><label>From (optional)</label><input type="date" data-s="from"></div><div><label>To (optional)</label><input type="date" data-s="to"></div></div><div class="tabs"><button class="btn alt" data-cstmt>Print statement (PDF)</button></div>'
   +'<h3 style="margin:18px 0 6px;font:700 18px \'Barlow Condensed\',sans-serif">Customer details</h3><div class="row">'+f("name","Name",c.name)+f("phone","Phone",c.phone)+f("email","Email",c.email)+f("address","Delivery address",c.address)+f("kra_pin","KRA PIN",c.kra_pin)+f("notes","Notes",c.notes)+'</div><div class="tabs"><button class="btn alt" data-csave>Save changes</button></div>'
   +'<h3 style="margin:18px 0 6px;font:700 18px \'Barlow Condensed\',sans-serif">Order history</h3><div class="tablewrap">'+orders+'</div></div>';
}
function loadHist(id){api("GET","/customers/"+id+"/history").then(function(r){CHIST[id]=r;if(CSEL===id)renderCustomers()}).catch(function(e){if(e.status===401)fail(e)})}

$("custq").addEventListener("input",renderCustomers);
$("cnew").onclick=function(){$("cadd").classList.toggle("hide");$("cadderr").textContent=""};
$("ccancel").onclick=function(){$("cadd").classList.add("hide")};
$("csave").onclick=function(){
  var b={company_id:COID};[].forEach.call($("cadd").querySelectorAll("[data-n]"),function(i){b[i.dataset.n]=i.value});
  api("POST","/customers",b).then(function(r){[].forEach.call($("cadd").querySelectorAll("[data-n]"),function(i){i.value=""});$("cadd").classList.add("hide");CSEL=r.id;delete CHIST[r.id];CMSG={cls:"ok",text:"Customer saved."};return load().then(function(){loadHist(r.id)})}).catch(function(e){if(e.status===401)fail(e);else $("cadderr").textContent=e.message});
};
$("v-customers").addEventListener("click",function(e){
  var t=e.target,d=t.dataset,c=(S.customers||[]).filter(function(x){return x.id===CSEL})[0];
  if(d.copen){CSEL=+d.copen;CMSG=null;delete CHIST[CSEL];renderCustomers();loadHist(CSEL);$("cdetail").scrollIntoView({behavior:"smooth",block:"start"})}
  else if(d.cord){OSEL=+d.cord;show("orders")}
  else if(d.cneworder!==undefined&&c){show("orders");$("ocu").value=c.name;ocPick();$("ocreate").scrollIntoView({behavior:"smooth"})}
  else if(d.cstmt!==undefined&&c){
    var b={};[].forEach.call($("cdetail").querySelectorAll("[data-s]"),function(i){if(i.value)b[i.dataset.s]=i.value});
    t.disabled=true;dlPdf("/customers/"+c.id+"/statement-pdf",b).then(function(){CMSG={cls:"ok",text:"Statement downloaded."}}).catch(function(err){if(err.status===401)fail(err);else CMSG={cls:"bad",text:err.message}}).then(function(){renderCustomers()});
  }
  else if(d.csave!==undefined&&c){
    var u={};[].forEach.call($("cdetail").querySelectorAll("[data-e]"),function(i){u[i.dataset.e]=i.value});
    api("PATCH","/customers/"+c.id,u).then(function(){CMSG={cls:"ok",text:"Changes saved. Orders already made keep the details they were made with."};return load()}).then(function(){loadHist(c.id)}).catch(function(err){if(err.status===401)fail(err);else{CMSG={cls:"bad",text:err.message};renderCustomers()}});
  }
});
var _renderCust=render;render=function(){_renderCust();renderCustomers()};
