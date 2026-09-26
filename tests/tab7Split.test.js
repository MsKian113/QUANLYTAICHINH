const test = require('node:test');
const assert = require('node:assert');

// Mock SpreadsheetApp Environment for Node.js Testing
class MockRange {
  constructor(data, startRow = 1, startCol = 1) {
    this.data = data;
    this.startRow = startRow;
    this.startCol = startCol;
  }
  getValues() {
    return this.data;
  }
  setValue(val) {
    if (this.data.length > 0 && this.data[0].length >= this.startCol) {
      this.data[0][this.startCol - 1] = val;
    }
  }
}

class MockSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
  }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.length > 0 ? this.rows[0].length : 0; }
  appendRow(rowArr) {
    this.rows.push(rowArr);
  }
  getRange(row, col, numRows, numCols) {
    const slice = this.rows.slice(row - 1, row - 1 + numRows).map(r => r.slice(col - 1, col - 1 + numCols));
    const range = new MockRange(slice, row, col);
    range.setValue = (val) => {
      this.rows[row - 1][col - 1] = val;
    };
    return range;
  }
  deleteRow(rowIdx) {
    this.rows.splice(rowIdx - 1, 1);
  }
}

class MockSpreadsheet {
  constructor() {
    this.sheets = {};
  }
  getSheetByName(name) {
    return this.sheets[name] || null;
  }
  insertSheet(name) {
    const s = new MockSheet(name);
    this.sheets[name] = s;
    return s;
  }
}

global.SpreadsheetApp = {
  db: null,
  getActiveSpreadsheet() {
    if (!this.db) this.db = new MockSpreadsheet();
    return this.db;
  }
};

global.saveDebtTransaction = function(payload) {
  const ss = global.SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Debt');
  if (!sheet) {
    sheet = ss.insertSheet('Debt');
    sheet.appendRow(['ID', 'Ngày Ghi Nợ', 'Tên Đối Tượng', 'Loại Nợ', 'Nội Dung', 'Tổng Tiền Nợ']);
  }
  sheet.appendRow(['DEBT_123', '2026-09-13', payload.ten, payload.nguon, payload.noidung, payload.sotien]);
  return { success: true };
};

global.saveFamilyTransaction = function(payload, ssTarget) {
  const ss = ssTarget || global.SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Family');
  if (!sheet) {
    sheet = ss.insertSheet('Family');
    sheet.appendRow(['ID', 'Timestamp', 'Loại', 'Hũ', 'Nội dung', 'Số tiền', 'Ví/Thẻ Giao Dịch']);
  }
  const loai = String(payload.loai || "CHI").toUpperCase() === "THU" ? "Thu" : "Chi";
  sheet.appendRow(['TC_123', payload.ngay, loai, payload.hu || '', payload.noidung, payload.sotien, payload.nguontien]);
  return { success: true };
};

const serverTab7 = require('../src/Server_Tab7.js');

test('Phase 2: getSplitGroupsSheetHelper creates sheet with headers if missing', () => {
  const ss = new MockSpreadsheet();
  const sheet = serverTab7.getSplitGroupsSheetHelper(ss);
  assert.notStrictEqual(sheet, null);
  assert.strictEqual(sheet.getLastRow(), 1);
  assert.strictEqual(sheet.rows[0][0], 'GroupID');
  assert.strictEqual(sheet.rows[0][2], 'GroupName');
  assert.strictEqual(sheet.rows[0][6], 'GroupMemberID');
});

test('Phase 2: saveSplitGroup creates a new group with members and family tags', () => {
  const ss = new MockSpreadsheet();
  const res = serverTab7.saveSplitGroup({
    name: 'Chuyến đi Hải Phòng',
    currency: 'JPY',
    note: 'Hè 2026',
    members: [
      { name: 'A1 (Bố)', family: 'Gia đình A', type: 'ADULT', isMe: true },
      { name: 'A2 (Mẹ)', family: 'Gia đình A', type: 'ADULT' },
      { name: 'A3 (Con)', family: 'Gia đình A', type: 'CHILD' },
      { name: 'B1', family: 'Gia đình B', type: 'ADULT' },
      { name: 'B2', family: 'Gia đình B', type: 'ADULT' }
    ]
  }, ss);

  assert.strictEqual(res.success, true);
  assert.ok(res.group.id.startsWith('GRP_'));
  assert.strictEqual(res.group.name, 'Chuyến đi Hải Phòng');
  assert.strictEqual(res.group.members.length, 5);

  const childMember = res.group.members.find(m => m.name === 'A3 (Con)');
  assert.strictEqual(childMember.type, 'CHILD');
  assert.strictEqual(childMember.weight, 0.5);
  assert.strictEqual(childMember.family, 'Gia đình A');
});

