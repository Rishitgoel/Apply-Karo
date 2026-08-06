// ResumeFiler Storage Handler
// Handles saving and loading profiles, resumes, settings, and learned mappings.

const ResumeStorage = {
  // Default values
  DEFAULTS: {
    profile: {
      personal: {
        firstName: "Rishit",
        lastName: "Goel",
        fullName: "Rishit Goel",
        email: "rishitgoel259@gmail.com",
        phone: "+91 9996007259",
        website: "https://leetcode.com/u/rishitgoel",
        linkedin: "https://linkedin.com/in/rishitgoel124",
        github: "https://github.com/Rishitgoel",
        portfolio: "",
        location: "New Delhi, India",
        visaStatus: "Authorized to work", // e.g., Authorized, Need sponsorship, Citizen
        authorizedToWork: "Yes",          // "Yes" or "No"
        sponsorshipRequired: "No"          // "Yes" or "No"
      },
      education: [
        {
          school: "Delhi Technological University (DTU)",
          degree: "B.Tech",
          fieldOfStudy: "Software Engineering",
          startDate: "Aug 2023",
          endDate: "May 2027",
          gpa: "9.18 / 10"
        }
      ],
      experience: [
        {
          company: "TruSave Fintech (Bachatt)",
          title: "Software Engineer Intern",
          location: "New Delhi, India",
          timeframe: "May 2026 - Jul 2026",
          description: "- Built a centralized access-management portal that unifies 8+ enterprise tools (AWS, GCP, Azure, GitHub, Jira, Grafana, Redash) behind a single role-based control panel.\n- Integrated Keycloak as the identity provider for OIDC-based single sign-on, mapping roles to fine-grained permissions (RBAC) to automate onboarding and de-provisioning.\n- Modeled users, roles, and audit logs in PostgreSQL (Supabase) with a TypeScript backend, and containerized the stack with Docker for reproducible deployments."
        }
      ],
      summary: "B.Tech in Software Engineering student at Delhi Technological University with professional experience as a Software Engineer Intern at TruSave Fintech. Skilled in building centralized enterprise panels, backend integration with Keycloak, containerized systems using Docker, and database modeling with PostgreSQL.",
      skills: "C++, Python, C, JavaScript, TypeScript, SQL, React.js, Redux Toolkit, HTML, CSS, Tailwind CSS, Node.js, Express.js, REST APIs, JWT, OAuth2 / OIDC, Socket.io, WebRTC, MongoDB, PostgreSQL, Docker, Keycloak, Supabase, Git, GitHub, VS Code",
      customFields: {} // Dynamic key-value pairs: gender, salary, start date, etc.
    },
    resume: {
      fileName: "",
      fileSize: "",
      base64: "", // Store base64 data url for file input injection
      text: ""    // Extracted plain text for AI context
    },
    learnedMappings: {},
    settings: {
      geminiApiKey: "",
      geminiModel: "gemini-3.5-flash",
      autofillOnLoad: true,
      aiAutofillEnabled: true // Phase 2 AI autofill toggle
    }
  },

  // Helper to get raw storage data
  get: function(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => {
        resolve(result);
      });
    });
  },

  // Helper to set raw storage data
  set: function(items) {
    return new Promise((resolve) => {
      chrome.storage.local.set(items, () => {
        resolve();
      });
    });
  },

  // Load complete state
  loadAll: async function() {
    const data = await this.get(null);
    return {
      profile: data.profile || { ...this.DEFAULTS.profile },
      resume: data.resume || { ...this.DEFAULTS.resume },
      learnedMappings: data.learnedMappings || { ...this.DEFAULTS.learnedMappings },
      settings: data.settings || { ...this.DEFAULTS.settings }
    };
  },

  // Load a single key with default fallback
  loadKey: async function(key) {
    const result = await this.get(key);
    return result[key] || this.DEFAULTS[key];
  },

  // Save profile
  saveProfile: async function(profileData) {
    await this.set({ profile: profileData });
  },

  // Save resume file (base64 and text)
  saveResume: async function(resumeData) {
    await this.set({ resume: resumeData });
  },

  // Save learned field mappings
  saveLearnedMappings: async function(mappings) {
    await this.set({ learnedMappings: mappings });
  },

  // Learn a single custom field mapping
  learnField: async function(label, value) {
    if (!label || label.trim() === "") return;
    const cleanLabel = label.trim().toLowerCase();
    const current = await this.loadKey("learnedMappings");
    current[cleanLabel] = value;
    await this.saveLearnedMappings(current);
  },

  // Save a single custom profile field (e.g., gender, salary expectation)
  saveCustomField: async function(key, value) {
    if (!key || key.trim() === "") return;
    const profile = await this.loadKey("profile");
    if (!profile.customFields) profile.customFields = {};
    profile.customFields[key.trim().toLowerCase()] = value;
    await this.saveProfile(profile);
  },

  // Save extension settings
  saveSettings: async function(settingsData) {
    await this.set({ settings: settingsData });
  }
};

// Make it available globally in non-modular environment
if (typeof window !== "undefined") {
  window.ResumeStorage = ResumeStorage;
}
