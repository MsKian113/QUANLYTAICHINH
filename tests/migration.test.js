const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.Logger = { log: () => {} };

const migrationCode = fs.readFileSync(path.join(__dirname, '../src/Server_Migration.js'), 'utf8');
eval(migrationCode);

test('cleanLegacyMoney parses currency strings correctly', () => {
  assert.equal(cleanLegacyMoney('¥13.400'), 13400);
  assert.equal(cleanLegacyMoney('¥1.500'), 1500);
  assert.equal(cleanLegacyMoney('¥150.000'), 150000);
  assert.equal(cleanLegacyMoney('¥1.000.000'), 1000000);
  assert.equal(cleanLegacyMoney('¥0'), 0);
});

test('mapLegacyWallet preserves raw legacy wallet names exactly', () => {
  assert.equal(mapLegacyWallet('Tiền mặt'), 'Tiền mặt');
  assert.equal(mapLegacyWallet('Ufj Chi'), 'Ufj Chi');
  assert.equal(mapLegacyWallet('C- Raku Chi'), 'C- Raku Chi');
  assert.equal(mapLegacyWallet('Resona'), 'Resona');
});

test('parseLegacyRow routes family expense, business, and debt rows correctly', () => {
  // Sample 1: Family expense
  const row1 = ['TC2607035', '26/06/2026', 'Chi', 'Giải trí', 'Quần áo', 'Ufj Chi', 'Dép cho Chít', '¥1.500', '', '06/2026'];
  const res1 = parseLegacyRow(row1);
  assert.equal(res1.target, 'FAMILY');
  assert.equal(res1.data.hu, 'Giải trí');
  assert.equal(res1.data.sotien, 1500);
  assert.equal(res1.data.nguontien, 'Ufj Chi');

  // Sample 2: Business purchase from TC table
  const row2 = ['TC2607034', '05/07/2026', 'Chi', 'Kinh doanh', 'Dép nike 28 đen', 'Ufj Chi', 'DT2607018 - Dép nike 28 đen', '¥13.400', 'DT2607018', '07/2026'];
  const res2 = parseLegacyRow(row2);
  assert.equal(res2.target, 'BUSINESS');
  assert.equal(res2.data.amount, 13400);

  // Sample 3: Debt advance from TC table
  const row3 = ['TC2607038', '27/06/2026', 'Chi', '-----Công nợ', 'PThu - Ứng - 1F', 'Tiền mặt', 'Ăn vịt nướng', '¥2.160', 'CN2607002', '06/2026'];
  const res3 = parseLegacyRow(row3);
  assert.equal(res3.target, 'DEBT');
  assert.equal(res3.data.amount, 2160);

  // Sample 4: Bảng Kinh Doanh MUA row
  const rowDT1 = ['DT01004', '01/01/2026', 'MUA', 'Fukuoka  28/02/2026', 'Công nợ', '2F', '3', '¥2.640', '', '', 'Tồn', '', '3'];
  const resDT1 = parseLegacyRow(rowDT1);
  assert.equal(resDT1.target, 'BUSINESS_TABLE');
  assert.equal(resDT1.data.loai, 'MUA');
  assert.equal(resDT1.data.buyPrice, 2640);
  assert.equal(resDT1.data.qty, 3);

  // Sample 5: Bảng Công Nợ row
  const rowCN1 = ['CN01005', '31/12/2025', 'PTrả - Mượn TM', 'Mẹ', 'Tiền mua nhà', 'Tiền mặt', '¥2.000.000', 'Chưa TT', '', 'Tồn'];
  const resCN1 = parseLegacyRow(rowCN1);
  assert.equal(resCN1.target, 'DEBT_TABLE');
  assert.equal(resCN1.data.partner, 'Mẹ');
  assert.equal(resCN1.data.amount, 2000000);
  assert.equal(resCN1.data.isDone, false);
});

test('importLegacyTSVData parses multiline TSV sample from user', () => {
  const sampleTSV = `TC2607032\t05/07/2026\tChi\t-----Tất toán thẻ\tC- Bic Chi\tUfj Chi\tTat toan the 7/2026\t¥0\t\t
TC2607034\t05/07/2026\tChi\tKinh doanh\tDép nike 28 đen\tUfj Chi\tDT2607018 - Dép nike 28 đen\t¥13.400\tDT2607018\t07/2026
TC2607035\t26/06/2026\tChi\tGiải trí\tQuần áo\tUfj Chi\tDép cho Chít\t¥1.500\t\t06/2026
TC2607036\t04/07/2026\tChi\t-----CK nội bộ\tRút tiền\tUfj Chi\t\t¥150.000\t\t07/2026
TC2607037\t04/07/2026\tThu\t-----CK nội bộ\tNạp tiền\tRevoChi\t\t¥150.000\tTC2607036\t07/2026
TC2607038\t27/06/2026\tChi\t-----Công nợ\tPThu - Ứng - 1F\tTiền mặt\tĂn vịt nướng\t¥2.160\tCN2607002\t06/2026
TC2607048\t06/07/2026\tChi\tThiết yếu\tSinh hoạt - Siêu thị\tTiền mặt\t\t¥1.658\t\t07/2026
TC2607089\t25/07/2026\tThu\t-----Thu nhập\tChủ động - Lương KA\tUfj KA\tDinh ky 7/2026\t¥217.732\t\t
ID\tNgày\tLoại\tMặt hàng\tNguồn\tVị trí -TT\tSL\tGiá mua\tGiá bán\tNgày TT\tLink TC\tLãi/Lỗ (¥)\tTồn
DT01001\t31/12/2025\tBÁN\tMega Hồng\tCông nợ\tĐã TT\t2\t¥2.350\t¥3.000\t02/02/26\tTồn\t¥1.300\t0
DT01004\t01/01/2026\tMUA\tFukuoka  28/02/2026\tCông nợ\t2F\t3\t¥2.640\t\t\tTồn\t\t3
ID\tNgày\tLoại Nợ\tĐối Tượng\tNội Dung\tNguồn\tSố Tiền\tTrạng Thái\tNgày TT\tLink TC
CN01005\t31/12/2025\tPTrả - Mượn TM\tMẹ\tTiền mua nhà\tTiền mặt\t¥2.000.000\tChưa TT\t\tTồn
CN04003\t06/04/2026\tPThu - Ứng\tTuyết Anh\tTA: Sữa 2 hộp\tTiền mặt\t¥643\tChưa TT\t\tTC04010`;

  const tables = {};
  const mockSS = {
    insertSheet: (name) => {
      tables[name] = [];
      return mockSS.getSheetByName(name);
    },
    getSheetByName: (name) => {
      if (!tables[name]) tables[name] = [];
      const rows = tables[name];
      return {
        getLastRow: () => rows.length,
        appendRow: (r) => rows.push(r),
        getRange: (startRow, startCol, numRows, numCols) => ({
          setValues: (vals) => {
            vals.forEach(v => rows.push(v));
          }
        })
      };
    }
  };

  const res = importLegacyTSVData(sampleTSV, mockSS);
  assert.equal(res.success, true);
  assert.equal(res.details.countFamily > 0, true);
  assert.equal(res.details.countBusiness > 0, true);
  assert.equal(res.details.countDebt > 0, true);
});
