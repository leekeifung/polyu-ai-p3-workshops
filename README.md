polyu-ai-p3-workshop/
├── index.html          ← student upload page
├── admin.html          ← lecturer dashboard
├── style.css           ← PolyU-branded, kid-friendly
├── app.js              ← shared FE logic (both pages)
├── students.json       ← name ↔ ID map
├── package.json
├── vercel.json
├── .env.example
├── .gitignore
├── api/
│   ├── upload.js       ← main: verify → sanitize → OneDrive
│   ├── students.js     ← GET names for dropdown
│   ├── verify.js       ← POST {name,studentId} → {valid}
│   ├── submissions.js  ← GET latest 50
│   └── file.js         ← proxy file bytes (for HTML preview, avoids CORS)
└── lib/                ← shared server helpers (NOT endpoints; outside /api on purpose)
    ├── graph.js        ← Microsoft Graph API
    ├── students.js
    └── http.js         ← CORS + rate-limit
