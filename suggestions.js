const suggestionForm = document.getElementById("suggestionForm");
const suggestionList = document.getElementById("suggestionList");
const suggestionCounts = document.getElementById("suggestionCounts");
const suggestionStatus = document.getElementById("suggestionStatus");
const suggestionSubmit = document.getElementById("suggestionSubmit");
const suggestionLanguage = document.getElementById("suggestionLanguage");
const suggestionText = document.getElementById("suggestionText");

suggestionLanguage.addEventListener("change", () => {
  const isRtl = suggestionLanguage.value === "ur" || suggestionLanguage.value === "ar";
  suggestionText.dir = isRtl ? "rtl" : "ltr";
  suggestionText.lang = suggestionLanguage.value;
});

function setSuggestionStatus(message, state = "") {
  suggestionStatus.textContent = message;
  suggestionStatus.dataset.state = state;
}

async function readSuggestionResponse(response) {
  try {
    return await response.json();
  } catch {
    throw new Error(`The suggestions service returned an invalid response (HTTP ${response.status}).`);
  }
}

function renderSuggestions(suggestions) {
  const completed = suggestions.filter((suggestion) => suggestion.completed).length;
  const pending = suggestions.length - completed;
  suggestionCounts.textContent = `${completed} completed · ${pending} pending · ${suggestions.length} total`;

  if (suggestions.length === 0) {
    suggestionList.innerHTML = '<li class="suggestion-empty">No suggestions yet. Be the first to share an idea.</li>';
    return;
  }

  suggestionList.replaceChildren(...suggestions.map((suggestion) => {
    const item = document.createElement("li");
    item.className = "suggestion-item";
    item.dataset.completed = String(suggestion.completed);

    const status = document.createElement("span");
    status.className = "suggestion-mark";
    status.setAttribute("role", "img");
    status.setAttribute("aria-label", suggestion.completed ? "Completed" : "Pending");
    status.textContent = suggestion.completed ? "✓" : "";

    const text = document.createElement("p");
    text.className = "suggestion-item-text";
    text.textContent = suggestion.suggestion;
    if (suggestion.language === "ur" || suggestion.language === "ar") {
      text.dir = "rtl";
      text.lang = suggestion.language;
    } else {
      text.dir = "auto";
    }

    const language = document.createElement("span");
    language.className = "suggestion-language";
    language.textContent = { en: "English", ur: "اردو", ar: "العربية" }[suggestion.language] || "English";
    if (suggestion.language === "ur" || suggestion.language === "ar") {
      language.dir = "rtl";
      language.lang = suggestion.language;
    }

    item.append(status, text, language);
    return item;
  }));
}

async function loadSuggestions() {
  suggestionList.innerHTML = '<li class="suggestion-empty">Loading suggestions…</li>';
  try {
    const response = await fetch("/api/suggestions");
    const data = await readSuggestionResponse(response);
    if (!response.ok) throw new Error(data.error || "Could not load suggestions.");
    renderSuggestions(data.suggestions || []);
  } catch (error) {
    suggestionCounts.textContent = "Suggestions are temporarily unavailable.";
    suggestionList.innerHTML = '<li class="suggestion-empty">We could not load the list. Please try again later.</li>';
    setSuggestionStatus(error.message, "error");
  }
}

suggestionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  suggestionSubmit.disabled = true;
  setSuggestionStatus("Sending your suggestion…");

  try {
    const response = await fetch("/api/suggestions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        suggestion: document.getElementById("suggestionText").value,
        language: document.getElementById("suggestionLanguage").value,
        website: document.getElementById("suggestionWebsite").value,
      }),
    });
    const data = await readSuggestionResponse(response);
    if (!response.ok) throw new Error(data.error || "Could not send your suggestion.");

    suggestionForm.reset();
    suggestionText.dir = "ltr";
    suggestionText.lang = "en";
    setSuggestionStatus(
      data.alreadyExists ? "That suggestion is already on the list—thanks for checking!" : "Thank you. Your suggestion has been added to the list.",
      "success",
    );
    await loadSuggestions();
  } catch (error) {
    setSuggestionStatus(error.message, "error");
  } finally {
    suggestionSubmit.disabled = false;
  }
});

loadSuggestions();