test('Phase 2: saveSplitGroup handles TRIP and DINING categories correctly', () => {
  const ss = new MockSpreadsheet();
  const tripRes = serverTab7.saveSplitGroup({
    name: 'Du lịch Phú Quốc',
    category: 'TRIP',
    members: [{ name: 'Anh A', family: 'Gia đình A', type: 'ADULT' }]
  }, ss);
  assert.strictEqual(tripRes.success, true);
  assert.strictEqual(tripRes.group.category, 'TRIP');

  const diningRes = serverTab7.saveSplitGroup({
    name: 'Lẩu nướng Haidilao',
    category: 'DINING',
    members: [{ name: 'Anh A', family: 'Gia đình A', type: 'ADULT' }]
  }, ss);
  assert.strictEqual(diningRes.success, true);
  assert.strictEqual(diningRes.group.category, 'DINING');

  const allGroups = serverTab7.getSplitGroups(ss);
  assert.strictEqual(allGroups.success, true);
  assert.strictEqual(allGroups.groups.length, 2);
  assert.strictEqual(allGroups.groups[0].category, 'TRIP');
  assert.strictEqual(allGroups.groups[1].category, 'DINING');
});

test('Phase 2: saveSplitGroup updates an existing group', () => {
  const ss = new MockSpreadsheet();
  const res1 = serverTab7.saveSplitGroup({
    name: 'Chuyến đi Hải Phòng',
    currency: 'JPY',
    members: [{ name: 'A1', family: 'Gia đình A', type: 'ADULT' }]
  }, ss);

  const groupId = res1.group.id;
  const res2 = serverTab7.saveSplitGroup({
    id: groupId,
    name: 'Chuyến đi Hải Phòng (Đã đổi tên)',
    currency: 'VND',
    members: [
      { name: 'A1', family: 'Gia đình A', type: 'ADULT' },
      { name: 'B1', family: 'Gia đình B', type: 'ADULT' }
    ]
  }, ss);

  assert.strictEqual(res2.success, true);
  assert.strictEqual(res2.group.name, 'Chuyến đi Hải Phòng (Đã đổi tên)');
  assert.strictEqual(res2.group.currency, 'VND');
  assert.strictEqual(res2.group.members.length, 2);

  const fetchRes = serverTab7.getSplitGroupById(groupId, ss);
  assert.strictEqual(fetchRes.success, true);
  assert.strictEqual(fetchRes.group.name, 'Chuyến đi Hải Phòng (Đã đổi tên)');
});

test('Phase 2: deleteSplitGroup deletes group and associated expenses', () => {
  const ss = new MockSpreadsheet();
  const res = serverTab7.saveSplitGroup({
    name: 'Nhóm Cần Xóa',
    members: [{ name: 'Test' }]
  }, ss);

  const groupId = res.group.id;
  const delRes = serverTab7.deleteSplitGroup(groupId, ss);
  assert.strictEqual(delRes.success, true);

  const fetchRes = serverTab7.getSplitGroupById(groupId, ss);
  assert.strictEqual(fetchRes.success, false);
});

/* ==================== PHASE 3 UNIT TESTS ==================== */

test('Phase 3: calculateExpenseShares (WEIGHT mode: 4 Adults 1.0, 2 Children 0.5 for ¥30,000)', () => {
  const participants = [
    { memberId: 'A1', name: 'A1', weight: 1.0 },
    { memberId: 'A2', name: 'A2', weight: 1.0 },
    { memberId: 'B1', name: 'B1', weight: 1.0 },
    { memberId: 'B2', name: 'B2', weight: 1.0 },
    { memberId: 'E1', name: 'E1', weight: 0.5 },
    { memberId: 'F1', name: 'F1', weight: 0.5 }
  ];

  const res = serverTab7.calculateExpenseShares('WEIGHT', 30000, participants);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.participants.length, 6);

  const a1 = res.participants.find(p => p.memberId === 'A1');
  const e1 = res.participants.find(p => p.memberId === 'E1');

  assert.strictEqual(a1.calculatedAmount, 6000);
  assert.strictEqual(e1.calculatedAmount, 3000);

  const totalSum = res.participants.reduce((sum, p) => sum + p.calculatedAmount, 0);
  assert.strictEqual(totalSum, 30000);
});

