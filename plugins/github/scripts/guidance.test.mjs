import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  END_MARKER,
  inspectText,
  renderBlock,
  renderBody,
  renderPatterns,
  writeBlock,
} from './lib/guidance.mjs';

test('patterns render by count', () => {
  assert.equal(renderPatterns(['main']), '`main`');
  assert.equal(renderPatterns(['main', 'release/**/*']), '`main` or `release/**/*`');
  assert.equal(renderPatterns(['a', 'b', 'c']), '`a`, `b`, or `c`');
});

test('the body is exactly three lines and the hash is the first 12 hex digits of its sha256', () => {
  const body = renderBody(['main', 'release/**/*']);
  assert.equal(body, 'Never commit or push to `main` or `release/**/*`. Create a topic branch\n'
    + 'first (`git switch -c <type>/<short-description>`) and open a pull\n'
    + 'request instead.\n');
  const { hash, block } = renderBlock(['main', 'release/**/*']);
  assert.equal(hash, createHash('sha256').update(body).digest('hex').slice(0, 12));
  assert.equal(block, `<!-- jcouball-github guardrails: begin sha256:${hash} -->\n${body}${END_MARKER}\n`);
});

test('inspect classifies absent, current, stale, edited, and malformed', () => {
  const current = renderBlock(['main']);
  const old = renderBlock(['main', 'master']);
  assert.equal(inspectText('# Title\n', ['main']).classification, 'absent');
  assert.equal(inspectText(`# Title\n\n${current.block}`, ['main']).classification, 'machine-current');
  assert.equal(inspectText(`# Title\n\n${old.block}`, ['main']).classification, 'machine-stale');
  const edited = current.block.replace('Never commit', 'Please never commit');
  assert.equal(inspectText(edited, ['main']).classification, 'edited');
  assert.equal(inspectText(`${current.block}${current.block}`, ['main']).classification, 'malformed');
  assert.equal(inspectText(`${END_MARKER}\n<!-- jcouball-github guardrails: begin sha256:${current.hash} -->\n`, ['main']).classification, 'malformed');
  assert.equal(inspectText(`${END_MARKER}\n`, ['main']).classification, 'malformed');
});

test('write appends to a file without markers, separated by a blank line', () => {
  const { block } = renderBlock(['main']);
  assert.deepEqual(writeBlock('', ['main']), { text: block, action: 'appended' });
  assert.deepEqual(writeBlock('# Title\n', ['main']), { text: `# Title\n\n${block}`, action: 'appended' });
  assert.deepEqual(writeBlock('# Title', ['main']), { text: `# Title\n\n${block}`, action: 'appended' });
  assert.deepEqual(writeBlock('# Title\n\n', ['main']), { text: `# Title\n\n${block}`, action: 'appended' });
});

test('write rewrites a stale block in place, marker and body both', () => {
  const old = renderBlock(['main', 'master']);
  const current = renderBlock(['main']);
  const before = `# Title\n\n${old.block}\nTrailing text.\n`;
  const result = writeBlock(before, ['main']);
  assert.equal(result.action, 'rewritten');
  assert.equal(result.text, `# Title\n\n${current.block}\nTrailing text.\n`);
  assert.equal(inspectText(result.text, ['main']).classification, 'machine-current');
});

test('write leaves a current block alone and refuses edited or malformed files', () => {
  const current = renderBlock(['main']);
  assert.equal(writeBlock(current.block, ['main']).action, 'unchanged');
  assert.match(writeBlock(current.block.replace('Never', 'Always'), ['main']).error, /edited/);
  assert.match(writeBlock(`${current.block}${current.block}`, ['main']).error, /malformed/);
});

test('a CRLF file is matched as its LF text and written back in CRLF', () => {
  const crlf = (text) => text.replace(/\n/g, '\r\n');
  const current = renderBlock(['main']);
  const old = renderBlock(['main', 'master']);
  const file = crlf(`# Title\n\n${current.block}`);
  assert.equal(inspectText(file, ['main']).classification, 'machine-current');
  assert.deepEqual(writeBlock(file, ['main']), { text: file, action: 'unchanged' });
  assert.deepEqual(writeBlock('# Title\r\n', ['main']), { text: file, action: 'appended' });
  const rewritten = writeBlock(crlf(`# Title\n\n${old.block}\nTrailing text.\n`), ['main']);
  assert.equal(rewritten.action, 'rewritten');
  assert.equal(rewritten.text, crlf(`# Title\n\n${current.block}\nTrailing text.\n`));
  assert.equal(inspectText(crlf(edited(current.block)), ['main']).classification, 'edited');
});

function edited(block) {
  return block.replace('Never commit', 'Please never commit');
}
