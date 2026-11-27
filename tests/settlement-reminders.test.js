import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';

test('Settlement Reminders Banner is present in Tab1.html', () => {
  const tab1 = fs.readFileSync('src/Tab1.html', 'utf8');
  assert.ok(tab1.includes('id="t1-card-settlement-alert-container"'), 'Banner container must exist in Tab1.html');
  assert.ok(tab1.includes('t1_getCardSettlementReminder'), 't1_getCardSettlementReminder function must exist');
  assert.ok(tab1.includes('t1_renderSettlementAlertBanner'), 't1_renderSettlementAlertBanner function must exist');
  assert.ok(tab1.includes('t1_toggleSettlementList'), 't1_toggleSettlementList function must exist');
});

test('api/gas.js includes computeSettlementReminders in getAppData', () => {
  const gas = fs.readFileSync('api/gas.js', 'utf8');
  assert.ok(gas.includes('settlementReminders'), 'api/gas.js must compute settlementReminders');
  assert.ok(gas.includes('settlementReminder: reminderMap.get'), 'api/gas.js must attach settlementReminder to wallets');
});

test('Server_Main.js includes settlementReminders in getAppData', () => {
  const sMain = fs.readFileSync('src/Server_Main.js', 'utf8');
  assert.ok(sMain.includes('settlementReminders: settlementReminders'), 'Server_Main.js must return settlementReminders');
});

test('Japanese bank holidays and weekend shifting logic is present', () => {
  const gas = fs.readFileSync('api/gas.js', 'utf8');
  const tab1 = fs.readFileSync('src/Tab1.html', 'utf8');
  const sMain = fs.readFileSync('src/Server_Main.js', 'utf8');

  assert.ok(gas.includes('getNextJapaneseBusinessDay'), 'api/gas.js must have getNextJapaneseBusinessDay');
  assert.ok(tab1.includes('t1_getNextJapaneseBusinessDay'), 'Tab1.html must have t1_getNextJapaneseBusinessDay');
  assert.ok(sMain.includes('getNextJapaneseBusinessDay'), 'Server_Main.js must have getNextJapaneseBusinessDay');
});

test('Tab1.html compresses settlement cards to 1 row and filters out already settled cards', () => {
  const tab1 = fs.readFileSync('src/Tab1.html', 'utf8');

  // Single-row flex layout
  assert.ok(tab1.includes('flex items-center justify-between gap-1.5'), 'Must use compact 1-line flex layout');
  
  // Exclude settled cards from banner
  assert.ok(tab1.includes("r.status === 'SETTLED_THIS_MONTH' || r.hasSettleThisMonth"), 'Must filter out SETTLED_THIS_MONTH cards');
  assert.ok(tab1.includes("r.badge.includes('Đã tất toán')"), 'Must filter out cards with Đã tất toán badge');
  assert.ok(tab1.includes("window._settledCardsThisSession"), 'Must track settled cards in current session');
});
