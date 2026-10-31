import {strict as assert} from 'node:assert';
import {describe, it} from 'node:test';
import {parseMouseHoverTime} from '../interaction';

describe('Windows task hover timing', () => {
  it('uses the actual Windows preference, including slower custom values', () => {
    assert.equal(parseMouseHoverTime('HKEY_CURRENT_USER\\Control Panel\\Mouse\r\n    MouseHoverTime    REG_SZ    400\r\n'), 400);
    assert.equal(parseMouseHoverTime('    MouseHoverTime    REG_SZ    1250\r\n'), 1250);
    assert.equal(parseMouseHoverTime('    MouseHoverTime    REG_DWORD    0x320\r\n'), 800);
  });
  it('falls back safely for absent, malformed and unreasonable preferences', () => {
    for (const output of ['', 'MouseHoverTime REG_SZ nope', 'MouseHoverTime REG_SZ 0', 'MouseHoverTime REG_SZ 999999999', 'MouseHoverTime REG_SZ 400 trailing']) assert.equal(parseMouseHoverTime(output), 400);
  });
});