test('Phase 3: calculateExpenseShares (FIXED_KIDS_EQUAL_ADULT mode with CHILD and BABY)', () => {
  const participants = [
    { memberId: 'A1', name: 'A1', type: 'ADULT' },
    { memberId: 'A2', name: 'A2', type: 'ADULT' },
    { memberId: 'A3', name: 'A3', type: 'CHILD' },
    { memberId: 'A4', name: 'A4', type: 'BABY' }
  ];

  const res = serverTab7.calculateExpenseShares('FIXED_KIDS_EQUAL_ADULT', 30000, participants, { fixedChildAmount: 3000, fixedBabyAmount: 0 });
  assert.strictEqual(res.success, true);

  const a3 = res.participants.find(p => p.memberId === 'A3'); // CHILD
  const a4 = res.participants.find(p => p.memberId === 'A4'); // BABY
  const a1 = res.participants.find(p => p.memberId === 'A1'); // ADULT

  assert.strictEqual(a3.calculatedAmount, 3000);
  assert.strictEqual(a4.calculatedAmount, 0);
  assert.strictEqual(a1.calculatedAmount, 13500);

  const totalSum = res.participants.reduce((sum, p) => sum + p.calculatedAmount, 0);
  assert.strictEqual(totalSum, 30000);
});

test('Phase 3: calculateExpenseShares (FIXED_KIDS_EQUAL_ADULT mode with individual custom kid amounts)', () => {
  const participants = [
    { memberId: 'A1', name: 'A1', type: 'ADULT' },
    { memberId: 'A2', name: 'A2', type: 'ADULT' },
    { memberId: 'K1', name: 'Bé A', type: 'CHILD', customAmount: 100 },
    { memberId: 'K2', name: 'Bé B', type: 'CHILD', customAmount: 300 }
  ];

  const res = serverTab7.calculateExpenseShares('FIXED_KIDS_EQUAL_ADULT', 10000, participants, { fixedChildAmount: 3000 });
  assert.strictEqual(res.success, true);

  const k1 = res.participants.find(p => p.memberId === 'K1');
  const k2 = res.participants.find(p => p.memberId === 'K2');
  const a1 = res.participants.find(p => p.memberId === 'A1');
  const a2 = res.participants.find(p => p.memberId === 'A2');

  assert.strictEqual(k1.calculatedAmount, 100);
  assert.strictEqual(k2.calculatedAmount, 300);
  assert.strictEqual(a1.calculatedAmount, 4800);
  assert.strictEqual(a2.calculatedAmount, 4800);

  const totalSum = res.participants.reduce((sum, p) => sum + p.calculatedAmount, 0);
  assert.strictEqual(totalSum, 10000);
});

/* ==================== PHASE 4 UNIT TESTS ==================== */

test('Phase 4: calculateGroupBalances and calculateOptimalSettlements verify net-zero integrity & family consolidation', () => {
  const ss = new MockSpreadsheet();
  const gRes = serverTab7.saveSplitGroup({
    name: 'Hải Phòng Trip',
    members: [
      { id: 'MBR_A1', name: 'A1 (Bố)', family: 'Gia đình A', isMe: true, type: 'ADULT' },
      { id: 'MBR_A2', name: 'A2 (Mẹ)', family: 'Gia đình A', type: 'ADULT' },
      { id: 'MBR_B1', name: 'B1', family: 'Gia đình B', type: 'ADULT' },
      { id: 'MBR_B2', name: 'B2', family: 'Gia đình B', type: 'ADULT' }
    ]
  }, ss);
  const groupId = gRes.group.id;

  // Expense 1: Room ¥30,000 paid by A1, split equally among all 4
  serverTab7.saveSplitExpense({
    groupId: groupId,
    date: '2026-09-13',
    description: 'Tiền phòng',
    amount: 30000,
    payerId: 'MBR_A1',
    splitType: 'EQUAL',
    participants: [
      { memberId: 'MBR_A1', name: 'A1' },
      { memberId: 'MBR_A2', name: 'A2' },
      { memberId: 'MBR_B1', name: 'B1' },
      { memberId: 'MBR_B2', name: 'B2' }
    ]
  }, ss);

  const bRes = serverTab7.calculateGroupBalances(groupId, ss);
  assert.strictEqual(bRes.success, true);
  assert.strictEqual(bRes.isNetZero, true);

  const a1Bal = bRes.memberBalances.find(m => m.memberId === 'MBR_A1');
  assert.strictEqual(a1Bal.paid, 30000);
  assert.strictEqual(a1Bal.owed, 7500);
  assert.strictEqual(a1Bal.netBalance, 22500);

  const optRes = serverTab7.calculateOptimalSettlements(groupId, { consolidateByFamily: true }, ss);
  assert.strictEqual(optRes.success, true);
  assert.strictEqual(optRes.settlements.length, 1);
  assert.strictEqual(optRes.settlements[0].fromName.includes('Gia đình B'), true);
  assert.strictEqual(optRes.settlements[0].toName.includes('Gia đình A'), true);
  assert.strictEqual(optRes.settlements[0].amount, 15000);
});

