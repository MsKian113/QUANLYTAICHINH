/**
 * SERVER_TAB7.JS - BACKEND CORE FOR GROUP BILL SPLITTING (CHIA TIỀN NHÓM & DU LỊCH)
 * 100% Isolated Module: Does not alter or interfere with existing sheets or tabs.
 */

var SHEET_SPLIT_GROUPS = "SplitGroups";
var SHEET_SPLIT_EXPENSES = "SplitExpenses";
var SHEET_SPLIT_FAMILIES = "SplitFamilies";

/**
 * Robust date formatter to YYYY-MM-DD
 */
function formatDateToYYYYMMDD(d) {
  if (!d) return new Date().toISOString().split('T')[0];
  if (d instanceof Date) {
    if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
    var yr = d.getFullYear();
    var mo = String(d.getMonth() + 1).padStart(2, '0');
    var da = String(d.getDate()).padStart(2, '0');
    return yr + '-' + mo + '-' + da;
  }
  var str = String(d).trim();
  if (!str) return new Date().toISOString().split('T')[0];
  if (str.match(/^\d{4}-\d{1,2}-\d{1,2}/)) {
    var p1 = str.split(' ')[0].split('-');
    return p1[0] + '-' + p1[1].padStart(2, '0') + '-' + p1[2].padStart(2, '0');
  }
  if (str.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}/)) {
    var p2 = str.split(' ')[0].split('/');
    var dd = p2[0].padStart(2, '0');
    var mm = p2[1].padStart(2, '0');
    var yyyy = p2[2];
    if (yyyy.length === 2) yyyy = "20" + yyyy;
    return yyyy + '-' + mm + '-' + dd;
  }
  var parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    var yr2 = parsed.getFullYear();
    var mo2 = String(parsed.getMonth() + 1).padStart(2, '0');
    var da2 = String(parsed.getDate()).padStart(2, '0');
    return yr2 + '-' + mo2 + '-' + da2;
  }
  return new Date().toISOString().split('T')[0];
}

/**
 * Ensures SplitFamilies sheet exists with correct headers and seed sample data
 */
function getSplitFamiliesSheetHelper(ssTarget) {
  var ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  var sheet = ss.getSheetByName(SHEET_SPLIT_FAMILIES);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SPLIT_FAMILIES);
    sheet.appendRow(["family_id", "family_name", "member_id", "member_name", "member_type", "default_weight", "sort_order", "status", "is_me"]);
  }
  return sheet;
}

/**
 * Ensures SplitGroups sheet exists with correct headers
 */
function getSplitGroupsSheetHelper(ssTarget) {
  var ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  var sheet = ss.getSheetByName(SHEET_SPLIT_GROUPS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SPLIT_GROUPS);
    sheet.appendRow(["GroupID", "GroupType", "GroupName", "Currency", "Status", "CreatedAt", "GroupMemberID", "MemberID", "MemberName", "FamilyID", "FamilyName", "MemberType", "Weight", "SortOrder", "MemberStatus"]);
  }
  return sheet;
}

/**
 * Ensures SplitExpenses sheet exists with correct headers
 */
function getSplitExpensesSheetHelper(ssTarget) {
  var ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  var sheet = ss.getSheetByName(SHEET_SPLIT_EXPENSES);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SPLIT_EXPENSES);
    sheet.appendRow(["ExpenseID", "GroupID", "ExpenseDate", "Description", "Amount", "PayerMemberID", "PayerName", "PaymentSource", "SplitMode", "RoundUnit", "SplitMemberID", "SplitMemberName", "InputValue", "CalculatedAmount", "CalculationNote", "Status"]);
  }
  return sheet;
}

/**
 * 0. FETCH ALL FAMILIES & MEMBERS FROM SPLITFAMILIES
 */
function getSplitFamilies(ssTarget) {
  try {
    var sheet = getSplitFamiliesSheetHelper(ssTarget);
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: true, families: [], rawMembers: [] };
    }

    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues();
    var familyMap = {};
    var rawMembers = [];

    data.forEach(function(row) {
      var famId = String(row[0] || "").trim();
      var famName = String(row[1] || "").trim();
      var memId = String(row[2] || "").trim();
      var memName = String(row[3] || "").trim();
      var memType = String(row[4] || "ADULT").trim().toUpperCase();
      var weight = Number(row[5]);
      if (isNaN(weight)) weight = (memType === "CHILD" ? 0.5 : (memType === "BABY" ? 0 : 1.0));
      var sortOrder = Number(row[6]) || 99;
      var status = String(row[7] || "ACTIVE").trim().toUpperCase();
      var mNameLower = memName.toLowerCase();
      var mFamLower = famName.toLowerCase();
      var isMeVal = Boolean(row[8]);
      if (row[8] === undefined || row[8] === null || row[8] === "") {
        isMeVal = (mNameLower.includes("tôi") || mNameLower.includes("chủ ví") || mFamLower === "2f" || mFamLower.includes("2f") || mNameLower.includes("quậy") || mNameLower.includes("chi") || mNameLower.includes("chít"));
      }

      if (!famId || !memId || status === "INACTIVE" || status === "DELETED") return;

      var memObj = {
        family_id: famId,
        family_name: famName,
        member_id: memId,
        member_name: memName,
        member_type: memType,
        default_weight: weight,
        sort_order: sortOrder,
        status: status,
        isMe: isMeVal,
        is_me: isMeVal
      };

      rawMembers.push(memObj);

      if (!familyMap[famId]) {
        familyMap[famId] = {
          family_id: famId,
          family_name: famName,
          repMember: memObj,
          members: [],
          isMe: isMeVal
        };
      }

      if (isMeVal) familyMap[famId].isMe = true;
      familyMap[famId].members.push(memObj);
      if (sortOrder < (familyMap[famId].repMember.sort_order || 99)) {
        familyMap[famId].repMember = memObj;
      }
    });

    var families = Object.keys(familyMap).map(function(k) { return familyMap[k]; });
    var categorySuggestions = getFamilyCategorySuggestionsHelper(ssTarget);

    return { success: true, families: families, rawMembers: rawMembers, categorySuggestions: categorySuggestions };
  } catch (err) {
    return { success: false, message: "Lỗi lấy danh sách gia đình: " + err.toString(), families: [], rawMembers: [], categorySuggestions: [] };
  }
}

function getFamilyCategorySuggestionsHelper(ssTarget) {
  try {
    var ss = ssTarget || (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null);
    if (!ss) return [];
    var catSheet = ss.getSheetByName("Categories") || ss.getSheetByName("DanhMuc");
    if (!catSheet || catSheet.getLastRow() < 1) return [];

    var data = catSheet.getRange(1, 1, catSheet.getLastRow(), 1).getValues();
    var list = [];
    var ignoreHeaders = ["danh sách gia đình", "danh sách khách / đối tác", "khách / đối tác", "đối tác", "khách hàng", "tên gia đình", "tên đối tác", "partner", "tên khách", "danh mục"];

    for (var r = 0; r < data.length; r++) {
      var val = String(data[r][0] || "").trim();
      if (val && !ignoreHeaders.includes(val.toLowerCase()) && !list.includes(val)) {
        list.push(val);
      }
    }
    return list;
  } catch (e) {
    return [];
  }
}

/**
 * SAVE OR UPDATE A MEMBER IN SPLITFAMILIES
 */
function saveSplitFamilyMember(memberData, ssTarget) {
  try {
    if (!memberData) return { success: false, message: "⚠️ Dữ liệu thành viên trống!" };

    var famName = String(memberData.family_name || memberData.family || "").trim();
    var memName = String(memberData.member_name || memberData.name || "").trim();
    var memType = String(memberData.member_type || memberData.type || "ADULT").trim().toUpperCase();
    var weight = Number(memberData.default_weight !== undefined ? memberData.default_weight : memberData.weight);
    if (isNaN(weight)) weight = (memType === "CHILD" ? 0.5 : (memType === "BABY" ? 0 : 1.0));
    var sortOrder = Number(memberData.sort_order) || 1;
    var famId = String(memberData.family_id || "").trim();
    if (!famId) famId = famName ? ("FAM_" + famName.replace(/[^a-zA-Z0-9]/g, "")) : "FAM_001";
    var memId = String(memberData.member_id || memberData.id || "").trim();

    if (!famName) return { success: false, message: "⚠️ Vui lòng nhập tên Gia Đình!" };
    if (!memName) return { success: false, message: "⚠️ Vui lòng nhập tên Thành Viên!" };

    var sheet = getSplitFamiliesSheetHelper(ssTarget);
    if (!sheet) return { success: false, message: "❌ Không tìm thấy sheet SplitFamilies!" };

    var data = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues() : [];
    var existingRowIdx = -1;

    // 1. Match by member_id
    if (memId) {
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][2]).trim() === memId) {
          existingRowIdx = i + 2;
          break;
        }
      }
    }

    // 2. Fallback match by family_id/family_name AND member_name
    if (existingRowIdx < 0 && (famName || famId) && memName) {
      var normFamName = famName.toLowerCase();
      var normFamId = famId.toLowerCase();
      var normMemName = memName.toLowerCase();

      for (var j = 0; j < data.length; j++) {
        var rowFamId = String(data[j][0] || "").trim().toLowerCase();
        var rowFamName = String(data[j][1] || "").trim().toLowerCase();
        var rowMemName = String(data[j][3] || "").trim().toLowerCase();
        var rowStatus = String(data[j][7] || "ACTIVE").trim().toUpperCase();

        if (rowStatus !== "DELETED" && (rowFamName === normFamName || rowFamId === normFamId) && rowMemName === normMemName) {
          existingRowIdx = j + 2;
          memId = String(data[j][2]).trim(); // Preserve existing member_id
          break;
        }
      }
    }

    // 3. Fallback match by family_id/family_name AND sort_order
    if (existingRowIdx < 0 && (famName || famId) && sortOrder) {
      var normFamName2 = famName.toLowerCase();
      var normFamId2 = famId.toLowerCase();

      for (var k = 0; k < data.length; k++) {
        var rFamId2 = String(data[k][0] || "").trim().toLowerCase();
        var rFamName2 = String(data[k][1] || "").trim().toLowerCase();
        var rSortOrder = Number(data[k][6]) || 0;
        var rStatus2 = String(data[k][7] || "ACTIVE").trim().toUpperCase();

        if (rStatus2 !== "DELETED" && (rFamName2 === normFamName2 || rFamId2 === normFamId2) && rSortOrder === sortOrder) {
          existingRowIdx = k + 2;
          memId = String(data[k][2]).trim(); // Preserve existing member_id
          break;
        }
      }
    }

    var isMeMember = Boolean(memberData.is_me || memberData.isMe);

    if (existingRowIdx > 0) {
      sheet.getRange(existingRowIdx, 1).setValue(famId);
      sheet.getRange(existingRowIdx, 2).setValue(famName);
      if (memId) sheet.getRange(existingRowIdx, 3).setValue(memId);
      sheet.getRange(existingRowIdx, 4).setValue(memName);
      sheet.getRange(existingRowIdx, 5).setValue(memType);
      sheet.getRange(existingRowIdx, 6).setValue(weight);
      sheet.getRange(existingRowIdx, 7).setValue(sortOrder);
      sheet.getRange(existingRowIdx, 8).setValue("ACTIVE");
      sheet.getRange(existingRowIdx, 9).setValue(isMeMember);
    } else {
      if (!memId) memId = generateSplitId("MBR");
      sheet.appendRow([famId, famName, memId, memName, memType, weight, sortOrder, "ACTIVE", isMeMember]);
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();

    return {
      success: true,
      message: "✅ Đã lưu thành viên " + memName + " (" + famName + ") thành công!",
      member: {
        family_id: famId,
        family_name: famName,
        member_id: memId,
        member_name: memName,
        member_type: memType,
        default_weight: weight,
        sort_order: sortOrder,
        status: "ACTIVE",
        isMe: isMeMember,
        is_me: isMeMember
      }
    };
  } catch (err) {
    return { success: false, message: "Lỗi lưu thành viên gia đình: " + err.toString() };
  }
}

