<script>
  import { onMount, tick } from 'svelte';

  /* —— Storage / brand ——————————————————————————————— */
  const STORE        = 'tidbit-notes-v1';
  const STORE_OLD    = ['werq-notes-v3','werq-notes-v2','werq-notes-v1','werq-v1'];
  const ASKED        = 'tidbit-notif-asked';
  const ASKED_OLD    = ['werq-notif-asked'];

  const COLORS = [
    { key: 'default', name: 'Default' },
    { key: 'mint',    name: 'Mint'    },
    { key: 'sun',     name: 'Sun'     },
    { key: 'rose',    name: 'Rose'    },
    { key: 'lav',     name: 'Lavender'},
    { key: 'sky',     name: 'Sky'     },
    { key: 'slate',   name: 'Slate'   }
  ];

  /* —— Model ——————————————————————————————— */
  let notes = [];

  // Composer
  let c_title = '', c_type='html', c_html='', c_md='', c_tags=[], c_tagInput='', c_color='default', c_when='';
  let c_editor, c_file;

  // Edit
  let editingId = null;
  let e_title='', e_type='html', e_html='', e_md='', e_tags=[], e_tagInput='', e_color='default', e_when='';
  let e_editor, e_file;

  // Filters
  let query = '';
  let activeTag = '';

  // Notifications
  let permission = (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported';
  const timers = new Map();

  // Motion
  let allowMotion = true;
  const GS = () => window.gsap;  // <— always call GS() before using

  /* —— Utils ——————————————————————————————— */
  const save = () => localStorage.setItem(STORE, JSON.stringify(notes));

  const strip = (html) => (html || '').replace(/<[^>]+>/g, ' ');
  const textOf = (n) => (n.title + ' ' + (n.type === 'md' ? n.content : strip(n.content)) + ' ' + n.tags.join(' ')).toLowerCase();
  const toISO = (local) => local ? new Date(local).toISOString() : null;
  const pretty = (iso) => iso ? new Date(iso).toLocaleString() : '';

  function toLocal(iso) {
    if (!iso) return '';
    const d = new Date(iso); if (Number.isNaN(d)) return '';
    const p = (n)=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // Enforce YYYY only (4 digits), clamp to 1900..9999
  function enforceFourDigitYear(v) {
    if (!v) return '';
    const m = v.match(/^(\d{1,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!m) return v;
    let [_, y, mo, d, h, mi] = m;
    y = y.slice(0, 4);
    const yi = Math.min(9999, Math.max(1900, parseInt(y, 10) || 1900));
    return `${String(yi).padStart(4,'0')}-${mo}-${d}T${h}:${mi}`;
  }

  function renderHTML(n){
    try { return n?.type === 'md' && window.marked ? window.marked.parse(n.content || '') : (n?.content || ''); }
    catch { return n?.content || ''; }
  }

  /* —— Lifecycle ——————————————————————————————— */
  onMount(async () => {
    // persistent storage
    try {
      if (navigator.storage?.persist) {
        const p = await navigator.storage.persisted();
        if (!p) await navigator.storage.persist();
      }
    } catch {}

    // load (migrate from old keys if needed)
    let raw = localStorage.getItem(STORE);
    if (!raw) {
      for (const k of STORE_OLD) { const r = localStorage.getItem(k); if (r) { raw = r; break; } }
    }
    try { notes = JSON.parse(raw || '[]'); } catch { notes = []; }

    notes = notes.map(n => ({
      id: n.id ?? Date.now() + Math.random(),
      title: n.title ?? '(untitled)',
      content: n.content ?? n.contentHTML ?? '',
      type: n.type ?? (n.contentHTML ? 'html' : 'md'),
      tags: Array.isArray(n.tags) ? n.tags : [],
      color: n.color ?? 'default',
      pinned: !!n.pinned,
      done: !!n.done,
      remindAt: n.remindAt ?? null,
      reminded: !!n.reminded
    }));
    save(); // persist under new key

    // motion pref
    const m = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    allowMotion = !(m && m.matches);

    // ask notifications once (respect old flag)
    const asked = localStorage.getItem(ASKED) || ASKED_OLD.some(k => localStorage.getItem(k));
    if (typeof Notification !== 'undefined' && Notification.permission === 'default' && !asked) {
      setTimeout(async () => {
        try { permission = await Notification.requestPermission(); }
        finally { localStorage.setItem(ASKED, '1'); }
      }, 600);
    }

    // schedule reminders
    notes.forEach(scheduleOne);

    // entrance animations (cards only; ambient blobs removed)
    window.addEventListener('load', () => {
      if (allowMotion && GS()) {
        const g = GS();
        g.from('.brand',   { y: 8,  opacity: 0, duration: .45, ease: 'power2.out' });
        g.from('.composer',{ y: 12, opacity: 0, duration: .45, ease: 'power2.out', delay: .05 });
        g.from('.board',   { y: 12, opacity: 0, duration: .45, ease: 'power2.out', delay: .08 });
        if (notes.length) g.from('.card', { y: 8, opacity: 0, duration: .32, stagger: .035, ease: 'power2.out', delay: .12 });
      }
    });
  });

  /* —— Derived ——————————————————————————————— */
  $: allTags = Array.from(new Set(notes.flatMap(n => n.tags))).sort((a,b)=>a.localeCompare(b));
  $: filtered = notes
    .filter(n => activeTag ? n.tags.includes(activeTag) : true)
    .filter(n => !query.trim() ? true : textOf(n).includes(query.trim().toLowerCase()))
    .sort((a,b) => (b.pinned - a.pinned)
       || ((a.remindAt?new Date(a.remindAt):Infinity) - (b.remindAt?new Date(b.remindAt):Infinity))
       || (b.id - a.id));

  /* —— Tag helpers ——————————————————————————————— */
  function addTagFromInput(where) {
    const src = where === 'c' ? c_tagInput : e_tagInput;
    const tag = (src || '').trim().replace(/\s+/g, '-').toLowerCase();
    if (!tag) return;
    if (where === 'c') { if (!c_tags.includes(tag)) c_tags = [...c_tags, tag]; c_tagInput=''; }
    else               { if (!e_tags.includes(tag)) e_tags = [...e_tags, tag]; e_tagInput=''; }
  }
  const removeTag = (where, idx) => { if (where==='c') c_tags = c_tags.filter((_,i)=>i!==idx); else e_tags = e_tags.filter((_,i)=>i!==idx); };

  /* —— Editor sync ——————————————————————————————— */
  const syncCHTML = () => c_html = c_editor?.innerHTML || '';
  const syncEHTML = () => e_html = e_editor?.innerHTML || '';

  /* —— Create / edit ——————————————————————————————— */
  function addNote(){
    const title = c_title.trim() || '(untitled)';
    const content = (c_type === 'md') ? c_md : (c_editor?.innerHTML || c_html || '');
    const n = { id: Date.now(), title, content, type: c_type, tags:[...c_tags], color:c_color, pinned:false, done:false, remindAt: toISO(c_when), reminded:false };
    notes = [n, ...notes]; save(); scheduleOne(n);
    c_title=''; c_md=''; c_html=''; c_tags=[]; c_tagInput=''; c_color='default'; c_when=''; if (c_editor) c_editor.innerHTML='';
    if (allowMotion && GS()) tick().then(()=> GS().from(`#n-${n.id}`, { y:12, opacity:0, scale:.98, duration:.33, ease:'power2.out' }));
  }

  const togglePin  = (n) => { n.pinned = !n.pinned; save(); notes=[...notes]; };
  const toggleDone = (n) => { n.done   = !n.done;   save(); notes=[...notes]; };
  function removeNote(n){
    const id = `#n-${n.id}`;
    const doRemove = () => { cancelTimer(n.id); notes = notes.filter(x=>x.id!==n.id); save(); };
    if (!allowMotion || !GS() || !document.querySelector(id)) return doRemove();
    GS().to(id, { y: 10, opacity: 0, duration: .18, ease:'power1.in', onComplete: doRemove });
  }

  async function startEdit(n){
    editingId = n.id;
    e_title=n.title; e_type=n.type; e_color=n.color; e_tags=[...n.tags]; e_when=toLocal(n.remindAt);
    if (n.type==='md'){ e_md=n.content; e_html=''; } else { e_html=n.content; e_md=''; }
    await tick();
    if (e_type==='html' && e_editor){
  e_editor.innerHTML = e_html;
  e_editor.focus();
}
    if (allowMotion && GS()) GS().from(`#n-${n.id} .toolbar .icon`, { opacity:0, y:6, scale:.96, duration:.22, stagger:.03 });
  }
  function cancelEdit(){ editingId=null; e_title=''; e_type='html'; e_html=''; e_md=''; e_tags=[]; e_tagInput=''; e_color='default'; e_when=''; }
  function saveEdit(){
    const idx = notes.findIndex(x=>x.id===editingId); if (idx===-1) return cancelEdit();
    const n = notes[idx];
    n.title=(e_title||'(untitled)').trim(); n.type=e_type;
    n.content=(e_type==='md')?e_md:(e_editor?e_editor.innerHTML:e_html);
    n.tags=[...e_tags]; n.color=e_color; n.remindAt=toISO(e_when);
    if (n.remindAt && new Date(n.remindAt)>new Date()) n.reminded=false;
    save(); scheduleOne(n); cancelEdit(); notes=[...notes];
  }

  /* —— RTE helpers ——————————————————————————————— */
  // Safer, no styleWithCSS toggle, plus a small manual fallback for inline tags.
function exec(el, cmd, val = null) {
  if (!el) return;
  el.focus();

  const manualInline = () => {
    // Only attempt manual wrap for simple inline formats
    const map = { bold: 'strong', italic: 'em', underline: 'u' };
    const tag = map[cmd];
    if (!tag) return;

    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    // Only act if the selection is inside our editor
    if (!el.contains(range.commonAncestorContainer)) return;

    // Avoid DOMException when selection spans complex nodes
    if (range.collapsed) return;

    try {
      const wrapper = document.createElement(tag);
      range.surroundContents(wrapper);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      // Fallback insert if surroundContents can't split nodes safely
      const wrapper = document.createElement(tag);
      wrapper.appendChild(range.extractContents());
      range.insertNode(wrapper);
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(wrapper);
      r.collapse(false);
      sel.addRange(r);
    }
  };

  try {
    const ok = document.execCommand(cmd, false, val);
    if (!ok) manualInline();
  } catch {
    manualInline();
  }
}

  const setBlock = (el, tag) => exec(el,'formatBlock',tag);
  function makeLink(el){ let url=prompt('Enter URL (https://...)'); if(!url) return; if(!/^https?:\/\//i.test(url)) url='https://'+url; exec(el,'createLink',url); }
  const unlink = (el) => exec(el,'unlink');
  function insertImageURL(el){ const url=prompt('Image URL'); if(!url) return; exec(el,'insertImage',url); }
  const openFile = (ref) => ref?.click();
  function insertImageFile(el, e){ const f=e.target.files?.[0]; e.target.value=''; if(!f) return; const r=new FileReader(); r.onload=()=>exec(el,'insertImage',r.result); r.readAsDataURL(f); }

  /* —— Markdown helpers ——————————————————————————————— */
  function mdWrap(which, L, R){ if(which==='c') c_md = `${c_md}${L}${R}`; else e_md = `${e_md}${L}${R}`; }

  /* —— Notifications ——————————————————————————————— */
  async function testNotification(){
    if (typeof Notification==='undefined'){ alert('Notifications not supported.'); return; }
    if (permission!=='granted'){ try{ permission = await Notification.requestPermission(); }catch{ permission = Notification.permission; } }
    if (permission!=='granted'){ alert('Please allow notifications in site settings.'); return; }
    try{
      if('serviceWorker' in navigator){ const reg=await navigator.serviceWorker.ready; await reg.showNotification('🔔 TidBit Test', { body:'This is how reminders will appear.', tag:'tidbit-test', renotify:true }); }
      else { new Notification('🔔 TidBit Test', { body:'This is how reminders will appear.' }); }
    }catch{ alert('Test: This is how reminders will appear.'); }
  }
  async function fireReminder(n){
    const body=n.title||'Note due';
    if (typeof Notification==='undefined' || Notification.permission!=='granted'){ alert('Reminder: '+body); return; }
    try{
      if('serviceWorker' in navigator){ const reg=await navigator.serviceWorker.ready; await reg.showNotification('⏰ Reminder', { body, tag:'note-'+n.id, renotify:true }); }
      else { new Notification('⏰ Reminder', { body }); }
      n.reminded=true; save(); notes=[...notes];
    }catch{ alert('Reminder: '+body); }
  }

  /* —— Scheduling ——————————————————————————————— */
  function scheduleOne(n){
    cancelTimer(n.id);
    if(!n.remindAt || n.done || n.reminded) return;
    const ms=new Date(n.remindAt).getTime()-Date.now();
    if(ms<=0){ fireReminder(n); n.reminded=true; save(); notes=[...notes]; return; }
    const id=setTimeout(()=>{ fireReminder(n); n.reminded=true; save(); notes=[...notes]; }, Math.min(ms, 2147483647));
    timers.set(n.id, id);
  }
  function cancelTimer(id){ const h=timers.get(id); if(h){ clearTimeout(h); timers.delete(id); } }

  /* —— Hover micro ——————————————————————————————— */
  function hoverUp(e){ if(!allowMotion || !GS()) return; GS().to(e.currentTarget,{ y:-2, scale:1.01, duration:.18, ease:'power2.out' }); }
  function hoverDown(e){ if(!allowMotion || !GS()) return; GS().to(e.currentTarget,{ y:0,  scale:1.00, duration:.22, ease:'power2.out' }); }
</script>

<div class="page">
  <a class="skip" href="#board">Skip to content</a>

  <header class="head glass">
    <div class="brand">
      <div class="logo"><img src="tidbit.svg" alt="TidBit" style="width: 28px;"></div>
      <h1>TidBit</h1>
    </div>

    <div class="head-actions">
      <div class="search">
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <input type="search" placeholder="Search title, content or tags…" bind:value={query} aria-label="Search notes" />
      </div>
      <button class="btn ghost" on:click={testNotification} title="Test notifications">
        <i class="fa-solid fa-bell"></i>
      </button>
    </div>
  </header>

  <!-- Composer -->
  <section class="composer glass">
    <div class="row">
      <input class="field title" placeholder="Title…" bind:value={c_title} aria-label="Title" />
      <div class="mode">
        <button class="tab" class:active={c_type==='html'} type="button" on:click={()=>c_type='html'} title="Rich text"><i class="fa-solid fa-font"></i></button>
        <button class="tab" class:active={c_type==='md'}   type="button" on:click={()=>c_type='md'}   title="Markdown"><i class="fa-solid fa-code"></i></button>
      </div>
    </div>

    {#if c_type === 'html'}
      <div class="toolbar" role="toolbar" aria-label="Rich formatting">
        <button class="icon" type="button" title="Bold" on:click={()=>exec(c_editor,'bold')}><i class="fa-solid fa-bold"></i></button>
        <button class="icon" type="button" title="Italic" on:click={()=>exec(c_editor,'italic')}><i class="fa-solid fa-italic"></i></button>
        <button class="icon" type="button" title="Underline" on:click={()=>exec(c_editor,'underline')}><i class="fa-solid fa-underline"></i></button>
        <span class="sep"></span>
        <button class="icon" type="button" title="H1" on:click={()=>setBlock(c_editor,'H1')}><i class="fa-solid fa-heading"></i></button>
        <button class="icon" type="button" title="Paragraph" on:click={()=>setBlock(c_editor,'P')}><i class="fa-solid fa-paragraph"></i></button>
        <button class="icon" type="button" title="Quote" on:click={()=>setBlock(c_editor,'BLOCKQUOTE')}><i class="fa-solid fa-quote-right"></i></button>
        <span class="sep"></span>
        <button class="icon" type="button" title="Bulleted list" on:click={()=>exec(c_editor,'insertUnorderedList')}><i class="fa-solid fa-list-ul"></i></button>
        <button class="icon" type="button" title="Numbered list" on:click={()=>exec(c_editor,'insertOrderedList')}><i class="fa-solid fa-list-ol"></i></button>
        <span class="sep"></span>
        <button class="icon" type="button" title="Align left" on:click={()=>exec(c_editor,'justifyLeft')}><i class="fa-solid fa-align-left"></i></button>
        <button class="icon" type="button" title="Align center" on:click={()=>exec(c_editor,'justifyCenter')}><i class="fa-solid fa-align-center"></i></button>
        <button class="icon" type="button" title="Align right" on:click={()=>exec(c_editor,'justifyRight')}><i class="fa-solid fa-align-right"></i></button>
        <span class="sep"></span>
        <button class="icon" type="button" title="Link" on:click={()=>makeLink(c_editor)}><i class="fa-solid fa-link"></i></button>
        <button class="icon" type="button" title="Unlink" on:click={()=>unlink(c_editor)}><i class="fa-solid fa-link-slash"></i></button>
        <span class="sep"></span>
        <button class="icon" type="button" title="Image URL" on:click={()=>insertImageURL(c_editor)}><i class="fa-solid fa-image"></i></button>
        <button class="icon" type="button" title="Upload image" on:click={()=>openFile(c_file)}><i class="fa-solid fa-upload"></i></button>
        <input class="hidden-file" type="file" accept="image/*" bind:this={c_file} on:change={(e)=>insertImageFile(c_editor,e)} />
      </div>
      <div class="editor" contenteditable="true" bind:this={c_editor} on:input={syncCHTML} spellcheck="true" aria-label="Note content (rich)"></div>
    {:else}
      <div class="toolbar" role="toolbar" aria-label="Markdown helpers">
        <button class="icon" type="button" title="Bold" on:click={()=>mdWrap('c','**','**')}><i class="fa-solid fa-bold"></i></button>
        <button class="icon" type="button" title="Italic" on:click={()=>mdWrap('c','_','_')}><i class="fa-solid fa-italic"></i></button>
        <button class="icon" type="button" title="Link" on:click={()=>mdWrap('c','[text](',' )')}><i class="fa-solid fa-link"></i></button>
        <button class="icon" type="button" title="Image" on:click={()=>mdWrap('c','![alt](',' )')}><i class="fa-solid fa-image"></i></button>
        <button class="icon" type="button" title="Code" on:click={()=>mdWrap('c','`','`')}><i class="fa-solid fa-code"></i></button>
        <button class="icon" type="button" title="Quote" on:click={()=>mdWrap('c','> ','')}><i class="fa-solid fa-quote-right"></i></button>
        <button class="icon" type="button" title="List" on:click={()=>mdWrap('c','- ','')}><i class="fa-solid fa-list-ul"></i></button>
      </div>
      <textarea class="mdarea" bind:value={c_md} placeholder="Write Markdown…" aria-label="Note content (markdown)"></textarea>
    {/if}

    <div class="meta-row">
      <div class="palette">
        {#each COLORS as c}
          <button type="button" class="swatch" class:active={c_color===c.key} data-color={c.key} on:click={()=>c_color=c.key} title={c.name}></button>
        {/each}
      </div>

      <div class="tagger">
        {#each c_tags as t, i}
          <button type="button" class="tag" title="Filter by tag" on:click={()=>activeTag=t}>
            #{t}
            <span class="x" aria-hidden="true" on:click={(ev)=>{ ev.stopPropagation(); removeTag('c', i); }}><i class="fa-solid fa-xmark"></i></span>
          </button>
        {/each}
        <input type="text" placeholder="Add tag and press Enter" bind:value={c_tagInput}
               on:keydown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); addTagFromInput('c'); } }}
               aria-label="Add tag" />
      </div>

      <div class="when">
        <i class="fa-solid fa-clock" aria-hidden="true"></i>
        <input type="datetime-local"
               min="1900-01-01T00:00" max="9999-12-31T23:59"
               on:blur={(e)=> c_when = enforceFourDigitYear(e.target.value)}
               on:change={(e)=> c_when = enforceFourDigitYear(e.target.value)}
               bind:value={c_when} aria-label="Reminder date & time" />
      </div>

      <div class="actions">
        <button class="btn primary" type="button" on:click={addNote}><i class="fa-solid fa-plus"></i><span>Add</span></button>
      </div>
    </div>
  </section>

  <!-- Tag filter -->
  <nav class="tags glass">
    <button class="chip" class:active={!activeTag} on:click={()=>activeTag=''}>All</button>
    {#each allTags as t}
      <button class="chip" class:active={activeTag===t} on:click={()=>activeTag = (activeTag===t?'':t)}>#{t}</button>
    {/each}
  </nav>

  <!-- Board -->
  <section id="board" class="board">
    {#if filtered.length === 0}
      <p class="empty">No notes match your filters.</p>
    {:else}
      <div class="masonry">
        {#each filtered as n (n.id)}
          <article id={"n-"+n.id} class="card" data-color={n.color} on:mouseenter={hoverUp} on:mouseleave={hoverDown}>
            <header class="card-head">
              <div class="title-line">
                <input type="checkbox" checked={n.done} on:change={()=>toggleDone(n)} aria-label="Mark as done" />
                <h3 class:done={n.done}>{n.title}</h3>
              </div>
              <div class="card-actions">
                <button class="icon" title={n.pinned?'Unpin':'Pin'} on:click={()=>togglePin(n)}><i class="fa-solid fa-thumbtack"></i></button>
                <button class="icon" title="Remind now" on:click={()=>fireReminder(n)}><i class="fa-solid fa-bell"></i></button>
                {#if editingId !== n.id}
                  <button class="icon" title="Edit" on:click={()=>startEdit(n)}><i class="fa-solid fa-pen"></i></button>
                {/if}
                <button class="icon danger" title="Delete" on:click={()=>removeNote(n)}><i class="fa-solid fa-trash"></i></button>
              </div>
            </header>

            {#if n.remindAt || n.pinned || n.reminded}
              <div class="chips">
                {#if n.pinned}<span class="chip small"><i class="fa-solid fa-thumbtack"></i> pinned</span>{/if}
                {#if n.remindAt}<span class="chip small"><i class="fa-solid fa-clock"></i> {pretty(n.remindAt)}</span>{/if}
                {#if n.reminded}<span class="chip small"><i class="fa-solid fa-bell"></i> notified</span>{/if}
              </div>
            {/if}

            {#if editingId === n.id}
              <div class="edit">
                <input class="field title" placeholder="Title…" bind:value={e_title} />

                <div class="row spread">
                  <div class="mode">
                    <button class="tab" class:active={e_type==='html'} type="button" title="Rich text"
                      on:click={async ()=>{ e_type='html'; await tick(); if(e_editor){ e_editor.innerHTML=e_html; e_editor.focus(); try{document.execCommand('styleWithCSS',false,true);}catch{} }}}>
                      <i class="fa-solid fa-font"></i>
                    </button>
                    <button class="tab" class:active={e_type==='md'} type="button" title="Markdown" on:click={()=>e_type='md'}>
                      <i class="fa-solid fa-code"></i>
                    </button>
                  </div>

                  <div class="palette small">
                    {#each COLORS as c}
                      <button type="button" class="swatch" class:active={e_color===c.key} data-color={c.key} on:click={()=>e_color=c.key} title={c.name}></button>
                    {/each}
                  </div>
                </div>

                {#if e_type === 'html'}
                  <div class="toolbar" role="toolbar" aria-label="Rich formatting">
                    <button class="icon" type="button" title="Bold" on:click={()=>exec(e_editor,'bold')}><i class="fa-solid fa-bold"></i></button>
                    <button class="icon" type="button" title="Italic" on:click={()=>exec(e_editor,'italic')}><i class="fa-solid fa-italic"></i></button>
                    <button class="icon" type="button" title="Underline" on:click={()=>exec(e_editor,'underline')}><i class="fa-solid fa-underline"></i></button>
                    <span class="sep"></span>
                    <button class="icon" type="button" title="H1" on:click={()=>setBlock(e_editor,'H1')}><i class="fa-solid fa-heading"></i></button>
                    <button class="icon" type="button" title="Paragraph" on:click={()=>setBlock(e_editor,'P')}><i class="fa-solid fa-paragraph"></i></button>
                    <button class="icon" type="button" title="Quote" on:click={()=>setBlock(e_editor,'BLOCKQUOTE')}><i class="fa-solid fa-quote-right"></i></button>
                    <span class="sep"></span>
                    <button class="icon" type="button" title="Bulleted list" on:click={()=>exec(e_editor,'insertUnorderedList')}><i class="fa-solid fa-list-ul"></i></button>
                    <button class="icon" type="button" title="Numbered list" on:click={()=>exec(e_editor,'insertOrderedList')}><i class="fa-solid fa-list-ol"></i></button>
                    <span class="sep"></span>
                    <button class="icon" type="button" title="Align left" on:click={()=>exec(e_editor,'justifyLeft')}><i class="fa-solid fa-align-left"></i></button>
                    <button class="icon" type="button" title="Align center" on:click={()=>exec(e_editor,'justifyCenter')}><i class="fa-solid fa-align-center"></i></button>
                    <button class="icon" type="button" title="Align right" on:click={()=>exec(e_editor,'justifyRight')}><i class="fa-solid fa-align-right"></i></button>
                    <span class="sep"></span>
                    <button class="icon" type="button" title="Link" on:click={()=>makeLink(e_editor)}><i class="fa-solid fa-link"></i></button>
                    <button class="icon" type="button" title="Unlink" on:click={()=>unlink(e_editor)}><i class="fa-solid fa-link-slash"></i></button>
                    <span class="sep"></span>
                    <button class="icon" type="button" title="Image URL" on:click={()=>insertImageURL(e_editor)}><i class="fa-solid fa-image"></i></button>
                    <button class="icon" type="button" title="Upload image" on:click={()=>openFile(e_file)}><i class="fa-solid fa-upload"></i></button>
                    <input class="hidden-file" type="file" accept="image/*" bind:this={e_file} on:change={(e)=>insertImageFile(e_editor,e)} />
                  </div>
                  <div class="editor" contenteditable="true" bind:this={e_editor} on:input={syncEHTML} spellcheck="true"></div>
                {:else}
                  <div class="toolbar" role="toolbar" aria-label="Markdown helpers">
                    <button class="icon" type="button" title="Bold" on:click={()=>mdWrap('e','**','**')}><i class="fa-solid fa-bold"></i></button>
                    <button class="icon" type="button" title="Italic" on:click={()=>mdWrap('e','_','_')}><i class="fa-solid fa-italic"></i></button>
                    <button class="icon" type="button" title="Link" on:click={()=>mdWrap('e','[text](',' )')}><i class="fa-solid fa-link"></i></button>
                    <button class="icon" type="button" title="Image" on:click={()=>mdWrap('e','![alt](',' )')}><i class="fa-solid fa-image"></i></button>
                    <button class="icon" type="button" title="Code" on:click={()=>mdWrap('e','`','`')}><i class="fa-solid fa-code"></i></button>
                    <button class="icon" type="button" title="Quote" on:click={()=>mdWrap('e','> ','')}><i class="fa-solid fa-quote-right"></i></button>
                    <button class="icon" type="button" title="List" on:click={()=>mdWrap('e','- ','')}><i class="fa-solid fa-list-ul"></i></button>
                  </div>
                  <textarea class="mdarea" bind:value={e_md} placeholder="Write Markdown…"></textarea>
                {/if}

                <div class="meta-row edit-grid">
                  <div class="tagger">
                    {#each e_tags as t, i}
                      <button type="button" class="tag" title="Filter by tag" on:click={()=>activeTag=t}>
                        #{t}
                        <span class="x" aria-hidden="true" on:click={(ev)=>{ ev.stopPropagation(); removeTag('e', i); }}><i class="fa-solid fa-xmark"></i></span>
                      </button>
                    {/each}
                    <input type="text" placeholder="Add tag and press Enter" bind:value={e_tagInput}
                           on:keydown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); addTagFromInput('e'); } }} />
                  </div>

                  <div class="when">
                    <i class="fa-solid fa-clock"></i>
                    <input type="datetime-local"
                           min="1900-01-01T00:00" max="9999-12-31T23:59"
                           on:blur={(e)=> e_when = enforceFourDigitYear(e.target.value)}
                           on:change={(e)=> e_when = enforceFourDigitYear(e.target.value)}
                           bind:value={e_when} />
                  </div>

                  <div class="actions">
                    <button class="btn primary" type="button" on:click={saveEdit}><i class="fa-solid fa-check"></i><span>Save</span></button>
                    <button class="btn ghost" type="button" on:click={cancelEdit}><i class="fa-solid fa-xmark"></i><span>Cancel</span></button>
                  </div>
                </div>
              </div>
            {:else}
              <section class="content">
                <div class="note">{@html renderHTML(n)}</div>
                {#if n.tags.length}
                  <div class="tagsline">
                    {#each n.tags as t}
                      <button type="button" class="tag small" title="Filter by tag" on:click={()=>activeTag=t}>#{t}</button>
                    {/each}
                  </div>
                {/if}
              </section>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>

  <footer class="foot">
    <p>Made with <span aria-label="love">❤️</span> by <a href="https://harsh98trivedi.github.io/" target="_blank" rel="noopener">Harsh Trivedi</a></p>
  </footer>
</div>

<style>
  :global(*){ box-sizing: border-box; }
  :global(html, body, #app){ height:100%; margin:0; }

  .page{
    min-height:100vh;
    display:block;
    padding:16px;
    color:#e6ecf4;
    background:radial-gradient(1200px 800px at 20% -10%, #16233f 0%, #0c1425 40%, #070c16 100%);
    position:relative;
    z-index:1;
    place-content: center;
  }

  .glass{
    background:linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.06));
    border:1px solid rgba(255,255,255,.12);
    backdrop-filter: blur(16px) saturate(140%);
    box-shadow:0 12px 34px rgba(0,0,0,.28);
    border-radius:16px;
  }

  /* —— Header —— */
  .head, .composer, .tags, .board, .foot { width:min(1200px,100%); margin-inline:auto; }
  #board .empty{ text-align:center; }

  .head{
    display:flex; align-items:center; justify-content:space-between;
    padding:10px 14px; margin-bottom:12px; gap:10px; flex-wrap:wrap;
  }
  .brand{ display:flex; align-items:center; gap:10px; }
  .logo{
    width:28px; height:28px; display:grid; place-items:center;
    background: radial-gradient(60% 60% at 50% 30%, #88e5ff 0%, transparent 60%),
                linear-gradient(180deg, rgba(34,211,238,.4), rgba(34,211,238,.15));
    color:#001018; border-radius:100%;
  }
  h1{ margin:0; font-weight:800; font-size:18px; letter-spacing:.6px; }

  .head-actions{ display:flex; gap:8px; align-items:center; }
  .search{
    display:flex; align-items:center; gap:8px; padding:8px 10px;
    border-radius:12px; border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.08);
  }
  .search input{ border:none; outline:none; background:transparent; color:#e6ecf4; width:240px; }
  .search input::placeholder{ color:#9ab0c6; }

  .btn{
    display:inline-flex; align-items:center; gap:8px; padding:10px 14px;
    border-radius:12px; border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.08); color:#e6ecf4; cursor:pointer;
  }
  .btn:hover{ background:rgba(255,255,255,.14); }
  .btn:focus-visible{ outline:2px solid rgba(34,211,238,.55); outline-offset:2px; }
  .btn.primary{ background:#22d3ee; color:#061018; border-color:transparent; }
  .btn.primary:hover{ filter:brightness(1.05); }
  .btn.ghost{ background:rgba(255,255,255,.08); }

  /* —— Composer —— */
  .composer{ padding:14px; }
  .row{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .row.spread{ display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  .field.title{
    flex:1 1 220px; padding:12px 14px; border-radius:12px; border:1px solid rgba(255,255,255,.12);
    background:rgba(7,11,22,.85); color:#e6ecf4; min-height:40px;
  }
  .field.title::placeholder{ color:#8da2bb; }

  .mode{ display:flex; gap:6px; margin: 0.25rem 0;}
  .tab{
    width:38px; height:38px; display:grid; place-items:center; border-radius:11px; border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.08); color:#e6ecf4; cursor:pointer;
  }
  .tab.active{ background:#22d3ee; border-color:transparent; color:#061018; }

  .toolbar{ display:flex; flex-wrap:wrap; gap:8px; padding:8px; margin-top:8px; border-radius:12px; background:rgba(7,11,22,.85); border:1px solid rgba(255,255,255,.12); }
  .icon{
    width:38px; height:38px; display:grid; place-items:center; border-radius:11px; border:1px solid rgba(255,255,255,.12);
    background:rgba(255,255,255,.08); color:#e6ecf4; cursor:pointer;
  }
  .icon:hover{ background:rgba(255,255,255,.14); }
  .icon.danger{ color:#ffd9d9; background:rgba(255,0,0,.06); border-color:rgba(255,0,0,.18); }
  .sep{ width:1px; height:24px; background:rgba(255,255,255,.15); align-self:center; }

  .editor{
    min-height:140px; padding:12px; margin-top:8px; border-radius:12px;
    background:rgba(7,11,22,.85); border:1px solid rgba(255,255,255,.12); outline:none;
  }
  .editor:empty:before{ content:"Write your note…"; color:#8da2bb; }
  .mdarea{
    width:100%; min-height:140px; padding:12px; margin-top:8px; border-radius:12px;
    background:rgba(7,11,22,.85); border:1px solid rgba(255,255,255,.12); color:#e6ecf4; resize:vertical;
  }

  .palette{ display:flex; gap:6px; align-items:center; justify-content: space-around; }
  .palette.small .swatch{ width:22px; height:22px; }
  .swatch{
    width:26px; height:26px; border-radius:8px; border:1px solid rgba(255,255,255,.15); cursor:pointer;
    background:rgba(255,255,255,.07);
  }
  .swatch.active{ outline:2px solid rgba(34,211,238,.55); outline-offset:2px; }

  .tagger{ display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
  .tagger input{
    padding:8px 10px; border-radius:10px; border:1px solid rgba(255,255,255,.12);
    background:rgba(7,11,22,.85); color:#e6ecf4; min-width:160px; flex:1 1 160px;
  }
  .tag{ display:inline-flex; align-items:center; gap:6px; border-radius:999px; font-size:12px; padding:6px 10px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.08); color:#cfe8ff; cursor:pointer; }
  .tag .x{ display:inline-grid; place-items:center; margin-left:4px; }

  .when{ display:flex; align-items:center; gap:8px; color:#cfe8ff; }
  .when input{ padding:8px 10px; border-radius:10px; border:1px solid rgba(255,255,255,.12); background:rgba(7,11,22,.85);; color:#e6ecf4; }
  input[type="datetime-local"]::-webkit-calendar-picker-indicator {
       color-scheme: dark;
    }


  /* Wider tagger column in the composer; collapses on narrow viewports */
  .meta-row{
    display:grid; grid-template-columns: 1fr 3fr auto auto; gap:10px; align-items:center; margin-top:10px;
  }
  @media (max-width: 960px){
    .meta-row{ grid-template-columns: 1fr; }
  }

  /* —— EDIT MODE —— */
  .edit .field.title {
    width: 100%;
    display: block;
    margin: 6px 0 10px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,.12);
    background: rgba(7,11,22,.85);
    color: #e6ecf4;
    font-weight: 700;
  }
  .edit .field.title::placeholder { color: #8da2bb; }
  .edit-grid{ grid-template-columns: 1fr; }

  /* —— Tags row & chips —— */
  .tags{ padding:8px 12px; display:flex; gap:8px; flex-wrap:wrap; margin:12px auto; }
  .chip{ padding:6px 12px; border-radius:999px; font-weight:600; font-size:13px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12); color:#cfe8ff; cursor:pointer; }
  .chip.active{ background:#22d3ee; border-color:transparent; color:#061018; }

  /* —— Board / Cards —— */
  .board{ width:min(1200px,100%); }
  .masonry{ display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:12px; }
  @media (max-width: 360px){
    .masonry{ grid-template-columns: 1fr; }
    .toolbar { justify-content: space-around;}
  }

  .card{
    padding:12px; border-radius:14px;
    border:1px solid rgba(255,255,255,.12);
    background:linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.05));
    box-shadow:0 8px 20px rgba(0,0,0,.24);
    overflow:hidden;
  }
  [data-color="mint"]  { background:linear-gradient(180deg, rgba(16,185,129,.18), rgba(16,185,129,.06)); }
  [data-color="sun"]   { background:linear-gradient(180deg, rgba(234,179,8,.22), rgba(234,179,8,.08)); }
  [data-color="rose"]  { background:linear-gradient(180deg, rgba(244,63,94,.18), rgba(244,63,94,.06)); }
  [data-color="lav"]   { background:linear-gradient(180deg, rgba(168,85,247,.20), rgba(168,85,247,.07)); }
  [data-color="sky"]   { background:linear-gradient(180deg, rgba(14,165,233,.20), rgba(14,165,233,.07)); }
  [data-color="slate"] { background:linear-gradient(180deg, rgba(100,116,139,.22), rgba(100,116,139,.09)); }

  .card-head{ display:flex; align-items:flex-start; justify-content:space-between; gap:8px; flex-wrap:wrap; }
  .title-line{ display:flex; align-items:center; gap:8px; flex:1 1 auto; min-width:160px; }
  .title-line h3{ margin:0; font-size:16px; font-weight:800; }
  .title-line h3.done{ text-decoration:line-through; color:#9fb2c7; font-family:"Fira Code", ui-monospace, Menlo, Consolas, "Liberation Mono", monospace; }

  .card-actions{ display:flex; gap:6px; flex-wrap:wrap; }
  .card .icon{ width:34px; height:34px; display:grid; place-items:center; border-radius:10px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12); color:#e6ecf4; cursor:pointer; }
  .card .icon:hover{ background:rgba(255,255,255,.14); }
  .card .icon.danger{ color:#ffd9d9; background:rgba(255,0,0,.06); border-color:rgba(255,0,0,.18); }
  .card .fa-thumbtack{ transform: rotate(25deg); }

  .chips{ display:flex; flex-wrap:wrap; gap:8px; margin:8px 0 0 24px; }
  .chip.small{ padding:2px 8px; font-size:12px; }

  .content .note{ margin:8px 0 0 24px; }
  .tagsline{ display:flex; flex-wrap:wrap; gap:6px; margin:8px 0 0 24px; }

  /* —— Footer —— */
  .foot{ text-align:center; color:#9fb2c7; margin-top:12px; padding:10px 14px; }
  .foot a{ color:#22d3ee; text-decoration:none; }

  /* —— Accessibility skip link —— */
  .skip{ position:absolute; left:-9999px; top:auto; width:1px; height:1px; overflow:hidden; }
  .skip:focus{ position:fixed; left:12px; top:12px; width:auto; height:auto; background:#0e1626; color:#e6ecf4; padding:8px 12px; border-radius:10px; z-index:50; border:1px solid rgba(255,255,255,.25); }

  /* —— Small phone tune-ups —— */
  @media (max-width: 640px){
    .head{ padding:10px 10px; justify-content: space-around;}
    .head-actions{ width:100%; justify-content:space-between; }
    .search{ flex:1 1 100%; width:100%; }
    .search input{ width:100%; }
    .tab, .icon{ width:34px; height:34px; }
    .toolbar { justify-content: space-around;}
  }
  @media (max-width: 360px){
    .tab, .icon{ width:32px; height:32px; }
    .btn{ padding:8px 12px; }
    .chip{ font-size:12px; padding:5px 10px; }
    .toolbar { justify-content: space-around;}
  }
</style>
