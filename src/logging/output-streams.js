'use strict';

function ignoreBrokenPipe(stream) {
  stream.on('error', error => {
    if (error.code !== 'EPIPE') throw error;
  });
}

module.exports = { ignoreBrokenPipe };
