const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUsername, isValidUsername, isValidEmail, parseImageUrl, parseId, parseLimit, escapeLike } = require('../server/lib/validate');

test('usernames are lower-cased, stripped of @, and restricted to safe characters', () => {
  assert.equal(normalizeUsername('  @Ada_L  '), 'ada_l');
  assert.ok(isValidUsername('ada_l99'));
  for (const bad of ['ab', 'has space', 'dash-name', 'a'.repeat(31), '', 'émile']) {
    assert.equal(isValidUsername(bad), false, bad);
  }
});

test('emails need a name, an @, and a domain', () => {
  assert.ok(isValidEmail('a@b.co'));
  assert.equal(isValidEmail('no-at-sign.com'), false);
  assert.equal(isValidEmail('a@b'), false);
});

test('image links must be http(s); empty is allowed; everything else is rejected', () => {
  assert.equal(parseImageUrl(''), '');
  assert.equal(parseImageUrl(undefined), '');
  assert.equal(parseImageUrl('https://example.com/a.png'), 'https://example.com/a.png');
  assert.equal(parseImageUrl('javascript:alert(1)'), null);
  assert.equal(parseImageUrl('data:image/png;base64,AAAA'), null);
  assert.equal(parseImageUrl('not a url'), null);
  assert.equal(parseImageUrl('https://example.com/' + 'a'.repeat(500)), null);
});

test('ids and limits are parsed defensively', () => {
  assert.equal(parseId('12'), 12);
  for (const bad of ['0', '-1', '1.5', 'abc', undefined, '1e3x']) assert.equal(parseId(bad), null, String(bad));
  assert.equal(parseLimit(undefined), 10);
  assert.equal(parseLimit('5'), 5);
  assert.equal(parseLimit('999'), 30);
  assert.equal(parseLimit('-3'), 10);
});

test('LIKE wildcards in search terms are escaped', () => {
  assert.equal(escapeLike('50%_off'), '50\\%\\_off');
});
