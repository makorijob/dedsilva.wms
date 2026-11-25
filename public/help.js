/* First-use guide: a short "What to do next" tip at the top of each screen (closed with "Got it", brought back with "? Help"),
   plus a live "To do" list on Home. Loaded last. */
var CURV="dash";
var MHINTS={orders:function(){return{t:"Taking an order",l:["Type the institution's name (saved ones fill in phone and address), then pick each product and quantity.","Type a few letters to search products. For a regular institution, <b>Repeat last order</b> fills the lines for you.","Press <b>Save request</b>. The office prices it and texts you when it is priced, dispatched and delivered. No signal? The order is saved on your phone and sent when you are back online.","Below you can see the orders you have taken and their status."]}},
  scan:function(){return{t:"Checking an item",l:["Scan an item's barcode to see which product it is.","Scanning here only looks things up. It does not change any stock.","Handheld scanner (Zebra etc.): just pull the trigger; the code is read even if the cursor is elsewhere. Turn on <b>Handheld scanner mode</b> to hide the on-screen keyboard."]}}};
var HINTS={
  dash:function(m){return m?{t:"Welcome. Here is the usual order of work",l:["<b>Products</b>: add what you sell (once).","<b>Orders</b>: save a customer's request, enter prices, print the proforma.","When the customer agrees: <b>Labels</b> (print item labels), then <b>Scan</b> to receive the goods.","Back in <b>Orders</b>: issue the invoice and delivery note, send the goods out.","<b>Payments</b>: record money as it arrives. <b>Customers</b> shows who owes what and prints statements."]}
     :{t:"Welcome. What you can do here",l:["<b>Scan</b>: scan an item to receive it, put it on a shelf, pick it or send it out.","<b>Orders</b>: see what must be sent out and enter the delivery code when the receiver gives it."]}},
  orders:function(m){return m?{t:"How an order moves along",l:["Type the customer's name (saved customers fill in phone and address) and the items. Press <b>Save request</b>.","Click <b>Open</b> on the order. The box <b>What to do next</b> always tells you the next step.","Print the proforma, then the delivery note once the invoice is issued."]}
     :{t:"What to do here",l:["Click <b>Open</b> on an order that is out for delivery.","Type the delivery code the receiver gave to the rider, then press <b>Confirm delivery</b>."]}},
  customers:function(){return{t:"About customers",l:["Customers are saved automatically when you save an order. You can also add one yourself.","Click <b>Open</b> to see their orders, what they owe and to print a statement of account.","Use <b>New order for this customer</b> to start an order without retyping their details."]}},
  payments:function(){return{t:"Recording payments",l:["Click <b>Payments</b> next to an invoice, type the amount, how it was paid and the M-Pesa code, bank reference or cheque number, then <b>Record payment</b>.","<b>Overdue</b> means the due date has passed and something is still owing. <b>Part-paid</b> means some money is in.","Typed something wrong? <b>Cancel</b> the payment and give a reason. Payments are never deleted, so the record stays honest."]}},
  scan:function(){return{t:"Scanning",l:["Choose what you are doing: receive new stock, put on a shelf, pick, or send out.","Scan the barcode with the camera or a handheld scanner. With a handheld you just pull the trigger: you no longer need to click the box first. Turn on <b>Handheld scanner mode</b> to hide the on-screen keyboard.","For <b>Send out</b>, choose the order first so each item is counted against it."]}},
  print:function(){return{t:"Printing labels",l:["Choose the product, then <b>A whole carton</b> (one barcode for each carton, with the packs in it) or <b>A single pack</b>. Cartons: 155 mm = 60 packs, 290 mm and 340 mm = 100 packs.","Using a receipt printer? Set <b>Label width / printer</b> to 80 mm or 58 mm, press <b>Make and print</b> and choose the receipt printer: one label comes out per ticket.","Stick one label on every carton (or pack). Then scan each one with <b>Receive new stock</b>: a carton counts as all the packs inside it.","Shelf labels let you scan a shelf when you put things away."]}},
  hist:function(){return{t:"Activity log",l:["A record of every scan and every label printed, with who did it and when.","Use it to find out where an item has been."]}},
  prod:function(){return{t:"Products",l:["Add each product once, with a short code (SKU). Labels and orders use this list.","Pick the <b>Pad size</b> (155, 290 or 340 mm) and the packs per carton fill in by themselves. You can change them on the list at any time.","Set <b>Warn me when stock falls below</b> to see low-stock alerts on Home.","Press <b>Download backup</b> now and then to keep a copy."]}},
  users:function(){return{t:"Staff",l:["Add each person with a <b>username</b> (they type it to sign in) and a starting PIN. They choose their own PIN the first time.","Forgot a PIN? Press <b>Reset PIN</b>: you get a temporary PIN to give them.","<b>Recent account changes</b> shows who changed what."]}}
};
function hkey(v){return"ds-hint-"+(ME?ME.id:"guest")+"-"+v}
function hidden(v){try{return localStorage.getItem(hkey(v))==="1"}catch(e){return false}}
function renderHints(){
  views.forEach(function(v){
    var sec=$("v-"+v);if(!sec)return;var slot=$("hs-"+v);
    if(!slot){slot=document.createElement("div");slot.id="hs-"+v;sec.insertBefore(slot,sec.firstChild)}
    var h=HINTS[v]&&allowed(v)?(role()==="merchandiser"&&MHINTS[v]?MHINTS[v]():HINTS[v](isMgr())):null;
    slot.innerHTML=h&&!hidden(v)?'<div class="hint"><div><h3>'+h.t+'</h3><ol>'+h.l.map(function(x){return"<li>"+x+"</li>"}).join("")+'</ol></div><button class="btn sm alt hx" data-hx="'+v+'">Got it</button></div>':"";
  });
}
document.addEventListener("click",function(e){
  var v=e.target.dataset&&e.target.dataset.hx;if(v){try{localStorage.setItem(hkey(v),"1")}catch(x){}renderHints()}
  var g=e.target.dataset&&e.target.dataset.goto;
  if(g){var p=g.split(":");
    if(p[0]==="orders"){show("orders");$("os").value=p[1];renderOrders()}
    else if(p[0]==="payments"){show("payments");$("pfs").value=p[1];renderPayments()}}
});
$("helpbtn").onclick=function(){try{localStorage.removeItem(hkey(CURV))}catch(e){}renderHints();var s=$("hs-"+CURV);if(s)s.scrollIntoView({behavior:"smooth",block:"start"})};