/**
 * SAVE ENTIRE FAMILY IN ONE BATCH CALL
 */
function saveSplitFamilyBatch(batchData, ssTarget) {
  try {
    if (!batchData) return { success: false, message: "⚠️ Dữ liệu gia đình trống!" };
    var famName = String(batchData.family_name || batchData.name || "").trim();
    var oldName = String(batchData.old_name || "").trim();
    var members = Array.isArray(batchData.members) ? batchData.members : [];
    var removedMembers = Array.isArray(batchData.removed_members) ? batchData.removed_members : [];

    if (!famName) return { success: false, message: "⚠️ Vui lòng nhập tên Gia Đình!" };

    var ss = ssTarget || (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null);
    var sheet = getSplitFamiliesSheetHelper(ss);
    if (!sheet) return { success: false, message: "❌ Không tìm thấy sheet SplitFamilies!" };

    var famId = "FAM_" + famName.replace(/[^a-zA-Z0-9]/g, "");
    var lastRow = sheet.getLastRow();
    var lastCol = Math.max(8, sheet.getLastColumn());
    var existingData = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, Math.max(9, lastCol)).getValues() : [];

    var removedNameSet = {};
    var removedIdSet = {};
    removedMembers.forEach(function(rm) {
      if (rm.id || rm.member_id) removedIdSet[String(rm.id || rm.member_id).trim().toLowerCase()] = true;
      if (rm.name) removedNameSet[String(rm.name).trim().toLowerCase()] = true;
    });

    var normFamName = famName.toLowerCase();
    var normOldName = oldName ? oldName.toLowerCase() : "";

    // Keep rows that do NOT belong to this family (or oldName if renamed)
    var cleanedData = existingData.filter(function(row) {
      var rFamId = String(row[0] || "").trim().toLowerCase();
      var rFamName = String(row[1] || "").trim().toLowerCase();
      var rMemId = String(row[2] || "").trim().toLowerCase();
      var rMemName = String(row[3] || "").trim().toLowerCase();

      var isTargetFam = (rFamName === normFamName || rFamId === famId.toLowerCase() || (normOldName && rFamName === normOldName));
      if (!isTargetFam) return true;

      // If it belongs to target family, filter out if removed
      if (removedIdSet[rMemId] || removedNameSet[rMemName]) return false;

      // Filter out old rows to replace with fresh list
      return false;
    });

    // Build new rows for active members
    members.forEach(function(m, idx) {
      var mType = String(m.type || m.member_type || "ADULT").trim().toUpperCase();
      var weight = Number(m.weight !== undefined ? m.weight : m.default_weight);
      if (isNaN(weight)) weight = (mType === "CHILD" ? 0.5 : (mType === "BABY" ? 0 : 1.0));
      var mName = String(m.name || m.member_name || "").trim();
      var mId = String(m.id || m.member_id || "").trim();
      if (!mId) mId = "MBR_" + famName.replace(/[^a-zA-Z0-9]/g, "") + "_" + (mName.replace(/[^a-zA-Z0-9]/g, "") || (idx + 1));
      var isMe = Boolean(m.isMe || m.is_me);

      cleanedData.push([
        famId,
        famName,
        mId,
        mName,
        mType,
        weight,
        idx + 1,
        "ACTIVE",
        isMe
      ]);
    });

    // Write back in ONE atomic operation
    sheet.getRange(2, 1, Math.max(existingData.length, cleanedData.length), 9).clearContent();
    if (cleanedData.length > 0) {
      sheet.getRange(2, 1, cleanedData.length, 9).setValues(cleanedData);
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();

    return getSplitFamilies(ssTarget);
  } catch (err) {
    return { success: false, message: "Lỗi lưu gia đình: " + err.toString() };
  }
}

/**
 * DELETE OR DEACTIVATE A MEMBER IN SPLITFAMILIES
 */
