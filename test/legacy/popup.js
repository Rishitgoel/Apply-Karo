// ResumeFiler Popup JS Handler

document.addEventListener("DOMContentLoaded", async () => {
  // Load current storage settings
  const state = await ResumeStorage.loadAll();
  
  const autofillToggle = document.getElementById("autofill-toggle");
  const resumeBadge = document.getElementById("resume-badge");
  const resumeFilename = document.getElementById("resume-filename");
  const aiBadge = document.getElementById("ai-badge");
  const fillBtn = document.getElementById("fill-btn");
  const dashboardBtn = document.getElementById("dashboard-btn");

  // Initialize values
  autofillToggle.checked = state.settings.autofillOnLoad;
  
  if (state.resume && state.resume.base64) {
    resumeBadge.textContent = "Active";
    resumeBadge.className = "badge badge-success";
    resumeFilename.textContent = state.resume.fileName || "resume.pdf";
    resumeFilename.style.display = "block";
  } else {
    resumeBadge.textContent = "Missing";
    resumeBadge.className = "badge badge-danger";
    resumeFilename.style.display = "none";
  }

  if (state.settings.geminiApiKey && state.settings.geminiApiKey.trim() !== "") {
    aiBadge.textContent = "Ready";
    aiBadge.className = "badge badge-success";
  } else {
    aiBadge.textContent = "Not Configured";
    aiBadge.className = "badge badge-warning";
  }

  // Toggle autofill settings
  autofillToggle.addEventListener("change", async () => {
    state.settings.autofillOnLoad = autofillToggle.checked;
    await ResumeStorage.saveSettings(state.settings);
  });

  // Open Options page
  dashboardBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // Trigger manual autofill on active tab
  fillBtn.addEventListener("click", async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) return;
      
      const activeTab = tabs[0];
      
      // Send message to the tab content script
      chrome.tabs.sendMessage(activeTab.id, { action: "manual_autofill" }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("Content script not responding or not active:", chrome.runtime.lastError.message);
          alert("Could not trigger autofill on this page. Please refresh the page and try again (note that Chrome extensions do not run on blank tabs or settings pages).");
        } else {
          window.close(); // Close popup on success
        }
      });
    } catch (err) {
      console.error("Error triggering autofill:", err);
    }
  });
});