test('Phase 4: finalizeTripAndExportDebts closes trip and exports net debts to Debt sheet', () => {
  const ss = new MockSpreadsheet();
  const gRes = serverTab7.saveSplitGroup({
    name: 'Chuyến Đi Chốt Nợ',
    members: [
      { id: 'MBR_A1', name: 'A1', family: 'Gia đình A', isMe: true },
      { id: 'MBR_B1', name: 'B1', family: 'Gia đình B' }
    ]
  }, ss);
  const groupId = gRes.group.id;

  serverTab7.saveSplitExpense({
    groupId: groupId,
    description: 'Tiền vé',
    amount: 10000,
    payerId: 'MBR_A1',
    splitType: 'EQUAL',
    participants: [{ memberId: 'MBR_A1' }, { memberId: 'MBR_B1' }]
  }, ss);

  const finRes = serverTab7.finalizeTripAndExportDebts(groupId, { consolidateByFamily: true }, ss);
  assert.strictEqual(finRes.success, true);
  assert.strictEqual(finRes.exportedCount, 1);

  const updatedGroup = serverTab7.getSplitGroupById(groupId, ss);
  assert.ok(updatedGroup.group.status === 'CLOSED' || updatedGroup.group.status === 'LOCKED');
});

test('Phase 4: getTab7FullGroupData returns bundled group, expenses, balances, and settlements in 1 call', () => {
  const ss = new MockSpreadsheet();
  const gRes = serverTab7.saveSplitGroup({
    name: 'Fast Load Group',
    members: [
      { id: 'MBR_A1', name: 'A1', family: 'Gia đình A', isMe: true },
      { id: 'MBR_B1', name: 'B1', family: 'Gia đình B' }
    ]
  }, ss);
  const groupId = gRes.group.id;

  serverTab7.saveSplitExpense({
    groupId: groupId,
    description: 'Ăn tối',
    amount: 8000,
    payerId: 'MBR_A1',
    splitType: 'EQUAL',
    participants: [{ memberId: 'MBR_A1' }, { memberId: 'MBR_B1' }]
  }, ss);

  const fullData = serverTab7.getTab7FullGroupData(groupId, ss);
  assert.strictEqual(fullData.success, true);
  assert.strictEqual(fullData.group.name, 'Fast Load Group');
  assert.strictEqual(fullData.expenses.length, 1);
  assert.strictEqual(fullData.memberBalances.length, 2);
  assert.strictEqual(fullData.settlements.length, 1);
});

test('Phase 4: 1F family debt target naming (A Huân -> 1F, Tuyết Anh -> Tuyết Anh)', () => {
  const ss = new MockSpreadsheet();

  // Scenario 1: Representative for 1F is A Huân
  const gRes1 = serverTab7.saveSplitGroup({
    name: 'Ăn tối cùng nhóm 1',
    members: [
      { id: 'MBR_ME', name: 'Tôi', family: 'Gia đình Tôi', isMe: true },
      { id: 'MBR_1F_HUAN', name: 'A Huân', family: '1F', sortOrder: 1 }
    ]
  }, ss);
  serverTab7.saveSplitExpense({
    groupId: gRes1.group.id,
    description: 'Ăn lẩu',
    amount: 10000,
    payerId: 'MBR_ME',
    splitType: 'EQUAL',
    participants: [{ memberId: 'MBR_ME' }, { memberId: 'MBR_1F_HUAN' }]
  }, ss);

  const optRes1 = serverTab7.calculateOptimalSettlements(gRes1.group.id, { consolidateByFamily: true }, ss);
  assert.strictEqual(optRes1.settlements[0].fromName, '1F');

  // Scenario 2: Representative for 1F is Tuyết Anh
  const gRes2 = serverTab7.saveSplitGroup({
    name: 'Ăn tối cùng nhóm 2',
    members: [
      { id: 'MBR_ME', name: 'Tôi', family: 'Gia đình Tôi', isMe: true },
      { id: 'MBR_1F_TA', name: 'Tuyết Anh', family: '1F', sortOrder: 1 }
    ]
  }, ss);
  serverTab7.saveSplitExpense({
    groupId: gRes2.group.id,
    description: 'Ăn lẩu',
    amount: 10000,
    payerId: 'MBR_ME',
    splitType: 'EQUAL',
    participants: [{ memberId: 'MBR_ME' }, { memberId: 'MBR_1F_TA' }]
  }, ss);

  const optRes2 = serverTab7.calculateOptimalSettlements(gRes2.group.id, { consolidateByFamily: true }, ss);
  assert.strictEqual(optRes2.settlements[0].fromName, 'Tuyết Anh');
});