function deleteSplitFamilyMember(memberId, ssTarget) {
  try {
    var cleanMemId = "";
    var famName = "";
    var memName = "";

    if (typeof memberId === 'object' && memberId !== null) {
      cleanMemId = String(memberId.member_id || memberId.id || "").trim();
      famName = String(memberId.family_name || memberId.family || "").trim().toLowerCase();
      memName = String(memberId.member_name || memberId.name || "").trim().toLowerCase();
    } else {
      cleanMemId = String(memberId || "").trim();
    }

    if (!cleanMemId && !memName) return { success: false, message: "⚠️ Mã thành viên hoặc tên thành viên không hợp lệ!" };

    var sheet = getSplitFamiliesSheetHelper(ssTarget);
    if (!sheet || sheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet SplitFamilies!" };

    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
    var targetRowIdx = -1;

    for (var i = 0; i < data.length; i++) {
      var rowMemId = String(data[i][2]).trim();
      var rowFamName = String(data[i][1]).trim().toLowerCase();
      var rowMemName = String(data[i][3]).trim().toLowerCase();

      if (cleanMemId && rowMemId === cleanMemId) {
        targetRowIdx = i + 2;
        break;
      } else if (!cleanMemId && famName && memName && rowFamName === famName && rowMemName === memName) {
        targetRowIdx = i + 2;
        break;
      }
    }

    if (targetRowIdx > 0) {
      sheet.deleteRow(targetRowIdx);
      if (typeof clearAppDataCache === 'function') clearAppDataCache();
      return { success: true, message: "✅ Đã xóa vĩnh viễn thành viên khỏi database!" };
    }

    return { success: false, message: "❌ Không tìm thấy thành viên để xóa!" };
  } catch (err) {
    return { success: false, message: "Lỗi xóa thành viên: " + err.toString() };
  }
}

function deleteSplitFamilyEntirely(famNameOrId, ssTarget) {
  try {
    var target = String(famNameOrId || "").trim().toLowerCase();
    if (!target) return { success: false, message: "⚠️ Tên gia đình không hợp lệ!" };

    var sheet = getSplitFamiliesSheetHelper(ssTarget);
    if (!sheet || sheet.getLastRow() < 2) return { success: true, message: "Sheet rỗng" };

    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
    for (var i = data.length - 1; i >= 0; i--) {
      var famId = String(data[i][0] || "").trim().toLowerCase();
      var famName = String(data[i][1] || "").trim().toLowerCase();

      if (famId === target || famName === target) {
        sheet.deleteRow(i + 2);
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    return { success: true, message: "✅ Đã xóa vĩnh viễn gia đình khỏi database!" };
  } catch (err) {
    return { success: false, message: "Lỗi xóa gia đình: " + err.toString() };
  }
}

/**
 * Generates unique IDs with prefix
 */
function generateSplitId(prefix) {
  var p = prefix || "GRP";
  return p + "_" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90);
}

/**
 * 1. FETCH ALL GROUPS (DUAL READER: FLAT 15-COL RELATIONAL & LEGACY JSON)
 */
function getSplitGroups(ssTarget) {
  try {
    var sheet = getSplitGroupsSheetHelper(ssTarget);
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: true, groups: [] };
    }

    // Pre-fetch master members from SplitFamilies for automatic FK resolution
    var masterMemMap = {};
    try {
      var famRes = getSplitFamilies(ssTarget);
      if (famRes && famRes.rawMembers) {
        famRes.rawMembers.forEach(function(m) {
          if (m.member_id) masterMemMap[m.member_id] = m;
        });
      }
    } catch(e) {}

    var lastCol = Math.max(sheet.getLastColumn(), 15);
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
    var groupMap = {};
    var groupOrder = [];

    data.forEach(function(row) {
      var id = String(row[0] || "").trim();
      if (!id) return;

      var col6Str = String(row[6] || "").trim();
      var col1Str = String(row[1] || "").trim();

      // Legacy JSON format support (if Col 6 contains JSON string starting with [ or {)
      if (col6Str.startsWith("[") || col6Str.startsWith("{")) {
        var legacyMembers = [];
        try { legacyMembers = JSON.parse(col6Str); } catch (e) { legacyMembers = []; }
        var legacyCat = String(row[7] || "TRIP").trim().toUpperCase() || "TRIP";
        
        if (!groupMap[id]) {
          groupOrder.push(id);
          groupMap[id] = {
            id: id,
            name: col1Str,
            currency: String(row[2] || "JPY").trim(),
            created_at: row[3] ? String(row[3]) : "",
            note: String(row[4] || "").trim(),
            status: String(row[5] || "OPEN").trim().toUpperCase(),
            category: legacyCat,
            members: legacyMembers
          };
        }
        return;
      }

      // 15 Flat Relational Columns:
      // GroupID(0), GroupType(1), GroupName(2), Currency(3), Status(4), CreatedAt(5),
      // GroupMemberID(6), MemberID(7), MemberName(8), FamilyID(9), FamilyName(10),
      // MemberType(11), Weight(12), SortOrder(13), MemberStatus(14)
      var groupType = col1Str.toUpperCase() || "TRIP";
      var groupName = String(row[2] || "").trim();
      var currency = String(row[3] || "JPY").trim();
      var status = String(row[4] || "OPEN").trim().toUpperCase();
      var createdAt = row[5] ? String(row[5]) : "";
      
      var groupMemberId = String(row[6] || "").trim();
      var memberId = String(row[7] || "").trim();
      var memberName = String(row[8] || "").trim();
      var familyId = String(row[9] || "").trim();
      var familyName = String(row[10] || "").trim();
      var memberType = String(row[11] || "ADULT").trim().toUpperCase();

      // Automatic FK Fallback from SplitFamilies Master Sheet if memberName / familyName are omitted
      if (memberId && masterMemMap[memberId]) {
        var masterMem = masterMemMap[memberId];
        if (!memberName) memberName = masterMem.member_name;
        if (!familyName) familyName = masterMem.family_name;
        if (!familyId) familyId = masterMem.family_id;
        if (!memberType || memberType === "ADULT") memberType = masterMem.member_type || memberType;
      }

      var weight = Number(row[12]);
      if (isNaN(weight)) weight = (memberType === "CHILD" ? 0.5 : (memberType === "BABY" ? 0 : 1.0));
      var sortOrder = Number(row[13]) || 99;
      var memberStatus = String(row[14] || "ACTIVE").trim().toUpperCase();

      if (memberStatus === "INACTIVE" || memberStatus === "DELETED") return;

      if (!groupMap[id]) {
        groupOrder.push(id);
        groupMap[id] = {
          id: id,
          name: groupName || id,
          currency: currency,
          created_at: createdAt,
          note: "",
          status: status,
          category: groupType,
          members: []
        };
      }

      if (memberName || memberId) {
        var mNameLower = String(memberName || "").toLowerCase();
        var mFamLower = String(familyName || "").toLowerCase();
        var isMeVal = (mNameLower.includes("tôi") || mNameLower.includes("chủ ví") || mFamLower === "2f" || mFamLower.includes("2f") || mNameLower.includes("quậy") || mNameLower.includes("chi") || mNameLower.includes("chít"));
        groupMap[id].members.push({
          id: memberId || groupMemberId,
          groupMemberId: groupMemberId,
          name: memberName,
          familyId: familyId,
          family: familyName || "2F",
          type: memberType,
          weight: weight,
          sortOrder: sortOrder,
          status: memberStatus,
          isMe: isMeVal
        });
      }
    });

    // Calculate total expense per group from SplitExpenses sheet (deduplicating by ExpenseID)
    var expenseMap = {};
    var seenExpMap = {};
    try {
      var eSheet = getSplitExpensesSheetHelper(ssTarget);
      if (eSheet && eSheet.getLastRow() >= 2) {
        var lastCol = Math.max(eSheet.getLastColumn(), 16);
        var eData = eSheet.getRange(2, 1, eSheet.getLastRow() - 1, lastCol).getValues();
        eData.forEach(function(eRow) {
          var expId = String(eRow[0] || "").trim();
          var gId = String(eRow[1] || "").trim();
          var amt = Number(eRow[4]) || 0;
          var status = String(eRow[15] || "ACTIVE").trim().toUpperCase();

          if (!expId || !gId || status === "INACTIVE" || status === "DELETED") return;

          if (!seenExpMap[expId]) {
            seenExpMap[expId] = true;
            expenseMap[gId] = (expenseMap[gId] || 0) + amt;
          }
        });
      }
    } catch(e) {}

    var groups = groupOrder.map(function(gid) {
      var g = groupMap[gid];
      if (g) {
        g.totalExpense = expenseMap[gid] || 0;
      }
      return g;
    });
    return { success: true, groups: groups };
  } catch (err) {
    return { success: false, message: "Lỗi lấy danh sách nhóm: " + err.toString(), groups: [] };
  }
}

/**
 * 2. GET SINGLE GROUP BY ID
 */
function getSplitGroupById(groupId, ssTarget) {
  try {
    var cleanId = String(groupId || "").trim();
    if (!cleanId) return { success: false, message: "⚠️ Mã nhóm không hợp lệ!" };

    var res = getSplitGroups(ssTarget);
    if (!res.success) return res;

    var group = res.groups.find(function(g) { return g.id === cleanId; });
    if (!group) return { success: false, message: "❌ Không tìm thấy nhóm!" };

    return { success: true, group: group };
  } catch (err) {
    return { success: false, message: "Lỗi lấy thông tin nhóm: " + err.toString() };
  }
}

/**
 * 3. SAVE / UPDATE GROUP WITH FLAT 15-COL RELATIONAL ROWS
 */
function saveSplitGroup(groupData, ssTarget) {
  try {
    if (!groupData) return { success: false, message: "⚠️ Dữ liệu nhóm trống!" };
    var name = String(groupData.name || "").trim();
    if (!name) return { success: false, message: "⚠️ Tên nhóm không được để trống!" };

    var sheet = getSplitGroupsSheetHelper(ssTarget);
    if (!sheet) return { success: false, message: "❌ Không tìm thấy sheet SplitGroups!" };

    var currency = String(groupData.currency || "JPY").trim();
    var note = String(groupData.note || "").trim();
    var status = String(groupData.status || "OPEN").trim().toUpperCase();
    var category = String(groupData.category || groupData.groupType || "TRIP").trim().toUpperCase();
    var rawMembers = Array.isArray(groupData.members) ? groupData.members : [];

    var groupId = String(groupData.id || "").trim();
    if (!groupId) groupId = generateSplitId("GRP");

    var nowStr = groupData.created_at || groupData.date || groupData.ngay || new Date().toISOString().split('T')[0];
    if (typeof nowStr === 'string' && nowStr.includes('T')) {
      nowStr = nowStr.split('T')[0];
    }

    // Normalize members
    var members = rawMembers.map(function(m, idx) {
      var mName = String(m.name || m.display_name || m.memberName || "").trim();
      var mType = String(m.type || m.member_type || m.memberType || "ADULT").trim().toUpperCase();
      var mFamily = String(m.family || m.family_name || m.familyName || "1F").trim();
      var mFamId = String(m.familyId || m.family_id || ("FAM_" + mFamily.replace(/[^a-zA-Z0-9]/g, ""))).trim();
      var mId = String(m.id || m.member_id || m.memberId || ("MBR_" + (idx + 1) + "_" + Math.floor(100 + Math.random() * 900))).trim();
      var gmId = String(m.groupMemberId || m.group_member_id || ("GM_" + String(idx + 1).padStart(3, '0'))).trim();
      var isMe = Boolean(m.isMe || m.is_me);

      var defaultWeight = 1.0;
      if (mType === "CHILD") defaultWeight = 0.5;
      else if (mType === "BABY") defaultWeight = 0.0;
      else if (m.weight !== undefined && m.weight !== null) defaultWeight = Number(m.weight);
      if (isNaN(defaultWeight)) defaultWeight = 1.0;

      var sortOrder = Number(m.sortOrder || m.sort_order) || (idx + 1);

      return {
        groupMemberId: gmId,
        id: mId,
        name: mName || ("Thành viên " + (idx + 1)),
        familyId: mFamId,
        family: mFamily,
        type: mType,
        weight: defaultWeight,
        sortOrder: sortOrder,
        status: "ACTIVE",
        isMe: isMe
      };
    });

    // Delete existing rows for groupId if updating
    if (sheet.getLastRow() >= 2) {
      var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
      var rowsToDelete = [];
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][0]).trim() === groupId) {
          rowsToDelete.push(i + 2);
        }
      }
      deleteContiguousRowsHelper(sheet, rowsToDelete);
    }

    // Append 1 flat row per member (15 Columns Flat Relational Schema) in single batch call
    var memberRows = [];
    members.forEach(function(m) {
      memberRows.push([
        groupId,
        category,
        name,
        currency,
        status,
        nowStr,
        m.groupMemberId,
        m.id,
        m.name,
        m.familyId,
        m.family,
        m.type,
        m.weight,
        m.sortOrder,
        m.status
      ]);
    });
    appendRowsBatchHelper(sheet, memberRows);

    // Automatically sync/upsert group members into Master SplitFamilies database
    try {
      members.forEach(function(m) {
        saveSplitFamilyMember({
          family_id: m.familyId,
          family_name: m.family,
          member_id: m.id,
          member_name: m.name,
          member_type: m.type,
          default_weight: m.weight,
          sort_order: m.sortOrder || 99,
          status: "ACTIVE"
        }, ssTarget);
      });
    } catch (e) {}

    if (typeof clearAppDataCache === 'function') clearAppDataCache();

    return {
      success: true,
      message: "✅ Đã lưu nhóm " + name + " (" + members.length + " thành viên) thành công!",
      group: {
        id: groupId,
        name: name,
        currency: currency,
        created_at: nowStr,
        note: note,
        status: status,
        category: category,
        members: members
      }
    };
  } catch (err) {
    return { success: false, message: "Lỗi lưu nhóm: " + err.toString() };
  }
}

/**
 * Helper to batch insert rows using setValues with appendRow fallback
 */
