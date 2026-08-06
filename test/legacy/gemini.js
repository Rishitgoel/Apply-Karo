// Apply karo Gemini API Handler
// Interfaces with the Google Gemini API to extract resume text, answer questions, and generate cover letters.

const ResumeGemini = {
  // Tolerant JSON parse: strip ``` fences, then fall back to grabbing the
  // outermost {...} / [...] so a little stray prose doesn't break parsing.
  extractJson: function(raw) {
    let t = String(raw || "").trim();
    if (t.startsWith("```")) {
      t = t.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
    }
    try { return JSON.parse(t); } catch (_) {}
    const fo = t.indexOf("{"), lo = t.lastIndexOf("}");
    if (fo !== -1 && lo > fo) { try { return JSON.parse(t.slice(fo, lo + 1)); } catch (_) {} }
    const fa = t.indexOf("["), la = t.lastIndexOf("]");
    if (fa !== -1 && la > fa) { try { return JSON.parse(t.slice(fa, la + 1)); } catch (_) {} }
    return null;
  },

  // Generate content via Gemini. The actual network call — with retry / backoff,
  // model fallback, and per-attempt timeout — runs in the background service
  // worker (see background.js), so the API key and request never execute in the
  // page context and the fetch uses the extension's host permissions. The
  // signature and Promise<string> contract are unchanged for all callers.
  callGemini: function(apiKey, model, payload, options) {
    if (!apiKey) {
      return Promise.reject(new Error("Gemini API key is not configured. Please add your key in the Options Dashboard."));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        chrome.runtime.sendMessage(
          { type: "gemini_generate", apiKey, model, payload, options: options || {} },
          (resp) => {
            if (settled) return;
            settled = true;
            if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
            if (!resp) { reject(new Error("No response from the background service worker.")); return; }
            if (resp.ok) resolve(resp.text);
            else reject(new Error(resp.error || "Gemini request failed."));
          }
        );
      } catch (e) {
        if (!settled) { settled = true; reject(e); }
      }
    });
  },

  // Parse resume PDF text using Gemini multimodal capability
  parseResumePDF: async function(apiKey, model, base64DataUrl) {
    // Extract raw base64 data from Data URL
    const parts = base64DataUrl.split(",");
    if (parts.length < 2) {
      throw new Error("Invalid resume file format.");
    }
    const mimeType = parts[0].match(/:(.*?);/)?.[1] || "application/pdf";
    const base64Data = parts[1];

    const payload = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Data
              }
            },
            {
              text: "You are an expert resume parser. Extract all textual content from this resume file exactly as it is, including work experience, education, skills, and summary. Return only the extracted plain text formatted clearly, without any explanations or conversational chatter."
            }
          ]
        }
      ]
    };

    return await this.callGemini(apiKey, model, payload);
  },

  // Answer a specific application question using resume and profile context
  answerQuestion: async function(apiKey, model, question, profile, resumeText) {
    const profileString = JSON.stringify(profile, null, 2);
    const prompt = `You are a helpful AI assisting a candidate with a job application form.
Your task is to write a highly professional, concise, and compelling answer to the following application question.

Candidate Profile Summary:
${profileString}

Candidate Resume Text:
${resumeText || "No resume text available."}

---
APPLICATION QUESTION:
"${question}"
---

Guidelines:
1. Ensure the tone is professional, confident, and matches standard job applications.
2. Directly answer the question using the candidate's actual experience and background from their profile/resume. Do not hallucinate experiences.
3. Keep the response concise and appropriate for the form field size (typically 1-3 short paragraphs unless a specific limit is implied).
4. Return ONLY the answer text, with no preamble, quotes around the output, or feedback.`;

    const payload = {
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ]
    };

    return await this.callGemini(apiKey, model, payload);
  },

  // Generate a customized cover letter based on the job description
  generateCoverLetter: async function(apiKey, model, jobDescription, profile, resumeText) {
    const personal = profile.personal || {};
    const candidateName = personal.fullName || `${personal.firstName || ""} ${personal.lastName || ""}`.trim() || "Candidate";
    const profileString = JSON.stringify(profile, null, 2);

    const prompt = `You are an expert career advisor and professional writer.
Write a highly tailored, compelling cover letter for the candidate based on the job description provided.

Candidate Name: ${candidateName}
Candidate Profile:
${profileString}

Candidate Resume:
${resumeText || "No resume text available."}

---
JOB DESCRIPTION:
${jobDescription}
---

Guidelines:
1. Write a professional, polished cover letter of approximately 300-400 words.
2. Highlight specific skills, achievements, and experiences from the candidate's resume/profile that align directly with the key requirements of the job description.
3. Keep it structured with a professional greeting, 3-4 body paragraphs (introduction, why candidate is a fit, why they want this company, call to action), and a professional sign-off.
4. Use standard placeholders like "[Company Name]" or "[Hiring Manager]" if the company name or contact is not clearly identifiable in the job description.
5. Return ONLY the cover letter text, with no introductory/concluding explanations or conversational comments.`;

    const payload = {
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ]
    };

    return await this.callGemini(apiKey, model, payload);
  },

  // Batch-analyze unmatched form fields using AI
  // fieldDescriptors: Array of { fieldId, label, name, type, tagName, options[], placeholder }
  // Returns: { "field_0": "value", "field_1": "value", ... } or null for fields it can't answer
  analyzeFormFields: async function(apiKey, model, fieldDescriptors, profile, resumeText, customFields) {
    const profileString = JSON.stringify(profile, null, 2);
    const customFieldsString = JSON.stringify(customFields || {}, null, 2);

    // Build a concise field list for the prompt
    const fieldList = fieldDescriptors.map((f, i) => {
      let desc = `Field ${i}: label="${f.label}", name="${f.name}", type="${f.type}", tag="${f.tagName}"`;
      if (f.placeholder) desc += `, placeholder="${f.placeholder}"`;
      if (f.options && f.options.length > 0) {
        desc += `, options=[${f.options.slice(0, 30).map(o => `"${o}"`).join(", ")}]`;
      }
      return desc;
    }).join("\n");

    const prompt = `You are an intelligent job application form auto-filler. Your task is to analyze form fields and determine the best value to fill from the candidate's profile.

CANDIDATE PROFILE:
${profileString}

CANDIDATE CUSTOM DATA:
${customFieldsString}

CANDIDATE RESUME TEXT:
${(resumeText || "").slice(0, 6000) || "No resume text available."}

---
UNMATCHED FORM FIELDS TO ANALYZE:
${fieldList}

---
INSTRUCTIONS:
1. For each field, determine the most appropriate value from the candidate's profile, custom data, or resume.
2. For dropdown/select fields with options provided, the value MUST be the EXACT option text that best matches (from the options array). If none match well, pick the closest, or "Other"/"Prefer not to say" if available.
3. For text fields asking questions (e.g. "Why do you want to work here?"), write a concise professional answer using the candidate's background. Never invent experience the candidate does not have.
4. If you genuinely cannot determine a value for a field, set "value" to null and "confidence" to 0.
5. For yes/no questions, answer "Yes" or "No" based on the candidate's profile.
6. "confidence" is your honest probability (0.0-1.0) that the value is correct AND appropriate; use a low value when guessing or when the profile lacks the information.

Return ONLY a valid JSON object mapping each field index to an object {"value": <string or null>, "confidence": <number 0.0-1.0>}:
{
  "0": {"value": "value for field 0", "confidence": 0.95},
  "1": {"value": null, "confidence": 0},
  "3": {"value": "selected option text", "confidence": 0.8}
}

No explanations, no markdown formatting, just the raw JSON.`;

    const payload = {
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: { responseMimeType: "application/json" }
    };

    const jsonText = await this.callGemini(apiKey, model, payload);
    const parsed = this.extractJson(jsonText);
    if (!parsed) {
      console.error("Apply karo: Failed to parse AI form analysis response:", jsonText);
      return {};
    }
    return parsed;
  },

  // Parse unstructured resume text into a structured profile JSON object
  extractProfileFromText: async function(apiKey, model, resumeText) {
    const prompt = `You are a professional resume parser. Your job is to extract data from the resume text and format it strictly into a structured JSON profile object.

Resume Text:
${resumeText}

---
Strictly output a valid JSON object matching the following structure:
{
  "personal": {
    "firstName": "First name of candidate",
    "lastName": "Last name of candidate",
    "fullName": "Full name of candidate",
    "email": "Email address",
    "phone": "Phone number",
    "website": "Personal website or primary portfolio link",
    "linkedin": "LinkedIn profile link",
    "github": "GitHub profile link",
    "portfolio": "Secondary website or blog link (optional)",
    "location": "City, State / Country",
    "visaStatus": "One of: 'Citizen', 'Authorized to work', 'Requires sponsorship'",
    "authorizedToWork": "One of: 'Yes', 'No'",
    "sponsorshipRequired": "One of: 'Yes', 'No'"
  },
  "education": [
    {
      "school": "Name of university/school",
      "degree": "Degree name (e.g. B.Tech, M.S., B.S.)",
      "fieldOfStudy": "Major / field of study",
      "startDate": "Start date (e.g., Aug 2023)",
      "endDate": "End date or expected graduation (e.g., May 2027)",
      "gpa": "GPA or grade (optional, e.g. 9.18 / 10)"
    }
  ],
  "experience": [
    {
      "company": "Company Name",
      "title": "Job Title",
      "location": "Job Location",
      "timeframe": "Time period worked (e.g., May 2026 - Jul 2026)",
      "description": "Job description bullet points separated by newlines"
    }
  ],
  "summary": "A short, professional summary bio (1-2 sentences)",
  "skills": "A single comma-separated list of technical skills (e.g., C++, React, Docker)"
}

Do not return any explanation or markdown formatting (like \`\`\`json). Return only the raw JSON string. If a field cannot be found, leave it as an empty string ("") or empty array ([]).`;

    const payload = {
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: { responseMimeType: "application/json" }
    };

    const jsonText = await this.callGemini(apiKey, model, payload);
    const parsed = this.extractJson(jsonText);
    if (!parsed) {
      throw new Error("Could not parse the profile JSON returned by Gemini. Try again or pick a different model.");
    }
    return parsed;
  }
};

// Make it available globally in non-modular environment
if (typeof window !== "undefined") {
  window.ResumeGemini = ResumeGemini;
}
