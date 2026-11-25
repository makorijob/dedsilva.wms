/* DedSilva Warehouse System - connects the page to the server API.
   Loaded after the main script; replaces the browser-only logic with server calls. */
var DSTOKEN=null;try{DSTOKEN=localStorage.getItem("ds-token")}catch(e){}
function setToken(t){DSTOKEN=t;try{if(t)localStorage.setItem("ds-token",t);else localStorage.removeItem("ds-token")}catch(e){}}
function api(method,path,body){
  var h={"Content-Type":"application/json"};if(DSTOKEN)h.Authorization="Bearer "+DSTOKEN;
  return fetch("/api"+path,{method:method,headers:h,body:body?JSON.stringify(body):undefined}).then(function(r){
    return r.json().catch(function(){return{}}).then(function(j){if(!r.ok){var e=new Error(j.error||"Request failed");e.status=r.status;e.code=j.code;throw e}return j});
  });
}
function emptyState(){ALL=null;CO=[];return{n:0,site:S.site||"Nairobi HQ",users:[],products:[],codes:[],prints:[],scans:[]}}
function toLogin(msg){setToken(null);ME=null;S=emptyState();render();$("lerr").textContent=msg||"";loginMode();$("login").classList.remove("hide")}
function fail(e){
  if(e&&e.code==="must_change_pin"){showPinModal(true);return}
  if(e&&e.status===401&&ME){toLogin("Your session expired. Please sign in again.");return}
  alert(e&&e.message?e.message:"Could not reach the server. Check the connection and try again.");
}
function save(){}
function load(){return api("GET","/state").then(function(d){
  var site=S.site;ALL=d;ALL.allCompanies=d.companies||[];CO=d.companies||[];pickCompany();
  S=scoped(d);S.n=0;S.site=site||"Nairobi HQ";brand();render();
})}
function signedIn(r){setToken(r.token);ME=r.user;if(ME.mustChange){$("login").classList.add("hide");showPinModal(true);return Promise.resolve()}return load().then(function(){applySession()})}

/* sign in and first-time setup */
function loginMode(){
  return fetch("/api/status").then(function(r){return r.json()}).then(function(s){
    $("lsetup").classList.toggle("hide",!s.setup);$("lsign").classList.toggle("hide",s.setup);
    if(s.companies&&s.companies.length)$("lfoot").textContent=s.companies.map(function(x){return x.name}).join(" \u00b7 ")+". Accounts and data are held on the company server.";
  }).catch(function(){$("lerr").textContent="Cannot reach the server."});
}
$("lmk").onclick=function(){
  var n=$("sn").value.trim(),p=$("sp").value;
  if(!n||p.length<6){$("serr").textContent="Enter your name and a PIN of at least 6 digits.";return}
  api("POST","/setup",{name:n,username:$("sx").value.trim(),pin:p}).then(function(r){$("sp").value="";return signedIn(r)}).catch(function(e){$("serr").textContent=e.message});
};
$("lgo").onclick=function(){
  var u=$("lu").value.trim();
  if(!u||!$("lp").value){$("lerr").textContent="Type your username and PIN.";return}
  api("POST","/login",{username:u,pin:$("lp").value}).then(function(r){$("lp").value="";$("lerr").textContent="";return signedIn(r)}).catch(function(e){$("lerr").textContent=e.message});
};
$("lu").addEventListener("keydown",function(e){if(e.key==="Enter")$("lp").focus()});
$("lforgot").onclick=function(e){e.preventDefault();$("lforgottxt").classList.toggle("hide")};

