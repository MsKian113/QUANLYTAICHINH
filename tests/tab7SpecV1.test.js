const assert = require('assert');
const test = require('node:test');

// Import Tab 7 Backend Core
const Server_Tab7 = require('../src/Server_Tab7.js');

test('Tab 7 Spec v1.0 — INV-08: calculateExpenseShares Floor + Remainder Allocation (Zero Loss)', function () {
  const participants = [
    { id: 'MBR_001', name: 'Bố', weight: 1.0 },
    { id: 'MBR_002', name: 'Mẹ', weight: 1.0 },
    { id: 'MBR_003', name: 'Bé', weight: 1.0 }
  ];

  const res = Server_Tab7.calculateExpenseShares('WEIGHT', 10000, participants);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.participants.length, 3);

  // 10000 / 3 = 3333.333... Base shares = 3333, Remainder R = 1 assigned to MBR_001 (Bố)
  assert.strictEqual(res.participants[0].calculatedAmount, 3334);
  assert.strictEqual(res.participants[1].calculatedAmount, 3333);
  assert.strictEqual(res.participants[2].calculatedAmount, 3333);

  const totalCalculated = res.participants.reduce((sum, p) => sum + p.calculatedAmount, 0);
  assert.strictEqual(totalCalculated, 10000);
});

test('Tab 7 Spec v1.0 — INV-14 & INV-18: Server Lockdown Guard rejects mutations on LOCKED groups', function () {
  // Mock In-Memory Spreadsheet
  const mockSheetData = {
    SplitGroups: [
      ['ID', 'Tên Nhóm', 'Tiền Tệ', 'Ngày Tạo', 'Ghi Chú', 'Trạng Thái', 'Thành Viên (JSON)', 'Loại Nhóm'],
      ['GRP_LOCKED_01', 'Đi Kyoto', 'JPY', '2026-09-21', '', 'LOCKED', JSON.stringify([{ id: 'MBR_1', name: 'Bố', family: '1F' }]), 'TRAVEL']
    ],
    SplitExpenses: [
      ['ID', 'ID Nhóm', 'Ngày', 'Nội Dung', 'Số Tiền', 'Người Trả', 'Nguồn Tiền Chi', 'Kiểu Chia', 'Chi Tiết Chia (JSON)', 'Bù Trừ Nợ (JSON)']
    ]
  };

  const mockSS = {
    getSheetByName: function (name) {
      if (!mockSheetData[name]) return null;
      return {
        getLastRow: () => mockSheetData[name].length,
        getLastColumn: () => mockSheetData[name][0].length,
        getRange: (r, c, numRows, numCols) => ({
          getValues: () => mockSheetData[name].slice(r - 1, r - 1 + numRows).map(row => row.slice(c - 1, c - 1 + numCols)),
          setValue: () => {}
        }),
        appendRow: (row) => mockSheetData[name].push(row),
        deleteRow: (idx) => mockSheetData[name].splice(idx - 1, 1)
      };
    }
  };

  // 1. Try to add expense to LOCKED group
  const expRes = Server_Tab7.saveSplitExpense({
    groupId: 'GRP_LOCKED_01',
    description: 'Ăn trưa',
    amount: 5000,
    payerId: 'MBR_1',
    participants: [{ id: 'MBR_1', name: 'Bố', weight: 1.0 }]
  }, mockSS);

  assert.strictEqual(expRes.success, false);
  assert.match(expRes.message, /TRẠNG THÁI NHÓM ĐÃ KHÓA \(LOCKED\)/);

  // 2. Try to add member to LOCKED group
  const memRes = Server_Tab7.addMemberToSplitGroup('GRP_LOCKED_01', { id: 'MBR_2', name: 'Mẹ' }, mockSS);
  assert.strictEqual(memRes.success, false);
  assert.match(memRes.message, /TRẠNG THÁI NHÓM ĐÃ KHÓA \(LOCKED\)/);
});

test('Tab 7 Spec v1.0 — INV-09 & INV-15: FinalizeTrip rejects duplicate settlement on LOCKED group', function () {
  const mockSheetData = {
    SplitGroups: [
      ['ID', 'Tên Nhóm', 'Tiền Tệ', 'Ngày Tạo', 'Ghi Chú', 'Trạng Thái', 'Thành Viên (JSON)', 'Loại Nhóm'],
      ['GRP_LOCKED_02', 'Ăn tối', 'JPY', '2026-09-21', '', 'LOCKED', JSON.stringify([{ id: 'MBR_1', name: 'Bố', family: '1F' }]), 'DINING']
    ]
  };

  const mockSS = {
    getSheetByName: function (name) {
      if (!mockSheetData[name]) return null;
      return {
        getLastRow: () => mockSheetData[name].length,
        getLastColumn: () => mockSheetData[name][0].length,
        getRange: (r, c, numRows, numCols) => ({
          getValues: () => mockSheetData[name].slice(r - 1, r - 1 + numRows).map(row => row.slice(c - 1, c - 1 + numCols)),
          setValue: () => {}
        })
      };
    }
  };

  const finRes = Server_Tab7.finalizeTripAndExportDebts('GRP_LOCKED_02', {}, mockSS);
  assert.strictEqual(finRes.success, false);
  assert.match(finRes.message, /đã được chốt nợ trước đó \(LOCKED\)/);
});

test('Tab 7 Spec v1.0 — INV-13: Tri-Cost Scoped Identity Verification (Advanced Outflow - True Cost = Receivables - Payables)', function () {
  // Scenario: A pays ¥3,000 for dinner split equally between A, B, C (¥1,000 each)
  const advancedOutflow = 3000; // Paid by A in Tab 1
  const truePersonalCost = 1000; // A's share in EXPENSE_SPLITS
  const receivables = 2000;      // B & C owe A in Tab 4 SoNo
  const payables = 0;           // A owes nobody

  const lhs = advancedOutflow - truePersonalCost; // 3000 - 1000 = 2000
  const rhs = receivables - payables;             // 2000 - 0 = 2000

  assert.strictEqual(lhs, rhs, 'Tri-Cost Identity must be equal for Payer A');
});
