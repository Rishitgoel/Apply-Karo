// Apply karo Field Rules Engine
// Declarative, data-driven field matching — replaces hardcoded if/else regex chains.
// To add a new field: just add a new rule object to FIELD_RULES.

const FIELD_RULES = [
  // ─── NAME FIELDS ───
  {
    id: "firstName",
    keywords: ["first name", "given name", "first", "fname", "forename"],
    namePatterns: ["fname", "first_name", "given_name", "firstName", "givenName", "first-name"],
    profilePath: "personal.firstName",
    fallback: (profile) => (profile.personal?.fullName || "").split(" ")[0] || ""
  },
  {
    id: "lastName",
    keywords: ["last name", "family name", "surname", "lname"],
    namePatterns: ["lname", "last_name", "family_name", "lastName", "familyName", "last-name", "surname"],
    profilePath: "personal.lastName",
    fallback: (profile) => (profile.personal?.fullName || "").split(" ").slice(1).join(" ") || ""
  },
  {
    id: "fullName",
    keywords: ["full name", "your name", "name", "legal name", "preferred name", "candidate name"],
    namePatterns: ["name", "full_name", "fullName", "full-name", "candidate_name", "applicant_name"],
    excludeKeywords: ["company", "school", "employer", "reference", "university", "organization", "business"],
    profilePath: "personal.fullName",
    fallback: (profile) => `${profile.personal?.firstName || ""} ${profile.personal?.lastName || ""}`.trim()
  },

  // ─── CONTACT FIELDS ───
  {
    id: "email",
    keywords: ["email", "e-mail", "email address", "e-mail address", "your email"],
    namePatterns: ["email", "e-mail", "emailAddress", "email_address"],
    typeMatch: "email",
    profilePath: "personal.email",
    allowMultiple: true
  },
  {
    id: "phone",
    keywords: ["phone", "mobile", "telephone", "cell", "phone number", "mobile number", "contact number", "cell phone"],
    namePatterns: ["phone", "mobile", "telephone", "tel", "cellphone", "phone_number", "phoneNumber"],
    typeMatch: "tel",
    profilePath: "personal.phone",
    allowMultiple: true
  },

  // ─── SOCIAL / LINKS ───
  {
    id: "linkedin",
    keywords: ["linkedin", "linkedin profile", "linkedin url", "linkedin link"],
    namePatterns: ["linkedin", "linkedinUrl", "linkedin_url", "linkedin-url"],
    profilePath: "personal.linkedin",
    allowMultiple: true
  },
  {
    id: "github",
    keywords: ["github", "github profile", "github url", "github link"],
    namePatterns: ["github", "githubUrl", "github_url", "github-url"],
    profilePath: "personal.github",
    allowMultiple: true
  },
  {
    id: "website",
    keywords: ["portfolio", "website", "personal website", "blog", "personal site", "your website", "url", "web page"],
    namePatterns: ["portfolio", "website", "personal_website", "blog", "url", "web_url"],
    excludeKeywords: ["company", "employer", "linkedin", "github"],
    profilePath: "personal.website",
    fallback: (profile) => profile.personal?.portfolio || "",
    allowMultiple: true
  },

  // ─── LOCATION ───
  {
    id: "location",
    keywords: ["location", "city", "address", "residence", "current city", "current location", "where are you located", "home address", "street address"],
    namePatterns: ["location", "city", "address", "residence", "current_city", "currentLocation"],
    excludeKeywords: ["company", "employer", "school", "university", "work", "office", "job", "email", "e-mail", "confirm", "verify", "web", "website", "linkedin", "github", "portfolio"],
    profilePath: "personal.location"
  },

  // ─── WORK AUTHORIZATION ───
  {
    id: "authorizedToWork",
    keywords: ["authorized to work", "work authorization", "legally authorized", "eligible to work", "legal right to work", "employment eligibility", "right to work"],
    namePatterns: ["authorized", "work_authorization", "workAuthorization", "eligibility", "legal_right"],
    profilePath: "personal.authorizedToWork",
    allowMultiple: true
  },
  {
    id: "sponsorship",
    keywords: ["sponsorship", "visa sponsorship", "require sponsorship", "need sponsorship", "immigration sponsorship", "sponsor"],
    namePatterns: ["sponsorship", "visa_sponsorship", "requireSponsorship", "needSponsorship"],
    profilePath: "personal.sponsorshipRequired",
    allowMultiple: true
  },
  {
    id: "visaStatus",
    keywords: ["visa status", "immigration status", "citizenship status", "work permit", "employment authorization"],
    namePatterns: ["visa_status", "visaStatus", "immigration_status", "citizenshipStatus"],
    profilePath: "personal.visaStatus",
    allowMultiple: true
  },

  // ─── EDUCATION FIELDS ───
  {
    id: "university",
    keywords: ["university", "school", "college", "institution", "alma mater", "school name", "university name"],
    namePatterns: ["school", "university", "college", "institution", "school_name", "universityName"],
    excludeKeywords: ["high school", "secondary"],
    profilePath: "education[0].school"
  },
  {
    id: "degree",
    keywords: ["degree", "degree type", "level of education", "education level", "highest degree"],
    namePatterns: ["degree", "degreeType", "degree_type", "education_level", "educationLevel"],
    profilePath: "education[0].degree"
  },
  {
    id: "fieldOfStudy",
    keywords: ["major", "field of study", "area of study", "discipline", "concentration", "specialization", "subject"],
    namePatterns: ["major", "field_of_study", "fieldOfStudy", "discipline", "specialization", "concentration"],
    profilePath: "education[0].fieldOfStudy"
  },
  {
    id: "gpa",
    keywords: ["gpa", "grade point", "cgpa", "grade", "academic score", "cumulative gpa"],
    namePatterns: ["gpa", "cgpa", "grade_point", "gradePoint", "cumulativeGPA"],
    profilePath: "education[0].gpa"
  },
  {
    id: "graduationDate",
    keywords: ["graduation date", "expected graduation", "graduation year", "end date", "completion date"],
    namePatterns: ["graduation_date", "graduationDate", "graduation_year", "endDate", "completionDate"],
    excludeKeywords: ["work", "job", "employment", "company"],
    profilePath: "education[0].endDate"
  },

  // ─── EXPERIENCE FIELDS ───
  {
    id: "company",
    keywords: ["company", "employer", "organization", "company name", "current employer", "most recent employer"],
    namePatterns: ["company", "employer", "organization", "company_name", "companyName", "currentEmployer"],
    excludeKeywords: ["school", "university"],
    profilePath: "experience[0].company"
  },
  {
    id: "jobTitle",
    keywords: ["job title", "title", "position", "role", "current title", "current position", "designation"],
    namePatterns: ["title", "job_title", "jobTitle", "position", "role", "designation", "current_title"],
    excludeKeywords: ["degree", "school", "university", "name"],
    profilePath: "experience[0].title"
  },

  // ─── PROFILE / BIO ───
  {
    id: "summary",
    keywords: ["summary", "bio", "about you", "about yourself", "professional summary", "personal statement", "objective", "tell us about yourself", "introduction"],
    namePatterns: ["summary", "bio", "about", "objective", "personal_statement", "professionalSummary"],
    profilePath: "summary"
  },
  {
    id: "skills",
    keywords: ["skills", "technical skills", "key skills", "competencies", "technologies", "proficiencies"],
    namePatterns: ["skills", "technical_skills", "competencies", "technologies"],
    profilePath: "skills"
  },

  // ─── COMMON APPLICATION FIELDS (mapped to customFields) ───
  {
    id: "gender",
    keywords: ["gender", "sex", "gender identity"],
    namePatterns: ["gender", "sex", "gender_identity"],
    profilePath: "customFields.gender",
    sensitive: true
  },
  {
    id: "ethnicity",
    keywords: ["race", "ethnicity", "racial", "ethnic background", "race/ethnicity"],
    namePatterns: ["race", "ethnicity", "racial", "ethnic_background"],
    profilePath: "customFields.ethnicity",
    sensitive: true
  },
  {
    id: "veteranStatus",
    keywords: ["veteran", "veteran status", "military", "protected veteran"],
    namePatterns: ["veteran", "veteran_status", "military", "veteranStatus"],
    profilePath: "customFields.veteranStatus",
    sensitive: true
  },
  {
    id: "disabilityStatus",
    keywords: ["disability", "disability status", "disabled", "handicap"],
    namePatterns: ["disability", "disability_status", "disabilityStatus"],
    profilePath: "customFields.disabilityStatus",
    sensitive: true
  },
  {
    id: "salaryExpectation",
    keywords: ["salary", "expected salary", "salary expectation", "desired salary", "compensation", "pay expectation", "desired compensation"],
    namePatterns: ["salary", "expected_salary", "salaryExpectation", "compensation", "desired_salary"],
    profilePath: "customFields.salaryExpectation"
  },
  {
    id: "startDate",
    keywords: ["start date", "earliest start", "available to start", "availability", "when can you start", "notice period"],
    namePatterns: ["start_date", "startDate", "availability", "earliest_start", "availableDate"],
    excludeKeywords: ["school", "university", "education"],
    profilePath: "customFields.startDate"
  },
  {
    id: "yearsOfExperience",
    keywords: ["years of experience", "experience years", "total experience", "how many years", "work experience"],
    namePatterns: ["years_experience", "yearsOfExperience", "experience_years", "totalExperience"],
    profilePath: "customFields.yearsOfExperience"
  },
  {
    id: "referral",
    keywords: ["referral", "referred by", "how did you hear", "hear about us", "source", "how did you find"],
    namePatterns: ["referral", "referred_by", "referredBy", "source", "howDidYouHear"],
    profilePath: "customFields.referral"
  }
];

