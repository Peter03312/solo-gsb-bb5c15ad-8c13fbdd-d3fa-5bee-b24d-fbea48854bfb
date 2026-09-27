'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseTolerance,
  computeReliableArcs,
  degInReliableArc,
  reliableDetents,
} = require('../src/tolerance');
const { computeSeamAvoidance } = require('../src/seamMath');
const { computeMultiSpec } = require('../src/multiSpec');

function approx(actual, expected, eps = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} !≈ ${expected}`);
}

function arcPairs(arcs) {
  return arcs.map((a) => [a.startDeg, a.endDeg, !!a.wraps, !!a.point]);
}

/* ---------------- 参数解析 ---------------- */

test('parseTolerance: 未提供返回 null', () => {
  assert.equal(parseTolerance(undefined), null);
  assert.equal(parseTolerance(null), null);
});

test('parseTolerance: 合法参数原样返回；零误差允许', () => {
  assert.deepEqual(parseTolerance({ ccwDeg: 2, cwDeg: 3 }), { ccwDeg: 2, cwDeg: 3 });
  assert.deepEqual(parseTolerance({ ccwDeg: 0, cwDeg: 0 }), { ccwDeg: 0, cwDeg: 0 });
});

test('parseTolerance: 非法误差抛错（负值/非数值/缺字段/非对象）', () => {
  assert.throws(() => parseTolerance({ ccwDeg: -1, cwDeg: 0 }), RangeError);
  assert.throws(() => parseTolerance({ ccwDeg: 0, cwDeg: -0.5 }), RangeError);
  assert.throws(() => parseTolerance({ ccwDeg: NaN, cwDeg: 0 }), RangeError);
  assert.throws(() => parseTolerance({ ccwDeg: Infinity, cwDeg: 0 }), RangeError);
  assert.throws(() => parseTolerance({ ccwDeg: '2', cwDeg: 0 }), RangeError);
  assert.throws(() => parseTolerance({ ccwDeg: 2 }), RangeError); // 缺 cwDeg
  assert.throws(() => parseTolerance({ cwDeg: 2 }), RangeError); // 缺 ccwDeg
  assert.throws(() => parseTolerance('x'), TypeError);
  assert.throws(() => parseTolerance(5), TypeError);
  assert.throws(() => parseTolerance([1, 2]), TypeError);
});

/* ---------------- 可靠段几何 ---------------- */

test('computeReliableArcs: 安全弧两端内缩（逆时针缩起点、顺时针缩终点）', () => {
  const { arcs } = computeReliableArcs(
    [{ startDeg: 90, endDeg: 360, wraps: false, widthDeg: 270 }],
    { ccwDeg: 10, cwDeg: 20 }
  );
  assert.deepEqual(arcPairs(arcs), [[100, 340, false, false]]);
  approx(arcs[0].widthDeg, 240);
});

test('computeReliableArcs: 跨零安全弧内缩后仍跨零', () => {
  const { arcs } = computeReliableArcs(
    [{ startDeg: 270, endDeg: 90, wraps: true, widthDeg: 180 }],
    { ccwDeg: 30, cwDeg: 30 }
  );
  assert.deepEqual(arcPairs(arcs), [[300, 60, true, false]]);
  approx(arcs[0].widthDeg, 120);
});

test('computeReliableArcs: 内缩后末端恰在整圈边界时写作 360 不跨零', () => {
  // 安全弧 216°→36°（跨零，宽 180）；误差 36/36 → 可靠 252°→360°
  const { arcs } = computeReliableArcs(
    [{ startDeg: 216, endDeg: 36, wraps: true, widthDeg: 180 }],
    { ccwDeg: 36, cwDeg: 36 }
  );
  assert.deepEqual(arcPairs(arcs), [[252, 360, false, false]]);
  approx(arcs[0].widthDeg, 108);
});

test('computeReliableArcs: 收缩后仅剩一个点', () => {
  const { arcs } = computeReliableArcs(
    [{ startDeg: 90, endDeg: 360, wraps: false, widthDeg: 270 }],
    { ccwDeg: 135, cwDeg: 135 }
  );
  assert.equal(arcs.length, 1);
  assert.equal(arcs[0].point, true);
  approx(arcs[0].startDeg, 225);
  approx(arcs[0].widthDeg, 0);
});

test('computeReliableArcs: 内缩后宽度为负的弧被丢弃', () => {
  const { arcs } = computeReliableArcs(
    [
      { startDeg: 0, endDeg: 10, wraps: false, widthDeg: 10 }, // 总宽 20 → 消失
      { startDeg: 90, endDeg: 180, wraps: false, widthDeg: 90 }, // → [110, 160]
    ],
    { ccwDeg: 20, cwDeg: 20 }
  );
  assert.deepEqual(arcPairs(arcs), [[110, 160, false, false]]);
});

test('computeReliableArcs: 整圈安全时任意误差均整圈可靠（含总宽 ≥360°）', () => {
  const full = [{ startDeg: 0, endDeg: 0, wraps: false, widthDeg: 360, full: true }];
  for (const tol of [{ ccwDeg: 0, cwDeg: 0 }, { ccwDeg: 10, cwDeg: 20 }, { ccwDeg: 200, cwDeg: 200 }]) {
    const r = computeReliableArcs(full, tol);
    assert.equal(r.full, true);
    assert.equal(r.arcs[0].full, true);
  }
});

test('computeReliableArcs: 误差总宽达到 360° 时仅整圈安全有解', () => {
  const arcs = [{ startDeg: 90, endDeg: 360, wraps: false, widthDeg: 270 }];
  const r = computeReliableArcs(arcs, { ccwDeg: 180, cwDeg: 180 });
  assert.equal(r.full, false);
  assert.deepEqual(r.arcs, []);
  // 超过 360° 同样无解
  assert.deepEqual(computeReliableArcs(arcs, { ccwDeg: 400, cwDeg: 0 }).arcs, []);
  // 整圈安全则有解
  assert.equal(
    computeReliableArcs([{ full: true, widthDeg: 360 }], { ccwDeg: 180, cwDeg: 180 }).full,
    true
  );
});

test('computeReliableArcs: 零误差时可靠段等于安全段', () => {
  const safe = [
    { startDeg: 30, endDeg: 90, wraps: false, widthDeg: 60 },
    { startDeg: 200, endDeg: 260, wraps: false, widthDeg: 60 },
  ];
  const { arcs } = computeReliableArcs(safe, { ccwDeg: 0, cwDeg: 0 });
  assert.deepEqual(arcPairs(arcs), [
    [30, 90, false, false],
    [200, 260, false, false],
  ]);
});

test('degInReliableArc: 含边界、跨零与单点段', () => {
  const arc = { startDeg: 300, endDeg: 60, wraps: true, widthDeg: 120 };
  assert.equal(degInReliableArc(300, arc), true);
  assert.equal(degInReliableArc(0, arc), true);
  assert.equal(degInReliableArc(60, arc), true);
  assert.equal(degInReliableArc(180, arc), false);
  const point = { startDeg: 225, endDeg: 225, wraps: false, widthDeg: 0, point: true };
  assert.equal(degInReliableArc(225, point), true);
  assert.equal(degInReliableArc(226, point), false);
  assert.equal(degInReliableArc(123, { full: true }), true);
});

/* ---------------- 单规格集成 ---------------- */

test('单规格：tolerance 基于可行段内缩并附毫米换算', () => {
  // C=360、W=0、保护区 [0,90] → 可行段 90°→360°；误差 10/20 → 可靠 100°→340°
  const r = computeSeamAvoidance(360, 0, [{ start: 0, end: 90 }], null, null, {
    ccwDeg: 10,
    cwDeg: 20,
  });
  assert.ok(r.tolerance);
  assert.equal(r.tolerance.ccwDeg, 10);
  assert.equal(r.tolerance.cwDeg, 20);
  approx(r.tolerance.totalDeg, 30);
  assert.equal(r.tolerance.reliableFull, false);
  assert.equal(r.tolerance.reliableEmpty, false);
  assert.equal(r.tolerance.reliable.length, 1);
  const a = r.tolerance.reliable[0];
  approx(a.startDeg, 100);
  approx(a.endDeg, 340);
  approx(a.widthDeg, 240);
  approx(a.startMm, 100);
  approx(a.endMm, 340);
  approx(a.widthMm, 240);
  assert.deepEqual(r.tolerance.detents, { enabled: false });
});

test('单规格：未传误差时保持原响应（无 tolerance 字段）', () => {
  const r = computeSeamAvoidance(360, 0, [{ start: 0, end: 90 }]);
  assert.equal('tolerance' in r, false);
  const r2 = computeSeamAvoidance(360, 0, [{ start: 0, end: 90 }], { enabled: true, steps: 12 });
  assert.equal('tolerance' in r2, false);
});

test('单规格：无解/整圈安全/单点/总宽 360° 的可靠段', () => {
  // 无解 → 可靠段为空
  const noSol = computeSeamAvoidance(400, 50, [
    { start: 0, end: 180 },
    { start: 150, end: 400 },
  ], null, null, { ccwDeg: 5, cwDeg: 5 });
  assert.equal(noSol.tolerance.reliableEmpty, true);
  assert.deepEqual(noSol.tolerance.reliable, []);

  // 整圈安全 → 整圈可靠
  const full = computeSeamAvoidance(400, 20, [], null, null, { ccwDeg: 45, cwDeg: 45 });
  assert.equal(full.tolerance.reliableFull, true);
  assert.equal(full.tolerance.reliable[0].full, true);

  // 收缩为单点
  const pt = computeSeamAvoidance(360, 0, [{ start: 0, end: 90 }], null, null, {
    ccwDeg: 135,
    cwDeg: 135,
  });
  assert.equal(pt.tolerance.reliable.length, 1);
  assert.equal(pt.tolerance.reliable[0].point, true);
  approx(pt.tolerance.reliable[0].startDeg, 225);

  // 总宽 360° 且非整圈安全 → 空
  const over = computeSeamAvoidance(360, 0, [{ start: 0, end: 90 }], null, null, {
    ccwDeg: 180,
    cwDeg: 180,
  });
  assert.equal(over.tolerance.reliableEmpty, true);
});

test('单规格 + 档位：列出落在可靠段内的全部档位', () => {
  // 可行段 90°→360°；误差 30/30 → 可靠 120°→330°；12 档中 120..330 共 8 档
  const r = computeSeamAvoidance(360, 0, [{ start: 0, end: 90 }], {
    enabled: true,
    steps: 12,
  }, null, { ccwDeg: 30, cwDeg: 30 });
  const d = r.tolerance.detents;
  assert.equal(d.enabled, true);
  assert.equal(d.noAvailable, false);
  assert.deepEqual(
    d.available.map((x) => x.deg),
    [120, 150, 180, 210, 240, 270, 300, 330]
  );
  // 可靠档位带毫米位置
  approx(d.available[0].mm, 120);
});

test('单规格 + 档位：单点可靠段上的档位仍算可靠', () => {
  // 可行段 90°→360°（宽 270），误差 135/135 → 单点 225°；8 档中 225° 是第 6 档
  const r = computeSeamAvoidance(360, 0, [{ start: 0, end: 90 }], {
    enabled: true,
    steps: 8,
  }, null, { ccwDeg: 135, cwDeg: 135 });
  assert.equal(r.tolerance.reliable[0].point, true);
  assert.deepEqual(
    r.tolerance.detents.available.map((x) => [x.index, x.deg]),
    [[5, 225]]
  );
});

test('单规格 + 档位：区分可靠段为空与有段无档位', () => {
  const zones = [
    { start: 0, end: 30 },
    { start: 40, end: 360 },
  ];
  // 有段无档位：可行 [30,40]，误差 2/2 → 可靠 [32,38]；12 档偏移 15 → 无档位落入
  const noDet = computeSeamAvoidance(360, 0, zones, {
    enabled: true,
    steps: 12,
    offsetDeg: 15,
  }, null, { ccwDeg: 2, cwDeg: 2 });
  assert.equal(noDet.tolerance.reliableEmpty, false);
  assert.equal(noDet.tolerance.detents.available.length, 0);
  assert.equal(noDet.tolerance.detents.noAvailable, true);

  // 可靠段为空：误差 20/20 → 可靠段消失；noAvailable 保持 false 以区分
  const empty = computeSeamAvoidance(360, 0, zones, {
    enabled: true,
    steps: 12,
    offsetDeg: 15,
  }, null, { ccwDeg: 20, cwDeg: 20 });
  assert.equal(empty.tolerance.reliableEmpty, true);
  assert.equal(empty.tolerance.detents.available.length, 0);
  assert.equal(empty.tolerance.detents.noAvailable, false);
});

/* ---------------- 多规格集成 ---------------- */

test('多规格：tolerance 基于共用安全段内缩', () => {
  // 公共段 216°→36°（跨零，宽 180）；误差 36/36 → 可靠 252°→360°
  const r = computeMultiSpec([400, 200], 20, [{ start: 60, end: 120 }], null, null, {
    ccwDeg: 36,
    cwDeg: 36,
  });
  assert.ok(r.tolerance);
  assert.equal(r.tolerance.reliableEmpty, false);
  assert.equal(r.tolerance.reliable.length, 1);
  const a = r.tolerance.reliable[0];
  approx(a.startDeg, 252);
  approx(a.endDeg, 360);
  assert.equal(a.wraps, false);
  approx(a.widthDeg, 108);
});

test('多规格：未传误差时保持原响应（无 tolerance 字段）', () => {
  const r = computeMultiSpec([400, 200], 20, [{ start: 60, end: 120 }]);
  assert.equal('tolerance' in r, false);
});

test('多规格：无共同解时可靠段为空；整圈共用可靠', () => {
  const noSol = computeMultiSpec([360, 180], 0, [
    { start: 90, end: 180 },
    { start: 180, end: 360 },
  ], null, null, { ccwDeg: 5, cwDeg: 5 });
  assert.equal(noSol.noSolution, true);
  assert.equal(noSol.tolerance.reliableEmpty, true);
  assert.deepEqual(noSol.tolerance.reliable, []);

  const full = computeMultiSpec([400, 200], 0, [], null, null, { ccwDeg: 100, cwDeg: 100 });
  assert.equal(full.fullCircle, true);
  assert.equal(full.tolerance.reliableFull, true);
});

test('多规格 + 档位：可靠档位求交并区分有段无档位', () => {
  // 公共段 216°→36°（宽 180）；误差 36/36 → 可靠 252°→360°
  // 12 档中 252..360 内档位：270/300/330/0(360) 共 4 档
  const r = computeMultiSpec([400, 200], 20, [{ start: 60, end: 120 }], {
    enabled: true,
    steps: 12,
  }, null, { ccwDeg: 36, cwDeg: 36 });
  assert.deepEqual(
    r.tolerance.detents.available.map((x) => x.deg),
    [0, 270, 300, 330]
  );
  assert.equal(r.tolerance.detents.noAvailable, false);

  // 有段无档位：公共段 [30,40]，误差 2/2 → 可靠 [32,38]；12 档偏移 15 无档位落入
  const none = computeMultiSpec([360, 360], 0, [
    { start: 0, end: 30 },
    { start: 40, end: 360 },
  ], { enabled: true, steps: 12, offsetDeg: 15 }, null, { ccwDeg: 2, cwDeg: 2 });
  assert.equal(none.tolerance.reliableEmpty, false);
  assert.equal(none.tolerance.detents.available.length, 0);
  assert.equal(none.tolerance.detents.noAvailable, true);
});

test('reliableDetents: 整圈可靠时全部档位可用', () => {
  const d = reliableDetents(
    { enabled: true, steps: 6, offsetDeg: 30 },
    { full: true, arcs: [{ full: true }] }
  );
  assert.equal(d.available.length, 6);
  assert.equal(d.noAvailable, false);
});

/* ---------------- HTTP 接口 ---------------- */

const { app } = require('../server');

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function postJson(p, body) {
  const res = await fetch(baseUrl + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

const baseSingle = { circumference: 360, seamWidth: 0, zones: [{ start: 0, end: 90 }] };
const baseMulti = {
  circumferences: [400, 200],
  seamWidth: 20,
  zones: [{ start: 60, end: 120 }],
};

test('API 单规格：tolerance 返回可靠段；未传时保持原响应', async () => {
  const r = await postJson('/api/compute', {
    ...baseSingle,
    tolerance: { ccwDeg: 10, cwDeg: 20 },
  });
  assert.equal(r.status, 200);
  assert.ok(r.json.tolerance);
  assert.equal(r.json.tolerance.totalDeg, 30);
  assert.equal(r.json.tolerance.reliable.length, 1);
  approx(r.json.tolerance.reliable[0].startDeg, 100);
  approx(r.json.tolerance.reliable[0].endDeg, 340);
  assert.equal(r.json.tolerance.reliableEmpty, false);
  assert.deepEqual(r.json.tolerance.detents, { enabled: false });

  // 未传误差：响应中没有 tolerance 字段
  const plain = await postJson('/api/compute', baseSingle);
  assert.equal(plain.status, 200);
  assert.equal('tolerance' in plain.json, false);
});

test('API 多规格：tolerance 返回可靠段；未传时保持原响应', async () => {
  const r = await postJson('/api/compute-multi', {
    ...baseMulti,
    tolerance: { ccwDeg: 36, cwDeg: 36 },
  });
  assert.equal(r.status, 200);
  assert.ok(r.json.tolerance);
  assert.equal(r.json.tolerance.reliable.length, 1);
  approx(r.json.tolerance.reliable[0].startDeg, 252);
  approx(r.json.tolerance.reliable[0].endDeg, 360);

  const plain = await postJson('/api/compute-multi', baseMulti);
  assert.equal(plain.status, 200);
  assert.equal('tolerance' in plain.json, false);
});

test('API：非法 tolerance 返回 400（两个接口）', async () => {
  const bads = [
    { ccwDeg: -1, cwDeg: 0 }, // 负值
    { ccwDeg: 0, cwDeg: -5 }, // 负值
    { ccwDeg: 'x', cwDeg: 0 }, // 非数值
    { ccwDeg: 0 }, // 缺 cwDeg
    { cwDeg: 0 }, // 缺 ccwDeg
    { ccwDeg: null, cwDeg: 0 }, // null
    { ccwDeg: Infinity, cwDeg: 0 }, // 非有限
    'on',
    42,
    [1, 2],
  ];
  for (const bad of bads) {
    const r1 = await postJson('/api/compute', { ...baseSingle, tolerance: bad });
    assert.equal(r1.status, 400, `单规格 tolerance=${JSON.stringify(bad)} 应 400`);
    assert.match(r1.json.error, /tolerance/);
    const r2 = await postJson('/api/compute-multi', { ...baseMulti, tolerance: bad });
    assert.equal(r2.status, 400, `多规格 tolerance=${JSON.stringify(bad)} 应 400`);
    assert.match(r2.json.error, /tolerance/);
  }
});

test('API：tolerance 与档位/路径等其他参数可叠加使用', async () => {
  const r = await postJson('/api/compute', {
    ...baseSingle,
    detents: { enabled: true, steps: 12 },
    route: { fromDeg: 300, toDeg: 30 },
    tolerance: { ccwDeg: 30, cwDeg: 30 },
  });
  assert.equal(r.status, 200);
  assert.ok(r.json.tolerance);
  assert.ok(r.json.route);
  assert.equal(r.json.detents.enabled, true);
  // 可靠段 120°→330°，可靠档位 8 个
  assert.equal(r.json.tolerance.detents.available.length, 8);
});
