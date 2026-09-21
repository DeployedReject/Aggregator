const browserAPI = globalThis.browser || globalThis.chrome;
const agBtn = document.querySelector("#open-ag-btn");
const genMenuBtn = document.querySelector("#open-gen-menu");
const analyzeBtn = document.querySelector("#analyze");
const generateBtn = document.querySelector("#generate");
const backBtn = document.querySelector("#back");
const mainMenu = document.querySelector("#main-menu");
const genMenu = document.querySelector("#gen-menu");
const domainBadge = document.querySelector(".domain");
let currentMenu = null;

if (agBtn)
  agBtn.addEventListener("click", () => {
    browserAPI.tabs.create({
      url: browserAPI.runtime.getURL("super-website/dist/index.html"),
    });
  });

async function loadGenMenu() {
  mainMenu.classList.add("hidden");
  genMenu.classList.remove("hidden");
  currentMenu = genMenu;

  try {
    const [activeTab] = await browserAPI.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!activeTab || !activeTab.url) {
      domainBadge.textContent = "No Active Tab";
      return;
    }

    const domain = new URL(activeTab.url).hostname;
    if (!domain) {
      domainBadge.textContent = "No Active Webpage";
      return;
    }
    domainBadge.textContent = `Site: ${domain}`;

    const key = `recording_${domain}`;
    const data = await browserAPI.storage.local.get(key);

    if (data[key]) {
      generateBtn.disabled = false;
      analyzeBtn.textContent = "Retry Analysis?";
    } else {
      generateBtn.disabled = true;
      analyzeBtn.textContent = "Analyze";
    }
  } catch (err) {
    console.error(err);
    domainBadge.textContent = "Error detecting site";
  }
}

function loadMainMenu() {
  mainMenu.classList.remove("hidden");
  if (currentMenu) currentMenu.classList.add("hidden");
  else console.log("how tf?");
}

if (genMenuBtn) genMenuBtn.addEventListener("click", loadGenMenu);

if (backBtn) backBtn.addEventListener("click", loadMainMenu);
