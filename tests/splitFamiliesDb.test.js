const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const Server_Tab7 = require(path.join(__dirname, '../src/Server_Tab7.js'));

// Mock Google Spreadsheet Service
function createMockSpreadsheet() {
  const sheets = {};

  return {
    getSheetByName(name) {
      return sheets[name] || null;
    },
    insertSheet(name) {
      const rows = [];
      const sheet = {
        name: name,
        appendRow(rowArr) {
          rows.push(rowArr);
        },
        deleteRow(rowIdx) {
          if (rowIdx >= 1 && rowIdx <= rows.length) {
            rows.splice(rowIdx - 1, 1);
          }
        },
        deleteColumns(colIdx, count) {
          rows.forEach(r => {
            if (r.length >= colIdx) {
              r.splice(colIdx - 1, count);
            }
          });
        },
        getLastRow() {
          return rows.length;
        },
        getLastColumn() {
          return rows.length > 0 ? rows[0].length : 0;
        },
        getRange(startRow, startCol, numRows, numCols) {
          const nRows = numRows !== undefined ? numRows : 1;
          const nCols = numCols !== undefined ? numCols : 1;
          return {
            getValues() {
              const res = [];
              for (let r = startRow - 1; r < startRow - 1 + nRows; r++) {
                const row = rows[r] || [];
                const rowRes = [];
                for (let c = startCol - 1; c < startCol - 1 + nCols; c++) {
                  rowRes.push(row[c] !== undefined ? row[c] : "");
                }
                res.push(rowRes);
              }
              return res;
            },
            setValue(val) {
              while (rows.length < startRow) rows.push([]);
              while (rows[startRow - 1].length < startCol) rows[startRow - 1].push("");
              rows[startRow - 1][startCol - 1] = val;
            },
            setValues(vals) {
              for (let r = 0; r < vals.length; r++) {
                const targetR = startRow - 1 + r;
                while (rows.length <= targetR) rows.push([]);
                for (let c = 0; c < vals[r].length; c++) {
                  const targetC = startCol - 1 + c;
                  while (rows[targetR].length <= targetC) rows[targetR].push("");
                  rows[targetR][targetC] = vals[r][c];
                }
              }
            },
            clearContent() {
              for (let r = startRow - 1; r < startRow - 1 + nRows; r++) {
                if (rows[r]) {
                  for (let c = startCol - 1; c < startCol - 1 + nCols; c++) {
                    rows[r][c] = "";
                  }
                }
              }
            }
          };
        }
      };
      sheets[name] = sheet;
      return sheet;
    }
  };
}

test('SplitFamilies: Sheet creation auto-seeds default sample families when empty', () => {
  const ss = createMockSpreadsheet();
  const sheet = Server_Tab7.getSplitFamiliesSheetHelper(ss);
  assert.ok(sheet);
  assert.equal(sheet.getLastRow(), 6); // 1 header row + 5 seed rows

  const res = Server_Tab7.getSplitFamilies(ss);
  assert.equal(res.success, true);
  assert.equal(res.families.length, 2); // 2 default families (2F and Gia đình Tuyết Anh)
});

test('SplitFamilies: saveSplitFamilyBatch uses 8 columns, FAM-xxxxx, MEB-xxxxx and toggles repstatus true/false', () => {
  const ss = createMockSpreadsheet();

  const batchRes = Server_Tab7.saveSplitFamilyBatch({
    family_name: '2F',
    is_me: true,
    members: [
      { name: 'Quậy', type: 'ADULT', weight: 1.0, isRep: false },
      { name: 'Chi', type: 'ADULT', weight: 1.0, isRep: true },
      { name: 'Chít', type: 'CHILD', weight: 0.5, isRep: false }
    ]
  }, ss);

  assert.equal(batchRes.success, true);
  const fam = batchRes.families.find(f => f.family_name === '2F');
  assert.ok(fam);
  assert.equal(fam.isMe, true);
  assert.ok(fam.family_id.startsWith('FAM-'));
  assert.equal(fam.repMember.member_name, 'Chi');

  const chi = fam.members.find(m => m.member_name === 'Chi');
  assert.ok(chi.member_id.startsWith('MEB-'));
  assert.equal(chi.isRep, true);
  assert.equal(chi.repstatus, true);
  assert.equal(chi.isMe, true);

  const quay = fam.members.find(m => m.member_name === 'Quậy');
  assert.ok(quay.member_id.startsWith('MEB-'));
  assert.equal(quay.isRep, false);
  assert.equal(quay.repstatus, false);
  assert.equal(quay.isMe, true);

  const chit = fam.members.find(m => m.member_name === 'Chít');
  assert.ok(chit.member_id.startsWith('MEB-'));
  assert.equal(chit.isRep, false);
  assert.equal(chit.repstatus, false);
  assert.equal(chit.isMe, true);

  // Check 8-column sheet row values
  const sheetObj = ss.getSheetByName('SplitFamilies');
  const allRows = sheetObj.getRange(2, 1, sheetObj.getLastRow() - 1, 8).getValues();
  const quayRow = allRows.find(r => r[3] === 'Quậy');
  const chiRow = allRows.find(r => r[3] === 'Chi');
  const chitRow = allRows.find(r => r[3] === 'Chít');
  assert.equal(quayRow[7], false); // Quậy repstatus = false (col 8, index 7)
  assert.equal(chiRow[7], true);   // Chi repstatus = true (col 8, index 7)
  assert.equal(chitRow[7], false); // Chít repstatus = false (col 8, index 7)

  // Switch representative from Chi to Quậy
  const batchRes3 = Server_Tab7.saveSplitFamilyBatch({
    family_name: '2F',
    is_me: true,
    members: [
      { name: 'Quậy', type: 'ADULT', weight: 1.0, isRep: true },
      { name: 'Chi', type: 'ADULT', weight: 1.0, isRep: false },
      { name: 'Chít', type: 'CHILD', weight: 0.5, isRep: false }
    ]
  }, ss);

  assert.equal(batchRes3.success, true);
  const fam3 = batchRes3.families.find(f => f.family_name === '2F');
  assert.equal(fam3.repMember.member_name, 'Quậy');
  assert.equal(fam3.members.find(m => m.member_name === 'Chi').repstatus, false);
  assert.equal(fam3.members.find(m => m.member_name === 'Quậy').repstatus, true);
});