function appendRowsBatchHelper(sheet, rows) {
  if (!sheet || !rows || rows.length === 0) return;
  var numCols = rows[0].length;
  var startRow = sheet.getLastRow() + 1;
  try {
    var range = sheet.getRange(startRow, 1, rows.length, numCols);
    if (range && typeof range.setValues === 'function') {
      range.setValues(rows);
      return;
    }
  } catch(e) {}
  rows.forEach(function(r) {
    sheet.appendRow(r);
  });
}

/**
 * Helper to delete rows in batch using deleteRows for contiguous blocks
 */
function deleteContiguousRowsHelper(sheet, rowIndices) {
  if (!sheet || !rowIndices || rowIndices.length === 0) return;
  var uniqueIndices = [];
  rowIndices.forEach(function(idx) {
    if (uniqueIndices.indexOf(idx) === -1) uniqueIndices.push(idx);
  });
  uniqueIndices.sort(function(a, b) { return b - a; });

  if (typeof sheet.deleteRows === 'function') {
    var start = uniqueIndices[0];
    var count = 1;

    for (var i = 1; i < uniqueIndices.length; i++) {
      if (uniqueIndices[i] === start - count) {
        count++;
      } else {
        sheet.deleteRows(start - count + 1, count);
        start = uniqueIndices[i];
        count = 1;
      }
    }
    if (count > 0) {
      sheet.deleteRows(start - count + 1, count);
    }
  } else {
    for (var j = 0; j < uniqueIndices.length; j++) {
      sheet.deleteRow(uniqueIndices[j]);
    }
  }
}

/**
 * 4. DELETE GROUP AND ITS EXPENSES
 */
function deleteSplitGroup(groupId, ssTarget) {
  try {
    var cleanId = String(groupId || "").trim();
    if (!cleanId) return { success: false, message: "⚠️ Mã nhóm không hợp lệ!" };

    var gSheet = getSplitGroupsSheetHelper(ssTarget);
    if (gSheet && gSheet.getLastRow() >= 2) {
      var gData = gSheet.getRange(2, 1, gSheet.getLastRow() - 1, 1).getValues();
      var rowsToDelete = [];
      for (var i = 0; i < gData.length; i++) {
        if (String(gData[i][0]).trim() === cleanId) {
          rowsToDelete.push(i + 2);
        }
      }
      deleteContiguousRowsHelper(gSheet, rowsToDelete);
    }

    // Delete associated expenses in SplitExpenses sheet
    deleteExpensesByGroupId(cleanId, ssTarget);

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    return { success: true, message: "✅ Đã xóa nhóm và toàn bộ khoản chi liên quan!" };
  } catch (err) {
    return { success: false, message: "Lỗi xóa nhóm: " + err.toString() };
  }
}

function deleteExpensesByGroupId(groupId, ssTarget) {
  try {
    var eSheet = getSplitExpensesSheetHelper(ssTarget);
    if (eSheet && eSheet.getLastRow() >= 2) {
      var eData = eSheet.getRange(2, 2, eSheet.getLastRow() - 1, 1).getValues();
      var rowsToDelete = [];
      for (var j = 0; j < eData.length; j++) {
        if (String(eData[j][0]).trim() === String(groupId).trim()) {
          rowsToDelete.push(j + 2);
        }
      }
      deleteContiguousRowsHelper(eSheet, rowsToDelete);
    }
  } catch (e) {}
}

/**
 * 5. MEMBER & FAMILY MANAGEMENT HELPERS
 */
function addMemberToSplitGroup(groupId, memberData, ssTarget) {
  var gRes = getSplitGroupById(groupId, ssTarget);
  if (!gRes.success) return gRes;
  var status = String(gRes.group.status || "").toUpperCase();
  if (status === "LOCKED" || status === "CLOSED") {
    return { success: false, message: "⚠️ TRẠNG THÁI NHÓM ĐÃ KHÓA (LOCKED): Không thể thay đổi dữ liệu." };
  }

  var group = gRes.group;
  var members = group.members || [];
  members.push(memberData);
  group.members = members;

  return saveSplitGroup(group, ssTarget);
}

function removeMemberFromSplitGroup(groupId, memberId, ssTarget) {
  var gRes = getSplitGroupById(groupId, ssTarget);
  if (!gRes.success) return gRes;
  var status = String(gRes.group.status || "").toUpperCase();
  if (status === "LOCKED" || status === "CLOSED") {
    return { success: false, message: "⚠️ TRẠNG THÁI NHÓM ĐÃ KHÓA (LOCKED): Không thể thay đổi dữ liệu." };
  }

  var group = gRes.group;
  var members = group.members || [];
  group.members = members.filter(function(m) { return m.id !== memberId; });

  return saveSplitGroup(group, ssTarget);
}


/* ==========================================================================
   PHASE 3: SPLIT ENGINE & EXPENSE CALCULATIONS
   ========================================================================== */

function calculateExpenseShares(splitType, totalAmount, participants, extraOptions) {
  var type = String(splitType || "WEIGHT").toUpperCase();
  var amount = Number(totalAmount) || 0;
  var rawList = Array.isArray(participants) ? participants : [];
  var options = extraOptions || {};

  if (amount <= 0 || rawList.length === 0) {
    return { success: false, message: "⚠️ Số tiền phải > 0 và có ít nhất 1 người tham gia!", participants: [] };
  }

  var resultList = [];
  var totalCalculated = 0;

  if (type === "EQUAL") {
    var count = rawList.length;
    var sharePerPerson = Math.floor(amount / count);
    var remainder = amount - (sharePerPerson * count);

    resultList = rawList.map(function(p, idx) {
      var calculated = sharePerPerson + (idx === 0 ? remainder : 0);
      return {
        memberId: String(p.memberId || p.id).trim(),
        name: String(p.name || "").trim(),
        calculatedAmount: calculated
      };
    });
  } else if (type === "WEIGHT") {
    var sumWeight = 0;
    rawList.forEach(function(p) { sumWeight += (Number(p.weight) || 0); });

    if (sumWeight <= 0) {
      return { success: false, message: "⚠️ Tổng hệ số tham gia phải > 0!", participants: [] };
    }

    var baseShares = [];
    var totalBase = 0;

    rawList.forEach(function(p, idx) {
      var w = Number(p.weight) || 0;
      var calc = Math.floor((w / sumWeight) * amount);
      totalBase += calc;
      baseShares.push({
        idx: idx,
        memberId: String(p.memberId || p.id).trim(),
        name: String(p.name || "").trim(),
        weight: w,
        calculatedAmount: calc
      });
    });

    var remWeight = amount - totalBase;
    if (remWeight > 0) {
      var sortedIndices = baseShares.slice().sort(function(a, b) {
        if (b.weight !== a.weight) return b.weight - a.weight;
        return a.idx - b.idx;
      });
      for (var r = 0; r < remWeight; r++) {
        var targetIdx = sortedIndices[r % sortedIndices.length].idx;
        baseShares[targetIdx].calculatedAmount += 1;
      }
    }

    resultList = baseShares.map(function(item) {
      return {
        memberId: item.memberId,
        name: item.name,
        weight: item.weight,
        calculatedAmount: item.calculatedAmount
      };
    });
  } else if (type === "FIXED_KIDS_EQUAL_ADULT") {
    var fixedChildAmt = options.fixedChildAmount !== undefined ? Number(options.fixedChildAmount) : 3000;
    var fixedBabyAmt = options.fixedBabyAmount !== undefined ? Number(options.fixedBabyAmount) : 0;

    var totalKidsCost = 0;
    var kidsCosts = rawList.map(function(p) {
      var pType = String(p.type || "").toUpperCase();
      if (pType !== "CHILD" && pType !== "BABY") return null;

      var cAmt = (p.customAmount !== undefined && p.customAmount !== null && String(p.customAmount).trim() !== "")
        ? Number(p.customAmount)
        : (p.custom_amount !== undefined && p.custom_amount !== null && String(p.custom_amount).trim() !== "")
          ? Number(p.custom_amount)
          : null;

      if (cAmt !== null && !isNaN(cAmt)) {
        return cAmt;
      }
      return pType === "CHILD" ? fixedChildAmt : fixedBabyAmt;
    });

    kidsCosts.forEach(function(cost) {
      if (cost !== null) totalKidsCost += cost;
    });

    var adults = rawList.filter(function(p) { 
      var t = String(p.type || "").toUpperCase();
      return t !== "CHILD" && t !== "BABY"; 
    });

    var remainingCostForAdults = amount - totalKidsCost;

    if (remainingCostForAdults < 0) {
      return { success: false, message: "⚠️ Số tiền dành cho trẻ em/em bé lớn hơn tổng khoản chi!", participants: [] };
    }

    var adultShare = adults.length > 0 ? Math.floor(remainingCostForAdults / adults.length) : 0;
    var adultRem = adults.length > 0 ? (remainingCostForAdults - (adultShare * adults.length)) : 0;

    resultList = rawList.map(function(p, idx) {
      var pType = String(p.type || "").toUpperCase();
      var calc = 0;
      if (pType === "CHILD" || pType === "BABY") {
        calc = kidsCosts[idx];
      } else {
        calc = adultShare;
      }

      return {
        memberId: String(p.memberId || p.id).trim(),
        name: String(p.name || "").trim(),
        calculatedAmount: calc
      };
    });

    if (adultRem !== 0) {
      var firstAdultIdx = resultList.findIndex(function(r, idx) { 
        var t = String(rawList[idx].type || "").toUpperCase();
        return t !== "CHILD" && t !== "BABY"; 
      });
      if (firstAdultIdx >= 0) {
        resultList[firstAdultIdx].calculatedAmount += adultRem;
      }
    }
  } else if (type === "PERCENTAGE") {
    var sumPct = 0;
    rawList.forEach(function(p) { sumPct += (Number(p.percentage) || 0); });

    if (Math.abs(sumPct - 100.0) > 0.01) {
      return { success: false, message: "⚠️ Tổng phần trăm phải đúng bằng 100%! (Đang là " + sumPct.toFixed(1) + "%)", participants: [] };
    }

    var basePctShares = [];
    var totalPctBase = 0;

    rawList.forEach(function(p, idx) {
      var pct = Number(p.percentage) || 0;
      var calc = Math.floor((pct / 100.0) * amount);
      totalPctBase += calc;
      basePctShares.push({
        idx: idx,
        memberId: String(p.memberId || p.id).trim(),
        name: String(p.name || "").trim(),
        percentage: pct,
        calculatedAmount: calc
      });
    });

    var remPct = amount - totalPctBase;
    if (remPct > 0) {
      var sortedPctIndices = basePctShares.slice().sort(function(a, b) {
        if (b.percentage !== a.percentage) return b.percentage - a.percentage;
        return a.idx - b.idx;
      });
      for (var pr = 0; pr < remPct; pr++) {
        var tIdx = sortedPctIndices[pr % sortedPctIndices.length].idx;
        basePctShares[tIdx].calculatedAmount += 1;
      }
    }

    resultList = basePctShares.map(function(item) {
      return {
        memberId: item.memberId,
        name: item.name,
        percentage: item.percentage,
        calculatedAmount: item.calculatedAmount
      };
    });
  } else if (type === "CUSTOM") {
    var sumCustom = 0;
    rawList.forEach(function(p) {
      var cAmt = Number(p.customAmount || p.custom_amount || p.calculatedAmount) || 0;
      sumCustom += cAmt;
      resultList.push({
        memberId: String(p.memberId || p.id).trim(),
        name: String(p.name || "").trim(),
        customAmount: cAmt,
        calculatedAmount: cAmt
      });
    });

    if (Math.abs(sumCustom - amount) > 0.01) {
      return { success: false, message: "⚠️ Tổng tiền tùy chỉnh (" + sumCustom.toLocaleString() + " ¥) không khớp tổng khoản chi (" + amount.toLocaleString() + " ¥)!", participants: [] };
    }
  } else {
    return { success: false, message: "⚠️ Kiểu chia không hợp lệ!", participants: [] };
  }

  return { success: true, splitType: type, totalAmount: amount, participants: resultList };
}

