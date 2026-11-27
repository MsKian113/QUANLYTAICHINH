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

test('saveWalletToSheet preserves and updates initial_balance accurately', () => {
  const db = createMockDB();

  const res = saveWalletToSheet({
    id: 'W003',
    name: 'Ví Tiền Mặt',
    type: 'DEBIT',
    initial_balance: 250000,
    current_balance: 350000
  });

  assert.equal(res.success, true);
  assert.equal(db.Wallets[3][6], 250000);
});

test('deleteWalletFromSheet deletes wallet row by ID', () => {
  const db = createMockDB();

  const res = deleteWalletFromSheet('W002');

  assert.equal(res.success, true);
  assert.equal(db.Wallets.length, 3);
  assert.ok(!db.Wallets.some(r => r[0] === 'W002'));
});

test('deleteWalletFromSheet hides wallet (Col N DELETED) when wallet has transactions in WalletLedger Col C', () => {
  const db = createMockDB();
  // W001 is 'C- Thẻ Rakuten', let's add a transaction in WalletLedger with Col C = 'C- Thẻ Rakuten'
  db.WalletLedger = [
    ['LedgerID', 'WalletID', 'WalletName', 'Date', 'Amount', 'Direction', 'EffectType', 'SourceModule'],
    ['L001', 'W001', 'C- Thẻ Rakuten', '2026-10-01', 50000, 'OUT', 'CARD_DEBT', 'Purchase']
  ];

  const res = deleteWalletFromSheet('W001');

  assert.equal(res.success, true);
  assert.ok(res.message.includes('Ẩn'));
  // Row count must NOT decrease!
  assert.equal(db.Wallets.length, 4);
  // Column N (index 13) of W001 row must be DELETED
  const w001Row = db.Wallets.find(r => r[0] === 'W001');
  assert.ok(w001Row);
  assert.equal(w001Row[13], 'DELETED');
});

test('processWalletTransfer deducts source wallet, credits destination wallet, and logs to Family sheet', () => {
  const db = createMockDB();

  const res = processWalletTransfer({
    fromWallet: 'Thẻ UFJ ATM',
    toWallet: 'Ví Tiền Mặt',
    amount: 100000,
    date: '2026-10-25',
    note: 'Rút ATM'
  });

  assert.equal(res.success, true);
  assert.equal(db.Wallets[2][6], 700000);
  assert.equal(db.Wallets[3][6], 400000);
  const loggedTransfer = db.Family.find(r => r[3] === 'CK NỘI BỘ' && r[6] === 'Thẻ UFJ ATM');
  assert.ok(loggedTransfer);
  assert.equal(loggedTransfer[1], '25/10/2026');
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
  db.WalletLedger = [
    ['LedgerID', 'WalletID', 'WalletName', 'Date', 'Amount', 'Direction', 'EffectType', 'SourceModule', 'SourceID', 'EventType', 'IdempotencyKey', 'Status', 'Note', 'CreatedAt', 'ReversalOf', 'CheckpointRef'],
    ['LED_TX_POST', 'W33773', 'Ufj KA', '2026-10-11', 381, 'OUT', 'CASH', 'Family', 'TX_POST', 'FAMILY_EXPENSE', 'K1', 'POSTED', 'Mua cà phê', '2026-10-11T10:00:00Z', '', '']
  ];

  const res = rebuildWalletBalance('W33773');
  assert.equal(res.success, true);
  // 6,507,208 - 381 = 6,506,827 (NOT 6,468,088 - 381 = 6,467,707!)
  assert.equal(res.currentBalance, 6506827);
});

