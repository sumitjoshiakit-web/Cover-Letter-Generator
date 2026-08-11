(function(){
  // Same server serves both this page and the API, so a relative path works
  // everywhere — locally AND once deployed (Render, Railway, etc.).
  const BACKEND_URL = '/api/generate-letter';

  const state = {
    mode: 'demo', // 'demo' | 'live'
    name:'', role:'', company:'', skills:'',
    resumeText:'',
    status:'idle', // idle | busy | ok | err
    statusMsg:'idle',
  };

  const $ = id => document.getElementById(id);
  const fName=$('fName'), fRole=$('fRole'), fCompany=$('fCompany'), fSkills=$('fSkills'), fResumeText=$('fResumeText');
  const outName=$('outName'), outRole=$('outRole'), outDate=$('outDate');
  const letterBody=$('letterBody');
  const generateBtn=$('generateBtn');
  const copyBtn=$('copyBtn');
  const consoleLog=$('consoleLog');
  const postmark=$('postmark'), postmarkDate=$('postmarkDate');
  const dropzone=$('dropzone'), resumeFile=$('resumeFile'), resumeStatus=$('resumeStatus');
  const modeDemo=$('modeDemo'), modeLive=$('modeLive');

  // ---- live preview of header fields as user types ----
  function syncHeader(){
    outName.textContent = fName.value.trim() || 'Your Name';
    outRole.textContent = (fRole.value.trim() || 'TARGET ROLE') + ' · ' + (fCompany.value.trim() || 'COMPANY');
    outDate.textContent = new Date().toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'});
  }
  [fName,fRole,fCompany].forEach(el=>el.addEventListener('input', syncHeader));
  syncHeader();

  // ---- mode toggle (Demo runs entirely offline; Live calls the AI) ----
  modeDemo.addEventListener('click', ()=>{
    state.mode='demo';
    modeDemo.classList.add('active'); modeLive.classList.remove('active');
    generateBtn.textContent='✦ Generate Cover Letter';
  });
  modeLive.addEventListener('click', ()=>{
    state.mode='live';
    modeLive.classList.add('active'); modeDemo.classList.remove('active');
    generateBtn.textContent='✦ Generate with AI';
  });

  // ---- resume upload & extraction ----
  dropzone.addEventListener('click', ()=>resumeFile.click());
  ['dragover','dragleave','drop'].forEach(evt=>{
    dropzone.addEventListener(evt, e=>{
      e.preventDefault();
      dropzone.classList.toggle('drag', evt==='dragover');
    });
  });
  dropzone.addEventListener('drop', e=>{
    if(e.dataTransfer.files.length) handleResumeFile(e.dataTransfer.files[0]);
  });
  resumeFile.addEventListener('change', e=>{
    if(e.target.files.length) handleResumeFile(e.target.files[0]);
  });

  async function handleResumeFile(file){
    const isTextLike = /\.(txt|md)$/i.test(file.name);
    const isPdf = /\.pdf$/i.test(file.name);

    if(isTextLike){
      const reader = new FileReader();
      reader.onload = () => {
        fResumeText.value = reader.result;
        resumeStatus.style.color = 'var(--stamp)';
        resumeStatus.textContent = `Loaded "${file.name}" — ${reader.result.length} characters added.`;
      };
      reader.readAsText(file);
      return;
    }

    if(isPdf){
      resumeStatus.style.color = 'var(--console-dim)';
      resumeStatus.textContent = `Extracting text from "${file.name}"…`;
      try{
        const form = new FormData();
        form.append('resume', file);
        const res = await fetch('/api/extract-resume', { method:'POST', body: form });
        const data = await res.json().catch(()=>({}));
        if(!res.ok) throw new Error(data.error || 'Extraction failed.');
        fResumeText.value = data.text || '';
        resumeStatus.style.color = 'var(--stamp)';
        resumeStatus.textContent = `Loaded "${file.name}" — ${(data.text||'').length} characters extracted.`;
      }catch(err){
        resumeStatus.style.color = '#E0B84A';
        resumeStatus.textContent = `Couldn't extract "${file.name}": ${err.message}`;
      }
      return;
    }

    resumeStatus.style.color = '#E0B84A';
    resumeStatus.textContent = `Unsupported file type. Use .pdf, .txt, or .md.`;
  }

  // ---- console status helper ----
  function setStatus(kind, msg){
    consoleLog.className = 'console-log' + (kind ? ' '+kind : '');
    consoleLog.innerHTML = `<div class="dot"></div><span>${msg}</span>`;
  }

  // ---- Phase 1: hardcoded template interpolation ----
  function buildDemoLetter(s){
    const skillsList = s.skills.split(',').map(x=>x.trim()).filter(Boolean);
    const skillsPhrase = skillsList.length
      ? skillsList.slice(0,-1).join(', ') + (skillsList.length>1 ? `, and ${skillsList[skillsList.length-1]}` : skillsList[0])
      : 'a strong, adaptable skill set';
    const resumeNote = s.resumeText.trim()
      ? `\n\nHaving reviewed my background further, you'll see a track record that directly supports this application.`
      : '';

    return `Dear Hiring Manager at ${s.company || '[Company]'},

I am ${s.name || '[Candidate Name]'}, and I am writing to express my interest in the ${s.role || '[Job Role]'} position at ${s.company || '[Company]'}. My background includes hands-on experience with ${skillsPhrase}, which I believe aligns well with what your team is looking for.

I'm particularly drawn to ${s.company || 'your company'}'s work and would welcome the opportunity to contribute my skills toward your team's goals. I'm confident that my technical foundation and eagerness to learn make me a strong fit for this role.${resumeNote}

Thank you for considering my application. I look forward to the opportunity to discuss how I can contribute to ${s.company || 'your team'}.

Sincerely,
${s.name || '[Candidate Name]'}`;
  }

  // ---- Phase 2: prompt construction for the LLM ----
  function buildPrompt(s){
    let prompt = `You are an expert career coach. Write a concise, professional, warm cover letter (under 320 words) for the following candidate. Do not use placeholder brackets — write it as a finished letter ready to send. Use markdown paragraphs separated by blank lines.

Candidate name: ${s.name}
Target role: ${s.role}
Target company: ${s.company}
Key skills: ${s.skills}`;
    if(s.resumeText.trim()){
      prompt += `\n\nAdditional context extracted from the candidate's resume (use relevant details, don't just repeat verbatim):\n${s.resumeText.trim().slice(0,4000)}`;
    }
    return prompt;
  }

  // Minimal markdown -> HTML paragraph cleanup (Phase 3 requirement)
  function markdownToParagraphs(md){
    const escaped = md
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const bolded = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    return bolded
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => `<p>${p.replace(/\n/g,'<br/>')}</p>`)
      .join('');
  }

  function renderSkeleton(){
    letterBody.innerHTML = `<div class="generating-label">Generating…</div><div class="skeleton">
      <div class="bar" style="width:92%"></div>
      <div class="bar" style="width:100%"></div>
      <div class="bar" style="width:78%"></div>
      <div class="bar" style="width:96%"></div>
      <div class="bar" style="width:64%"></div>
    </div>`;
  }

  function renderPlainLetter(text){
    letterBody.innerHTML = '';
    letterBody.classList.remove('placeholder-mode');
    const p = document.createElement('div');
    p.textContent = text; // plain text template, preserve via CSS white-space:pre-wrap
    letterBody.appendChild(p);
  }

  function renderMarkdownLetter(md){
    letterBody.innerHTML = markdownToParagraphs(md);
  }

  function showPostmark(){
    postmarkDate.textContent = new Date().toLocaleDateString(undefined,{month:'short', day:'numeric'});
    postmark.classList.add('show');
  }

  // ---- Phase 2: live generation, routed through OUR backend (server.js) ----
  // The browser never sees the Gemini key. It only ever talks to our own
  // /api/generate-letter route, which holds the key privately server-side.
  async function callGemini(s){
    const res = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: s.name, role: s.role, company: s.company,
        skills: s.skills, resumeText: s.resumeText
      })
    });
    const data = await res.json().catch(()=> ({}));
    if(!res.ok){
      throw new Error(data.error || `Server error (${res.status}). Is the backend running? (node server.js)`);
    }
    if(!data.letter) throw new Error('Server returned an empty letter.');
    return data.letter;
  }

  // ---- generate button ----
  generateBtn.addEventListener('click', async ()=>{
    state.name = fName.value.trim();
    state.role = fRole.value.trim();
    state.company = fCompany.value.trim();
    state.skills = fSkills.value.trim();
    state.resumeText = fResumeText.value;

    if(!state.name || !state.role || !state.company){
      setStatus('err', 'Please fill in Name, Role, and Company first.');
      return;
    }

    copyBtn.disabled = true;
    copyBtn.classList.remove('copied');
    copyBtn.textContent = '⎘ Copy to Clipboard';
    postmark.classList.remove('show');

    if(state.mode === 'demo'){
      setStatus('busy', 'building from template…');
      generateBtn.disabled = true;
      renderSkeleton();
      await new Promise(r=>setTimeout(r, 400)); // brief pause so the state is visible
      const letter = buildDemoLetter(state);
      renderPlainLetter(letter);
      copyBtn.dataset.text = letter;
      copyBtn.disabled = false;
      showPostmark();
      setStatus('ok', 'demo letter generated');
      generateBtn.disabled = false;
      return;
    }

    setStatus('busy', 'Generating…');
    generateBtn.disabled = true;
    renderSkeleton();
    const start = Date.now();
    try{
      const raw = await callGemini(state);
      renderMarkdownLetter(raw);
      copyBtn.dataset.text = raw.replace(/\*\*/g,'');
      copyBtn.disabled = false;
      showPostmark();
      setStatus('ok', `generated in ${((Date.now()-start)/1000).toFixed(1)}s`);
    }catch(err){
      letterBody.innerHTML = `<div class="placeholder">Couldn't generate: ${err.message}</div>`;
      setStatus('err', err.message.slice(0,90));
    } finally {
      generateBtn.disabled = false;
    }
  });

  // ---- copy to clipboard ----
  copyBtn.addEventListener('click', async ()=>{
    const text = copyBtn.dataset.text || letterBody.textContent;
    try{
      await navigator.clipboard.writeText(text);
      copyBtn.classList.add('copied');
      copyBtn.textContent = '✓ Copied';
      setTimeout(()=>{ copyBtn.classList.remove('copied'); copyBtn.textContent='⎘ Copy to Clipboard'; }, 1600);
    }catch(e){
      copyBtn.textContent = 'Copy failed — select manually';
    }
  });
})();