function getSplitExpenses(groupId, ssTarget) {
  try {
    var cleanGroupId = String(groupId || "").trim();
    var sheet = getSplitExpensesSheetHelper(ssTarget);
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: true, expenses: [] };
    }

    var lastCol = Math.max(sheet.getLastColumn(), 16);
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
    var expMap = {};
    var expOrder = [];

    data.forEach(function(row) {
      var id = String(row[0] || "").trim();
      var gId = String(row[1] || "").trim();
      if (!id || (cleanGroupId && gId !== cleanGroupId)) return;

      var col8Str = String(row[8] || "").trim();

      // Legacy 10-col JSON format support:
      if (col8Str.startsWith("[") || col8Str.startsWith("{")) {
        var legacyParticipants = [];
        try { legacyParticipants = JSON.parse(col8Str); } catch (e) { legacyParticipants = []; }
        var legacySettlements = [];
        try { if (row[9]) legacySettlements = JSON.parse(row[9]); } catch (e) {}

        if (!expMap[id]) {
          expOrder.push(id);
          expMap[id] = {
            id: id,
            groupId: gId,
            date: row[2] ? String(row[2]) : "",
            description: String(row[3] || "").trim(),
            amount: Number(row[4]) || 0,
            payerId: String(row[5] || "").trim(),
            walletName: String(row[6] || "").trim(),
            splitType: String(row[7] || "WEIGHT").trim().toUpperCase(),
            participants: legacyParticipants,
            settlements: legacySettlements
          };
        }
        return;
      }

      // 16 Flat Relational Columns:
      // ExpenseID(0), GroupID(1), ExpenseDate(2), Description(3), Amount(4), PayerMemberID(5),
      // PayerName(6), PaymentSource(7), SplitMode(8), RoundUnit(9), SplitMemberID(10),
      // SplitMemberName(11), InputValue(12), CalculatedAmount(13), CalculationNote(14), Status(15)
      var expenseDate = row[2] ? String(row[2]) : "";
      var description = String(row[3] || "").trim();
      var amount = Number(row[4]) || 0;
      var payerId = String(row[5] || "").trim();
      var payerName = String(row[6] || "").trim();
      var walletName = String(row[7] || "").trim();
      var splitMode = String(row[8] || "WEIGHT").trim().toUpperCase();
      var roundUnit = Number(row[9]) || 1;

      var splitMemberId = String(row[10] || "").trim();
      var splitMemberName = String(row[11] || "").trim();
      var inputValue = Number(row[12]);
      var calculatedAmount = Number(row[13]) || 0;
      var calculationNote = String(row[14] || "").trim();
      var status = String(row[15] || "ACTIVE").trim().toUpperCase();

      if (status === "INACTIVE" || status === "DELETED") return;

      if (!expMap[id]) {
        expOrder.push(id);
        expMap[id] = {
          id: id,
          groupId: gId,
          date: expenseDate,
          description: description,
          amount: amount,
          payerId: payerId,
          payerName: payerName,
          walletName: walletName,
          splitType: splitMode,
          roundUnit: roundUnit,
          status: status,
          participants: []
        };
      }

      if (splitMemberId || splitMemberName) {
        expMap[id].participants.push({
          memberId: splitMemberId,
          id: splitMemberId,
          name: splitMemberName,
          inputValue: isNaN(inputValue) ? 1 : inputValue,
          calculatedAmount: calculatedAmount,
          calculationNote: calculationNote
        });
      }
    });

    var expenses = expOrder.map(function(eid) { return expMap[eid]; });
    return { success: true, expenses: expenses };
  } catch (err) {
    return { success: false, message: "Lỗi lấy danh sách khoản chi: " + err.toString(), expenses: [] };
  }
}

function saveSplitExpense(expenseData, ssTarget) {
  try {
    if (!expenseData) return { success: false, message: "⚠️ Dữ liệu khoản chi trống!" };
    var ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    var groupId = String(expenseData.groupId || expenseData.group_id || "").trim();
    var description = String(expenseData.description || "").trim();
    var amount = Number(expenseData.amount) || 0;
    var payerId = String(expenseData.payerId || expenseData.payer_id || "").trim();
    var walletName = String(expenseData.walletName || expenseData.nguonTien || "").trim();
    var splitType = String(expenseData.splitType || expenseData.split_type || "WEIGHT").trim().toUpperCase();
    var rawParticipants = Array.isArray(expenseData.participants) ? expenseData.participants : [];

    if (!groupId) return { success: false, message: "⚠️ Khoản chi phải thuộc về 1 Nhóm!" };
    if (!description) return { success: false, message: "⚠️ Vui lòng nhập tên khoản chi!" };
    if (amount <= 0) return { success: false, message: "⚠️ Số tiền phải lớn hơn 0!" };
    if (!payerId) return { success: false, message: "⚠️ Vui lòng chọn người trả tiền!" };

    // Server-side lockdown guard (INV-14 & INV-18)
    var gRes = getSplitGroupById(groupId, ss);
    if (gRes.success && gRes.group) {
      var gStatus = String(gRes.group.status || "").toUpperCase();
      if (gStatus === "LOCKED" || gStatus === "CLOSED") {
        return { success: false, message: "⚠️ TRẠNG THÁI NHÓM ĐÃ KHÓA (LOCKED): Không thể thay đổi dữ liệu." };
      }
    }

    var splitRes = calculateExpenseShares(splitType, amount, rawParticipants, expenseData.extraOptions);
    if (!splitRes.success) return splitRes;

    var sheet = getSplitExpensesSheetHelper(ss);
    if (!sheet) return { success: false, message: "❌ Không tìm thấy sheet SplitExpenses!" };

    var expenseId = String(expenseData.id || "").trim();
    var oldWallet = "";
    var oldAmount = 0;

    if (sheet.getLastRow() >= 2) {
      var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
      var rowsToDelete = [];
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][0]).trim() === expenseId) {
          if (!oldWallet) oldWallet = String(data[i][7] || data[i][6] || "").trim();
          if (!oldAmount) oldAmount = Number(data[i][4]) || 0;
          rowsToDelete.push(i + 2);
        }
      }
      deleteContiguousRowsHelper(sheet, rowsToDelete);
    }

    if (!expenseId) expenseId = generateSplitId("EXP");
    var dateStr = expenseData.date ? String(expenseData.date) : new Date().toISOString().split('T')[0];

    // Find payer name
    var payerName = String(expenseData.payerName || "").trim();
    if (!payerName && gRes.group && gRes.group.members) {
      var pMbr = gRes.group.members.find(function(m) { return m.id === payerId; });
      if (pMbr) payerName = pMbr.name;
    }
    if (!payerName) payerName = payerId;

    if (oldWallet && typeof updateWalletBalanceHelper === 'function') {
      updateWalletBalanceHelper(oldWallet, oldAmount, ss);
    }

    // Append 1 flat row per participant in single batch setValues call
    var expRows = [];
    splitRes.participants.forEach(function(p) {
      var pId = String(p.memberId || p.id || "").trim();
      var pName = String(p.name || "").trim();
      var inputVal = Number(p.inputValue || p.customAmount || p.percentage) || 1;
      var calcAmt = Number(p.calculatedAmount) || 0;
      var noteStr = String(p.calculationNote || ("Phân bổ " + splitType)).trim();

      expRows.push([
        expenseId,
        groupId,
        dateStr,
        description,
        amount,
        payerId,
        payerName,
        walletName,
        splitType,
        1,
        pId,
        pName,
        inputVal,
        calcAmt,
        noteStr,
        "ACTIVE"
      ]);
    });
    appendRowsBatchHelper(sheet, expRows);

    if (walletName) {
      if (typeof saveFamilyTransaction === 'function') {
        var groupObj = (gRes && gRes.success) ? gRes.group : null;
        var groupTitle = groupObj ? groupObj.name : "";
        var jarCat = (groupObj && (groupObj.category === 'DINING' || groupTitle.toLowerCase().includes('ăn'))) ? "Ăn uống" : "Giải trí";
        saveFamilyTransaction({
          ngay: dateStr,
          loai: "CHI",
          hu: "",
          noidung: "[Ứng hộ nhóm] " + description + (groupTitle ? " (" + groupTitle + ")" : ""),
          sotien: amount,
          nguontien: walletName,
          codinh: false,
          ghichu: "[Ứng hộ nhóm] Khoản chi Tab 7 [" + expenseId + "]",
          status: "HOAN_TAT"
        }, ss);
      } else if (typeof updateWalletBalanceHelper === 'function') {
        updateWalletBalanceHelper(walletName, -amount, ss);
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();

    var updatedExpensesRes = getSplitExpenses(groupId, ss);
    var updatedExpenses = updatedExpensesRes.success ? updatedExpensesRes.expenses : [];
    var fullDataRes = getTab7FullGroupData((gRes && gRes.group) || groupId, ss, updatedExpenses);

    return {
      success: true,
      message: "✅ Đã lưu khoản chi " + description + " (" + amount.toLocaleString() + " ¥) thành công!",
      groupData: fullDataRes.success ? fullDataRes : null,
      expense: {
        id: expenseId,
        groupId: groupId,
        date: dateStr,
        description: description,
        amount: amount,
        payerId: payerId,
        payerName: payerName,
        walletName: walletName,
        splitType: splitType,
        participants: splitRes.participants
      }
    };
  } catch (err) {
    return { success: false, message: "Lỗi lưu khoản chi: " + err.toString() };
  }
}