test('Phase 1: saveSplitExpense logs [Ứng hộ nhóm] to Family sheet when ME pays with wallet', () => {
  const ss = new MockSpreadsheet();
  global.SpreadsheetApp.db = ss;
  const gRes = serverTab7.saveSplitGroup({
    name: 'Ăn cháo lòng',
    members: [
      { id: 'MBR_ME', name: 'Tôi', family: '2F', isMe: true },
      { id: 'MBR_3F', name: '3F', family: '3F' }
    ]
  }, ss);

  const res = serverTab7.saveSplitExpense({
    groupId: gRes.group.id,
    description: 'Cháo lòng',
    amount: 5500,
    payerId: 'MBR_ME',
    walletName: 'Thẻ Visa',
    splitType: 'EQUAL',
    participants: [{ memberId: 'MBR_ME' }, { memberId: 'MBR_3F' }]
  }, ss);

  assert.strictEqual(res.success, true);
  const famSheet = ss.getSheetByName('Family');
  assert.ok(famSheet);
  const rows = famSheet.rows;
  const expRow = rows.find(r => String(r[4]).includes('[Ứng hộ nhóm]'));
  assert.ok(expRow);
  assert.strictEqual(expRow[2], 'Chi');
  assert.strictEqual(expRow[3], ''); // Empty jar for Phase 1 outflow
  assert.strictEqual(expRow[5], 5500);
  assert.strictEqual(expRow[6], 'Thẻ Visa');
});

test('Phase 4: finalizeTripAndExportDebts appends family expense share into Family sheet for 2F family (Quậy - Chi - Chít)', () => {
  const ss = new MockSpreadsheet();
  global.SpreadsheetApp.db = ss;

  const gRes = serverTab7.saveSplitGroup({
    name: 'Ăn cháo lòng',
    category: 'DINING',
    members: [
      { id: 'MBR_2F_Q', name: 'Quậy', family: '2F', sortOrder: 1 },
      { id: 'MBR_2F_C', name: 'Chi', family: '2F', sortOrder: 2 },
      { id: 'MBR_2F_CT', name: 'Chít', family: '2F', type: 'CHILD', sortOrder: 3 },
      { id: 'MBR_1F_A', name: 'Bạn A', family: '1F', sortOrder: 4 }
    ]
  }, ss);

  const groupId = gRes.group.id;

  // Expense: 300,000 ¥ for 4 members equal split (75,000 each; 2F has 3 members = 225,000 ¥)
  serverTab7.saveSplitExpense({
    groupId: groupId,
    description: 'Ăn cháo lòng',
    amount: 300000,
    payerId: 'MBR_2F_Q',
    splitType: 'EQUAL',
    participants: [
      { memberId: 'MBR_2F_Q' },
      { memberId: 'MBR_2F_C' },
      { memberId: 'MBR_2F_CT' },
      { memberId: 'MBR_1F_A' }
    ]
  }, ss);

  const finRes = serverTab7.finalizeTripAndExportDebts(groupId, { consolidateByFamily: true }, ss);
  assert.strictEqual(finRes.success, true);

  const famSheet = ss.getSheetByName('Family');
  assert.ok(famSheet, 'Family sheet should exist');

  const rows = famSheet.rows;
  const loggedRow = rows.find(r => String(r[4]).includes('Ăn chơi : Ăn cháo lòng'));
  assert.ok(loggedRow, 'Logged row for Ăn chơi : Ăn cháo lòng should exist');
  assert.strictEqual(loggedRow[2], 'Chi');
  assert.strictEqual(loggedRow[3], 'Giải trí');
  assert.strictEqual(loggedRow[4], 'Ăn chơi : Ăn cháo lòng');
  assert.strictEqual(loggedRow[5], 225000); // 2F share (Quậy 75k + Chi 75k + Chít 75k = 225,000 ¥)
  assert.strictEqual(loggedRow[6], ''); // Nguồn tiền rỗng
});
