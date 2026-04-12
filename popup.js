/* ResuMatch - popup.js */

let resumes = [];
let grokKey = '';
let geminiKey = '';
let userEmail = '';
let userName = '';
let editingResumeIndex = -1;
let lastJDText = '';
let lastAnalysis = null;
let sponsorCache = null;

const SPONSOR_CSV_URL = 'https://assets.publishing.service.gov.uk/media/69ce2d13837d4b59e502d119/2026-04-02_-_Worker_and_Temporary_Worker.csv';

// ── Google Form config for email collection ──
// SETUP: Create a Google Form with "Name" and "Email" fields
// Replace these with your form ID and entry IDs:
const GOOGLE_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSeTyMfThyvbSZq3wATmlf7Gjt3G386ew_PP_h_rSHPX7NCKEA/formResponse';
const GOOGLE_FORM_NAME_ENTRY = 'entry.1096598508';
const GOOGLE_FORM_EMAIL_ENTRY = 'entry.192929125';
const GOOGLE_FORM_USECASE_ENTRY = 'entry.1885760569';

const $ = (s) => document.querySelector(s);

// Init
document.addEventListener('DOMContentLoaded', async () => {
  await loadStorage();
  renderView();
  bindEvents();
});

async function loadStorage() {
  return new Promise(r => chrome.storage.local.get(['grokKey','geminiKey','resumes','userEmail','userName'], d => {
    grokKey = d.grokKey || '';
    geminiKey = d.geminiKey || '';
    resumes = d.resumes || [];
    userEmail = d.userEmail || '';
    userName = d.userName || '';
    r();
  }));
}
async function saveStorage() {
  return new Promise(r => chrome.storage.local.set({grokKey, geminiKey, resumes, userEmail, userName}, r));
}

function renderView() {
  // Hide all screens first
  $('#loginScreen').classList.add('hidden');
  $('#setupScreen').classList.add('hidden');
  $('#mainScreen').classList.add('hidden');

  if (!userEmail) {
    showLogin();
  } else if ((!grokKey && !geminiKey) || resumes.length === 0) {
    showSetup();
  } else {
    showMain();
  }
}

function showLogin() {
  $('#loginScreen').classList.remove('hidden');
  $('#setupScreen').classList.add('hidden');
  $('#mainScreen').classList.add('hidden');
}

function showSetup() {
  $('#loginScreen').classList.add('hidden');
  $('#setupScreen').classList.remove('hidden');
  $('#mainScreen').classList.add('hidden');
  $('#grokKeyInput').value = grokKey;
  $('#geminiKeyInput').value = geminiKey;
  renderResumeList();
}

function showMain() {
  $('#loginScreen').classList.add('hidden');
  $('#setupScreen').classList.add('hidden');
  $('#mainScreen').classList.remove('hidden');
  $('#readyState').classList.remove('hidden');
  $('#loadingState').classList.add('hidden');
  $('#resultsState').classList.add('hidden');
  $('#errorState').classList.add('hidden');
}

async function submitEmailToSheet(name, email, usecases) {
  // Try submitting with URLSearchParams
  try {
    const params = new URLSearchParams();
    params.append('entry.1096598508', name);
    params.append('entry.192929125', email);
    params.append('entry.1885760569', usecases || '');
    params.append('fvv', '1');
    params.append('partialResponse', '[null,null,null]');
    params.append('pageHistory', '0');
    params.append('fbzx', Date.now().toString());

    await fetch('https://docs.google.com/forms/d/e/1FAIpQLSeTyMfThyvbSZq3wATmlf7Gjt3G386ew_PP_h_rSHPX7NCKEA/formResponse', {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    console.log('Form submitted:', { name, email, usecases });
  } catch (e) {
    console.log('Form submission attempted:', e.message);
  }

  // Also try iframe approach as backup (more reliable with Google Forms)
  try {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.name = 'form_submit_frame';
    document.body.appendChild(iframe);

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = 'https://docs.google.com/forms/d/e/1FAIpQLSeTyMfThyvbSZq3wATmlf7Gjt3G386ew_PP_h_rSHPX7NCKEA/formResponse';
    form.target = 'form_submit_frame';

    const fields = {
      'entry.1096598508': name,
      'entry.192929125': email,
      'entry.1885760569': usecases || '',
    };

    for (const [k, v] of Object.entries(fields)) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = k;
      input.value = v;
      form.appendChild(input);
    }

    document.body.appendChild(form);
    form.submit();

    // Clean up after 3 seconds
    setTimeout(() => {
      form.remove();
      iframe.remove();
    }, 3000);

    console.log('Form submitted via iframe:', { name, email, usecases });
  } catch (e) {
    console.log('Iframe submission failed:', e.message);
  }
}

// PDF text extraction — uses bundled pdf.js
async function handlePDF(file) {
  const status = $('#pdfStatus');
  status.classList.remove('hidden', 'pdf-ok', 'pdf-err');
  status.classList.add('pdf-loading');
  status.textContent = 'Extracting text from PDF...';

  try {
    const arrayBuffer = await file.arrayBuffer();
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
    }

    fullText = fullText.replace(/\s+/g, ' ').trim();

    if (fullText.length < 50) {
      status.classList.remove('pdf-loading');
      status.classList.add('pdf-err');
      status.textContent = 'Could not extract text. PDF might be scanned/image-based. Try pasting text instead.';
      return;
    }

    $('#resumeTextInput').value = fullText;
    status.classList.remove('pdf-loading');
    status.classList.add('pdf-ok');
    status.textContent = `Extracted ${fullText.length} chars from ${pdf.numPages} page${pdf.numPages > 1 ? 's' : ''}. Review below and save.`;
  } catch (e) {
    console.error('PDF parse error:', e);
    status.classList.remove('pdf-loading');
    status.classList.add('pdf-err');
    status.textContent = 'Failed to read PDF. Try pasting your resume text instead.';
  }
}

function renderResumeList() {
  const list = $('#resumeList');
  list.innerHTML = '';
  resumes.forEach((r, i) => {
    const chip = document.createElement('div');
    chip.className = 'resume-chip';
    chip.innerHTML = `<span class="resume-chip-label">${esc(r.label)}</span><span class="resume-chip-meta">${r.text.length} chars</span>`;
    chip.addEventListener('click', () => openResumeModal(i));
    list.appendChild(chip);
  });
  $('#resumeCount').textContent = `${resumes.length}/4`;
  $('#addResumeBtn').style.display = resumes.length >= 4 ? 'none' : '';
}

