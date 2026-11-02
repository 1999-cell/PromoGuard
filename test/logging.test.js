'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { ignoreBrokenPipe } = require('../src/logging/output-streams');

test('closed stdout/stderr pipes do not crash the app', () => {
  const stream = new EventEmitter();
  ignoreBrokenPipe(stream);
  assert.doesNotThrow(() => stream.emit('error', Object.assign(new Error('closed pipe'), { code: 'EPIPE' })));
});

test('output stream errors other than EPIPE remain visible', () => {
  const stream = new EventEmitter();
  ignoreBrokenPipe(stream);
  assert.throws(
    () => stream.emit('error', Object.assign(new Error('disk failure'), { code: 'EIO' })),
    /disk failure/
  );
});