function deleteSplitExpense(expenseId, ssTarget) {
  try {
    var ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    var cleanId = String(expenseId || "").trim();
    if (!cleanId) return { success: false, message: "⚠️ Mã khoản chi không hợp lệ!" };

    var sheet = getSplitExpensesSheetHelper(ss);
    if (!sheet || sheet.getLastRow() < 2) return { success: false, message: "❌ Sheet rỗng!" };

    var lastCol = Math.max(sheet.getLastColumn(), 16);
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();

    var targetRows = [];
    var groupId = "";
    var walletName = "";
    var amount = 0;

    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === cleanId) {
        targetRows.push(i + 2);
        if (!groupId) groupId = String(data[i][1] || "").trim();
        if (!walletName) walletName = String(data[i][7] || data[i][6] || "").trim();
        if (!amount) amount = Number(data[i][4]) || 0;
      }
    }

    if (targetRows.length === 0) {
      return { success: false, message: "❌ Không tìm thấy khoản chi cần xóa!" };
    }

    // Server-side lockdown guard (INV-14 & INV-18)
    var gRes = null;
    if (groupId) {
      gRes = getSplitGroupById(groupId, ss);
      if (gRes.success && gRes.group) {
        var gStatus = String(gRes.group.status || "").toUpperCase();
        if (gStatus === "LOCKED" || gStatus === "CLOSED") {
          return { success: false, message: "⚠️ TRẠNG THÁI NHÓM ĐÃ KHÓA (LOCKED): Không thể thay đổi dữ liệu." };
        }
      }
    }

    // Refund wallet balance if applicable
    if (walletName && amount > 0 && typeof updateWalletBalanceHelper === 'function') {
      updateWalletBalanceHelper(walletName, amount, ss);
    }

    // Delete all matching rows in batch
    deleteContiguousRowsHelper(sheet, targetRows);

    if (typeof clearAppDataCache === 'function') clearAppDataCache();

    var updatedExpensesRes = getSplitExpenses(groupId, ss);
    var updatedExpenses = updatedExpensesRes.success ? updatedExpensesRes.expenses : [];
    var fullDataRes = getTab7FullGroupData((gRes && gRes.group) || groupId, ss, updatedExpenses);

    return {
      success: true,
      message: "✅ Đã xóa khoản chi thành công!",
      groupData: fullDataRes.success ? fullDataRes : null
    };
  } catch (err) {
    return { success: false, message: "Lỗi xóa khoản chi: " + err.toString() };
  }
}


/* ==========================================================================
   PHASE 4: BALANCE ENGINE, OPTIMAL SETTLEMENTS & TRIP FINALIZATION DEBT SYNC
   ========================================================================== */

/**
 * 1. CALCULATE MEMBER BALANCES FOR A GROUP & VERIFY NET-ZERO INTEGRITY
 */
function calculateGroupBalances(groupIdOrGroupObj, ssTarget, preFetchedExpenses) {
  try {
    var group = null;
    if (typeof groupIdOrGroupObj === 'object' && groupIdOrGroupObj !== null) {
      group = groupIdOrGroupObj;
    } else {
      var gRes = getSplitGroupById(groupIdOrGroupObj, ssTarget);
      if (!gRes.success) return gRes;
      group = gRes.group;
    }

    var groupId = group.id;
    var members = group.members || [];
    var expenses = Array.isArray(preFetchedExpenses) ? preFetchedExpenses : (getSplitExpenses(groupId, ssTarget).expenses || []);

    var paidMap = {};
    var owedMap = {};

    members.forEach(function(m) {
      paidMap[m.id] = 0;
      owedMap[m.id] = 0;
    });

    var totalTripExpense = 0;

    expenses.forEach(function(exp) {
      totalTripExpense += (exp.amount || 0);

      var payerId = String(exp.payerId || "").trim();
      var payerName = String(exp.payerName || exp.payer || "").trim();
      var payerFamily = String(exp.payerFamily || "").trim();

      var payerIdLower = payerId.toLowerCase();
      var payerNameLower = payerName.toLowerCase();
      var payerFamilyLower = payerFamily.toLowerCase();

      var targetMember = members.find(function(m) {
        var mId = String(m.id || "").trim().toLowerCase();
        var mName = String(m.name || "").trim().toLowerCase();
        var mFam = String(m.family || m.familyTag || "").trim().toLowerCase();

        if (mId && (mId === payerIdLower || mId === payerNameLower)) return true;
        if (mName && (mName === payerNameLower || mName === payerIdLower)) return true;
        if (mFam && (mFam === payerNameLower || mFam === payerIdLower || (payerFamilyLower && mFam === payerFamilyLower))) return true;
        return false;
      });

      if (!targetMember && (payerNameLower || payerIdLower || payerFamilyLower)) {
        targetMember = members.find(function(m) {
          var mName = String(m.name || "").trim().toLowerCase();
          var mFam = String(m.family || m.familyTag || "").trim().toLowerCase();
          if (mName && (payerNameLower.indexOf(mName) >= 0 || payerIdLower.indexOf(mName) >= 0)) return true;
          if (mFam && (payerNameLower.indexOf(mFam) >= 0 || payerIdLower.indexOf(mFam) >= 0 || (payerFamilyLower && payerFamilyLower.indexOf(mFam) >= 0))) return true;
          return false;
        });
      }

      if (targetMember && paidMap[targetMember.id] !== undefined) {
        paidMap[targetMember.id] += (exp.amount || 0);
      } else if (payerId && paidMap[payerId] !== undefined) {
        paidMap[payerId] += (exp.amount || 0);
      } else if (members.length > 0) {
        paidMap[members[0].id] += (exp.amount || 0);
      }

      if (Array.isArray(exp.participants)) {
        exp.participants.forEach(function(p) {
          var pId = String(p.memberId || p.id || "").trim();
          var pName = String(p.name || "").trim();
          var pFam = String(p.family || p.familyName || "").trim();

          var pIdLower = pId.toLowerCase();
          var pNameLower = pName.toLowerCase();
          var pFamLower = pFam.toLowerCase();

          var pMember = members.find(function(m) {
            var mId = String(m.id || "").trim().toLowerCase();
            var mName = String(m.name || "").trim().toLowerCase();
            var mFam = String(m.family || m.familyTag || "").trim().toLowerCase();

            if (pIdLower && mId === pIdLower) return true;
            if (pNameLower && mName === pNameLower) return true;
            if (pFamLower && mFam === pFamLower) return true;
            return false;
          });

          var targetId = pMember ? pMember.id : pId;
          if (targetId && owedMap[targetId] !== undefined) {
            owedMap[targetId] += (Number(p.calculatedAmount) || 0);
          }
        });
      }
    });

    var memberBalances = [];
    var netZeroSum = 0;

    members.forEach(function(m) {
      var paid = paidMap[m.id] || 0;
      var owed = owedMap[m.id] || 0;
      var netBalance = paid - owed;
      netZeroSum += netBalance;

      var sortOrder = Number(m.sortOrder || m.sort_order) || 99;

      memberBalances.push({
        memberId: m.id,
        name: m.name,
        family: m.family || "Gia đình",
        type: m.type,
        isMe: Boolean(m.isMe || m.is_me || (m.name && String(m.name).toLowerCase().includes('tôi')) || (m.family && String(m.family).toLowerCase().includes('2f'))),
        sortOrder: sortOrder,
        paid: paid,
        owed: owed,
        netBalance: netBalance
      });
    });

    return {
      success: true,
      group: group,
      totalTripExpense: totalTripExpense,
      isNetZero: Math.abs(netZeroSum) < 0.01,
      netZeroSum: netZeroSum,
      memberBalances: memberBalances
    };
  } catch (err) {
    return { success: false, message: "Lỗi tính toán balance: " + err.toString() };
  }
}

/**
 * 2. OPTIMAL SETTLEMENT ENGINE (PAIRING DEBTORS & CREDITORS WITH FAMILY CONSOLIDATION)
 */