test('SplitFamilies: saveSplitFamilyMember toggles repstatus of old rep from true to false', () => {
  const ss = createMockSpreadsheet();

  // First save Quậy as representative (repstatus = true)
  Server_Tab7.saveSplitFamilyMember({ family_id: 'FAM-12345', family_name: '2F', member_name: 'Quậy', member_type: 'ADULT', default_weight: 1, isRep: true }, ss);
  Server_Tab7.saveSplitFamilyMember({ family_id: 'FAM-12345', family_name: '2F', member_name: 'Chi', member_type: 'ADULT', default_weight: 1, isRep: false }, ss);

  let check1 = Server_Tab7.getSplitFamilies(ss);
  let fam1 = check1.families.find(f => f.family_name === '2F');
  assert.equal(fam1.repMember.member_name, 'Quậy');
  assert.equal(fam1.members.find(m => m.member_name === 'Quậy').repstatus, true);
  assert.equal(fam1.members.find(m => m.member_name === 'Chi').repstatus, false);

  // Now update Chi to be representative (isRep: true)
  Server_Tab7.saveSplitFamilyMember({ family_id: 'FAM-12345', family_name: '2F', member_name: 'Chi', member_type: 'ADULT', default_weight: 1, isRep: true }, ss);

  let check2 = Server_Tab7.getSplitFamilies(ss);
  let fam2 = check2.families.find(f => f.family_name === '2F');
  assert.equal(fam2.repMember.member_name, 'Chi');

  const quayFinal = fam2.members.find(m => m.member_name === 'Quậy');
  assert.equal(quayFinal.isRep, false);
  assert.equal(quayFinal.repstatus, false);

  const chiFinal = fam2.members.find(m => m.member_name === 'Chi');
  assert.equal(chiFinal.isRep, true);
  assert.equal(chiFinal.repstatus, true);
});

test('SplitFamilies: deleteSplitFamilyMember deletes row directly from database', () => {
  const ss = createMockSpreadsheet();
  Server_Tab7.saveSplitFamilyMember({ family_id: 'FAM-99999', family_name: '2F', member_name: 'Chi', member_type: 'ADULT', default_weight: 1, isRep: true }, ss);

  const initial = Server_Tab7.getSplitFamilies(ss);
  const memToDelete = initial.rawMembers.find(m => m.member_name === 'Chi');
  assert.ok(memToDelete);

  const delRes = Server_Tab7.deleteSplitFamilyMember(memToDelete.member_id, ss);
  assert.equal(delRes.success, true);

  const afterDel = Server_Tab7.getSplitFamilies(ss);
  assert.equal(afterDel.rawMembers.some(m => m.member_id === memToDelete.member_id), false);
});