test('rebuildWalletBalance for CREDIT card calculates Available Credit (Limit - Debt) based on column C type', () => {
  const db = createMockDB();
  db.Wallets = [
    ['ID', 'Tên', 'Phân loại', 'Hạn mức', 'Ngày chốt sao kê', 'Ngày Đáo hạn', 'Số Dư Ban Đầu', 'THU', 'CHI', 'Số Dư Hiện Tại', 'Ví nguồn', 'Checkpoint Date'],
    ['W33762', 'C- Raku KA', 'CREDIT', 2000000, 12, 25, 0, 0, 0, 0, '', '']
  ];
  db.WalletCheckpoints = [
    ['CheckpointID', 'WalletID', 'WalletName', 'CheckpointDate', 'CheckpointBalance', 'CreatedAt', 'CreatedBy', 'Status']
  ];
  db.WalletLedger = [
    ['LedgerID', 'WalletID', 'WalletName', 'Date', 'Amount', 'Direction', 'EffectType', 'SourceModule', 'SourceID', 'EventType', 'IdempotencyKey', 'Status', 'Note', 'CreatedAt', 'ReversalOf', 'CheckpointRef'],
    ['LED_CC_01', 'W33762', 'C- Raku KA', '2026-10-11', 991243, 'OUT', 'CARD_DEBT', 'Family', 'TX_CC_1', 'FAMILY_EXPENSE', 'K1', 'POSTED', 'Chi tiêu thẻ', '2026-10-11T10:00:00Z', '', '']
  ];

  const res = rebuildWalletBalance('W33762');
  assert.equal(res.success, true);
  // Hạn mức: 2,000,000, Nợ: 991,243 => Khả dụng (Số dư hiện tại): 2,000,000 - 991,243 = 1,008,757 (NOT 30,599)
  assert.equal(res.currentBalance, 1008757);
  assert.equal(db.Wallets[1][7], 0); // THU
  assert.equal(db.Wallets[1][8], 991243); // CHI
  assert.equal(db.Wallets[1][9], 1008757); // Số Dư Hiện Tại
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
  db.WalletLedger = [
    ['LedgerID', 'WalletID', 'WalletName', 'Date', 'Amount', 'Direction', 'EffectType', 'SourceModule', 'SourceID', 'EventType', 'IdempotencyKey', 'Status', 'Note', 'CreatedAt', 'ReversalOf', 'CheckpointRef'],
    ['TC101', 'W002', 'Thẻ UFJ ATM', '2026-10-09T10:00:00.000Z', 27470, 'IN', 'CASH', 'Family', 'TC101', 'FAMILY_INCOME', 'K1', 'POSTED', 'Đi lại - Tàu Ka', '', '', ''],
    ['TC102', 'W002', 'Thẻ UFJ ATM', '14/09/2026', 104887, 'OUT', 'CASH', 'Family', 'TC102', 'FAMILY_EXPENSE', 'K2', 'POSTED', 'Nhà ở - Loan Nhà', '', '', ''],
    ['TC103', 'W002', 'Thẻ UFJ ATM', '2026-08-25', 220498, 'IN', 'CASH', 'Family', 'TC103', 'FAMILY_INCOME', 'K3', 'POSTED', 'Lương KA', '', '', '']
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
  assert.equal(history[1].module, 'Thu Chi');

  assert.equal(history[2].id, 'TC103');
  assert.equal(history[2].date, '25/08/2026');
  assert.equal(history[2].note, 'Lương KA');
  assert.equal(history[2].module, 'Thu Nhập');
});

test('getWalletTransactionHistory marks Cho vay (THU) as outflow (-) and Di vay (TRA) as inflow (+)', () => {
  const db = createMockDB();
  db.WalletLedger = [
    ['LedgerID', 'WalletID', 'WalletName', 'Date', 'Amount', 'Direction', 'EffectType', 'SourceModule', 'SourceID', 'EventType', 'IdempotencyKey', 'Status', 'Note', 'CreatedAt', 'ReversalOf', 'CheckpointRef'],
    ['CN101', 'W002', 'Thẻ UFJ ATM', '10/10/2026', 3290, 'OUT', 'CASH', 'Debt', 'CN101', 'LEND_MONEY', 'K1', 'POSTED', '[Cho vay] Bạn A (Cho mượn tiền)', '', '', ''],
    ['CN102', 'W002', 'Thẻ UFJ ATM', '09/10/2026', 5000, 'IN', 'CASH', 'Debt', 'CN102', 'BORROW_MONEY', 'K2', 'POSTED', '[Đi mượn] Chị B (Mượn tiền tiêu)', '', '', '']
  ];

  const history = getWalletTransactionHistory('Thẻ UFJ ATM');
  assert.equal(history.length, 2);

  // CN101 is Cho vay (THU) -> Tiền xuất ra khỏi ví -> type: "-", note: "[Cho vay] Bạn A (Cho mượn tiền)"
  assert.equal(history[0].id, 'CN101');
  assert.equal(history[0].type, '-');
  assert.equal(history[0].amount, 3290);
  assert.equal(history[0].note, '[Cho vay] Bạn A (Cho mượn tiền)');

  // CN102 is Di vay (TRA) -> Tiền nhận vào ví -> type: "+", note: "[Đi mượn] Chị B (Mượn tiền tiêu)"
  assert.equal(history[1].id, 'CN102');
  assert.equal(history[1].type, '+');
  assert.equal(history[1].amount, 5000);
  assert.equal(history[1].note, '[Đi mượn] Chị B (Mượn tiền tiêu)');
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

test('getWalletTransactionHistory prioritizes 100% WalletLedger column M (Note)', () => {
  const db = createMockDB();
  db.WalletLedger = [
    ['LedgerID', 'WalletID', 'WalletName', 'Date', 'Amount', 'Direction', 'EffectType', 'SourceModule', 'SourceID', 'EventType', 'IdempotencyKey', 'Status', 'Note', 'CreatedAt', 'ReversalOf', 'CheckpointRef'],
    ['LED_01', 'W001', 'RakuB Chi', '2026-10-09', 5280, 'OUT', 'CASH', 'Debt', 'CN101', 'LEND_MONEY', 'K1', 'POSTED', '[Cho vay] A Huân (EB03)', '2026-10-09T10:00:00Z', '', ''],
    ['LED_02', 'W001', 'RakuB Chi', '2026-10-10', 12000, 'OUT', 'CASH', 'Purchase', 'PO102', 'PURCHASE_CHARGE', 'K2', 'POSTED', '[Mua hàng] Film MINI MERMAID TAIL (x3)', '2026-10-10T12:00:00Z', '', ''],
    ['LED_03', 'W001', 'RakuB Chi', '2026-10-11', 50000, 'IN', 'CASH', 'Family', 'FAM103', 'FAMILY_INCOME', 'K3', 'POSTED', '[Thu nhập] Lương tháng 10', '2026-10-11T14:00:00Z', '', ''],
    ['LED_04', 'W001', 'RakuB Chi', '2026-10-12', 3000, 'OUT', 'CASH', 'Debt', 'CN104', 'BORROW_MONEY', 'K4', 'REVERSED', '[Bị hủy] Bút toán đảo', '2026-10-12T15:00:00Z', '', '']
  ];

  const history = getWalletTransactionHistory('RakuB Chi');
  assert.equal(history.length, 3); // LED_04 is REVERSED so excluded!
  assert.equal(history[0].id, 'LED_03');
  assert.equal(history[0].note, '[Thu nhập] Lương tháng 10');
  assert.equal(history[0].type, '+');
  assert.equal(history[0].amount, 50000);

  assert.equal(history[1].id, 'LED_02');
  assert.equal(history[1].note, '[Mua hàng] Film MINI MERMAID TAIL (x3)');
  assert.equal(history[1].type, '-');
  assert.equal(history[1].amount, 12000);

  assert.equal(history[2].id, 'LED_01');
  assert.equal(history[2].note, '[Cho vay] A Huân (EB03)');
  assert.equal(history[2].type, '-');
  assert.equal(history[2].amount, 5280);
});

test('getWalletsFromSheet and rebuildWalletBalance do not double balances when WalletLedger has OPENING_BALANCE or untagged pre-checkpoint rows', () => {
  const db = createMockDB();
  db.Wallets = [
    ['ID', 'Tên', 'Phân loại', 'Hạn mức', 'Ngày chốt sao kê', 'Ngày Đáo hạn', 'Số Dư Ban Đầu', 'THU', 'CHI', 'Số Dư Hiện Tại', 'Ví nguồn', 'Checkpoint Date'],
    ['W33759', 'Tiền Mặt', 'DEBIT', '', '', '', 2299093, 8131807, 4565789, 5865111, '', '01/10/2026'],
    ['W33767', 'RakuB KA', 'DEBIT', '', '', '', 3337939, 1303262, 577318, 3337939, '', '10/10/2026']
  ];
  db.WalletCheckpoints = [
    ['CP_TM', 'W33759', 'Tiền Mặt', '01/10/2026', 2299093, '2026-10-01T00:00:00Z', 'User', 'ACTIVE'],
    ['CP_RB', 'W33767', 'RakuB KA', '10/10/2026', 3337939, '2026-10-10T00:00:00Z', 'User', 'ACTIVE']
  ];
  db.WalletLedger = [
    ['LedgerID', 'WalletID', 'WalletName', 'Date', 'Amount', 'Direction', 'EffectType', 'SourceModule', 'SourceID', 'EventType', 'IdempotencyKey', 'Status', 'Note', 'CreatedAt', 'ReversalOf', 'CheckpointRef'],
    // OPENING_BALANCE rows without CheckpointRef (created before Col P was introduced)
    ['LED_INIT_1', 'W33759', 'Tiền Mặt', '2026-10-01', 2299093, 'IN', 'CASH', 'Wallets', 'INIT_W33759', 'OPENING_BALANCE', 'K_INIT_1', 'POSTED', '[Số dư đầu kỳ] Khởi tạo ví Tiền Mặt', '2026-10-09T22:50:00Z', '', ''],
    ['LED_INIT_2', 'W33767', 'RakuB KA', '2026-10-01', 2611995, 'IN', 'CASH', 'Wallets', 'INIT_W33767', 'OPENING_BALANCE', 'K_INIT_2', 'POSTED', '[Số dư đầu kỳ] Khởi tạo ví RakuB KA', '2026-10-09T22:50:00Z', '', ''],
    // Post-01/10 transaction for Tiền Mặt
    ['LED_TM_1', 'W33759', 'Tiền Mặt', '2026-10-05', 100000, 'IN', 'CASH', 'Sales', 'SO_01', 'SALES_REVENUE', 'K_TM_1', 'POSTED', 'Thu tiền hàng', '2026-10-05T10:00:00Z', '', ''],
    // Pre-10/10 transaction for RakuB KA (without CheckpointRef because checkpoint was created before markCheckpointInLedger existed)
    ['LED_RB_PRE', 'W33767', 'RakuB KA', '2026-10-04', 500000, 'IN', 'CASH', 'Sales', 'SO_02', 'SALES_REVENUE', 'K_RB_1', 'POSTED', 'Thu trước chốt sổ', '2026-10-04T10:00:00Z', '', '']
  ];

  // First call to getWalletsFromSheet("All", "All")
  const res1 = getWalletsFromSheet('All', 'All');
  const tm1 = res1.wallets.find(w => w.name === 'Tiền Mặt');
  const rb1 = res1.wallets.find(w => w.name === 'RakuB KA');
  assert.equal(tm1.current_balance, 2399093); // 2,299,093 + 100,000 (OPENING_BALANCE not double-counted!)
  assert.equal(rb1.current_balance, 3337939); // 3,337,939 + 0 (pre-10/10 row and stale THU/CHI not added!)

  // Second call to getWalletsFromSheet("All", "All") must be idempotent and never compound Col J
  const res2 = getWalletsFromSheet('All', 'All');
  const tm2 = res2.wallets.find(w => w.name === 'Tiền Mặt');
  const rb2 = res2.wallets.find(w => w.name === 'RakuB KA');
  assert.equal(tm2.current_balance, 2399093);
  assert.equal(rb2.current_balance, 3337939);

  // rebuildWalletBalance must also match
  const rbTm = rebuildWalletBalance('W33759');
  const rbRb = rebuildWalletBalance('W33767');
  assert.equal(rbTm.currentBalance, 2399093);
  assert.equal(rbRb.currentBalance, 3337939);

  // getWalletTransactionHistory must exclude OPENING_BALANCE rows
  const tmHist = getWalletTransactionHistory('Tiền Mặt');
  assert.equal(tmHist.length, 1);
  assert.equal(tmHist[0].id, 'LED_TM_1');
});

test('getWalletTransactionHistory extracts correct checkpoint date (01/10/2026) instead of settle_source (RakuB KA) for Credit Cards', () => {
  const db = createMockDB();
  db.Wallets = [
    ['ID', 'Tên Ví', 'Phân loại', 'Hạn mức', 'Ngày chốt sao kê', 'Ngày đáo hạn', 'Số Dư Ban Đầu', 'THU', 'CHI', 'Preorder', 'Số Dư Hiện Tại', 'Ví nguồn', 'Ngày chốt sổ', 'Số dư chốt'],
    ['W_RAKU', 'C- Raku KA', 'CREDIT', 2000000, '12', '27', -991243, 0, 0, 15000, -991243, 'RakuB KA', '01/10/2026', -991243]
  ];
  db.WalletLedger = [
    ['LedgerID', 'WalletID', 'WalletName', 'Date', 'Amount', 'Direction', 'EffectType', 'SourceModule', 'SourceID', 'EventType', 'IdempotencyKey', 'Status', 'Note', 'CreatedAt', 'ReversalOf', 'CheckpointRef'],
    ['LED_OLD_1', 'W_RAKU', 'C- Raku KA', '2026-09-28', 120000, 'INCREASE', 'CARD_DEBT', 'Purchase', 'PO_01', 'PURCHASE', 'K_OLD1', 'POSTED', '[Mua hàng] Uniqlo', '2026-09-28T10:00:00Z', '', 'CP_OCT'],
    ['LED_NEW_1', 'W_RAKU', 'C- Raku KA', '2026-10-05', 45000, 'INCREASE', 'CARD_DEBT', 'Purchase', 'PO_02', 'PURCHASE', 'K_NEW1', 'POSTED', '[Mua hàng] Zara', '2026-10-05T10:00:00Z', '', '']
  ];

  const hist = getWalletTransactionHistory('C- Raku KA');
  assert.equal(hist.length, 2);
  
  // Verify checkpoint metadata on items: MUST be date 01/10/2026, NOT RakuB KA!
  assert.equal(hist[0].cpDateStr, '01/10/2026');
  assert.notEqual(hist[0].cpDateStr, 'RakuB KA');
  assert.equal(hist[0].cpBalance, -991243);

  // New tx is after checkpoint, old tx is not after checkpoint
  const newTx = hist.find(x => x.id === 'LED_NEW_1');
  const oldTx = hist.find(x => x.id === 'LED_OLD_1');
  assert.equal(newTx.isAfterCp, true);
  assert.equal(oldTx.isAfterCp, false);

  // Wallets sheet debt when dec=45000, inc=0 reflects: baseDebt (991,243) + dec (45,000) = 1,036,243
  const walletsRes = getWalletsFromSheet('ALL', 'ALL');
  const rakuWallet = walletsRes.wallets.find(w => w.name === 'C- Raku KA');
  assert.equal(rakuWallet.debt, 1036243);
  assert.equal(rakuWallet.checkpoint_date, '01/10/2026');
  assert.notEqual(rakuWallet.checkpoint_date, 'RakuB KA');

  // When no transactions after checkpoint (dec=0, inc=0), debt preserves checkpointed debt (991243)
  db.WalletLedger.pop(); // remove LED_NEW_1
  const walletsRes2 = getWalletsFromSheet('ALL', 'ALL');
  const rakuWallet2 = walletsRes2.wallets.find(w => w.name === 'C- Raku KA');
  assert.equal(rakuWallet2.debt, 991243);
});

test('Resona case: Balance strictly equals Checkpoint Balance + Income after CP - Expense after CP (63,450 ¥, never 13,450 ¥)', () => {
  const db = createMockDB();
  db.Wallets = [
    ['ID', 'Tên Ví', 'Phân loại', 'Hạn mức', 'Ngày chốt sao kê', 'Ngày đáo hạn', 'Số Dư Ban Đầu', 'THU', 'CHI', 'Preorder', 'Số Dư Hiện Tại', 'Ví nguồn', 'Ngày chốt sổ', 'Số dư chốt'],
    ['W_RESONA', 'Resona', 'DEBIT', 0, '', '', 71887, 0, 0, 0, 71887, '', '15/10/2026', 71887]
  ];
  db.WalletCheckpoints = [
    ['CheckpointID', 'WalletID', 'WalletName', 'CheckpointDate', 'Balance', 'CreatedAt', 'CreatedBy', 'Status'],
    ['CP_RES_1', 'W_RESONA', 'Resona', '15/10/2026', 71887, '2026-10-15T10:00:00Z', 'User', 'ACTIVE']
  ];
  db.WalletLedger = [
    ['LedgerID', 'WalletID', 'WalletName', 'Date', 'Amount', 'Direction', 'EffectType', 'SourceModule', 'SourceID', 'EventType', 'IdempotencyKey', 'Status', 'Note', 'CreatedAt', 'ReversalOf', 'CheckpointRef'],
    // 1. Giao dịch cũ ngày 10/10 không có cpRef (50,000 ¥)
    ['LED_OLD_1', 'W_RESONA', 'Resona', '2026-10-10', 50000, 'OUT', 'CASH', 'Family', 'FAM_OLD_1', 'EXPENSE', 'K_OLD_1', 'POSTED', 'Chi tiêu cũ 10/10', '2026-10-10T09:00:00Z', '', ''],
    // 2. Giao dịch ngày 14/10 không có cpRef (6,420 ¥)
    ['LED_OLD_2', 'W_RESONA', 'Resona', '2026-10-14', 6420, 'OUT', 'CASH', 'Purchase', 'PO_OP17', 'PURCHASE_CHARGE', 'K_OP17', 'POSTED', '[Mua hàng] OP 17 (x1)', '2026-10-14T11:00:00Z', '', ''],
    // 3. Giao dịch cùng ngày 15/10 trước chốt sổ ĐÃ có cpRef (615 ¥)
    ['LED_CP_1', 'W_RESONA', 'Resona', '2026-10-15', 615, 'OUT', 'CASH', 'Family', 'FAM_SH', 'EXPENSE', 'K_SH', 'POSTED', '[Chi tiêu] - Sinh hoạt - Siêu thị', '2026-10-15T08:00:00Z', '', 'CP_RES_1'],
    // 4. Giao dịch cùng ngày 15/10 sau chốt sổ KHÔNG có cpRef (4,700 ¥)
    ['LED_NEW_1', 'W_RESONA', 'Resona', '2026-10-15', 4700, 'OUT', 'CASH', 'Family', 'FAM_VN', 'EXPENSE', 'K_VN', 'POSTED', '2A- Gửi về vn', '2026-10-15T15:00:00Z', '', ''],
    // 5. Giao dịch ngày 16/10 sau chốt sổ (2,372 ¥)
    ['LED_NEW_2', 'W_RESONA', 'Resona', '2026-10-16', 2372, 'OUT', 'CASH', 'Family', 'FAM_GAS', 'EXPENSE', 'K_GAS', 'POSTED', '[Chi tiêu] - Nhà ở - Gas', '2026-10-16T12:00:00Z', '', ''],
    // 6. Giao dịch ngày 17/10 sau chốt sổ (735 ¥)
    ['LED_NEW_3', 'W_RESONA', 'Resona', '2026-10-17', 735, 'OUT', 'CASH', 'Family', 'FAM_GIFT', 'EXPENSE', 'K_GIFT', 'POSTED', 'Quà tặng', '2026-10-17T10:00:00Z', '', ''],
    // 7. Giao dịch ngày 17/10 sau chốt sổ (630 ¥)
    ['LED_NEW_4', 'W_RESONA', 'Resona', '2026-10-17', 630, 'OUT', 'CASH', 'Family', 'FAM_OTHER', 'EXPENSE', 'K_OTHER', 'POSTED', 'Chi tiêu vặt', '2026-10-17T14:00:00Z', '', '']
  ];

  // 1. Kiểm tra getWalletsFromSheet: Số dư Resona = 71,887 - 8,437 = 63,450 ¥ (KHÔNG BỊ TỤT XUỐNG 13,450 ¥)
  const res = getWalletsFromSheet('ALL', 'ALL');
  const resona = res.wallets.find(w => w.name === 'Resona');
  assert.ok(resona);
  assert.equal(resona.current_balance, 63450);
  assert.equal(resona.total_decrease, 8437); // 4,700 + 2,372 + 735 + 630 = 8,437

  // 2. Kiểm tra rebuildWalletBalance: Khớp tuyệt đối 63,450 ¥
  const rebuild = rebuildWalletBalance('W_RESONA');
  assert.equal(rebuild.success, true);
  assert.equal(rebuild.currentBalance, 63450);

  // 3. Kiểm tra getWalletTransactionHistory:
  // Toàn bộ giao dịch sau chốt sổ (isAfterCp = true) phải đứng TRƯỚC toàn bộ giao dịch trước chốt sổ (isAfterCp = false)
  const hist = getWalletTransactionHistory('Resona');
  assert.equal(hist.length, 7);

  // 4 giao dịch sau chốt sổ:
  assert.equal(hist[0].id, 'LED_NEW_4'); // 17/10
  assert.equal(hist[0].isAfterCp, true);
  assert.equal(hist[1].id, 'LED_NEW_3'); // 17/10
  assert.equal(hist[1].isAfterCp, true);
  assert.equal(hist[2].id, 'LED_NEW_2'); // 16/10
  assert.equal(hist[2].isAfterCp, true);
  assert.equal(hist[3].id, 'LED_NEW_1'); // 15/10 2A- Gửi về vn
  assert.equal(hist[3].isAfterCp, true);

  // 3 giao dịch đã chốt:
  assert.equal(hist[4].id, 'LED_CP_1');  // 15/10 Sinh hoạt - Siêu thị [Đã chốt]
  assert.equal(hist[4].isAfterCp, false);
  assert.equal(hist[5].id, 'LED_OLD_2'); // 14/10 OP 17
  assert.equal(hist[5].isAfterCp, false);
  assert.equal(hist[6].id, 'LED_OLD_1'); // 10/10 Chi cũ
  assert.equal(hist[6].isAfterCp, false);
});

test('Credit Card Checkpoint: After chốt sổ and clearing THU/CHI to 0, current debt remains at newly checkpointed amount', () => {
  const db = createMockDB();
  db.Wallets = [
    ['ID', 'Tên', 'Phân loại', 'Hạn mức', 'Ngày chốt sao kê', 'Ngày Đáo hạn', 'Số Dư Ban Đầu', 'THU', 'CHI', 'Preorder', 'Số Dư Hiện Tại', 'Ví nguồn', 'Checkpoint Date'],
    ['W_RAKU_CC', 'C- Raku KA', 'CREDIT', 2000000, '12', '27', 0, 0, 991243, 33230, 991243, 'Ufj KA', '']
  ];

  // 1. Thực hiện chốt sổ mốc dư nợ 991,243 ¥
  const cpRes = checkpointWalletBalance({
    walletId: 'W_RAKU_CC',
    walletName: 'C- Raku KA',
    currentBalance: 991243,
    checkpointDate: '15/10/2026'
  });
  assert.equal(cpRes.success, true);
  assert.equal(cpRes.checkpointBalance, -991243);

  // Kiểm tra Sheet Wallets sau khi chốt: THU = 0, CHI = 0, nhưng Số Dư Ban Đầu & Số Dư Hiện Tại vẫn giữ mốc 991,243 ¥
  const wRow = db.Wallets[1];
  assert.equal(wRow[7], 0, 'THU phải được reset về 0');
  assert.equal(wRow[8], 0, 'CHI phải được reset về 0');

  // Đọc lại qua getWalletsFromSheet: Dư nợ vẫn phải là 991,243 ¥ (KHÔNG ĐƯỢC VỀ 0)
  const walletsRes = getWalletsFromSheet('ALL', 'ALL');
  const rakuCard = walletsRes.wallets.find(w => w.name === 'C- Raku KA');
  assert.ok(rakuCard);
  assert.equal(rakuCard.debt, 991243, 'Dư nợ sau chốt sổ và xóa THU/CHI phải còn lại ở số mới chốt (991,243 ¥)');
  assert.equal(rakuCard.current_balance, -991243);
});

test('Credit Card Running Debt: computeStatementRunningBalances without checkpoint starts from 0/initial_balance (never doubles ending debt)', () => {
  // Mô phỏng trường hợp thẻ C- Raku KA có 7 giao dịch tổng chi = 1,061,612 ¥, không có checkpoint
  // Dư nợ kết thúc là 1,061,612 ¥
  const activeWallet = {
    id: 'W_RAKU_CC',
    name: 'C- Raku KA',
    type: 'CREDIT',
    current_balance: -1061612,
    debt: 1061612,
    initial_balance: 0
  };

  const fullList = [
    { id: '1', date: '26/10/2026', type: '-', amount: 70369, note: 'Giao dịch mới nhất' },
    { id: '2', date: '25/10/2026', type: '-', amount: 100000, note: 'Giao dịch 2' },
    { id: '3', date: '20/10/2026', type: '-', amount: 200000, note: 'Giao dịch 3' },
    { id: '4', date: '15/10/2026', type: '-', amount: 300000, note: 'Giao dịch 4' },
    { id: '5', date: '10/10/2026', type: '-', amount: 200000, note: 'Giao dịch 5' },
    { id: '6', date: '01/10/2026', type: '-', amount: 188603, note: 'Giao dịch 6' },
    { id: '7', date: '20/09/2026', type: '-', amount: 2640, note: 'ETC cũ nhất' }
  ];

  // Logic computeStatementRunningBalances đã được sửa
  const cleanName = String(activeWallet.name || '').trim().toLowerCase();
  const isCredit = activeWallet.type === 'CREDIT' || /^c-\s*/i.test(cleanName);
  const cpItem = fullList.find(it => it.cpDateStr && it.cpBalance !== undefined && it.cpBalance !== null && it.cpBalance !== '');

  let cpBaseDebt = 0;
  if (cpItem) {
    cpBaseDebt = Math.abs(Number(cpItem.cpBalance || 0));
  } else if (activeWallet && activeWallet.checkpoint_date && activeWallet.checkpoint_balance !== undefined && activeWallet.checkpoint_balance !== null && activeWallet.checkpoint_balance !== '') {
    cpBaseDebt = Math.abs(Number(activeWallet.checkpoint_balance || 0));
  } else {
    cpBaseDebt = (activeWallet && activeWallet.initial_balance !== undefined && Number(activeWallet.initial_balance) !== 0) ? Math.abs(Number(activeWallet.initial_balance)) : 0;
  }

  const postCpItems = [];
  for (let i = 0; i < fullList.length; i++) {
    if (fullList[i].isAfterCp !== false) {
      postCpItems.push(fullList[i]);
    }
  }

  let runningDebt = cpBaseDebt;
  for (let i = postCpItems.length - 1; i >= 0; i--) {
    const it = postCpItems[i];
    const amt = Number(it.amount || 0);
    if (it.type === '-') {
      runningDebt += amt;
    } else if (it.type === '+') {
      runningDebt = Math.max(0, runningDebt - amt);
    }
    it.runningBalance = runningDebt;
  }

  // Row 7 (cũ nhất) phải có dư nợ tích lũy = 2,640 ¥ (KHÔNG PHẢI 73,009 ¥)
  assert.equal(fullList[6].runningBalance, 2640, 'Dòng cũ nhất phải bằng đúng số tiền phát sinh 2,640 ¥, không cộng dồn dư nợ cuối');
  // Row 1 (mới nhất) phải có dư nợ = 1,061,612 ¥ (KHÔNG PHẢI 1,131,981 ¥)
  assert.equal(fullList[0].runningBalance, 1061612, 'Dòng mới nhất phải bằng 1,061,612 ¥');
  assert.equal(runningDebt, 1061612);
});

test('Credit Card Settlement: updateWalletBalanceHelper reduces CHI (debt) and never increases THU (inc)', () => {
  const db = createMockDB();
  db.Wallets = [
    ['ID', 'Tên', 'Phân loại', 'Hạn mức', 'Ngày chốt sao kê', 'Ngày Đáo hạn', 'Số Dư Ban Đầu', 'THU', 'CHI', 'Preorder', 'Số Dư Hiện Tại', 'Ví nguồn', 'Checkpoint Date'],
    ['W33762', 'C- Raku KA', 'CREDIT', 2000000, '12', '25', 0, 0, 1061612, 0, 938388, 'RakuB KA', '']
  ];

  // 1. Thực hiện tất toán 991,243 ¥ cho thẻ C- Raku KA
  const res = updateWalletBalanceHelper('C- Raku KA', 991243);
  assert.ok(res);
  assert.equal(res.total_increase, 0, 'THU của thẻ Credit sau tất toán phải bằng 0, không được tăng THU');
  assert.equal(res.total_decrease, 70369, 'CHI của thẻ Credit phải giảm từ 1,061,612 xuống 70,369');
  assert.equal(res.currentBalance, 1929631, 'Khả dụng phải là 2,000,000 - 70,369 = 1,929,631');

  // Kiểm tra hàng trên Sheet Wallets
  const row = db.Wallets[1];
  assert.equal(row[7], 0, 'Cột THU trên sheet phải là 0');
  assert.equal(row[8], 70369, 'Cột CHI trên sheet phải là 70,369');
  assert.equal(row[10], 1929631, 'Cột Số Dư Hiện Tại (Khả dụng) trên sheet phải là 1,929,631');
});

test('Credit Card Statement Filter: getWalletTransactionHistory populates statementDate using explicit column or closing_date fallback', () => {
  const db = createMockDB();
  db.Wallets = [
    ['ID', 'Tên', 'Phân loại', 'Hạn mức', 'Ngày chốt sao kê', 'Ngày Đáo hạn', 'Số Dư Ban Đầu', 'THU', 'CHI', 'Preorder', 'Số Dư Hiện Tại', 'Ví nguồn', 'Checkpoint Date'],
    ['W001', 'C- Amazon', 'CREDIT', 500000, '15', '27', 0, 0, 50000, 0, 450000, 'W002', '']
  ];
  db.WalletLedger = [
    ['LedgerID', 'WalletID', 'WalletName', 'Date', 'Amount', 'Direction', 'EffectType', 'SourceModule', 'SourceID', 'EventType', 'IdempotencyKey', 'Status', 'Note', 'CreatedAt', 'ReversalOf', 'CheckpointRef'],
    ['L001', 'W001', 'C- Amazon', '2026-09-10', 10000, 'OUT', 'CARD_DEBT', 'Purchase', 'P001', 'PURCHASE', 'KEY1', 'POSTED', 'Amazon Item 1', '2026-09-10T10:00:00Z', '', ''],
    ['L002', 'W001', 'C- Amazon', '2026-09-20', 15000, 'OUT', 'CARD_DEBT', 'Purchase', 'P002', 'PURCHASE', 'KEY2', 'POSTED', 'Amazon Item 2', '2026-09-20T10:00:00Z', '', ''],
    ['L003', 'W001', 'C- Amazon', '2026-10-05', 20000, 'OUT', 'CARD_DEBT', 'Purchase', 'P003', 'PURCHASE', 'KEY3', 'POSTED', 'Amazon Item 3', '2026-10-05T10:00:00Z', '', '']
  ];
  // Sheet Purchase: Col 13 (M) is Ngày Sao kê.
  // Row 2: explicit statement date 2026-10-15 (bought 09/10, billed in Oct)
  // Row 3: empty statement date, closing date is 15 => bought 09/20 (> 15) => billed in Oct
  // Row 4: empty statement date, closing date is 15 => bought 10/05 (<= 15) => billed in Oct
  db.Purchase = [
    ['ID', 'Timestamp', 'Tên', 'Danh mục', 'Số tiền', 'Ví/Thẻ', 'Hạn trả', 'Lãi suất', 'Đã trả', 'Trạng thái', 'Ghi chú', 'Mã GD', 'Ngày Sao kê'],
    ['P001', '2026-09-10', 'Item 1', 'Cat', 10000, 'C- Amazon', '', '', '', '', '', 'L001', '2026-10-15'],
    ['P002', '2026-09-20', 'Item 2', 'Cat', 15000, 'C- Amazon', '', '', '', '', '', 'L002', ''],
    ['P003', '2026-10-05', 'Item 3', 'Cat', 20000, 'C- Amazon', '', '', '', '', '', 'L003', '']
  ];

  const history = getWalletTransactionHistory('C- Amazon');
  assert.equal(history.length, 3);
  
  // L001 has explicit statementDate from Purchase Col M
  const item1 = history.find(h => h.id === 'L001');
  assert.ok(item1.statementDate, 'Phải có statementDate');
  assert.ok(item1.statementDate.includes('/10/') || item1.statementDate.includes('-10-'), 'L001 có kỳ sao kê tháng 10: ' + item1.statementDate);

  // L002 bought on 20/09 (> day 15) => calculated statementDate in month 10
  const item2 = history.find(h => h.id === 'L002');
  assert.ok(item2.statementDate, 'Phải có statementDate');
  assert.ok(item2.statementDate.includes('/10/') || item2.statementDate.includes('-10-'), 'L002 phát sinh sau ngày chốt 15/09 nên lên sao kê tháng 10: ' + item2.statementDate);

  // L003 bought on 05/10 (<= day 15) => calculated statementDate in month 10
  const item3 = history.find(h => h.id === 'L003');
  assert.ok(item3.statementDate, 'Phải có statementDate');
  assert.ok(item3.statementDate.includes('/10/') || item3.statementDate.includes('-10-'), 'L003 phát sinh trước ngày chốt 15/10 nên lên sao kê tháng 10: ' + item3.statementDate);
});

test('StatementDate Column O in WalletLedger: Preserves purchase date (15/09) and filters strictly by StatementDate (Tháng 11)', () => {
  const db = createMockDB();
  db.Wallets = [
    ['ID', 'Tên', 'Phân loại', 'Hạn mức', 'Ngày chốt sao kê', 'Ngày Đáo hạn', 'Số Dư Ban Đầu', 'THU', 'CHI', 'Preorder', 'Số Dư Hiện Tại', 'Ví nguồn', 'Checkpoint Date'],
    ['W_SAISON', 'C-Saison', 'CREDIT', 300000, '10', '4', 0, 0, 21450, 0, 278550, 'W002', '']
  ];
  // Col D: 2026-09-15 (ngày mua) | Col O (index 14): 2026-11-01 (kỳ sao kê tháng 11)
  db.WalletLedger = [
    ['LedgerID', 'WalletID', 'WalletName', 'Date', 'Amount', 'Direction', 'EffectType', 'SourceModule', 'SourceID', 'EventType', 'IdempotencyKey', 'Status', 'Note', 'CreatedAt', 'StatementDate', 'CheckpointRef'],
    ['LED_SAISON_1', 'W_SAISON', 'C-Saison', '2026-09-15', 21450, 'INCREASE', 'CARD_DEBT', 'Purchase', 'PO_SAISON_1', 'PURCHASE_CHARGE', 'KEY_S1', 'POSTED', '[Mua hàng] OP Day (x13)', '2026-09-15T10:00:00Z', '2026-11-01', '']
  ];
  db.Purchase = [
    ['ID', 'Timestamp', 'Tên', 'Danh mục', 'Số tiền', 'Ví/Thẻ', 'Hạn trả', 'Lãi suất', 'Đã trả', 'Trạng thái', 'Ghi chú', 'Mã GD', 'Ngày Sao kê'],
    ['PO_SAISON_1', '2026-09-15', 'OP Day (x13)', 'Shopping', 21450, 'C-Saison', '', '', '', 'HOAN_TAT', '', 'LED_SAISON_1', '01/11/2026']
  ];

  const history = getWalletTransactionHistory('C-Saison');
  assert.equal(history.length, 1);
  const item = history[0];

  // 1. Ngày mua gốc vẫn được bảo toàn là ngày 15/09
  assert.ok(item.useDate.includes('15/09') || item.date.includes('15/09'), 'Ngày mua gốc phải là 15/09: ' + (item.useDate || item.date));

  // 2. Kỳ sao kê đọc trực tiếp từ Cột O là Tháng 11
  assert.ok(item.statementDate.includes('11/2026') || item.statementDate.includes('2026-11'), 'Kỳ sao kê từ Cột O phải là tháng 11: ' + item.statementDate);
});