function calculateOptimalSettlements(groupIdOrGroupObj, options, ssTarget, preFetchedExpenses) {
  try {
    var bRes = calculateGroupBalances(groupIdOrGroupObj, ssTarget, preFetchedExpenses);
    if (!bRes.success) return bRes;

    var opt = options || {};
    var consolidateByFamily = opt.consolidateByFamily !== false; // Default true

    var pool = [];

    if (consolidateByFamily) {
      var familyMap = {};
      bRes.memberBalances.forEach(function(mb) {
        var famKey = mb.family || mb.name;
        if (!familyMap[famKey]) {
          familyMap[famKey] = {
            family: famKey,
            repId: mb.memberId,
            repName: mb.name,
            repSortOrder: mb.sortOrder || 99,
            isMe: mb.isMe,
            netBalance: 0,
            membersCount: 0
          };
        }
        familyMap[famKey].netBalance += mb.netBalance;
        familyMap[famKey].membersCount += 1;
        if (mb.isMe) {
          familyMap[famKey].repId = mb.memberId;
          familyMap[famKey].repName = mb.name;
          familyMap[famKey].isMe = true;
        } else if (!familyMap[famKey].isMe && ((mb.sortOrder || 99) < familyMap[famKey].repSortOrder)) {
          familyMap[famKey].repId = mb.memberId;
          familyMap[famKey].repName = mb.name;
          familyMap[famKey].repSortOrder = mb.sortOrder || 99;
        }
      });

      Object.keys(familyMap).forEach(function(fam) {
        var famTitle = String(familyMap[fam].family || "").trim();
        var repStr = String(familyMap[fam].repName || "").trim();
        var displayName = famTitle;

        var famUpper = famTitle.toUpperCase();
        var repUpper = repStr.toUpperCase();

        if (famUpper === "1F" || famUpper.includes("1F")) {
          if (repUpper.includes("HUÂN") || repUpper.includes("HUAN")) {
            displayName = "1F";
          } else if (repUpper.includes("TUYẾT ANH") || repUpper.includes("TUYET ANH") || (repUpper.includes("ANH") && !repUpper.includes("HUÂN"))) {
            displayName = "Tuyết Anh";
          } else {
            displayName = "1F";
          }
        } else {
          if (repStr && famTitle !== repStr && !famTitle.includes("(")) {
            displayName = famTitle + " (" + repStr + ")";
          }
        }

        pool.push({
          id: familyMap[fam].repId,
          name: displayName,
          family: familyMap[fam].family,
          isMe: familyMap[fam].isMe,
          netBalance: familyMap[fam].netBalance
        });
      });
    } else {
      pool = bRes.memberBalances.map(function(mb) {
        return {
          id: mb.memberId,
          name: mb.name,
          family: mb.family,
          isMe: mb.isMe,
          netBalance: mb.netBalance
        };
      });
    }

    var debtors = pool.filter(function(p) { return p.netBalance < -0.01; }).map(function(p) { return { id: p.id, name: p.name, isMe: p.isMe, netBalance: p.netBalance }; });
    var creditors = pool.filter(function(p) { return p.netBalance > 0.01; }).map(function(p) { return { id: p.id, name: p.name, isMe: p.isMe, netBalance: p.netBalance }; });

    debtors.sort(function(a, b) { return a.netBalance - b.netBalance; }); // most negative first
    creditors.sort(function(a, b) { return b.netBalance - a.netBalance; }); // most positive first

    var settlements = [];
    var dIdx = 0;
    var cIdx = 0;

    while (dIdx < debtors.length && cIdx < creditors.length) {
      var debtor = debtors[dIdx];
      var creditor = creditors[cIdx];

      var debtAmt = -debtor.netBalance;
      var creditAmt = creditor.netBalance;
      var transferAmt = Math.min(debtAmt, creditAmt);

      transferAmt = Math.round(transferAmt);

      if (transferAmt > 0) {
        settlements.push({
          id: generateSplitId("STL"),
          fromId: debtor.id,
          fromName: debtor.name,
          fromIsMe: Boolean(debtor.isMe),
          toId: creditor.id,
          toName: creditor.name,
          toIsMe: Boolean(creditor.isMe),
          amount: transferAmt,
          status: "PENDING"
        });
      }

      debtor.netBalance += transferAmt;
      creditor.netBalance -= transferAmt;

      if (Math.abs(debtor.netBalance) < 0.01) dIdx++;
      if (Math.abs(creditor.netBalance) < 0.01) cIdx++;
    }

    return {
      success: true,
      group: bRes.group,
      totalTripExpense: bRes.totalTripExpense,
      consolidatedByFamily: consolidateByFamily,
      memberBalances: bRes.memberBalances,
      settlements: settlements
    };
  } catch (err) {
    return { success: false, message: "Lỗi tính toán thanh toán: " + err.toString(), settlements: [] };
  }
}

/**
 * Helper format tên đối tượng công nợ cho gia đình 1F (A Huân vs Tuyết Anh)
 */
function formatDebtTargetName(nameStr) {
  var str = String(nameStr || "").trim();
  if (!str) return str;

  var upper = str.toUpperCase();
  if (upper.includes("1F")) {
    if (upper.includes("HUÂN") || upper.includes("HUAN")) {
      return "1F";
    }
    if (upper.includes("TUYẾT ANH") || upper.includes("TUYET ANH") || (upper.includes("ANH") && !upper.includes("HUÂN"))) {
      return "Tuyết Anh";
    }
    return "1F";
  }
  return str;
}

/**
 * 3. FINALIZE TRIP & EXPORT NET DEBTS 1-TIME TO MAIN DEBT SHEET (TAB 4 & TAB 1 ASSETS)
 */
function finalizeTripAndExportDebts(groupId, exportOptions, ssTarget) {
  try {
    var ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    var opt = exportOptions || {};

    // 1. Acquire DocumentLock if in Apps Script environment (INV-15)
    var lock = null;
    if (typeof LockService !== 'undefined' && LockService && typeof LockService.getDocumentLock === 'function') {
      lock = LockService.getDocumentLock();
      if (lock && typeof lock.tryLock === 'function') {
        var acquired = lock.tryLock(10000);
        if (!acquired) {
          return { success: false, message: "⚠️ Hệ thống đang xử lý giao dịch khác, vui lòng thử lại sau giây lát!" };
        }
      }
    }

    try {
      // 2. Read group status and enforce pre-validation (INV-05 & INV-09)
      var gSheet = getSplitGroupsSheetHelper(ss);
      if (!gSheet || gSheet.getLastRow() < 2) {
        return { success: false, message: "❌ Không tìm thấy sheet SplitGroups!" };
      }

      var gData = gSheet.getRange(2, 1, gSheet.getLastRow() - 1, Math.max(gSheet.getLastColumn(), 7)).getValues();
      var groupRowIndices = [];
      var currentStatus = "OPEN";
      var isLegacy = false;

      for (var i = 0; i < gData.length; i++) {
        if (String(gData[i][0]).trim() === String(groupId).trim()) {
          groupRowIndices.push(i + 2);
          var col6Str = String(gData[i][6] || "").trim();
          if (col6Str.startsWith("[") || col6Str.startsWith("{")) {
            isLegacy = true;
            currentStatus = String(gData[i][5] || "OPEN").trim().toUpperCase();
          } else {
            isLegacy = false;
            currentStatus = String(gData[i][4] || "OPEN").trim().toUpperCase();
          }
        }
      }

      if (groupRowIndices.length === 0) {
        return { success: false, message: "❌ Không tìm thấy nhóm!" };
      }

      if (currentStatus === "LOCKED") {
        return { success: false, message: "⚠️ Chuyến đi này đã được chốt nợ trước đó (LOCKED)!" };
      }

      var sRes = calculateOptimalSettlements(groupId, opt, ss);
      if (!sRes.success) return sRes;

      var group = sRes.group;
      var settlements = sRes.settlements || [];
      var batchId = generateSplitId("SET");
      var exportedCount = 0;

      // 3. Write Phase with Controlled Recovery by BatchID (INV-16)
      try {
        // Update group status to CLOSED (Kết thúc) in SplitGroups sheet
        groupRowIndices.forEach(function(rIdx) {
          if (isLegacy) {
            gSheet.getRange(rIdx, 6).setValue("CLOSED");
          } else {
            gSheet.getRange(rIdx, 5).setValue("CLOSED");
          }
        });

        var groupTitle = group.name || "";
        var gCatLower = String(group.category || "").toLowerCase();
        var nameLower = groupTitle.toLowerCase();
        var isDining = (gCatLower === 'dining' || nameLower.includes('ăn') || nameLower.includes('lòng') || nameLower.includes('tiệc') || nameLower.includes('nhậu') || nameLower.includes('cơm'));
        var prefix = isDining ? "Ăn chơi" : "Du lịch";

        var dVal = formatDateToYYYYMMDD(group.created_at || group.date);
        var dateShort = "";
        if (dVal) {
          var dParts = dVal.split('-');
          if (dParts.length === 3) dateShort = dParts[2] + "/" + dParts[1];
        }

        var cleanTitle = groupTitle
          .replace(/^\[Chốt\s*[^\]]*\]\s*/i, '')
          .replace(/^(Ăn chơi|Du lịch|Ăn uống)\s*[:\-]\s*/i, '')
          .trim();
        if (!cleanTitle) cleanTitle = groupTitle.trim();

        var formattedNoiDung = prefix + " : " + cleanTitle;
        var formattedGhiChu = isDining ? "[Chi phí ăn chơi] Chi phí thực tế gia đình gánh chịu" : "[Chi phí chuyến đi] Chi phí thực tế gia đình gánh chịu";

        // 1. Log family's actual share in Tab 2 (Family / ThuChi sheet) for monthly expense calculation (Hũ Giải trí, Nguồn tiền rỗng)
        var meFam = "";
        var meMbr = (group.members || []).find(function(m) {
          var mName = String(m.name || "").toLowerCase();
          var mFam = String(m.family || m.family_name || m.familyName || "").toLowerCase();
          return m.isMe || mName.includes("quậy") || mName.includes("chi") || mName.includes("chít") || mName.includes("tôi") || mName.includes("chủ ví") || mFam === "2f" || mFam.includes("2f") || mFam.includes("tôi") || mFam.includes("chủ ví");
        });
        if (meMbr) {
          meFam = String(meMbr.family || meMbr.family_name || meMbr.familyName || meMbr.name || "").trim().toLowerCase();
        }

        var meOwed = 0;
        if (sRes && sRes.memberBalances && sRes.memberBalances.length > 0) {
          // Pass 1: match members/families belonging to ME / 2F (Quậy, Chi, Chít, Chủ ví, Tôi)
          sRes.memberBalances.forEach(function(mb) {
            var fTag = String(mb.family || mb.name || "").trim().toLowerCase();
            var mName = String(mb.name || "").trim().toLowerCase();
            var isMyMember = mb.isMe ||
                             (meFam && fTag && (fTag === meFam || fTag.includes(meFam) || meFam.includes(fTag))) ||
                             (meFam && mName && (mName === meFam || mName.includes(meFam))) ||
                             fTag.includes("2f") || fTag.includes("tôi") || fTag.includes("chủ ví") ||
                             mName.includes("quậy") || mName.includes("chi") || mName.includes("chít") ||
                             mName.includes("tôi") || mName.includes("chủ ví");
            if (isMyMember) {
              meOwed += Number(mb.owed) || 0;
            }
          });

          // Pass 2: Fallback if meOwed is still 0 (try "1f" or first family in list)
          if (meOwed <= 0) {
            sRes.memberBalances.forEach(function(mb) {
              var fTag = String(mb.family || mb.name || "").trim().toLowerCase();
              if (fTag.includes("1f")) {
                meOwed += Number(mb.owed) || 0;
              }
            });
          }

          if (meOwed <= 0 && sRes.memberBalances.length > 0) {
            var firstFam = String(sRes.memberBalances[0].family || sRes.memberBalances[0].name || "").trim().toLowerCase();
            sRes.memberBalances.forEach(function(mb) {
              var fTag = String(mb.family || mb.name || "").trim().toLowerCase();
              if (fTag === firstFam) {
                meOwed += Number(mb.owed) || 0;
              }
            });
          }
        }

        if (meOwed > 0 && typeof saveFamilyTransaction === 'function') {
          var todayDateStr = formatDateToYYYYMMDD(dVal);
          saveFamilyTransaction({
            ngay: todayDateStr,
            loai: "CHI",
            hu: "Giải trí",
            noidung: formattedNoiDung,
            sotien: Math.round(meOwed),
            nguontien: "",
            codinh: false,
            ghichu: formattedGhiChu,
            status: "HOAN_TAT"
          }, ss);
        }

        // 2. Log net debt settlements to Tab 4 (Debt sheet)
        if (typeof saveDebtTransaction === 'function') {
          settlements.forEach(function(stl) {
            if (stl.amount <= 0) return;

            var fromTargetName = formatDebtTargetName(stl.fromName);
            var toTargetName = formatDebtTargetName(stl.toName);

            var toIsMe = Boolean(stl.toIsMe || (stl.toName && (stl.toName.toLowerCase().includes('tôi') || stl.toName.toLowerCase().includes('2f'))));
            var fromIsMe = Boolean(stl.fromIsMe || (stl.fromName && (stl.fromName.toLowerCase().includes('tôi') || stl.fromName.toLowerCase().includes('2f'))));

            if (toIsMe) {
              saveDebtTransaction({
                ten: fromTargetName,
                sotien: stl.amount,
                loai: "THU",
                nguon: "",
                noidung: formattedNoiDung,
                groupId: group.id,
                batchId: batchId,
                expenseSource: "TAB7_TRICOUNT"
              }, ss);
              exportedCount++;
            } else if (fromIsMe) {
              saveDebtTransaction({
                ten: toTargetName,
                sotien: stl.amount,
                loai: "TRA",
                nguon: "",
                noidung: formattedNoiDung,
                groupId: group.id,
                batchId: batchId,
                expenseSource: "TAB7_TRICOUNT"
              }, ss);
              exportedCount++;
            } else {
              saveDebtTransaction({
                ten: fromTargetName,
                sotien: stl.amount,
                loai: "THU",
                nguon: "",
                noidung: formattedNoiDung,
                groupId: group.id,
                batchId: batchId,
                expenseSource: "TAB7_TRICOUNT"
              }, ss);
              exportedCount++;
            }
          });
        }
      } catch (writeErr) {
        // Controlled Compensation Recovery by BatchID (INV-16)
        if (typeof removeDebtByBatchId === 'function') {
          removeDebtByBatchId(batchId, ss);
        }
        groupRowIndices.forEach(function(rIdx) {
          if (isLegacy) {
            gSheet.getRange(rIdx, 6).setValue("OPEN");
          } else {
            gSheet.getRange(rIdx, 5).setValue("OPEN");
          }
        });
        throw writeErr;
      }

      if (typeof clearAppDataCache === 'function') clearAppDataCache();

      var familyMsg = meOwed > 0 ? (" Đã ghi nhận " + Math.round(meOwed).toLocaleString() + " ¥ chi phí gia đình vào Tab 2 (Thu chi).") : "";
      return {
        success: true,
        message: "✅ Đã chốt nợ thành công!" + familyMsg + " (Đã kết xuất " + exportedCount + " công nợ vào Sổ Công Nợ).",
        exportedCount: exportedCount,
        batchId: batchId,
        settlements: settlements
      };
    } finally {
      if (lock && typeof lock.releaseLock === 'function') {
        lock.releaseLock();
      }
    }
  } catch (err) {
    return { success: false, message: "Lỗi kết thúc chuyến đi & kết xuất công nợ: " + err.toString() };
  }
}