/* change PIN: forced after a reset (cannot be closed), or chosen by the person from the header / Staff screen */
var PMFORCED=false;
function showPinModal(forced){
  PMFORCED=!!forced;
  $("pmtitle").textContent=forced?"Choose a new PIN":"Change my PIN";
  $("pmtext").textContent=forced?"Your PIN was set or reset by an administrator. Type the PIN you were given, then choose your own.":"Type your current PIN, then the new one. You will stay signed in here and be signed out on other devices.";
  $("pmoldl").textContent=forced?"PIN you were given":"Current PIN";
  ["pmold","pmnew","pmnew2"].forEach(function(i){$(i).value=""});$("pmerr").textContent="";
  $("pmcancel").classList.toggle("hide",forced);$("pinmodal").classList.remove("hide");setTimeout(function(){$("pmold").focus()},50);
}
$("pmcancel").onclick=function(){$("pinmodal").classList.add("hide")};
$("pmgo").onclick=function(){
  var o=$("pmold").value,n=$("pmnew").value;
  if(n!==$("pmnew2").value){$("pmerr").textContent="The two new PINs are not the same.";return}
  if(n.length<6){$("pmerr").textContent="The new PIN needs at least 6 characters.";return}
  api("POST","/change-pin",{oldPin:o,newPin:n}).then(function(r){
    setToken(r.token);ME=r.user;$("pinmodal").classList.add("hide");
    return PMFORCED||!ALL?load().then(function(){applySession()}):Promise.resolve();
  }).then(function(){if(!PMFORCED)alert("Your PIN has been changed.")}).catch(function(e){$("pmerr").textContent=e.message});
};
$("pmnew2").addEventListener("keydown",function(e){if(e.key==="Enter")$("pmgo").click()});
$("chpin").onclick=function(){showPinModal(false)};
document.addEventListener("click",function(e){if(e.target.id==="chpin2")showPinModal(false)});
$("logout").onclick=function(){stopCam();toLogin("")};

/* labels and printing: the server assigns the unique numbers */
$("gen").onclick=function(){
  var pid=+$("pp").value,q=Math.max(1,Math.min(200,+$("pq").value||1)),isC=$("lk").value==="carton",u=+$("lcu").value||0;
  if(!pid){alert("Add a product first.");return}
  if(isC&&u<2){alert("Enter how many packs are in each carton.");$("lcu").focus();return}
  $("gen").disabled=true;
  var pr=S.products.filter(function(x){return x.id===pid})[0],sz=+$("lsz").value;
  /* a product with no pad size yet gets the size chosen here, so its carton size is remembered for orders */
  var pre=(isC&&pr&&!pr.size_mm&&sz&&isMgr())?api("PATCH","/products/"+pid,{size_mm:sz,carton_qty:u}):Promise.resolve();
  pre.then(function(){return api("POST","/labels",{pid:pid,qty:q,kind:isC?"carton":"pack",units:isC?u:undefined,lot:$("pl").value.trim(),site:S.site})}).then(function(r){
    return load().then(function(){
      var made=r.codes.map(function(cd){return S.codes.filter(function(x){return x.code===cd})[0]}).filter(Boolean);
      lastMade=made;$("gpdf").disabled=false;
      $("preview").innerHTML=made.map(labelHTML).join('');drawBarcodes($("preview"));printCodes(made);
    });
  }).catch(fail).then(function(){$("gen").disabled=false;updatePrintForm(false)});
};
function logRe(list){return api("POST","/reprint",{codes:list.map(function(c){return c.code}),site:S.site}).then(load).catch(fail)}

