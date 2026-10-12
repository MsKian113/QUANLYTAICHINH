const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Mock GAS globals
global.Logger = { log: () => {} };
global.Utilities = {
  formatDate: (date, tz, fmt) => {
    const d = date || new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
};
global.LockService = {
  getScriptLock: () => ({
    waitLock: () => true,
    releaseLock: () => true
  })
};

const ledgerEngine = require('../src/Server_FinancialLedger.js');

function createMockSS(initialData = {}) {
  const tables = {
    WalletLedger: initialData.WalletLedger || [
      [...ledgerEngine.LEDGER_HEADERS_16]
    ],
    WalletCheckpoints: initialData.WalletCheckpoints || [
      ['CheckpointID', 'WalletID', 'WalletName', 'CheckpointDate', 'Balance', 'CreatedAt', 'CreatedBy', 'Status']
    ],
    Wallets: initialData.Wallets || [
      ['ID', 'Tên Ví', 'Phân Loại', 'Hạn Mức', 'Ngày Chốt', 'Ngày Trả', 'Số Dư Ban Đầu', 'Số Dư Hiện Tại', 'CheckpointID', 'CheckpointDate', 'CheckpointBalance', 'Status', 'Ví Nguồn'],
      ['W_RESONA', 'Resona Bank', 'DEBIT', 0, '', '', 128462, 128462, '', '', '', 'SYNCED', ''],
      ['CC_RAKUTEN', 'Rakuten Card', 'CREDIT', 500000, '15', '27', 0, -45000, '', '', '', 'SYNCED', '']
    ],
    Family: initialData.Family || [
      ['ID', 'Ngày', 'Loại', 'Hũ', 'Nội dung', 'Số tiền', 'Nguồn tiền', 'Cố định', 'Ghi chú', 'Trạng thái', 'Ngày sao kê']
    ],
    Purchase: initialData.Purchase || [
      ['ID', 'Ngày', 'Mã Đơn', 'Trạng Thái Kho', 'Tên Sản Phẩm', 'Số Lượng', 'Đơn Giá', 'Tổng Tiền', 'Nguồn Tiền', 'Trạng Thái Thẻ', 'Ghi Chú', 'Shop', 'Ngày Sao Kê']
    ],
    Sales: initialData.Sales || [
      ['ID', 'Ngày', 'Tên Khách / Sản Phẩm', 'Số Lượng', 'Đơn Giá', 'Giảm Giá', 'Tổng Tiền', 'Kênh Bán', 'Nhận Tiền Vào', 'Trạng Thái']
    ],
    Debt: initialData.Debt || [
      ['ID', 'Ngày', 'Đối Tác', 'Phân Loại', 'Kỳ Hạn', 'Số Tiền', 'Ví Giao Dịch', 'Trạng Thái', 'Ghi Chú']
    ]
  };

  const sheets = {};
  function getOrCreateSheetObj(name) {
    if (!tables[name]) tables[name] = [];
    const rows = tables[name];
    return {
      getName: () => name,
      getLastRow: () => rows.length,
      getLastColumn: () => (rows[0] ? rows[0].length : 0),
      getRange: (startRow, startCol, numRows, numCols) => ({
        getValue: () => (rows[startRow - 1] && rows[startRow - 1][startCol - 1] !== undefined ? rows[startRow - 1][startCol - 1] : ""),
        getValues: function() {
          const slice = rows.slice(startRow - 1, startRow - 1 + numRows);
          return slice.map(r => {
            const copy = [...r];
            while (numCols && copy.length < (startCol - 1 + numCols)) {
              copy.push("");
            }
            return numCols ? copy.slice(startCol - 1, startCol - 1 + numCols) : copy;
          });
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
        setFontWeight: () => ({ setBackground: () => {} }),
        setBackground: () => {},
        clearContent: () => {
          rows.splice(startRow - 1, numRows);
        }
      }),
      appendRow: (rowArr) => {
        rows.push([...rowArr]);
      },
      deleteRow: (idx) => {
        rows.splice(idx - 1, 1);
      }
    };
  }

  return {
    getSheetByName: (n) => {
      if (!tables[n]) return null;
      if (!sheets[n]) sheets[n] = getOrCreateSheetObj(n);
      return sheets[n];
    },
    insertSheet: (n) => {
      tables[n] = [];
      sheets[n] = getOrCreateSheetObj(n);
      return sheets[n];
    },
    _rawTables: tables
  };
}

test('WalletLedger v2.0 - 16-Column Schema Initialization', () => {
  const ss = createMockSS();
  const sheet = ledgerEngine.getOrCreateLedgerSheet(ss);
  assert.ok(sheet, 'Sheet WalletLedger must be created');
  assert.equal(sheet.getLastRow(), 1);
  assert.equal(sheet.getLastColumn(), 16);
  assert.deepEqual(ss._rawTables.WalletLedger[0], ledgerEngine.LEDGER_HEADERS_16);
});

test('WalletLedger v2.0 - 8-Part IdempotencyKey Prevents Duplicate Writes while allowing multi-batch events', () => {
  const ss = createMockSS();

  // Post 1: Family Expense
  const res1 = ledgerEngine.postFinancialEvents([
    {
      walletId: 'W_RESONA',
      walletName: 'Resona Bank',
      date: '2026-10-09',
      amount: 3330,
      direction: 'OUT',
      effectType: 'CASH',
      sourceModule: 'Family',
      sourceId: 'TC_001',
      eventType: 'FAMILY_EXPENSE',
      note: 'Mua sắm siêu thị'
    }
  ], ss);

  assert.equal(res1.success, true);
  assert.equal(res1.postedCount, 1);

  // Post duplicate event again -> duplicateCount should be 1, postedCount 0
  const resDup = ledgerEngine.postFinancialEvents([
    {
      walletId: 'W_RESONA',
      walletName: 'Resona Bank',
      date: '2026-10-09',
      amount: 3330,
      direction: 'OUT',
      effectType: 'CASH',
      sourceModule: 'Family',
      sourceId: 'TC_001',
      eventType: 'FAMILY_EXPENSE',
      note: 'Mua sắm siêu thị'
    }
  ], ss);

  assert.equal(resDup.success, true);
  assert.equal(resDup.postedCount, 0);
  assert.equal(resDup.duplicateCount, 1);

  // Multi-person Trip Split: Same SourceID but different WalletID (A Huân vs Tuyết Anh) -> Both MUST be posted!
  const resTrip = ledgerEngine.postFinancialEvents([
    {
      walletId: 'P_AHUAN',
      walletName: 'A Huân',
      date: '2026-10-09',
      amount: 2000,
      direction: 'INCREASE',
      effectType: 'PARTNER_RECEIVABLE',
      sourceModule: 'TripSplit',
      sourceId: 'TRIP_01',
      paymentId: 'FINAL',
      eventType: 'SPLIT_RECEIVABLE_RECORD',
      note: 'A Huân nợ tiền chuyến đi'
    },
    {
      walletId: 'P_TUYETANH',
      walletName: 'Tuyết Anh',
      date: '2026-10-09',
      amount: 1500,
      direction: 'INCREASE',
      effectType: 'PARTNER_RECEIVABLE',
      sourceModule: 'TripSplit',
      sourceId: 'TRIP_01',
      paymentId: 'FINAL',
      eventType: 'SPLIT_RECEIVABLE_RECORD',
      note: 'Tuyết Anh nợ tiền chuyến đi'
    }
  ], ss);

  assert.equal(resTrip.success, true);
  assert.equal(resTrip.postedCount, 2, 'Both trip split members must be posted without collision');
});

test('WalletLedger v2.0 - In-Place Overwrite and Direct Deletion when Un-checkpointed', () => {
  const ss = createMockSS();

  // Create Checkpoint for Resona: 100,000¥
  ss._rawTables.WalletCheckpoints.push([
    'CP_01', 'W_RESONA', 'Resona Bank', '2026-10-01', 100000, new Date().toISOString(), 'User', 'ACTIVE'
  ]);

  // 1. Post transaction: 5,000¥ expense
  ledgerEngine.postFinancialEvents([
    {
      walletId: 'W_RESONA',
      walletName: 'Resona Bank',
      date: '2026-10-05',
      amount: 5000,
      direction: 'OUT',
      effectType: 'CASH',
      sourceModule: 'Family',
      sourceId: 'TC_TEST_REPLACE',
      eventType: 'FAMILY_EXPENSE',
      note: 'Ăn tối'
    }
  ], ss);

  // Check balance before edit: 100,000 - 5,000 = 95,000¥
  let balRes = ledgerEngine.getWalletBalancesFromLedger(null, null, ss);
  assert.equal(balRes.balances['resona bank'].currentBalance, 95000);
  assert.equal(ss._rawTables.WalletLedger.length, 2, 'Should have 1 header + 1 data row');

  // 2. Edit transaction in-place (Replace 5,000¥ -> 8,000¥)
  const replaceRes = ledgerEngine.replaceFinancialEvents('TC_TEST_REPLACE', [
    {
      walletId: 'W_RESONA',
      walletName: 'Resona Bank',
      date: '2026-10-05',
      amount: 8000,
      direction: 'OUT',
      effectType: 'CASH',
      sourceModule: 'Family',
      sourceId: 'TC_TEST_REPLACE',
      eventType: 'FAMILY_EXPENSE',
      note: 'Ăn tối sang chảnh'
    }
  ], 'Sửa số tiền', ss);

  assert.equal(replaceRes.success, true);
  assert.equal(replaceRes.replacedCount, 1);
  assert.equal(ss._rawTables.WalletLedger.length, 2, 'Must NOT create reversal REV- rows; must remain exactly 1 data row');

  const updatedRow = ss._rawTables.WalletLedger[1];
  assert.equal(updatedRow[4], 8000, 'Amount must be updated to 8000');
  assert.equal(updatedRow[12], 'Ăn tối sang chảnh', 'Note must be updated');
  assert.equal(updatedRow[11], 'POSTED', 'Status must remain POSTED');

  balRes = ledgerEngine.getWalletBalancesFromLedger(null, null, ss);
  assert.equal(balRes.balances['resona bank'].currentBalance, 92000, 'Balance must be 100,000 - 8,000 = 92,000¥');

  // 3. Delete transaction directly when un-checkpointed
  const revRes = ledgerEngine.reverseFinancialEvents('TC_TEST_REPLACE', 'Người dùng xóa giao dịch', ss);
  assert.equal(revRes.success, true);
  assert.equal(revRes.deletedCount, 1);
  assert.equal(ss._rawTables.WalletLedger.length, 1, 'Data row must be deleted directly; only header remains');

  // 4. Verify balance after deletion: must be restored to 100,000¥
  balRes = ledgerEngine.getWalletBalancesFromLedger(null, null, ss);
  assert.equal(balRes.balances['resona bank'].currentBalance, 100000, 'Balance must be restored to 100,000¥');
});

test('WalletLedger v2.0 - Checkpoint Audit Flagging (markCheckpointInLedger & Lock Enforcement)', () => {
  const ss = createMockSS();

  // 1. Post 2 transactions before checkpoint
  ledgerEngine.postFinancialEvents([
    {
      walletId: 'W_RESONA',
      walletName: 'Resona Bank',
      date: '2026-10-02',
      amount: 1000,
      direction: 'OUT',
      effectType: 'CASH',
      sourceModule: 'Family',
      sourceId: 'TC_PRE_CP_1',
      eventType: 'FAMILY_EXPENSE'
    },
    {
      walletId: 'W_RESONA',
      walletName: 'Resona Bank',
      date: '2026-10-03',
      amount: 2000,
      direction: 'OUT',
      effectType: 'CASH',
      sourceModule: 'Family',
      sourceId: 'TC_PRE_CP_2',
      eventType: 'FAMILY_EXPENSE'
    }
  ], ss);

  // 2. Perform Checkpoint on 2026-10-04 with balance 120,000¥
  const cpId = 'CP_RESONA_20261004';
  ss._rawTables.WalletCheckpoints.push([
    cpId, 'W_RESONA', 'Resona Bank', '2026-10-04', 120000, new Date().toISOString(), 'User', 'ACTIVE'
  ]);

  // Stamp CheckpointRef on un-checkpointed rows
  const markRes = ledgerEngine.markCheckpointInLedger('W_RESONA', 'Resona Bank', cpId, ss);
  assert.equal(markRes.success, true);
  assert.equal(markRes.markedCount, 2);

  // 3. Post a NEW transaction after checkpoint (2026-10-05)
  ledgerEngine.postFinancialEvents([
    {
      walletId: 'W_RESONA',
      walletName: 'Resona Bank',
      date: '2026-10-05',
      amount: 3000,
      direction: 'OUT',
      effectType: 'CASH',
      sourceModule: 'Family',
      sourceId: 'TC_POST_CP_1',
      eventType: 'FAMILY_EXPENSE'
    }
  ], ss);

  // 4. Calculate balance: Checkpoint (120,000) - Post-checkpoint event (3,000) = 117,000¥
  // Pre-checkpoint events (1,000 & 2,000) have CheckpointRef != '' so they MUST be skipped!
  const balRes = ledgerEngine.getWalletBalancesFromLedger(null, null, ss);
  assert.equal(balRes.balances['resona bank'].currentBalance, 117000);

  // 5. Try to delete a locked pre-checkpoint row -> MUST BE REJECTED!
  const lockRejectRes = ledgerEngine.reverseFinancialEvents('TC_PRE_CP_1', 'Cố tình xóa kỳ cũ', ss);
  assert.equal(lockRejectRes.success, false);
  assert.ok(lockRejectRes.message.includes('chốt sổ'), 'Mutation on locked checkpoint row must be rejected');
});

test('WalletLedger v2.0 - Double-Entry Debt Management (Receivables & Payables)', () => {
  const ss = createMockSS();

  // 1. Lend 10,000¥ to Partner A (CASH OUT + PARTNER_RECEIVABLE INCREASE)
  ledgerEngine.postFinancialEvents([
    {
      walletId: 'W_RESONA',
      walletName: 'Resona Bank',
      date: '2026-10-09',
      amount: 10000,
      direction: 'OUT',
      effectType: 'CASH',
      sourceModule: 'Debt',
      sourceId: 'DEBT_01',
      eventType: 'LEND_MONEY'
    },
    {
      walletId: 'P_PARTNER_A',
      walletName: 'Partner A',
      date: '2026-10-09',
      amount: 10000,
      direction: 'INCREASE',
      effectType: 'PARTNER_RECEIVABLE',
      sourceModule: 'Debt',
      sourceId: 'DEBT_01',
      eventType: 'LEND_MONEY'
    }
  ], ss);

  let partnerDebt = ledgerEngine.getPartnerDebtFromLedger(ss);
  assert.equal(partnerDebt.receivables['partner a'].total, 10000);
  assert.equal(partnerDebt.totalReceivable, 10000);

  // 2. Partial Loan Collection: Partner A returns 4,000¥ (CASH IN + PARTNER_RECEIVABLE DECREASE)
  ledgerEngine.postFinancialEvents([
    {
      walletId: 'W_RESONA',
      walletName: 'Resona Bank',
      date: '2026-10-10',
      amount: 4000,
      direction: 'IN',
      effectType: 'CASH',
      sourceModule: 'Debt',
      sourceId: 'DEBT_01',
      paymentId: 'PARTIAL_1',
      eventType: 'COLLECT_LOAN'
    },
    {
      walletId: 'P_PARTNER_A',
      walletName: 'Partner A',
      date: '2026-10-10',
      amount: 4000,
      direction: 'DECREASE',
      effectType: 'PARTNER_RECEIVABLE',
      sourceModule: 'Debt',
      sourceId: 'DEBT_01',
      paymentId: 'PARTIAL_1',
      eventType: 'COLLECT_LOAN'
    }
  ], ss);

  partnerDebt = ledgerEngine.getPartnerDebtFromLedger(ss);
  assert.equal(partnerDebt.receivables['partner a'].total, 6000, 'Remaining receivable must be 6,000¥');
  assert.equal(partnerDebt.totalReceivable, 6000);
});

test('WalletLedger v2.0 - Credit Card Debt Tracking & Card Refund', () => {
  const ss = createMockSS();

  // 1. Purchase on Credit Card: 25,000¥
  ledgerEngine.postFinancialEvents([
    {
      walletId: 'CC_RAKUTEN',
      walletName: 'Rakuten Card',
      date: '2026-10-05',
      amount: 25000,
      direction: 'INCREASE',
      effectType: 'CARD_DEBT',
      sourceModule: 'Purchase',
      sourceId: 'PO_101',
      eventType: 'PURCHASE_CARD_DEBT'
    }
  ], ss);

  let debtRes = ledgerEngine.getCardDebtFromLedger(null, null, ss);
  assert.equal(debtRes['rakuten card'].currentDebt, 25000);

  // 2. Card Settlement from Resona Bank: 20,000¥ (CASH OUT + CARD_DEBT DECREASE)
  ledgerEngine.postFinancialEvents([
    {
      walletId: 'W_RESONA',
      walletName: 'Resona Bank',
      date: '2026-10-06',
      amount: 20000,
      direction: 'OUT',
      effectType: 'CASH',
      sourceModule: 'Transfer',
      sourceId: 'SETTLE_01',
      eventType: 'CARD_PAYMENT'
    },
    {
      walletId: 'CC_RAKUTEN',
      walletName: 'Rakuten Card',
      date: '2026-10-06',
      amount: 20000,
      direction: 'DECREASE',
      effectType: 'CARD_DEBT',
      sourceModule: 'Transfer',
      sourceId: 'SETTLE_01',
      eventType: 'CARD_PAYMENT'
    }
  ], ss);

  debtRes = ledgerEngine.getCardDebtFromLedger(null, null, ss);
  assert.equal(debtRes['rakuten card'].currentDebt, 5000, 'Remaining card debt should be 5,000¥');

  // 3. Card Refund on cancelled order: 5,000¥
  ledgerEngine.postFinancialEvents([
    {
      walletId: 'CC_RAKUTEN',
      walletName: 'Rakuten Card',
      date: '2026-10-07',
      amount: 5000,
      direction: 'DECREASE',
      effectType: 'CARD_DEBT',
      sourceModule: 'Purchase',
      sourceId: 'PO_101_REFUND',
      eventType: 'PURCHASE_CARD_REFUND'
    }
  ], ss);

  debtRes = ledgerEngine.getCardDebtFromLedger(null, null, ss);
  assert.equal(debtRes['rakuten card'].currentDebt, 0, 'Card debt cleared to 0 after refund');
});

test('WalletLedger v2.0 - syncLedgerFromHistory Dry-Run & Reconciliation', () => {
  const ss = createMockSS({
    Family: [
      ['ID', 'Ngày', 'Loại', 'Hũ', 'Nội dung', 'Số tiền', 'Nguồn tiền', 'Cố định', 'Ghi chú', 'Trạng thái', 'Ngày sao kê'],
      ['TC01', '09/10/2026', 'Chi', 'Thiết yếu', 'Đi siêu thị', 3330, 'Resona Bank', '', '', 'HOAN_TAT', ''],
      ['TC02', '09/10/2026', 'Chi', 'Thiết yếu', 'Mua đồ ăn', 707, 'Resona Bank', '', '', 'HOAN_TAT', '']
    ],
    Wallets: [
      ['ID', 'Tên Ví', 'Phân Loại', 'Hạn Mức', 'Ngày Chốt', 'Ngày Trả', 'Số Dư Ban Đầu', 'Số Dư Hiện Tại'],
      ['W_RESONA', 'Resona Bank', 'DEBIT', 0, '', '', 128462, 124425]
    ]
  });

  // Dry-run mode
  const dryRes = ledgerEngine.syncLedgerFromHistory({ dryRun: true }, ss);
  assert.equal(dryRes.success, true);
  assert.equal(dryRes.dryRun, true);
  assert.equal(dryRes.totalEvents, 2);
  assert.equal(dryRes.report[0].difference, 0, 'Reconstructed balance (128,462 - 3,330 - 707 = 124,425) must match sheet balance 100%');
  assert.equal(dryRes.report[0].isMatched, true);

  // Commit mode
  const commitRes = ledgerEngine.syncLedgerFromHistory({ dryRun: false }, ss);
  assert.equal(commitRes.success, true);
  assert.equal(commitRes.postedCount, 2);
  assert.equal(ss._rawTables.WalletLedger.length, 3, 'WalletLedger must contain header + 2 posted events');
  assert.equal(ss._rawTables.WalletLedger[1][1], 'W_RESONA', 'WalletID in col B must be W_RESONA');
  assert.equal(ss._rawTables.WalletLedger[1][2], 'Resona Bank', 'WalletName in col C must be Resona Bank');
});

test('WalletLedger v2.0 - resolveWalletAndId & Accurate WalletID Population', () => {
  const ss = createMockSS({
    Wallets: [
      ['ID', 'Tên Ví', 'Phân Loại'],
      ['W01', 'Resona', 'DEBIT'],
      ['W02', 'Ufj KA', 'DEBIT'],
      ['CC_BIC', 'C- Bic Chi', 'CREDIT']
    ]
  });

  const maps = ledgerEngine.getWalletLookupMaps(ss);
  assert.equal(maps.nameToId['resona'], 'W01');
  assert.equal(maps.nameToId['ufj ka'], 'W02');
  assert.equal(maps.nameToId['c- bic chi'], 'CC_BIC');

  // Test resolveWalletAndId with various inputs
  const r1 = ledgerEngine.resolveWalletAndId('', 'Resona', maps, ss);
  assert.equal(r1.walletId, 'W01');
  assert.equal(r1.walletName, 'Resona');

  const r2 = ledgerEngine.resolveWalletAndId('W02', '', maps, ss);
  assert.equal(r2.walletId, 'W02');
  assert.equal(r2.walletName, 'Ufj KA');

  const r3 = ledgerEngine.resolveWalletAndId('', 'Bic C', maps, ss);
  assert.equal(r3.walletId, 'CC_BIC');
  assert.equal(r3.walletName, 'C- Bic Chi');

  // Passing wallet name in walletId field (common legacy mistake)
  const r4 = ledgerEngine.resolveWalletAndId('Ufj KA', 'Ufj KA', maps, ss);
  assert.equal(r4.walletId, 'W02');
  assert.equal(r4.walletName, 'Ufj KA');

  // Partner debt not in Wallets sheet
  const r5 = ledgerEngine.resolveWalletAndId('', 'Khách Nợ', maps, ss);
  assert.equal(r5.walletId, 'Khách Nợ');
  assert.equal(r5.walletName, 'Khách Nợ');
});

test('WalletLedger v2.0 - resolveWalletCanonicalName & parseSettlementDetails', () => {
  // 1. Test canonical mapping of various credit and debit aliases
  assert.equal(ledgerEngine.resolveWalletCanonicalName('Bic KA'), 'C- Bic KA');
  assert.equal(ledgerEngine.resolveWalletCanonicalName('Bic C'), 'C- Bic Chi');
  assert.equal(ledgerEngine.resolveWalletCanonicalName('Bic Chi'), 'C- Bic Chi');
  assert.equal(ledgerEngine.resolveWalletCanonicalName('Amazon'), 'C- Amazon');
  assert.equal(ledgerEngine.resolveWalletCanonicalName('Raku KA'), 'C- Raku KA');
  assert.equal(ledgerEngine.resolveWalletCanonicalName('Raku C'), 'C- Raku Chi');
  assert.equal(ledgerEngine.resolveWalletCanonicalName('Revo C'), 'RevoChi');
  assert.equal(ledgerEngine.resolveWalletCanonicalName('Ufj C'), 'Ufj Chi');
  assert.equal(ledgerEngine.resolveWalletCanonicalName('TCB'), 'Techcom');

  // 2. Test settlement string parsing
  const s1 = ledgerEngine.parseSettlementDetails('Tất toán thẻ Bic KA từ Ufj KA', 'Ufj KA');
  assert.equal(s1.cardName, 'C- Bic KA');
  assert.equal(s1.sourceWallet, 'Ufj KA');

  const s2 = ledgerEngine.parseSettlementDetails('Tất toán thẻ: Bic C từ Ufj Chi', 'Ufj Chi');
  assert.equal(s2.cardName, 'C- Bic Chi');
  assert.equal(s2.sourceWallet, 'Ufj Chi');

  const s3 = ledgerEngine.parseSettlementDetails('Tất toán Bic KA', 'Ufj KA');
  assert.equal(s3.cardName, 'C- Bic KA');
  assert.equal(s3.sourceWallet, 'Ufj KA');
});

test('WalletLedger v2.0 - October Reconciliation with Bic KA and Bic Chi Settlements', () => {
  const ss = createMockSS({
    Family: [
      ['ID', 'Ngày', 'Loại', 'Hũ', 'Nội dung', 'Số tiền', 'Nguồn tiền', 'Cố định', 'Ghi chú', 'Trạng thái', 'Ngày sao kê'],
      ['F_01', '05/10/2026', 'Chi', '----Tất toán thẻ', 'Tất toán thẻ Bic KA từ Ufj KA', 361000, 'Ufj KA', '', '', 'HOAN_TAT', ''],
      ['F_02', '05/10/2026', 'Chi', '----Tất toán thẻ', 'Tất toán thẻ: Bic C từ Ufj Chi', 291000, 'Ufj Chi', '', '', 'HOAN_TAT', '']
    ],
    Purchase: [
      ['ID', 'Ngày Mua', 'Danh Mục', 'Trạng Thái', 'Tên Sản Phẩm', 'Số Lượng', 'Đơn Giá', 'Tổng Tiền', 'Thẻ / Ví', 'Trạng Thái Thẻ', 'Ghi Chú', '', 'Ngày Sao Kê'],
      // 2 Pre-orders on Bic Chi (5,280 x 2)
      ['PO_01', '02/10/2026', 'Hàng', 'Chờ ship', 'Game Pokemon 1', 1, 5280, 5280, 'C- Bic Chi', 'PRE-ORDER', 'preorder', '', '02/10/2026'],
      ['PO_02', '03/10/2026', 'Hàng', 'Chờ ship', 'Game Pokemon 2', 1, 5280, 5280, 'C- Bic Chi', 'PRE-ORDER', 'preorder', '', '03/10/2026']
    ],
    Wallets: [
      ['ID', 'Tên Ví', 'Phân Loại', 'Hạn Mức', 'Ngày Chốt', 'Ngày Trả', 'Số Dư Ban Đầu', 'Số Dư Hiện Tại'],
      ['W_UFJ_KA', 'Ufj KA', 'DEBIT', 0, '', '', 702356, 341356],
      ['W_UFJ_CHI', 'Ufj Chi', 'DEBIT', 0, '', '', 1008592, 717592],
      ['CC_BIC_KA', 'C- Bic KA', 'CREDIT', 500000, '10', '27', 0, 0],
      ['CC_BIC_CHI', 'C- Bic Chi', 'CREDIT', 500000, '10', '27', 291000, 0]
    ]
  });

  const res = ledgerEngine.syncLedgerFromHistory({ dryRun: true, cutoverDate: '2026-10-01' }, ss);
  assert.equal(res.success, true);
  
  const bicKaReport = res.report.find(r => r.walletName === 'C- Bic KA');
  const bicChiReport = res.report.find(r => r.walletName === 'C- Bic Chi');
  const ufjKaReport = res.report.find(r => r.walletName === 'Ufj KA');
  const ufjChiReport = res.report.find(r => r.walletName === 'Ufj Chi');

  assert.ok(bicKaReport, 'C- Bic KA report must exist');
  assert.ok(bicChiReport, 'C- Bic Chi report must exist');
  assert.equal(bicKaReport.isMatched, true, 'C- Bic KA must match 100%');
  assert.equal(bicKaReport.reconstructedBalance, 0, 'C- Bic KA reconstructed balance must be 0');
  assert.equal(bicKaReport.difference, 0);

  assert.equal(bicChiReport.isMatched, true, 'C- Bic Chi must match 100%');
  assert.equal(bicChiReport.reconstructedBalance, 0, 'C- Bic Chi reconstructed balance must be 0');
  assert.equal(bicChiReport.difference, 0);

  assert.equal(ufjKaReport.isMatched, true, 'Ufj KA must match');
  assert.equal(ufjChiReport.isMatched, true, 'Ufj Chi must match');

  // Test commit and verify all written rows in WalletLedger have correct WalletID
  const commitRes = ledgerEngine.syncLedgerFromHistory({ dryRun: false, cutoverDate: '2026-10-01' }, ss);
  assert.equal(commitRes.success, true);
  
  const ledgerRows = ss._rawTables.WalletLedger.slice(1);
  assert.ok(ledgerRows.length > 0, 'Ledger rows must exist');
  ledgerRows.forEach(row => {
    const wId = row[1];
    const wName = row[2];
    assert.ok(wId, `WalletID must not be empty for row with name ${wName}`);
    if (wName === 'Ufj KA') assert.equal(wId, 'W_UFJ_KA');
    if (wName === 'Ufj Chi') assert.equal(wId, 'W_UFJ_CHI');
    if (wName === 'C- Bic KA') assert.equal(wId, 'CC_BIC_KA');
    if (wName === 'C- Bic Chi') assert.equal(wId, 'CC_BIC_CHI');
  });
});

test('runNightlyLedgerAudit - Detects discrepancies and logs PENDING_REVIEW without overwriting', (t) => {
  const ss = createMockSS({
    WalletLedger: [
      [...ledgerEngine.LEDGER_HEADERS_16],
      ['LED-1', 'W_RESONA', 'Resona Bank', '2026-10-01', 50000, 'IN', 'CASH', 'Family', 'F1', 'THU', 'IDEM_1', 'POSTED', '', '2026-10-01', '', ''],
      ['LED-2', 'W_RESONA', 'Resona Bank', '2026-10-02', 20000, 'OUT', 'CASH', 'Family', 'F2', 'CHI', 'IDEM_2', 'POSTED', '', '2026-10-02', '', '']
    ],
    WalletCheckpoints: [
      ['CheckpointID', 'WalletID', 'WalletName', 'CheckpointDate', 'Balance', 'CreatedAt', 'CreatedBy', 'Status']
    ],
    Wallets: [
      ['ID', 'Tên Ví', 'Phân Loại', 'Hạn Mức', 'Ngày Chốt', 'Ngày Trả', 'Số Dư Ban Đầu', 'Số Dư Hiện Tại'],
      // Resona Bank ledger balance is 30,000 (0 initial + 50,000 - 20,000). But Wallets sheet says 35,000 (+5000 discrepancy)
      ['W_RESONA', 'Resona Bank', 'DEBIT', 0, '', '', 0, 35000]
    ]
  });

  const auditRes = ledgerEngine.runNightlyLedgerAudit(ss);
  assert.equal(auditRes.success, true);
  assert.equal(auditRes.totalWallets, 1);
  assert.equal(auditRes.discrepanciesCount, 1);
  assert.equal(auditRes.issues.length, 1);
  assert.equal(auditRes.issues[0].walletName, 'Resona Bank');
  assert.equal(auditRes.issues[0].sheetBalance, 35000);
  assert.equal(auditRes.issues[0].ledgerBalance, 30000);
  assert.equal(auditRes.issues[0].discrepancy, 5000);
  assert.equal(auditRes.issues[0].status, 'PENDING_REVIEW');

  // Verify AuditLogs sheet has been created and populated
  const auditLogs = ss._rawTables.AuditLogs;
  assert.ok(auditLogs, 'AuditLogs sheet must exist');
  assert.equal(auditLogs.length, 2, 'AuditLogs must have header + 1 issue row');
  assert.equal(auditLogs[1][2], 'W_RESONA');
  assert.equal(auditLogs[1][7], 'PENDING_REVIEW');

  // Verify Wallets sheet was NOT blindly modified
  assert.equal(ss._rawTables.Wallets[1][7], 35000, 'Wallets sheet current balance must remain untouched');
});

test('WalletLedger v2.0 - 10 Sequential In-Place Edits Maintain Exactly 1 Ledger Row Without REV- Duplication', () => {
  const ss = createMockSS();

  // Create Checkpoint for Resona: 128,462¥
  ss._rawTables.WalletCheckpoints.push([
    'CP_01', 'W_RESONA', 'Resona Bank', '2026-10-01', 128462, new Date().toISOString(), 'User', 'ACTIVE'
  ]);

  // 1. Post initial transaction
  ledgerEngine.postFinancialEvents([
    {
      walletId: 'W_RESONA',
      walletName: 'Resona Bank',
      date: '2026-10-05',
      amount: 1000,
      direction: 'OUT',
      effectType: 'CASH',
      sourceModule: 'Family',
      sourceId: 'TC_EDIT_10X',
      eventType: 'FAMILY_EXPENSE',
      note: 'Lần 1'
    }
  ], ss);

  assert.equal(ss._rawTables.WalletLedger.length, 2, 'Initial post: 1 header + 1 row');

  // 2. Edit 10 times consecutively
  for (let i = 2; i <= 10; i++) {
    const editRes = ledgerEngine.replaceFinancialEvents('TC_EDIT_10X', [
      {
        walletId: 'W_RESONA',
        walletName: 'Resona Bank',
        date: '2026-10-05',
        amount: i * 1000,
        direction: 'OUT',
        effectType: 'CASH',
        sourceModule: 'Family',
        sourceId: 'TC_EDIT_10X',
        eventType: 'FAMILY_EXPENSE',
        note: `Lần ${i}`
      }
    ], `Sửa lần ${i}`, ss);

    assert.equal(editRes.success, true);
    assert.equal(ss._rawTables.WalletLedger.length, 2, `After edit #${i}, must still be exactly 1 data row!`);
    assert.equal(ss._rawTables.WalletLedger[1][4], i * 1000, `Amount must be ${i * 1000}`);
    assert.equal(ss._rawTables.WalletLedger[1][12], `Lần ${i}`);
    assert.equal(ss._rawTables.WalletLedger[1][11], 'POSTED');
  }

  // Verify final balance
  const balRes = ledgerEngine.getWalletBalancesFromLedger(null, null, ss);
  assert.equal(balRes.balances['resona bank'].currentBalance, 128462 - 10000);
});

test('validateWalletExists - Validates registered wallets and rejects unregistered sources', () => {
  const ss = createMockSS({
    Wallets: [
      ['ID', 'Tên Ví', 'Phân Loại'],
      ['W_01', 'Ufj KA', 'DEBIT'],
      ['W_02', 'Resona', 'DEBIT'],
      ['CC_01', 'C- Bic Chi', 'CREDIT']
    ]
  });

  // Valid wallets and aliases
  assert.equal(ledgerEngine.validateWalletExists('Ufj KA', ss), true);
  assert.equal(ledgerEngine.validateWalletExists('ufj ka', ss), true);
  assert.equal(ledgerEngine.validateWalletExists('W_01', ss), true);
  assert.equal(ledgerEngine.validateWalletExists('Resona', ss), true);
  assert.equal(ledgerEngine.validateWalletExists('C- Bic Chi', ss), true);
  assert.equal(ledgerEngine.validateWalletExists('Bic Chi', ss), true);
  assert.equal(ledgerEngine.validateWalletExists('bic chi', ss), true);
  assert.equal(ledgerEngine.validateWalletExists('c- bic chi', ss), true);

  // Invalid / unregistered wallets
  assert.equal(ledgerEngine.validateWalletExists('Ví không tồn tại', ss), false);
  assert.equal(ledgerEngine.validateWalletExists('Tài khoản ảo', ss), false);
  assert.equal(ledgerEngine.validateWalletExists('', ss), false);
  assert.equal(ledgerEngine.validateWalletExists(null, ss), false);
});

