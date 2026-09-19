const browserAPI = globalThis.browser || globalThis.chrome;
const agbtn = document.querySelector('#open-ag-btn');

if(agbtn)
  agbtn.addEventListener('click',()=>{browserAPI.tabs.create({url : browserAPI.runtime.getURL('super-website/dist/index.html')})});