/* scanning: the server validates the move and records it */
var SCAN_LAST={code:"",t:0};
function doScan(raw){
  var code=String(raw).replace(/[\u0000-\u001f\u007f]/g,"").trim().toUpperCase();if(!code)return;
  var nowT=Date.now();if(code===SCAN_LAST.code&&nowT-SCAN_LAST.t<800)return;   /* a trigger bounce or double read of the same label */
  SCAN_LAST={code:code,t:nowT};
  var act=(full()&&role()!=="merchandiser")?$("act").value:"view",loc=$("loc").value.trim();
  api("POST","/scan",{code:code,action:act,loc:loc,site:S.site,order:(act==="dispatch"&&$("ord")&&+$("ord").value)||undefined}).then(function(r){
    if(r.scan)S.scans.push(r.scan);
    if(r.code){var i=-1;S.codes.forEach(function(x,k){if(x.code===r.code.code)i=k});if(i<0)S.codes.push(r.code);else S.codes[i]=r.code}
    if(r.location){$("loc").value=r.location;$("act").value="putaway";$("locwrap").classList.remove("hide")}
    say(r.cls,r.msg);
    if(r.location){$("detail").innerHTML=""}
    else{showDetail(r.code||(full()?null:{code:code}),r.cls);batchTick(r.cls,code)}
    render();
    if(act==="dispatch")load().catch(function(){});
  }).catch(fail);
}
function apiVoid(id){api("POST","/scans/"+encodeURIComponent(id)+"/void").then(load).catch(fail)}

/* products and staff */
/* the SKU fills itself in from the brand and name; typing in the SKU box takes over, clearing it brings automatic back */
var SKUAUTO=true;
function autoSku(){
  if(!SKUAUTO)return;
  var all=(ALL&&ALL.products||S.products||[]).map(function(p){return p.sku});
  $("ps").value=window.SKU?SKU.suggest($("pb").value,$("pn").value,all,+$("psz").value||0):"";
}
var PCQ_MANUAL=false;   /* once someone types the packs per carton, choosing a size no longer overwrites it */
$("pcq").addEventListener("input",function(){PCQ_MANUAL=!!$("pcq").value.trim()});
$("psz").addEventListener("change",function(){if(!PCQ_MANUAL)$("pcq").value=(window.SKU&&SKU.cartonFor(+$("psz").value))||"";autoSku()});
$("pn").addEventListener("input",autoSku);$("pb").addEventListener("change",autoSku);$("co").addEventListener("change",function(){setTimeout(autoSku,0)});
$("ps").addEventListener("input",function(){SKUAUTO=!$("ps").value.trim();if(SKUAUTO)autoSku()});
$("addp").onclick=function(){
  var n=$("pn").value.trim();
  if(!n){alert("Enter the product name. The SKU is made from it automatically.");return}
  autoSku();
  var s=$("ps").value.trim();if(!s){alert("Could not make a SKU from that name. Add a few letters to the name or type a SKU.");return}
  api("POST","/products",{name:n,sku:s,auto:SKUAUTO,brand:$("pb").value,cat:$("pc").value,min:+$("pm").value||0,vat:+$("pv").value,size_mm:$("psz").value||undefined,carton_qty:$("pcq").value===""?undefined:+$("pcq").value,company_id:COID})
    .then(function(){$("pn").value="";$("ps").value="";$("pm").value=0;$("pv").value="1";$("psz").value="";$("pcq").value="";PCQ_MANUAL=false;SKUAUTO=true;return load()}).catch(fail);
};
function pinBox(html){$("pinresult").innerHTML='<div class="otpbox">'+html+' <button class="btn sm alt" id="pinhide">Hide</button></div>'}
document.addEventListener("click",function(e){if(e.target.id==="pinhide")$("pinresult").innerHTML=""});
$("uadd").onclick=function(){
  var n=$("un").value.trim(),p=$("up").value;
  if(!n||p.length<6){alert("Enter a name and a starting PIN of at least 6 digits.");return}
  api("POST","/users",{name:n,username:$("uu").value.trim(),role:$("ur").value,pin:p,companies:$("uco").value,phone:$("uph").value.trim()}).then(function(r){$("uph").value="";
    $("un").value="";$("uu").value="";$("up").value="";
    pinBox("Added <b>"+esc(n)+"</b>. Their username is <b>"+esc(r.username)+"</b>. Give them the starting PIN you typed; they will be asked to choose their own PIN the first time they sign in.");
    return load();
  }).catch(fail);
};
function apiRm(id){
  var u=S.users.filter(function(x){return String(x.id)===String(id)})[0];
  if(!confirm("Remove "+(u?u.name:"this person")+"? They will not be able to sign in any more."))return;
  api("DELETE","/users/"+id).then(load).catch(fail);
}
$("ulist").addEventListener("click",function(e){
  var ph=e.target.dataset.uphone;
  if(ph){var pu=S.users.filter(function(x){return String(x.id)===String(ph)})[0]||{};var np=prompt("Phone number for order texts for "+(pu.name||"this person")+" (blank to remove). Example: 0712 345 678",pu.phone||"");if(np!==null)api("PATCH","/users/"+ph,{phone:np.trim()}).then(load).catch(fail);return}
  var id=e.target.dataset.resetpin,un=e.target.dataset.uname,u=S.users.filter(function(x){return String(x.id)===String(id||un)})[0];
  if(id&&u){
    if(!confirm("Reset the PIN for "+u.name+"?\n\nThey will be signed out and given a temporary PIN. They choose a new one when they sign in."))return;
    api("POST","/users/"+id+"/reset-pin").then(function(r){
      pinBox("Temporary PIN for <b>"+esc(r.name)+"</b> (username <b>"+esc(r.username)+"</b>): <b style=\"font:700 34px 'Barlow Condensed',monospace;letter-spacing:.2em\">"+esc(r.pin)+"</b><br>Tell them in person or by phone. It is shown only now. If you lose it, press Reset PIN again.");
      return load();
    }).catch(fail);
  }
  if(un&&u){
    var nu=prompt("New username for "+u.name+" (letters, numbers, dots or dashes, no spaces):",u.username||"");
    if(nu&&nu.trim()&&nu.trim()!==u.username)api("PATCH","/users/"+un,{username:nu.trim()}).then(load).catch(fail);
  }
});
$("ulist").addEventListener("change",function(e){var id=e.target.dataset.uco;if(id)api("PATCH","/users/"+id,{companies:e.target.value}).then(load).catch(function(er){fail(er);load()})});
function apiRole(id,role){api("PATCH","/users/"+id,{role:role}).then(load).catch(function(e){fail(e);load()})}

