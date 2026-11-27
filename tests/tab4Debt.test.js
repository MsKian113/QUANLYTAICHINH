const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.Logger = { log: () => {} };
global.Utilities = {
  formatDate: (date, tz, fmt) => '2026-09-09'
};

function createMockTab4DB() {
  const tables = {
    Debt: [
      ['ID', 'Ngày Ghi Nợ', 'Tên Đối Tượng', 'Loại Nợ', 'Nội dung', 'Tổng Tiền Nợ', 'Nguồn', 'Đã Thanh Toán', 'Ngày thanh toán', 'Dư Nợ Còn Lại', 'Trạng Thái dư nợ', 'Trạng thái thẻ'],
      ['CN0001', '2026-09-01', 'Chị Kẹo', 'THU', 'Cho mượn tiền mặt', 100000, 'Ví Tiền Mặt', 0, '', 100000, 'DANG_NO', 'HOAN_TAT'],
      ['VN0001', '2026-09-02', 'Chị B', 'TRA', 'Mượn thẻ Amazon', 50000, 'Thẻ Rakuten', 0, '', 50000, 'DANG_NO', 'PRE-ORDER']
    ],
    Family: [
      ['ID', 'Timestamp', 'Loại', 'Hũ', 'Nội dung', 'Số tiền', 'Ví/Thẻ Giao Dịch', 'Là Khoản Cố Định?', 'Ghi chú', 'Trạng thái']
    ],
    Wallets: [
      ['ID', 'Tên Ví', 'Phân Loại', 'Hạn Mức', 'Ngày Chốt', 'Ngày Trả', 'Ban đầu', 'Tăng', 'Giảm', 'Hiện tại', 'Ví nguồn'],
      ['W001', 'Ví Tiền Mặt', 'DEBIT', 0, '', '', 300000, 0, 0, 300000, '']
    ],
    Categories: [
      ['Tên Mẫu', 'Hũ', 'Ví']
    ]
  };

  global.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({
      insertSheet: (name) => {
        tables[name] = [];
        return global.SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
      },
      getSheetByName: (name) => {
        if (!tables[name]) return null;
        const rows = tables[name];
        return {
          getLastRow: () => rows.length,
          getLastColumn: () => rows[0] ? rows[0].length : 11,
          getRange: (startRow, startCol, numRows, numCols) => ({
            getValues: () => rows.slice(startRow - 1, startRow - 1 + numRows),
            getDisplayValues: () => rows.slice(startRow - 1, startRow - 1 + numRows),
            setValue: (val) => {
              if (rows[startRow - 1]) rows[startRow - 1][startCol - 1] = val;
            },
            setValues: (vals) => {
              for (let i = 0; i < vals.length; i++) {
                const targetIdx = startRow - 1 + i;
                if (!rows[targetIdx]) rows[targetIdx] = [];
                for (let j = 0; j < vals[i].length; j++) {
                  rows[targetIdx][startCol - 1 + j] = vals[i][j];
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

const serverTab1Code = fs.readFileSync(path.join(__dirname, '../src/Server_Tab1.js'), 'utf8');
eval(serverTab1Code);

const serverTab4Code = fs.readFileSync(path.join(__dirname, '../src/Server_Tab4.js'), 'utf8');
eval(serverTab4Code);

// -------------------------------------------------------------
// TDD TESTS FOR TAB 4 DEBT OPERATIONS
// -------------------------------------------------------------
test('getTab4Data calculates summary totals and parses debt items', () => {
  const db = createMockTab4DB();
  const res = getTab4Data();

  assert.equal(res.success, true);
  assert.equal(res.summary.receivables, 100000);
  assert.equal(res.summary.payables, 50000);
  assert.equal(res.summary.net, 50000);
  assert.equal(res.debts.length, 2);
  assert.equal(res.allDebts.length, 2);
});

test('saveDebtTransaction appends a new debt transaction row', () => {
  const db = createMockTab4DB();
  const res = saveDebtTransaction({
    id: 'CN0002',
    ngay: '2026-09-09',
    ten: 'Anh A',
    loai: 'THU',
    noidung: 'Tăng cường',
    sotien: 30000,
    nguon: 'Ví Tiền Mặt'
  });

  assert.equal(res.success, true);
  assert.equal(db.Debt.length, 4);
  assert.equal(db.Debt[3][2], 'Anh A');
  assert.equal(db.Debt[3][5], 30000);
});

test('saveDebtTransaction creates separate rows for multi-person input separated by commas', () => {
  const db = createMockTab4DB();
  const res = saveDebtTransaction({
    ngay: '2026-09-09',
    ten: 'Nam, Hùng, Dũng',
    loai: 'THU',
    noidung: 'Ăn trưa BBQ',
    sotien: 15000,
    nguon: 'Ví Tiền Mặt'
  });

  assert.equal(res.success, true);
  assert.equal(db.Debt.length, 6); // 3 original rows (header + 2 rows) + 3 new rows
  assert.equal(db.Debt[3][2], 'Nam');
  assert.equal(db.Debt[3][5], 15000);
  assert.equal(db.Debt[4][2], 'Hùng');
  assert.equal(db.Debt[4][5], 15000);
  assert.equal(db.Debt[5][2], 'Dũng');
  assert.equal(db.Debt[5][5], 15000);
});

test('settleDebtPayment updates debt payment and remaining balance to HOAN_TAT', () => {
  const db = createMockTab4DB();
  const res = settleDebtPayment({
    ids: ['CN0001'],
    amount: 100000,
    date: '2026-09-09',
    sourceWallet: 'Ví Tiền Mặt',
    name: 'Chị Kẹo'
  });

  assert.equal(res.success, true);
  assert.equal(db.Debt[1][7], 100000); // Đã thanh toán
  assert.equal(db.Debt[1][9], 0);      // Dư nợ còn lại
  assert.equal(db.Debt[1][10], 'DA_TRA');
});

test('settleSelectedNetDebtPayment clears selected THU and TRA items and calculates net balance', () => {
  const db = createMockTab4DB();
  // CN0001: THU 100,000 ¥ for Chị Kẹo
  // VN0001: TRA 50,000 ¥ for Chị B
  const res = settleSelectedNetDebtPayment({
    partnerName: 'Chị Kẹo',
    thuIds: ['CN0001'],
    traIds: ['VN0001'],
    date: '2026-09-09',
    sourceWallet: 'Ví Tiền Mặt'
  });

  assert.equal(res.success, true);
  assert.equal(res.netAmount, 50000); // 100k - 50k = +50k net receive
  assert.equal(db.Debt[1][10], 'DA_TRA'); // CN0001
  assert.equal(db.Debt[2][10], 'DA_TRA'); // VN0001
});

test('deleteDebtRecord removes debt row by ID', () => {
  const db = createMockTab4DB();
  const res = deleteDebtRecord('VN0001');

  assert.equal(res.success, true);
  assert.equal(db.Debt.length, 2);
  assert.ok(!db.Debt.some(r => r[0] === 'VN0001'));
});

test('settleDebtPayment for TRA debt (Quậy nợ đối tác - tổng âm) sets direction: OUT in WalletLedger and updates sheet Debt', () => {
  const db = createMockTab4DB();
  let capturedLedgerEvents = [];
  global.postFinancialEvents = (evs) => { capturedLedgerEvents = evs; };

  // VN0001 is TRA debt: 50,000 ¥ (Quậy đang nợ Chị B)
  const res = settleDebtPayment({
    ids: ['VN0001'],
    amount: 50000,
    date: '2026-10-28',
    sourceWallet: 'Ví Tiền Mặt',
    name: 'Chị B',
    type: 'TRA'
  });

  assert.equal(res.success, true);
  assert.equal(res.targetType, 'TRA');

  // Kiểm tra Sheet Debt: Cột 8 (Đã thanh toán), Cột 10 (Dư nợ), Cột 11 (Trạng thái)
  assert.equal(db.Debt[2][7], 50000); // Đã thanh toán = 50,000
  assert.equal(db.Debt[2][9], 0);     // Dư nợ còn lại = 0
  assert.equal(db.Debt[2][10], 'DA_TRA'); // Trạng thái = DA_TRA

  // Kiểm tra WalletLedger: Direction PHẢI LÀ OUT (tiền ra khỏi ví)
  assert.equal(capturedLedgerEvents.length, 1);
  assert.equal(capturedLedgerEvents[0].direction, 'OUT');
  assert.equal(capturedLedgerEvents[0].eventType, 'REPAY_LOAN');
  assert.equal(capturedLedgerEvents[0].amount, 50000);
});

test('settleDebtPayment for row without ID in Col A matches via MANUAL_i/ROW_r, assigns ID and updates sheet Debt', () => {
  const db = createMockTab4DB();
  let capturedLedgerEvents = [];
  global.postFinancialEvents = (evs) => { capturedLedgerEvents = evs; };

  // Thêm dòng nợ thủ công không có ID ở Cột A (index 0 là '')
  db.Debt.push(['', '2026-10-20', 'Anh Nam', 'TRA', 'Mượn tiền mặt', 30000, 'Ví Tiền Mặt', 0, '', 30000, 'DANG_NO', 'HOAN_TAT']);
  // Dòng này có index trong data là 2 (tương ứng row 4 trong sheet, MANUAL_2)

  const res = settleDebtPayment({
    ids: ['MANUAL_2'], // ID tạm từ getTab4Data
    amount: 30000,
    date: '2026-10-28',
    sourceWallet: 'Ví Tiền Mặt',
    name: 'Anh Nam'
  });

  assert.equal(res.success, true);
  assert.equal(res.targetType, 'TRA');

  // Kiểm tra dòng trong Sheet Debt đã được cập nhật
  const row = db.Debt[3];
  assert.ok(row[0].startsWith('CN'), 'Phải tự động cấp mã ID mới cho dòng rỗng ID');
  assert.equal(row[7], 30000);  // Đã thanh toán
  assert.equal(row[9], 0);      // Dư nợ còn lại
  assert.equal(row[10], 'DA_TRA'); // Trạng thái

  // WalletLedger phải ghi nhận OUT
  assert.equal(capturedLedgerEvents[0].direction, 'OUT');
  assert.equal(capturedLedgerEvents[0].eventType, 'REPAY_LOAN');
});

test('lockDebtsBatch locks debts and prevents delete and edit', () => {
  const db = createMockTab4DB();
  
  // 1. Chốt khoản nợ CN0001
  const lockRes = lockDebtsBatch(['CN0001']);
  assert.equal(lockRes.success, true);
  assert.equal(lockRes.lockedCount, 1);
  assert.equal(db.Debt[1][10], 'DA_CHOT');

  // 2. Thử xóa khoản nợ đã chốt -> phải bị từ chối
  const delRes = deleteDebtRecord('CN0001');
  assert.equal(delRes.success, false);
  assert.ok(delRes.message.includes('chốt đối soát') || delRes.message.includes('không được phép xóa'));
  assert.equal(db.Debt.length, 3); // Dòng nợ vẫn còn nguyên vẹn trong DB

  // 3. Thử sửa khoản nợ đã chốt -> phải bị từ chối
  const editRes = saveDebtTransaction({
    id: 'CN0001',
    ten: 'Chị Kẹo Sửa',
    loai: 'THU',
    sotien: 999999,
    ngay: '2026-09-01'
  });
  assert.equal(editRes.success, false);
  assert.ok(editRes.message.includes('chốt đối soát') || editRes.message.includes('không được phép chỉnh sửa'));
});
