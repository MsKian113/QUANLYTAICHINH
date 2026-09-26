const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.Logger = { log: () => {} };

test('doGet evaluates Index template with initialDataJson set', () => {
  let templateObj = {};
  
  global.HtmlService = {
    createTemplateFromFile: (filename) => {
      assert.strictEqual(filename, 'Index');
      templateObj = {
        initialDataJson: undefined,
        evaluate: function() {
          return {
            setTitle: function(t) {
              return {
                addMetaTag: function(name, content) {
                  return { title: t, meta: { name, content }, initialDataJson: templateObj.initialDataJson };
                }
              };
            }
          };
        }
      };
      return templateObj;
    }
  };

  global.CacheService = {
    getScriptCache: () => ({
      get: () => null,
      put: () => {},
      remove: () => {}
    })
  };

  global.SpreadsheetApp = {
    getActiveSpreadsheet: () => null
  };

  const mainCode = fs.readFileSync(path.join(__dirname, '../src/Server_Main.js'), 'utf8');
  eval(mainCode);

  const res = doGet({});
  assert.ok(res);
  assert.notStrictEqual(res.initialDataJson, undefined, 'doGet must set initialDataJson on the HTML template');
  assert.notStrictEqual(res.initialDataJson, null, 'initialDataJson must not be null/undefined');
});

test('doPost routes REST API calls correctly for external clients', () => {
  global.ContentService = {
    MimeType: { JSON: 'JSON' },
    createTextOutput: (str) => ({
      setMimeType: (mime) => ({ content: str, mime: mime })
    })
  };

  global.getBusinessData = (month, year) => ({ success: true, summary: { sales: 100 } });

  const mainCode = fs.readFileSync(path.join(__dirname, '../src/Server_Main.js'), 'utf8');
  eval(mainCode);

  const res = doPost({
    postData: {
      contents: JSON.stringify({ action: 'getBusinessData', data: { month: '9', year: '2026' } })
    }
  });

  assert.ok(res);
  const parsed = JSON.parse(res.content);
  assert.strictEqual(parsed.success, true);
  assert.strictEqual(parsed.summary.sales, 100);
});

test('Code.js does not contain duplicate doGet or saveFamilyTransaction functions', () => {
  const codeJs = fs.readFileSync(path.join(__dirname, '../src/Code.js'), 'utf8');
  assert.strictEqual(/function\s+doGet\s*\(/.test(codeJs), false, 'Code.js should not define duplicate doGet');
  assert.strictEqual(/function\s+saveFamilyTransaction\s*\(/.test(codeJs), false, 'Code.js should not define duplicate saveFamilyTransaction');
});
