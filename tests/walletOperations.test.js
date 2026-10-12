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
    ],
    WalletCheckpoints: [
      ['CheckpointID', 'WalletID', 'WalletName', 'CheckpointDate', 'Balance', 'CreatedAt', 'CreatedBy', 'Status']
    ]
  };

  function makeSheetObj(name) {
    if (!tables[name]) tables[name] = [];
    const rows = tables[name];
    return {
      getLastRow: () => rows.length,
      getLastColumn: () => (rows[0] ? rows[0].length : 0),
      getRange: (startRow, startCol, numRows, numCols) => ({
        getValue: () => (rows[startRow - 1] && rows[startRow - 1][startCol - 1] !== undefined ? rows[startRow - 1][startCol - 1] : ""),
        getValues: function() {
          const slice = rows.slice(startRow - 1, startRow - 1 + numRows);
          return slice.map(r => {
            const rowCopy = [...r];
            while (numCols && rowCopy.length < (startCol - 1 + numCols)) {
              rowCopy.push("");
            }
            return numCols ? rowCopy.slice(startCol - 1, startCol - 1 + numCols) : rowCopy;
          });
        },
        getDisplayValues: function() {
          return this.getValues();
        },
        setValue: (val) => {
          if (!rows[startRow - 1]) rows[startRow - 1] = [];
          while (rows[startRow - 1].length < startCol) rows[startRow - 1].push("");
          rows[startRow - 1][startCol - 1] = val;
        },
        setValues: (vals) => {
          for (let i = 0; i < vals.length; i++) {
            if (!rows[startRow - 1 + i]) rows[startRow - 1 + i] = [];
            while (rows[startRow - 1 + i].length < (startCol - 1 + vals[i].length)) {
              rows[startRow - 1 + i].push("");
            }
            for (let j = 0; j < vals[i].length; j++) {
              rows[startRow - 1 + i][startCol - 1 + j] = vals[i][j];
            }
          }
        },
        setFontWeight: () => ({ setBackground: () => {} })
      }),
      setFrozenRows: () => {},
      appendRow: (rowData) => {
        rows.push(rowData);
      },
      deleteRow: (rowIndex) => {
        rows.splice(rowIndex - 1, 1);
      }
    };
  }

  global.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({
      getSheetByName: (name) => {
        if (!tables[name]) return null;
        return makeSheetObj(name);
      },
      insertSheet: (name) => {
        tables[name] = [];
        return makeSheetObj(name);
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

const serverTab2Code = fs.readFileSync(
  path.join(__dirname, '../src/Server_Tab2.js'),
  'utf8'
);
eval(serverTab2Code);

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

test('checkpointWalletBalance sets new checkpoint and saves to WalletCheckpoints', () => {
  const db = createMockDB();

  const res = checkpointWalletBalance({
    walletId: 'W002',
    walletName: 'Thẻ UFJ ATM',
    currentBalance: 800000,
    checkpointDate: '07/10/2026'
  });

  assert.equal(res.success, true);
  assert.equal(res.checkpointBalance, 800000);
  assert.equal(res.checkpointDate, '07/10/2026');
  assert.ok(db.WalletCheckpoints && db.WalletCheckpoints.length >= 2);
  assert.equal(db.WalletCheckpoints[1][4], 800000);
});

test('checkpointWalletBalance copies currentBalance to initialBalance, resets THU and CHI to 0, and saves checkpointDate on Wallets sheet', () => {
  const db = createMockDB();
  db.Wallets = [
    ['ID', 'Tên', 'Phân loại', 'Hạn mức', 'Ngày chốt sao kê', 'Ngày Đáo hạn', 'Số Dư Ban Đầu', 'THU', 'CHI', 'Số Dư Hiện Tại', 'Ví nguồn', 'Checkpoint Date'],
    ['W33773', 'Ufj KA', 'DEBIT', '', '', '', 6468088, 100000, 60880, 6507208, '', '01/10/2026']
  ];

  const res = checkpointWalletBalance({
    walletId: 'W33773',
    walletName: 'Ufj KA',
    currentBalance: 6507208,
    checkpointDate: '10/10/2026'
  });

  assert.equal(res.success, true);
  const row = db.Wallets[1];
  assert.equal(row[6], 6507208);
  assert.equal(row[7], 0);
  assert.equal(row[8], 0);
  assert.equal(row[9], 6507208);
  assert.equal(row[11], '10/10/2026');
});

test('rebuildWalletBalance recalculates balance from checkpoint accurately', () => {
  const db = createMockDB();

  checkpointWalletBalance({
    walletId: 'W002',
    walletName: 'Thẻ UFJ ATM',
    currentBalance: 800000,
    checkpointDate: '2026-10-07 23:59:00'
  });

  const res = rebuildWalletBalance('W002');
  assert.equal(res.success, true);
  assert.equal(res.status, 'SYNCED');
  assert.equal(res.currentBalance, 800000);
});

test('rebuildWalletBalance with 12-column legacy row uses current_balance as checkpoint baseline if WalletCheckpoints row is absent', () => {
  const db = createMockDB();
  db.Wallets = [
    ['ID', 'Tên', 'Phân loại', 'Hạn mức', 'Ngày chốt sao kê', 'Ngày Đáo hạn', 'Số Dư Ban Đầu', 'THU', 'CHI', 'Số Dư Hiện Tại', 'Ví nguồn', 'Checkpoint Date'],
    ['W33773', 'Ufj KA', 'DEBIT', '', '', '', 6468088, 0, 0, 6507208, '', '10/10/2026']
  ];
  db.WalletCheckpoints = [
    ['CheckpointID', 'WalletID', 'WalletName', 'CheckpointDate', 'CheckpointBalance', 'CreatedAt', 'CreatedBy', 'Status']
  ];
  db.Family = [
    ['ID', 'Ngày', 'Phân loại', 'Hũ', 'Nội dung', 'Số tiền', 'Nguồn tiền', 'Loại', 'Ghi chú', 'Trạng thái'],
    ['TX_POST', '2026-10-11', 'Chi', 'Thiết yếu', 'Mua cà phê', 381, 'Ufj KA', 'CHI', '', 'COMPLETED']
  ];

  const res = rebuildWalletBalance('W33773');
  assert.equal(res.success, true);
  // 6,507,208 - 381 = 6,506,827 (NOT 6,468,088 - 381 = 6,467,707!)
  assert.equal(res.currentBalance, 6506827);
});

test('checkpointWalletBalance normalizes positive debt input to negative balance for CREDIT cards', () => {
  const db = createMockDB();

  const res = checkpointWalletBalance({
    walletId: 'W001',
    walletName: 'Thẻ Rakuten',
    currentBalance: 1021243, // User typed positive debt
    checkpointDate: '01/10/2026'
  });

  assert.equal(res.success, true);
  assert.equal(res.checkpointBalance, -1021243);
  assert.equal(db.WalletCheckpoints[1][4], -1021243);
});

test('adjustWalletBalance normalizes positive debt input to negative balance for CREDIT cards', () => {
  const db = createMockDB();

  const res = adjustWalletBalance({
    walletName: 'Thẻ Rakuten',
    appBalance: -50000,
    actualBalance: 1021243, // User typed positive debt
    note: 'Chỉnh số nợ thực tế'
  });

  assert.equal(res.success, true);
  assert.ok(res.message.includes('-1,021,243'));
});


test('cleanTransactionDetailNote strips Hu and Category prefixes cleanly', () => {
  // Test case 1: Jar prefix in brackets
  assert.equal(cleanTransactionDetailNote('[Thiết yếu] Sức khoẻ - BH Chi+Chít', 'Thiết yếu', true), 'Sức khoẻ - BH Chi+Chít');
  
  // Test case 2: Jar prefix with hyphen
  assert.equal(cleanTransactionDetailNote('Thiết yếu - Nhà ở - Loan Nhà', 'Thiết yếu', true), 'Nhà ở - Loan Nhà');

  // Test case 3: Thu nhập prefix with brackets and dashes
  assert.equal(cleanTransactionDetailNote('[----Thu nhập] Lương KA', '----Thu nhập', false), 'Lương KA');

  // Test case 4: CK Noi Bo prefix
  assert.equal(cleanTransactionDetailNote('[CK Nội Bộ] Chuyển tiền ATM', '----CK Nội Bộ', true), 'Chuyển tiền ATM');

  // Test case 5: Debt settlement prefix preserved without jar
  assert.equal(cleanTransactionDetailNote('[Tất toán công nợ] Thu nợ: C Kẹo [CN44203143]', '----Thu nhập', false), '[Tất toán công nợ] Thu nợ: C Kẹo [CN44203143]');

  // Test case 6: Clean note without prefix unchanged
  assert.equal(cleanTransactionDetailNote('Đi lại - Tàu Ka', 'THU NHẬP', false), 'Đi lại - Tàu Ka');

  // Test case 7: Refund item with box emoji and amount stripped cleanly
  assert.equal(cleanTransactionDetailNote('📦 [Hoàn Tiền] Film MINI INSTAX (+4,950 ¥)', 'Hoàn Tiền Đơn Hủy', false), 'Film MINI INSTAX');
});

test('getWalletTransactionHistory returns clean notes without Hu prefix and formatted dd/MM/yyyy dates', () => {
  const db = createMockDB();
  db.Family = [
    ['ID', 'Timestamp', 'Loại', 'Hũ', 'Nội dung', 'Số tiền', 'Ví/Thẻ Giao Dịch', 'Là Khoản Cố Định?', 'Ghi chú', 'Trạng thái'],
    ['TC101', '2026-10-09T10:00:00.000Z', 'Thu', 'THU NHẬP', 'Đi lại - Tàu Ka', 27470, 'Thẻ UFJ ATM', '', '', 'HOAN_TAT'],
    ['TC102', '14/09/2026', 'Chi', 'Thiết yếu', 'Nhà ở - Loan Nhà', 104887, 'Thẻ UFJ ATM', 'Có', '', 'HOAN_TAT'],
    ['TC103', '2026-08-25', 'Thu', '----Thu nhập', '[----Thu nhập] Lương KA', 220498, 'Thẻ UFJ ATM', '', '', 'HOAN_TAT']
  ];

  const history = getWalletTransactionHistory('Thẻ UFJ ATM');
  assert.equal(history.length, 3);
  
  // Sorted newest first: 09/10/2026, then 14/09/2026, then 25/08/2026
  assert.equal(history[0].id, 'TC101');
  assert.equal(history[0].date, '09/10/2026');
  assert.equal(history[0].note, 'Đi lại - Tàu Ka');
  assert.equal(history[0].module, 'Thu Nhập');

  assert.equal(history[1].id, 'TC102');
  assert.equal(history[1].date, '14/09/2026');
  assert.equal(history[1].note, 'Nhà ở - Loan Nhà');
  assert.equal(history[1].module, 'Thiết yếu');

  assert.equal(history[2].id, 'TC103');
  assert.equal(history[2].date, '25/08/2026');
  assert.equal(history[2].note, 'Lương KA');
  assert.equal(history[2].module, 'Thu Nhập');
});

test('getWalletTransactionHistory marks Cho vay (THU) as outflow (-) and Di vay (TRA) as inflow (+)', () => {
  const db = createMockDB();
  db.Debt = [
    ['ID', 'Ngày', 'Tên', 'Loại', 'Nội dung', 'Số tiền', 'Nguồn', 'Đã trả', 'Ngày trả', 'Dư nợ', 'Trạng thái'],
    ['CN101', '10/10/2026', 'Bạn A', 'THU', 'Cho mượn tiền', 3290, 'Thẻ UFJ ATM', 0, '', 3290, 'DANG_NO'],
    ['CN102', '09/10/2026', 'Chị B', 'TRA', 'Mượn tiền tiêu', 5000, 'Thẻ UFJ ATM', 0, '', 5000, 'DANG_NO']
  ];

  const history = getWalletTransactionHistory('Thẻ UFJ ATM');
  assert.equal(history.length, 2);

  // CN101 is Cho vay (THU) -> Tiền xuất ra khỏi ví -> type: "-", note: "[Công Nợ] Cho vay: Bạn A (Cho mượn tiền)"
  assert.equal(history[0].id, 'CN101');
  assert.equal(history[0].type, '-');
  assert.equal(history[0].amount, 3290);
  assert.equal(history[0].note, '[Công Nợ] Cho vay: Bạn A (Cho mượn tiền)');

  // CN102 is Di vay (TRA) -> Tiền nhận vào ví -> type: "+", note: "[Công Nợ] Vay từ: Chị B (Mượn tiền tiêu)"
  assert.equal(history[1].id, 'CN102');
  assert.equal(history[1].type, '+');
  assert.equal(history[1].amount, 5000);
  assert.equal(history[1].note, '[Công Nợ] Vay từ: Chị B (Mượn tiền tiêu)');
});

test('6 Hũ Chi and 3 Hũ Khác (THU NHẬP, CK NỘI BỘ, CÔNG NỢ) are standardized and handled properly', () => {
  const db = createMockDB();

  // Test 1: saveFamilyTransaction for THU defaults to THU NHẬP
  const resThu = saveFamilyTransaction({
    ngay: '2026-10-10',
    loai: 'Thu',
    noidung: 'Thưởng quý',
    sotien: 50000,
    nguontien: 'Thẻ UFJ ATM'
  });
  assert.equal(resThu.success, true);
  assert.equal(resThu.savedItem.hu, 'THU NHẬP');
  assert.equal(db.Family[1][3], 'THU NHẬP');

  // Test 2: cleanTransactionDetailNote cleans all 6 spending jars and 3 other jars
  const spendingJars = ["Thiết yếu", "Tiết kiệm", "Giáo dục", "Giải trí", "Cho đi", "Đầu tư"];
  spendingJars.forEach(j => {
    assert.equal(cleanTransactionDetailNote(`[${j}] Chi phí test`, j, true), 'Chi phí test');
    assert.equal(cleanTransactionDetailNote(`${j} - Chi phí test`, j, true), 'Chi phí test');
  });

  const otherJars = ["THU NHẬP", "CK NỘI BỘ", "CÔNG NỢ"];
  assert.equal(cleanTransactionDetailNote('[THU NHẬP] Tiền thưởng', 'THU NHẬP', false), 'Tiền thưởng');
  assert.equal(cleanTransactionDetailNote('[THU NHẬP] Lương Chi', 'Thu Chi [THU NHẬP]', false), 'Lương Chi');
  assert.equal(cleanTransactionDetailNote('Thu Chi [THU NHẬP] Lương Chi', 'Thu Chi [THU NHẬP]', false), 'Lương Chi');
  assert.equal(cleanTransactionDetailNote('[Giải trí] Giày Chít', 'Thu Chi [Giải trí]', true), 'Giày Chít');
  assert.equal(cleanTransactionDetailNote('[----Tất toán thẻ] Thanh toán từ Thẻ UFJ ATM (+100,000 ¥)', 'Tất toán thẻ', false), 'Thanh toán từ Thẻ UFJ ATM');
  assert.equal(cleanTransactionDetailNote('[CK NỘI BỘ] Chuyển khoản', 'CK NỘI BỘ', true), 'Chuyển khoản');
  assert.equal(cleanTransactionDetailNote('[CÔNG NỢ] Thu tiền nợ', 'CÔNG NỢ', false), 'Thu tiền nợ');

  // Test formatCleanModule
  assert.equal(formatCleanModule('Thu Chi [THU NHẬP]', true), 'Thu Nhập');
  assert.equal(formatCleanModule('Thu Chi [Giải trí]', false), 'Giải trí');
  assert.equal(formatCleanModule('----CK Nội Bộ', false), 'CK Nội Bộ');
  assert.equal(formatCleanModule('----Tất toán thẻ', false), 'Tất Toán Thẻ');
  assert.equal(formatCleanModule('Thiết yếu', false), 'Thiết yếu');

  // Test 3: Tab 2 excludes non-living jars (CK NỘI BỘ, CÔNG NỢ) from living expense calculations
  db.Family = [
    ['ID', 'Timestamp', 'Loại', 'Hũ', 'Nội dung', 'Số tiền', 'Ví/Thẻ Giao Dịch', 'Là Khoản Cố Định?', 'Ghi chú', 'Trạng thái'],
    ['TC1', '10/10/2026', 'Thu', 'THU NHẬP', 'Lương tháng', 300000, 'Thẻ UFJ ATM', '', '', 'HOAN_TAT'],
    ['TC2', '10/10/2026', 'Chi', 'Thiết yếu', 'Tiền nhà', 80000, 'Thẻ UFJ ATM', '', '', 'HOAN_TAT'],
    ['TC3', '10/10/2026', 'Chi', 'Giải trí', 'Xem phim', 10000, 'Thẻ UFJ ATM', '', '', 'HOAN_TAT'],
    ['TC4', '10/10/2026', 'Chi', 'CK NỘI BỘ', 'Chuyển tiền: Ví A -> Ví B', 50000, 'Thẻ UFJ ATM', '', '', 'HOAN_TAT'],
    ['TC5', '10/10/2026', 'Thu', 'CÔNG NỢ', '[Tất toán công nợ] Thu nợ', 20000, 'Thẻ UFJ ATM', '', '', 'HOAN_TAT']
  ];

  const t2 = getTab2Data('10', '2026');
  assert.equal(t2.summary.totalIncome, 300000); // Only regular income
  assert.equal(t2.summary.totalExpense, 90000); // 80000 + 10000 (excludes 50000 transfer)
});

test('Approach 2: Backdated uncheckpointed transaction (e.g. 09/10 entered after 10/10 checkpoint) is included in balance and THU/CHI', () => {
  const db = createMockDB();
  db.Wallets = [
    ['ID', 'Tên', 'Phân loại', 'Hạn mức', 'Ngày chốt sao kê', 'Ngày Đáo hạn', 'Số Dư Ban Đầu', 'THU', 'CHI', 'Số Dư Hiện Tại', 'Ví nguồn', 'Checkpoint Date'],
    ['W33773', 'Ufj KA', 'DEBIT', '', '', '', 6507208, 0, 0, 6507208, '', '10/10/2026']
  ];
  db.WalletCheckpoints = [
    ['CP_01', 'W33773', 'Ufj KA', '10/10/2026', 6507208, '2026-10-10T00:00:00Z', 'User', 'ACTIVE']
  ];

  db.WalletLedger = [
    ['LedgerID', 'WalletID', 'WalletName', 'Date', 'Amount', 'Direction', 'EffectType', 'SourceModule', 'SourceID', 'EventType', 'IdempotencyKey', 'Status', 'Note', 'CreatedAt', 'ReversalOf', 'CheckpointRef'],
    ['LED1', 'W33773', 'Ufj KA', '2026-10-08', 50000, 'OUT', 'CASH', 'Family', 'FAM_OLD', 'EXPENSE', 'K1', 'POSTED', 'Ăn tối cũ', '2026-10-08T10:00:00Z', '', 'CP_01'],
    ['LED2', 'W33773', 'Ufj KA', '2026-10-09', 10000, 'OUT', 'CASH', 'Family', 'FAM_BACKDATED', 'EXPENSE', 'K2', 'POSTED', 'Sót ngày 9/10', '2026-10-11T12:00:00Z', '', '']
  ];

  db.Family = [
    ['ID', 'Timestamp', 'Loại', 'Hũ', 'Nội dung', 'Số tiền', 'Ví/Thẻ Giao Dịch', 'Là Khoản Cố Định?', 'Ghi chú', 'Trạng thái'],
    ['FAM_OLD', '08/10/2026', 'Chi', 'Thiết yếu', 'Ăn tối cũ', 50000, 'Ufj KA', '', '', 'HOAN_TAT'],
    ['FAM_BACKDATED', '09/10/2026', 'Chi', 'Thiết yếu', 'Sót ngày 9/10', 10000, 'Ufj KA', '', '', 'HOAN_TAT']
  ];

  const wRes = getWalletsFromSheet('10', '2026');
  const ufj = wRes.wallets.find(w => w.name === 'Ufj KA');
  assert.ok(ufj);
  assert.equal(ufj.total_decrease, 10000);
  assert.equal(ufj.current_balance, 6497208); // 6,507,208 - 10,000 = 6,497,208

  const rbRes = rebuildWalletBalance('W33773');
  assert.equal(rbRes.success, true);
  assert.equal(rbRes.currentBalance, 6497208);
});


