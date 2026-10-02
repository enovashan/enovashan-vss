(function () {
  const measurementId = "G-2WZ981QYSD";
  const storageKey = "enovashan-analytics-consent";
  const labels = {
    en: {
      message: "May we use Google Analytics cookies to measure visits and understand how people use Enovashan? Optional; you can change this choice anytime.",
      accept: "Allow analytics",
      decline: "No thanks",
      settings: "Analytics preferences",
      title: "Analytics preferences",
    },
    ur: {
      message: "کیا ہم دوروں کی پیمائش اور ویب سائٹ کے استعمال کو سمجھنے کے لیے Google Analytics کوکیز استعمال کر سکتے ہیں؟ یہ اختیاری ہے، آپ اپنا انتخاب بعد میں بدل سکتے ہیں۔",
      accept: "اجازت دیں",
      decline: "نہیں، شکریہ",
      settings: "تجزیاتی ترجیحات",
      title: "تجزیاتی ترجیحات",
    },
    ar: {
      message: "هل تسمح لنا باستخدام ملفات تعريف الارتباط من Google Analytics لقياس الزيارات وفهم استخدام الموقع؟ هذا اختياري ويمكنك تغيير اختيارك في أي وقت.",
      accept: "السماح بالتحليلات",
      decline: "لا، شكراً",
      settings: "تفضيلات التحليلات",
      title: "تفضيلات التحليلات",
    },
  };
  const text = labels[document.documentElement.lang] || labels.en;
  let choice = null;
  let loaded = false;

  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "granted" || saved === "denied") choice = saved;
  } catch (error) {
    console.warn("Analytics preference storage is unavailable.", error);
  }

  function loadAnalytics() {
    if (loaded) return;
    loaded = true;
    window[`ga-disable-${measurementId}`] = false;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", measurementId);
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    script.onerror = function () { console.error("Google Analytics could not be loaded."); };
    document.head.append(script);
  }

  function clearAnalyticsCookies() {
    const domain = location.hostname === "www.enovashan.com" || location.hostname === "enovashan.com"
      ? "; domain=.enovashan.com" : "";
    document.cookie.split(";").forEach((cookie) => {
      const name = cookie.trim().split("=")[0];
      if (name === "_ga" || name.startsWith("_ga_")) {
        document.cookie = `${name}=; Max-Age=0; path=/`;
        if (domain) document.cookie = `${name}=; Max-Age=0; path=/${domain}`;
      }
    });
  }

  function setChoice(value) {
    const wasLoaded = loaded;
    choice = value;
    try {
      localStorage.setItem(storageKey, value);
    } catch (error) {
      console.warn("Analytics preference could not be saved for future visits.", error);
    }
    if (value === "granted") {
      loadAnalytics();
    } else {
      window[`ga-disable-${measurementId}`] = true;
      if (loaded && window.gtag) window.gtag("consent", "update", { analytics_storage: "denied" });
      clearAnalyticsCookies();
    }
    panel.hidden = true;
    if (value === "denied" && wasLoaded) location.reload();
  }

  window.trackEnovashanEvent = function (name, parameters) {
    if (choice === "granted" && loaded && window.gtag) {
      window.gtag("event", name, parameters);
    }
  };

  const panel = document.createElement("section");
  panel.className = "analytics-consent";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", text.title);
  const description = document.createElement("p");
  description.textContent = text.message;
  const actions = document.createElement("div");
  actions.className = "analytics-consent__actions";
  const accept = document.createElement("button");
  accept.type = "button";
  accept.textContent = text.accept;
  accept.addEventListener("click", () => setChoice("granted"));
  const decline = document.createElement("button");
  decline.type = "button";
  decline.textContent = text.decline;
  decline.addEventListener("click", () => setChoice("denied"));
  actions.append(accept, decline);
  panel.append(description, actions);

  function init() {
    const footer = document.querySelector(".site-footer");
    if (!footer) {
      console.error("Analytics preference control requires a site footer.");
      return;
    }
    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "analytics-settings";
    settings.textContent = text.settings;
    settings.addEventListener("click", () => {
      panel.hidden = false;
      accept.focus();
    });
    footer.append(settings);
    document.body.append(panel);
    panel.hidden = choice !== null;
    if (choice === "granted") loadAnalytics();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
