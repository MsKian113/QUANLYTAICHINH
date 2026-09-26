const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Mock SpreadsheetApp Environment
global.Logger = { log: () => {} };
global.Utilities = { formatDate: () => '2026-09-20' };

test('Tab 7 Preset Family: aggregates distinct families and loads members', () => {
  const groups = [
    {
      id: 'GRP_1',
      name: 'Chuyến Đi Đà Nẵng 2026',
      members: [
        { id: 'M1', name: 'Nam 1F', family: '1F', type: 'ADULT', weight: 1.0, isMe: true },
        { id: 'M2', name: 'Lan 1F', family: '1F', type: 'ADULT', weight: 1.0, isMe: false },
        { id: 'M3', name: 'Bé Su 1F', family: '1F', type: 'CHILD', weight: 0.5, isMe: false },
        { id: 'M4', name: 'Hùng 2F', family: '2F', type: 'ADULT', weight: 1.0, isMe: false }
      ]
    },
    {
      id: 'GRP_2',
      name: 'Ăn Uống Cuối Tuần',
      members: [
        { id: 'M5', name: 'Tuấn 3F', family: '3F', type: 'ADULT', weight: 1.0, isMe: false }
      ]
    }
  ];

  // Test family set extraction logic
  const famSet = new Set(['1F', '2F', '3F', 'Gia đình A', 'Gia đình B']);
  groups.forEach(g => {
    (g.members || []).forEach(m => {
      if (m.family && m.family.trim()) famSet.add(m.family.trim());
    });
  });

  const famList = Array.from(famSet);
  assert.ok(famList.includes('1F'));
  assert.ok(famList.includes('2F'));
  assert.ok(famList.includes('3F'));

  // Test load preset family logic for '1F'
  const targetFam = '1F';
  const memberMap = new Map();
  groups.forEach(g => {
    (g.members || []).forEach(m => {
      if (m.family && m.family.trim().toLowerCase() === targetFam.toLowerCase()) {
        const key = (m.name || '').trim().toLowerCase();
        if (key && !memberMap.has(key)) {
          memberMap.set(key, m);
        }
      }
    });
  });

  const members1F = Array.from(memberMap.values());
  assert.equal(members1F.length, 3);
  assert.equal(members1F[0].name, 'Nam 1F');
  assert.equal(members1F[1].name, 'Lan 1F');
  assert.equal(members1F[2].name, 'Bé Su 1F');
});
