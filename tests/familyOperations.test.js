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
      ['W001', 'Ví Tiền Mặt', 'DEBIT', 0, '', '', 100000],
      ['W002', 'Thẻ Ufj', 'DEBIT', 0, '', '', 200000],
      ['W003', 'Thẻ Rakuten', 'CREDIT', 500000, '', '', 0]
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

test('saveFamilyTransaction and updateFamilyTransaction reject invalid/unregistered money sources', () => {
  const db = createMockSpreadsheetDB();

  // 1. Rejects unknown wallet in save
  const invalidSaveRes = saveFamilyTransaction({
    ngay: '2026-09-05',
    loai: 'CHI',
    noidung: 'Mua sắm online',
    sotien: 1000,
    nguontien: 'Ví Lạ Không Tồn Tại',
    hu: 'Thiết yếu'
  });
  assert.equal(invalidSaveRes.success, false);
  assert.ok(invalidSaveRes.message.includes('không tồn tại trong danh sách Ví/Thẻ'));

  // 2. Rejects empty wallet in save
  const emptySaveRes = saveFamilyTransaction({
    ngay: '2026-09-05',
    loai: 'THU',
    noidung: 'Tiền thưởng',
    sotien: 5000,
    nguontien: '',
    hu: '----Thu nhập'
  });
  assert.equal(emptySaveRes.success, false);

  // 3. Rejects unknown wallet in update
  const invalidUpdateRes = updateFamilyTransaction({
    id: 'TC002',
    nguontien: 'Thẻ Ảo Bất Kỳ'
  });
  assert.equal(invalidUpdateRes.success, false);
  assert.ok(invalidUpdateRes.message.includes('không tồn tại trong danh sách Ví/Thẻ'));
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

  // In Sept 2026: Aug 2026 fixed item is "Tiền mạng Internet" (4500 on day 25). "Tiền nhà Leo" is paid in Sept 2026.
  const resSept = getQuickFixedItems('9', '2026');
  assert.equal(resSept.success, true);
  assert.equal(resSept.items.length, 1);
  assert.equal(resSept.items[0].noidung, 'Tiền mạng Internet');
  assert.equal(resSept.items[0].sotien, 0);
  assert.equal(resSept.items[0].prevAmount, 4500);
  assert.equal(resSept.items[0].ngay, '2026-09-25'); // Preserves recurring day 25, not today

  // In Oct 2026: Sept 2026 fixed item is "Tiền nhà Leo" (50000 on day 27). Not paid in Oct 2026 yet.
  const resOct = getQuickFixedItems('10', '2026');
  assert.equal(resOct.success, true);
  assert.equal(resOct.items.length, 1);
  assert.equal(resOct.items[0].noidung, 'Tiền nhà Leo');
  assert.equal(resOct.items[0].sotien, 0);
  assert.equal(resOct.items[0].prevAmount, 50000);
  assert.equal(resOct.items[0].ngay, '2026-10-27'); // Preserves recurring day 27, not today
});

