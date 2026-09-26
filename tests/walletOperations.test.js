const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.Logger = { log: () => {} };
global.Utilities = {
  formatDate: (date, tz, fmt) => '2026-09-07 22:00:00'
};

function createMockDB() {
  const tables = {
    Wallets: [
      ['ID', 'Tên Ví', 'Phân Loại', 'Hạn Mức', 'Ngày Chốt', 'Ngày Trả', 'Số Dư'],
      ['W001', 'Thẻ Rakuten', 'CREDIT', 500000, '15', '27', -50000],
      ['W002', 'Thẻ UFJ ATM', 'DEBIT', 0, '', '', 800000],
      ['W003', 'Ví Tiền Mặt', 'DEBIT', 0, '', '', 300000]
    ],
    Family: [
      ['ID', 'Timestamp', 'Loại', 'Hũ', 'Nội dung', 'Số tiền', 'Ví/Thẻ Giao Dịch', 'Là Khoản Cố Định?', 'Ghi chú']
    ]
  };

  global.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({
      getSheetByName: (name) => {
        if (!tables[name]) return null;
        const rows = tables[name];
        return {
          getLastRow: () => rows.length,
          getRange: (startRow, startCol, numRows, numCols) => ({
            getValues: () => rows.slice(startRow - 1, startRow - 1 + numRows),
            setValue: (val) => {
              rows[startRow - 1][startCol - 1] = val;
            },
            setValues: (vals) => {
              for (let i = 0; i < vals.length; i++) {
                for (let j = 0; j < vals[i].length; j++) {
                  rows[startRow - 1 + i][startCol - 1 + j] = vals[i][j];
                }
              }
            }
          }),
          appendRow: (rowData) => {
            rows.push(rowData);
          },
          deleteRow: (rowIndex) => {
            rows.splice(rowIndex - 1, 1);
          }
        };
      }
    })
  };

  return tables;
}

const serverTab1Code = fs.readFileSync(
  path.join(__dirname, '../src/Server_Tab1.js'),
  'utf8'
);
eval(serverTab1Code);

// -------------------------------------------------------------
// TDD SLICE: FULL CRUD ON WALLETS
// -------------------------------------------------------------
test('saveWalletToSheet appends a new wallet when ID is not found', () => {
  const db = createMockDB();

  const res = saveWalletToSheet({
    id: 'W004',
    name: 'Thẻ JCB Pay',
    type: 'CREDIT',
    credit_limit: 300000,
    closing_date: '10',
    due_date: '25',
    current_balance: 0
  });

  assert.equal(res.success, true);
  assert.equal(db.Wallets.length, 5);
  assert.equal(db.Wallets[4][1], 'C- Thẻ JCB Pay');
});

test('saveWalletToSheet updates an existing wallet when ID matches', () => {
  const db = createMockDB();

  const res = saveWalletToSheet({
    id: 'W003',
    name: 'Ví Tiền Mặt Nhà',
    type: 'DEBIT',
    credit_limit: 0,
    closing_date: '',
    due_date: '',
    current_balance: 450000
  });

  assert.equal(res.success, true);
  assert.equal(db.Wallets[3][1], 'Ví Tiền Mặt Nhà');
  assert.equal(db.Wallets[3][6], 450000);
});

test('deleteWalletFromSheet deletes wallet row by ID', () => {
  const db = createMockDB();

  const res = deleteWalletFromSheet('W002');

  assert.equal(res.success, true);
  assert.equal(db.Wallets.length, 3);
  assert.ok(!db.Wallets.some(r => r[0] === 'W002'));
});

test('processWalletTransfer deducts source wallet, credits destination wallet, and logs to Family sheet', () => {
  const db = createMockDB();

  const res = processWalletTransfer({
    fromWallet: 'Thẻ UFJ ATM',
    toWallet: 'Ví Tiền Mặt',
    amount: 100000,
    note: 'Rút ATM'
  });

  assert.equal(res.success, true);
  assert.equal(db.Wallets[2][6], 700000);
  assert.equal(db.Wallets[3][6], 400000);
});

test('processCreditCardSettlement settles credit card debt from cash/debit wallet', () => {
  const db = createMockDB();

  const res = processCreditCardSettlement({
    creditCard: 'Thẻ Rakuten',
    sourceWallet: 'Thẻ UFJ ATM',
    amount: 50000
  });

  assert.equal(res.success, true);
  assert.equal(db.Wallets[1][6], 0);
  assert.equal(db.Wallets[2][6], 750000);
});

test('generateUniqueMaGD generates unique transaction IDs with given prefix', () => {
  const ids = new Set();
  for (let i = 0; i < 100; i++) {
    const id = generateUniqueMaGD('CC');
    assert.ok(id.startsWith('CC'), `ID should start with CC, got: ${id}`);
    assert.ok(!ids.has(id), `Duplicate ID detected: ${id}`);
    ids.add(id);
  }
  assert.equal(ids.size, 100);
});

