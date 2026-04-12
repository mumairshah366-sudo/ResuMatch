# ResuMatch — AI Job Fit Analyser

A Chrome extension that analyses any job listing against your resume in one click. Get a relevancy score, ATS check, UK visa sponsorship lookup, salary estimate, and tailored application answers.

## What It Does

Browse to any job listing. Click analyse. Get:

- **7-dimension relevancy score** — function match, seniority, specialisation, experience years, hard skills, domain transferability, location
- **ATS compatibility score** + missing keywords
- **Resume bullet rewrites** tailored to the specific JD
- **UK visa sponsorship check** — live from the official GOV.UK Register of Licensed Sponsors
- **Salary estimate** + Glassdoor rating (when available)
- **Pro tips** — location-specific advice (Germany, Dubai, EU norms), title mismatch warnings, cover letter guidance
- **Q&A mode** — paste any application question, get a tailored answer with refinement loop
- **Multi-resume support** — upload up to 4 resumes, get a recommendation on which to use

## Scoring Framework

The score is **calculated entirely in code** — the AI only classifies dimensions, the JavaScript does all the math.

| Dimension | What it checks |
|---|---|
| Function | Same job family? PM → Engineer = mismatch (capped at 25) |
| Seniority | Right level? Senior → Associate = overqualified (-12) |
| Experience | Years gap? JD asks 10yr, you have 5 = significant gap (-12) |
| Specialisation | Sub-domain fit? Growth PM → Growth PM = exact. Payments PM → Cybersecurity PM = weak (-15) |
| Hard Skills | Required vs optional skills missing |
| Domain | Industry transferability — fintech → banking = high, B2B SaaS → government = low |
| Location | Relocation needed? |

Covers **25 role families** including tech (PM, Engineering, Data Science, Design) and non-tech (Supply Chain, Finance, Compliance, L&D, HR, Legal, Medical, Education, Creative, and more).

## How It Works

Everything runs **client-side** in the Chrome extension. No backend, no server, zero hosting cost.

- **AI Provider:** Grok (xAI) or Gemini (Google) — bring your own API key
- **Sponsorship Data:** Official GOV.UK CSV, fetched on demand
- **Storage:** Chrome's local storage for resumes and keys
- **PDF Parsing:** Bundled PDF.js for resume upload

## Installation

### From Source (Developer Mode)

1. Clone this repo or download the ZIP
2. Go to `chrome://extensions` in Chrome
3. Toggle **Developer mode** (top right)
4. Click **Load unpacked** → select the repo folder
5. Pin the extension to your toolbar

### Setup

1. Click the ResuMatch icon → opens as a side panel
2. Enter your name and email
3. Add your API key:
   - **Grok** (recommended): Get $25 free credits at [console.x.ai](https://console.x.ai)
   - **Gemini** (free tier): Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
4. Add up to 4 resumes (paste text or upload PDF)
5. Navigate to any job listing and click **Analyse This Job**

## Tech Stack

- Vanilla JavaScript (no frameworks)
- Chrome Extension Manifest V3
- Side Panel API
- PDF.js (bundled) for PDF text extraction
- Grok API (xAI) + Gemini API (Google) with automatic fallback
- GOV.UK Sponsor Register CSV

## File Structure

```
├── manifest.json        # Extension configuration
├── popup.html           # Side panel UI
├── popup.js             # All logic — API calls, scoring, rendering
├── styles.css           # UI styles
├── background.js        # Service worker for side panel
├── privacy.html         # Privacy policy
├── lib/
│   ├── pdf.min.js       # PDF.js library
│   └── pdf.worker.min.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Privacy

- All user data (resumes, API keys) stored locally on your device
- No backend server, no database, no tracking
- API keys sent only to the provider you choose (Grok or Gemini) over HTTPS
- Sponsorship check uses publicly available GOV.UK data
- Full privacy policy: [privacy.html](privacy.html)

## Cost

**Free.** No subscription, no hosting costs, no hidden fees. Users bring their own API key:
- Grok: $25 free credits at signup (covers thousands of analyses)
- Gemini: Free tier available (rate-limited)

## Contributing

Issues and PRs welcome. If you want to add more role families to the scoring matrix or improve the sponsorship fuzzy matching, those are great places to start.

## Contact

Built by [Umair Shah](https://linkedin.com/in/muhammad-umair-shah)

Email: m.umairshah366@gmail.com

## License

MIT
