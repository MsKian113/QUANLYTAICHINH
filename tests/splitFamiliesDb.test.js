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

test('SplitFamilies: Sheet creation without hardcoded seed sample data', () => {
  const ss = createMockSpreadsheet();
  const sheet = Server_Tab7.getSplitFamiliesSheetHelper(ss);
  assert.ok(sheet);
  assert.equal(sheet.getLastRow(), 1); // 1 header row only

  const res = Server_Tab7.getSplitFamilies(ss);
  assert.equal(res.success, true);
  assert.equal(res.families.length, 0); // Empty when initialized
});

test('SplitFamilies: saveSplitFamilyBatch sets sort_order = 1 for representative member and empty string for non-representatives', () => {
  const ss = createMockSpreadsheet();

  const batchRes = Server_Tab7.saveSplitFamilyBatch({
    family_name: '2F',
    members: [
      { name: 'Quậy', type: 'ADULT', weight: 1.0, isRep: false },
      { name: 'Chi', type: 'ADULT', weight: 1.0, isRep: true },
      { name: 'Chít', type: 'CHILD', weight: 0.5, isRep: false }
    ]
  }, ss);

  assert.equal(batchRes.success, true);
  const fam = batchRes.families.find(f => f.family_name === '2F');
  assert.ok(fam);
  assert.equal(fam.repMember.member_name, 'Chi');

  const chi = fam.members.find(m => m.member_name === 'Chi');
  assert.equal(chi.sort_order, 1);
  assert.equal(chi.isRep, true);

  const quay = fam.members.find(m => m.member_name === 'Quậy');
  assert.equal(quay.sort_order, "");
  assert.equal(quay.isRep, false);

  const chit = fam.members.find(m => m.member_name === 'Chít');
  assert.equal(chit.sort_order, "");
  assert.equal(chit.isRep, false);

  // Switch representative from Chi to Quậy
  const batchRes2 = Server_Tab7.saveSplitFamilyBatch({
    family_name: '2F',
    members: [
      { name: 'Quậy', type: 'ADULT', weight: 1.0, isRep: true },
      { name: 'Chi', type: 'ADULT', weight: 1.0, isRep: false },
      { name: 'Chít', type: 'CHILD', weight: 0.5, isRep: false }
    ]
  }, ss);

  assert.equal(batchRes2.success, true);
  const fam2 = batchRes2.families.find(f => f.family_name === '2F');
  assert.equal(fam2.repMember.member_name, 'Quậy');

  const quay2 = fam2.members.find(m => m.member_name === 'Quậy');
  assert.equal(quay2.sort_order, 1);
  assert.equal(quay2.isRep, true);

  const chi2 = fam2.members.find(m => m.member_name === 'Chi');
  assert.equal(chi2.sort_order, "");
  assert.equal(chi2.isRep, false);
});

test('SplitFamilies: deleteSplitFamilyMember sets status to INACTIVE', () => {
  const ss = createMockSpreadsheet();
  Server_Tab7.saveSplitFamilyMember({ family_id: 'FAM_001', family_name: '2F', member_name: 'Chi', member_type: 'ADULT', default_weight: 1, sort_order: 1 }, ss);

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
      { groupMemberId: 'GM_001', id: 'MBR_001', name: 'Tuyết Anh', familyId: 'FAM_001', family: '1F', type: 'ADULT', weight: 1.0, sortOrder: 1 },
      { groupMemberId: 'GM_002', id: 'MBR_002', name: 'A Huân', familyId: 'FAM_001', family: '1F', type: 'ADULT', weight: 1.0, sortOrder: 2 },
      { groupMemberId: 'GM_003', id: 'MBR_003', name: 'Quậy', familyId: 'FAM_002', family: '2F', type: 'ADULT', weight: 1.0, sortOrder: 3 },
      { groupMemberId: 'GM_004', id: 'MBR_004', name: 'Chi', familyId: 'FAM_002', family: '2F', type: 'ADULT', weight: 1.0, sortOrder: 4 },
      { groupMemberId: 'GM_005', id: 'MBR_005', name: 'Bé', familyId: 'FAM_002', family: '2F', type: 'CHILD', weight: 0.5, sortOrder: 5 },
      { groupMemberId: 'GM_006', id: 'MBR_006', name: 'Nam', familyId: 'FAM_003', family: 'Gia đình A', type: 'ADULT', weight: 1.0, sortOrder: 6 },
      { groupMemberId: 'GM_007', id: 'MBR_007', name: 'Linh', familyId: 'FAM_003', family: 'Gia đình A', type: 'ADULT', weight: 1.0, sortOrder: 7 }
    ]
  };

  const saveRes = Server_Tab7.saveSplitGroup(groupData, ss);
  assert.equal(saveRes.success, true);

  const sheet = ss.getSheetByName(Server_Tab7.SHEET_SPLIT_GROUPS);
  assert.ok(sheet);
  // 1 header + 7 flat member rows = 8 rows total
  assert.equal(sheet.getLastRow(), 8);

  // Verify sheet contents match exact 15 flat columns
  const firstMemberRow = sheet.getRange(2, 1, 1, 15).getValues()[0];
  assert.equal(firstMemberRow[0], 'GRP_001');
  assert.equal(firstMemberRow[1], 'FOOD');
  assert.equal(firstMemberRow[2], 'Ăn cháo lòng');
  assert.equal(firstMemberRow[3], 'JPY');
  assert.equal(firstMemberRow[4], 'OPEN');
  assert.equal(firstMemberRow[6], 'GM_001');
  assert.equal(firstMemberRow[7], 'MBR_001');
  assert.equal(firstMemberRow[8], 'Tuyết Anh');
  assert.equal(firstMemberRow[9], 'FAM_001');
  assert.equal(firstMemberRow[10], '1F');
  assert.equal(firstMemberRow[11], 'ADULT');
  assert.equal(firstMemberRow[12], 1);
  assert.equal(firstMemberRow[13], 1);

  // Verify getSplitGroups reconstructs group with 7 members
  const fetchRes = Server_Tab7.getSplitGroups(ss);
  assert.equal(fetchRes.success, true);
  assert.equal(fetchRes.groups.length, 1);
  const fetchedG = fetchRes.groups[0];
  assert.equal(fetchedG.name, 'Ăn cháo lòng');
  assert.equal(fetchedG.category, 'FOOD');
  assert.equal(fetchedG.members.length, 7);

  // Check 3 distinct families reconstructed
  const families = Array.from(new Set(fetchedG.members.map(m => m.family)));
  assert.equal(families.length, 3);
  assert.deepEqual(families.sort(), ['1F', '2F', 'Gia đình A'].sort());
});