function bindEvents() {
  // Login with use-case survey
  $('#loginBtn').addEventListener('click', async () => {
    const name = $('#loginName').value.trim();
    const email = $('#loginEmail').value.trim();
    if (!name) return $('#loginName').focus();
    if (!email || !email.includes('@')) return $('#loginEmail').focus();

    const btn = $('#loginBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      // Collect use-cases
      const usecases = [...document.querySelectorAll('.usecase-opt input:checked')].map(c => c.value).join(', ');

      userName = name;
      userEmail = email;
      await saveStorage();

      // Submit to Google Form (fire and forget — don't block on this)
      submitEmailToSheet(name, email, usecases).catch(e => console.log('Form submit error (non-blocking):', e));

      showSetup();
    } catch (e) {
      console.error('Login error:', e);
      showSetup(); // proceed anyway
    } finally {
      btn.disabled = false;
      btn.textContent = 'Next';
    }
  });

  // API help toggle — click the banner header to expand/collapse
  $('#apiHelpToggle').addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = $('#apiHelpPanel');
    panel.classList.toggle('hidden');
    const link = $('#apiHelpToggle .help-link');
    if (link) link.textContent = panel.classList.contains('hidden') ? 'Show me how' : 'Hide';
  });

  // API help tabs
  document.querySelectorAll('.api-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.api-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      $('#grokHelp').classList.toggle('hidden', target !== 'grok');
      $('#geminiHelp').classList.toggle('hidden', target !== 'gemini');
    });
  });

  // PDF upload
  const uploadArea = $('#uploadArea');
  const pdfInput = $('#pdfFileInput');

  uploadArea.addEventListener('click', () => pdfInput.click());
  uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') handlePDF(file);
  });
  pdfInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handlePDF(e.target.files[0]);
  });

  $('#settingsBtn').addEventListener('click', showSetup);
  $('#addResumeBtn').addEventListener('click', () => openResumeModal(-1));
  $('#closeModalBtn').addEventListener('click', () => $('#resumeModal').classList.add('hidden'));

  $('#saveResumeBtn').addEventListener('click', () => {
    const label = $('#resumeLabelInput').value.trim();
    const text = $('#resumeTextInput').value.trim();
    if (!label || !text) return;
    if (editingResumeIndex >= 0) resumes[editingResumeIndex] = {...resumes[editingResumeIndex], label, text};
    else resumes.push({id: Date.now().toString(), label, text});
    saveStorage(); $('#resumeModal').classList.add('hidden'); renderResumeList();
  });

  $('#deleteResumeBtn').addEventListener('click', () => {
    if (editingResumeIndex >= 0) { resumes.splice(editingResumeIndex, 1); saveStorage(); $('#resumeModal').classList.add('hidden'); renderResumeList(); }
  });

  $('#saveSetupBtn').addEventListener('click', async () => {
    grokKey = $('#grokKeyInput').value.trim();
    geminiKey = $('#geminiKeyInput').value.trim();
    if (!grokKey && !geminiKey) { alert('Add at least one API key (Grok or Gemini).'); return; }
    if (resumes.length === 0) return alert('Add at least one resume.');
    await saveStorage(); showMain();
  });

  $('#analyseBtn').addEventListener('click', runAnalysis);
  $('#newAnalysisBtn').addEventListener('click', () => {
    $('#resultsState').classList.add('hidden'); $('#readyState').classList.remove('hidden');
    $('#answerOutput').classList.add('hidden'); $('#answerOutput').innerHTML = ''; $('#questionInput').value = '';
  });
  $('#retryBtn').addEventListener('click', runAnalysis);
  $('#answerBtn').addEventListener('click', runQA);
  $('#refineBtn').addEventListener('click', runRefine);
}

function openResumeModal(index) {
  editingResumeIndex = index;
  if (index >= 0) {
    $('#modalTitle').textContent = 'Edit Resume';
    $('#resumeLabelInput').value = resumes[index].label;
    $('#resumeTextInput').value = resumes[index].text;
    $('#deleteResumeBtn').classList.remove('hidden');
  } else {
    $('#modalTitle').textContent = 'Add Resume';
    $('#resumeLabelInput').value = ''; $('#resumeTextInput').value = '';
    $('#deleteResumeBtn').classList.add('hidden');
  }
  $('#resumeModal').classList.remove('hidden');
  $('#resumeLabelInput').focus();
}

// Page Scraping
async function scrapePageText() {
  // Get the active tab in the current window
  const tabs = await chrome.tabs.query({active: true, lastFocusedWindow: true});
  if (!tabs || !tabs[0]) throw new Error('No active tab found. Make sure a webpage is open.');

  const tab = tabs[0];

  // Check if we can access the tab
  if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:'))) {
    throw new Error('Cannot read Chrome internal pages. Navigate to a job listing website.');
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText,
    });
    if (!results || !results[0] || !results[0].result) {
      throw new Error('Could not read page content.');
    }
    return results[0].result;
  } catch (e) {
    throw new Error('Cannot access this page. Try refreshing the page and clicking Analyse again.');
  }
}

