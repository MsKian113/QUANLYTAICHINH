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
      ['ID', 'Tên', 'Phân loại', 'Hạn mức tín dụng', 'Ngày chốt sao kê', 'Ngày Đáo hạn', 'Số Dư Ban Đầu', 'THU', 'CHI', 'Preorder', 'Số Dư Hiện Tại', 'Ví nguồn', 'Checkpoint Date', '', 'Số thẻ', 'Ngày tháng hết hạn', 'CSV', 'Tên', 'Số thẻ', 'Ngày tháng hết hạn', 'CSV'],
      ['W001', 'C- Thẻ Rakuten', 'CREDIT', 500000, '15', '27', 0, 0, 50000, 0, -50000, '', '', '', '4111222233339012', '12/28', '888', 'RevoChi Virtual', '5412751234569999', '09/27', '321'],
      ['W002', 'Thẻ UFJ ATM', 'DEBIT', 0, '', '', 800000, 0, 0, 0, 800000, '', '', '', '', '', '', '', '', '', '']
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

test('saveCardSecurityDetails encrypts sensitive cols M..S in sheet and decrypts accurately', () => {
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
  // Verify encrypted in database (Sheet Col O, P, Q, R, S, T, U)
  const encNum = db.Wallets[1][14]; // Col O (15)
  const encExp = db.Wallets[1][15]; // Col P (16)
  const encCvv = db.Wallets[1][16]; // Col Q (17)
  assert.ok(encNum.startsWith('ENC:v1:'), 'Card number must be encrypted in sheet');
  assert.notEqual(encNum, '9999888877776666', 'Plain text card number must not exist in sheet');
  assert.ok(encExp.startsWith('ENC:v1:'), 'Card expiry must be encrypted in sheet');
  assert.ok(encCvv.startsWith('ENC:v1:'), 'Card CVV must be encrypted in sheet');
  assert.equal(db.Wallets[1][17], 'RevoChi Shopping'); // Col R (18) (vCardName non-sensitive)

  // Verify decryptCardField returns exact original values
  assert.equal(decryptCardField(encNum), '9999888877776666');
  assert.equal(decryptCardField(encExp), '11/30');
  assert.equal(decryptCardField(encCvv), '999');

  // Verify verifyCardPassword decrypts and reveals correctly
  const verifyRes = verifyCardPassword('25100311');
  assert.equal(verifyRes.success, true);
  assert.equal(verifyRes.cards[0].cardNumber, '9999888877776666');
  assert.equal(verifyRes.cards[0].cardCvv, '999');
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

test('encryptCardField & decryptCardField: semantic security, integrity and backward compatibility', () => {
  const original = '4111 2222 3333 4444';
  const enc1 = encryptCardField(original);
  const enc2 = encryptCardField(original);

  // Both should be encrypted with ENC:v1:
  assert.ok(enc1.startsWith('ENC:v1:'));
  assert.ok(enc2.startsWith('ENC:v1:'));
  // Different IV/salt produces different ciphertexts
  assert.notEqual(enc1, enc2);

  // Both decrypt to original
  assert.equal(decryptCardField(enc1), original);
  assert.equal(decryptCardField(enc2), original);

  // Backward compatibility: Unencrypted returns original string
  assert.equal(decryptCardField('12/28'), '12/28');
  assert.equal(decryptCardField('888'), '888');

  // Tampering detection: modified tag or ciphertext yields empty string
  const tampered = enc1.slice(0, -2) + (enc1.slice(-2) === 'aa' ? 'bb' : 'aa');
  assert.equal(decryptCardField(tampered), '');
});

test('t1_hashPassword & setCardCustomPassword: stores SHA-256 hash instead of plain text', () => {
  scriptProps = {};
  const setRes = setCardCustomPassword('mySecretPass123');
  assert.equal(setRes.success, true);

  // Script Properties should NOT have plain text
  assert.equal(scriptProps['CARD_CUSTOM_PWD'], undefined);
  // Script Properties MUST have CARD_CUSTOM_PWD_HASH
  assert.ok(scriptProps['CARD_CUSTOM_PWD_HASH']);
  assert.equal(scriptProps['CARD_CUSTOM_PWD_HASH'].length, 64); // SHA-256 hex length

  // Verification
  assert.equal(t1_isValidCardPassword('mySecretPass123'), true);
  assert.equal(t1_isValidCardPassword('wrongPass'), false);
  // Master password still works
  assert.equal(t1_isValidCardPassword('25100311'), true);
});

test('migrateEncryptExistingCards: automatically encrypts plain text cards in sheet in-place', () => {
  const db = createMockDB();
  // Row 2 has plain text '4111222233339012' at col O (14, 0-indexed)
  assert.equal(db.Wallets[1][14], '4111222233339012');
  assert.equal(db.Wallets[1][3], 500000); // Credit Limit
  assert.equal(db.Wallets[1][6], 0);      // Initial Balance

  const res = migrateEncryptExistingCards();
  assert.equal(res.success, true);
  assert.ok(res.count >= 1);

  // Financial columns MUST NOT be modified or encrypted
  assert.equal(db.Wallets[1][3], 500000, 'Credit limit must NOT be encrypted');
  assert.equal(db.Wallets[1][6], 0, 'Initial balance must NOT be encrypted');
  assert.equal(db.Wallets[1][17], 'RevoChi Virtual', 'Virtual card name must NOT be encrypted');

  // Now sensitive cells in db.Wallets must be encrypted!
  const cellVal = db.Wallets[1][14];
  assert.ok(cellVal.startsWith('ENC:v1:'));
  assert.notEqual(cellVal, '4111222233339012');

  // And decrypts back to original
  assert.equal(decryptCardField(cellVal), '4111222233339012');
  assert.equal(decryptCardField(db.Wallets[1][15]), '12/28');
  assert.equal(decryptCardField(db.Wallets[1][16]), '888');
  assert.equal(decryptCardField(db.Wallets[1][18]), '5412751234569999');
  assert.equal(decryptCardField(db.Wallets[1][19]), '09/27');
  assert.equal(decryptCardField(db.Wallets[1][20]), '321');
});

test('saveCardSecurityDetails matches correctly by card name when ID is absent or different', () => {
  const db = createMockDB();
  const payload = {
    password: '25100311',
    name: 'Rakuten', // Matches row 'C- Thẻ Rakuten' via stripped name
    cardNumber: '4111333344445555',
    cardExp: '01/30',
    cardCvv: '777'
  };

  const res = saveCardSecurityDetails(payload);
  assert.equal(res.success, true);
  // Verify row 2 (Rakuten) was updated, NOT row 3
  const encNum = db.Wallets[1][14]; // Col O (15)
  assert.ok(encNum.startsWith('ENC:v1:'));
  assert.equal(decryptCardField(encNum), '4111333344445555');
  assert.equal(decryptCardField(db.Wallets[1][15]), '01/30'); // Col P (16)
  assert.equal(decryptCardField(db.Wallets[1][16]), '777');   // Col Q (17)
  // Credit Limit (Col 3) must remain untouched at 500000
  assert.equal(db.Wallets[1][3], 500000);
});

test('saveCardSecurityDetails appends new row when card does not exist yet', () => {
  const db = createMockDB();
  const initialRowCount = db.Wallets.length;
  const payload = {
    password: '25100311',
    name: 'Thẻ JCB Vietnam',
    cardNumber: '3568123456789012',
    cardExp: '08/29',
    cardCvv: '432'
  };

  const res = saveCardSecurityDetails(payload);
  assert.equal(res.success, true);
  assert.equal(db.Wallets.length, initialRowCount + 1);
  const newRow = db.Wallets[db.Wallets.length - 1];
  assert.equal(newRow[1], 'Thẻ JCB Vietnam');
  assert.equal(newRow[2], 'CREDIT');
  assert.equal(decryptCardField(newRow[14]), '3568123456789012'); // Col O (15)
  assert.equal(decryptCardField(newRow[15]), '08/29');             // Col P (16)
  assert.equal(decryptCardField(newRow[16]), '432');               // Col Q (17)
});

test('verifyCardPassword strictly loads main card from Col O, P, Q and virtual card from Col R, S, T, U', () => {
  const db = createMockDB();
  const encNum = encryptCardField('4111999988887777');
  const encExp = encryptCardField('03/31');
  const encCvv = encryptCardField('654');
  
  // Wallets schema: Col A..N (indices 0..13), Col O..Q Main (14..16), Col R..U Virtual (17..20)
  db.Wallets.push([
    'W003', 'C- Thẻ Shinhan', 'CREDIT', 300000, '20', '05', 0, 0, 0, 0, '', '', '', '',
    encNum, encExp, encCvv, 'Shinhan VCard', encryptCardField('5412888877776666'), encryptCardField('04/30'), encryptCardField('111'), '', ''
  ]);

  const res = verifyCardPassword('25100311');
  assert.equal(res.success, true);
  const shinhanCard = res.cards.find(c => c.name === 'C- Thẻ Shinhan');
  assert.ok(shinhanCard, 'Shinhan card must be found');
  assert.equal(shinhanCard.cardNumber, '4111999988887777', 'Col O must strictly load main card number');
  assert.equal(shinhanCard.cardExp, '03/31', 'Col P must strictly load main card expiry');
  assert.equal(shinhanCard.cardCvv, '654', 'Col Q must strictly load main card CVV');
  assert.equal(shinhanCard.isVirtual, false, 'Main card must have isVirtual: false');

  const shinhanVCard = res.virtualCards.find(v => v.name === 'Shinhan VCard');
  assert.ok(shinhanVCard, 'Shinhan virtual card must be found in separate virtualCards list');
  assert.equal(shinhanVCard.cardNumber, '5412888877776666', 'Col S must load virtual card number');
  assert.equal(shinhanVCard.cardExp, '04/30', 'Col T must load virtual card expiry');
  assert.equal(shinhanVCard.cardCvv, '111', 'Col U must load virtual card CVV');
  assert.equal(shinhanVCard.isVirtual, true, 'Virtual card must have isVirtual: true');
});

test('saveCardSecurityDetails uses payload.row and returns updated card info payload', () => {
  const db = createMockDB();
  const payload = {
    password: '25100311',
    id: 'W001',
    row: 2,
    name: 'C- Thẻ Rakuten',
    cardNumber: '4111000011112222',
    cardExp: '07/32',
    cardCvv: '333'
  };

  const res = saveCardSecurityDetails(payload);
  assert.equal(res.success, true);
  assert.ok(res.card);
  assert.equal(res.card.cardNumber, '4111000011112222');
  assert.equal(res.card.row, 2);
  assert.equal(decryptCardField(db.Wallets[1][14]), '4111000011112222');
});


test('verifyCardPassword unlocks card details with reset password 25102101', () => {
  createMockDB();
  const res = verifyCardPassword('25102101');
  assert.equal(res.success, true);
  assert.equal(Array.isArray(res.cards), true);
  assert.equal(res.cards[0].name, 'C- Thẻ Rakuten');
});

test('changeCardPassword allows changing password using reset password 25102101 or current password', () => {
  createMockDB();
  scriptProps = {};

  // 1. Wrong old password fails
  const failRes = changeCardPassword({ oldOrResetPassword: 'wrongpassword', newPassword: 'newSecretPass1' });
  assert.equal(failRes.success, false);
  assert.match(failRes.message, /Mật khẩu hiện tại hoặc mật khẩu reset không chính xác/);

  // 2. Short new password fails
  const shortRes = changeCardPassword({ oldOrResetPassword: '25102101', newPassword: 'ab' });
  assert.equal(shortRes.success, false);
  assert.match(shortRes.message, /từ 3 ký tự trở lên/);

  // 3. Reset password 25102101 successfully sets new password
  const resetRes = changeCardPassword({ oldOrResetPassword: '25102101', newPassword: 'myCustomPass999' });
  assert.equal(resetRes.success, true);

  // 4. Verify new password works
  assert.equal(verifyCardPassword('myCustomPass999').success, true);

  // 5. Change password again using the newly set current password
  const changeRes = changeCardPassword({ oldOrResetPassword: 'myCustomPass999', newPassword: 'anotherPass888' });
  assert.equal(changeRes.success, true);
  assert.equal(verifyCardPassword('anotherPass888').success, true);
  assert.equal(verifyCardPassword('myCustomPass999').success, false);

  // 6. Reset password 25102101 ALWAYS still works to reset again
  const resetAgain = changeCardPassword('25102101', 'finalPass777');
  assert.equal(resetAgain.success, true);
  assert.equal(verifyCardPassword('finalPass777').success, true);
});

test('saveCardSecurityDetails supports adding DEBIT card with balance and encrypting sensitive fields', () => {
  const db = createMockDB();
  const initialRowCount = db.Wallets.length;
  const payload = {
    password: '25100311',
    name: 'Vietcombank ATM',
    type: 'DEBIT',
    balance: 1500000,
    cardNumber: '9704360012345678',
    cardExp: '10/30',
    cardCvv: '9999'
  };

  const res = saveCardSecurityDetails(payload);
  assert.equal(res.success, true);
  assert.equal(db.Wallets.length, initialRowCount + 1);
  const newRow = db.Wallets[db.Wallets.length - 1];
  assert.equal(newRow[1], 'Vietcombank ATM');
  assert.equal(newRow[2], 'DEBIT');
  assert.equal(newRow[6], 1500000); // Initial balance
  assert.equal(newRow[10], 1500000); // Current balance
  assert.equal(decryptCardField(newRow[14]), '9704360012345678');
  assert.equal(decryptCardField(newRow[15]), '10/30');
  assert.equal(decryptCardField(newRow[16]), '9999');
});

test('saveCardSecurityDetails supports adding CREDIT card with limit, cut, pay and encrypting sensitive fields', () => {
  const db = createMockDB();
  const initialRowCount = db.Wallets.length;
  const payload = {
    password: '25100311',
    name: 'C- Shinhan Platinum',
    type: 'CREDIT',
    limit: 300000,
    closingDate: 20,
    dueDate: 5,
    cardNumber: '4532012345678901',
    cardExp: '05/31',
    cardCvv: '777',
    vCardName: 'Shinhan Online',
    vCardNumber: '5311222233334444',
    vCardExp: '05/30',
    vCardCvv: '888'
  };

  const res = saveCardSecurityDetails(payload);
  assert.equal(res.success, true);
  assert.equal(db.Wallets.length, initialRowCount + 1);
  const newRow = db.Wallets[db.Wallets.length - 1];
  assert.equal(newRow[1], 'C- Shinhan Platinum');
  assert.equal(newRow[2], 'CREDIT');
  assert.equal(newRow[3], 300000); // Limit
  assert.equal(newRow[4], 20); // Closing date
  assert.equal(newRow[5], 5); // Due date
  assert.equal(decryptCardField(newRow[14]), '4532012345678901');
  assert.equal(decryptCardField(newRow[15]), '05/31');
  assert.equal(decryptCardField(newRow[16]), '777');
  assert.equal(newRow[17], 'Shinhan Online');
  assert.equal(decryptCardField(newRow[18]), '5311222233334444');
  assert.equal(decryptCardField(newRow[19]), '05/30');
  assert.equal(decryptCardField(newRow[20]), '888');
});

test('hideCardOrWallet marks Column N to DELETED without deleting row from sheet', () => {
  const db = createMockDB();
  const initialRowCount = db.Wallets.length;

  const res = hideCardOrWallet('W001');
  assert.equal(res.success, true);
  // Row count must NOT decrease (data preserved!)
  assert.equal(db.Wallets.length, initialRowCount);
  // Column N (index 13, col 14) must be set to 'DELETED'
  assert.equal(db.Wallets[1][13], 'DELETED');
});

test('getWalletsFromSheet detects Column N and flags is_hidden=true for deleted wallet', () => {
  const db = createMockDB();
  db.Wallets[1][13] = 'DELETED'; // Mark W001 as DELETED

  const res = getWalletsFromSheet('ALL', 'ALL', null, true);
  assert.equal(res.success, true);
  const w1 = res.wallets.find(w => w.id === 'W001');
  assert.ok(w1);
  assert.equal(w1.is_hidden, true);
  assert.equal(w1.status, 'DELETED');

  const w2 = res.wallets.find(w => w.id === 'W002');
  assert.ok(w2);
  assert.ok(!w2.is_hidden);
});

test('verifyCardPassword parses formatted credit_limit and flags Column N deleted status', () => {
  const db = createMockDB();
  db.Wallets[1][3] = '500,000 ¥'; // Formatted with commas and currency symbol
  db.Wallets[1][13] = 'DELETED';

  const res = verifyCardPassword('25100311');
  assert.equal(res.success, true);
  const card1 = res.cards.find(c => c.id === 'W001');
  assert.ok(card1);
  assert.equal(card1.credit_limit, 500000);
  assert.equal(card1.is_hidden, true);
  assert.equal(card1.status, 'DELETED');
});

test('saveCardSecurityDetails in MAIN mode updates only main card columns and preserves virtual card', () => {
  const db = createMockDB();
  // W001 has existing virtual card 'RevoChi Virtual' and number '5412751234569999'
  const res = saveCardSecurityDetails({
    password: '25100311',
    mode: 'MAIN',
    id: 'W001',
    name: 'C- Thẻ Rakuten',
    cardNumber: '9999888877776666',
    cardExp: '11/31',
    cardCvv: '999'
  });
  assert.equal(res.success, true);
  // Main card fields are updated
  assert.equal(decryptCardField(db.Wallets[1][14]), '9999888877776666');
  assert.equal(decryptCardField(db.Wallets[1][15]), '11/31');
  assert.equal(decryptCardField(db.Wallets[1][16]), '999');
  // Virtual card fields are preserved!
  assert.equal(db.Wallets[1][17], 'RevoChi Virtual');
  assert.equal(db.Wallets[1][18], '5412751234569999');
});

test('saveCardSecurityDetails in VIRTUAL mode updates only virtual card columns and preserves main card', () => {
  const db = createMockDB();
  const res = saveCardSecurityDetails({
    password: '25100311',
    mode: 'VIRTUAL',
    id: 'W001',
    name: 'C- Thẻ Rakuten',
    vCardName: 'REVO-VIP',
    vCardNumber: '1111222233334444',
    vCardExp: '01/30',
    vCardCvv: '123'
  });
  assert.equal(res.success, true);
  // Virtual card fields are updated
  assert.equal(db.Wallets[1][17], 'REVO-VIP');
  assert.equal(decryptCardField(db.Wallets[1][18]), '1111222233334444');
  assert.equal(decryptCardField(db.Wallets[1][19]), '01/30');
  assert.equal(decryptCardField(db.Wallets[1][20]), '123');
  // Main card fields remain unchanged!
  assert.equal(db.Wallets[1][14], '4111222233339012');
  assert.equal(db.Wallets[1][15], '12/28');
  assert.equal(db.Wallets[1][16], '888');
});

test('verifyCardPassword returns separate virtualCards array for virtual card lookup', () => {
  const db = createMockDB();
  const res = verifyCardPassword('25100311');
  assert.equal(res.success, true);
  assert.equal(res.cards.length, 2);
  assert.ok(Array.isArray(res.virtualCards));
  assert.equal(res.virtualCards.length, 1);
  const vc = res.virtualCards[0];
  assert.equal(vc.name, 'RevoChi Virtual');
  assert.equal(vc.cardNumber, '5412751234569999');
  assert.equal(vc.last4, '9999');
  assert.equal(vc.cardExp, '09/27');
  assert.equal(vc.cardCvv, '321');
  assert.equal(vc.isVirtual, true);
});

test('saveCardSecurityDetails in VIRTUAL mode saves standalone virtual card without mother card', () => {
  const db = createMockDB();
  const res = saveCardSecurityDetails({
    isAdd: true,
    isVirtual: true,
    mode: 'VIRTUAL',
    name: 'RevoChi Standalone 2026',
    vCardNumber: '4000123456788888',
    vCardExp: '05/29',
    vCardCvv: '777'
  });
  assert.equal(res.success, true);
  // Row 3 (index 2) had empty virtual card columns, now populated
  assert.equal(db.Wallets[2][17], 'RevoChi Standalone 2026');
  assert.equal(decryptCardField(db.Wallets[2][18]), '4000123456788888');
  assert.equal(decryptCardField(db.Wallets[2][19]), '05/29');
  assert.equal(decryptCardField(db.Wallets[2][20]), '777');
});

test('hideCardOrWallet clears virtual card columns when deleting a virtual card', () => {
  const db = createMockDB();
  const res = hideCardOrWallet({
    id: 'VC_2',
    name: 'RevoChi Virtual',
    isVirtual: true,
    mode: 'VIRTUAL',
    row: 2
  });
  assert.equal(res.success, true);
  // Virtual card cols are wiped
  assert.equal(db.Wallets[1][17], '');
  assert.equal(db.Wallets[1][18], '');
  assert.equal(db.Wallets[1][19], '');
  assert.equal(db.Wallets[1][20], '');
  // Main card cols remain intact
  assert.equal(db.Wallets[1][14], '4111222233339012');
});

test('Tab1.html displays main cards on top, virtual cards below, and virtual cards do not need statement templates', () => {
  const tab1Path = path.join(__dirname, '../src/Tab1.html');
  const content = fs.readFileSync(tab1Path, 'utf8');

  // 1. Phía trên hiển thị thẻ chính, phía dưới là thẻ ảo
  assert.ok(content.includes('💳 Thẻ Chính & Tài Khoản'), 'Main cards section header must exist on top');
  assert.ok(content.includes('✨ Danh Sách Thẻ Ảo'), 'Virtual cards section header must exist below');
  assert.ok(content.includes('+ Thêm Thẻ Ảo'), 'Add virtual card button must exist in virtual card section');

  // 2. Thẻ ảo không có liên kết thẻ mẹ, chỉ nhập để tra thông tin
  assert.ok(content.includes('Tên Thẻ Ảo'), 'Virtual card tab must use Tên Thẻ Ảo without requiring mother card');
  assert.ok(!content.includes('Thẻ Chính Liên Kết (Thẻ Mẹ)'), 'Mother card requirement must be completely removed');

  // 3. Thẻ ảo không cần mẫu sao kê
  assert.ok(content.includes("walletObj.isVirtual || walletObj.type === 'VIRTUAL'"), 'Virtual cards must be exempted in t1_getCardStatementStatus');

  // 4. Thẻ chính là thẻ chính, không có thẻ chính rồi thẻ ảo (modal tab container ẩn, không sinh chéo)
  assert.ok(content.includes('id="sec-modal-tab-container" class="hidden"'), 'Modal tab container must be hidden');
  assert.ok(!content.includes('w.vCardName || w.vCardLast4'), 'Wallets must not generate virtual cards');
  assert.ok(!content.includes('c.vCardName || c.vCardNumber'), 'Main cards must not generate virtual cards');
});

test('Virtual cards from R2 to the end of the sheet are fully loaded even when Column B is empty, and adding new virtual card writes to first empty row in Column R', () => {
  const db = createMockDB();
  // Row 4: has empty Column B (''), but has virtual card in Column R..U (row 4)
  db.Wallets.push([
    '', '', '', '', '', '', '', '', '', '', '', '', '', '',
    '', '', '', 'RevoChi Row 4', encryptCardField('4000888899991111'), encryptCardField('11/29'), encryptCardField('456'), '', ''
  ]);

  const res = verifyCardPassword('25100311');
  assert.equal(res.success, true);
  // Must find 'RevoChi Row 4' in res.virtualCards even though Column B is blank
  const v4 = res.virtualCards.find(v => v.name === 'RevoChi Row 4');
  assert.ok(v4, 'Virtual card on row 4 must be loaded even when Column B is blank');
  assert.equal(v4.row, 4);
  assert.equal(v4.cardNumber, '4000888899991111');
  assert.equal(v4.cardExp, '11/29');
  assert.equal(v4.cardCvv, '456');

  // Adding a new virtual card: Row 2 has 'RevoChi Virtual', Row 3 has empty Column R, Row 4 has 'RevoChi Row 4'
  // First empty row in Column R starting from R2 is Row 3!
  const addRes = saveCardSecurityDetails({
    isAdd: true,
    isVirtual: true,
    mode: 'VIRTUAL',
    name: 'New Virtual Card on Row 3',
    cardNumber: '5555444433332222',
    cardExp: '08/30',
    cardCvv: '999'
  });
  assert.equal(addRes.success, true);
  assert.equal(addRes.card.row, 3, 'Must pick row 3 as the first empty row in Column R starting from R2');
  assert.equal(db.Wallets[2][17], 'New Virtual Card on Row 3', 'Column R on row 3 must have new virtual card name');
  assert.equal(decryptCardField(db.Wallets[2][18]), '5555444433332222', 'Column S on row 3 must have card number');
});

test('getWalletsFromSheet returns virtualCards array loaded from Column R2 onwards', () => {
  const db = createMockDB();
  db.Wallets.push([
    '', '', '', '', '', '', '', '', '', '', '', '', '', '',
    '', '', '', 'RevoChi Standalone', encryptCardField('4000111122223333'), encryptCardField('05/29'), encryptCardField('777'), '', ''
  ]);

  const wRes = getWalletsFromSheet('All', 'All', global.SpreadsheetApp.getActiveSpreadsheet(), false);
  assert.equal(wRes.success, true);
  assert.ok(Array.isArray(wRes.virtualCards), 'wRes must have virtualCards array');
  assert.equal(wRes.virtualCards.length, 2, 'Must have 2 virtual cards (row 2 and row 4)');
  assert.equal(wRes.virtualCards[0].name, 'RevoChi Virtual');
  assert.equal(wRes.virtualCards[0].row, 2);
  assert.equal(wRes.virtualCards[1].name, 'RevoChi Standalone');
  assert.equal(wRes.virtualCards[1].row, 4);
});

test('saveCardSecurityDetails allows adding new card (UFJ mẹ) when Wallets sheet only has header row (lastRow < 2)', () => {
  const db = createMockDB();
  // Clear data rows so Wallets only has 1 header row (like a newly created tenant sheet)
  db.Wallets = [db.Wallets[0]];

  const payload = {
    isAdd: true,
    name: 'UFJ mẹ',
    type: 'DEBIT',
    balance: '0',
    cardNumber: '',
    cardExp: '',
    cardCvv: '',
    mode: 'MAIN'
  };

  const res = saveCardSecurityDetails(payload);
  assert.equal(res.success, true, 'Must succeed when adding new card to an empty Wallets sheet');
  assert.equal(db.Wallets.length, 2, 'Must append card to row 2');
  assert.equal(db.Wallets[1][1], 'UFJ mẹ');
  assert.equal(db.Wallets[1][2], 'DEBIT');
  assert.equal(db.Wallets[1][6], 0);
  assert.equal(db.Wallets[1][10], 0);
  assert.ok(Array.isArray(res.wallets), 'Should return fresh wallets array');
});

test('saveCardSecurityDetails auto-creates Wallets sheet when sheet does not exist yet', () => {
  const tables = {}; // No Wallets sheet exists!
  global.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({
      getSheetByName: (name) => {
        if (!tables[name]) return null;
        const rows = tables[name];
        return {
          getLastRow: () => rows.length,
          getLastColumn: () => (rows[0] ? rows[0].length : 0),
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
              getValue: () => (rows[startRow - 1] ? rows[startRow - 1][startCol - 1] : undefined),
              getValues: getVals,
              getDisplayValues: getVals,
              setValue: (val) => {
                if (!rows[startRow - 1]) rows[startRow - 1] = [];
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
          }
        };
      },
      insertSheet: (name) => {
        tables[name] = [];
        return global.SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
      }
    })
  };

  const payload = {
    isAdd: true,
    name: 'UFJ mẹ',
    type: 'DEBIT',
    balance: '10000',
    mode: 'MAIN'
  };

  const res = saveCardSecurityDetails(payload);
  assert.equal(res.success, true);
  assert.ok(tables.Wallets, 'Wallets sheet must be auto-created');
  assert.equal(tables.Wallets.length, 2, 'Headers row + new card row');
  assert.equal(tables.Wallets[1][1], 'UFJ mẹ');
  assert.equal(tables.Wallets[1][6], 10000);
});

test('t1_isValidCardPassword recognizes multi-tenant account password from sheet User (STien)', () => {
  const db = createMockDB();
  // Setup User sheet with STien account having personal password 'tienPass999'
  db.User = [
    ['Name', 'Username', 'Password', 'SpreadsheetID', 'Salt'],
    ['Kian', 'kian', 'kichukian', '1_lvyQlGzltyVKX-P9eAsxnN97ow0LNoCvbTh-1l-MBc', ''],
    ['Tiên', 'STien', 'tienPass999', '1qGvL8ZJ2W_I892S2gaBsAZTFNCSb6gCUsZhvYSma14E', '']
  ];

  // STien's password works for card operations
  assert.equal(t1_isValidCardPassword('tienPass999'), true, 'STien personal password must be recognized');
  assert.equal(t1_isValidCardPassword('randomWrongPassword'), false, 'Wrong password must be rejected');

  // When editing card with STien password, saveCardSecurityDetails succeeds
  const editPayload = {
    isAdd: false,
    id: 'W002',
    name: 'Thẻ UFJ ATM',
    password: 'tienPass999',
    cardNumber: '4111222233334444',
    cardExp: '11/30',
    cardCvv: '123'
  };
  const saveRes = saveCardSecurityDetails(editPayload);
  assert.equal(saveRes.success, true, 'Saving card security with STien password must succeed');
});

test('Card created as DEBIT strips C- prefix and remains DEBIT (never reverts to CREDIT)', () => {
  const db = createMockDB();
  
  // 1. STien adds new card: select dropdown Debit/Cash (type: DEBIT), name entered with or without C-
  const payload = {
    isAdd: true,
    id: 'W_SMBC_DEBIT',
    name: 'C- SMBC me', // user had C- from autoformat or typing
    type: 'DEBIT',
    balance: '50000',
    password: '25100311',
    mode: 'MAIN',
    cardNumber: '4111222233334444',
    cardExp: '12/28',
    cardCvv: '123'
  };

  const saveRes = saveCardSecurityDetails(payload);
  assert.equal(saveRes.success, true);
  assert.equal(saveRes.card.type, 'DEBIT');
  assert.equal(saveRes.card.name, 'SMBC me', 'C- prefix must be stripped when type is DEBIT');

  // Verify saved in sheet
  const addedRow = db.Wallets.find(r => r[0] === 'W_SMBC_DEBIT');
  assert.ok(addedRow, 'Row must exist in sheet Wallets');
  assert.equal(addedRow[1], 'SMBC me', 'Col B (name) must be SMBC me');
  assert.equal(addedRow[2], 'DEBIT', 'Col C (type) must be DEBIT');

  // 2. Load cards via verifyCardPassword -> must be DEBIT
  const verifyRes = verifyCardPassword('25100311');
  assert.equal(verifyRes.success, true);
  const smbcCard = verifyRes.cards.find(c => c.id === 'W_SMBC_DEBIT');
  assert.ok(smbcCard, 'Card must be found in verifyCardPassword');
  assert.equal(smbcCard.type, 'DEBIT', 'Loaded card type must remain DEBIT');
  assert.equal(smbcCard.name, 'SMBC me', 'Loaded card name must remain SMBC me');

  // 3. Update existing card to DEBIT: must strip C- prefix from sheet Col B and update Col C to DEBIT
  const editPayload = {
    isAdd: false,
    id: 'W001', // was 'C- Thẻ Rakuten' in mock DB
    name: 'C- Thẻ Rakuten',
    type: 'DEBIT',
    balance: '20000',
    password: '25100311',
    mode: 'MAIN'
  };
  const editRes = saveCardSecurityDetails(editPayload);
  assert.equal(editRes.success, true);
  assert.equal(editRes.card.type, 'DEBIT');
  assert.equal(editRes.card.name, 'Thẻ Rakuten', 'C- prefix must be stripped on edit to DEBIT');
  const w001Row = db.Wallets.find(r => r[0] === 'W001');
  assert.equal(w001Row[1], 'Thẻ Rakuten');
  assert.equal(w001Row[2], 'DEBIT');
});

test('Tab1.html client logic enforces Debit/Cash type and strips C- prefix', () => {
  const tab1Code = fs.readFileSync(path.join(__dirname, '../src/Tab1.html'), 'utf8');

  // 1. t1_onSecCardTypeChange must strip C- prefix when switching to Debit/Cash
  assert.ok(tab1Code.includes('nameInput.value.replace(/^C[-_\\s]+/i, \'\').trim()'), 't1_onSecCardTypeChange must strip C- prefix');

  // 2. openEditCardSecurityModal must respect card.type before name regex
  assert.ok(tab1Code.includes('const isCreditCard = card.type ? (String(card.type).toUpperCase() === \'CREDIT\') :'), 'isCreditCard in modal must prioritize card.type');

  // 3. submitCardSecurityDetails must strip C- when cardTypeVal is not CREDIT
  assert.ok(tab1Code.includes('cardTypeVal !== \'CREDIT\''), 'submitCardSecurityDetails must check cardTypeVal !== CREDIT');

  // 4. renderCardInfoList must prioritize c.type so DEBIT cards are never displayed as CREDIT
  assert.ok(tab1Code.includes('const isCredit = c.type ? (String(c.type).toUpperCase() === \'CREDIT\') :'), 'renderCardInfoList must prioritize c.type');
});
