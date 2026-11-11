/* 原生瀏覽器應用；唯一第三方執行檔為 vendor/supabase.js。 */
'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const taipeiDate = (offset=0) => { const d = new Date(Date.now()+8*3600000+offset*86400000); return d.toISOString().slice(0,10); };
  const hour = h => `${String(h).padStart(2,'0')}:00`;
  const instant = (date,h) => new Date(`${date}T${hour(h)}:00+08:00`).getTime();
  const steps = [['floor-zone','樓層與區域'],['date-time','日期與時段'],['seat-map','選擇座位'],['confirm','確認預約'],['complete','預約完成']];
  const labels = {all:'全部',upcoming:'待報到','checked-in':'已報到',cancelled:'已取消',expired:'逾時未報到',finished:'已結束'};
  const state = {view:'home',floor:'B1',zone:'A',date:taipeiDate(1),start:14,end:16,seat:null,session:null,zones:[],seats:[],occupied:[],mine:[],latest:null,filter:'all',agreed:false,loading:false,loaded:false,busy:false,error:'',refreshId:0};
  let client, channel, refreshTimer, recoveryMode=false;
  const cfg = window.APP_CONFIG || {};
  const configured = /^https:\/\/[a-z0-9.-]+(?::\d+)?\/?$/i.test(cfg.SUPABASE_URL || '') && /^sb_publishable_[A-Za-z0-9_-]+$/.test(cfg.SUPABASE_PUBLISHABLE_KEY || '');
  const button = (text,action,cls='',attrs='') => `<button type="button" class="${cls}" data-action="${action}" ${attrs}>${text}</button>`;
  const navButton = (text,view,cls='') => button(text,'navigate',cls,`data-view="${view}"`);
  function message(text='',error=false) { $('#notice').textContent=text; $('#notice').className=error?'error':''; }
  function errorText(err) {
    const m=err?.message || String(err);
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return '連線失敗，請確認網路、Supabase 網址及專案是否暫停，再按重新整理。';
    if (/Invalid login credentials/i.test(m)) return '電子郵件或密碼不正確。';
    if (/Email not confirmed/i.test(m)) return '請先完成電子郵件驗證，或請專案管理者確認帳號設定。';
    if (/Signups not allowed/i.test(m)) return '本系統未開放自行註冊，請聯絡專案管理者建立帳號。';
    if (/rate limit/i.test(m)) return '請求次數已達限制，請稍後再試。';
    return m;
  }
  async function result(promise) { const {data,error}=await promise; if(error) throw error; return data; }
  function requireBackend() { if(!client) throw new Error('尚未完成 Supabase 設定。請依 README 填寫 config.js 並執行 setup.sql。'); }
  function draftValid() {
    return /^\d{4}-\d{2}-\d{2}$/.test(state.date) && state.date>=taipeiDate() && state.date<=taipeiDate(30)
      && state.start>=8 && state.end<=22 && state.end>state.start && state.end-state.start<=6 && instant(state.date,state.start)>Date.now();
  }
  function available(s,start=state.start,end=state.end) {
    return state.loaded && !state.error && s.enabled && instant(state.date,start)>Date.now()
      && !state.occupied.some(r=>r.seat_id===s.id && r.start_hour<end && r.end_hour>start);
  }
  const zoneSeats=(zone=state.zone)=>state.seats.filter(s=>s.floor===state.floor&&s.zone===zone);
  const selectedSeat=()=>state.seats.find(s=>s.id===state.seat);
  const context=()=>`${esc(state.floor)} · ${esc(state.zone)}區　${esc(state.date)}　${hour(state.start)}–${hour(state.end)}`;
  function draftChanged() { state.seat=null; state.agreed=false; }
  function summary(res) {
    const s=res ? state.seats.find(x=>x.id===res.seat_id) : selectedSeat();
    const rows=[['預約日期',res?.booking_date||state.date],['預約時段',`${hour(res?.start_hour??state.start)} – ${hour(res?.end_hour??state.end)}`],['樓層與區域',s?`${s.floor} · ${s.zone}區`:`${state.floor} · ${state.zone}區`],['座位',s?.label||res?.seat_id||'尚未選擇']];
    return rows.map(([k,v])=>`<div class="summary-row"><span>${k}</span><strong>${esc(v)}</strong></div>`).join('');
  }
  function seatMap(interactive=false, booked=null) {
    const list=booked?state.seats.filter(s=>s.floor===booked.floor&&s.zone===booked.zone):zoneSeats();
    return `<div class="map"><div class="map-label"><span>靠窗採光側</span><span>北側書架區</span></div><div class="seats">${list.map(s=>{
      const ok=booked?true:available(s), chosen=booked?s.id===booked.id:s.id===state.seat;
      return `<button type="button" data-action="seat" data-id="${esc(s.id)}" class="seat ${chosen?'selected':!ok?'blocked':''}" ${!interactive||!ok?'disabled':''} aria-pressed="${chosen}" aria-label="${esc(s.label)} ${chosen?'已選':ok?'可預約':'不可預約'}${s.has_power?'，附插座':''}${s.is_window?'，靠窗':''}">${esc(s.label)}<small>${chosen?'✓ 已選':!ok?'不可預約':s.has_power?'附插座':'一般座位'}</small></button>`;
    }).join('')}</div><div class="map-label bottom"><span>樓層服務台</span><span>出入口 →</span></div></div>`;
  }
  function renderHeader() {
    $('#account').innerHTML=state.session?`<span class="account-email">${esc(state.session.user.email)}</span>${button('登出','logout','text')}`:button('登入','login');
    document.querySelectorAll('nav a').forEach(a=>{if(a.hash===`#${state.view}`||(a.hash==='#floor-zone'&&steps.some(s=>s[0]===state.view))) a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    const idx=steps.findIndex(s=>s[0]===state.view);
    $('#steps').innerHTML=idx<0?'':`<ol class="progress" aria-label="預約步驟">${steps.map(([v,label],i)=>`<li>${button(`<b>${i<idx?'✓':String(i+2).padStart(2,'0')}</b>${label}`,'navigate',i<idx?'done':'',`data-view="${v}" ${i===idx?'aria-current="step"':''} ${i>=idx||state.view==='complete'?'disabled':''}`)}</li>`).join('')}</ol>`;
  }
  function backendState() {
    if(!client) return `<div class="panel empty"><h2>尚未連接預約資料庫</h2><p>請先依 README 完成 Supabase 設定。</p><p class="muted">系統不會以模擬座位占用或假登入代替資料。</p></div>`;
    if(state.error) return `<div class="panel empty"><h2>無法取得最新資料</h2><p>${esc(state.error)}</p>${button('重新整理','refresh','primary')}</div>`;
    if(!state.loaded||state.loading) return '<div class="panel waiting" role="status">正在取得最新座位資料…</div>';
    if(!state.seats.length||!state.zones.length) return '<div class="panel empty">座位目錄尚未建立，請確認 setup.sql 已成功執行。</div>';
    return '';
  }
  function render() {
    renderHeader();
    const main=$('#main');
    if(state.view==='home') {
      main.innerHTML=`<section class="hero"><p class="eyebrow">國立臺北科技大學圖書館 · 線上閱覽座位系統</p><h1>找個座位，開始學習</h1><p>線上預約圖書館閱覽座位，即時查看各樓層剩餘席次，輕鬆安排你的學習時段</p>${navButton('查看座位　→','floor-zone','primary')}</section><div class="home-info"><span>預約開放時間：每日 <strong>08:00 – 22:00</strong></span>${button('使用規則','rules','text')}</div>`;
      return;
    }
    if(state.view==='my-reservations'&&!state.session) {
      main.innerHTML=`<h1>我的預約</h1><div class="panel empty"><h2>登入後查看您的預約</h2><p class="muted">預約紀錄只提供給帳號本人。</p>${button('登入 / 註冊','login','primary')}</div>`;return;
    }
    const pending=backendState(); if(pending){main.innerHTML=pending;return;}
    if(state.view==='floor-zone') {
      main.innerHTML=`<h1>查看座位與樓層配置</h1><p class="muted">選擇樓層與區域，查看所選時段的剩餘座位與空間配置。</p><p class="small">查詢時段：${esc(state.date)} ${hour(state.start)}–${hour(state.end)}（可於下一步修改）</p><div class="tabs">${['B1','2F'].map(f=>button(f,'floor',state.floor===f?'active':'',`data-floor="${f}" aria-pressed="${state.floor===f}"`)).join('')}</div><div class="grid zones">${state.zones.filter(z=>z.floor===state.floor).map(z=>`<button class="zone ${z.zone===state.zone?'selected':''}" data-action="zone" data-zone="${esc(z.zone)}" aria-pressed="${z.zone===state.zone}"><strong>${esc(z.zone)}區</strong><span class="count">剩餘 ${zoneSeats(z.zone).filter(s=>available(s)).length} 席</span><p>${esc(z.description)}</p><p class="muted">${esc(z.features)}</p></button>`).join('')}</div><div class="panel"><h2>空間配置（${esc(state.floor)} · ${esc(state.zone)}區）</h2><div class="legend">□ 可預約　▧ 不可預約（已占用、停用或時間已過）</div><div class="grid two">${seatMap()}<aside><h2>已選空間</h2><div class="summary-row"><span>樓層</span><strong>${esc(state.floor)}</strong></div><div class="summary-row"><span>區域</span><strong>${esc(state.zone)}區</strong></div><div class="summary-row"><span>總席次</span><strong>${zoneSeats().length} 席</strong></div><div class="actions">${navButton('選擇日期與時段 →','date-time','primary')}</div></aside></div></div>`;
    } else if(state.view==='date-time') {
      main.innerHTML=`<h1>選擇日期與時段</h1><p class="muted">點選時段表可快速選擇 1 小時，再調整結束時間。單日累計上限 6 小時。</p><div class="grid date-grid"><div class="panel"><label class="field">選擇日期<input id="booking-date" type="date" value="${esc(state.date)}" min="${taipeiDate()}" max="${taipeiDate(30)}"></label><label class="field">開始時間<select id="start-hour">${Array.from({length:14},(_,i)=>i+8).map(h=>`<option value="${h}" ${h===state.start?'selected':''}>${hour(h)}</option>`).join('')}</select></label><label class="field">結束時間<select id="end-hour">${Array.from({length:Math.min(22,state.start+6)-state.start},(_,i)=>state.start+i+1).map(h=>`<option value="${h}" ${h===state.end?'selected':''}>${hour(h)}</option>`).join('')}</select></label><div class="summary-row"><span>已選空間</span><strong>${state.floor} · ${state.zone}區</strong></div><div class="summary-row"><span>預約時長</span><strong>${state.end-state.start} 小時</strong></div>${!draftValid()?'<div class="info">請選擇尚未開始、位於未來 30 天內的有效時段。</div>':''}</div><div class="panel"><h2>${state.floor} 各區時段可預約狀態</h2><div class="table-wrap"><table><thead><tr><th scope="col">開始時間</th>${['A','B','C'].map(z=>`<th scope="col">${z}區</th>`).join('')}</tr></thead><tbody>${Array.from({length:14},(_,i)=>i+8).map(h=>`<tr><th scope="row">${hour(h)}</th>${['A','B','C'].map(z=>{const n=zoneSeats(z).filter(s=>available(s,h,h+1)).length;const sel=z===state.zone&&h>=state.start&&h<state.end;return `<td>${button(n?`${sel?'✓ ':''}${n} 席`:'不可預約','slot',n?(sel?'selected':''):'blocked',`data-zone="${z}" data-hour="${h}" aria-label="${z}區 ${hour(h)} ${n}席" ${n?'':'disabled'}`)}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div><div class="actions">${button('查看可用座位 →','to-seats','primary',draftValid()?'':'disabled')}</div></div></div>`;
    } else if(state.view==='seat-map') {
      const s=selectedSeat();
      main.innerHTML=`<h1>選擇座位</h1><p class="muted">在平面圖上點選可預約座位，右側顯示座位資訊。</p><div class="panel context"><strong>${context()}</strong>${navButton('修改時段','date-time','text')}${navButton('修改樓層','floor-zone','text')}</div><div class="panel"><div class="legend">□ 可預約　▧ 不可預約　■ 已選座位</div><div class="grid two">${seatMap(true)}<aside><h2>${s?'座位 '+esc(s.label):'請選擇座位'}</h2><p class="muted">${s?`${s.is_window?'靠窗席':'標準閱覽席'} · ${s.has_power?'附電源插座':'無電源插座'}`:'點選左側空位查看詳細資訊。'}</p><div class="info">選取不代表保留；送出預約時將再次確認是否有空位。</div>${button('下一步：確認預約 →','to-confirm','primary',s&&available(s)?'':'disabled')}</aside></div></div>`;
    } else if(state.view==='confirm') {
      main.innerHTML=`<h1>確認預約</h1><p class="muted">請核對預約資訊，登入並同意使用規則後送出。</p><div class="panel"><div class="grid two"><section><h2>預約資訊確認</h2>${summary()}<div class="actions">${navButton('修改日期與時段','date-time','text')}${navButton('修改座位','seat-map','text')}</div></section><aside class="map"><h2>帳號驗證</h2>${state.session?`<p class="success">✓ 已登入</p><p>${esc(state.session.user.email)}</p>`:`<p class="muted">使用本系統的電子郵件帳號登入，選位資料將保留。</p>${button('登入 / 註冊','login','primary')}`}<p class="small muted">本系統未串接校園入口網，請勿輸入校園帳號密碼。</p></aside></div><div class="actions center"><label><input id="agree" type="checkbox" ${state.agreed?'checked':''}> 我已閱讀並同意</label>${button('使用規則','rules','text')}</div><div class="actions center">${navButton('返回上一步','seat-map')}${button('確認預約','book','primary',state.session&&state.agreed&&state.seat?'':'disabled')}</div></div>`;
    } else if(state.view==='complete') {
      const r=state.latest;
      if(!r){navigate('my-reservations');return;}
      const s=state.seats.find(s=>s.id===r.seat_id);
      main.innerHTML=`<div class="panel"><div class="centered"><div class="success-icon">✓</div><h1>預約成功</h1><p class="small muted">預約編號：${esc(r.id)}</p></div><div class="grid two"><div>${summary(r)}</div>${s?seatMap(false,s):''}</div><div class="info">請於開始前 15 分鐘至開始後 15 分鐘內，至「我的預約」按下「網頁報到」。此操作不等同實體刷卡或到館驗證。</div><div class="actions center">${navButton('查看我的預約','my-reservations','primary')}${navButton('返回首頁','home')}</div></div>`;
    } else if(state.view==='my-reservations') {
      const rows=state.mine.filter(r=>state.filter==='all'||r.status===state.filter);
      main.innerHTML=`<h1>我的預約</h1><p class="muted">查看個人紀錄，辦理網頁報到、取消預約或提前離席。</p><div class="actions">${button('重新整理','refresh')}${navButton('＋ 新增預約','floor-zone','primary')}</div><div class="tabs">${Object.entries(labels).map(([k,v])=>button(v,'filter',state.filter===k?'active':'',`data-filter="${k}" aria-pressed="${state.filter===k}"`)).join('')}</div>${rows.length?rows.map(r=>{const s=state.seats.find(s=>s.id===r.seat_id);const canCheck=r.status==='upcoming'&&Date.now()>=Date.parse(r.starts_at)-900000&&Date.now()<=Date.parse(r.starts_at)+900000;return `<article class="panel reservation"><h2>${esc(s?`${s.floor} · ${s.zone}區 · ${s.label}`:r.seat_id)}<span class="badge">${labels[r.status]}</span></h2><p>${esc(r.booking_date)}　${hour(r.start_hour)}–${hour(r.end_hour)}</p><p class="id muted">編號 ${esc(r.id)}</p><div class="actions">${r.status==='upcoming'?button('網頁報到','check-in','primary',`data-id="${r.id}" ${canCheck?'':'disabled'} title="僅開始前後 15 分鐘內開放"`)+button('取消預約','cancel','',`data-id="${r.id}"`):r.status==='checked-in'?button('提前離席','finish','',`data-id="${r.id}"`):''}</div></article>`;}).join(''):'<div class="panel empty">目前沒有符合條件的預約紀錄。</div>'}`;
    }
  }
  function navigate(view) {
    if(view==='confirm'&&!state.seat) view='seat-map';
    if(view==='complete'&&!state.latest) view='my-reservations';
    if(!['home','my-reservations',...steps.map(s=>s[0])].includes(view)) view='home';
    state.view=view;
    if(location.hash!==`#${view}`) history.pushState(null,'',`#${view}`);
    render(); window.scrollTo({top:0,behavior:'smooth'}); $('#main').focus({preventScroll:true});
    if(client&&view!=='home') refresh();
  }
  async function refresh({silent=false}={}) {
    if(!client||document.hidden&&silent) return;
    if(state.date<taipeiDate()||state.date>taipeiDate(30)){state.date=taipeiDate(1);draftChanged();message('日期範圍已更新，請重新選擇時段與座位。');}
    const id=++state.refreshId, date=state.date, uid=state.session?.user.id;
    try {
      const [zones,seats,occupied,mine]=await Promise.all([
        result(client.from('ntut_zones').select('*').order('floor').order('zone')),
        result(client.from('ntut_seats').select('*').order('id')),
        result(client.rpc('ntut_availability',{p_date:date})),
        uid?result(client.rpc('ntut_my_reservations')):Promise.resolve([])
      ]);
      if(id!==state.refreshId||date!==state.date||uid!==state.session?.user.id) return;
      Object.assign(state,{zones,seats,occupied,mine,loaded:true,loading:false,error:''});
      if(state.seat&&!available(selectedSeat()||{})) {
        state.seat=null;state.agreed=false;
        if(state.view==='confirm') {state.view='seat-map';history.replaceState(null,'','#seat-map');}
        if(state.view!=='complete') message('原選座位已無法預約，請重新選擇。');
      }
      // 定時更新避免打斷輸入與鍵盤焦點。
      if(!silent||!$('#main').contains(document.activeElement)) render();
    } catch(err) {
      if(id!==state.refreshId) return;
      state.loading=false;state.error=errorText(err);state.loaded=false;
      render();message(state.error,true);
    }
  }
  function showDialog(title,body) {
    const d=$('#modal');d.innerHTML=`<div class="dialog-top"><h2 id="dialog-title">${title}</h2>${button('✕','close','text','aria-label="關閉"')}</div>${body}`;
    if(!d.open)d.showModal();
  }
  function rules() {
    showDialog('座位使用規則',`<p class="small muted">以下為本系統設定，非館方正式公告；管理者上線前須確認適用性。</p><h2>1. 預約時間</h2><p>每日 08:00–22:00，以整點為單位；今天至未來 30 天可預約，不能預約已開始時段。每人每日累計最多 6 小時，不得同時預約多個座位。</p><h2>2. 網頁報到</h2><p>開始前 15 分鐘至開始後 15 分鐘內至「我的預約」報到。逾時未報到者不再占用座位，紀錄於下次查詢或預約時更新為逾時。</p><h2>3. 取消與離席</h2><p>待報到可取消；已報到可提前離席並釋出座位。提前離席仍以原預約時數計入每日上限。取消或逾時不計入上限。</p><h2>4. 閱覽禮儀</h2><p>保持安靜，避免飲食與影響其他使用者。此版本不提供暫離計時、校園單一登入或刷卡機驗證。</p><div class="actions">${button('我瞭解了','close','primary')}</div>`);
  }
  function authDialog(mode='login') {
    if(!client) {message('請先完成 config.js 與 setup.sql 的設定。',true);return;}
    const title=mode==='signup'?'註冊帳號':mode==='reset'?'忘記密碼':mode==='update'?'設定新密碼':'登入帳號';
    showDialog(title,`<p class="muted small">使用本系統的電子郵件帳號，並非校園入口網帳密。註冊是否開放由專案管理者設定。</p><form id="auth-form" data-mode="${mode}">${mode!=='update'?'<label class="field">電子郵件<input name="email" type="email" autocomplete="email" required maxlength="254"></label>':''}${mode!=='reset'?`<label class="field">${mode==='update'?'新密碼':'密碼'}<input name="password" type="password" autocomplete="${mode==='login'?'current-password':'new-password'}" minlength="8" required></label>`:''}<p id="dialog-message" role="status"></p><button type="submit" class="primary">${title}</button></form>${mode==='update'?'':`<div class="actions">${button('登入','auth-mode','text','data-mode="login"')}${button('註冊','auth-mode','text','data-mode="signup"')}${button('忘記密碼','auth-mode','text','data-mode="reset"')}</div>`}`);
  }
  async function authSubmit(form) {
    const btn=form.querySelector('[type=submit]');btn.disabled=true;
    const fields=new FormData(form),mode=form.dataset.mode;
    const email=String(fields.get('email')||'').trim(),password=String(fields.get('password')||'');
    const redirectTo=new URL('./',location.href).href;
    try {
      if(mode==='login') {
        const data=await result(client.auth.signInWithPassword({email,password}));
        state.session=data.session;$('#modal').close();message('已登入，選位資料已保留。');await refresh();
      } else if(mode==='signup') {
        const data=await result(client.auth.signUp({email,password,options:{emailRedirectTo:redirectTo}}));
        if(data.session){state.session=data.session;$('#modal').close();message('註冊成功，已登入。');await refresh();}
        else $('#dialog-message').textContent='已送出註冊申請。若需驗證，請至信箱開啟確認連結；如未收到，請聯絡專案管理者檢查寄信設定。';
      } else if(mode==='reset') {
        await result(client.auth.resetPasswordForEmail(email,{redirectTo}));
        $('#dialog-message').textContent='已送出重設申請。若帳號存在且寄信成功，請透過信件連結設定新密碼。';
      } else {
        await result(client.auth.updateUser({password}));recoveryMode=false;$('#modal').close();message('密碼已更新。');
      }
    } catch(err) {$('#dialog-message').textContent=errorText(err);}
    finally {btn.disabled=false;}
  }
  async function mutate(action,id) {
    requireBackend();if(state.busy)return;
    if(action==='book'&&(!state.session||!state.agreed||!state.seat||!draftValid())) throw new Error('請先登入、選擇有效座位與時間，並同意使用規則。');
    state.busy=true;document.body.classList.add('busy');
    try {
      if(action==='book') {
        const r=await result(client.rpc('ntut_book',{p_seat_id:state.seat,p_date:state.date,p_start:state.start,p_end:state.end}));
        state.latest=Array.isArray(r)?r[0]:r;state.seat=null;state.agreed=false;message('預約已儲存。');navigate('complete');
      } else {
        await result(client.rpc('ntut_change_reservation',{p_id:id,p_action:action}));
        message(action==='check-in'?'已完成網頁報到。':action==='finish'?'已辦理離席，座位已釋出。':'預約已取消。');
      }
      await refresh();
    } catch(err) {await refresh();throw err;}
    finally {state.busy=false;document.body.classList.remove('busy');render();}
  }
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-action]');if(!b||b.disabled)return;
    const action=b.dataset.action;
    try {
      if(action==='navigate') navigate(b.dataset.view);
      else if(action==='rules') rules();
      else if(action==='close') $('#modal').close();
      else if(action==='login') authDialog();
      else if(action==='auth-mode') authDialog(b.dataset.mode);
      else if(action==='logout') {requireBackend();await result(client.auth.signOut());state.session=null;state.mine=[];state.latest=null;message('已登出。');navigate('home');}
      else if(action==='refresh') {message();await refresh();}
      else if(action==='floor') {state.floor=b.dataset.floor;draftChanged();render();}
      else if(action==='zone') {state.zone=b.dataset.zone;draftChanged();render();}
      else if(action==='slot') {state.zone=b.dataset.zone;state.start=Number(b.dataset.hour);state.end=state.start+1;draftChanged();render();}
      else if(action==='seat') {state.seat=b.dataset.id;state.agreed=false;render();}
      else if(action==='to-seats') {if(!draftValid())throw new Error('請選擇有效的未來時段。');navigate('seat-map');}
      else if(action==='to-confirm') {if(!state.seat)throw new Error('請先選擇座位。');navigate('confirm');}
      else if(action==='filter') {state.filter=b.dataset.filter;render();}
      else if(action==='book'||action==='check-in') await mutate(action,b.dataset.id);
      else if(action==='cancel'||action==='finish') showDialog(action==='cancel'?'取消預約':'提前離席',`<p>${action==='cancel'?'確定取消這筆預約？座位將重新開放。':'確定結束使用並釋出座位？原預約時數仍計入每日上限。'}</p><div class="actions">${button('返回','close')}${button('確認','confirm-action','primary',`data-id="${esc(b.dataset.id)}" data-kind="${action}"`)}</div>`);
      else if(action==='confirm-action') {$('#modal').close();await mutate(b.dataset.kind,b.dataset.id);}
    } catch(err) {message(errorText(err),true);}
  });
  document.addEventListener('change',e=>{
    if(e.target.id==='agree') {state.agreed=e.target.checked;render();$('#agree')?.focus();return;}
    if(e.target.id==='booking-date') {
      if(!e.target.value||e.target.value<taipeiDate()||e.target.value>taipeiDate(30)){message('日期須在今天至未來 30 天內。',true);render();return;}
      state.date=e.target.value;state.loading=true;draftChanged();render();refresh();
    } else if(e.target.id==='start-hour') {state.start=Number(e.target.value);state.end=Math.max(state.start+1,Math.min(state.end,state.start+6,22));draftChanged();render();}
    else if(e.target.id==='end-hour') {state.end=Number(e.target.value);draftChanged();render();}
  });
  document.addEventListener('submit',e=>{if(e.target.id==='auth-form'){e.preventDefault();authSubmit(e.target);}});
  window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
  window.addEventListener('online',()=>refresh());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh({silent:true});});
  async function init() {
    if(configured&&window.supabase) {
      client=window.supabase.createClient(cfg.SUPABASE_URL.replace(/\/$/,''),cfg.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      client.auth.onAuthStateChange((event,session)=>{
        const changed=state.session?.user.id!==session?.user.id;
        state.session=session;
        // SDK auth callback 中不得等待另一個 auth 呼叫。
        if(event==='PASSWORD_RECOVERY') recoveryMode=true;
        setTimeout(()=>{if(changed){state.mine=[];state.latest=null;render();refresh();}renderHeader();if(recoveryMode)authDialog('update');},0);
      });
      try {const data=await result(client.auth.getSession());state.session=data.session;}catch(err){message(errorText(err),true);}
      channel=client.channel('ntut-public-changes').on('postgres_changes',{event:'UPDATE',schema:'public',table:'ntut_changes'},()=>{
        clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh({silent:true}),250);
      }).subscribe(status=>{$('#connection').textContent=status==='SUBSCRIBED'?'即時更新已連線 · 每 30 秒同步校正':'定時更新模式 · 每 30 秒同步';});
      await refresh();
    } else message('尚未設定 Supabase。請依 README 填寫 config.js，完成資料庫設定後重新載入。');
    const hash=location.hash.slice(1);
    if(hash.includes('error_description=')) {const p=new URLSearchParams(hash);message(p.get('error_description')||'驗證連結無效，請重新申請。',true);}
    navigate(steps.some(s=>s[0]===hash)||['home','my-reservations'].includes(hash)?hash:'home');
    if(recoveryMode)authDialog('update');
    setInterval(()=>{if(client)refresh({silent:true});},30000);
  }
  init().catch(err=>{message(errorText(err),true);render();});
})();
