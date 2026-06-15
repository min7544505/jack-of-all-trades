// 다재다능(Jack of All Trades) 스택 계산용 아이템 데이터 빌드 + 검증 스크립트
// 사용법:
//   node build-data.mjs            (오프라인: ddragon_item_raw.json 사용)
//   node build-data.mjs --live     (최신 패치를 DDragon에서 직접 받아 raw도 갱신)
//
// 핵심 로직(parseStats / mapStat / ELIGIBLE_STATS)은 index.html과 동일하게 유지한다.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const RAW_PATH = join(ROOT, 'ddragon_item_raw.json');
const OUT_PATH = join(ROOT, 'data', 'items.json');

// ── 다재다능 스택으로 인정되는 스탯 종류 (위키 기준, ko_KR 표기) ─────────────
// 이동 속도 / 마법 관통력은 "고정"과 "%"가 서로 다른 스택으로 취급된다.
export const ELIGIBLE_STATS = [
  { key: 'ad',               label: '공격력' },
  { key: 'ap',               label: '주문력' },
  { key: 'as',               label: '공격 속도' },
  { key: 'ah',               label: '스킬 가속' },
  { key: 'hp',               label: '체력' },
  { key: 'armor',            label: '방어력' },
  { key: 'mr',               label: '마법 저항력' },
  { key: 'crit',             label: '치명타 확률' },
  { key: 'critdmg',          label: '치명타 피해량' },
  { key: 'ms_flat',          label: '이동 속도(고정)' },
  { key: 'ms_percent',       label: '이동 속도(%)' },
  { key: 'mana',             label: '마나' },
  { key: 'mp5',              label: '기본 마나 재생' },
  { key: 'hp5',              label: '기본 체력 재생' },
  { key: 'healshield',       label: '체력 회복 및 보호막' },
  { key: 'lifesteal',        label: '생명력 흡수' },
  { key: 'omnivamp',         label: '모든 피해 흡혈' },
  { key: 'lethality',        label: '물리 관통력' },
  { key: 'armorpen_percent', label: '방어구 관통력(%)' },
  { key: 'magicpen_flat',    label: '마법 관통력(고정)' },
  { key: 'magicpen_percent', label: '마법 관통력(%)' },
  { key: 'tenacity',         label: '강인함' },
  { key: 'goldgen',          label: '10초당 골드' },
  { key: 'range',            label: '사거리' },
];

// ko_KR 스탯 표기 → 내부 key (이동 속도/마법 관통력은 mapStat에서 고정/% 분기)
const STAT_MAP = {
  '공격력': 'ad', '주문력': 'ap', '공격 속도': 'as', '스킬 가속': 'ah', '체력': 'hp',
  '방어력': 'armor', '마법 저항력': 'mr', '치명타 확률': 'crit', '치명타 피해량': 'critdmg',
  '마나': 'mana', '기본 마나 재생': 'mp5', '기본 체력 재생': 'hp5', '체력 회복 및 보호막': 'healshield',
  '생명력 흡수': 'lifesteal', '모든 피해 흡혈': 'omnivamp', '물리 관통력': 'lethality',
  '방어구 관통력': 'armorpen_percent', '강인함': 'tenacity', '10초당 골드': 'goldgen',
  '사거리': 'range',
  '적응형 능력치': 'adaptive', // 인정 안 됨(아래 INELIGIBLE)
};

// 스탯은 있으나 Jack 스택을 주지 않는 종류
const INELIGIBLE = new Set(['adaptive']);

export function mapStat(label, value) {
  if (label === '이동 속도') return value.includes('%') ? 'ms_percent' : 'ms_flat';
  if (label === '마법 관통력') return value.includes('%') ? 'magicpen_percent' : 'magicpen_flat';
  return STAT_MAP[label] ?? null;
}