test('SplitGroups: saves and reads 15 flat relational columns for 3 families 7 members (Ăn cháo lòng)', () => {
  const ss = createMockSpreadsheet();

  const groupData = {
    id: 'GRP_001',
    name: 'Ăn cháo lòng',
    category: 'FOOD',
    currency: 'JPY',
    status: 'OPEN',
    created_at: '2026-09-21 19:00',
    members: [
      { groupMemberId: 'GM_001', id: 'MEB-00001', name: 'Tuyết Anh', familyId: 'FAM-00001', family: '1F', type: 'ADULT', weight: 1.0, sortOrder: 1 },
      { groupMemberId: 'GM_002', id: 'MEB-00002', name: 'A Huân', familyId: 'FAM-00001', family: '1F', type: 'ADULT', weight: 1.0, sortOrder: 2 },
      { groupMemberId: 'GM_003', id: 'MEB-00003', name: 'Quậy', familyId: 'FAM-00002', family: '2F', type: 'ADULT', weight: 1.0, sortOrder: 3 },
      { groupMemberId: 'GM_004', id: 'MEB-00004', name: 'Chi', familyId: 'FAM-00002', family: '2F', type: 'ADULT', weight: 1.0, sortOrder: 4 },
      { groupMemberId: 'GM_005', id: 'MEB-00005', name: 'Bé', familyId: 'FAM-00002', family: '2F', type: 'CHILD', weight: 0.5, sortOrder: 5 },
      { groupMemberId: 'GM_006', id: 'MEB-00006', name: 'Nam', familyId: 'FAM-00003', family: 'Gia đình A', type: 'ADULT', weight: 1.0, sortOrder: 6 },
      { groupMemberId: 'GM_007', id: 'MEB-00007', name: 'Linh', familyId: 'FAM-00003', family: 'Gia đình A', type: 'ADULT', weight: 1.0, sortOrder: 7 }
    ]
  };

  const saveRes = Server_Tab7.saveSplitGroup(groupData, ss);
  assert.equal(saveRes.success, true);

  const sheet = ss.getSheetByName(Server_Tab7.SHEET_SPLIT_GROUPS);
  assert.ok(sheet);
  assert.equal(sheet.getLastRow(), 8);

  const firstMemberRow = sheet.getRange(2, 1, 1, 15).getValues()[0];
  assert.equal(firstMemberRow[0], 'GRP_001');
  assert.equal(firstMemberRow[1], 'FOOD');
  assert.equal(firstMemberRow[2], 'Ăn cháo lòng');
  assert.equal(firstMemberRow[3], 'JPY');
  assert.equal(firstMemberRow[4], 'OPEN');
  assert.equal(firstMemberRow[6], 'GM_001');
  assert.equal(firstMemberRow[7], 'MEB-00001');
  assert.equal(firstMemberRow[8], 'Tuyết Anh');
  assert.equal(firstMemberRow[9], 'FAM-00001');
  assert.equal(firstMemberRow[10], '1F');
  assert.equal(firstMemberRow[11], 'ADULT');
  assert.equal(firstMemberRow[12], 1);

  const fetchRes = Server_Tab7.getSplitGroups(ss);
  assert.equal(fetchRes.success, true);
  assert.equal(fetchRes.groups.length, 1);
  const fetchedG = fetchRes.groups[0];
  assert.equal(fetchedG.name, 'Ăn cháo lòng');
  assert.equal(fetchedG.category, 'FOOD');
  assert.equal(fetchedG.members.length, 7);

  const families = Array.from(new Set(fetchedG.members.map(m => m.family)));
  assert.equal(families.length, 3);
  assert.deepEqual(families.sort(), ['1F', '2F', 'Gia đình A'].sort());
});

test('standardizeSplitFamiliesSheet standardizes 8 columns and ensures 1 rep per family and 1 isme family', () => {
  const ss = createMockSpreadsheet();
  const sheet = ss.insertSheet('SplitFamilies');
  sheet.appendRow(['family_id', 'family_name', 'member_id', 'member_name', 'member_type', 'default_weight', 'isme', 'repstatus']);
  sheet.appendRow(['FAM-10001', '1F', 'MEB-10001', 'Member 1', 'ADULT', 1, false, false]);
  sheet.appendRow(['FAM-10001', '1F', 'MEB-10002', 'Member 2', 'ADULT', 1, false, false]);
  sheet.appendRow(['FAM-10002', '2F', 'MEB-10003', 'Member 3', 'ADULT', 1, true, true]);
  sheet.appendRow(['FAM-10002', '2F', 'MEB-10004', 'Member 4', 'ADULT', 1, false, false]);

  const res = Server_Tab7.getSplitFamilies(ss);
  assert.equal(res.success, true);

  const data = sheet.getRange(2, 1, 4, 8).getValues();
  // FAM-10001 first member receives repstatus = true
  assert.equal(data[0][7], true);
  assert.equal(data[1][7], false);
  // FAM-10002 Member 3 has repstatus = true
  assert.equal(data[2][7], true);
  assert.equal(data[3][7], false);

  // FAM-10002 (2F) is "Gia đình tôi" (isme = true), FAM-10001 isme = false
  assert.equal(data[0][6], false);
  assert.equal(data[1][6], false);
  assert.equal(data[2][6], true);
  assert.equal(data[3][6], true);
});