// Gemini & Grok API - tries whichever keys are available
async function callGemini(prompt, jsonMode) {
  const tried = [];

  // Try Grok first if key exists
  if (grokKey) {
    const grokModels = ['grok-3-mini-fast', 'grok-3-mini'];

  for (const model of grokModels) {
    try {
      console.log(`Trying Grok: ${model}...`);
      if ($('.loading-text')) $('.loading-text').textContent = `Trying ${model}...`;

      const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${grokKey}` },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 8192,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
      });

      if (res.status === 429 || res.status === 503) { tried.push(model); continue; }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err?.error?.message || `API error ${res.status}`;
        if (msg.includes('rate') || msg.includes('quota') || msg.includes('overloaded')) { tried.push(model); continue; }
        // If auth error, skip all Grok models and go to Gemini
        if (res.status === 401 || res.status === 403) { tried.push('grok-auth-failed'); break; }
        tried.push(model);
        continue;
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) { tried.push(model); continue; }
      console.log(`Success with Grok: ${model}`);
      return text;
    } catch (e) {
      console.warn(`${model}: ${e.message}`);
      tried.push(model);
      continue;
    }
  } // end for grokModels
  } // end if (grokKey)

  // Fallback to Gemini if key exists
  if (geminiKey) {
  const geminiModels = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'];

  for (const model of geminiModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
    const config = { temperature: 0.3, maxOutputTokens: 8192 };
    if (model.includes('2.5')) config.thinkingConfig = { thinkingBudget: 0 };
    if (jsonMode) config.responseMimeType = "application/json";

    try {
      console.log(`Trying Gemini: ${model}...`);
      if ($('.loading-text')) $('.loading-text').textContent = `Trying ${model}...`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: config }),
      });

      if (res.status === 429 || res.status === 503) { tried.push(model); continue; }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err?.error?.message || `API error ${res.status}`;
        if (msg.includes('high demand') || msg.includes('overloaded') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('rate limit')) {
          tried.push(model); continue;
        }
        if (res.status === 400 || res.status === 401 || res.status === 403) { tried.push('gemini-auth-failed'); break; }
        tried.push(model);
        continue;
      }

      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts;
      if (!parts || parts.length === 0) { tried.push(model); continue; }

      let text = '';
      for (const part of parts) { if (!part.thought && part.text) text += part.text; }
      if (!text) for (const part of parts) { if (part.text) { text = part.text; break; } }
      if (!text) { tried.push(model); continue; }

      console.log(`Success with Gemini: ${model}`);
      return text;
    } catch (e) {
      console.warn(`${model}: ${e.message}`);
      tried.push(model);
      continue;
    }
  }
  } // end if (geminiKey)

  throw new Error(`All models unavailable (tried: ${tried.join(', ')}). Wait 1-2 minutes and try again.`);
}

// Sponsor CSV
async function fetchSponsorCSV() {
  if (sponsorCache) return sponsorCache;
  try {
    const res = await fetch(SPONSOR_CSV_URL);
    if (!res.ok) throw new Error('CSV fetch failed');
    const text = await res.text();
    const lines = text.split('\n');
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = parseCSVLine(line);
      if (cols.length >= 4) rows.push({ name:(cols[0]||'').trim().toUpperCase(), town:(cols[1]||'').trim(), county:(cols[2]||'').trim(), typeRating:(cols[3]||'').trim(), route:(cols[4]||'').trim() });
    }
    sponsorCache = rows;
    return rows;
  } catch(e) { console.error('Sponsor CSV error:', e); return null; }
}

function parseCSVLine(line) {
  const result=[]; let current='', inQ=false;
  for (let i=0;i<line.length;i++) {
    const ch=line[i];
    if (ch==='"') { if (inQ&&line[i+1]==='"'){current+='"';i++;} else inQ=!inQ; }
    else if (ch===','&&!inQ) { result.push(current); current=''; }
    else current+=ch;
  }
  result.push(current); return result;
}

// Company name normalisation
const STRIP_SUFFIXES = /\b(LTD|LIMITED|PLC|INC|LLC|CORP|CORPORATION|UK|GROUP|HOLDINGS|INTERNATIONAL|INTL|TECHNOLOGIES|TECH|SOLUTIONS|SERVICES|CONSULTING|CONSULTANTS|GLOBAL|ENTERPRISES|COMPANY|CO|THE)\b/g;
const STRIP_PREFIXES = /^(THISIS|JOINUS|JOIN|GOTO|GO|GET|TRY|USE|WEARE|MY|HQ|HELLO|HI|MEET)\s*/;

function normalise(name) {
  if (!name) return '';
  let n = name.toUpperCase().trim();
  // Remove common legal/business suffixes
  n = n.replace(STRIP_SUFFIXES, '').trim();
  // Remove dots, commas, ampersands
  n = n.replace(/[.,&]/g, ' ').replace(/\s+/g, ' ').trim();
  // Remove common startup prefixes
  n = n.replace(STRIP_PREFIXES, '').trim();
  return n;
}

// Extract core brand from compound names (e.g. "THISISFLEEK" -> "FLEEK")
function extractCore(name) {
  const n = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Try removing known prefixes from concatenated names
  const prefixes = ['THISIS','JOIN','JOINUS','GOTO','GET','TRY','USE','WEARE','HELLO','HI','MEET','MY','HQ'];
  for (const p of prefixes) {
    if (n.startsWith(p) && n.length > p.length + 2) return n.substring(p.length);
  }
  return n;
}

// Levenshtein distance
function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i-1] === a[j-1] ? matrix[i-1][j-1] : Math.min(matrix[i-1][j-1]+1, matrix[i][j-1]+1, matrix[i-1][j]+1);
    }
  }
  return matrix[b.length][a.length];
}

// Find longest common substring
function longestCommonSubstring(a, b) {
  let longest = 0;
  const table = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i-1] === b[j-1]) { table[i][j] = table[i-1][j-1] + 1; longest = Math.max(longest, table[i][j]); }
    }
  }
  return longest;
}

function searchSponsor(companyName) {
  if (!sponsorCache || !companyName) return null;

  const queryRaw = companyName.toUpperCase().trim();
  const queryNorm = normalise(companyName);
  const queryCore = extractCore(queryNorm);
  const queryFlat = queryNorm.replace(/\s+/g, '');

  if (queryNorm.length < 2) return null;

  const results = [];

  for (const row of sponsorCache) {
    const regNorm = normalise(row.name);
    const regCore = extractCore(regNorm);
    const regFlat = regNorm.replace(/\s+/g, '');

    if (regNorm.length < 2) continue;

    // Priority 1: Exact match after normalisation
    if (queryNorm === regNorm || queryFlat === regFlat || queryCore === regCore) {
      results.push({ ...row, confidence: 'exact', score: 100 });
      continue;
    }

    // Priority 2: One contains the other — but the contained string must be
    // at least 5 chars AND at least 50% the length of the longer string.
    // This prevents "MAC" matching "MACHINE" or "AC" matching anything.
    const shorterFlat = queryFlat.length <= regFlat.length ? queryFlat : regFlat;
    const longerFlat = queryFlat.length > regFlat.length ? queryFlat : regFlat;

    if (shorterFlat.length >= 5 && longerFlat.includes(shorterFlat)) {
      const ratio = shorterFlat.length / longerFlat.length;
      if (ratio >= 0.5) {
        results.push({ ...row, confidence: 'strong', score: 90 });
        continue;
      }
    }

    // Also check normalised with spaces (handles multi-word like "THOUGHT MACHINE")
    const shorterNorm = queryNorm.length <= regNorm.length ? queryNorm : regNorm;
    const longerNorm = queryNorm.length > regNorm.length ? queryNorm : regNorm;

    if (shorterNorm.length >= 5 && longerNorm.includes(shorterNorm)) {
      const ratio = shorterNorm.length / longerNorm.length;
      if (ratio >= 0.5) {
        results.push({ ...row, confidence: 'strong', score: 90 });
        continue;
      }
    }

    // Priority 3: Core brand match (handles THISISFLEEK vs JOINFLEEK)
    // Core must be at least 4 chars to avoid false positives
    if (queryCore.length >= 4 && regCore.length >= 4) {
      const shorterCore = queryCore.length <= regCore.length ? queryCore : regCore;
      const longerCore = queryCore.length > regCore.length ? queryCore : regCore;
      if (longerCore.includes(shorterCore) && shorterCore.length / longerCore.length >= 0.4) {
        results.push({ ...row, confidence: 'likely', score: 75 });
        continue;
      }
    }

    // Priority 4: Significant common substring (must be at least 70% of shorter name AND at least 6 chars)
    const minLen = Math.min(queryFlat.length, regFlat.length);
    if (minLen >= 5) {
      const lcs = longestCommonSubstring(queryFlat, regFlat);
      if (lcs >= 6 && lcs >= Math.floor(minLen * 0.7)) {
        results.push({ ...row, confidence: 'possible', score: 60 });
        continue;
      }
    }

    // Priority 5: Levenshtein — only when both names are similar length (within 30% of each other)
    if (queryFlat.length >= 4 && regFlat.length >= 4) {
      const maxLen = Math.max(queryFlat.length, regFlat.length);
      const lenRatio = Math.min(queryFlat.length, regFlat.length) / maxLen;
      if (maxLen <= 20 && lenRatio >= 0.7) {
        const dist = levenshtein(queryFlat, regFlat);
        if (dist <= Math.max(1, Math.floor(maxLen * 0.15))) { // within 15% edit distance
          results.push({ ...row, confidence: 'possible', score: 50 });
        }
      }
    }
  }

  if (results.length === 0) return null;

  // Sort by score descending, take top 5
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 5);
}

// Main Analysis
async function runAnalysis() {
  $('#readyState').classList.add('hidden');
  $('#errorState').classList.add('hidden');
  $('#resultsState').classList.add('hidden');
  $('#loadingState').classList.remove('hidden');

  try {
    const sponsorPromise = fetchSponsorCSV();
    const pageText = await scrapePageText();
    // Security: sanitise scraped text — strip potential prompt injection patterns
    lastJDText = sanitiseInput(pageText.substring(0, 8000));

    const resumeBlocks = resumes.map((r,i) => `--- RESUME ${i+1}: "${r.label}" ---\n${sanitiseInput(r.text)}`).join('\n\n');

    const prompt = `Analyse resume-JD fit. Return ONLY valid JSON.

JOB DESCRIPTION (extract the job posting, ignore page chrome):
${lastJDText}

RESUMES:
${resumeBlocks}

Return this exact JSON:
{
  "bestResumeIndex": 0,
  "resumeRankings": [{"index": 0, "label": "label", "score": 85, "reason": "max 10 words"}],
  "relevancyScore": 0,
  "scoringBreakdown": {
    "functionMatch": "match|adjacent|mismatch",
    "functionNote": "max 10 words",
    "seniorityMatch": "match|overqualified|underqualified",
    "seniorityNote": "max 10 words",
    "experienceYears": "match|slight_gap|significant_gap|major_gap|not_specified",
    "experienceNote": "max 10 words",
    "specialisation": "exact|close|moderate|weak",
    "specialisationNote": "max 10 words",
    "hardSkillGap": "none|minor|major",
    "hardSkillNote": "max 10 words",
    "domainTransfer": "high|moderate|low",
    "domainNote": "max 10 words"
  },
  "fitReasons": ["max 15 words each"],
  "gaps": ["max 15 words each"],
  "atsScore": 75,
  "missingKeywords": ["keyword1", "keyword2"],
  "bulletRewrites": [
    {"original": "original bullet from resume", "rewritten": "rewritten for this JD"}
  ],
  "proTips": [
    {"type": "warn|good|info", "tip": "tip text"}
  ],
  "salaryEstimate": {"low": 45000, "high": 65000, "currency": "GBP", "basis": "short basis"},
  "companyIntel": "1-2 sentences about the company",
  "glassdoorRating": 4.1,
  "glassdoorNote": "Based on ~2000 reviews",
  "jobTitle": "exact title from JD",
  "companyName": "exact company name"
}

CLASSIFICATION RULES (score will be calculated by code, just classify accurately):
- functionMatch: "match" = same job family (PM to PM, Engineer to Engineer). "adjacent" = related (PM to Product Ops, PM to Growth Marketing). "mismatch" = different family (PM to Engineer, PM to Data Scientist, PM to Designer). Judge by actual job titles and daily work, NOT by shared keywords like SQL or data.
- seniorityMatch: compare candidate level to JD level.
- experienceYears: if JD states years required, compare to candidate. "not_specified" if JD doesnt mention.
- specialisation: within same function, how close is the sub-domain. "exact" = Growth PM to Growth PM. "weak" = Payments PM to Cybersecurity PM.
- hardSkillGap: "major" if JD requires skills (languages, frameworks, tools) candidate lacks entirely. "minor" if only nice-to-haves are missing.
- domainTransfer: how transferable is industry experience.

OTHER RULES:
- resumeRankings: ALL resumes, best to worst. Max 10 words per reason.
- fitReasons: 3 items, max 15 words each.
- gaps: 2 items, max 15 words each.
- atsScore: 0-100 ATS keyword pass likelihood.
- missingKeywords: 3-6 from JD not in best resume.
- bulletRewrites: 2-3 bullets rewritten for this JD.
- proTips: 3-5 tips. Include location advice (Germany/Dubai/EU norms), title warnings, cover letter advice, salary norms, right-to-work. type is warn/good/info.
- salaryEstimate: local currency range. If unknown set low/high to 0.
- companyIntel: 1-2 sentences.
- glassdoorRating: 1.0-5.0 if known, or null.
- If no JD found: relevancyScore=-1, jobTitle="NOT_FOUND"
- Plain ASCII only.`;

    const raw = await callGemini(prompt, true);
    lastAnalysis = extractJSON(raw);

    if (!lastAnalysis) {
      console.error('RAW GEMINI RESPONSE:', raw);
      throw new Error("Could not parse AI response. Check console (F12) for details.");
    }

    // ── SCORE CALCULATED BY CODE — Gemini's score is IGNORED ──
    const bd = lastAnalysis.scoringBreakdown;
    if (bd) {
      // ── CODE-LEVEL FUNCTION MATCH — covers tech AND non-tech roles ──
      const jdTitle = (lastAnalysis.jobTitle || '').toLowerCase();
      const resumeTitles = resumes.map(r => r.text.toLowerCase()).join(' ');

      // ── Role family patterns (comprehensive — tech + non-tech) ──
      const ROLE_FAMILIES = {
        pm: /\b(product manager|product owner|product lead|head of product|vp.{0,5}product|director.{0,5}product|chief product|associate product manager|group product manager|senior product manager)\b/,
        tpm: /\b(technical program manager|program manager|delivery manager|release manager|project manager|pmo)\b/,
        engineering: /\b(software engineer|data engineer|backend engineer|frontend engineer|full.?stack|devops|sre|ml engineer|machine learning engineer|platform engineer|infrastructure engineer|developer|programmer|systems engineer|cloud engineer|qa engineer|test engineer|security engineer|network engineer|site reliability|solutions architect|technical architect)\b/,
        dataScience: /\b(data scientist|research scientist|ml researcher|ai researcher|applied scientist|research engineer)\b/,
        design: /\b(product designer|ux designer|ui designer|design lead|ux researcher|interaction designer|visual designer|graphic designer|creative director|design manager|service designer)\b/,
        analytics: /\b(data analyst|business analyst|analytics engineer|bi analyst|quantitative analyst|insights analyst|analytics manager|business intelligence|reporting analyst|mi analyst)\b/,
        marketing: /\b(marketing manager|growth marketer|content manager|brand manager|demand gen|performance marketing|seo manager|social media manager|digital marketing|marketing director|cmo|head of marketing|growth manager|marketing lead|content strategist|marketing coordinator|pr manager|communications manager|comms manager)\b/,
        sales: /\b(account executive|sales manager|business development|sales engineer|revenue manager|account manager|sales director|vp.{0,5}sales|head of sales|sales lead|partnership manager|sales representative|bdr|sdr|commercial manager|commercial director)\b/,
        operations: /\b(operations manager|ops manager|head of operations|vp.{0,5}operations|director.{0,5}operations|operations lead|operations director|coo|operations coordinator|operations analyst|business operations)\b/,
        supplyChain: /\b(supply chain manager|supply chain analyst|supply chain director|head of supply chain|logistics manager|logistics coordinator|logistics director|warehouse manager|warehouse supervisor|distribution manager|inventory manager|inventory analyst|demand planner|supply planner|procurement manager|procurement officer|buyer|purchasing manager|sourcing manager|fulfilment manager|fleet manager|transportation manager|shipping manager|import.export manager)\b/,
        finance: /\b(financial analyst|finance manager|controller|cfo|head of finance|fp.a|treasury|accountant|finance director|investment analyst|risk analyst|audit manager|finance controller|management accountant|tax manager|credit analyst|credit manager|collections manager|payroll manager|accounts payable|accounts receivable|bookkeeper|finance officer)\b/,
        compliance: /\b(compliance officer|compliance manager|compliance analyst|head of compliance|regulatory affairs|regulatory manager|risk manager|risk officer|head of risk|aml analyst|kyc analyst|governance manager|internal audit|audit manager)\b/,
        hr: /\b(hr manager|recruiter|talent acquisition|people manager|head of people|hr director|people operations|hr business partner|compensation|benefits manager|chief people officer|hr coordinator|hr advisor|hr officer|people partner|employee relations|organisational development|organizational development)\b/,
        learningDev: /\b(learning.{0,5}development|l.d manager|l.d lead|training manager|training coordinator|training officer|instructional designer|learning designer|head of learning|talent development|capability manager|learning experience|skills development|learning consultant|corporate trainer)\b/,
        legal: /\b(legal counsel|lawyer|attorney|head of legal|general counsel|paralegal|legal director|legal manager|solicitor|barrister|contracts manager|legal officer|company secretary)\b/,
        strategy: /\b(strategy manager|strategy consultant|management consultant|strategy director|head of strategy|strategy lead|corporate strategy|business strategy|strategy analyst|transformation manager|transformation lead|change manager|change management)\b/,
        customerSuccess: /\b(customer success|customer support|support manager|head of support|customer experience|cx manager|support engineer|technical support|client manager|client success|customer service manager|contact centre manager|call centre manager|customer operations)\b/,
        chiefOfStaff: /\b(chief of staff)\b/,
        productOps: /\b(product ops|product operations|product analyst)\b/,
        facilities: /\b(facilities manager|office manager|workplace manager|estates manager|building manager|site manager|property manager|health.{0,5}safety|hse manager|environment.{0,5}health|ehs manager)\b/,
        itSupport: /\b(it manager|it support|it director|cto|cio|systems administrator|sysadmin|it analyst|it coordinator|helpdesk|service desk|it operations|it infrastructure|head of it)\b/,
        research: /\b(research manager|research analyst|research director|market research|consumer insights|insights manager|research associate|ux researcher|user researcher|policy analyst|policy advisor|economist)\b/,
        medical: /\b(doctor|nurse|physician|surgeon|pharmacist|dentist|therapist|physiotherapist|clinician|medical officer|clinical lead|healthcare|paramedic|midwife|radiographer|clinical director)\b/,
        education: /\b(teacher|lecturer|professor|tutor|head of department|headteacher|principal|dean|academic|curriculum|education manager|training officer|assessor|instructor)\b/,
        creative: /\b(copywriter|content writer|editor|journalist|filmmaker|videographer|photographer|animator|illustrator|art director|creative lead|producer|content creator)\b/,
      };

      // ── Function match matrix ──
      function classifyFunction(candidateFamily, jdFamily) {
        if (candidateFamily === jdFamily) return { cl: 'match', cap: 100 };

        // Universal adjacency map — each key lists its adjacent families and caps
        const ADJACENCY = {
          pm: { adjacent70: ['productOps','analytics','strategy'], adjacent55: ['marketing','operations','tpm','supplyChain'], mismatch30: ['sales','customerSuccess'], mismatch25: ['engineering','dataScience','design','finance','compliance','hr','learningDev','legal','chiefOfStaff','medical','education','facilities','itSupport'] },
          tpm: { adjacent70: ['pm','productOps'], adjacent55: ['engineering','operations','strategy'], mismatch30: ['analytics','itSupport'], mismatch25: [] },
          engineering: { adjacent70: ['dataScience'], adjacent55: ['analytics','itSupport'], mismatch30: ['pm','tpm','productOps'], mismatch25: [] },
          dataScience: { adjacent70: ['analytics','engineering'], adjacent55: ['research'], mismatch30: ['pm'], mismatch25: [] },
          design: { adjacent70: ['research'], adjacent55: ['pm','marketing','creative'], mismatch30: [], mismatch25: [] },
          analytics: { adjacent70: ['dataScience','pm','productOps','finance','research'], adjacent55: ['engineering','strategy','marketing','compliance'], mismatch30: [], mismatch25: [] },
          marketing: { adjacent70: ['creative','sales'], adjacent55: ['pm','strategy','customerSuccess','research'], mismatch30: [], mismatch25: [] },
          sales: { adjacent70: ['marketing'], adjacent55: ['customerSuccess','pm','strategy'], mismatch30: ['operations'], mismatch25: [] },
          operations: { adjacent70: ['supplyChain','tpm','pm'], adjacent55: ['strategy','customerSuccess','analytics','facilities','productOps'], mismatch30: [], mismatch25: [] },
          supplyChain: { adjacent70: ['operations'], adjacent55: ['analytics','finance','pm'], mismatch30: ['tpm','facilities'], mismatch25: [] },
          finance: { adjacent70: ['compliance','analytics'], adjacent55: ['strategy','operations','supplyChain'], mismatch30: ['pm'], mismatch25: [] },
          compliance: { adjacent70: ['finance','legal'], adjacent55: ['analytics','operations','hr'], mismatch30: [], mismatch25: [] },
          hr: { adjacent70: ['learningDev'], adjacent55: ['operations','strategy','compliance'], mismatch30: ['pm','marketing'], mismatch25: [] },
          learningDev: { adjacent70: ['hr','education'], adjacent55: ['operations','strategy','customerSuccess'], mismatch30: [], mismatch25: [] },
          legal: { adjacent70: ['compliance'], adjacent55: ['finance','hr','strategy'], mismatch30: ['pm','operations'], mismatch25: [] },
          strategy: { adjacent70: ['pm','analytics'], adjacent55: ['operations','finance','marketing','hr','supplyChain'], mismatch30: [], mismatch25: [] },
          customerSuccess: { adjacent70: ['sales','operations'], adjacent55: ['pm','marketing','itSupport'], mismatch30: [], mismatch25: [] },
          chiefOfStaff: { adjacent70: ['strategy'], adjacent55: ['pm','operations','hr'], mismatch30: [], mismatch25: [] },
          productOps: { adjacent70: ['pm','analytics'], adjacent55: ['tpm','operations','strategy'], mismatch30: [], mismatch25: [] },
          facilities: { adjacent70: ['operations'], adjacent55: ['supplyChain','hr'], mismatch30: [], mismatch25: [] },
          itSupport: { adjacent70: ['engineering'], adjacent55: ['operations','analytics'], mismatch30: ['pm'], mismatch25: [] },
          research: { adjacent70: ['analytics','dataScience'], adjacent55: ['strategy','design','marketing'], mismatch30: [], mismatch25: [] },
          medical: { adjacent70: [], adjacent55: [], mismatch30: [], mismatch25: [] },
          education: { adjacent70: ['learningDev'], adjacent55: ['hr','research'], mismatch30: [], mismatch25: [] },
          creative: { adjacent70: ['marketing','design'], adjacent55: ['research'], mismatch30: [], mismatch25: [] },
        };

        const rules = ADJACENCY[candidateFamily];
        if (!rules) return null; // unknown family, let Gemini decide

        if (rules.adjacent70.includes(jdFamily)) return { cl: 'adjacent', cap: 70 };
        if (rules.adjacent55.includes(jdFamily)) return { cl: 'adjacent', cap: 55 };
        if (rules.mismatch30.includes(jdFamily)) return { cl: 'mismatch', cap: 30 };
        if (rules.mismatch25.includes(jdFamily)) return { cl: 'mismatch', cap: 25 };

        // If not in any list, default mismatch at 30
        return { cl: 'mismatch', cap: 30 };
      }

      // Detect candidate's primary function
      let candidateFamily = null;
      for (const [family, regex] of Object.entries(ROLE_FAMILIES)) {
        if (regex.test(resumeTitles)) { candidateFamily = family; break; }
      }

      // Detect JD's function
      let jdFamily = null;
      for (const [family, regex] of Object.entries(ROLE_FAMILIES)) {
        if (regex.test(jdTitle)) { jdFamily = family; break; }
      }

      // Override function match if we can detect both
      let fnOverride = (bd.functionMatch || '').toLowerCase();
      let adjacentCap = 55; // default

      if (candidateFamily && jdFamily) {
        const result = classifyFunction(candidateFamily, jdFamily);
        if (result) {
          fnOverride = result.cl;
          adjacentCap = result.cap;
          bd.functionMatch = result.cl;
          bd.functionNote = `${candidateFamily} to ${jdFamily}`;
        }
      }

      console.log(`Function: candidate=${candidateFamily}, jd=${jdFamily}, override=${fnOverride}, cap=${adjacentCap}`);

      const fn = fnOverride;
      const sr = (bd.seniorityMatch || '').toLowerCase();
      const sp = (bd.specialisation || '').toLowerCase();
      const hs = (bd.hardSkillGap || '').toLowerCase();
      const ey = (bd.experienceYears || '').toLowerCase();
      const dt = (bd.domainTransfer || '').toLowerCase();

      let score = 100;

      // Step 1: Function
      if (fn === 'mismatch') { score = adjacentCap; } // uses the specific cap from classifyFunction
      else if (fn === 'adjacent') { score = adjacentCap; }

      // Step 2: Seniority
      if (sr === 'underqualified') score -= 20;
      else if (sr === 'overqualified') score -= 12;

      // Step 3: Experience years
      if (ey === 'major_gap') score -= 20;
      else if (ey === 'significant_gap') score -= 12;
      else if (ey === 'slight_gap') score -= 5;

      // Step 4: Specialisation (only meaningful if function matches)
      if (fn === 'match') {
        if (sp === 'weak') score -= 15;
        else if (sp === 'moderate') score -= 8;
        else if (sp === 'close') score -= 3;
      }

      // Step 5: Hard skills
      if (hs === 'major') score -= 12;
      else if (hs === 'minor') score -= 3;

      // Step 6: Domain transferability
      if (dt === 'low') score -= 10;
      else if (dt === 'moderate') score -= 5;

      // Clamp
      score = Math.max(5, Math.min(100, score));

      console.log(`Score: ${score} (Gemini said: ${lastAnalysis.relevancyScore}) | fn=${fn} sr=${sr} ey=${ey} sp=${sp} hs=${hs} dt=${dt}`);

      lastAnalysis.relevancyScore = score;

      // Apply same score logic to rankings
      if (lastAnalysis.resumeRankings) {
        lastAnalysis.resumeRankings.forEach(r => {
          r.score = Math.max(5, Math.min(score, r.score));
        });
      }
    }

    if (lastAnalysis.relevancyScore === -1) {
      throw new Error("No job description found on this page. Navigate to a job listing and try again.");
    }

    await sponsorPromise;
    const sponsorResults = searchSponsor(lastAnalysis.companyName);
    renderResults(lastAnalysis, sponsorResults);
  } catch (err) {
    showError(err.message);
  }
}

function renderResults(data, sponsorResults) {
  $('#loadingState').classList.add('hidden');
  $('#resultsState').classList.remove('hidden');

  // Score ring
  const score = data.relevancyScore;
  const scoreRing = $('#scoreRing');
  const ringFill = $('#ringFill');
  const circ = 2 * Math.PI * 52;
  scoreRing.className = 'score-ring ' + (score>=70?'score-high':score>=45?'score-mid':'score-low');
  $('#scoreValue').textContent = score;
  ringFill.style.strokeDashoffset = circ;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ ringFill.style.strokeDashoffset = circ - (score/100)*circ; }));

  // Best resume
  const best = data.resumeRankings[0];
  $('#bestResumeTag').textContent = best.label;

  // Scoring breakdown
  const bd = data.scoringBreakdown;
  if (bd) {
    const tagClass = (val, good, mid) => val===good?'tag-green':val===mid?'tag-yellow':'tag-red';
    const breakdownEl = document.getElementById('scoreBreakdown');
    if (breakdownEl) {
      breakdownEl.classList.remove('hidden');
      breakdownEl.innerHTML = `
        <div class="breakdown-row"><span class="bd-label">Function</span><span class="bd-tag ${tagClass(bd.functionMatch,'match','adjacent')}">${esc(bd.functionMatch)}</span><span class="bd-note">${esc(bd.functionNote||'')}</span></div>
        <div class="breakdown-row"><span class="bd-label">Seniority</span><span class="bd-tag ${tagClass(bd.seniorityMatch,'match','overqualified')}">${esc(bd.seniorityMatch)}</span><span class="bd-note">${esc(bd.seniorityNote||'')}</span></div>
        ${bd.experienceYears && bd.experienceYears!=='not_specified' ? `<div class="breakdown-row"><span class="bd-label">Experience</span><span class="bd-tag ${tagClass(bd.experienceYears,'match','slight_gap')}">${esc(bd.experienceYears).replace(/_/g,' ')}</span><span class="bd-note">${esc(bd.experienceNote||'')}</span></div>` : ''}
        <div class="breakdown-row"><span class="bd-label">Specialism</span><span class="bd-tag ${tagClass(bd.specialisation,'exact','close')}">${esc(bd.specialisation)}</span><span class="bd-note">${esc(bd.specialisationNote||'')}</span></div>
        <div class="breakdown-row"><span class="bd-label">Hard Skills</span><span class="bd-tag ${tagClass(bd.hardSkillGap,'none','minor')}">${esc(bd.hardSkillGap)}</span><span class="bd-note">${esc(bd.hardSkillNote||'')}</span></div>
        <div class="breakdown-row"><span class="bd-label">Domain</span><span class="bd-tag ${tagClass(bd.domainTransfer,'high','moderate')}">${esc(bd.domainTransfer)}</span><span class="bd-note">${esc(bd.domainNote||'')}</span></div>`;
    }
  }

  // Rankings
  $('#resumeRankings').innerHTML = data.resumeRankings.map((r,i) => `
    <div class="rank-item rank-${i+1}">
      <div class="rank-badge">${i+1}</div>
      <div class="rank-label">${esc(r.label)}</div>
      <div class="rank-score">${r.score}/100</div>
    </div>`).join('');

  // Fit
  $('#fitReasons').innerHTML = `<ul>${(data.fitReasons||[]).map(r=>`<li>${esc(r)}</li>`).join('')}</ul>`;

  // Gaps
  $('#gapReasons').innerHTML = `<ul>${(data.gaps||[]).map(g=>`<li>${esc(g)}</li>`).join('')}</ul>`;

  // ATS
  const ats = data.atsScore || 0;
  const atsEl = $('#atsScore');
  atsEl.textContent = `${ats}/100`;
  atsEl.className = 'ats-value ' + (ats>=70?'ats-high':ats>=45?'ats-mid':'ats-low');
  const kwHtml = (data.missingKeywords||[]).map(k=>`<span class="keyword-tag">${esc(k)}</span>`).join('');
  $('#missingKeywords').innerHTML = kwHtml ? `<p style="margin-bottom:6px;font-size:12px;color:var(--text-muted)">Missing keywords:</p>${kwHtml}` : '<p style="color:var(--green);font-size:12px">All key terms covered!</p>';

  // Bullet rewrites
  const rewrites = data.bulletRewrites || [];
  $('#bulletRewrites').innerHTML = rewrites.length ? rewrites.map(b => `
    <div class="rewrite-item">
      <div class="rewrite-label rewrite-before">BEFORE</div>
      <div style="color:var(--text-dim);font-size:12px;margin-bottom:6px">${esc(b.original)}</div>
      <div class="rewrite-label rewrite-after">AFTER</div>
      <div style="color:var(--green);font-size:12px">${esc(b.rewritten)}</div>
    </div>`).join('') : '<p class="text-dim">No rewrites suggested.</p>';

  // Pro Tips
  const tips = data.proTips || [];
  $('#proTips').innerHTML = tips.length ? tips.map(t => `<div class="tip-item tip-${t.type||'info'}">${esc(t.tip)}</div>`).join('') : '<p class="text-dim">No additional tips.</p>';

  // Salary
  const sal = data.salaryEstimate;
  if (sal && sal.low > 0 && sal.high > 0) {
    const sym = {GBP:'\u00A3',USD:'$',EUR:'\u20AC',AED:'AED ',CHF:'CHF '}[sal.currency] || sal.currency + ' ';
    $('#salaryEstimate').innerHTML = `
      <div class="salary-range">${sym}${(sal.low/1000).toFixed(0)}K - ${sym}${(sal.high/1000).toFixed(0)}K</div>
      <div class="salary-detail">${esc(sal.basis||'')}</div>`;
    $('#salaryCard').classList.remove('hidden');
  } else {
    $('#salaryCard').classList.add('hidden');
  }

  // Company Intel
  $('#companyIntel').innerHTML = `<p>${esc(data.companyIntel||'')}</p>`;

  // Glassdoor
  if (data.glassdoorRating && data.glassdoorRating > 0) {
    $('#glassdoorScore').textContent = data.glassdoorRating.toFixed(1) + '/5.0';
    $('#glassdoorNote').textContent = data.glassdoorNote || '';
    $('#glassdoorRow').classList.remove('hidden');
  } else {
    $('#glassdoorRow').classList.add('hidden');
  }

  // Sponsorship
  renderSponsorResult(sponsorResults, data.companyName);

  // Reset Q&A
  $('#answerOutput').classList.add('hidden');
  $('#answerOutput').innerHTML = '';
  $('#questionInput').value = '';
}

function renderSponsorResult(results, companyName) {
  const el = $('#sponsorResult');
  if (!el) return;
  if (results === null && sponsorCache === null) {
    el.innerHTML = '<p class="sponsor-warn">Could not load sponsor register. Check connection.</p>';
  } else if (!results || results.length === 0) {
    el.innerHTML = `<div class="sponsor-status sponsor-no"><div class="sponsor-icon">X</div><div><strong>Not Found</strong><p>"${esc(companyName)}" not found in the UK Register of Licensed Sponsors.</p><p class="sponsor-note">Name may differ. <a href="https://uktiersponsors.co.uk/" target="_blank">Check manually</a></p></div></div>`;
  } else {
    const best = results[0];
    const confLabel = {exact:'Exact Match', strong:'Strong Match', likely:'Likely Match', possible:'Possible Match'}[best.confidence] || 'Match';
    const confClass = {exact:'tag-green', strong:'tag-green', likely:'tag-yellow', possible:'tag-yellow'}[best.confidence] || 'tag-yellow';

    const rows = results.map(r => {
      const cTag = {exact:'Exact', strong:'Strong', likely:'Likely', possible:'Possible'}[r.confidence] || '?';
      const cClass = {exact:'tag-green', strong:'tag-green', likely:'tag-yellow', possible:'tag-yellow'}[r.confidence] || 'tag-yellow';
      return `<div class="sponsor-match"><span class="sponsor-name">${esc(r.name)}</span> <span class="bd-tag ${cClass}" style="font-size:9px;margin-left:6px">${cTag}</span><br><span class="sponsor-detail">${esc(r.town)} - ${esc(r.typeRating)}</span><br><span class="sponsor-route">${esc(r.route)}</span></div>`;
    }).join('');

    el.innerHTML = `<div class="sponsor-status sponsor-yes"><div class="sponsor-icon">Y</div><div><strong>Licensed Sponsor</strong> <span class="bd-tag ${confClass}" style="font-size:9px;margin-left:4px">${confLabel}</span><p>${results.length} match${results.length>1?'es':''} found in the official GOV.UK register.</p></div></div><div class="sponsor-matches">${rows}</div>`;
  }
}

// Q&A with conversation history
let qaHistory = []; // conversation turns for refinement
let lastAnswer = '';

async function runQA() {
  const question = $('#questionInput').value.trim();
  if (!question) return $('#questionInput').focus();
  if (!lastAnalysis||!lastJDText) return alert('Run an analysis first.');

  // Reset history for new question
  qaHistory = [];
  lastAnswer = '';

  const btn = $('#answerBtn');
  btn.disabled = true; btn.textContent = 'Generating...';
  const out = $('#answerOutput');
  out.classList.remove('hidden');
  out.innerHTML = '<span class="text-dim">Thinking...</span>';
  $('#feedbackSection').classList.add('hidden');

  const bestResume = resumes[lastAnalysis.bestResumeIndex];
  const tone = $('#tonePicker').value;
  const toneGuide = {professional:'Formal and polished.',conversational:'Warm and natural.',concise:'Direct and brief.'};

  const systemContext = `You are helping a job candidate answer application questions. You have full context of their resume and the job description.

JOB: ${lastAnalysis.jobTitle} at ${lastAnalysis.companyName}
JOB DESCRIPTION: ${lastJDText.substring(0,3000)}
CANDIDATE RESUME ("${bestResume.label}"): ${bestResume.text}

RULES:
- Use specific experiences from the resume that align with the JD
- Feel authentic, not generic
- Default tone: ${toneGuide[tone]}
- Follow ANY formatting or length instructions the user gives (bullets, word count, etc.)
- If the user mentions specific things to include (social media, projects, etc.), weave them in naturally
- Reply with ONLY the answer text. No preamble, no labels, no meta-commentary.`;

  const prompt = `${systemContext}

QUESTION: ${question}`;

  try {
    const answer = await callGemini(prompt, false);
    lastAnswer = answer;
    qaHistory = [
      { role: 'system', content: systemContext },
      { role: 'user', content: question },
      { role: 'answer', content: answer }
    ];
    renderAnswer(answer);
    $('#feedbackSection').classList.remove('hidden');
    $('#feedbackInput').value = '';
  } catch(err) {
    out.innerHTML = `<span style="color:var(--red)">${esc(err.message)}</span>`;
  }
  btn.disabled = false; btn.textContent = 'Generate Answer';
}

async function runRefine() {
  const feedback = $('#feedbackInput').value.trim();
  if (!feedback) return $('#feedbackInput').focus();
  if (!lastAnswer || !lastAnalysis) return;

  const btn = $('#refineBtn');
  btn.disabled = true; btn.textContent = 'Refining...';
  const out = $('#answerOutput');
  out.innerHTML = '<span class="text-dim">Refining...</span>';

  // Build the full conversation context
  const systemCtx = qaHistory.find(h => h.role === 'system')?.content || '';
  const originalQ = qaHistory.find(h => h.role === 'user')?.content || '';

  const prompt = `${systemCtx}

ORIGINAL QUESTION: ${originalQ}

YOUR PREVIOUS ANSWER:
${lastAnswer}

USER FEEDBACK: ${feedback}

Rewrite the answer incorporating the feedback. Keep the same context and specificity. Reply with ONLY the revised answer text.`;

  try {
    const refined = await callGemini(prompt, false);
    lastAnswer = refined;
    qaHistory.push({ role: 'feedback', content: feedback });
    qaHistory.push({ role: 'answer', content: refined });
    renderAnswer(refined);
    $('#feedbackInput').value = '';
  } catch(err) {
    out.innerHTML = `<span style="color:var(--red)">${esc(err.message)}</span>`;
  }
  btn.disabled = false; btn.textContent = 'Refine Answer';
}

function renderAnswer(answer) {
  const out = $('#answerOutput');
  out.classList.remove('hidden');
  // Convert markdown-style bullets to HTML
  let html = esc(answer);
  out.innerHTML = `<button class="copy-btn" id="copyAnswerBtn">Copy</button>${html}`;
  $('#copyAnswerBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(answer);
    $('#copyAnswerBtn').textContent = 'Copied!';
    setTimeout(() => $('#copyAnswerBtn').textContent = 'Copy', 1500);
  });
}

function showError(msg) {
  $('#loadingState').classList.add('hidden');
  $('#resultsState').classList.add('hidden');
  $('#readyState').classList.add('hidden');
  $('#errorState').classList.remove('hidden');
  $('#errorMessage').textContent = msg;
}

// Utils
function extractJSON(raw) {
  try { return JSON.parse(raw.trim()); } catch(e) {}
  let c = raw.replace(/```json\s*/gi,'').replace(/```\s*/gi,'').trim();
  try { return JSON.parse(c); } catch(e) {}
  const s=raw.indexOf('{'), e=raw.lastIndexOf('}');
  if (s!==-1&&e>s) { try { return JSON.parse(raw.substring(s,e+1)); } catch(x) {} }
  if (s!==-1&&e>s) {
    let a=raw.substring(s,e+1);
    a=a.replace(/,\s*([}\]])/g,'$1').replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"');
    try { return JSON.parse(a); } catch(x) {}
  }
  return null;
}

function esc(str) {
  if (!str) return '';
  const d=document.createElement('div'); d.textContent=str; return d.innerHTML;
}

// ── Security ──
function sanitiseInput(text) {
  if (!text) return '';
  // Remove potential prompt injection patterns
  let clean = text;
  // Strip common injection attempts
  clean = clean.replace(/ignore\s+(all\s+)?previous\s+instructions/gi, '[removed]');
  clean = clean.replace(/ignore\s+(all\s+)?above/gi, '[removed]');
  clean = clean.replace(/you\s+are\s+now/gi, '[removed]');
  clean = clean.replace(/act\s+as\s+if/gi, '[removed]');
  clean = clean.replace(/pretend\s+(you|to\s+be)/gi, '[removed]');
  clean = clean.replace(/system\s*:\s*/gi, '[removed]');
  clean = clean.replace(/\[INST\]/gi, '[removed]');
  clean = clean.replace(/<\/?s>/gi, '');
  // Strip HTML tags
  clean = clean.replace(/<[^>]*>/g, '');
  // Limit consecutive whitespace
  clean = clean.replace(/\n{4,}/g, '\n\n\n');
  clean = clean.replace(/\s{10,}/g, '          ');
  return clean;
}

// Validate API key format (basic sanity check)
function isValidGrokKey(key) {
  return key && key.startsWith('xai-') && key.length > 20;
}

function isValidGeminiKey(key) {
  return key && key.length > 20 && key.length < 200;
}
