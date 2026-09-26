const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.Logger = { log: () => {} };

function createMockSpreadsheetDB() {
  const tables = {
    Family: [
      ['ID', 'Timestamp', 'Loại', 'Hũ', 'Nội dung', 'Số tiền', 'Ví/Thẻ Giao Dịch', 'Là Khoản Cố Định?', 'Ghi chú'],
      ['TC001', '2026-09-01', 'Thu', '----Thu nhập', 'Lương tháng 8', 250000, 'Thẻ Ufj', '', ''],
      ['TC002', '2026-09-04', 'Chi', 'Thiết yếu', 'Đi siêu thị Aeon', 5000, 'Ví Tiền Mặt', '', ''],
      ['TC003', '2026-09-27', 'Chi', 'Thiết yếu', 'Tiền nhà Leo', 50000, 'Thẻ Rakuten', 'Có', '']
    ],
    Categories: [
      ['', '', 'Ngày', 'Loại', 'Hũ', 'Nội dung', 'Phương thức', 'Nội dung mẫu', 'Hũ mẫu', 'Ví mẫu'],
      ['', '', '', '', '', '', '', 'Đổ xăng Eneos', 'Thiết yếu', 'Thẻ Rakuten'],
      ['', '', '', '', '', '', '', 'Đi siêu thị Aeon', 'Thiết yếu', 'Ví Tiền Mặt']
    ],
    JAR: [
      ['HŨ CHI TIÊU', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      ['Tháng', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      ['🏠 Thiết yếu'],
      ['Tỷ lệ %', 0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55]
    ],
    Wallets: [
      ['ID', 'Tên Ví', 'Phân Loại', 'Hạn Mức', 'Ngày Chốt', 'Ngày Trả', 'Số Dư'],
      ['W001', 'Ví Tiền Mặt', 'DEBIT', 0, '', '', 100000],
      ['W002', 'Thẻ Rakuten', 'CREDIT', 300000, 15, 27, -50000]
    ]
  };

  let getActiveCount = 0;

  global.SpreadsheetApp = {
    getActiveSpreadsheet: () => {
      getActiveCount++;
      return {
        getSheetByName: (name) => {
          if (!tables[name]) return null;
          const rows = tables[name];
          return {
            getLastRow: () => rows.length,
            getLastColumn: () => (rows.length > 0 ? rows[0].length : 0),
            getRange: (startRow, startCol, numRows, numCols) => ({
              getValues: () => rows.slice(startRow - 1, startRow - 1 + numRows).map(r => r.slice(startCol - 1, startCol - 1 + numCols))
            })
          };
        }
      };
    },
    getGetActiveCount: () => getActiveCount,
    resetGetActiveCount: () => { getActiveCount = 0; }
  };

  const cacheStore = {};
  global.CacheService = {
    getScriptCache: () => ({
      get: (key) => cacheStore[key] || null,
      put: (key, value) => { cacheStore[key] = value; },
      remove: (key) => { delete cacheStore[key]; }
    }),
    getCacheStore: () => cacheStore
  };
}

// Load Server_Tab1.js, Server_Tab2.js, and Server_Main.js into execution context
const tab1Code = fs.readFileSync(path.join(__dirname, '../src/Server_Tab1.js'), 'utf8');
const tab2Code = fs.readFileSync(path.join(__dirname, '../src/Server_Tab2.js'), 'utf8');
const mainCode = fs.readFileSync(path.join(__dirname, '../src/Server_Main.js'), 'utf8');

eval(tab1Code);
eval(tab2Code);
eval(mainCode);

test('getAppData fetches all data for Tab1 and Tab2 in a single unified spreadsheet query', () => {
  createMockSpreadsheetDB();
  SpreadsheetApp.resetGetActiveCount();

  const res = getAppData('9', '2026');

  assert.strictEqual(res.success, true);
  assert.ok(Array.isArray(res.wallets));
  assert.strictEqual(res.wallets.length, 2);
  assert.strictEqual(res.wallets[0].name, 'Ví Tiền Mặt');

  assert.ok(Array.isArray(res.categories));
  assert.strictEqual(res.categories.length, 2);
  assert.strictEqual(res.categories[0].name, 'Đổ xăng Eneos');

  assert.ok(res.tab2);
  assert.ok(res.tab2.summary);
  assert.strictEqual(res.tab2.summary.income, 250000);
  assert.strictEqual(res.tab2.summary.expense, 55000);
  assert.strictEqual(res.tab2.transactions.length, 3);
  assert.strictEqual(res.tab2.jars.length, 6);

  // Verify that getActiveSpreadsheet was called exactly ONCE during getAppData
  assert.strictEqual(SpreadsheetApp.getGetActiveCount(), 1, 'SpreadsheetApp.getActiveSpreadsheet() should be called only once');
});

test('getAppData utilizes CacheService for instant 0ms responses on repeated calls', () => {
  createMockSpreadsheetDB();
  SpreadsheetApp.resetGetActiveCount();

  // First call populates cache
  const res1 = getAppData('9', '2026');
  assert.strictEqual(res1.success, true);
  assert.strictEqual(SpreadsheetApp.getGetActiveCount(), 1);

  // Second call retrieves from CacheService instantly (0 spreadsheet queries)
  const res2 = getAppData('9', '2026');
  assert.strictEqual(res2.success, true);
  assert.strictEqual(res2.tab2.summary.income, 250000);
  assert.strictEqual(SpreadsheetApp.getGetActiveCount(), 1, 'Second call should use CacheService and not call getActiveSpreadsheet again');
});

test('clearAppDataCache invalidates cache so fresh data is loaded after updates', () => {
  createMockSpreadsheetDB();
  SpreadsheetApp.resetGetActiveCount();

  getAppData('9', '2026');
  assert.strictEqual(SpreadsheetApp.getGetActiveCount(), 1);

  clearAppDataCache('9', '2026');

  getAppData('9', '2026');
  assert.strictEqual(SpreadsheetApp.getGetActiveCount(), 2, 'After clearing cache, next call should query spreadsheet again');
});
