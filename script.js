// Navigation is handled by real href values on each page.

const newsletterForm = document.querySelector(".newsletter-form");
if (newsletterForm) initializeNewsletterForm(newsletterForm);

function initializeNewsletterForm(form) {
  const input = form.querySelector("input[type='email']");
  const honeypot = form.querySelector("input[name='website']");
  const submit = form.querySelector("button[type='submit']");
  let status = form.querySelector("[data-newsletter-status]");
  if (!status) {
    status = document.createElement("p");
    status.dataset.newsletterStatus = "";
    form.after(status);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = "Subscribing…";

    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ email: input.value, website: honeypot?.value || "" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Subscription failed.");
      form.reset();
      status.textContent = "You're on the list. Check your inbox for a welcome note.";
    } catch (error) {
      status.textContent = error.message || "Subscription failed. Please try again.";
    } finally {
      submit.disabled = false;
    }
  });
}
