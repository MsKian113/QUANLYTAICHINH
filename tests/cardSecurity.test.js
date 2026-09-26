const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.Logger = { log: () => {} };
global.Utilities = {
  formatDate: (date, tz, fmt) => '2026-09-20 00:00:00'
};

let scriptProps = {};
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => scriptProps[k] || null,
    setProperty: (k, v) => { scriptProps[k] = v; }
  })
};

function createMockDB() {
  const tables = {
    Wallets: [
      ['ID', 'Tên Ví', 'Phân Loại', 'Hạn Mức', 'Ngày Chốt', 'Ngày Trả', 'Số Dư Ban Đầu', 'Tăng', 'Giảm', 'Số Dư Hiện Tại', 'Ví Nguồn', 'Số Thẻ Chính', 'HSD Thẻ Chính', 'CVV Thẻ Chính', 'Tên Thẻ Ảo', 'Số Thẻ Ảo', 'HSD Thẻ Ảo', 'CVV Thẻ Ảo'],
      ['W001', 'C- Thẻ Rakuten', 'CREDIT', 500000, '15', '27', 0, 0, 50000, -50000, '', '4111222233339012', '12/28', '888', 'RevoChi Virtual', '5412751234569999', '09/27', '321'],
      ['W002', 'Thẻ UFJ ATM', 'DEBIT', 0, '', '', 800000, 0, 0, 800000, '', '', '', '', '', '', '', '']
    ]
  };

  global.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({
      getSheetByName: (name) => {
        if (!tables[name]) return null;
        const rows = tables[name];
        return {
          getLastRow: () => rows.length,
          getLastColumn: () => rows[0].length,
          getRange: (startRow, startCol, numRows, numCols) => {
            const getVals = () => {
              const res = [];
              for (let i = 0; i < numRows; i++) {
                const r = rows[startRow - 1 + i] || [];
                res.push(r.slice(startCol - 1, startCol - 1 + numCols));
              }
              return res;
            };
            return {
              getValues: getVals,
              getDisplayValues: getVals,
              setValue: (val) => {
                rows[startRow - 1][startCol - 1] = val;
              },
              setValues: (vals) => {
                for (let i = 0; i < vals.length; i++) {
                  for (let j = 0; j < vals[i].length; j++) {
                    if (!rows[startRow - 1 + i]) rows[startRow - 1 + i] = [];
                    rows[startRow - 1 + i][startCol - 1 + j] = vals[i][j];
                  }
                }
              }
            };
          },
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

test('verifyCardPassword rejects wrong password', () => {
  createMockDB();
  const res = verifyCardPassword('123456');
  assert.equal(res.success, false);
  assert.equal(res.message, '❌ Mật khẩu không đúng!');
});

test('verifyCardPassword unlocks card details with correct password 25100311', () => {
  createMockDB();
  const res = verifyCardPassword('25100311');
  assert.equal(res.success, true);
  assert.equal(Array.isArray(res.cards), true);
  assert.equal(res.cards.length, 2);
  assert.equal(res.cards[0].name, 'C- Thẻ Rakuten');
  assert.equal(res.cards[0].cardNumber, '4111222233339012');
  assert.equal(res.cards[0].vCardName, 'RevoChi Virtual');
});

test('verifyCardPassword unlocks card details with quick password kichukian', () => {
  createMockDB();
  const res = verifyCardPassword('kichukian');
  assert.equal(res.success, true);
  assert.equal(Array.isArray(res.cards), true);
  assert.equal(res.cards.length, 2);
  assert.equal(res.cards[0].name, 'C- Thẻ Rakuten');
});

test('setting custom pattern password overrides default sample gestures', () => {
  createMockDB();
  scriptProps = {};
  
  // Before setting custom password, default gesture 12369 works
  assert.equal(verifyCardPassword('1-2-3-6-9').success, true);
  
  // Set new custom pattern 1-5-9
  const setRes = setCardCustomPassword('1-5-9');
  assert.equal(setRes.success, true);
  
  // Now drawing new pattern 1-5-9 succeeds
  assert.equal(verifyCardPassword('1-5-9').success, true);
  assert.equal(verifyCardPassword('159').success, true);
  
  // Drawing old sample gesture 1-2-3-6-9 or random gesture 1-4-7 NOW FAILS!
  assert.equal(verifyCardPassword('1-2-3-6-9').success, false);
  assert.equal(verifyCardPassword('1-4-7').success, false);
  
  // Master password 25100311 ALWAYS still works
  assert.equal(verifyCardPassword('25100311').success, true);
});

test('saveCardSecurityDetails updates cols L..R in sheet', () => {
  const db = createMockDB();
  const payload = {
    password: '25100311',
    id: 'W001',
    cardNumber: '9999888877776666',
    cardExp: '11/30',
    cardCvv: '999',
    vCardName: 'RevoChi Shopping',
    vCardNumber: '1111222233334444',
    vCardExp: '05/29',
    vCardCvv: '555'
  };

  const res = saveCardSecurityDetails(payload);
  assert.equal(res.success, true);
  assert.equal(db.Wallets[1][11], '9999888877776666'); // Col L (12th, 0-indexed 11)
  assert.equal(db.Wallets[1][14], 'RevoChi Shopping'); // Col O (15th, 0-indexed 14)
});

test('card filtering by last digits (endsWith) accurately isolates card', () => {
  const cards = [
    { name: 'C- Amazon', cardNumber: '1111 2222 3333 8648', vCardName: 'REVO-003', vCardNumber: '5555 6666 7777 3669' },
    { name: 'Thẻ Rakuten', cardNumber: '4111 2222 3333 9012', vCardName: '', vCardNumber: '' },
    { name: 'Thẻ UFJ', cardNumber: '5412 6481 2222 9999', vCardName: '', vCardNumber: '' } // 648 in middle, last is 9999
  ];

  function filterCards(rawQ) {
    const qClean = rawQ.toLowerCase();
    const qDigits = rawQ.replace(/\D/g, '');

    return cards.filter(c => {
      const nameClean = String(c.name || '').toLowerCase();
      const vNameClean = String(c.vCardName || '').toLowerCase();
      const numClean = String(c.cardNumber || '').replace(/\D/g, '');
      const vNumClean = String(c.vCardNumber || '').replace(/\D/g, '');
      const mainLast4 = numClean.slice(-4);
      const vLast4 = vNumClean.slice(-4);

      if (nameClean.includes(qClean) || vNameClean.includes(qClean)) return true;
      if (qDigits && qDigits.length >= 2) {
        if ((mainLast4 && mainLast4.includes(qDigits)) || (vLast4 && vLast4.includes(qDigits))) return true;
        if (numClean.endsWith(qDigits) || vNumClean.endsWith(qDigits)) return true;
        if (qDigits.length >= 6 && (numClean.includes(qDigits) || vNumClean.includes(qDigits))) return true;
      }
      return false;
    });
  }

  // Searching '648' must match ONLY C- Amazon (ends with 8648) and NOT Thẻ UFJ (where 648 is in middle)
  const res648 = filterCards('648');
  assert.equal(res648.length, 1);
  assert.equal(res648[0].name, 'C- Amazon');

  // Searching '3669' matches C- Amazon (ends with 3669)
  const res3669 = filterCards('3669');
  assert.equal(res3669.length, 1);
  assert.equal(res3669[0].name, 'C- Amazon');

  // Searching 'Rakuten' matches Thẻ Rakuten
  const resRakuten = filterCards('Rakuten');
  assert.equal(resRakuten.length, 1);
  assert.equal(resRakuten[0].name, 'Thẻ Rakuten');
});
