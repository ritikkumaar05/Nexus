const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto('http://localhost:5173/#/workspace', { waitUntil: 'networkidle0' });
  
  // Create a document if it's empty so the editor shows up
  await page.evaluate(() => {
    // If the new doc button exists, click it
    const newDocBtn = document.querySelector('#newDocBtn');
    if (newDocBtn) newDocBtn.click();
    
    // Type some text
    setTimeout(() => {
      const editor = document.querySelector('.document-editor-input');
      if (editor) {
        editor.value = 'This is a premium document workspace.';
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, 500);
  });
  
  await new Promise(r => setTimeout(r, 1000));
  
  // Set dark theme
  await page.evaluate(() => {
    document.body.dataset.theme = 'dark';
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: '/home/ritik-kumar/.gemini/antigravity/brain/f9b08765-ff01-4df5-8d4b-b6aea8ebbaaf/scratch/workspace_dark.png' });

  // Set light theme
  await page.evaluate(() => {
    document.body.dataset.theme = 'light';
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: '/home/ritik-kumar/.gemini/antigravity/brain/f9b08765-ff01-4df5-8d4b-b6aea8ebbaaf/scratch/workspace_light.png' });

  await browser.close();
  console.log('Screenshots saved.');
})();