/* backup (administrators) */
$("bk").onclick=function(){
  api("GET","/backup").then(function(j){
    return claude.use("downloads").then(function(d){return d.save({filename:"dedsilva-backup-"+stamp()+".json",data:new Blob([JSON.stringify(j,null,1)],{type:"application/json"})})});
  }).catch(fail);
};

/* change whether VAT is charged on a product */
$("plist").addEventListener("change",function(e){
  var id=e.target.dataset&&e.target.dataset.pvat;if(!id)return;
  api("PATCH","/products/"+id,{vat:+e.target.value}).then(load).catch(function(er){fail(er);load()});
});
/* pad size and packs per carton, edited in the product list */
$("plist").addEventListener("change",function(e){
  var d=e.target.dataset||{};
  if(d.psz!==undefined)api("PATCH","/products/"+d.psz,{size_mm:e.target.value}).then(load).catch(function(er){fail(er);load()});
  if(d.pcq!==undefined)api("PATCH","/products/"+d.pcq,{carton_qty:e.target.value}).then(load).catch(function(er){fail(er);load()});
});
/* ---- Excel export / import and the daily summary (managers) ---- */
function dlFile(path,filename){
  var h={};if(DSTOKEN)h.Authorization="Bearer "+DSTOKEN;
  return fetch("/api"+path,{headers:h}).then(function(r){
    if(!r.ok)return r.json().catch(function(){return{}}).then(function(j){var e=new Error(j.error||"Download failed");e.status=r.status;throw e});
    return r.blob();
  }).then(function(b){var a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=filename;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1500)});
}
document.addEventListener("click",function(e){
  var k=e.target.dataset&&e.target.dataset.xl;if(!k)return;
  var q="?company_id="+COID+((k==="orders"||k==="payments")?($("xfrom").value?"&from="+$("xfrom").value:"")+($("xto").value?"&to="+$("xto").value:""):"");
  e.target.disabled=true;
  dlFile("/export/"+k+q,(cur().short||"export").toLowerCase()+"-"+k+"-"+new Date().toISOString().slice(0,10)+".xlsx").catch(fail).then(function(){e.target.disabled=false});
});
$("xsum").onclick=function(){
  var b=$("xsum");b.disabled=true;$("xmsg").textContent="Sending...";
  api("POST","/reports/daily",{company_id:COID}).then(function(r){$("xmsg").textContent=r.ok?"Today's summary was emailed to "+r.to+".":"Could not send: "+(r.error||"unknown problem")}).catch(function(e){$("xmsg").textContent="";fail(e)}).then(function(){b.disabled=false});
};
var IMP=null;
function fileB64(f){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(){res(String(r.result).split(",")[1]||"")};r.onerror=function(){rej(new Error("Could not read the file."))};r.readAsDataURL(f)})}
function impList(title,rows,cls){return rows.length?'<p><b>'+title+' ('+rows.length+')</b></p><ul style="margin:4px 0 10px 18px;font-size:13px'+(cls?';color:var(--accent)':'')+'">'+rows.slice(0,15).map(function(r){return'<li>Row '+r.row+(r.name?" ("+esc(r.name)+")":"")+": "+esc(r.reason||r.sku||"")+'</li>'}).join("")+(rows.length>15?"<li>and "+(rows.length-15)+" more</li>":"")+'</ul>':""}
$("impcheck").onclick=function(){
  var f=$("impf").files[0];if(!f){alert("Choose the Excel or CSV file first.");return}
  $("impres").innerHTML="Checking...";
  fileB64(f).then(function(b){IMP={filename:f.name,data:b};return api("POST","/products/import",{company_id:COID,filename:f.name,data:b,preview:true})}).then(function(r){
    var h='<div class="result '+(r.create.length?"ok":"warn")+'">'+r.create.length+" product"+(r.create.length===1?"":"s")+" ready to add"+(r.skipped.length?", "+r.skipped.length+" skipped":"")+(r.errors.length?", "+r.errors.length+" with problems":"")+".</div>";
    if(r.create.length)h+='<p><b>Will be added</b></p><div class="tablewrap">'+table(["Row","Name","Brand","Category","Minimum","SKU"],r.create.slice(0,50).map(function(p){return"<tr><td>"+p.row+"</td><td>"+esc(p.name)+"</td><td>"+esc(p.brand||"-")+"</td><td>"+esc(p.cat||"-")+"</td><td>"+p.min+"</td><td><b>"+esc(p.sku)+"</b></td></tr>"}),"")+"</div>"+(r.create.length>50?"<p class='empty'>and "+(r.create.length-50)+" more</p>":"");
    h+=impList("Skipped",r.skipped)+impList("Problems (these rows are left out)",r.errors,1);
    if(r.create.length)h+='<div class="tabs"><button class="btn" id="impgo">Add '+r.create.length+" product"+(r.create.length===1?"":"s")+'</button></div>';
    $("impres").innerHTML=h;
  }).catch(function(e){$("impres").innerHTML="";fail(e)});
};
$("impres").addEventListener("click",function(e){
  if(e.target.id!=="impgo"||!IMP)return;e.target.disabled=true;
  api("POST","/products/import",{company_id:COID,filename:IMP.filename,data:IMP.data,preview:false}).then(function(r){
    $("impres").innerHTML='<div class="result ok">Added '+r.create.length+" product"+(r.create.length===1?"":"s")+".</div>";IMP=null;$("impf").value="";return load();
  }).catch(function(er){e.target.disabled=false;fail(er)});
});

