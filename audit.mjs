// 데이터 감사: 협곡 전용/최신 여부, 비정상(삭제·숨김·특수) 아이템, 10초당 골드 아이템 점검
const versions = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json();
const version = versions[0];
const itemJson = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/ko_KR/item.json`)).json();
const data = itemJson.data;
console.log('LIVE version:', version, '| 전체 엔트리:', Object.keys(data).length);

const isSR = it => it?.maps?.['11'] === true && it?.gold?.purchasable === true;
const sr = Object.entries(data).filter(([, it]) => isSR(it));
console.log('현재 필터(maps11 && purchasable):', sr.length, '개\n');

const has = (it, re) => /<stats>([\s\S]*?)<\/stats>/.test(it.description) &&
  re.test(/<stats>([\s\S]*?)<\/stats>/.exec(it.description)[1]);

// 1) 10초당 골드 아이템
console.log('── "10초당 골드" 기본스탯 아이템 ──');
for (const [id, it] of sr) {
  if (has(it, /10초당 골드/)) {
    console.log(`  ${id} ${it.name} | ${it.gold.total}G | tags=[${it.tags}] | inStore=${it.inStore} hideFromAll=${it.hideFromAll} reqAlly=${it.requiredAlly ?? '-'}`);
    console.log(`      desc: ${it.description.replace(/<[^>]+>/g,'·').slice(0,160)}`);
  }
}

// 2) 비정상/비표준 플래그 점검 (현재 필터 통과분 중)
const flag = (label, pred) => {
  const hits = sr.filter(([, it]) => pred(it));
  console.log(`\n── ${label}: ${hits.length}개 ──`);
  hits.slice(0, 40).forEach(([id, it]) => console.log(`  ${id} ${it.name} (tags=[${it.tags}])`));
};
flag('inStore === false (상점 비노출)', it => it.inStore === false);
flag('hideFromAll === true (숨김)', it => it.hideFromAll === true);
flag('requiredChampion (챔피언 전용)', it => it.requiredChampion);
flag('requiredAlly (오른 등 아군 전용)', it => it.requiredAlly);
flag('Consumable 태그(소모품/물약/엘릭서)', it => (it.tags || []).includes('Consumable'));
flag('Trinket 태그(장신구)', it => (it.tags || []).includes('Trinket'));
flag('gold.total === 0 (무료)', it => it.gold.total === 0);

// 3) "10초당 골드"가 전체(맵 무관) 어디에 있는지 — 혹시 다른 맵 전용인지
console.log('\n── 전체 엔트리 중 "10초당 골드" 보유 (맵 무관) ──');
for (const [id, it] of Object.entries(data)) {
  if (it.description && /10초당 골드/.test(it.description)) {
    const m = it.maps || {};
    console.log(`  ${id} ${it.name} | purch=${it.gold?.purchasable} maps:[${Object.entries(m).filter(([,v])=>v).map(([k])=>k).join(',')}] inStore=${it.inStore}`);
  }
}
