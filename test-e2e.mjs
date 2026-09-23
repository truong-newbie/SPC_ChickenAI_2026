import { chromium } from 'playwright';

const SIGNALING_URL = 'http://localhost:3002';
const APP_URL = 'http://localhost:3001';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testE2E() {
  console.log('Starting E2E test...\n');

  const browser = await chromium.launch({ headless: true });
  const context1 = await browser.newContext();
  const context2 = await browser.newContext();

  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  // Collect console logs
  const logs1 = [];
  const logs2 = [];

  page1.on('console', msg => logs1.push(`[Page1] ${msg.text()}`));
  page2.on('console', msg => logs2.push(`[Page2] ${msg.text()}`));

  page1.on('pageerror', err => logs1.push(`[ERROR] ${err.message}`));
  page2.on('pageerror', err => logs2.push(`[ERROR] ${err.message}`));

  try {
    // Step 1: Open app on both pages
    console.log('Step 1: Opening app on both pages...');
    await page1.goto(APP_URL);
    await page2.goto(APP_URL);
    await sleep(2000);

    // Check both pages loaded
    const title1 = await page1.title();
    const title2 = await page2.title();
    console.log(`Page 1 title: ${title1}`);
    console.log(`Page 2 title: ${title2}`);

    // Step 2: Page1 creates a room
    console.log('\nStep 2: Page1 creating room...');
    const createBtn = page1.locator('button:has-text("Tạo phòng")');
    await createBtn.click();
    await sleep(2000);

    // Get room code
    const roomCodeEl = page1.locator('text=/^[A-Z0-9]{6}$/');
    let roomCode = null;

    try {
      roomCode = await page1.locator('.font-mono').first().textContent();
      console.log(`Room code: ${roomCode}`);
    } catch (e) {
      console.log('Could not get room code from UI');
    }

    if (!roomCode) {
      // Try to get from URL or other elements
      roomCode = await page1.evaluate(() => {
        const codeEl = document.querySelector('[class*="code"], .text-3xl, .font-mono');
        return codeEl ? codeEl.textContent.trim() : null;
      });
      console.log(`Room code from eval: ${roomCode}`);
    }

    // Step 3: Page2 joins the room
    if (roomCode) {
      console.log(`\nStep 3: Page2 joining room ${roomCode}...`);

      // Find input and join button
      const joinInput = page2.locator('input[type="text"], input[class*="input"]');
      await joinInput.fill(roomCode);
      await sleep(500);

      const joinBtn = page2.locator('button:has-text("Tham gia"), button:has-text("Join")');
      await joinBtn.click();
      await sleep(5000); // Wait for connection
    }

    // Check connection status
    console.log('\n--- Checking connection status ---');

    const status1 = await page1.evaluate(() => {
      const statusEl = document.querySelector('[class*="status"], [class*="connected"], [class*="connecting"]');
      return statusEl ? statusEl.textContent.trim() : 'not found';
    });
    console.log(`Page1 status: ${status1}`);

    const status2 = await page2.evaluate(() => {
      const statusEl = document.querySelector('[class*="status"], [class*="connected"], [class*="connecting"]');
      return statusEl ? statusEl.textContent.trim() : 'not found';
    });
    console.log(`Page2 status: ${status2}`);

    // Print relevant console logs
    console.log('\n--- Page1 Console Logs ---');
    logs1.filter(l => l.includes('Signaling') || l.includes('Connection') || l.includes('ICE') || l.includes('connected') || l.includes('failed') || l.includes('offer') || l.includes('ERROR'))
      .forEach(l => console.log(l));

    console.log('\n--- Page2 Console Logs ---');
    logs2.filter(l => l.includes('Signaling') || l.includes('Connection') || l.includes('ICE') || l.includes('connected') || l.includes('failed') || l.includes('offer') || l.includes('ERROR'))
      .forEach(l => console.log(l));

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await browser.close();
    console.log('\nTest complete.');
  }
}

testE2E();