/**
 * DEBT PAYMENT EVENT API WITH IDEMPOTENCY GUARD (INV-10)
 */
function t7_settleDebtPayment(debtId, walletName, ssTarget) {
  try {
    var cleanDebtId = String(debtId || "").trim();
    if (!cleanDebtId) return { success: false, message: "⚠️ Mã công nợ không hợp lệ!" };

    if (typeof settleDebtPayment === 'function') {
      return settleDebtPayment(cleanDebtId, walletName, ssTarget);
    }
    return { success: false, message: "❌ Không tìm thấy hàm settleDebtPayment!" };
  } catch (err) {
    return { success: false, message: "Lỗi tất toán công nợ: " + err.toString() };
  }
}

/**
 * Re-opens a closed split group back to OPEN status
 */
function reopenSplitGroup(groupId, ssTarget) {
  try {
    var ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    var cleanId = String(groupId || "").trim();
    if (!cleanId) return { success: false, message: "⚠️ Mã nhóm không hợp lệ!" };

    var gSheet = getSplitGroupsSheetHelper(ss);
    if (!gSheet || gSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet SplitGroups!" };

    var gData = gSheet.getRange(2, 1, gSheet.getLastRow() - 1, Math.max(gSheet.getLastColumn(), 7)).getValues();
    var updated = false;

    for (var i = 0; i < gData.length; i++) {
      if (String(gData[i][0]).trim() === cleanId) {
        var rIdx = i + 2;
        var col6Str = String(gData[i][6] || "").trim();
        if (col6Str.startsWith("[") || col6Str.startsWith("{")) {
          gSheet.getRange(rIdx, 6).setValue("OPEN");
        } else {
          gSheet.getRange(rIdx, 5).setValue("OPEN");
        }
        updated = true;
      }
    }

    if (!updated) return { success: false, message: "❌ Không tìm thấy nhóm để mở lại!" };

    if (typeof clearAppDataCache === 'function') clearAppDataCache();

    return { success: true, message: "🔓 Đã mở lại chuyến đi thành công! Bạn có thể nhấn Chốt nợ lại." };
  } catch (err) {
    return { success: false, message: "Lỗi mở lại nhóm: " + err.toString() };
  }
}

/**
 * Fast bundled data fetch for active group (Group info + Expenses + Balances + Settlements in 1 call)
 */
function getTab7FullGroupData(groupId, ssTarget) {
  try {
    var cleanId = String(groupId || "").trim();
    if (!cleanId) return { success: false, message: "⚠️ Mã nhóm không hợp lệ!" };

    var ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    var gRes = getSplitGroupById(cleanId, ss);
    if (!gRes.success) return gRes;

    var group = gRes.group;
    var expRes = getSplitExpenses(cleanId, ss);
    var expenses = expRes.success ? expRes.expenses : [];

    var balRes = calculateGroupBalances(group, ss, expenses);
    var stlRes = calculateOptimalSettlements(group, { consolidateByFamily: true }, ss, expenses);

    return {
      success: true,
      group: group,
      expenses: expenses,
      memberBalances: balRes.success ? balRes.memberBalances : [],
      settlements: stlRes.success ? stlRes.settlements : []
    };
  } catch (err) {
    return { success: false, message: "Lỗi tải dữ liệu nhóm: " + err.toString() };
  }
}

// Node.js module exports for unit testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SHEET_SPLIT_GROUPS: SHEET_SPLIT_GROUPS,
    SHEET_SPLIT_EXPENSES: SHEET_SPLIT_EXPENSES,
    SHEET_SPLIT_FAMILIES: SHEET_SPLIT_FAMILIES,
    getSplitGroupsSheetHelper: getSplitGroupsSheetHelper,
    getSplitExpensesSheetHelper: getSplitExpensesSheetHelper,
    getSplitFamiliesSheetHelper: getSplitFamiliesSheetHelper,
    generateSplitId: generateSplitId,
    getSplitGroups: getSplitGroups,
    getSplitGroupById: getSplitGroupById,
    getTab7FullGroupData: getTab7FullGroupData,
    saveSplitGroup: saveSplitGroup,
    deleteSplitGroup: deleteSplitGroup,
    addMemberToSplitGroup: addMemberToSplitGroup,
    removeMemberFromSplitGroup: removeMemberFromSplitGroup,
    calculateExpenseShares: calculateExpenseShares,
    getSplitExpenses: getSplitExpenses,
    saveSplitExpense: saveSplitExpense,
    deleteSplitExpense: deleteSplitExpense,
    calculateGroupBalances: calculateGroupBalances,
    calculateOptimalSettlements: calculateOptimalSettlements,
    finalizeTripAndExportDebts: finalizeTripAndExportDebts,
    reopenSplitGroup: reopenSplitGroup,
    getSplitFamilies: getSplitFamilies,
    saveSplitFamilyMember: saveSplitFamilyMember,
    deleteSplitFamilyMember: deleteSplitFamilyMember,
    deleteSplitFamilyEntirely: deleteSplitFamilyEntirely
  };
}
