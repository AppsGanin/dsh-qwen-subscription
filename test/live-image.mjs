/**
 * Live image turn: the adapter must project a retained image into the provider's
 * `image_url` form and the model must actually see it. The attachment store is
 * stubbed with a generated solid-red PNG so the expectation is unambiguous.
 *
 *   node test/live-image.mjs [model]
 */
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { QwenAdapter } from '../lib/adapter.js'
import { QwenAuth } from '../lib/auth.js'

const SIZE = 32;

/** CRC-32 table used by the PNG chunk framing. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Build one solid-colour RGB PNG. */
function solidPng(red, green, blue, size = SIZE) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x += 1) {
      row[1 + x * 3] = red;
      row[2 + x * 3] = green;
      row[3 + x * 3] = blue;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const model = process.argv[2] ?? 'qwen3.8-flash';
const png = solidPng(220, 20, 20);
const attachment = { attachmentId: 'att_red', mediaType: 'image/png', bytes: png.length, width: SIZE, height: SIZE };
const attachments = {
  async readImageRequest(ref) {
    assert.equal(ref.attachmentId, 'att_red', 'the adapter asked for the retained image');
    return { mediaType: 'image/png', data: png, bytes: png.length, width: SIZE, height: SIZE };
  },
};

const adapter = new QwenAdapter({
  auth: new QwenAuth({ logger: { debug() {} } }),
  attachments: () => attachments,
});

/** Ask once; a live model occasionally answers nothing, so one retry is allowed. */
async function ask() {
  const chunks = [];
  for await (const chunk of adapter.stream({
    provider: 'qwen',
    model,
    reasoningEffort: 'off',
    maxTokens: 128,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', attachment },
        { type: 'text', text: 'Which single colour fills this image? Answer with one English word only.' },
      ],
    }],
  })) chunks.push(chunk);
  const answer = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('');
  return { chunks, answer };
}

let { chunks, answer } = await ask();
if (!/red|красн/i.test(answer)) ({ chunks, answer } = await ask());

const text = answer;
const finish = chunks[chunks.length - 1];
assert.equal(finish.type, 'finish', 'the image turn ended with a finish chunk');
assert.notEqual(finish.reason.kind, 'error', 'the image turn did not fail: ' + JSON.stringify(finish.reason));
assert.ok(/red|красн/i.test(text), 'the model saw the red image, got: ' + JSON.stringify(text.slice(0, 120)));
const usage = chunks.find((chunk) => chunk.type === 'usage');
assert.ok(usage !== undefined && usage.usage.inputTokens > 0, 'the image turn reported usage');
process.stdout.write('  ok  image answered: ' + JSON.stringify(text.trim().slice(0, 80)) + '\n');
process.stdout.write('  ok  usage: ' + JSON.stringify(usage.usage) + '\n');
process.stdout.write('live image turn passed\n');