'use strict';

/**
 * 安装误差（公差）分析。
 *
 * 设备定位存在安装误差：标称角度 θ 的实际落点可能沿圆周偏移，
 * 负向（逆时针）最多 ccwDeg、正向（顺时针）最多 cwDeg（均为非负有限角度）。
 * 标称角度 θ 可靠，当且仅当从 θ−ccwDeg 到 θ+cwDeg 的整条正向圆弧
 * 均落在安全角度内（含边界）。
 *
 * 等价几何：把每条安全弧的起点侧内缩 ccwDeg、终点侧内缩 cwDeg，
 * 剩余部分即为可靠标称角度的集合：
 *  - 安全弧 [s, s+w]（提升坐标）→ 可靠弧 [s+ccwDeg, s+w−cwDeg]；
 *  - 内缩后宽度为负 → 该弧无可靠点；宽度恰为 0 → 收缩为单点（该点仍可靠）；
 *  - 整圈安全时没有禁用边界，任意 θ 的误差弧都在圆内 → 整圈可靠；
 *  - 误差总宽 ccwDeg+cwDeg 达到 360° 时误差弧覆盖整圈，仅整圈安全有解，
 *    否则可靠段为空。
 *
 * 输入安全弧复用现有结果：单规格 feasible、多规格 common，
 * 均为 {startDeg,endDeg,wraps,widthDeg,full?} 的最大互不相交圆周弧；
 * 不同安全弧被正宽度禁用段隔开，内缩后仍互不相交，无需再合并。
 */

const { detentPositions } = require('./detents');

const FULL = 360;
const EPS = 1e-7; // 角度比较容差

function mod(n, m) {
  return ((n % m) + m) % m;
}

/** 圆上两点最短角距离。 */
function circDistDeg(a, b) {
  const d = Math.abs(mod(a - b, FULL));
  return Math.min(d, FULL - d);
}

/**
 * 解析安装误差参数。
 * 未提供（undefined/null）返回 null；否则 ccwDeg 与 cwDeg 都必须为非负有限角度。
 * @param {object|undefined|null} input
 */
function parseTolerance(input) {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('tolerance 必须为对象，如 {ccwDeg:2, cwDeg:3}');
  }
  for (const key of ['ccwDeg', 'cwDeg']) {
    const v = input[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new RangeError(`tolerance.${key} 必须为不小于 0 的有限角度（°）`);
    }
  }
  return { ccwDeg: input.ccwDeg, cwDeg: input.cwDeg };
}

/** 安全弧宽度（度）；缺省时由端点（含跨零）推算。 */
function arcWidthDeg(a) {
  if (a.widthDeg !== undefined) return a.widthDeg;
  if (a.full) return FULL;
  const s = mod(a.startDeg, FULL);
  return (a.wraps ? mod(a.endDeg, FULL) + FULL : a.endDeg) - s;
}

/**
 * 由安全弧集合计算可靠角度段。
 * @param {Array} safeArcs 安全圆周弧（最大、互不相交；空数组表示整圈禁用）
 * @param {object} tol {ccwDeg, cwDeg}
 * @returns {{full:boolean, arcs:Array}} full 表示整圈可靠；
 *   普通段 {startDeg,endDeg,wraps,widthDeg}；单点段另标 point:true（widthDeg=0）。
 */
function computeReliableArcs(safeArcs, tol) {
  const arcs = Array.isArray(safeArcs) ? safeArcs : [];
  const total = tol.ccwDeg + tol.cwDeg;

  // 整圈安全：任意标称角度的误差弧都落在圆内
  if (arcs.some((a) => a.full || arcWidthDeg(a) >= FULL - EPS)) {
    return {
      full: true,
      arcs: [{ startDeg: 0, endDeg: 0, wraps: false, widthDeg: FULL, full: true }],
    };
  }
  // 误差总宽达到 360°：误差弧覆盖整圈，非整圈安全必然无解
  if (total >= FULL - EPS) return { full: false, arcs: [] };

  const out = [];
  for (const a of arcs) {
    const width = arcWidthDeg(a);
    const rw = width - total;
    if (rw < -EPS) continue; // 内缩后消失
    const start = mod(mod(a.startDeg, FULL) + tol.ccwDeg, FULL);
    if (rw <= EPS) {
      // 收缩后仅剩一个点：该点的误差弧恰好与安全弧重合，仍可靠
      out.push({ startDeg: start, endDeg: start, wraps: false, widthDeg: 0, point: true });
      continue;
    }
    const end = start + rw;
    if (end > FULL + EPS && start > EPS) {
      // 真正跨零：末端落在零点之后
      out.push({ startDeg: start, endDeg: end - FULL, wraps: true, widthDeg: rw });
    } else if (end >= FULL - EPS) {
      // 末端落在整圈边界：写作 360，不模回 0（与可行段表示一致）
      out.push({ startDeg: start, endDeg: FULL, wraps: false, widthDeg: rw });
    } else {
      out.push({ startDeg: start, endDeg: end, wraps: false, widthDeg: rw });
    }
  }
  out.sort((x, y) => x.startDeg - y.startDeg);
  return { full: false, arcs: out };
}

/** 角度 deg 是否落在可靠段内（含边界；单点段仅含该点本身）。 */
function degInReliableArc(deg, arc) {
  if (arc.full) return true;
  const w = arc.widthDeg !== undefined ? arc.widthDeg : 0;
  if (w <= EPS) return circDistDeg(deg, arc.startDeg) <= 1e-6; // 单点段
  return mod(deg - mod(arc.startDeg, FULL), FULL) <= w + EPS;
}

/**
 * 落在可靠段内的全部档位。
 * @param {object} detentCfg parseDetents 返回的启用配置
 * @param {{full:boolean, arcs:Array}} reliable computeReliableArcs 结果
 * @returns {{enabled:true, available:Array<{index:number,deg:number}>, noAvailable:boolean}}
 *   noAvailable 仅表示“可靠段非空但无档位落入”；可靠段为空时为 false（由可靠段状态区分）。
 */
function reliableDetents(detentCfg, reliable) {
  const positions = detentPositions(detentCfg);
  const available = [];
  positions.forEach((deg, index) => {
    if (reliable.full || reliable.arcs.some((a) => degInReliableArc(deg, a))) {
      available.push({ index, deg });
    }
  });
  const empty = !reliable.full && reliable.arcs.length === 0;
  return {
    enabled: true,
    available,
    noAvailable: !empty && available.length === 0,
  };
}

/**
 * 组装安装误差分析结果块。
 * @param {object} tolCfg parseTolerance 结果（非 null）
 * @param {Array} safeArcs 安全段（单规格 feasible）或共用段（多规格 common）
 * @param {object|null} detentCfg parseDetents 结果；未启用传 null
 */
function buildToleranceAnalysis(tolCfg, safeArcs, detentCfg) {
  const reliable = computeReliableArcs(safeArcs, tolCfg);
  return {
    ccwDeg: tolCfg.ccwDeg,
    cwDeg: tolCfg.cwDeg,
    totalDeg: tolCfg.ccwDeg + tolCfg.cwDeg,
    reliableFull: reliable.full,
    reliableEmpty: !reliable.full && reliable.arcs.length === 0,
    reliable: reliable.arcs,
    detents:
      detentCfg && detentCfg.enabled
        ? reliableDetents(detentCfg, reliable)
        : { enabled: false },
  };
}

module.exports = {
  FULL,
  EPS,
  mod,
  circDistDeg,
  parseTolerance,
  arcWidthDeg,
  computeReliableArcs,
  degInReliableArc,
  reliableDetents,
  buildToleranceAnalysis,
};
