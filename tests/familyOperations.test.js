const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.Logger = { log: () => {} };

function createMockSpreadsheetDB() {
  const tables = {
    Family: [
      ['ID', 'Timestamp', 'Loại', 'Hũ', 'Nội dung', 'Số tiền', 'Ví/Thẻ Giao Dịch', 'Là Khoản Cố Định?', 'Ghi chú', 'Trạng thái'],
      ['TC000', '2026-08-25', 'Chi', 'Thiết yếu', 'Tiền mạng Internet', 4500, 'Thẻ Rakuten', 'Có', '', 'PRE-ORDER'],
      ['TC001', '2026-09-01', 'Thu', '----Thu nhập', 'Lương tháng 8', 250000, 'Thẻ Ufj', '', '', 'HOAN_TAT'],
      ['TC002', '2026-09-04', 'Chi', 'Thiết yếu', 'Đi siêu thị Aeon', 5000, 'Ví Tiền Mặt', '', '', 'HOAN_TAT'],
      ['TC003', '2026-09-27', 'Chi', 'Thiết yếu', 'Tiền nhà Leo', 50000, 'Thẻ Rakuten', 'Có', '', 'PRE-ORDER']
    ],
    Categories: [
      ['', '', 'Ngày', 'Loại', 'Hũ', 'Nội dung', 'Phương thức', 'Nội dung mẫu', 'Hũ mẫu', 'Ví mẫu'],
      ['', '', '', '', '', '', '', 'Đi siêu thị Aeon', 'Thiết yếu', 'Ví Tiền Mặt']
    ],
    JAR: [],
    Wallets: [
      ['ID', 'Tên Ví', 'Phân Loại', 'Hạn Mức', 'Ngày Chốt', 'Ngày Trả', 'Số Dư'],
      ['W001', 'Ví Tiền Mặt', 'DEBIT', 0, '', '', 100000]
    ]
  };

  global.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({
      insertSheet: (name) => {
        if (!tables[name]) tables[name] = [];
        return global.SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
      },
      getSheetByName: (name) => {
        if (!tables[name]) return null;
        const rows = tables[name];
        return {
          getLastRow: () => rows.length,
          getLastColumn: () => (rows.length > 0 ? rows[0].length : 0),
          getRange: (startRow, startCol, numRows, numCols) => ({
            getValues: () => rows.slice(startRow - 1, startRow - 1 + numRows).map(r => r.slice(startCol - 1, startCol - 1 + numCols)),
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

const serverTab2Code = fs.readFileSync(
  path.join(__dirname, '../src/Server_Tab2.js'),
  'utf8'
);
eval(serverTab2Code);

// -------------------------------------------------------------
// TESTS: TAB 2 FAMILY BACKEND OPERATIONS
// -------------------------------------------------------------

test('getInitialData returns default categories and wallets suggestions', () => {
  createMockSpreadsheetDB();
  const res = getInitialData();
  assert.equal(res.success, true);
  assert.ok(Array.isArray(res.categories));
  assert.ok(Array.isArray(res.wallets));
});

test('getTab2Data calculates summary totals and returns filtered transactions and jars', () => {
  const db = createMockSpreadsheetDB();
  const res = getTab2Data('9', '2026');

  assert.equal(res.success, true);
  assert.equal(res.summary.income, 250000);
  assert.equal(res.summary.expense, 55000);
  assert.equal(res.summary.net, 195000);
  assert.equal(res.transactions.length, 3);
  assert.equal(res.jars.length, 6);

  const thietYeuJar = res.jars.find(j => j.name === 'Thiết yếu');
  assert.ok(thietYeuJar);
  assert.equal(thietYeuJar.spent, 55000);
});

test('saveFamilyTransaction appends a new transaction row into Family sheet', () => {
  const db = createMockSpreadsheetDB();

  const res = saveFamilyTransaction({
    ngay: '2026-09-05',
    loai: 'CHI',
    noidung: 'Cà phê Highland',
    sotien: 650,
    nguontien: 'Ví Tiền Mặt',
    hu: 'Giải trí',
    codinh: false,
    mau: false
  });

  assert.equal(res.success, true);
  assert.equal(db.Family.length, 6);
  assert.equal(db.Family[5][4], 'Cà phê Highland');
  assert.equal(db.Family[5][5], 650);
});

test('updateFamilyTransaction updates existing transaction details by ID', () => {
  const db = createMockSpreadsheetDB();

  const res = updateFamilyTransaction({
    id: 'TC002',
    ngay: '2026-09-04',
    loai: 'CHI',
    noidung: 'Đi siêu thị Aeon Mall',
    sotien: 6200,
    nguontien: 'Ví Tiền Mặt',
    hu: 'Thiết yếu',
    codinh: false
  });

  assert.equal(res.success, true);
  assert.equal(db.Family[3][4], 'Đi siêu thị Aeon Mall');
  assert.equal(db.Family[3][5], 6200);
});

test('deleteTransaction removes transaction row by ID', () => {
  const db = createMockSpreadsheetDB();

  const res = deleteTransaction('TC002');

  assert.equal(res.success, true);
  assert.equal(db.Family.length, 4);
  assert.ok(!db.Family.some(r => r[0] === 'TC002'));
});

test('saveBatchQuickFixedAmounts batch inserts quick fixed payments into Family sheet', () => {
  const db = createMockSpreadsheetDB();

  const res = saveBatchQuickFixedAmounts([
    { noiDung: 'Tiền điện', newDate: '2026-09-10', newSource: 'Thẻ Ufj', newAmount: 8500, hu: 'Thiết yếu', loai: 'Chi' },
    { noiDung: 'Tiền nước', newDate: '2026-09-12', newSource: 'Thẻ Ufj', newAmount: 3200, hu: 'Thiết yếu', loai: 'Chi' }
  ]);

  assert.equal(res.success, true);
  assert.equal(db.Family.length, 7);
  assert.equal(db.Family[5][4], 'Tiền điện');
  assert.equal(db.Family[6][4], 'Tiền nước');
});

test('processJarTransfer appends debit and credit transfer rows for jar budget re-allocation', () => {
  const db = createMockSpreadsheetDB();

  const res = processJarTransfer({
    fromJar: 'Giải trí',
    toJar: 'Thiết yếu',
    amount: 10000
  });

  assert.equal(res.success, true);
  assert.equal(db.Family.length, 7);
  assert.equal(db.Family[5][2], 'Chi');
  assert.equal(db.Family[5][3], 'Giải trí');
  assert.equal(db.Family[6][2], 'Thu');
  assert.equal(db.Family[6][3], 'Thiết yếu');
});

test('processJarTransfer rejects invalid amounts or identical source and target jars', () => {
  createMockSpreadsheetDB();

  const res1 = processJarTransfer({ fromJar: 'Giải trí', toJar: 'Giải trí', amount: 5000 });
  assert.equal(res1.success, false);
  assert.match(res1.message, /trùng nhau/i);

  const res2 = processJarTransfer({ fromJar: 'Giải trí', toJar: 'Thiết yếu', amount: 0 });
  assert.equal(res2.success, false);
  assert.match(res2.message, /nhập từ hũ, đến hũ/i);
});

test('getQuickFixedItems fetches previous month fixed transactions with prevAmount reference and filters current month paid items', () => {
  createMockSpreadsheetDB();

  // In Sept 2026: Aug 2026 fixed item is "Tiền mạng Internet" (4500). "Tiền nhà Leo" is paid in Sept 2026.
  const resSept = getQuickFixedItems('9', '2026');
  assert.equal(resSept.success, true);
  assert.equal(resSept.items.length, 1);
  assert.equal(resSept.items[0].noidung, 'Tiền mạng Internet');
  assert.equal(resSept.items[0].sotien, 0);
  assert.equal(resSept.items[0].prevAmount, 4500);

  // In Oct 2026: Sept 2026 fixed item is "Tiền nhà Leo" (50000). Not paid in Oct 2026 yet.
  const resOct = getQuickFixedItems('10', '2026');
  assert.equal(resOct.success, true);
  assert.equal(resOct.items.length, 1);
  assert.equal(resOct.items[0].noidung, 'Tiền nhà Leo');
  assert.equal(resOct.items[0].sotien, 0);
  assert.equal(resOct.items[0].prevAmount, 50000);
});

test('updateFamilyTransaction and deleteTransaction support ROW_ fallback IDs when column A ID is empty', () => {
  const db = createMockSpreadsheetDB();
  // Append a row without Column A ID
  db.Family.push(['', '2026-09-10', 'Chi', 'Giải trí', 'Xem phim CGV', 150000, 'Ví Tiền Mặt', '', '', 'HOAN_TAT']);
  const newRowIndex = db.Family.length; // Row 6 (ROW_6)

  // Update transaction using ROW_6
  const updateRes = updateFamilyTransaction({
    id: 'ROW_' + newRowIndex,
    noidung: 'Xem phim BHD',
    sotien: 180000,
    hu: 'Giải trí',
    nguontien: 'Ví Tiền Mặt',
    loai: 'Chi',
    ngay: '2026-09-10'
  });
  assert.equal(updateRes.success, true);
  assert.equal(db.Family[newRowIndex - 1][4], 'Xem phim BHD');
  assert.equal(db.Family[newRowIndex - 1][5], 180000);

  // Delete transaction using ROW_6
  const deleteRes = deleteTransaction('ROW_' + newRowIndex);
  assert.equal(deleteRes.success, true);
  assert.equal(db.Family.length, newRowIndex - 1);
});

