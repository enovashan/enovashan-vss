const commentsSections = document.querySelectorAll("[data-comments]");

for (const section of commentsSections) {
  initializeComments(section);
}

async function initializeComments(section) {
  const slug = section.dataset.articleSlug;
  const list = section.querySelector("[data-comment-list]");
  const count = section.querySelector("[data-comment-count]");
  const form = section.querySelector("[data-comment-form]");
  const status = section.querySelector("[data-comment-status]");
  const submit = form.querySelector("button[type='submit']");

  function setStatus(message, state = "") {
    status.textContent = message;
    status.dataset.state = state;
  }

  function renderComments(comments) {
    list.replaceChildren();
    count.textContent = String(comments.length);

    if (comments.length === 0) {
      const empty = document.createElement("li");
      empty.className = "comment-empty";
      empty.textContent = "Be the first to join the conversation.";
      list.append(empty);
      return;
    }

    for (const comment of comments) {
      const item = document.createElement("li");
      item.className = "comment-item";
      const header = document.createElement("div");
      header.className = "comment-item__header";
      const name = document.createElement("strong");
      name.textContent = comment.display_name;
      const date = document.createElement("time");
      date.dateTime = comment.created_at;
      date.textContent = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
      }).format(new Date(comment.created_at));
      const body = document.createElement("p");
      body.textContent = comment.body;
      header.append(name, date);
      item.append(header, body);
      list.append(item);
    }
  }

  async function loadComments() {
    const response = await fetch(`/api/comments?slug=${encodeURIComponent(slug)}`, {
      headers: { accept: "application/json" },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Comments could not be loaded.");
    renderComments(result.comments);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    setStatus("Saving your comment…");
    const values = new FormData(form);

    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          slug,
          name: values.get("name"),
          body: values.get("body"),
          website: values.get("website"),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Your comment could not be saved.");
      form.reset();
      await loadComments();
      setStatus("Your comment is posted.", "success");
    } catch (error) {
      setStatus(error.message || "Your comment could not be saved.", "error");
    } finally {
      submit.disabled = false;
    }
  });

  try {
    await loadComments();
  } catch (error) {
    setStatus(error.message || "Comments could not be loaded.", "error");
  }
}