/* ---- handheld scanners (Zebra and any scanner that types the barcode like a keyboard) ---- */
function handheldOn(){try{return localStorage.getItem("wms-handheld")==="on"}catch(e){return false}}
$("scan").setAttribute("autocomplete","off");$("scan").setAttribute("autocapitalize","characters");$("scan").setAttribute("autocorrect","off");$("scan").setAttribute("spellcheck","false");
function applyHandheld(){$("scan").setAttribute("inputmode",handheldOn()?"none":"text");if($("hh"))$("hh").checked=handheldOn()}
/* some scanners end the barcode with Tab instead of Enter */
$("scan").addEventListener("keydown",function(e){if(e.key==="Tab"&&this.value.trim()){e.preventDefault();doScan(this.value);this.value="";this.focus()}});
/* if the cursor is not in the scan box (a button was tapped, a message closed) the scanner would type into nothing: catch the first character and put the cursor back */
document.addEventListener("keydown",function(e){
  if($("v-scan").classList.contains("hide")||!$("login").classList.contains("hide")||!$("pinmodal").classList.contains("hide"))return;
  if(e.ctrlKey||e.metaKey||e.altKey||!e.key||e.key.length!==1)return;
  var t=e.target,tag=t&&t.tagName;if(tag==="INPUT"||tag==="SELECT"||tag==="TEXTAREA")return;
  e.preventDefault();$("scan").focus();$("scan").value+=e.key;
});
/* sound switch for scanning, and "install on the home screen" */
$("res").insertAdjacentHTML("beforebegin",'<label class="sndsw"><input type="checkbox" id="snd"> Sound and vibration when scanning</label>');
$("snd").checked=sndOn();
$("snd").parentNode.insertAdjacentHTML("afterend",'<label class="sndsw"><input type="checkbox" id="hh"> Handheld scanner mode (hides the on-screen keyboard)</label>');
$("hh").onchange=function(){try{localStorage.setItem("wms-handheld",this.checked?"on":"off")}catch(e){}applyHandheld();$("scan").focus()};
applyHandheld();
$("snd").onchange=function(){try{localStorage.setItem("wms-sound",this.checked?"on":"off")}catch(e){}if(this.checked)feedback("ok")};
var DEFER=null,IOS=/iphone|ipad|ipod/i.test(navigator.userAgent),STANDALONE=(window.matchMedia&&matchMedia("(display-mode: standalone)").matches)||navigator.standalone;
window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();DEFER=e;if(!STANDALONE)$("pwa").classList.remove("hide")});
window.addEventListener("appinstalled",function(){$("pwa").classList.add("hide")});
if(IOS&&!STANDALONE)$("pwa").classList.remove("hide");
$("pwa").onclick=function(){
  if(DEFER){DEFER.prompt();DEFER.userChoice.then(function(){DEFER=null;$("pwa").classList.add("hide")})}
  else alert(IOS?"To put this on your home screen: tap the Share button in Safari, then \"Add to Home Screen\".":"Open the browser menu and choose \"Install app\" or \"Add to Home screen\".");
};
if("serviceWorker" in navigator)window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){})});

/* start-up: resume a saved session or show the sign-in screen */
(function(){
  try{S.site=localStorage.getItem("dedsilva-site")||"Nairobi HQ"}catch(e){}
  $("site").value=S.site;$("dbs").textContent="Connected to server";
  if(!DSTOKEN){loginMode();return}
  api("GET","/me").then(function(r){ME=r.user;if(ME.mustChange){$("login").classList.add("hide");showPinModal(true);return}return load().then(function(){applySession()})}).catch(function(){setToken(null);loginMode()});
})();

/* download a PDF the server builds (proforma, delivery note, statement); the file name comes from the server */
function dlPdf(path,body,fallback){
  return fetch("/api"+path,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+DSTOKEN},body:JSON.stringify(body||{})}).then(function(r){
    if(!r.ok)return r.json().catch(function(){return{}}).then(function(j){var e=new Error(j.error||"Could not make the PDF");e.status=r.status;e.code=j.code;throw e});
    var m=/filename="([^"]+)"/.exec(r.headers.get("Content-Disposition")||""),name=m?m[1]:fallback||"document.pdf";
    return r.blob().then(function(b){var a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1500)});
  });
}