// description의 <stats>...</stats> 블록에서 기본 스탯만 추출 (패시브/액티브 제외)
export function parseStats(description) {
  const out = [];
  const block = /<stats>([\s\S]*?)<\/stats>/.exec(description || '');
  if (!block) return out;
  const re = /([^<>]+?)\s*<attention[^>]*>([^<]+)<\/attention>/g;
  let m;
  while ((m = re.exec(block[1]))) {
    const label = m[1].replace(/<[^>]+>/g, '').trim();
    const value = m[2].trim();
    if (!label) continue;
    const key = mapStat(label, value);
    out.push({ label, value, key, eligible: key !== null && !INELIGIBLE.has(key) });
  }
  return out;
}

// 소환사 협곡(맵 11)에서 실제로 빌드하는 아이템만.
// 소모품(물약/영약/와드)·장신구·숨김·챔피언 전용은 빌드 아이템이 아니므로 제외한다.
const EXCLUDE_TAGS = new Set(['Consumable', 'Trinket']);
export function isSummonersRiftItem(it) {
  if (it?.maps?.['11'] !== true) return false;     // 협곡 전용
  if (it?.gold?.purchasable !== true) return false; // 구매 가능(구버전/오른 강화 제외)
  if (it.hideFromAll === true) return false;        // 숨김(예: 부서진 팔목 보호대)
  if (it.requiredChampion) return false;            // 챔피언 전용(예: 칼리스타의 창)
  if ((it.tags || []).some((t) => EXCLUDE_TAGS.has(t))) return false; // 소모품/장신구
  return true;
}

// 역할(분류) — 인게임 상점식 원딜/암살자/마법사 등. 아이템 tags 기반 휴리스틱(index.html과 동일).
export function itemRoles(tags, keys) {
  const T = new Set(tags || []);
  const K = new Set(keys || []);
  // keys(파싱 스탯) + tags 를 합쳐 신호로 사용 (패시브로만 스탯 주는 아이템은 keys가 비어 tags로 보완)
  const AD = K.has('ad') || T.has('Damage');
  const AP = K.has('ap') || T.has('SpellDamage');
  const HP = K.has('hp') || T.has('Health');
  const ARM = K.has('armor') || T.has('Armor');
  const MR = K.has('mr') || T.has('SpellBlock') || T.has('MagicResist');
  const CRIT = K.has('crit') || T.has('CriticalStrike');
  const AS = K.has('as') || T.has('AttackSpeed');
  const LETH = K.has('lethality') || K.has('armorpen_percent') || T.has('ArmorPenetration');
  const VAMP = K.has('lifesteal') || K.has('omnivamp') || T.has('LifeSteal') || T.has('SpellVamp');
  const AH = K.has('ah') || T.has('AbilityHaste') || T.has('CooldownReduction');
  const r = [];
  if (T.has('Boots')) r.push('boots');
  if (AP) r.push('mage');
  if (CRIT || AS || T.has('OnHit') || (VAMP && AD && !AP)) r.push('marksman');
  if (LETH) r.push('assassin');
  if (AD && !CRIT && (HP || ARM || MR || VAMP || AH)) r.push('fighter');
  if (ARM || MR || (HP && !AD && !AP)) r.push('tank');
  if (T.has('GoldPer') || K.has('healshield') ||
      ((T.has('Aura') || T.has('Active')) && (K.has('mp5') || K.has('mana')) && !AD)) r.push('support');
  return r;
}

// 급(tier): from/into 빌드트리로 판정 (depth는 빌드 단계수라 완성품을 서사로 오분류; index.html과 동일)
export function itemTier(it) {
  const hasFrom = (it.from || []).length > 0;
  const hasInto = (it.into || []).length > 0;
  if (!hasFrom) return 'basic';      // 기본(부품/시작템)
  if (!hasInto) return 'legendary';  // 전설(완성)
  return 'epic';                     // 서사
}