/* Home: what needs doing now */
(function(){var d=document.createElement("div");d.id="todo";$("v-dash").insertBefore(d,$("hs-dash")?$("hs-dash").nextSibling:$("v-dash").firstChild)})();
function renderTodo(){
  var el=$("todo");if(!el)return;
  if(!ME||!(S.orders||[]).length){el.innerHTML="";return}
  var O=S.orders,n=function(st){return O.filter(function(o){return o.status===st}).length},m=isMgr(),items=[];
  var add=function(c,txt,go){if(c>0)items.push('<div class="todo"><b>'+c+'</b><span>'+txt+'</span><button class="btn sm alt" data-goto="'+go+'">Open</button></div>')};
  if(m){
    add(n("request"),"new request"+(n("request")===1?"":"s")+" waiting for prices and a quotation","orders:request");
    add(n("quoted"),"quotation"+(n("quoted")===1?"":"s")+" sent, waiting for the customer to agree","orders:quoted");
    add(n("ordered")+n("sourcing"),"order(s) waiting for goods","orders:ordered");
    add(n("in_nairobi"),"order(s) where the goods have arrived (print labels and scan in)","orders:in_nairobi");
    add(n("barcoded"),"order(s) ready to invoice","orders:barcoded");
  }
  add(n("invoiced"),"invoiced order"+(n("invoiced")===1?"":"s")+" ready to send out","orders:invoiced");
  add(n("dispatched"),"order(s) out for delivery, waiting for the delivery code","orders:dispatched");
  if(m){var od=O.filter(function(o){return o.pay_status==="overdue"}),sum=od.reduce(function(s,o){return s+o.balance},0);
    add(od.length,"overdue invoice"+(od.length===1?"":"s")+" (KES "+money(sum)+" still owing)","payments:overdue")}
  el.innerHTML=items.length?'<div class="panel"><h2>To do</h2>'+items.join("")+'</div>':'<div class="panel"><h2>To do</h2><div class="empty">Nothing is waiting. Well done.</div></div>';
}

var _showH=show;show=function(v){CURV=v;_showH(v);$("helpbtn").classList.toggle("hide",!HINTS[v])};
var _renderH=render;render=function(){_renderH();renderHints();renderTodo()};
var _applyH=applySession;applySession=function(){_applyH();$("chpin").classList.toggle("hide",!ME);renderHints()};
