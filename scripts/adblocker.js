(() => {
  const browserAPI = globalThis.browser || globalThis.chrome;

  const defaultAdList = [
    "teniacites.com",
    "histats.com",
    "popads",
    "adcash",
    "propellerads",
    "adsterra",
    "onclickprediction",
    "trafficjunky",
    "exoclick",
    "juicyads",
    "clickadu",
    "monetag",
    "richpush",
    "yadro.ru",
    "deloton.com",
    "alwingulla.com",
    "highperformancegate.com",
    "bidgear.com",
    "syndication.exdynsrv.com",
    "ad-delivery.net",
  ];

  let activeDomains = new Set(defaultAdList);

  async function initAdBlocker() {
    try {
      const data = await browserAPI.storage.local.get("aggregator_ad_domains");
      if (data && Array.isArray(data.aggregator_ad_domains) && data.aggregator_ad_domains.length > 0) {
        activeDomains = new Set(data.aggregator_ad_domains);
      } else {
        await browserAPI.storage.local.set({ aggregator_ad_domains: defaultAdList });
      }
    } catch (err) {
      activeDomains = new Set(defaultAdList);
    }
  }

  async function syncAdRules(serverUrl) {
    if (serverUrl) {
      try {
        const res = await fetch(serverUrl, { cache: "no-store" });
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list) && list.length > 0) {
            activeDomains = new Set(list);
            await browserAPI.storage.local.set({ aggregator_ad_domains: list });
            return { status: "SYNCED", count: list.length };
          }
        }
      } catch (err) {}
    }

    try {
      const data = await browserAPI.storage.local.get("aggregator_ad_domains");
      if (data && Array.isArray(data.aggregator_ad_domains) && data.aggregator_ad_domains.length > 0) {
        activeDomains = new Set(data.aggregator_ad_domains);
        return { status: "CACHED", count: data.aggregator_ad_domains.length };
      }
    } catch (err) {}

    activeDomains = new Set(defaultAdList);
    return { status: "FALLBACK", count: defaultAdList.length };
  }

  function isAdUrl(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    for (const domain of activeDomains) {
      if (u.includes(domain)) return true;
    }
    return false;
  }

  function shouldBlockRequest(details, isFromAggregator) {
    if (!isFromAggregator(details)) return false;
    return isAdUrl(details.url);
  }

  function handleTabCreated(tab, isFromAggregator) {
    const targetUrl = (tab.url || tab.pendingUrl || "").toLowerCase();
    if (targetUrl && isAdUrl(targetUrl)) {
      browserAPI.tabs.remove(tab.id).catch(() => {});
    }
  }

  globalThis.AdBlocker = {
    init: initAdBlocker,
    sync: syncAdRules,
    isAdUrl,
    shouldBlockRequest,
    handleTabCreated,
  };
})();