export function buildItems(ddragonData, version, cdragon = null) {
  // 이름별 최소 id(기본형) 엔트리의 maps — 협곡 네이티브 판정용
  const base = {};
  for (const [id, it] of Object.entries(ddragonData)) {
    const n = it.name, idn = Number(id);
    if (!(n in base) || idn < base[n].id) base[n] = { id: idn, sr: it.maps?.['11'] === true };
  }
  // 기본형(이름별 최소 id) 엔트리가 협곡(11)일 때만 인정 (아레나=기본형 맵 30 등, 삭제템=기본형 맵 빈 배열 제외).
  const isNativeSR = it => { const b = base[it.name]; return !b || b.sr; };
  // CDragon(게임 클라 데이터)로 칼바람(아이콘에 ARAM)·비상점 아이템 추가 제외. 없으면 통과(부분 검증).
  const cdById = new Map((cdragon || []).map(x => [x.id, x]));
  const isCdragonSR = name => {
    if (!cdById.size) return true;
    const cd = cdById.get(base[name].id);
    return !!cd && cd.inStore === true && !/aram/i.test(cd.iconPath || '');
  };

  const items = [];
  for (const [id, it] of Object.entries(ddragonData)) {
    if (!isSummonersRiftItem(it) || !isNativeSR(it) || !isCdragonSR(it.name)) continue;
    const stats = parseStats(it.description);
    const eligibleKeys = [...new Set(stats.filter((s) => s.eligible).map((s) => s.key))];
    items.push({
      id,
      baseId: base[it.name].id,
      name: it.name,
      icon: `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${it.image.full}`,
      gold: it.gold?.total ?? 0,
      tags: it.tags ?? [],
      roles: itemRoles(it.tags, eligibleKeys),
      depth: it.depth ?? 1,
      tier: itemTier(it),
      stats,
      eligibleKeys,
      description: it.description,
    });
  }
  // 같은 이름 중복 제거 (모드별 변형 등) — 표준(가장 낮은 id)만 유지
  const byName = new Map();
  for (const it of items) {
    const cur = byName.get(it.name);
    if (!cur || Number(it.id) < Number(cur.id)) byName.set(it.name, it);
  }
  const deduped = [...byName.values()];
  // 비싼(완성형) 순으로 정렬
  deduped.sort((a, b) => b.gold - a.gold || a.name.localeCompare(b.name, 'ko'));
  return deduped;
}

// 선택된 아이템 배열 → 스택/보너스 계산
export function computeStacks(selectedItems, cap = 10) {
  const covered = new Map(); // key -> [기여 아이템 이름...]
  for (const it of selectedItems) {
    for (const k of it.eligibleKeys) {
      if (!covered.has(k)) covered.set(k, []);
      covered.get(k).push(it.name);
    }
  }
  const uniqueCount = covered.size;
  const stacks = Math.min(uniqueCount, cap);
  let adaptive = 0;
  if (stacks >= 10) adaptive = 25;
  else if (stacks >= 5) adaptive = 10;
  return {
    uniqueCount,
    stacks,
    abilityHaste: stacks,          // 스택당 +1
    adaptiveForce: adaptive,       // 적응형 수치
    bonusAD: Math.round(adaptive * 0.6),
    bonusAP: adaptive,
    covered,                       // Map(key -> 기여 아이템들)
  };
}

