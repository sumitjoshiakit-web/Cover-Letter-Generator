/**
 * Cover Letter Generator — Backend Server
 * Handles Gemini API calls privately and extracts PDF text via pdf-parse & Gemini Vision.
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const pdfParse = require('pdf-parse');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // serves index.html from public/

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// Set API key and model variable
const API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.6-flash';

if (!API_KEY) {
  console.error('Missing GEMINI_API_KEY in environment variables — server will refuse requests.');
}

// Phase 3: PDF text extraction endpoint with Gemini Vision fallback
app.post('/api/extract-resume', upload.single('resume'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  try {
    // Step A: Fast local text extraction using pdf-parse
    const parsed = await pdfParse(req.file.buffer);
    let text = parsed.text ? parsed.text.trim() : '';

    // Step B: Return text if pdf-parse extracted selectable text
    if (text.length >= 30) {
      return res.json({ text });
    }

    // Step C: Fallback to Gemini Multimodal/Vision for scanned or photo PDFs
    if (!API_KEY) {
      return res.status(500).json({ 
        error: 'Scanned PDF detected, but GEMINI_API_KEY is missing on the server environment.' 
      });
    }

    const base64Pdf = req.file.buffer.toString('base64');

    const visionResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: 'application/pdf',
                    data: base64Pdf
                  }
                },
                {
                  text: 'Extract all readable text, experience, skills, and candidate information from this resume document cleanly.'
                }
              ]
            }
          ]
        })
      }
    );

    if (!visionResponse.ok) {
      const errDetail = await visionResponse.text().catch(() => '');
      return res.status(visionResponse.status).json({
        error: `Gemini Vision error while reading scanned PDF: ${errDetail.slice(0, 200)}`
      });
    }

    const visionData = await visionResponse.json();
    const extractedText = visionData?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';

    if (!extractedText.trim()) {
      return res.status(422).json({
        error: 'Could not extract text from this PDF. Please paste your resume text manually.'
      });
    }

    return res.json({ text: extractedText.trim() });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not process PDF file. It may be corrupted or protected.' });
  }
});

// Phase 2: Cover letter generation endpoint
app.post('/api/generate-letter', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'Server is not configured with GEMINI_API_KEY environment variable.' });
  }

  const { name, role, company, skills, resumeText } = req.body || {};
  if (!name || !role || !company) {
    return res.status(400).json({ error: 'name, role, and company are required.' });
  }

  let prompt = `You are an expert career coach. Write a concise, professional, warm cover letter (under 320 words) for the following candidate. Do not use placeholder brackets. Use markdown paragraphs separated by blank lines.

Candidate name: ${name}
Target role: ${role}
Target company: ${company}
Key skills: ${skills || 'not specified'}`;

  if (resumeText && resumeText.trim()) {
    prompt += `\n\nAdditional context extracted from the candidate's resume:\n${resumeText.trim().slice(0, 4000)}`;
  }

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      return res.status(upstream.status).json({ error: `Gemini error: ${detail.slice(0, 300)}` });
    }

    const data = await upstream.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    if (!text) return res.status(502).json({ error: 'Gemini returned an empty response.' });

    res.json({ letter: text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reach Gemini.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Cover Letter Generator listening on :${PORT}`));
