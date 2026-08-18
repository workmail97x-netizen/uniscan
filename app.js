const $ = (s) => document.querySelector(s);
const state = {
  scanner: null, running: false, ws: null, connected: false, receiver: false,
  room: "", last: "", lastAt: 0, reconnectTimer: null, keepAlive: null,
  deferredPrompt: null, pending: new Map(),
  history: JSON.parse(localStorage.getItem("uniscan_history_v2") || "[]")
};

function toast(text) {
  const el = $("#toast"); el.textContent = text; el.classList.add("show");
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 1500);
}
function roomValid(v){ return /^[A-Z2-9]{8}$/.test(v); }
function setConn(text, kind="") { const p=$("#connPill"); p.textContent=text; p.className=`pill ${kind}`.trim(); }
function setPairMessage(text){ $("#pairMsg").textContent=text; }
function renderHistory(){
  const el=$("#history"); el.innerHTML="";
  if(!state.history.length){ el.innerHTML='<div class="muted">لا توجد قراءات بعد.</div>'; return; }
  state.history.slice(0,12).forEach(x=>{ const row=document.createElement("div"); row.className="hist";
    const code=document.createElement("code"); code.textContent=x.value;
    const time=document.createElement("span"); time.textContent=new Date(x.at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"});
    row.append(code,time); el.appendChild(row); });
}
function remember(value){ state.history.unshift({value,at:Date.now()}); state.history=state.history.slice(0,40); localStorage.setItem("uniscan_history_v2",JSON.stringify(state.history)); renderHistory(); }
function beep(ok=true){ try{const A=window.AudioContext||window.webkitAudioContext,a=new A(),o=a.createOscillator(),g=a.createGain();o.connect(g);g.connect(a.destination);o.frequency.value=ok?980:280;g.gain.value=.035;o.start();setTimeout(()=>{o.stop();a.close()},90)}catch{} }
function relayURL(room){ const proto=location.protocol==="https:"?"wss:":"ws:"; return `${proto}//${location.host}/ws?room=${encodeURIComponent(room)}&role=mobile`; }
function clearSocket(){
  if(state.reconnectTimer){clearTimeout(state.reconnectTimer);state.reconnectTimer=null}
  if(state.keepAlive){clearInterval(state.keepAlive);state.keepAlive=null}
  if(state.ws){ try{state.ws.onclose=null;state.ws.close()}catch{} state.ws=null; }
  state.connected=false; state.receiver=false;
}
function connect(room){
  room=(room||"").trim().toUpperCase();
  if(!roomValid(room)){ toast("كود الربط يجب أن يكون 8 أحرف"); return; }
  clearSocket(); state.room=room; localStorage.setItem("uniscan_room",room); $("#pairCode").value=room;
  setConn("جاري الاتصال…","warn"); setPairMessage("جاري الاتصال بالحاسبة…");
  let ws;
  try{ ws=new WebSocket(relayURL(room)); }catch{ setConn("تعذر الاتصال"); return; }
  state.ws=ws;
  ws.onopen=()=>{
    state.connected=true; setConn("متصل بالسحابة","warn"); setPairMessage("تم الاتصال. بانتظار UniScan على الحاسبة.");
    state.keepAlive=setInterval(()=>{try{if(ws.readyState===1)ws.send("ping")}catch{}},20000);
  };
  ws.onmessage=(ev)=>{
    if(ev.data==="pong")return;
    let m; try{m=JSON.parse(ev.data)}catch{return}
    if(m.type==="state"){
      state.receiver=!!(m.desktop||m.browser);
      if(state.receiver){setConn(m.desktop?"الحاسبة مرتبطة":"المتصفح مرتبط","ok");setPairMessage("تم الربط بنجاح. شغّل الكاميرا وابدأ المسح.");}
      else {setConn("بانتظار الحاسبة","warn");setPairMessage("الكود صحيح، لكن Receiver غير متصل حالياً.");}
    }
    if(m.type==="ack"){
      const pending=state.pending.get(m.id); if(pending) state.pending.delete(m.id);
      if(m.ok){$("#deliveryState").textContent=`تم الإدخال على ${m.via==="browser"?"المتصفح":"الحاسبة"} ✓`;$("#deliveryState").className="delivery ok";}
      else {$("#deliveryState").textContent=m.error==="no_receiver"?"لا يوجد Receiver متصل":"تعذر الإدخال";$("#deliveryState").className="delivery bad";beep(false)}
    }
  };
  ws.onclose=()=>{
    state.connected=false; state.receiver=false; setConn("انقطع الاتصال"); setPairMessage("سأحاول إعادة الاتصال تلقائياً…");
    if(state.keepAlive){clearInterval(state.keepAlive);state.keepAlive=null}
    state.reconnectTimer=setTimeout(()=>connect(state.room),2200);
  };
  ws.onerror=()=>{};
}
async function sendScan(value){
  value=String(value||"").trim(); if(!value)return;
  const now=Date.now(); if(value===state.last && now-state.lastAt<1200)return;
  state.last=value; state.lastAt=now; $("#lastValue").textContent=value; remember(value); if(navigator.vibrate)navigator.vibrate(45); beep(true);
  if(!state.ws||state.ws.readyState!==1){$("#deliveryState").textContent="تمت القراءة لكن الاتصال غير متوفر";$("#deliveryState").className="delivery bad";return}
  const id=(crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`);
  state.pending.set(id,Date.now());
  state.ws.send(JSON.stringify({type:"scan",id,value,suffix:$("#suffix").value}));
  $("#deliveryState").textContent="تم الإرسال، بانتظار التأكيد…"; $("#deliveryState").className="delivery muted";
  setTimeout(()=>{if(state.pending.has(id)){state.pending.delete(id);$("#deliveryState").textContent="لم يصل تأكيد من الحاسبة";$("#deliveryState").className="delivery bad"}},4500);
}
async function startCamera(){
  if(!window.isSecureContext){$("#secureNotice").hidden=false;toast("افتح UniScan عبر HTTPS");return}
  if(state.running)return;
  if(typeof Html5Qrcode==="undefined"){toast("تعذر تحميل محرك الباركود");return}
  try{
    state.scanner=new Html5Qrcode("reader");
    await state.scanner.start({facingMode:{exact:"environment"}}, {fps:14,qrbox:(w,h)=>({width:Math.min(w*.88,520),height:Math.min(h*.3,190)}),aspectRatio:1.3333}, sendScan, ()=>{}).catch(async()=>{
      return state.scanner.start({facingMode:"environment"},{fps:12,qrbox:{width:280,height:140}},sendScan,()=>{});
    });
    state.running=true; $("#cameraStatus").textContent="جاهز للمسح";
  }catch(e){console.error(e);$("#cameraStatus").textContent="تعذر تشغيل الكاميرا";toast("اسمح للكاميرا ثم حاول مرة أخرى")}
}
async function stopCamera(){ if(!state.scanner||!state.running)return; try{await state.scanner.stop();state.scanner.clear()}catch{} state.running=false; $("#cameraStatus").textContent="الكاميرا متوقفة"; }
async function torch(){ if(!state.running||!state.scanner){toast("شغّل الكاميرا أولاً");return} try{await state.scanner.applyVideoConstraints({advanced:[{torch:true}]});toast("تم تشغيل الفلاش")}catch{toast("الفلاش غير مدعوم على هذا الجهاز")} }

$("#pairBtn").onclick=()=>connect($("#pairCode").value);
$("#pairCode").addEventListener("input",e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z2-9]/g,"").slice(0,8));
$("#pairCode").addEventListener("keydown",e=>{if(e.key==="Enter")connect(e.target.value)});
$("#startBtn").onclick=startCamera; $("#stopBtn").onclick=stopCamera; $("#torchBtn").onclick=torch;
$("#copyBtn").onclick=async()=>{if(!state.last)return;try{await navigator.clipboard.writeText(state.last);toast("تم النسخ")}catch{}};
$("#clearBtn").onclick=()=>{state.history=[];localStorage.removeItem("uniscan_history_v2");renderHistory();toast("تم مسح السجل")};
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();state.deferredPrompt=e;$("#installBtn").hidden=false});
$("#installBtn").onclick=async()=>{if(!state.deferredPrompt)return;state.deferredPrompt.prompt();await state.deferredPrompt.userChoice;state.deferredPrompt=null;$("#installBtn").hidden=true};
if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));
if(!window.isSecureContext)$("#secureNotice").hidden=false;
renderHistory();
const params=new URLSearchParams(location.search); const initial=(params.get("pair")||localStorage.getItem("uniscan_room")||"").toUpperCase();
if(roomValid(initial)){ $("#pairCode").value=initial; connect(initial); }