// ─── MATCHING ENGINE ───

/**
 * Resolve a dot-path like "personal.email" or "education[0].school" 
 * against a profile object and return the value.
 */
function resolveProfilePath(profile, path) {
  if (!path || !profile) return null;

  const parts = path.split(".");
  let current = profile;

  for (const part of parts) {
    if (current === null || current === undefined) return null;

    // Handle array indexing like "education[0]"
    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      const key = arrayMatch[1];
      const index = parseInt(arrayMatch[2], 10);
      current = current[key];
      if (Array.isArray(current) && current.length > index) {
        current = current[index];
      } else {
        return null;
      }
    } else {
      current = current[part];
    }
  }

  return current !== undefined && current !== null && String(current).trim() !== "" ? String(current) : null;
}

/**
 * Check if a field (label + name + id + type) matches a given rule.
 * Returns true if matched, false otherwise.
 */
function doesFieldMatchRule(rule, fieldInfo) {
  const { label, name, id, type } = fieldInfo;
  const cleanLabel = (label || "").toLowerCase().trim();
  const cleanName = (name || "").toLowerCase().trim();
  const cleanId = (id || "").toLowerCase().trim();

  // Check exclude keywords first — if the label contains any excluded term, skip
  if (rule.excludeKeywords) {
    for (const exclude of rule.excludeKeywords) {
      if (cleanLabel.includes(exclude.toLowerCase())) {
        return false;
      }
    }
  }

  // Match by input type (e.g., type="email", type="tel")
  if (rule.typeMatch && type === rule.typeMatch) {
    return true;
  }

  // Match by keywords in the label text
  if (rule.keywords) {
    for (const keyword of rule.keywords) {
      const kw = keyword.toLowerCase();
      if (cleanLabel === kw || cleanLabel.includes(kw)) {
        return true;
      }
    }
  }

  // Match by input name or id patterns
  if (rule.namePatterns) {
    for (const pattern of rule.namePatterns) {
      const pat = pattern.toLowerCase();
      if (cleanName === pat || cleanName.includes(pat) || cleanId === pat || cleanId.includes(pat)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Run Phase 1 matching: iterate all rules against all fields.
 * Returns { matched: Map<Element, {value, ruleId}>, unmatched: Element[] }
 */
function matchFieldsByRules(fields, profile, learnedMappings, customFields) {
  const matched = new Map();
  const unmatched = [];
  const usedRules = new Set(); // Prevent same rule from matching multiple fields

  for (const fieldInfo of fields) {
    const { element, label, name, id, type } = fieldInfo;
    const cleanLabel = (label || "").toLowerCase().trim();

    // Priority 1: Learned mappings (highest priority — user-confirmed values)
    if (learnedMappings && learnedMappings[cleanLabel] !== undefined && learnedMappings[cleanLabel] !== "") {
      matched.set(element, { value: learnedMappings[cleanLabel], source: "learned", ruleId: null });
      continue;
    }

    // Priority 2: Check custom fields by label match
    if (customFields && customFields[cleanLabel] !== undefined && customFields[cleanLabel] !== "") {
      matched.set(element, { value: customFields[cleanLabel], source: "customField", ruleId: null });
      continue;
    }

    // Priority 3: Rule-based matching
    let ruleMatched = false;
    for (const rule of FIELD_RULES) {
      if (usedRules.has(rule.id) && !rule.allowMultiple) continue; // Each rule matches at most one field per form unless allowMultiple is true

      if (doesFieldMatchRule(rule, fieldInfo)) {
        // Resolve the value from the profile
        let value = resolveProfilePath(profile, rule.profilePath);

        // Try fallback function if no direct value
        if (!value && rule.fallback) {
          value = rule.fallback(profile);
        }

        if (value && value.trim() !== "") {
          matched.set(element, { value, source: "rule", ruleId: rule.id });
          usedRules.add(rule.id);
          ruleMatched = true;
          break;
        }
      }
    }

    if (!ruleMatched) {
      unmatched.push(fieldInfo);
    }
  }

  return { matched, unmatched };
}

// Export for content script use
if (typeof window !== "undefined") {
  window.FIELD_RULES = FIELD_RULES;
  window.resolveProfilePath = resolveProfilePath;
  window.doesFieldMatchRule = doesFieldMatchRule;
  window.matchFieldsByRules = matchFieldsByRules;
}