// ── 빌드 + 검증 (직접 실행 시) ───────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const live = process.argv.includes('--live');
  let version, data;

  if (live) {
    const versions = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json();
    version = versions[0];
    const itemJson = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/ko_KR/item.json`)).json();
    data = itemJson.data;
    await writeFile(RAW_PATH, JSON.stringify(itemJson, null, 2), 'utf8');
    console.log(`[live] DDragon ${version} 받아서 raw 갱신`);
  } else {
    const itemJson = JSON.parse(await readFile(RAW_PATH, 'utf8'));
    data = itemJson.data;
    version = itemJson.version;
    console.log(`[offline] ddragon_item_raw.json 사용 (version ${version})`);
  }

  let cdragon = null;
  try {
    cdragon = await (await fetch('https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/items.json')).json();
    console.log(`[CDragon] 교차검증 데이터 로드 (${cdragon.length}개)`);
  } catch (e) {
    console.log('[CDragon] 로드 실패 → 부분 검증으로 진행:', e.message);
  }
  const items = buildItems(data, version, cdragon);
  await mkdir(join(ROOT, 'data'), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify({ version, source: 'ddragon ko_KR', stackCap: 10, eligibleStats: ELIGIBLE_STATS, items }, null, 2), 'utf8');

  console.log(`\n협곡 빌드 아이템: ${items.length}개  →  data/items.json 저장`);

  // 협곡+구매가능이지만 빌드 아이템이 아니라 제외된 항목 (투명성)
  const excluded = Object.entries(data)
    .filter(([, it]) => it?.maps?.['11'] === true && it?.gold?.purchasable === true && !isSummonersRiftItem(it))
    .map(([, it]) => `${it.name}(${(it.tags || []).join('/') || '-'})`);
  console.log(`제외(소모품/장신구/숨김/챔프전용): ${excluded.length}개\n  ${excluded.join(', ')}`);

  // CDragon으로 추가 제외된 항목(칼바람 아이콘) 리포트
  if (cdragon) {
    const cdById = new Map(cdragon.map((x) => [x.id, x]));
    const baseId = {};
    for (const [id, it] of Object.entries(data)) { const n = it.name, idn = Number(id); if (!(n in baseId) || idn < baseId[n]) baseId[n] = idn; }
    const aram = new Set();
    for (const [, it] of Object.entries(data)) {
      if (it?.maps?.['11'] !== true || it?.gold?.purchasable !== true) continue;
      const cd = cdById.get(baseId[it.name]);
      if (cd && /aram/i.test(cd.iconPath || '')) aram.add(it.name);
    }
    console.log(`\nCDragon 추가 제외(칼바람 아이콘): ${aram.size}개${aram.size ? ' → ' + [...aram].join(', ') : ''}`);
  } else {
    console.log('\nCDragon 미적용(부분 검증)');
  }

  // 검증 1) 매핑되지 않은(알 수 없는) 스탯 표기 점검
  const unknown = {};
  for (const it of items) for (const s of it.stats) if (s.key === null) unknown[s.label] = (unknown[s.label] || 0) + 1;
  console.log('알 수 없는 스탯 표기:', Object.keys(unknown).length ? unknown : '(없음 ✓)');

  // 검증 2) 인정 스탯별 보유 아이템 수
  const perKey = {};
  for (const it of items) for (const k of it.eligibleKeys) perKey[k] = (perKey[k] || 0) + 1;
  console.log('\n인정 스탯별 아이템 수:');
  for (const { key, label } of ELIGIBLE_STATS) console.log(`  ${String(perKey[key] ?? 0).padStart(3)}  ${key.padEnd(18)} ${label}`);

  // 검증 3) 무한의 대검(치명타 피해량 누락 여부)
  const ie = items.find((i) => i.name === '무한의 대검');
  console.log('\n무한의 대검:', ie?.stats.map((s) => `${s.label}=${s.value}${s.eligible ? '' : '✗'}`).join(' / '), '→', ie?.eligibleKeys.join(','));

  // 검증 4) 샘플 빌드 스택 계산
  const pick = (...names) => names.map((n) => items.find((i) => i.name === n)).filter(Boolean);
  const sampleNames = ['명석함의 아이오니아 장화', '루덴의 동반자', '존야의 모래시계', '리안드리의 고통', '공허의 지팡이', '모렐로미콘'];
  const build = pick(...sampleNames);
  const r = computeStacks(build);
  console.log(`\n샘플 빌드 (${build.map((i) => i.name).join(', ')})`);
  console.log(`  → 고유 스탯 ${r.uniqueCount}종 / ${r.stacks}스택 / 스킬가속 +${r.abilityHaste} / 적응형 +${r.adaptiveForce} (AD ${r.bonusAD} 또는 AP ${r.bonusAP})`);
  console.log('  커버된 스탯:', [...r.covered.keys()].join(', '));
}
