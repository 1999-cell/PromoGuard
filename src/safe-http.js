'use strict';

const dns = require('dns');
const https = require('https');
const net = require('net');

const blockedV4 = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
].forEach(([address, prefix]) => blockedV4.addSubnet(address, prefix, 'ipv4'));

function ipv6Value(address) {
  let value = address.toLowerCase().split('%')[0];
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    const octets = value.slice(lastColon + 1).split('.').map(Number);
    if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    value = `${value.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

function isPublicIp(address) {
  const version = net.isIP(address);
  if (version === 4) return !blockedV4.check(address, 'ipv4');
  if (version !== 6) return false;
  const value = ipv6Value(address);
  if (value === null) return false;
  const globalUnicast = value >= 0x20000000000000000000000000000000n && value < 0x40000000000000000000000000000000n;
  if (!globalUnicast) return false;
  const specialRanges = [
    [0x20010000000000000000000000000000n, 0x20010200000000000000000000000000n],
    [0x20010db8000000000000000000000000n, 0x20010dc0000000000000000000000000n],
    [0x20020000000000000000000000000000n, 0x20030000000000000000000000000000n]
  ];
  return !specialRanges.some(([start, end]) => value >= start && value < end);
}

function resolveHost(host) {
  return new Promise(resolve => {
    dns.lookup(host, { all: true, verbatim: true }, (error, records) => {
      if (error) {
        resolve({ host, addresses: [], error: error.code || 'lookup failed' });
        return;
      }
      resolve({ host, addresses: records.map(record => record.address), error: null });
    });
  });
}

function responseFrom(status, headers, body, resolvedAddresses) {
  let read = false;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: name => headers[name.toLowerCase()] || null },
    resolvedAddresses,
    body: {
      getReader: () => ({
        read: async () => {
          if (read) return { done: true };
          read = true;
          return { done: false, value: body };
        },
        cancel: async () => { read = true; }
      })
    }
  };
}

function requestPinned(url, address, { timeoutMs, signal, headers, maxBytes, tooLargeMessage }) {
  return new Promise((resolve, reject) => {
    const ipVersion = net.isIP(address);
    const options = {
      protocol: 'https:',
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers,
      agent: false,
      lookup: (_hostname, _options, callback) => callback(null, address, ipVersion),
      ...(ipVersion ? {} : { servername: url.hostname })
    };
    const request = https.request(options, response => {
      const chunks = [];
      let total = 0;
      response.on('data', chunk => {
        total += chunk.length;
        if (total > maxBytes) {
          request.destroy(new Error(tooLargeMessage));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(responseFrom(response.statusCode || 0, response.headers, Buffer.concat(chunks), [address])));
      response.on('error', reject);
    });
    const abort = () => request.destroy(new Error('request aborted'));
    if (signal) {
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      request.once('close', () => signal.removeEventListener('abort', abort));
    }
    request.setTimeout(timeoutMs, () => request.destroy(new Error('request timeout')));
    request.on('error', reject);
    request.end();
  });
}

async function fetchPublicHttps(rawUrl, {
  fetchImpl,
  requestImpl = requestPinned,
  resolveHostImpl = resolveHost,
  timeoutMs = 15000,
  signal,
  headers = {},
  maxBytes = 2_000_000,
  tooLargeMessage = 'response too large'
} = {}) {
  const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('unsafe url');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const version = net.isIP(host);
  const resolution = version
    ? { host, addresses: [host], error: null }
    : await resolveHostImpl(host);
  if (resolution.error || !resolution.addresses.length || resolution.addresses.some(address => !isPublicIp(address))) {
    throw new Error('host does not resolve exclusively to public IP addresses');
  }
  const options = { redirect: 'manual', signal, headers };
  if (fetchImpl) {
    const response = await fetchImpl(url.href, options);
    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      body: response.body,
      resolvedAddresses: resolution.addresses
    };
  }
  return requestImpl(url, resolution.addresses[0], { timeoutMs, signal, headers, maxBytes, tooLargeMessage });
}

module.exports = { fetchPublicHttps, isPublicIp, resolveHost };
