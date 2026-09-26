const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 1. Mock Google Apps Script Globals (SpreadsheetApp & Logger)
global.Logger = { log: () => {} };

function setupMockSpreadsheet(sheetData) {
  global.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({
      getSheetByName: (name) => {
        if (name !== 'Wallets' || !sheetData) return null;
        return {
          getLastRow: () => sheetData.length,
          getRange: (startRow, startCol, numRows, numCols) => ({
            getValues: () => sheetData.slice(startRow - 1, startRow - 1 + numRows)
          })
        };
      }
    })
  };
}

// Load Server_Tab1.js in global context
const serverTab1Code = fs.readFileSync(
  path.join(__dirname, '../src/Server_Tab1.js'),
  'utf8'
);
eval(serverTab1Code);

// -------------------------------------------------------------
// TDD SLICE 1: VERIFY getWalletsFromSheet PUBLIC INTERFACE & BEHAVIOR
// -------------------------------------------------------------
test('getWalletsFromSheet parses sheet rows into valid wallet objects with correct types (7-col legacy and 11-col full schema)', () => {
  const mockSheetRows7Col = [
    ['ID', 'Tên Ví', 'Phân Loại', 'Hạn Mức', 'Ngày Chốt', 'Ngày Trả', 'Số Dư'],
    ['W100', 'Thẻ Rakuten', 'CREDIT', 500000, 15, 27, -25000],
    ['W101', 'Thẻ UFJ ATM', 'DEBIT', 0, '', '', 650000]
  ];

  setupMockSpreadsheet(mockSheetRows7Col);
  const res7 = getWalletsFromSheet('09', '2026');
  assert.equal(res7.success, true);
  assert.equal(res7.wallets.length, 2);
  assert.equal(res7.wallets[0].current_balance, -25000);
  assert.equal(res7.wallets[1].current_balance, 650000);

  const mockSheetRows11Col = [
    ['ID', 'Tên Ví', 'Phân Loại', 'Hạn Mức', 'Ngày Chốt', 'Ngày Trả', 'Số Dư Ban Đầu', 'Phát Sinh Tăng', 'Phát Sinh Giảm', 'Số Dư Hiện Tại', 'Ví nguồn'],
    ['W100', 'Thẻ Rakuten', 'CREDIT', 500000, 15, 27, 0, 0, 25000, -25000, 'Thẻ UFJ ATM'],
    ['W101', 'Thẻ UFJ ATM', 'DEBIT', 0, '', '', 500000, 200000, 50000, 650000, '']
  ];

  setupMockSpreadsheet(mockSheetRows11Col);
  const res11 = getWalletsFromSheet('09', '2026');
  assert.equal(res11.success, true);
  assert.equal(res11.wallets.length, 2);

  // Assert Rakuten Credit Card 11-col
  assert.deepEqual(res11.wallets[0], {
    id: 'W100',
    name: 'Thẻ Rakuten',
    type: 'CREDIT',
    credit_limit: 500000,
    closing_date: '15',
    due_date: '27',
    initial_balance: 0,
    total_increase: 0,
    total_decrease: 25000,
    current_balance: -25000,
    settle_source: 'Thẻ UFJ ATM'
  });

  // Assert UFJ Debit Wallet 11-col
  assert.deepEqual(res11.wallets[1], {
    id: 'W101',
    name: 'Thẻ UFJ ATM',
    type: 'DEBIT',
    credit_limit: 0,
    closing_date: '',
    due_date: '',
    initial_balance: 500000,
    total_increase: 200000,
    total_decrease: 50000,
    current_balance: 650000,
    settle_source: ''
  });
});

test('getWalletsFromSheet falls back gracefully when sheet is missing or empty', () => {
  setupMockSpreadsheet(null); // No sheet available

  const res = getWalletsFromSheet();

  assert.equal(res.success, true);
  assert.ok(Array.isArray(res.wallets));
  assert.ok(res.wallets.length > 0);
  assert.ok(res.wallets[0].hasOwnProperty('name'));
});