test('getQuickFixedItems preserves recurring day (e.g. 24 for Luong KA) for target month', () => {
  const db = createMockSpreadsheetDB();
  db.Family.push(['TC999', '2026-10-24', 'Thu', '----Thu nhập', 'Lương KA', 300000, 'Ví Tiền Mặt', 'Có', '', 'HOAN_TAT']);

  const resNov = getQuickFixedItems('11', '2026');
  assert.equal(resNov.success, true);
  const luongItem = resNov.items.find(it => it.noidung === 'Lương KA');
  assert.ok(luongItem, 'Must find Luong KA');
  assert.equal(luongItem.ngay, '2026-11-24'); // Must be 2026-11-24, NOT today!
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

test('saveBatchQuickFixedAmounts writes to Family sheet, updates wallet balance, and triggers financial event posting', () => {
  const db = createMockSpreadsheetDB();
  const postedEvents = [];
  global.postFinancialEvents = (events) => {
    postedEvents.push(...events);
  };
  global.updateWalletBalanceHelper = (wName, delta) => {
    return { name: wName, currentBalance: 100000 + delta };
  };

  const res = saveBatchQuickFixedAmounts([
    {
      noiDung: 'Tiền mạng Internet',
      newDate: '2026-10-05',
      newAmount: 4500,
      newSource: 'Ví Tiền Mặt',
      hu: 'Thiết yếu',
      loai: 'Chi'
    }
  ]);

  assert.equal(res.success, true);
  assert.equal(postedEvents.length, 1);
  assert.equal(postedEvents[0].walletName, 'Ví Tiền Mặt');
  assert.equal(postedEvents[0].amount, 4500);
  assert.equal(postedEvents[0].direction, 'OUT');
  assert.equal(postedEvents[0].eventType, 'FAMILY_EXPENSE');
  assert.equal(res.updatedWallets.length, 1);
});

test('Tab 2: Credit expenses automatically jump to Chờ Trừ Thẻ (PRE-ORDER) and post to WalletLedger as PENDING PREORDER_HOLD', () => {
  const db = createMockSpreadsheetDB();
  const postedEvents = [];
  global.postFinancialEvents = (events) => {
    postedEvents.push(...events);
  };

  // Add credit card to Wallets sheet
  db.Wallets.push(['W003', 'Thẻ Rakuten', 'CREDIT', 500000, 15, 27, 0, 0, 0, 0, 'Ví Tiền Mặt', '']);

  // 1. Giao dịch Chi từ Tab 2 với Thẻ Tín Dụng (Credit Card)
  const res = saveFamilyTransaction({
    fromTab2: true,
    ngay: '2026-10-12',
    loai: 'Chi',
    noidung: 'Mua bàn học online',
    sotien: 15000,
    nguontien: 'Thẻ Rakuten',
    hu: 'Thiết yếu'
  });

  assert.equal(res.success, true);
  assert.equal(res.savedItem.status, 'PRE-ORDER');
  
  // Kiểm tra dòng ghi vào Family sheet
  const newRow = db.Family[db.Family.length - 1];
  assert.equal(newRow[9], 'PRE-ORDER');
  assert.equal(newRow[10], ''); // Chưa có ngày sao kê

  // Kiểm tra bút toán ghi nhận vào WalletLedger
  assert.equal(postedEvents.length, 1);
  assert.equal(postedEvents[0].walletName, 'Thẻ Rakuten');
  assert.equal(postedEvents[0].amount, 15000);
  assert.equal(postedEvents[0].direction, 'HOLD');
  assert.equal(postedEvents[0].effectType, 'PREORDER_HOLD');
  assert.equal(postedEvents[0].eventType, 'PREORDER');
  assert.equal(postedEvents[0].status, 'PENDING');
  assert.equal(postedEvents[0].sourceModule, 'Family');

  // Kiểm tra getTab2Data nạp khoản này vào preorders (Chờ Trừ Thẻ)
  const t2Data = getTab2Data('10', '2026');
  const foundPre = t2Data.preorders.find(p => p.noidung === 'Mua bàn học online');
  assert.ok(foundPre, 'Khoản chi credit phải xuất hiện trong danh sách preorders (Chờ Trừ Thẻ)');
  assert.equal(foundPre.sotien, 15000);
  assert.equal(foundPre.nguontien, 'Thẻ Rakuten');
});

test('saveFamilyTransaction and getTab2Data: Ung cho nhom does not require Jar and is excluded from family expenses and jars', () => {
  const db = createMockSpreadsheetDB();

  // 1. Lưu giao dịch Ứng cho nhóm mà KHÔNG cần truyền hu
  const resSave = saveFamilyTransaction({
    ngay: '2026-09-06',
    loai: 'CHI',
    noidung: 'Ứng cho nhóm tiền ăn tối BBQ',
    sotien: 8000,
    nguontien: 'Ví Tiền Mặt',
    hu: '',
    codinh: false,
    mau: false
  });

  assert.equal(resSave.success, true);
  const lastRow = db.Family[db.Family.length - 1];
  assert.equal(lastRow[3], 'Ứng cho nhóm', 'Hu should default to Ứng cho nhóm when empty');
  assert.equal(lastRow[4], 'Ứng cho nhóm tiền ăn tối BBQ');
  assert.equal(lastRow[5], 8000);

  // 2. getTab2Data: khoản này phải bị loại trừ khỏi summary.expense và các Hũ
  const t2Data = getTab2Data('9', '2026');
  // Initial expenses in mock db:
  // TC001: 50000 (Thiết yếu)
  // TC002: 5000 (Thiết yếu)
  // Total = 55000. 8000 của Ứng cho nhóm KHÔNG được cộng vào summary.expense!
  assert.equal(t2Data.summary.expense, 55000, 'Total expense must not include Ung cho nhom');
  const thietYeuJar = t2Data.jars.find(j => j.name === 'Thiết yếu');
  assert.equal(thietYeuJar.spent, 55000, 'Jars spent must not include Ung cho nhom');

  // Giao dịch vẫn có trong transactions để hiển thị trong nhật ký
  const foundUng = t2Data.transactions.find(tx => tx.noidung.includes('BBQ'));
  assert.ok(foundUng, 'Ung cho nhom must appear in transactions list');
  assert.equal(foundUng.hu, 'Ứng cho nhóm');
});


